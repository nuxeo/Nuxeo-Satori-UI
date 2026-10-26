import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import {
  L10nDirectoryEntry,
  NuxeoApiBase,
  directoryPickerLabel,
  directoryUsesL10nLabel,
  formatHierarchicalL10nLabel,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  Observable,
  TimeoutError,
  catchError,
  combineLatest,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
  timeout,
} from 'rxjs';

import {
  LayoutFile,
  LayoutIndex,
  readLayoutEnvelope,
  readLayoutFile,
  readLayoutIndex,
} from './layout-file';
import {
  DocumentSchemaRef,
  DocumentTypeDefinition,
  DocumentTypeSchema,
  LayoutMode,
  ResolvedLayout,
} from './layout.model';
import {
  applyLayoutFile,
  facetSchemasToRead,
  generateLayout,
  prefixOfXpath,
  readDocumentType,
  readSchemaResponse,
} from './resolve-layout';

/** As for the bootstrap and manifest reads: `HttpClient` has no timeout of its own. */
export const LAYOUT_LOAD_TIMEOUT_MS = 10_000;

const EMPTY_INDEX: LayoutIndex = { entries: [], diagnostics: [] };

/** The directory the configuration service answers from, taken from the bootstrap URL. */
function configDirectory(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return path.slice(0, path.lastIndexOf('/') + 1);
}

export function layoutsIndexUrl(bootstrapUrl: string): string {
  return `${configDirectory(bootstrapUrl)}layouts.json`;
}

export function layoutFileUrl(bootstrapUrl: string, type: string, mode: string): string {
  return `${configDirectory(bootstrapUrl)}layouts/${encodeURIComponent(type)}/${encodeURIComponent(mode)}.layout.json`;
}

function describe(error: unknown): string {
  if (error instanceof TimeoutError) return `no response within ${LAYOUT_LOAD_TIMEOUT_MS / 1000} s`;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status !== 0) return `HTTP ${status}`;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : 'request failed';
}

/** An l10n vocabulary labels an entry with `label_en`; any other with `label`, here translated. */
interface VocabularyEntry extends L10nDirectoryEntry {
  readonly properties: L10nDirectoryEntry['properties'] & { readonly label?: unknown };
}

/** One entry as `GET /directory/<name>/<id>` answers it, or `null` for any other body. */
function readEntry(raw: unknown): VocabularyEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, directoryName, properties } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof properties !== 'object' || properties === null) return null;
  return {
    id,
    directoryName: typeof directoryName === 'string' ? directoryName : '',
    properties: properties as VocabularyEntry['properties'],
  };
}

/** The product app has no page showing diagnostics, so the console is where support finds them. */
function warn(message: string): void {
  console.warn(`[agentic-ui-layouts] ${message}`);
}

/**
 * Resolves the layout a document shows in a mode, from its type and its own schemas.
 *
 * The contributed files come from the configuration service: `layouts.json` names the types and
 * modes a package contributed, and each file is fetched the first time a document of that type
 * needs it. Both are read once per session — the server changes them only on install and
 * restart. The type's schemas come from `/config/types/<type>`, which, asked for
 * `fetch-schema: fields`, also names the vocabulary a field is bound to.
 *
 * A dynamic facet adds schemas to one document, not to its type, so no type read has them. The
 * document's own read lists every schema it carries, and each one its type lacks is read from
 * `/config/schemas/<name>`, in the same shape. The layout is resolved per document from those
 * reads, each cached per type or per schema, never from a layout cached for the type.
 *
 * Tolerant, like the rest of the configuration: an unreachable or malformed index or file falls
 * back to the generated layout and says why in the console.
 */
