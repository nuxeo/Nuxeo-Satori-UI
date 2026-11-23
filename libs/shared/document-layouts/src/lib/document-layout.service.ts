import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  L10nDirectoryEntry,
  NuxeoApiBase,
  type NuxeoDocument,
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
  readDocumentSchemas,
  readDocumentType,
  readSchemaResponse,
} from './resolve-layout';
import { RecordLayoutFile, readRecordLayout } from './record-page/record-layout';
import {
  ResolvedRecordLayout,
  SkippedRecordField,
  recordFacetSchemasToRead,
  resolveRecordLayout,
} from './record-page/resolve-record-layout';

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
 * The entry id a hierarchical vocabulary value names: its last segment.
 *
 * `dc:subjects` and `dc:coverage` store the path through the vocabulary, `art/architecture`,
 * while the entry carries only the leaf as its id — `architecture`, whose `parent` is `art`. So
 * the leaf is the entry to read, and the whole path never is: as a path segment it is refused
 * encoded (`%2F`, HTTP 400 from Tomcat) and is a different resource unencoded (HTTP 404).
 *
 * Split at the last slash, so this reads a path exactly as `formatHierarchicalL10nLabel` does.
 * That is what makes a slashed id safe to split: were an entry to carry a slash in its own id,
 * the formatter would accept the leaf only when its `parent` is the rest of the path — the same
 * reading — and otherwise keep the stored id, which is what an unreadable value already showed.
 */
