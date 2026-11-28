#!/usr/bin/env node
/**
 * A demo kit's pages in dev mode, with no server holding the kit: a stand-in for the parts of a
 * Nuxeo server the kit adds, in front of the real one.
 *
 *   npm run kit:stand-in -- business-apps/packages/vehicle-titles-demo
 *   npm run kit:stand-in -- <kit folder> [--port 8091] [--upstream http://localhost:8080]
 *   npm run kit:stand-in -- <kit folder> --check     # what it would answer, as JSON; serves nothing
 *
 * Then point the dev server at it, with the `remote` proxy configuration, and serve the kit's files
 * as step 4 of the app builder skill does (`preview_package`, or `npm run config:dev`):
 *
 *   NUXEO_PROXY_TARGET=http://localhost:8091 npx ng serve nuxeo-ui --configuration=development,remote
 *
 * **Why.** `config:dev` serves a kit's layouts, home, menu, queues and labels, but the pages draw
 * what the server holds, and no server holds a demo kit's stand-in model or records until the
 * package is installed and seeded. So the home's figures said "Unavailable", each queue "Something
 * went wrong", and no record page could be opened. This answers those reads from the kit's own
 * files, so its pages can be seen before any server has it.
 *
 * **What it answers itself,** from the kit's files only, never from a server:
 *
 * - **the kit's types and schemas,** from `<kit>/content-model.json`: merged into the upstream's
 *   `/api/v1/config/types`, `/config/schemas` and `/config/facets`, the upstream's own winning for
 *   a schema or facet both have, the kit's winning for its types; and at `/config/types/<Type>`
 *   for each of its types, and `/config/schemas/<name>` and `/config/facets/<name>` where the
 *   upstream has none;
 * - **the kit's fictional records,** from `<kit>/demo/data.mjs`, as its seed would write them
 *   (`scripts/kit-stand-in/kits.mjs`), under the seed's workspace and folders, with ids made up
 *   and stable: the same kit and record give the same id on every run and every machine. By id
 *   (`/api/v1/id/<id>`) and by path, and by id through the NXQL search a record page reads linked
 *   records with, `SELECT * FROM Document WHERE ecm:uuid IN (?, ...)`, the other ids of a mixed
 *   search asked of the upstream. Dates are counted from the day it starts, as the seed counts
 *   them from the day it runs;
 * - **read-only:** each record's `permissions` are Read's and nothing more, so no Edit, tick or
 *   capture is offered; and any write naming a stand-in record, in its address or its body, is
 *   refused, HTTP 403, with nothing sent on; an operation that reads one, by Nuxeo's naming
 *   (`Connector.Read`, `Document.GetVersions`), is not run, HTTP 501. Its audit, comments, tasks,
 *   workflows and the other lists under `/id/<id>/@...` are empty; it has no file, so a file or
 *   rendition is 404;
 * - **the kit's page providers,** those its `bundle/OSGI-INF/*.xml` defines, from `data.mjs`'s
 *   `EXPECTED`, which records each returns, worked out from the data: no NXQL is evaluated. A page
 *   provider that takes a parameter is answered by the record given. The order is `EXPECTED`'s, or
 *   the request's `sortBy`; the facets are counted over the records, by each terms aggregate the
 *   XML defines; and pages are cut as Nuxeo cuts them. **A provider of the kit's that `EXPECTED`
 *   does not list is answered HTTP 501,** saying so: its page shows its error, honestly.
 *
 * **What it forwards,** everything else, to `--upstream`, the real Nuxeo, default
 * `http://localhost:8080`: sign-in, `/me`, the platform's own documents, searches and
 * configuration. The person signs in to that server with their own account, as with the dev
 * server alone. What it changes on the way is what the dev server's own proxy changes, and no
 * more: the `Host` header, an `Origin` naming the stand-in, and a redirect's `Location` naming the
 * upstream. **Credentials and cookies are never read, logged, stored or changed:** `Authorization`,
 * `Cookie` and `Set-Cookie` pass as they came. A write's body is read, to find a stand-in record's
 * id in it, only on the REST API and automation addresses; a sign-in form's is not.
 *
 * **What it does not show:** a record's file, history, comments or workflows; anything a write
 * would change; a provider `EXPECTED` does not list; an `external` card, whose connector is the
 * server's; the people the records name, who are user names only; the server's own permissions on the kit's
 * records (every stand-in record may be read by whoever reaches it, on this machine); and nothing
 * of a package installed: the registry's `app.json`, its groups, its actions. Seeing a page is not
 * a security control, here or on a server.
 *
 * It listens on 127.0.0.1 only. It logs the method and path of each request it answers itself,
 * never a query string, a header or a body; `--verbose` adds those it forwards, the same way.
 * Node 24 and nothing else: no install, no dependency.
 *
 * Exit codes: 0, stopped (Ctrl+C) or checked; 2, a precondition: no kit folder, a kit this does
 * not read (`scripts/kit-stand-in/kits.mjs` lists those it does), files missing or not as the
 * kit's seed reads them, a bad option, or the port taken.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import { KITS } from './kit-stand-in/kits.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const EXIT_PRECONDITION = 2;
const DEFAULT_PORT = 8091;
const DEFAULT_UPSTREAM = 'http://localhost:8080';
/** Nuxeo reads a page size of 0 as every record; a request may ask for this many at most. */
const MAX_PAGE_SIZE = 1000;
const DEFAULT_TERMS_SIZE = 10;
/** The NXQL search errors quote this much of the query. */
const QUOTED_QUERY = 200;

/** A precondition the kit or the command line does not meet: fix it, not the script. */
export class Precondition extends Error {}