@Injectable({ providedIn: 'root' })
export class DocumentLayoutService {
  private readonly api = inject(NuxeoApiBase);
  /**
   * The layout reads skip the interceptors: no `Authorization` header, and no reset of the idle
   * timer. They are not anonymous — same-origin, so the browser still attaches its cookies.
   */
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);

  private index$: Observable<LayoutIndex> | null = null;
  private readonly files = new Map<string, Observable<LayoutFile | null>>();
  private readonly types = new Map<string, Observable<DocumentTypeDefinition | null>>();
  private readonly schemas = new Map<string, Observable<DocumentTypeSchema | null>>();
  private readonly entries = new Map<string, Observable<VocabularyEntry | null>>();

  /**
   * The layout to render for a document, or `null` when its type's schemas cannot be read.
   * Never errors.
   *
   * `documentSchemas` are the schemas the document's own read reports. A facet schema that
   * cannot be read is left out, and the rest of the layout still renders.
   */
  layoutFor(
    type: string,
    mode: LayoutMode,
    documentSchemas: readonly DocumentSchemaRef[] = [],
  ): Observable<ResolvedLayout | null> {
    return combineLatest([this.documentType(type), this.contributed(type, mode)]).pipe(
      switchMap(([definition, file]) =>
        definition ? this.resolve(definition, mode, file, documentSchemas) : of(null),
      ),
    );
  }

  private resolve(
    definition: DocumentTypeDefinition,
    mode: LayoutMode,
    file: LayoutFile | null,
    documentSchemas: readonly DocumentSchemaRef[],
  ): Observable<ResolvedLayout> {
    const wanted = facetSchemasToRead(definition, documentSchemas, file);
    const reads: Observable<readonly (DocumentTypeSchema | null)[]> = wanted.length
      ? forkJoin(wanted.map(({ name }) => this.schema(name)))
      : of([]);
    return reads.pipe(
      map((read) => {
        const facets = read.filter((schema): schema is DocumentTypeSchema => schema !== null);
        if (!file) return generateLayout(definition, mode, facets);
        const unread = new Map(
          wanted.filter((_, i) => !read[i]).map((ref) => [ref.prefix, ref.name]),
        );
        return this.apply(definition, mode, file, facets, unread);
      }),
    );
  }

  /** `unread`: the prefix of each facet schema the file names whose read failed, to its name. */
  private apply(
    definition: DocumentTypeDefinition,
    mode: LayoutMode,
    file: LayoutFile,
    facets: readonly DocumentTypeSchema[],
    unread: ReadonlyMap<string, string>,
  ): ResolvedLayout {
    const { name: type } = definition;
    const { layout, skipped } = applyLayoutFile(definition, mode, file, facets);
    for (const xpath of skipped) {
      const schema = unread.get(prefixOfXpath(xpath));
      warn(
        schema
          ? `${type}/${mode} layout: field ${xpath} skipped: schema ${schema} was not read`
          : `${type}/${mode} layout: field ${xpath} is not on the ${type} type or this document's facets; skipped`,
      );
    }
    return layout;
  }

  /**
   * The label of one vocabulary entry, or `null` when it cannot be read. Never errors.
   *
   * Read by id, so a document costs a request per value it shows — and one for its parent in an
   * l10n vocabulary, labelled `Parent/Child` as the panel's Subjects and Coverage rows are —
   * however many entries the vocabulary has. In English, as those rows are. Each entry is read
   * once per session; a failed read is asked again by the next document that shows it.
   */
  vocabularyLabel(directory: string, id: string): Observable<string | null> {
    return this.entry(directory, id).pipe(
      switchMap((entry) => {
        if (!entry) return of(null);
        if (!directoryUsesL10nLabel(directory)) {
          const { label } = entry.properties;
          return of(
            directoryPickerLabel({
              id,
              displayLabel: '',
              label: typeof label === 'string' ? label : undefined,
            }),
          );
        }
        const parent = entry.properties.parent;
        if (!parent) return of(formatHierarchicalL10nLabel(id, [entry]));
        return this.entry(directory, parent).pipe(
          map((found) => formatHierarchicalL10nLabel(id, found ? [entry, found] : [entry])),
        );
      }),
    );
  }

  private entry(directory: string, id: string): Observable<VocabularyEntry | null> {
    const key = `${directory}\n${id}`;
    let cached = this.entries.get(key);
    if (!cached) {
      cached = this.api
        .get<unknown>(
          `/nuxeo/api/v1/directory/${encodeURIComponent(directory)}/${encodeURIComponent(id)}`,
          undefined,
          { 'translate-directoryEntry': 'label', 'Accept-Language': 'en' },
        )
        .pipe(
          map((raw) => {
            const entry = readEntry(raw);
            if (!entry) throw new Error('the response is not a directory entry');
            return entry;
          }),
          catchError(() => {
            this.entries.delete(key);
            return of(null);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
      this.entries.set(key, cached);
    }
    return cached;
  }

  private documentType(type: string): Observable<DocumentTypeDefinition | null> {
    let cached = this.types.get(type);
    if (!cached) {
      cached = this.api
        .get<unknown>(`/nuxeo/api/v1/config/types/${encodeURIComponent(type)}`, undefined, {
          'fetch-schema': 'fields',
        })
        .pipe(
          map((raw) => {
            const definition = readDocumentType(raw, type);
            if (!definition) throw new Error('the response is not a document type');
            return definition;
          }),
          catchError((error: unknown) => {
            // Not cached, so the next document of this type asks again.
            this.types.delete(type);
            warn(`schemas of ${type} not read: ${describe(error)}`);
            return of(null);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
      this.types.set(type, cached);
    }
    return cached;
  }

  /**
   * One schema, shared by every type and document that carries it. A failed read is not kept.
   * Timed out like the layout reads: the other sections wait for it.
   */
  private schema(name: string): Observable<DocumentTypeSchema | null> {
    let cached = this.schemas.get(name);
    if (!cached) {
      cached = this.api
        .get<unknown>(`/nuxeo/api/v1/config/schemas/${encodeURIComponent(name)}`, undefined, {
          'fetch-schema': 'fields',
        })
        .pipe(
          timeout(LAYOUT_LOAD_TIMEOUT_MS),
          map((raw) => {
            const schema = readSchemaResponse(raw, name);
            if (!schema) throw new Error(`the response is not the ${name} schema`);
            return schema;
          }),
          catchError((error: unknown) => {
            this.schemas.delete(name);
            warn(`schema ${name} not read: ${describe(error)}`);
            return of(null);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
      this.schemas.set(name, cached);
    }
    return cached;
  }

  private contributed(type: string, mode: LayoutMode): Observable<LayoutFile | null> {
    const key = `${type}/${mode}`;
    let cached = this.files.get(key);
    if (!cached) {
      cached = this.index().pipe(
        switchMap((index) =>
          index.entries.some((entry) => entry.type === type && entry.mode === mode)
            ? this.fetchFile(type, mode)
            : of(null),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.files.set(key, cached);
    }
    return cached;
  }

  private index(): Observable<LayoutIndex> {
    const url = layoutsIndexUrl(this.bootstrapUrl);
    this.index$ ??= this.http.get<unknown>(url).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => {
        const index = readLayoutIndex(raw);
        if ('invalid' in index) {
          warn(`layouts from ${url} ignored: ${index.invalid}`);
          return EMPTY_INDEX;
        }
        for (const { level, code, message } of index.diagnostics) {
          warn(`server ${level} ${code}: ${message}`);
        }
        return index;
      }),
      catchError((error: unknown) => {
        warn(`layouts not loaded from ${url}: ${describe(error)}`);
        return of(EMPTY_INDEX);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.index$;
  }

  private fetchFile(type: string, mode: LayoutMode): Observable<LayoutFile | null> {
    const url = layoutFileUrl(this.bootstrapUrl, type, mode);
    return this.http.get<unknown>(url).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => {
        const envelope = readLayoutEnvelope(raw, type, mode);
        if ('invalid' in envelope) {
          warn(`${type}/${mode} layout from ${url} ignored: ${envelope.invalid}`);
          return null;
        }
        const file = readLayoutFile(envelope.content);
        if ('invalid' in file) {
          warn(
            `${type}/${mode} layout from ${url} refused, showing the generated layout: ${file.invalid}`,
          );
          return null;
        }
        for (const problem of file.problems) warn(`${type}/${mode} layout: ${problem}; skipped`);
        return file;
      }),
      catchError((error: unknown) => {
        warn(`${type}/${mode} layout not loaded from ${url}: ${describe(error)}`);
        return of(null);
      }),
    );
  }
}