function leafOf(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** The schemas whose records the View tab shows by their own content: a file, a note. */
const OWN_VIEW_SCHEMAS: ReadonlySet<string> = new Set(['file', 'note']);

/** The name a user or group is shown by: first and last name, or the group's label. */
export function principalName(kind: 'user' | 'group', raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (kind === 'group') {
    const { grouplabel, groupname } = record;
    if (typeof grouplabel === 'string' && grouplabel.trim() !== '') return grouplabel;
    return typeof groupname === 'string' && groupname !== '' ? groupname : null;
  }
  const properties = record['properties'];
  if (typeof properties !== 'object' || properties === null) return null;
  const { firstName, lastName } = properties as Record<string, unknown>;
  const name = [firstName, lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ');
  return name === '' ? null : name;
}

/** Why the record page left a field out, as the console says it. */
function skippedMessage(
  type: string,
  field: SkippedRecordField,
  unread: ReadonlyMap<string, string>,
): string {
  if (field.reason === 'widget-type') {
    return `${type}/view layout: ${field.place} left out: the widget "${field.widget}" does not show ${field.xpath}, a ${field.type} property`;
  }
  const schema = unread.get(prefixOfXpath(field.xpath));
  return schema
    ? `${type}/view layout: ${field.place} left out: ${field.xpath} is in schema ${schema}, which was not read`
    : `${type}/view layout: ${field.place} left out: ${field.xpath} is not on the ${type} type or this document's facets`;
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
  private readonly rules = inject(ExtensionRuleRegistry);

  private index$: Observable<LayoutIndex> | null = null;
  private readonly files = new Map<string, Observable<LayoutFile | null>>();
  private readonly recordFiles = new Map<string, Observable<RecordLayoutFile | null>>();
  private readonly types = new Map<string, Observable<DocumentTypeDefinition | null>>();
  private readonly schemas = new Map<string, Observable<DocumentTypeSchema | null>>();
  private readonly entries = new Map<string, Observable<VocabularyEntry | null>>();
  private readonly principals = new Map<string, Observable<string | null>>();
  /** The types the console has been told keep their own view, so that it is told once each. */
  private readonly ownView = new Set<string>();

  /**
   * The record page a document shows in its View tab: the `view` file its type was contributed,
   * layout version 2, resolved against the type and the document's own schemas. Never errors.
   *
   * `null` when the type has no `view` file, when its file is refused, or when the type's schemas
   * cannot be read. The View tab is then today's document page, as layout-v2.md, section 1, says.
   * A type with no `view` file costs no request but the index, which is read once per session.
   */
  recordLayoutFor(
    type: string,
    documentSchemas: readonly DocumentSchemaRef[] = [],
  ): Observable<ResolvedRecordLayout | null> {
    return this.recordFile(type).pipe(
      switchMap((file) =>
        file
          ? this.documentType(type).pipe(
              switchMap((definition) => {
                if (!definition) return of(null);
                // The type's schemas and the document's own: a dynamic facet can add `file` or
                // `note` to one record of a type that has neither, and its preview shows first too.
                const schemas = [...definition.schemas, ...documentSchemas];
                if (schemas.some((schema) => OWN_VIEW_SCHEMAS.has(schema.name))) {
                  return this.ownViewFirst(type);
                }
                return this.resolveRecord(definition, file, documentSchemas);
              }),
            )
          : of(null),
      ),
    );
  }

  /** {@link recordLayoutFor} for one document: its type, and the schemas its own read reports. */
  recordLayoutOf(document: NuxeoDocument): Observable<ResolvedRecordLayout | null> {
    return this.recordLayoutFor(
      document.type,
      readDocumentSchemas('schemas' in document ? document.schemas : undefined),
    );
  }

  /**
   * A user's or group's display name, or `null` when it cannot be read. Never errors.
   *
   * Read by id, once per session, and for a group without its members, which `UserService` asks
   * for and a label does not need. A failed read is asked again by the next page that shows it.
   */
  principalLabel(kind: 'user' | 'group', id: string): Observable<string | null> {
    const key = `${kind}\n${id}`;
    let cached = this.principals.get(key);
    if (!cached) {
      cached = this.api.get<unknown>(`/nuxeo/api/v1/${kind}/${encodeURIComponent(id)}`).pipe(
        timeout(LAYOUT_LOAD_TIMEOUT_MS),
        map((raw) => principalName(kind, raw)),
        catchError((error: unknown) => {
          this.principals.delete(key);
          warn(`${kind} ${id} not read: ${describe(error)}`);
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.principals.set(key, cached);
    }
    return cached;
  }

  /**
   * A file's preview and a note's editor show first (layout-v2.md, section 10), and a record
   * page beside them comes later: until then the View tab of a record with either, through its
   * type or through a facet, is today's, and the console says so once per type.
   */
  private ownViewFirst(type: string): Observable<null> {
    if (!this.ownView.has(type)) {
      this.ownView.add(type);
      warn(
        `${type}/view layout not drawn for a ${type} with a file or a note, which the View tab shows first; a record page beside it comes later`,
      );
    }
    return of(null);
  }

  private resolveRecord(
    definition: DocumentTypeDefinition,
    file: RecordLayoutFile,
    documentSchemas: readonly DocumentSchemaRef[],
  ): Observable<ResolvedRecordLayout> {
    const wanted = recordFacetSchemasToRead(definition, documentSchemas, file);
    const reads: Observable<readonly (DocumentTypeSchema | null)[]> = wanted.length
      ? forkJoin(wanted.map(({ name }) => this.schema(name)))
      : of([]);
    return reads.pipe(
      map((read) => {
        const facets = read.filter((schema): schema is DocumentTypeSchema => schema !== null);
        const unread = new Map(
          wanted.filter((_, i) => !read[i]).map((ref) => [ref.prefix, ref.name]),
        );
        const { layout, skipped, notes } = resolveRecordLayout(definition, file, facets);
        for (const field of skipped) warn(skippedMessage(definition.name, field, unread));
        for (const note of notes) warn(`${definition.name}/view layout: ${note}`);
        return layout;
      }),
    );
  }

  private recordFile(type: string): Observable<RecordLayoutFile | null> {
    let cached = this.recordFiles.get(type);
    if (!cached) {
      cached = this.index().pipe(
        switchMap((index) =>
          index.entries.some((entry) => entry.type === type && entry.mode === 'view')
            ? this.fetchRecordFile(type)
            : of(null),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.recordFiles.set(type, cached);
    }
    return cached;
  }

  /**
   * A `view` file is version 2: version 1 has no `view` mode. Rules are checked against this
   * build's registry here, once per session: the rules register before the first page shows.
   */
  private fetchRecordFile(type: string): Observable<RecordLayoutFile | null> {
    const url = layoutFileUrl(this.bootstrapUrl, type, 'view');
    return this.http.get<unknown>(url).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => {
        const envelope = readLayoutEnvelope(raw, type, 'view');
        if ('invalid' in envelope) {
          warn(`${type}/view layout from ${url} ignored: ${envelope.invalid}`);
          return null;
        }
        const file = readRecordLayout(envelope.content, this.rules.registeredRuleIds());
        if ('invalid' in file) {
          warn(
            `${type}/view layout from ${url} refused, showing the document page: ${file.invalid}`,
          );
          return null;
        }
        for (const problem of file.problems) warn(`${type}/view layout: ${problem}`);
        return file;
      }),
      catchError((error: unknown) => {
        warn(`${type}/view layout not loaded from ${url}: ${describe(error)}`);
        return of(null);
      }),
    );
  }

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
   *
   * An l10n value stores the path through the vocabulary, so the entry read is its leaf
   * (`leafOf`); the label is still composed from the stored path, which is what names the parent.
   */
  vocabularyLabel(directory: string, id: string): Observable<string | null> {
    const l10n = directoryUsesL10nLabel(directory);
    const entryId = l10n ? leafOf(id) : id;
    // `art/`: a path naming no entry, so there is nothing to read — and reading `` would ask the
    // directory for its whole first page.
    if (entryId === '') return of(null);
    return this.entry(directory, entryId).pipe(
      switchMap((entry) => {
        if (!entry) return of(null);
        if (!l10n) {
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
          catchError((error: unknown) => {
            // Not cached, so the next document showing this value asks again.
            this.entries.delete(key);
            warn(`vocabulary entry ${directory}/${id} not read: ${describe(error)}`);
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