/** The permissions of Nuxeo's `Read`, as the `permissions` enricher lists them: no Write. */
export const READ_ONLY_PERMISSIONS = Object.freeze([
  'Read',
  'Browse',
  'ReadProperties',
  'ReadChildren',
  'ReadLifeCycle',
  'ReadVersion',
]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * A stable made-up id: a version 5 UUID of `name`, in a namespace of the stand-in's own, so that
 * nothing here looks like an id a server made.
 */
export function standInId(name) {
  const namespace = createHash('sha1').update('nuxeo-satori kit stand-in').digest().subarray(0, 16);
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `days` from `today`, as a date property stores a day: `YYYY-MM-DD`, in UTC. */
function dayFrom(days, today) {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** `xml` without its comments, so that an element named in a comment is not read as one. */
function withoutComments(xml) {
  let text = '';
  let at = 0;
  for (let open = xml.indexOf('<!--', at); open !== -1; open = xml.indexOf('<!--', at)) {
    text += xml.slice(at, open);
    const close = xml.indexOf('-->', open + 4);
    at = close === -1 ? xml.length : close + 3;
  }
  return text + xml.slice(at);
}

const attribute = (attributes, name) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;

/** The page providers the kit's bundle defines, by name, with their aggregates and page sizes. */
export function readPageProviders(bundle) {
  const folder = join(bundle, 'OSGI-INF');
  const providers = new Map();
  if (!existsSync(folder)) return providers;
  for (const file of readdirSync(folder)
    .filter((name) => name.endsWith('.xml'))
    .sort()) {
    const xml = withoutComments(readFileSync(join(folder, file), 'utf8'));
    const element = /<(coreQueryPageProvider|genericPageProvider)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    for (const [, kind, attributes, body] of xml.matchAll(element)) {
      const name = attribute(attributes, 'name');
      if (!name) continue;
      const aggregates = [];
      const aggregate = /<aggregate\b([^>]*?)(?:\/>|>([\s\S]*?)<\/aggregate>)/g;
      for (const [, own, inner = ''] of body.matchAll(aggregate)) {
        const size = /<property\s+name="size">\s*(\d+)\s*<\/property>/.exec(inner)?.[1];
        aggregates.push({
          id: attribute(own, 'id'),
          type: attribute(own, 'type'),
          field: attribute(own, 'parameter'),
          size: size === undefined ? DEFAULT_TERMS_SIZE : Number(size),
        });
      }
      const pageSize = Number(/<pageSize>\s*(\d+)\s*<\/pageSize>/.exec(body)?.[1] ?? 0);
      providers.set(name, { name, kind, file, aggregates, pageSize });
    }
  }
  return providers;
}

/** A schema's property prefix: its own, or its name where it has none, as Nuxeo addresses it. */
const prefixOf = (schema) => schema.prefix || schema['@prefix'] || schema.name;

const isList = (type) =>
  typeof type === 'string' ? type.endsWith('[]') : String(type?.type ?? '').endsWith('[]');

/**
 * Reads a kit: its model, its records as documents, and its page providers. Refused, as a
 * {@link Precondition}, when the folder is not a kit this reads, or its files are not as its seed
 * reads them.
 */
export async function loadKit(folder, { today = new Date() } = {}) {
  const directory = resolve(folder);
  const name = basename(directory);
  const fromRoot = relative(ROOT, directory);
  const shown = fromRoot === '' || fromRoot.startsWith('..') ? directory : fromRoot;
  const reader = KITS[name];
  if (!reader) {
    throw new Precondition(
      `${shown}: the stand-in reads only the kits whose demo/data.mjs it knows the shape of: ` +
        `${Object.keys(KITS).join(', ')}. Each kit's records are in its own words, and ` +
        'scripts/kit-stand-in/kits.mjs says how its seed writes them.',
    );
  }
  for (const file of ['content-model.json', join('demo', 'data.mjs'), 'bundle']) {
    if (!existsSync(join(directory, file)))
      throw new Precondition(`${shown}/${file} does not exist, and the stand-in reads it.`);
  }
  const model = JSON.parse(readFileSync(join(directory, 'content-model.json'), 'utf8'));
  if (!model || typeof model.doctypes !== 'object' || !Array.isArray(model.schemas))
    throw new Precondition(`${shown}/content-model.json has no doctypes or no schemas.`);
  const data = await import(pathToFileURL(join(directory, 'demo', 'data.mjs')).href);
  if (!data.EXPECTED || typeof data.EXPECTED !== 'object')
    throw new Precondition(
      `${shown}/demo/data.mjs exports no EXPECTED, and the stand-in answers page providers from it.`,
    );
  if (!data.WORKSPACE?.name)
    throw new Precondition(`${shown}/demo/data.mjs exports no WORKSPACE with a name.`);

  const schemas = new Map(model.schemas.map((schema) => [schema.name, schema]));
  const facets = new Map((model.facets ?? []).map((facet) => [facet.name, facet]));
  const schemasOfType = (type) => {
    const definition = model.doctypes[type];
    const names = [...(definition.schemas ?? [])];
    for (const facet of definition.facets ?? [])
      for (const schema of facets.get(facet)?.schemas ?? []) names.push(schema.name);
    return [...new Set(names)].map((schemaName) => {
      const schema =
        schemas.get(schemaName) ??
        [...facets.values()]
          .flatMap((facet) => facet.schemas ?? [])
          .find((each) => each.name === schemaName);
      if (!schema)
        throw new Precondition(
          `${shown}/content-model.json: ${type} names a schema ${schemaName} it does not define.`,
        );
      return schema;
    });
  };

  const modified = today.toISOString();
  const day = (days) =>
    days === undefined || days === null ? null : (data.dayFrom ?? dayFrom)(days, today);
  const linked = new Set();
  const id = (key) => {
    linked.add(key);
    return standInId(`${name}/record/${key}`);
  };
  const rows = reader.records(data, { id, day, today });

  const workspacePath = `/default-domain/workspaces/${data.WORKSPACE.name}`;
  const documents = [];
  const workspace = {
    id: standInId(`${name}/workspace`),
    key: null,
    type: 'Workspace',
    path: workspacePath,
    parentId: null,
    title: data.WORKSPACE.title ?? data.WORKSPACE.name,
    facets: ['Folderish', 'SuperSpace'],
    schemas: [],
    properties: { 'dc:title': data.WORKSPACE.title ?? data.WORKSPACE.name },
    folderish: true,
    modified,
  };
  documents.push(workspace);
  const folders = new Map();
  for (const [folderKey, value] of Object.entries(reader.folders(data))) {
    const folderDocument = {
      id: standInId(`${name}/folder/${folderKey}`),
      key: null,
      type: 'Folder',
      path: `${workspacePath}/${value.name}`,
      parentId: workspace.id,
      title: value.title ?? value.name,
      facets: ['Folderish'],
      schemas: [],
      properties: { 'dc:title': value.title ?? value.name },
      folderish: true,
      modified,
    };
    folders.set(folderKey, folderDocument);
    documents.push(folderDocument);
  }

  const byKey = new Map();
  for (const row of rows) {
    if (!model.doctypes[row.type])
      throw new Precondition(`${shown}/content-model.json has no type ${row.type}.`);
    if (byKey.has(row.key))
      throw new Precondition(`${shown}/demo/data.mjs: two records are both ${row.key}.`);
    const holder = folders.get(row.folder);
    if (!holder) throw new Precondition(`${shown}: ${row.key} is in no folder of the kit's.`);
    const typeSchemas = schemasOfType(row.type);
    const properties = {};
    for (const schema of typeSchemas) {
      for (const [field, type] of Object.entries(schema.fields ?? {}))
        properties[`${prefixOf(schema)}:${field}`] = isList(type) ? [] : null;
    }
    for (const [property, value] of Object.entries(row.properties)) {
      if (!Object.hasOwn(properties, property))
        throw new Precondition(
          `${shown}: the stand-in writes ${property} on ${row.type} ${row.key}, and ` +
            `content-model.json gives ${row.type} no such property. ` +
            'scripts/kit-stand-in/kits.mjs and the kit have parted.',
        );
      properties[property] = value === undefined ? null : value;
    }
    properties['dc:created'] = modified;
    properties['dc:modified'] = modified;
    const document = {
      id: standInId(`${name}/record/${row.key}`),
      key: row.key,
      type: row.type,
      path: `${holder.path}/${row.name}`,
      parentId: holder.id,
      title: properties['dc:title'] ?? row.key,
      facets: [...(model.doctypes[row.type].facets ?? [])],
      schemas: typeSchemas.map((schema) => ({
        name: schema.name,
        prefix: schema.prefix || schema['@prefix'] || '',
      })),
      properties,
      folderish: false,
      modified,
    };
    byKey.set(row.key, document);
    documents.push(document);
  }
  for (const key of linked) {
    if (!byKey.has(key))
      throw new Precondition(`${shown}/demo/data.mjs links to ${key}, which it does not hold.`);
  }

  const providers = readPageProviders(join(directory, 'bundle'));
  for (const [provider, expected] of Object.entries(data.EXPECTED)) {
    const lists = Array.isArray(expected) ? [expected] : Object.values(expected ?? {});
    for (const list of lists)
      for (const key of list)
        if (!byKey.has(key))
          throw new Precondition(
            `${shown}/demo/data.mjs: EXPECTED.${provider} lists ${key}, which it does not hold.`,
          );
  }

  return {
    name,
    directory,
    shown,
    model,
    documents,
    byId: new Map(documents.map((document) => [document.id, document])),
    byPath: new Map(documents.map((document) => [document.path, document])),
    byKey,
    providers,
    expected: data.EXPECTED,
    answered: [...providers.keys()].filter((provider) => Object.hasOwn(data.EXPECTED, provider)),
    notAnswered: [...providers.keys()].filter(
      (provider) => !Object.hasOwn(data.EXPECTED, provider),
    ),
  };
}

/** What `--check` prints, and the start-up lines say: what the stand-in answers for the kit. */
export function summary(kit) {
  const types = Object.keys(kit.model.doctypes);
  const records = {};
  for (const document of kit.byKey.values())
    (records[document.type] ??= []).push({ key: document.key, id: document.id });
  return {
    kit: kit.name,
    types,
    records,
    pageProviders: { answered: kit.answered, notAnswered: kit.notAnswered },
  };
}

// ---------------------------------------------------------------------------------------------
// Answers

const exception = (status, message) => ({ 'entity-type': 'exception', status, message });

function pageOf(entityType, all, { pageSize, pageIndex = 0, offset = null }) {
  const size = pageSize > 0 ? Math.min(pageSize, MAX_PAGE_SIZE) : 0;
  const start = offset ?? (size > 0 ? pageIndex * size : 0);
  const entries = size > 0 ? all.slice(start, start + size) : all.slice(start);
  const index = size > 0 ? Math.floor(start / size) : 0;
  const pages = size > 0 ? Math.max(1, Math.ceil(all.length / size)) : 1;
  return {
    'entity-type': entityType,
    isPaginable: true,
    resultsCount: all.length,
    pageSize: size,
    maxPageSize: MAX_PAGE_SIZE,
    resultsCountLimit: 0,
    currentPageSize: entries.length,
    currentPageIndex: index,
    currentPageOffset: start,
    numberOfPages: pages,
    isPreviousPageAvailable: index > 0,
    isNextPageAvailable: start + entries.length < all.length,
    isLastPageAvailable: index < pages - 1,
    isSortable: true,
    hasError: false,
    errorMessage: null,
    totalSize: all.length,
    pageIndex: index,
    pageCount: pages,
    entries,
  };
}

/** The values a request names for a rendering parameter, by header and by query, joined. */
function rendering(req, url, names) {
  const values = [];
  for (const name of names) {
    const header = req.headers[name.toLowerCase()];
    for (const value of [header ?? []].flat()) values.push(...String(value).split(','));
    for (const value of url.searchParams.getAll(name)) values.push(...value.split(','));
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

const PROPERTIES = ['properties', 'X-NXproperties', 'X-NXDocumentProperties'];
const ENRICHERS = ['enrichers.document', 'enrichers-document', 'X-NXenrichers.document'];

/** The context a document is written in: which schemas, which enrichers. */
function contextOf(req, url) {
  const asked = rendering(req, url, PROPERTIES);
  return {
    schemas: asked.length === 0 || asked.includes('*') ? null : new Set(asked),
    enrichers: new Set(rendering(req, url, ENRICHERS)),
  };
}

/** What each enricher the app asks for says of a stand-in record: read-only, with nothing on it. */
function enrichment(kit, document, enrichers) {
  const empty = {
    acls: [],
    userVisiblePermissions: [],
    favorites: { isFavorite: false },
    subscribedNotifications: [],
    collections: [],
    renditions: [],
    allowedTransitions: [],
    runnableWorkflows: [],
    pendingTasks: [],
    hasFolderishChild: false,
    hasContent: false,
    subtypes: [],
    tags: [],
  };
  const context = {};
  for (const enricher of enrichers) {
    if (enricher === 'permissions') context.permissions = [...READ_ONLY_PERMISSIONS];
    else if (enricher === 'breadcrumb') {
      const chain = [];
      for (let at = document; at; at = at.parentId ? kit.byId.get(at.parentId) : null)
        chain.unshift(at);
      context.breadcrumb = {
        'entity-type': 'documents',
        entries: chain.map((each) =>
          documentEntity(kit, each, { schemas: new Set(), enrichers: new Set() }),
        ),
      };
    } else if (Object.hasOwn(empty, enricher)) context[enricher] = structuredClone(empty[enricher]);
  }
  return context;
}

/** A stand-in document as Nuxeo's REST API writes one. */
function documentEntity(kit, document, context) {
  const properties = {};
  const wanted = (schema) => context.schemas === null || context.schemas.has(schema.name);
  if (document.folderish) {
    if (context.schemas === null || context.schemas.has('dublincore'))
      Object.assign(properties, document.properties);
  } else {
    const prefixes = new Set(
      document.schemas.filter(wanted).map((schema) => schema.prefix || schema.name),
    );
    for (const [property, value] of Object.entries(document.properties))
      if (prefixes.has(property.slice(0, property.indexOf(':'))))
        properties[property] = structuredClone(value);
  }
  const entity = {
    'entity-type': 'document',
    repository: 'default',
    uid: document.id,
    path: document.path,
    type: document.type,
    state: 'project',
    parentRef: document.parentId,
    isCheckedOut: true,
    isRecord: false,
    retainUntil: null,
    hasLegalHold: false,
    isUnderRetentionOrLegalHold: false,
    isVersion: false,
    isProxy: false,
    changeToken: '0-0',
    isTrashed: false,
    title: document.title,
    lastModified: document.modified,
    properties,
    facets: [...document.facets],
    schemas: document.schemas.map((schema) => ({ ...schema })),
  };
  const enriched = enrichment(kit, document, context.enrichers);
  if (Object.keys(enriched).length > 0) entity.contextParameters = enriched;
  return entity;
}

/** The empty list a per-document adapter answers for a stand-in record, by its entity type. */
const ADAPTER_LISTS = {
  '@audit': 'logEntries',
  '@comment': 'comments',
  '@annotation': 'annotations',
  '@workflow': 'workflows',
  '@task': 'tasks',
  '@children': 'documents',
  '@search': 'documents',
  '@pp': 'documents',
};
/** The adapters that serve a file: a stand-in record has none. */
const FILE_ADAPTERS = new Set([
  '@blob',
  '@rendition',
  '@preview',
  '@convert',
  '@export',
  '@picture',
]);

const numberOf = (value, fallback) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isInteger(number) && number >= 0
    ? number
    : fallback;
};

function pagingOf(url, defaultSize) {
  const offset = url.searchParams.get('offset');
  return {
    pageSize: numberOf(url.searchParams.get('pageSize'), defaultSize),
    pageIndex: numberOf(url.searchParams.get('currentPageIndex'), 0),
    offset: offset === null ? null : numberOf(offset, null),
  };
}

/** One stand-in document's address and its adapters: `<id>`, `<id>/@children`, and so on. */
function documentAnswer(kit, document, rest, req, url) {
  const context = contextOf(req, url);
  if (rest === '' || rest === '/')
    return { status: 200, json: documentEntity(kit, document, context) };
  const adapter = /^\/(@[A-Za-z]+)/.exec(rest)?.[1] ?? null;
  if (adapter === null) return null;
  if (FILE_ADAPTERS.has(adapter))
    return {
      status: 404,
      json: exception(
        404,
        `${document.type} ${document.key ?? document.title} is a stand-in record of the ${kit.name} kit, and has no file.`,
      ),
    };
  if (adapter === '@acl') return { status: 200, json: { 'entity-type': 'acls', acl: [] } };
  const children =
    adapter === '@children' && document.folderish
      ? kit.documents
          .filter((each) => each.parentId === document.id)
          .map((each) => documentEntity(kit, each, context))
      : [];
  return {
    status: 200,
    json: pageOf(ADAPTER_LISTS[adapter] ?? 'documents', children, pagingOf(url, 0)),
  };
}

const BY_IDS =
  /^\s*SELECT\s+\*\s+FROM\s+Document\s+WHERE\s+ecm:uuid\s+(?:IN\s*\(([^)]*)\)|=\s*(\?|'[^']*'))\s*$/i;

/**
 * The ids an NXQL search reads records by, in order, or `null` when it is not such a search:
 * `SELECT * FROM Document WHERE ecm:uuid IN (?, ...)`, each a parameter or a quoted id.
 */
function idsOfQuery(query, parameters) {
  const match = BY_IDS.exec(query);
  if (!match) return null;
  const items = (match[1] ?? match[2]).split(',').map((item) => item.trim());
  let next = 0;
  const ids = [];
  for (const item of items) {
    if (item === '?') {
      if (next >= parameters.length) return null;
      ids.push(parameters[next++]);
    } else if (/^'[^']*'$/.test(item)) ids.push(item.slice(1, -1));
    else return null;
  }
  return next === parameters.length ? ids : null;
}

/** Compares two property values as a sort does: nothing last, numbers as numbers. */
function compare(a, b) {
  const none = (value) => value === null || value === undefined || value === '';
  if (none(a) || none(b)) return none(a) === none(b) ? 0 : none(a) ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A terms aggregate's value or values on a record. */
const valuesOf = (document, field) => {
  const value = document.properties[field];
  return (Array.isArray(value) ? value : [value]).filter(
    (each) => each !== null && each !== undefined && each !== '',
  );
};

function chosenOf(url, aggregate) {
  const raw = url.searchParams.get(aggregate.id);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [raw];
  }
}

/** A page provider of the kit's, answered from `EXPECTED`, or refused when it does not list it. */
function pageProviderAnswer(kit, provider, req, url) {
  if (!Object.hasOwn(kit.expected, provider.name)) {
    return {
      status: 501,
      json: exception(
        501,
        `The kit stand-in cannot answer the page provider ${provider.name}: ` +
          `${kit.shown}/demo/data.mjs's EXPECTED does not say which records it returns, and the ` +
          'stand-in evaluates no NXQL. It is answered on a server with the package installed.',
      ),
    };
  }
  const expected = kit.expected[provider.name];
  let keys;
  if (Array.isArray(expected)) keys = expected;
  else {
    const parameter = url.searchParams.getAll('queryParams')[0] ?? '';
    const key = kit.byId.get(parameter.toLowerCase())?.key ?? parameter;
    keys = Object.hasOwn(expected, key) ? expected[key] : [];
  }
  let records = keys.map((key) => kit.byKey.get(key));

  const terms = provider.aggregates.filter(
    (aggregate) => aggregate.id && aggregate.field && /terms$/.test(aggregate.type ?? ''),
  );
  const chosen = new Map(terms.map((aggregate) => [aggregate.id, chosenOf(url, aggregate)]));
  const keeps = (document, except) =>
    terms.every((aggregate) => {
      const keys = chosen.get(aggregate.id);
      return (
        aggregate.id === except ||
        keys.length === 0 ||
        valuesOf(document, aggregate.field).some((value) => keys.includes(String(value)))
      );
    });
  let aggregations;
  if (provider.aggregates.length > 0) {
    aggregations = {};
    for (const aggregate of terms) {
      const counts = new Map();
      for (const document of records.filter((each) => keeps(each, aggregate.id)))
        for (const value of valuesOf(document, aggregate.field))
          counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      const buckets = [...counts]
        .sort(([a, x], [b, y]) => y - x || compare(a, b))
        .slice(0, aggregate.size)
        .map(([key, docCount]) => ({ key, docCount }));
      const selection = chosen.get(aggregate.id);
      const extended = [
        ...buckets,
        ...selection
          .filter((key) => !buckets.some((bucket) => bucket.key === key))
          .map((key) => ({ key, docCount: 0 })),
      ];
      aggregations[aggregate.id] = {
        'entity-type': 'aggregate',
        id: aggregate.id,
        field: aggregate.field,
        properties: { size: String(aggregate.size) },
        ranges: [],
        dateRanges: [],
        selection,
        type: aggregate.type,
        buckets,
        extendedBuckets: extended,
      };
    }
  }
  records = records.filter((document) => keeps(document, null));

  const fields = (url.searchParams.get('sortBy') ?? '').split(',').filter(Boolean);
  if (fields.length > 0) {
    const orders = (url.searchParams.get('sortOrder') ?? '').split(',');
    records = records
      .map((document, at) => ({ document, at }))
      .sort((a, b) => {
        for (let i = 0; i < fields.length; i++) {
          const order = (orders[i] ?? orders[0] ?? 'asc').trim().toLowerCase() === 'desc' ? -1 : 1;
          const by = compare(a.document.properties[fields[i]], b.document.properties[fields[i]]);
          if (by !== 0) return by * order;
        }
        return a.at - b.at;
      })
      .map(({ document }) => document);
  }

  const context = contextOf(req, url);
  const page = pageOf(
    'documents',
    records.map((document) => documentEntity(kit, document, context)),
    pagingOf(url, provider.pageSize),
  );
  if (aggregations) page.aggregations = aggregations;
  return { status: 200, json: page };
}

// ---------------------------------------------------------------------------------------------
// The server

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);

/** The REST API path after `/api/v1`, with any `/repo/<name>`, or `null` for another address. */
function apiPathOf(pathname) {
  const match = /^\/nuxeo\/(?:site\/)?api\/v1(?:\/repo\/[^/]+)?(\/.*)?$/.exec(pathname);
  return match ? (match[1] ?? '/') : null;
}

/**
 * Whether a write's body is read for a stand-in id: the REST API's and automation's only, never a
 * file sent to the batch upload, `/api/v1/upload/`, which is a file's bytes, names no record, and
 * would otherwise be held whole in memory. The call that attaches it names its record, and is read.
 */
const inspectsBody = (pathname) => {
  const api = apiPathOf(pathname);
  if (api !== null) return !/^\/upload(?:\/|$)/.test(api);
  return /^\/nuxeo\/(?:site\/)?automation(?:\/|$)/.test(pathname);
};

function decodeSafely(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The stand-in records named in `text`, by id. */
function standInsIn(kit, text) {
  const found = new Map();
  for (const match of text.matchAll(UUID)) {
    const document = kit.byId.get(match[0].toLowerCase());
    if (document) found.set(document.id, document);
  }
  return [...found.values()];
}

/** The automation operation an address runs, `/automation/<op>` or `/@op/<op>`, or `null`. */
function operationOf(pathname) {
  return /\/(?:automation|@op)\/([A-Za-z][\w.-]*)\/?$/.exec(pathname)?.[1] ?? null;
}

/**
 * An operation that reads, by Nuxeo's naming (`Connector.Read`, `Document.GetVersions`,
 * `Repository.Query`): one naming a stand-in record is not answered, rather than refused as a
 * write.
 */
const READ_OPERATION =
  /^(?:[A-Za-z]+\.)?(?:Read|Get[A-Za-z]*|Query[A-Za-z]*|Fetch[A-Za-z]*|Suggest[A-Za-z]*|PageProvider|Search[A-Za-z]*)$/;

const nameOfDocument = (document) =>
  document.key === null ? `${document.type} ${document.path}` : `${document.type} ${document.key}`;

/**
 * Starts nothing: returns the server, to be listened on. `upstream` is the real Nuxeo's origin.
 * `log` receives one line per request answered here, and, with `verbose`, per request forwarded:
 * the method, the path and the status, never a query, a header or a body.
 */
export function createStandIn(
  kit,
  { upstream = DEFAULT_UPSTREAM, log = () => undefined, verbose = false } = {},
) {
  const target = new URL(upstream);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;

  /** The request's headers as the upstream gets them: what the dev server's proxy would change. */
  function upstreamHeaders(req, length) {
    const headers = {};
    const dropped = new Set(HOP_BY_HOP);
    for (const name of String(req.headers.connection ?? '').split(','))
      if (name.trim()) dropped.add(name.trim().toLowerCase());
    for (const [name, value] of Object.entries(req.headers))
      if (!dropped.has(name)) headers[name] = value;
    headers.host = target.host;
    if (req.headers.origin !== undefined && req.headers.origin === `http://${req.headers.host}`)
      headers.origin = target.origin;
    if (length !== null) headers['content-length'] = String(length);
    return headers;
  }

  /** The upstream's headers as the browser gets them: a redirect to the upstream comes back here. */
  function downstreamHeaders(req, headers) {
    const out = {};
    for (const [name, value] of Object.entries(headers))
      if (!HOP_BY_HOP.has(name)) out[name] = value;
    const location = out.location;
    if (typeof location === 'string' && location.startsWith(target.origin))
      out.location = `http://${req.headers.host}${location.slice(target.origin.length)}`;
    return out;
  }

  function forward(req, res, body) {
    const outgoing = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: req.url,
        headers: upstreamHeaders(req, body === null ? null : body.length),
        servername: target.hostname,
      },
      (answer) => {
        if (verbose)
          log(
            `${req.method} ${new URL(req.url, 'http://x').pathname} -> ${answer.statusCode} (upstream)`,
          );
        res.writeHead(answer.statusCode ?? 502, downstreamHeaders(req, answer.headers));
        answer.pipe(res);
      },
    );
    outgoing.on('error', (error) => unreachable(res, error));
    if (body === null) req.pipe(outgoing);
    else outgoing.end(body);
  }

  /** A GET of the upstream, as the request asked it, read whole: for an answer merged with the kit's. */
  function ask(req, path) {
    return new Promise((done, failed) => {
      const outgoing = send(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          method: 'GET',
          path,
          headers: upstreamHeaders(req, null),
          servername: target.hostname,
        },
        (answer) => {
          const chunks = [];
          answer.on('data', (chunk) => chunks.push(chunk));
          answer.on('end', () =>
            done({
              status: answer.statusCode ?? 502,
              headers: answer.headers,
              body: Buffer.concat(chunks),
            }),
          );
          answer.on('error', failed);
        },
      );
      outgoing.on('error', failed);
      outgoing.end();
    });
  }

  /** The JSON of an upstream answer, or `null` when it is not a 200 with a JSON body. */
  function jsonOf(answer) {
    if (answer.status !== 200) return null;
    if (!/json/.test(String(answer.headers['content-type'] ?? ''))) return null;
    let bytes = answer.body;
    const encoding = String(answer.headers['content-encoding'] ?? '').toLowerCase();
    try {
      if (encoding === 'gzip') bytes = gunzipSync(bytes);
      else if (encoding === 'deflate') bytes = inflateSync(bytes);
      else if (encoding === 'br') bytes = brotliDecompressSync(bytes);
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      return null;
    }
  }

  /** The upstream's answer, unchanged, or merged with the kit's when it is JSON. */
  async function merged(req, merge, { otherwise = null } = {}) {
    const answer = await ask(req, req.url);
    const json = jsonOf(answer);
    if (json === null) {
      if (otherwise) {
        const own = otherwise(answer);
        if (own) return own;
      }
      return { raw: answer };
    }
    return { status: 200, json: merge(json), upstreamHeaders: answer.headers };
  }

  const kitTypes = Object.keys(kit.model.doctypes);
  const kitSchemas = kit.model.schemas;
  const kitFacets = kit.model.facets ?? [];
  const schemaEntity = (schema) => ({ 'entity-type': 'schema', ...schema });
  const typeEntity = (type) => {
    const definition = kit.model.doctypes[type];
    const names = definition.schemas ?? [];
    return {
      'entity-type': 'docType',
      name: type,
      parent: definition.parent ?? 'Document',
      facets: [...(definition.facets ?? [])],
      schemas: names
        .map((name) => kitSchemas.find((schema) => schema.name === name))
        .filter(Boolean)
        .map(schemaEntity),
    };
  };
  const missingUpstream = (answer) => answer.status === 404 || answer.status === 204;

  /** A read the stand-in answers itself, or `null` to forward it. */
  async function answerRead(req, url) {
    const api = apiPathOf(url.pathname);
    if (api === null) return null;
    const [, first = '', second = '', third = ''] = api.split('/');

    if (first === 'config') {
      const named = decodeSafely(third);
      if (second === 'types' && third === '')
        return merged(req, (json) => {
          const doctypes = { ...(json.doctypes ?? {}) };
          for (const type of kitTypes) {
            const definition = kit.model.doctypes[type];
            doctypes[type] = {
              parent: definition.parent ?? 'Document',
              facets: [...(definition.facets ?? [])],
              schemas: [...(definition.schemas ?? [])],
            };
          }
          const schemas = { ...(json.schemas ?? {}) };
          for (const schema of kitSchemas)
            if (!Object.hasOwn(schemas, schema.name))
              schemas[schema.name] = {
                '@prefix': schema['@prefix'] ?? schema.prefix ?? '',
                ...schema.fields,
              };
          return { ...json, doctypes, schemas };
        });
      if (second === 'types' && kitTypes.includes(named))
        return { status: 200, json: typeEntity(named) };
      if (second === 'schemas' && third === '')
        return merged(req, (json) =>
          Array.isArray(json)
            ? [
                ...json,
                ...kitSchemas
                  .filter((schema) => !json.some((each) => each?.name === schema.name))
                  .map((schema) => ({ ...schema })),
              ]
            : json,
        );
      if (second === 'schemas' && kitSchemas.some((schema) => schema.name === named))
        return merged(req, (json) => json, {
          otherwise: (answer) =>
            missingUpstream(answer)
              ? {
                  status: 200,
                  json: schemaEntity(kitSchemas.find((schema) => schema.name === named)),
                }
              : null,
        });
      if (second === 'facets' && third === '')
        return merged(req, (json) =>
          Array.isArray(json)
            ? [
                ...json,
                ...kitFacets.filter((facet) => !json.some((each) => each?.name === facet.name)),
              ]
            : json,
        );
      if (second === 'facets' && kitFacets.some((facet) => facet.name === named))
        return merged(req, (json) => json, {
          otherwise: (answer) =>
            missingUpstream(answer)
              ? {
                  status: 200,
                  json: {
                    'entity-type': 'facet',
                    ...kitFacets.find((facet) => facet.name === named),
                  },
                }
              : null,
        });
      return null;
    }

    if (first === 'id') {
      const document = kit.byId.get(second.toLowerCase());
      if (!document) return null;
      const rest = api.slice(`/id/${second}`.length);
      return documentAnswer(kit, document, rest, req, url);
    }

    if (first === 'path') {
      const full = decodeSafely(api.slice('/path'.length));
      const at = full.indexOf('/@');
      const path = (at === -1 ? full : full.slice(0, at)).replace(/\/+$/, '');
      const document = kit.byPath.get(path);
      if (!document) return null;
      return documentAnswer(kit, document, at === -1 ? '' : full.slice(at), req, url);
    }

    if (first === 'search' && second === 'lang' && api === '/search/lang/NXQL/execute') {
      const query = url.searchParams.get('query') ?? '';
      const parameters = url.searchParams.getAll('queryParams');
      const named = standInsIn(kit, `${query}\n${parameters.join('\n')}`);
      if (named.length === 0) return null;
      const ids = idsOfQuery(query, parameters);
      if (ids === null) {
        return {
          status: 501,
          json: exception(
            501,
            'The kit stand-in answers an NXQL search naming a stand-in record only when it reads ' +
              'records by id, SELECT * FROM Document WHERE ecm:uuid IN (?, ...). Not this one: ' +
              `${query.slice(0, QUOTED_QUERY)}`,
          ),
        };
      }
      const context = contextOf(req, url);
      const mine = ids.filter((id) => kit.byId.has(id.toLowerCase()));
      const rest = [...new Set(ids.filter((id) => !kit.byId.has(id.toLowerCase())))];
      let theirs = [];
      if (rest.length > 0) {
        const params = new URLSearchParams(url.searchParams);
        params.set(
          'query',
          `SELECT * FROM Document WHERE ecm:uuid IN (${rest.map(() => '?').join(', ')})`,
        );
        params.delete('queryParams');
        for (const id of rest) params.append('queryParams', id);
        params.set('pageSize', String(rest.length));
        params.set('currentPageIndex', '0');
        const answer = await ask(req, `${url.pathname}?${params}`);
        const json = jsonOf(answer);
        if (json === null) return { raw: answer };
        theirs = Array.isArray(json.entries) ? json.entries : [];
      }
      const entries = [
        ...[...new Set(mine.map((id) => id.toLowerCase()))].map((id) =>
          documentEntity(kit, kit.byId.get(id), context),
        ),
        ...theirs,
      ];
      return { status: 200, json: pageOf('documents', entries, pagingOf(url, entries.length)) };
    }

    if (first === 'search' && second === 'pp') {
      const provider = kit.providers.get(decodeSafely(third));
      const action = api.split('/')[4] ?? '';
      if (provider && action === 'execute') return pageProviderAnswer(kit, provider, req, url);
      return null;
    }
    return null;
  }

  function reply(req, res, answer) {
    if (answer.raw) {
      res.writeHead(answer.raw.status, downstreamHeaders(req, answer.raw.headers));
      res.end(req.method === 'HEAD' ? undefined : answer.raw.body);
      return;
    }
    const body = Buffer.from(JSON.stringify(answer.json));
    const headers = {};
    // An answer merged with the upstream's keeps what the upstream said of the session.
    const cookies = answer.upstreamHeaders?.['set-cookie'];
    if (cookies) headers['set-cookie'] = cookies;
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(body.length);
    headers['cache-control'] = 'no-store';
    res.writeHead(answer.status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    log(`${req.method} ${new URL(req.url, 'http://x').pathname} ${answer.status} (stand-in)`);
  }

  function unreachable(res, error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = JSON.stringify(
      exception(
        502,
        `The kit stand-in could not reach the upstream ${target.origin}: ${error.code ?? error.message}`,
      ),
    );
    res.writeHead(502, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function refuse(req, res, named) {
    const records = named.map(nameOfDocument).join(', ');
    const operation = operationOf(new URL(req.url, 'http://x').pathname);
    if (operation !== null && READ_OPERATION.test(operation))
      return reply(req, res, {
        status: 501,
        json: exception(
          501,
          `The kit stand-in does not run ${operation} for ${records}: it holds the ${kit.name} ` +
            "kit's records, not what an operation or another system says of them. Nothing was sent " +
            'to the server.',
        ),
      });
    reply(req, res, {
      status: 403,
      json: exception(
        403,
        `${records} ${named.length === 1 ? 'is a stand-in record' : 'are stand-in records'} of the ` +
          `${kit.name} kit, served from ${kit.shown}/demo/data.mjs by npm run kit:stand-in, and ` +
          'read-only. Nothing was written, and nothing was sent to the server. To write, install the ' +
          'package on a server and run its seed.',
      ),
    });
  }

  function readBody(req) {
    return new Promise((done, failed) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => done(Buffer.concat(chunks)));
      req.on('error', failed);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://stand-in');
    const reads = req.method === 'GET' || req.method === 'HEAD';
    const address = decodeSafely(`${url.pathname}${url.search}`);
    if (reads) {
      const answer = await answerRead(req, url);
      if (answer) return reply(req, res, answer);
      // No stand-in record is ever asked of the server by its address: it is not there.
      const named = standInsIn(kit, decodeSafely(url.pathname));
      if (named.length > 0)
        return reply(req, res, {
          status: 404,
          json: exception(
            404,
            `${named.map(nameOfDocument).join(', ')}: ${named.length === 1 ? 'a stand-in record' : 'stand-in records'} ` +
              `of the ${kit.name} kit. The stand-in does not answer ${url.pathname} for one.`,
          ),
        });
      return forward(req, res, null);
    }
    const inAddress = standInsIn(kit, address);
    if (inAddress.length > 0) {
      req.resume();
      return refuse(req, res, inAddress);
    }
    if (url.pathname.startsWith('/nuxeo/api/v1/search/pp/')) {
      const provider = kit.providers.get(decodeSafely(url.pathname.split('/')[6] ?? ''));
      if (provider) {
        req.resume();
        return reply(req, res, {
          status: 403,
          json: exception(
            403,
            `${provider.name} is a page provider of the ${kit.name} kit, answered by the stand-in ` +
              'from its demo data, and read-only: nothing was run.',
          ),
        });
      }
    }
    if (!inspectsBody(url.pathname)) return forward(req, res, null);
    const body = await readBody(req);
    const inBody = standInsIn(kit, body.toString('utf8'));
    if (inBody.length > 0) return refuse(req, res, inBody);
    return forward(req, res, body);
  }

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A merged answer asks the upstream itself: one that does not answer is the upstream's.
      if (typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code))
        return unreachable(res, error);
      if (res.headersSent) return res.destroy();
      const body = JSON.stringify(exception(500, `The kit stand-in failed: ${error.message}`));
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// The command

/** The `config:dev` options that serve the kit's files, as `preview_package` gives them. */
function configDevArguments(kit) {
  const config = join(kit.directory, 'bundle', 'agentic-ui-config');
  const at = (...parts) => relative(ROOT, join(config, ...parts));
  const args = [];
  const has = (...parts) => existsSync(join(config, ...parts));
  const list = (...parts) => (has(...parts) ? readdirSync(join(config, ...parts)).sort() : []);
  for (const type of list('layouts'))
    for (const file of list('layouts', type)) {
      const mode = /^(.+)\.layout\.json$/.exec(file)?.[1];
      if (mode) args.push('--layout', `${type}/${mode}=${at('layouts', type, file)}`);
    }
  if (has('home.json')) args.push('--home', at('home.json'));
  if (has('navigation.json')) args.push('--navigation', at('navigation.json'));
  for (const file of list('queues'))
    if (file.endsWith('.json')) args.push('--queue', at('queues', file));
  for (const file of list('labels'))
    if (file.endsWith('.json')) args.push('--labels', `${file.slice(0, -5)}=${at('labels', file)}`);
  for (const file of list('tasks')) {
    const step = /^(.+)\.layout\.json$/.exec(file)?.[1];
    if (step) args.push('--task', `${step}=${at('tasks', file)}`);
  }
  return args;
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    'usage: kit-stand-in.mjs <kit folder> [--port <port>] [--upstream <http(s)://host[:port]>] ' +
      '[--check] [--verbose]\n' +
      `  kits it reads: ${Object.keys(KITS).join(', ')}`,
  );
  process.exit(EXIT_PRECONDITION);
}

async function main(argv) {
  let folder = null;
  let port = DEFAULT_PORT;
  let upstream = DEFAULT_UPSTREAM;
  let check = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') check = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        usage('--port takes a port, 1 to 65535.');
    } else if (arg === '--upstream') {
      upstream = argv[++i] ?? '';
      if (!/^https?:\/\/[^/]+$/.test(upstream))
        usage(
          '--upstream takes the Nuxeo origin, scheme and host only, such as http://localhost:8080.',
        );
    } else if (arg.startsWith('--')) usage(`${arg} is not an option.`);
    else if (folder === null) folder = arg;
    else usage(`One kit folder at a time: ${arg} is a second.`);
  }
  if (folder === null)
    usage('Name the kit folder, such as business-apps/packages/vehicle-titles-demo.');

  let kit;
  try {
    kit = await loadKit(folder);
  } catch (error) {
    if (error instanceof Precondition) usage(error.message);
    throw error;
  }
  if (check) {
    console.log(JSON.stringify(summary(kit), null, 2));
    return;
  }

  const server = createStandIn(kit, { upstream, verbose, log: (line) => console.log(`  ${line}`) });
  await new Promise((done) => {
    server.once('error', (error) => {
      usage(
        error.code === 'EADDRINUSE'
          ? `Port ${port} is taken: stop what holds it, or give --port another.`
          : `The stand-in could not listen on 127.0.0.1:${port}: ${error.message}`,
      );
    });
    server.listen(port, '127.0.0.1', done);
  });

  const origin = `http://localhost:${port}`;
  const { types, records, pageProviders } = summary(kit);
  const count = Object.values(records).reduce((total, list) => total + list.length, 0);
  const lines = [
    `The ${kit.name} stand-in is at ${origin}, in front of ${upstream}.`,
    `  answers itself: the kit's types (${types.join(', ')}) and schemas; its ${count} records, read-only;`,
    `  and its page providers ${pageProviders.answered.join(', ') || '(none)'}, from demo/data.mjs's EXPECTED.`,
  ];
  if (pageProviders.notAnswered.length > 0)
    lines.push(
      `  cannot answer: ${pageProviders.notAnswered.join(', ')}, which EXPECTED does not list: HTTP 501.`,
    );
  lines.push(
    `  forwards everything else to ${upstream} as it came, sign-in included.`,
    '',
    'Serve the kit to the dev server, with preview_package or:',
    `  npm run config:dev -- ${configDevArguments(kit).join(' ')}`,
    'and start the dev server pointed at the stand-in:',
    `  NUXEO_PROXY_TARGET=${origin} npx ng serve nuxeo-ui --configuration=development,remote`,
    '',
    'Then sign in with your own account and open http://localhost:4200/#/home, or a record:',
  );
  for (const [type, list] of Object.entries(records))
    for (const { key, id } of list)
      lines.push(`  ${type} ${key}: http://localhost:4200/#/doc/${id}`);
  lines.push('', 'Ctrl+C stops it. Requests it answers itself:');
  console.log(lines.join('\n'));

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main(process.argv.slice(2));
}
