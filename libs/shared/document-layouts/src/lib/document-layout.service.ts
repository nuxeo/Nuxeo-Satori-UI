import { HttpBackend, HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import {
  EXTENSION_SLOTS,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
} from '@nuxeo/satori-platform/extensions';
import {
  L10nDirectoryEntry,
  NuxeoApiBase,
  type NuxeoDocument,
  type NuxeoTask,
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
  LayoutFieldType,
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
import { type FormLayoutFile, readFormLayout } from './form-layout/form-layout';
import {
  FORM_INPUTS_SHOWN_AS_VERSION_1,
  formFacetSchemasToRead,
  resolveFormLayout,
  type ResolvedFormLayout,
} from './form-layout/resolve-form-layout';
import {
  LINKED_RECORDS_PER_REQUEST,
  type LinkedRecord,
  isDocumentId,
  linkedRecordsQuery,
  readLinkedRecords,
} from './record-page/linked-record';
import { RecordLayoutFile, readRecordLayout } from './record-page/record-layout';
import {
  RecordPreview,
  ResolvedRecordLayout,
  SkippedRecordField,
  propertyDefinitions,
  recordFacetSchemasToRead,
  resolveRecordLayout,
} from './record-page/resolve-record-layout';

/** As for the bootstrap and manifest reads: `HttpClient` has no timeout of its own. */
export const LAYOUT_LOAD_TIMEOUT_MS = 10_000;

const EMPTY_INDEX: LayoutIndex = { entries: [], diagnostics: [], labelLanguages: [] };

/** The directory the configuration service answers from, taken from the bootstrap URL. */
function configDirectory(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return path.slice(0, path.lastIndexOf('/') + 1);
}

export function layoutsIndexUrl(bootstrapUrl: string): string {
  return `${configDirectory(bootstrapUrl)}layouts.json`;
}

/** A part of a task form's name, as `placeFile` in libs/shared/app-definition reads one. */
const TASK_FORM_PART = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

/** The `var:` fields a task form names, in its cards or its tabs' cards. */
function variableFieldsOf(file: FormLayoutFile): string[] {
  const cards = file.tabs ? file.tabs.flatMap((tab) => tab.cards) : file.cards;
  return cards
    .flatMap((card) => card.fields)
    .flatMap((field) =>
      field.kind === 'property' && field.xpath.startsWith('var:') ? [field.xpath] : [],
    );
}

/** A schema a workflow keeps variables in: a step's, `var_<step>`, or the workflow's own. */
const VARIABLE_SCHEMA = /^var_[A-Za-z0-9_-]+$/;

/**
 * Where a workflow step's task form is: `tasks/<workflow>.<step>.layout.json`, beside the layouts
 * (docs/business-apps/app-definition-v2.md, section 6).
 */
export function taskFormUrl(bootstrapUrl: string, workflow: string, step: string): string {
  return `${configDirectory(bootstrapUrl)}tasks/${encodeURIComponent(workflow)}.${encodeURIComponent(step)}.layout.json`;
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

/**
 * The schema of a record whose record page shows its own file first: a Picture's, whose views the
 * page draws above its cards. Its record holds a file too, so this is asked before
 * {@link OWN_VIEW_SCHEMAS}: a record with it has a record page, one without keeps its own view.
 */
const PICTURE_SCHEMA = 'picture';

/**
 * A video's schema. Nuxeo's `Video` facet declares `picture` as well as `video` (measured on Nuxeo
 * 2025: a Video's schemas are `file`, `video` and `picture`, among others), for its still frames,
 * so a record with it is not a picture: it keeps its own view, its player.
 */
const VIDEO_SCHEMA = 'video';

/** What {@link recordPreviewOf} answers for a record whose View tab shows its own file first. */
const OWN_VIEW = 'own-view';

/**
 * What a record page shows of the record's own file, from the type's schemas and the document's
 * own: a dynamic facet can add `file` or `note` to one record of a type that has neither, and its
 * preview shows first too. A record with the `picture` schema, and not a video's, shows its views
 * first; any other record with a file or a note keeps its own View tab.
 */
function recordPreviewOf(
  definition: DocumentTypeDefinition,
  documentSchemas: readonly DocumentSchemaRef[],
): RecordPreview | typeof OWN_VIEW {
  const names = new Set([...definition.schemas, ...documentSchemas].map((schema) => schema.name));
  if (names.has(PICTURE_SCHEMA) && !names.has(VIDEO_SCHEMA)) return 'picture';
  return [...names].some((name) => OWN_VIEW_SCHEMAS.has(name)) ? OWN_VIEW : null;
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The live records of one type, the last changed first: what {@link
 * DocumentLayoutService.previewRecords} asks for. Its one parameter is the type.
 */
export const PREVIEW_RECORDS_QUERY =
  'SELECT * FROM Document WHERE ecm:primaryType = ? AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0 ORDER BY dc:modified DESC';

/** A layout file `layouts.json` lists: its type and its mode, as the server serves them. */
export interface ServedLayout {
  readonly type: string;
  readonly mode: string;
}

/** A type's file for a mode as it is served, or why there is none to open. */
export type LayoutSource =
  | { readonly url: string; readonly content: Record<string, unknown>; readonly problem?: never }
  | { readonly url: string; readonly problem: string; readonly content?: never };

/**
 * The record page a `view` file draws for one record, or why it draws none. `notes` are what the
 * console would be told of the file: what the page leaves out, and why.
 */
export type RecordLayoutPreview = { readonly notes: readonly string[] } & (
  | { readonly layout: ResolvedRecordLayout; readonly refused?: never; readonly notDrawn?: never }
  | { readonly refused: string; readonly layout?: never; readonly notDrawn?: never }
  | { readonly notDrawn: string; readonly layout?: never; readonly refused?: never }
);

/**
 * The form an `edit` or `create` file draws, or why it draws none, as {@link RecordLayoutPreview}
 * says it of a record page.
 */
export type FormLayoutPreview = { readonly notes: readonly string[] } & (
  | { readonly layout: ResolvedFormLayout; readonly refused?: never; readonly notDrawn?: never }
  | { readonly refused: string; readonly layout?: never; readonly notDrawn?: never }
  | { readonly notDrawn: string; readonly layout?: never; readonly refused?: never }
);

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

/**
 * Why a version 2 page or form left a field out, as the console says it. `source` names the file,
 * `<Type>/<mode> layout` by default.
 */
function skippedMessage(
  type: string,
  field: SkippedRecordField,
  unread: ReadonlyMap<string, string>,
  mode = 'view',
  source = `${type}/${mode} layout`,
): string {
  if (field.reason === 'widget-type') {
    return `${source}: ${field.place} left out: the widget "${field.widget}" does not show ${field.xpath}, a ${field.type} property`;
  }
  if (field.xpath.startsWith('var:')) {
    return `${source}: ${field.place} left out: ${field.xpath} is not a variable of the step or its workflow`;
  }
  const schema = unread.get(prefixOfXpath(field.xpath));
  return schema
    ? `${source}: ${field.place} left out: ${field.xpath} is in schema ${schema}, which was not read`
    : `${source}: ${field.place} left out: ${field.xpath} is not on the ${type} type or this document's facets`;
}

/** A contributed file in force: version 1, in any mode, or version 2 in a form mode. */
type ContributedFile = LayoutFile | FormLayoutFile;

const isVersion2 = (file: ContributedFile | null): file is FormLayoutFile =>
  file !== null && 'version' in file && file.version === 2;

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
  /** Where a task form is read: the development server's address, then the app registry's. */
  private readonly definitionFiles = inject(APP_DEFINITION_FILES);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly slots = inject(ExtensionSlotRegistry);

  private index$: Observable<LayoutIndex> | null = null;
  private readonly files = new Map<string, Observable<ContributedFile | null>>();
  private readonly recordFiles = new Map<string, Observable<RecordLayoutFile | null>>();
  private readonly taskFiles = new Map<string, Observable<FormLayoutFile | null>>();
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
   *
   * A record with the `picture` schema, through its type or a facet, has its record page with its
   * views first (`preview: 'picture'`), unless it has the `video` schema too, as every Video does.
   * Any other record with a file or a note keeps its own view.
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
                const preview = recordPreviewOf(definition, documentSchemas);
                if (preview === OWN_VIEW) return this.ownViewFirst(type);
                return this.resolveRecord(definition, file, documentSchemas, preview).pipe(
                  map(({ layout, notes }) => {
                    for (const note of notes) warn(note);
                    return layout;
                  }),
                );
              }),
            )
          : of(null),
      ),
    );
  }

  /**
   * Every layout file the server serves, by type and mode, each once, in the order `layouts.json`
   * lists them: what the layout designer offers to open. Read anew on every call, never from the
   * session's cache, which keeps an index it could not read as an empty one. Errors when the index
   * cannot be read or is not one, so that the caller can tell that from a server serving none.
   */
  servedLayouts(): Observable<readonly ServedLayout[]> {
    return this.http.get<unknown>(layoutsIndexUrl(this.bootstrapUrl)).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => {
        const index = readLayoutIndex(raw);
        if ('invalid' in index) throw new Error(index.invalid);
        const seen = new Set<string>();
        return index.entries.flatMap(({ type, mode }): ServedLayout[] => {
          const key = `${type}/${mode}`;
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ type, mode }];
        });
      }),
    );
  }

  /**
   * A type's file for `mode` as it is served, its `content` unread: what the layout designer
   * opens. Read anew on every call, never from the session's cache, so the designer opens the file
   * the server answers now. `problem` says why there is none to open. Never errors.
   */
  layoutSource(type: string, mode: string): Observable<LayoutSource> {
    const url = layoutFileUrl(this.bootstrapUrl, type, mode);
    return this.http.get<unknown>(url).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw): LayoutSource => {
        const envelope = readLayoutEnvelope(raw, type, mode);
        return 'invalid' in envelope
          ? { url, problem: envelope.invalid }
          : { url, content: envelope.content };
      }),
      catchError((error: unknown) => of({ url, problem: describe(error) })),
    );
  }

  /**
   * Up to `pageSize` live records of `type`, the last changed first, with their Dublin Core
   * properties: those the layout designer offers to preview a record page or a form with. One search,
   * through the REST API as the reader, so only records they may read come back; versions,
   * proxies and trashed records are left out. The type is sent as a `queryParams` value, never in
   * the query's text ({@link PREVIEW_RECORDS_QUERY}). Not cached. Errors when the search fails,
   * so that the caller can say why.
   */
  previewRecords(type: string, pageSize: number): Observable<readonly NuxeoDocument[]> {
    const params = new HttpParams()
      .set('query', PREVIEW_RECORDS_QUERY)
      .set('pageSize', pageSize)
      .set('currentPageIndex', 0)
      .append('queryParams', type);
    return this.api
      .get<unknown>('/nuxeo/api/v1/search/lang/NXQL/execute', params, { properties: 'dublincore' })
      .pipe(
        timeout(LAYOUT_LOAD_TIMEOUT_MS),
        map((raw) => {
          const entries = isJsonObject(raw) ? raw['entries'] : undefined;
          return (Array.isArray(entries) ? entries : []).filter(
            (entry): entry is NuxeoDocument =>
              isJsonObject(entry) && typeof entry['uid'] === 'string' && entry['uid'] !== '',
          );
        }),
      );
  }

  /**
   * The record page `content`, a `view` file that need not be served, draws for `document`: what
   * the layout designer previews. It is read, held to the document's type and resolved exactly as
   * a served file is for the View tab. What the console would be told of the file is in `notes`,
   * and the console is not told it; a read of the type or a schema that fails is still told, as on
   * any page.
   *
   * The page it draws is the View tab's for the same rule context. Where the document page is not
   * open, nothing publishes its state about the record, such as whether it is locked or a favourite,
   * so a rule on that state answers as for a record with none of it.
   *
   * `refused` when the record page refuses the file, `notDrawn` when the page draws none for this
   * record: the type's schemas cannot be read, or the record has a file or a note, which its View
   * tab shows first. Nothing is cached for the file. Never errors.
   */
  previewRecordLayout(content: unknown, document: NuxeoDocument): Observable<RecordLayoutPreview> {
    const type = document.type;
    if (!isJsonObject(content)) {
      return of({ refused: 'a layout file is a JSON object', notes: [] });
    }
    const file = readRecordLayout(content, {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
    });
    if ('invalid' in file) return of({ refused: file.invalid, notes: [] });
    const problems = file.problems.map((problem) => `${type}/view layout: ${problem}`);
    const documentSchemas = readDocumentSchemas(
      'schemas' in document ? document.schemas : undefined,
    );
    return this.documentType(type).pipe(
      switchMap((definition): Observable<RecordLayoutPreview> => {
        if (!definition) {
          return of({ notDrawn: `the schemas of ${type} could not be read`, notes: problems });
        }
        const preview = recordPreviewOf(definition, documentSchemas);
        if (preview === OWN_VIEW) {
          return of({
            notDrawn: `a ${type} with a file or a note keeps its own View tab, which shows it first`,
            notes: problems,
          });
        }
        return this.resolveRecord(definition, file, documentSchemas, preview).pipe(
          map(({ layout, notes }) => ({ layout, notes: [...problems, ...notes] })),
        );
      }),
    );
  }

  /**
   * The form `content`, an `edit` or `create` file that need not be served, draws for a record of
   * `type`: what the layout designer previews. It is read and resolved exactly as a served file is
   * for the Edit and Create forms: against the type, and for an edit against the schemas the
   * edited `document`'s own read reports too, as `lib-document-layout-form` resolves one. What the
   * console would be told of the file is in `notes`, and the console is not told it; a read of the
   * type or a schema that fails is still told, as on any page.
   *
   * `refused` when the form refuses the file, and the generated form would show instead;
   * `notDrawn` when the type's schemas cannot be read. Nothing is cached for the file. Never errors.
   */
  previewFormLayout(
    content: unknown,
    mode: 'edit' | 'create',
    type: string,
    document: NuxeoDocument | null = null,
  ): Observable<FormLayoutPreview> {
    if (!isJsonObject(content)) {
      return of({ refused: 'a layout file is a JSON object', notes: [] });
    }
    const documentSchemas =
      mode === 'edit' && document
        ? readDocumentSchemas('schemas' in document ? document.schemas : undefined)
        : [];
    const file = readFormLayout(content, mode, { rules: this.rules.registeredRuleIds() });
    if ('invalid' in file) return of({ refused: file.invalid, notes: [] });
    const notes = formFileNotes(type, mode, file);
    return this.documentType(type).pipe(
      switchMap((definition): Observable<FormLayoutPreview> => {
        if (!definition) return of({ notDrawn: `the schemas of ${type} could not be read`, notes });
        return this.formResolution(definition, mode, file, documentSchemas).pipe(
          map((resolved) => ({ layout: resolved.layout, notes: [...notes, ...resolved.notes] })),
        );
      }),
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
   * What a list's row's properties are, so that its columns are shown as their types say: those
   * its type's schemas define, and those of the schemas its facets add that `xpaths` name. Read
   * once per type and schema, as the record page's are. `null` when the type cannot be read.
   * Never errors.
   */
  rowPropertiesOf(
    document: NuxeoDocument,
    xpaths: readonly string[],
  ): Observable<ReadonlyMap<string, LayoutFieldType> | null> {
    return this.documentType(document.type).pipe(
      switchMap((definition) => {
        if (!definition) return of(null);
        const own = new Set(definition.schemas.map((schema) => schema.name));
        const named = new Set(xpaths.map(prefixOfXpath));
        const wanted = readDocumentSchemas(
          'schemas' in document ? document.schemas : undefined,
        ).filter((schema) => !own.has(schema.name) && named.has(schema.prefix));
        const reads: Observable<readonly (DocumentTypeSchema | null)[]> = wanted.length
          ? forkJoin(wanted.map(({ name }) => this.schema(name)))
          : of([]);
        return reads.pipe(
          map((read) =>
            propertyDefinitions([
              ...definition.schemas,
              ...read.filter((schema): schema is DocumentTypeSchema => schema !== null),
            ]),
          ),
        );
      }),
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
   * The records with these ids that the reader may read, by id, each with its title and the app's
   * route to it: what a `document-link` shows (layout-v2.md, section 11). `null` when the search
   * fails, and the console says why. Never errors.
   *
   * One search, through the REST API as the reader, so Nuxeo returns only the records they may
   * read: one they may not, or that no longer exists, is absent, and shows as unavailable. Each id
   * is sent as a `queryParams` value of its own, never in the query's text
   * ({@link linkedRecordsQuery}), and only an id {@link isDocumentId} accepts is sent at all; the
   * others are left out of the search. No properties are asked for: the title, the type, the path
   * and the facets that the route needs come with every record. Not cached: `LinkedRecordLookup`
   * keeps what one page has read, for that page's life.
   */
  linkedRecords(ids: readonly string[]): Observable<ReadonlyMap<string, LinkedRecord> | null> {
    const asked = [...new Set(ids.filter(isDocumentId))];
    if (asked.length === 0) return of(new Map());
    if (asked.length > LINKED_RECORDS_PER_REQUEST) {
      warn(
        `${asked.length} linked records not read: one search asks for ${LINKED_RECORDS_PER_REQUEST} at most`,
      );
      return of(null);
    }
    let params = new HttpParams()
      .set('query', linkedRecordsQuery(asked.length))
      .set('pageSize', asked.length)
      .set('currentPageIndex', 0);
    for (const id of asked) params = params.append('queryParams', id);
    return this.api.get<unknown>('/nuxeo/api/v1/search/lang/NXQL/execute', params).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => readLinkedRecords(raw, asked)),
      catchError((error: unknown) => {
        warn(`${asked.length} linked records not read: ${describe(error)}`);
        return of(null);
      }),
    );
  }

  /**
   * A file's preview and a note's editor show first (layout-v2.md, section 10), and a record
   * page beside them comes later, but for a picture's: until then the View tab of a record with
   * either, through its type or through a facet, is today's, and the console says so once per type.
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

  /** The file resolved for a document, and what the console is to be told of it, each note whole. */
  private resolveRecord(
    definition: DocumentTypeDefinition,
    file: RecordLayoutFile,
    documentSchemas: readonly DocumentSchemaRef[],
    preview: RecordPreview,
  ): Observable<{ readonly layout: ResolvedRecordLayout; readonly notes: readonly string[] }> {
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
        const { layout, skipped, notes } = resolveRecordLayout(definition, file, facets, preview);
        return {
          layout,
          notes: [
            ...skipped.map((field) => skippedMessage(definition.name, field, unread)),
            ...notes.map((note) => `${definition.name}/view layout: ${note}`),
          ],
        };
      }),
    );
  }

  private recordFile(type: string): Observable<RecordLayoutFile | null> {
    let cached = this.recordFiles.get(type);
    if (!cached) {
      cached = this.layerFile(type, 'view').pipe(
        switchMap((layer) =>
          layer
            ? of(this.readRecordFile(type, layer.url, layer.content))
            : this.index().pipe(
                switchMap((index) =>
                  index.entries.some((entry) => entry.type === type && entry.mode === 'view')
                    ? this.fetchRecordFile(type)
                    : of(null),
                ),
              ),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.recordFiles.set(type, cached);
    }
    return cached;
  }

  /**
   * The app open's own version of a type's file, from its deployment layer, as the app registry
   * serves it to the app's groups after sign-in, with no envelope
   * (docs/business-apps/app-definition-v2.md, section 10, "The deployment layer"): `null` when the
   * app open has none, which costs no request, and when it cannot be read, which the console is
   * told. It wins over the file the packages contribute, which everyone reads before sign-in.
   */
  private layerFile(
    type: string,
    mode: 'view' | 'edit' | 'create',
  ): Observable<{ readonly url: string; readonly content: Record<string, unknown> } | null> {
    const path = `layouts/${type}/${mode}.layout.json`;
    return this.definitionFiles.file(path, null).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((content) => {
        if (typeof content === 'object' && content !== null && !Array.isArray(content))
          return {
            url: `the app's deployment layer, ${path}`,
            content: content as Record<string, unknown>,
          };
        warn(
          `${type}/${mode} layout from the app's deployment layer ignored: it is not a JSON object`,
        );
        return null;
      }),
      catchError((error: unknown) => {
        if (!(error instanceof HttpErrorResponse && error.status === 404))
          warn(
            `${type}/${mode} layout not loaded from the app's deployment layer, so the package's shows: ${describe(error)}`,
          );
        return of(null);
      }),
    );
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
        return this.readRecordFile(type, url, envelope.content);
      }),
      catchError((error: unknown) => {
        warn(`${type}/view layout not loaded from ${url}: ${describe(error)}`);
        return of(null);
      }),
    );
  }

  private readRecordFile(
    type: string,
    url: string,
    content: Record<string, unknown>,
  ): RecordLayoutFile | null {
    const file = readRecordLayout(content, {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
    });
    if ('invalid' in file) {
      warn(`${type}/view layout from ${url} refused, showing the document page: ${file.invalid}`);
      return null;
    }
    for (const problem of file.problems) warn(`${type}/view layout: ${problem}`);
    return file;
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
        definition
          ? this.resolve(definition, mode, isVersion2(file) ? null : file, documentSchemas)
          : of(null),
      ),
    );
  }

  /**
   * The edit or create form of a document type: its contributed file, of version 1 or 2, resolved
   * against the type and the document's own schemas, or the generated layout when it has none or
   * its file is refused. `null` when the type's schemas cannot be read. Never errors.
   *
   * A version 2 file is drawn by `lib-document-layout-form` as layout-v2.md says: cards, a widget
   * as each field's input, fields required or read-only by rule, and checks across fields.
   */
  formLayoutFor(
    type: string,
    mode: 'edit' | 'create',
    documentSchemas: readonly DocumentSchemaRef[] = [],
  ): Observable<ResolvedLayout | ResolvedFormLayout | null> {
    return combineLatest([this.documentType(type), this.contributed(type, mode)]).pipe(
      switchMap(([definition, file]): Observable<ResolvedLayout | ResolvedFormLayout | null> => {
        if (!definition) return of(null);
        if (!isVersion2(file)) return this.resolve(definition, mode, file, documentSchemas);
        return this.resolveForm(definition, mode, file, documentSchemas);
      }),
    );
  }

  /**
   * The task form of a task's workflow step, resolved against the record the task is on and the
   * step's variables (app-definition-v2.md, section 6). `null` when nothing is served for the step,
   * when its file is refused or cannot be read, when the record's type cannot be read, or when a
   * variable schema the file's `var:` fields need cannot be read: the task panel's own form shows
   * then, and a failed read is asked again for the next task. Never errors.
   *
   * The variables are the fields of the variable schemas the task names in `taskInfo.schemas`,
   * `var_<step>`, and of the workflow's own, `var_<workflow>`, which a task does not name: a field
   * `<name>` is the variable `var:<name>`. A `var:` field naming a variable that neither has is
   * left out, as a field its type lacks is. But when a schema could not be read and a `var:` field
   * then names nothing, no form is drawn: the field might be in it, and a form without it would let
   * the task complete unchecked. A workflow with no variables of its own has no schema to read, and
   * leaves nothing out.
   */
  taskFormFor(task: NuxeoTask, document: NuxeoDocument): Observable<ResolvedFormLayout | null> {
    const workflow = task.workflowModelName;
    const step = task.nodeName;
    if (!TASK_FORM_PART.test(workflow ?? '') || !TASK_FORM_PART.test(step ?? '')) return of(null);
    return this.taskFile(workflow, step).pipe(
      switchMap((file) =>
        file
          ? combineLatest([this.documentType(document.type), this.taskVariables(task)]).pipe(
              switchMap(([definition, { variables, unread }]) => {
                if (!definition) return of(null);
                // A form missing the fields its variables needed would guard nothing: the task's
                // own form shows instead, and the next task asks for the schemas again.
                const missing = variableFieldsOf(file).filter((xpath) => !variables.has(xpath));
                if (unread.length > 0 && missing.length > 0) {
                  warn(
                    `${workflow}.${step} task form not drawn, showing the task's own form: ${unread.join(', ')} could not be read, and ${missing.join(', ')} need it`,
                  );
                  return of(null);
                }
                return this.resolveForm(
                  definition,
                  'task',
                  file,
                  readDocumentSchemas('schemas' in document ? document.schemas : undefined),
                  variables,
                  `${workflow}.${step} task form`,
                );
              }),
            )
          : of(null),
      ),
    );
  }

  /**
   * The record a task is on, read with all its properties and the schemas it carries, for its task
   * form. `null` when it cannot be read. Never errors; read again for each task.
   */
  taskDocument(uid: string): Observable<NuxeoDocument | null> {
    return this.api
      .get<NuxeoDocument>(`/nuxeo/api/v1/id/${encodeURIComponent(uid)}`, undefined, {
        properties: '*',
      })
      .pipe(
        timeout(LAYOUT_LOAD_TIMEOUT_MS),
        catchError((error: unknown) => {
          warn(`document ${uid} not read for its task form: ${describe(error)}`);
          return of(null);
        }),
      );
  }

  /** The step's variables and the workflow's, by `var:<name>`: the schemas read once per session. */
  private taskVariables(task: NuxeoTask): Observable<{
    readonly variables: ReadonlyMap<string, LayoutFieldType>;
    /** The variable schemas that could not be read. */
    readonly unread: readonly string[];
  }> {
    const named = (task.taskInfo?.schemas ?? [])
      .map((schema) => schema?.name)
      .filter((name): name is string => typeof name === 'string' && VARIABLE_SCHEMA.test(name));
    const names = [...new Set([...named, `var_${task.workflowModelName}`])];
    return forkJoin(names.map((name) => this.schema(name))).pipe(
      map((schemas) => {
        const variables = new Map<string, LayoutFieldType>();
        for (const schema of schemas) {
          if (!schema) continue;
          for (const [name, definition] of Object.entries(schema.fields)) {
            // The step's own first, as `names` lists it: a step's variable hides a workflow's.
            if (!variables.has(`var:${name}`)) variables.set(`var:${name}`, definition);
          }
        }
        return { variables, unread: names.filter((_, index) => !schemas[index]) };
      }),
    );
  }

  /**
   * A step's task form, as the package writes it, with no envelope, as `home.json` is served:
   * read once per session, where the development server serves it and otherwise from the app
   * registry, for the app open (`APP_DEFINITION_FILES`). Nothing served, HTTP 404, is no form, and says nothing: most
   * steps have none. Any other failure, or a file refused, is said in the console, and a failed
   * read is asked again for the next task.
   */
  private taskFile(workflow: string, step: string): Observable<FormLayoutFile | null> {
    const key = `${workflow}.${step}`;
    let cached = this.taskFiles.get(key);
    if (!cached) {
      const url = taskFormUrl(this.bootstrapUrl, workflow, step);
      cached = this.definitionFiles.file(`tasks/${workflow}.${step}.layout.json`, url).pipe(
        timeout(LAYOUT_LOAD_TIMEOUT_MS),
        map((content) => {
          const isObject =
            typeof content === 'object' && content !== null && !Array.isArray(content);
          const file = isObject
            ? readFormLayout(content as Record<string, unknown>, 'task', {
                rules: this.rules.registeredRuleIds(),
              })
            : { invalid: 'a task form is a JSON object' };
          if ('invalid' in file) {
            warn(
              `${key} task form from ${url} refused, showing the task's own form: ${file.invalid}`,
            );
            return null;
          }
          for (const problem of file.problems) warn(`${key} task form: ${problem}`);
          return file;
        }),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) return of(null);
          this.taskFiles.delete(key);
          warn(`${key} task form not loaded from ${url}: ${describe(error)}`);
          return of(null);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.taskFiles.set(key, cached);
    }
    return cached;
  }

  /** A version 2 form file for one document: its facet schemas read, its fields held to them. */
  private resolveForm(
    definition: DocumentTypeDefinition,
    mode: 'edit' | 'create' | 'task',
    file: FormLayoutFile,
    documentSchemas: readonly DocumentSchemaRef[],
    variables: ReadonlyMap<string, LayoutFieldType> = new Map(),
    source?: string,
  ): Observable<ResolvedFormLayout> {
    return this.formResolution(definition, mode, file, documentSchemas, variables, source).pipe(
      map(({ layout, notes }) => {
        for (const note of notes) warn(note);
        return layout;
      }),
    );
  }

  /** {@link resolveForm}, with what the console is to be told of the fields it left out. */
  private formResolution(
    definition: DocumentTypeDefinition,
    mode: 'edit' | 'create' | 'task',
    file: FormLayoutFile,
    documentSchemas: readonly DocumentSchemaRef[],
    variables: ReadonlyMap<string, LayoutFieldType> = new Map(),
    source?: string,
  ): Observable<{ readonly layout: ResolvedFormLayout; readonly notes: readonly string[] }> {
    const wanted = formFacetSchemasToRead(definition, documentSchemas, file);
    const reads: Observable<readonly (DocumentTypeSchema | null)[]> = wanted.length
      ? forkJoin(wanted.map(({ name }) => this.schema(name)))
      : of([]);
    return reads.pipe(
      map((read) => {
        const facets = read.filter((schema): schema is DocumentTypeSchema => schema !== null);
        const unread = new Map(
          wanted.filter((_, i) => !read[i]).map((ref) => [ref.prefix, ref.name]),
        );
        const { layout, skipped } = resolveFormLayout(definition, file, facets, variables);
        return {
          layout,
          notes: skipped.map((field) =>
            skippedMessage(definition.name, field, unread, mode, source),
          ),
        };
      }),
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

  private contributed(type: string, mode: LayoutMode): Observable<ContributedFile | null> {
    const key = `${type}/${mode}`;
    let cached = this.files.get(key);
    if (!cached) {
      const packaged = this.index().pipe(
        switchMap((index) =>
          index.entries.some((entry) => entry.type === type && entry.mode === mode)
            ? this.fetchFile(type, mode)
            : of(null),
        ),
      );
      // A form of the app open's deployment layer wins over the packages'; it is version 2.
      cached = (
        mode === 'edit' || mode === 'create'
          ? this.layerFile(type, mode).pipe(
              switchMap((layer) =>
                layer ? of(this.formFile(type, mode, layer.url, layer.content)) : packaged,
              ),
            )
          : packaged
      ).pipe(shareReplay({ bufferSize: 1, refCount: false }));
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

  /**
   * A file of version 1, or in the edit and create modes of version 2 too. A `metadata` file of
   * version 2 is still refused, and the generated panel shows (layout-v2.md, section 11). Rules
   * are checked against this build's registry here, once per session, as for a `view` file.
   */
  private fetchFile(type: string, mode: LayoutMode): Observable<ContributedFile | null> {
    const url = layoutFileUrl(this.bootstrapUrl, type, mode);
    return this.http.get<unknown>(url).pipe(
      timeout(LAYOUT_LOAD_TIMEOUT_MS),
      map((raw) => {
        const envelope = readLayoutEnvelope(raw, type, mode);
        if ('invalid' in envelope) {
          warn(`${type}/${mode} layout from ${url} ignored: ${envelope.invalid}`);
          return null;
        }
        if (mode !== 'metadata' && envelope.content['version'] === 2)
          return this.formFile(type, mode, url, envelope.content);
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

  /** A version 2 edit or create file, read as the form draws it; `null`, and the generated form, when refused. */
  private formFile(
    type: string,
    mode: 'edit' | 'create',
    url: string,
    content: Record<string, unknown>,
  ): FormLayoutFile | null {
    const file = readFormLayout(content, mode, { rules: this.rules.registeredRuleIds() });
    if ('invalid' in file) {
      warn(
        `${type}/${mode} layout from ${url} refused, showing the generated form: ${file.invalid}`,
      );
      return null;
    }
    for (const note of formFileNotes(type, mode, file)) warn(note);
    return file;
  }
}

/**
 * What the console is told of a version 2 form file once it is read: each part it leaves out, and
 * each widget whose input this build draws otherwise.
 */
function formFileNotes(type: string, mode: string, file: FormLayoutFile): string[] {
  const notes = file.problems.map((problem) => `${type}/${mode} layout: ${problem}`);
  const cards = file.tabs ? file.tabs.flatMap((tab) => tab.cards) : file.cards;
  for (const field of cards.flatMap((card) => card.fields)) {
    // A computed field is never edited, so only a property's input can differ.
    const instead =
      field.kind === 'property' &&
      field.widget !== null &&
      Object.hasOwn(FORM_INPUTS_SHOWN_AS_VERSION_1, field.widget)
        ? FORM_INPUTS_SHOWN_AS_VERSION_1[field.widget]
        : undefined;
    if (instead)
      notes.push(
        `${type}/${mode} layout: ${field.place}: the widget "${field.widget}" is edited as ${instead} in this build`,
      );
  }
  return notes;
}
