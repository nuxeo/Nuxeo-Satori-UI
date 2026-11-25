/**
 * A local stand-in for the Nuxeo server the asset library and the asset page talk to, for the
 * performance check (`check.mjs`). It serves, from one port:
 *
 * - the application's production build, from `dist/nuxeo-ui/browser`, at `/`;
 * - the brand assets kit's configuration at `/agentic-ui-config/`, as `npm run config:dev` writes
 *   it for the development server: the packaged bootstrap and manifest in their envelopes, the
 *   kit's three layouts, its labels, its two queues and its menu;
 * - the REST calls those two pages make, under `/nuxeo/`, from `library.mjs`'s 100,000 synthetic
 *   assets: `/me`, the library's page provider with its aggregates, the asset's document, its
 *   type and schemas from the kit's `content-model.json`, its picture views, history and
 *   annotations. A page of the provider that ends past the search index's window is answered
 *   HTTP 500, as Nuxeo answers it, and marked `pastWindow` in the log.
 *
 * Nothing is written anywhere, and no Nuxeo is asked: this is the "without writing 100,000
 * documents to any Nuxeo" of the check. Each answer is sent the latency `LATENCY` gives its route,
 * times `latencyScale`, after its request arrived, the stand-in's own work included, so the
 * browser sees a server's pace; the times are stated, with their reasoning, in
 * `docs/business-apps/performance-budget.md`. Text is sent gzipped to a browser that accepts it,
 * as by a server behind a compressing proxy.
 *
 * Every request is recorded (`log`), so the check counts what each action asked for. A `/nuxeo/`
 * or configuration request the stand-in has no answer for is recorded as `unknown` and answered
 * 404, as Nuxeo answers an address it does not serve: the check fails on any, because the page
 * would then be measured against a server that answered nothing.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

import { crc32, picturePng } from '../../../business-apps/packages/brand-assets-demo/demo/png.mjs';
import {
  AGGREGATES,
  PAGE_PROVIDER,
  PAST_WINDOW_MESSAGE,
  PastWindowError,
  createLibrary,
} from './library.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const KIT = join(ROOT, 'business-apps/packages/brand-assets-demo');
const KIT_CONFIG = join(KIT, 'bundle/agentic-ui-config');
const DEFAULTS = join(ROOT, 'nuxeo-agentic-core/src/main/resources/agentic-ui-config');

/** The signed-in person the stand-in answers `/me` with: a member of the kit's brand team. */
export const STAND_IN_USER = 'perf-reader';

/**
 * Milliseconds each kind of request waits before it is answered: the time the stand-in assumes a
 * server holding 100,000 assets takes, assumed rather than measured, as reasoned in
 * `docs/business-apps/performance-budget.md` ("The stand-in's latencies"). `perEntry` is added
 * once per record a page provider returns.
 */
export const LATENCY = Object.freeze({
  pageProvider: { base: 120, perEntry: 2 },
  document: { base: 90 },
  blob: { base: 40 },
  audit: { base: 80 },
  annotations: { base: 60 },
  directory: { base: 30 },
  me: { base: 25 },
  user: { base: 25 },
  schema: { base: 20 },
  config: { base: 10 },
  other: { base: 40 },
});

/**
 * The kinds of request the log files a request under, by what asked for it. `background` is the
 * notification bell's check, on its own timer (`libs/shared/notifications`): recorded and answered,
 * but not counted against the action it happens to fall in. `unknown` is a request the stand-in
 * has no answer for, which fails the check.
 */
export const KINDS = Object.freeze([
  'static',
  'config',
  'registry',
  'me',
  'pageProvider',
  'schema',
  'document',
  'documentPage',
  'directory',
  'user',
  'blob',
  'audit',
  'annotations',
  'shell',
  'background',
  'unknown',
]);

/**
 * How many entries each vocabulary the document page reads holds: as many as Nuxeo's stock ones
 * (`nuxeo-platform-default-config`, `directories/*.csv`), so the page reads as many pages of them
 * as it would on a stock server. The entries themselves are synthetic.
 */
export const VOCABULARY_SIZES = Object.freeze({ l10ncoverage: 251, l10nsubjects: 58, nature: 37 });

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The configuration as `scripts/dev-config.mjs` writes it, kept in memory: path to body. */
function kitConfiguration() {
  const envelope = (layer, name, path) => ({
    format: 'nuxeo-agentic-ui-config/1',
    layer,
    fragments: [
      {
        name,
        component: 'org.nuxeo.agentic.ui.config.defaults',
        bundle: 'org.nuxeo.agentic.ui.config.defaults',
        source: path.slice(ROOT.length + 1),
        content: readJson(path),
      },
    ],
    diagnostics: [],
  });
  const files = new Map();
  files.set(
    'bootstrap.json',
    envelope('bootstrap', 'defaults', join(DEFAULTS, 'bootstrap.defaults.json')),
  );
  files.set(
    'manifest.json',
    envelope('manifest', 'defaults', join(DEFAULTS, 'manifest.defaults.json')),
  );
  const layouts = [];
  for (const type of ['AcmeAsset', 'AcmeProduct', 'AcmeShot']) {
    const source = join(KIT_CONFIG, 'layouts', type, 'view.layout.json');
    const url = `layouts/${type}/view.layout.json`;
    const provenance = {
      component: 'local.dev',
      bundle: 'local.dev',
      source: source.slice(ROOT.length + 1),
    };
    files.set(url, {
      format: 'nuxeo-agentic-ui-config/1',
      layer: 'layout',
      type,
      mode: 'view',
      ...provenance,
      content: readJson(source),
    });
    layouts.push({ type, mode: 'view', url, ...provenance });
  }
  files.set('layouts.json', {
    format: 'nuxeo-agentic-ui-config/1',
    layer: 'layouts',
    layouts,
    labels: ['en'],
    diagnostics: [],
  });
  files.set('labels/en.json', readJson(join(KIT_CONFIG, 'labels/en.json')));
  files.set('navigation.json', readJson(join(KIT_CONFIG, 'navigation.json')));
  for (const id of ['library', 'products']) {
    files.set(`queues/${id}.json`, readJson(join(KIT_CONFIG, `queues/${id}.json`)));
  }
  return files;
}

/** `/config/types/AcmeAsset` and `/config/schemas/<name>`, from the kit's content model. */
function contentModel() {
  const model = readJson(join(KIT, 'content-model.json'));
  const schemas = new Map(
    model.schemas.map((schema) => [
      schema.name,
      { ...schema, prefix: schema.prefix ?? schema.name, '@prefix': schema.prefix ?? schema.name },
    ]),
  );
  const types = new Map(
    Object.entries(model.doctypes).map(([name, type]) => [
      name,
      {
        name,
        parent: type.parent,
        facets: type.facets,
        schemas: type.schemas.map((schema) => schemas.get(schema)).filter(Boolean),
      },
    ]),
  );
  return { types, schemas };
}

/** `length` bytes that do not compress, the same every run. */
function noise(length, seed = 1) {
  const bytes = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

/**
 * A PNG chunk of a private, ancillary type, which a decoder skips: the bytes that bring a flat
 * drawing up to the size the record says its view is.
 */
function paddingChunk(length) {
  const type = Buffer.from('paDd', 'latin1');
  const data = noise(length, length);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0);
  return Buffer.concat([head, type, data, crc]);
}

/**
 * The picture each view answers with: drawn once per size by the kit's own `png.mjs`, then padded
 * to `length`, the size the record gives the view (`library.mjs`), so that it costs the network what
 * a view of that size would. A flat drawing is a few kilobytes; a real view is not.
 */
function pictures() {
  const cache = new Map();
  return (width, height, length) => {
    const key = `${width}x${height}x${length}`;
    let png = cache.get(key);
    if (!png) {
      const drawn = picturePng({
        shape: width > height ? 'hills' : 'jacket',
        size: [width, height],
        background: [214, 226, 205],
        ink: [74, 102, 62],
      });
      // Before IEND, the last 12 bytes: a decoder reads the chunks in order and stops there.
      const pad = length - drawn.length - 12;
      png =
        pad > 0
          ? Buffer.concat([drawn.subarray(0, -12), paddingChunk(pad), drawn.subarray(-12)])
          : drawn;
      cache.set(key, png);
    }
    return png;
  };
}

/**
 * The file under `root` that the address `urlPath` names, or `null` for one that names nothing
 * there: a malformed escape, a path that leaves `root`, or no such file. Pure but for the file
 * system's answer, and given its `path` module, so that Windows' paths can be tested anywhere: on
 * Windows `/C:/x` would otherwise resolve to the drive's own `C:\x`.
 */
export function resolveStaticFile(root, urlPath, path = { normalize, resolve, sep, isAbsolute }) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = path.normalize(decoded).replace(/^[/\\]+/, '');
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, relative || 'index.html');
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

const nuxeoError = (status, message) => ({ 'entity-type': 'exception', status, message });

/** An empty page of documents, as Nuxeo writes one. */
const noDocuments = (pageSize = 50) => ({
  'entity-type': 'documents',
  isPaginable: true,
  resultsCount: 0,
  pageSize,
  currentPageSize: 0,
  currentPageIndex: 0,
  numberOfPages: 0,
  isPreviousPageAvailable: false,
  isNextPageAvailable: false,
  isLastPageAvailable: false,
  totalSize: 0,
  entries: [],
});

/** A vocabulary's synthetic entries, as many as the stock one holds. */
function vocabulary(name) {
  const size = VOCABULARY_SIZES[name] ?? 0;
  return Array.from({ length: size }, (_, i) => {
    const id = `${name}-${String(i + 1).padStart(3, '0')}`;
    // The first tenth are top-level, the rest each under one of them, as the stock trees are.
    const top = Math.max(1, Math.floor(size / 10));
    const parent =
      i < top || name === 'nature' ? '' : `${name}-${String((i % top) + 1).padStart(3, '0')}`;
    return { id, label: `${name} ${i + 1}`, parent, obsolete: 0, ordering: 10_000_000 };
  });
}

/**
 * Starts the stand-in.
 *
 * `latencyScale` multiplies the server's latencies (`LATENCY`), as a slower server would; `rttMs`
 * is the network's round trip, added to every answer, static files included, and not scaled. It
 * is added here rather than by Chromium's emulation, whose latency is a least time to the response
 * headers: a server slower than it gets no round trip at all. `padMainBytes` adds that many bytes
 * that do not compress to the app's first script, for the control that stands for a heavier
 * first bundle; 0, the build as it is. `window`, `counted` and `windowShown` are the library's
 * (`createLibrary`): the search index's window, enforced as the server enforces it, and for two
 * controls a count held to a limit or a window left unsaid.
 *
 * @param {{ port?: number, host?: string, dist: string, size?: number, today?: Date,
 *   latencyScale?: number, rttMs?: number, padMainBytes?: number, window?: number,
 *   counted?: number | null, windowShown?: boolean }} options
 * @returns {Promise<{ url: string, log: object[], library: ReturnType<typeof createLibrary>,
 *   inFlight: () => number, close: () => Promise<void> }>}
 */
export async function startStandIn({
  port = 4294,
  host = '127.0.0.1',
  dist,
  size,
  today,
  latencyScale = 1,
  rttMs = 0,
  padMainBytes = 0,
  window,
  counted,
  windowShown,
}) {
  if (!dist || !existsSync(join(dist, 'index.html'))) {
    throw new Error(`no production build at ${dist}: index.html is missing`);
  }
  const library = createLibrary({ size, today, window, counted, windowShown });
  const config = kitConfiguration();
  const model = contentModel();
  const picture = pictures();
  const vocabularies = new Map(
    Object.keys(VOCABULARY_SIZES).map((name) => [name, vocabulary(name)]),
  );
  const log = [];
  let inFlight = 0;

  /**
   * Waits until the round trip and `ms`, scaled, after the request arrived at `started`: the
   * stated latency is the time to the answer, the stand-in's own work included, not added to it.
   */
  const until = (started, ms) =>
    new Promise((done) =>
      setTimeout(
        done,
        Math.max(0, Math.round(rttMs + ms * latencyScale - (performance.now() - started))),
      ),
    );

  /** Each static file gzipped once, as a server behind a compressing proxy sends it. */
  const gzipped = new Map();
  const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

  /** Sends `body`, gzipped when it is text and the browser accepts gzip. Returns the bytes sent. */
  const send = (
    request,
    response,
    status,
    body,
    type = 'application/json; charset=utf-8',
    headers = {},
    cacheKey = null,
  ) => {
    let bytes = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const extra = { ...headers };
    if (COMPRESSIBLE.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
      const cached = cacheKey === null ? undefined : gzipped.get(cacheKey);
      const compressed = cached ?? gzipSync(bytes);
      if (cacheKey !== null && cached === undefined) gzipped.set(cacheKey, compressed);
      bytes = compressed;
      extra['Content-Encoding'] = 'gzip';
      extra['Vary'] = 'Accept-Encoding';
    }
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, ...extra });
    response.end(bytes);
    return bytes.length;
  };

  const answer = (kind, ms, body, status = 200, type = undefined) => ({
    kind,
    ms,
    status,
    body,
    type,
  });

  function pageProvider(query) {
    const choices = {};
    for (const aggregate of Object.keys(AGGREGATES)) {
      const raw = query.get(aggregate);
      if (raw === null) continue;
      let keys;
      try {
        keys = JSON.parse(raw);
      } catch {
        return answer('pageProvider', 0, nuxeoError(400, `${aggregate} is not JSON`), 400);
      }
      if (!Array.isArray(keys)) {
        return answer('pageProvider', 0, nuxeoError(400, `${aggregate} is not a list`), 400);
      }
      choices[aggregate] = keys.map(String);
    }
    let page;
    try {
      page = library.execute({
        pageSize: Number(query.get('pageSize') ?? 50),
        pageIndex: Number(query.get('currentPageIndex') ?? 0),
        sortBy: query.get('sortBy') ?? '',
        sortOrder: query.get('sortOrder') ?? '',
        choices,
      });
    } catch (error) {
      // Past the search index's window, Nuxeo answers 500 with OpenSearch's refusal; the log marks
      // it, so the check counts every page asked for past the window.
      if (error instanceof PastWindowError) {
        return {
          ...answer('pageProvider', 0, nuxeoError(500, PAST_WINDOW_MESSAGE), 500),
          pastWindow: true,
        };
      }
      return answer('pageProvider', 0, nuxeoError(400, error.message), 400);
    }
    const { base, perEntry } = LATENCY.pageProvider;
    return answer('pageProvider', base + perEntry * page.entries.length, page);
  }

  function byId(uid, rest, query) {
    const document = library.document(uid);
    if (!document) return answer('document', LATENCY.document.base, nuxeoError(404, uid), 404);
    if (rest === '') return answer('document', LATENCY.document.base, document);
    const view = /^\/@blob\/picture:views\/(\d+)\/content$/.exec(rest);
    if (view) {
      const entry = document.properties['picture:views'][Number(view[1])];
      if (!entry) return answer('blob', LATENCY.blob.base, nuxeoError(404, rest), 404);
      return answer(
        'blob',
        LATENCY.blob.base,
        picture(entry.width, entry.height, entry.content.length),
        200,
        'image/png',
      );
    }
    if (rest === '/@audit') {
      const entry = (id, eventId, date) => ({
        'entity-type': 'logEntry',
        id,
        category: 'eventDocumentCategory',
        principalName: 'acme-studio',
        comment: null,
        docLifeCycle: 'project',
        docPath: document.path,
        docType: 'AcmeAsset',
        docUUID: uid,
        eventId,
        repositoryId: 'default',
        eventDate: date,
        logDate: date,
        extended: {},
      });
      const entries = [
        entry(2, 'documentModified', document.properties['dc:modified']),
        entry(1, 'documentCreated', document.properties['dc:created']),
      ];
      return answer('audit', LATENCY.audit.base, {
        'entity-type': 'logEntries',
        isPaginable: true,
        resultsCount: entries.length,
        pageSize: Number(query.get('pageSize') ?? 20),
        currentPageIndex: 0,
        numberOfPages: 1,
        isNextPageAvailable: false,
        entries,
      });
    }
    // The document page's side panels: the record's tasks and workflows, none on a synthetic asset.
    if (rest === '/@task' || rest === '/@workflow') {
      return answer('documentPage', LATENCY.other.base, {
        'entity-type': rest === '/@task' ? 'tasks' : 'workflows',
        entries: [],
      });
    }
    return answer('unknown', 0, nuxeoError(404, `${uid}${rest}`), 404);
  }

  /** One `/nuxeo/` request: its kind for the log, how long it waits, and its answer. */
  function api(method, path, query, body) {
    if (method === 'GET' && path === '/nuxeo/api/v1/me') {
      return answer('me', LATENCY.me.base, {
        'entity-type': 'user',
        id: STAND_IN_USER,
        properties: {
          username: STAND_IN_USER,
          firstName: 'Performance',
          lastName: 'Reader',
          email: `${STAND_IN_USER}@acme-outdoor.invalid`,
          company: 'Acme Outdoor',
          groups: ['members', 'brand-team'],
        },
        extendedGroups: [
          { name: 'members', label: 'Members group', url: 'group/members' },
          { name: 'brand-team', label: 'Brand team', url: 'group/brand-team' },
        ],
        isAdministrator: false,
        isAnonymous: false,
      });
    }
    if (method === 'GET' && path === `/nuxeo/api/v1/search/pp/${PAGE_PROVIDER}/execute`) {
      return pageProvider(query);
    }
    if (method === 'GET') {
      const type = /^\/nuxeo\/api\/v1\/config\/types\/([^/]+)$/.exec(path);
      if (type) {
        const definition = model.types.get(decodeURIComponent(type[1]));
        return definition
          ? answer('schema', LATENCY.schema.base, definition)
          : answer('unknown', 0, nuxeoError(404, `no type ${type[1]}`), 404);
      }
      const schema = /^\/nuxeo\/api\/v1\/config\/schemas\/([^/]+)$/.exec(path);
      if (schema) {
        const definition = model.schemas.get(decodeURIComponent(schema[1]));
        return definition
          ? answer('schema', LATENCY.schema.base, definition)
          : answer('unknown', 0, nuxeoError(404, `no schema ${schema[1]}`), 404);
      }
      const id = /^\/nuxeo\/api\/v1\/id\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
      if (id) return byId(id[1], id[2] ?? '', query);
      const directory = /^\/nuxeo\/api\/v1\/directory\/([A-Za-z0-9_-]+)$/.exec(path);
      if (directory && vocabularies.has(directory[1])) {
        const entries = vocabularies.get(directory[1]);
        const pageSize = Math.max(1, Number(query.get('pageSize') ?? 50));
        const index = Math.max(0, Number(query.get('currentPageIndex') ?? 0));
        const slice = entries.slice(index * pageSize, (index + 1) * pageSize);
        return answer('directory', LATENCY.directory.base, {
          'entity-type': 'directoryEntries',
          isPaginable: true,
          resultsCount: entries.length,
          pageSize,
          currentPageIndex: index,
          numberOfPages: Math.ceil(entries.length / pageSize),
          isNextPageAvailable: (index + 1) * pageSize < entries.length,
          entries: slice.map((entry) => ({
            'entity-type': 'directoryEntry',
            directoryName: directory[1],
            id: entry.id,
            properties: {
              id: entry.id,
              label_en: entry.label,
              parent: entry.parent,
              obsolete: entry.obsolete,
              ordering: entry.ordering,
            },
          })),
        });
      }
      const user = /^\/nuxeo\/api\/v1\/user\/([^/]+)$/.exec(path);
      if (user) {
        const name = decodeURIComponent(user[1]);
        return answer('user', LATENCY.user.base, {
          'entity-type': 'user',
          id: name,
          properties: { username: name, firstName: '', lastName: '', groups: ['members'] },
          extendedGroups: [],
          isAdministrator: false,
          isAnonymous: false,
        });
      }
      // The document page's publications, a search no synthetic asset is in.
      if (path === '/nuxeo/api/v1/search/pp/nxql_search/execute') {
        return answer('documentPage', LATENCY.other.base, noDocuments(40));
      }
      // The shell's favourites lookup, at sign-in: the reader has none.
      if (path === '/nuxeo/api/v1/search/lang/NXQL/execute') {
        return answer('shell', LATENCY.other.base, noDocuments());
      }
      // The bell's open tasks, as it asks for them (NOTIFICATION_TASK_READ_LIMIT): none. Another
      // read of the task list is not the bell's, and is unknown here.
      if (
        path === '/nuxeo/api/v1/task' &&
        query.get('userId') === STAND_IN_USER &&
        query.get('pageSize') === '100'
      ) {
        return answer('background', LATENCY.other.base, { 'entity-type': 'tasks', entries: [] });
      }
      // No app registry: the configuration is served where the development server serves it,
      // which the app reads first (app-definition-v2.md, section 10).
      if (path.startsWith('/nuxeo/agentic-ui-apps/')) {
        return answer('registry', LATENCY.config.base, nuxeoError(404, 'no app registry'), 404);
      }
    }
    // Known by what they ask, not only by where: the same operation from another page is not the
    // bell's, and would otherwise go uncharged and unanswered.
    if (method === 'POST' && path === '/nuxeo/api/v1/automation/Repository.Query') {
      const text = String(body?.params?.query ?? '');
      // The review's pins (ANNOTATION_DOCUMENTS_QUERY in nuxeo-client).
      if (/^SELECT \* FROM Annotation WHERE ecm:ancestorId = \?/.test(text)) {
        return answer('annotations', LATENCY.annotations.base, noDocuments(1000));
      }
      // The bell's followed records (`NotificationSources.followed`).
      if (
        /^SELECT \* FROM Document WHERE notif:notifications\/\*\/subscribers\/\* = \?/.test(text)
      ) {
        return answer('background', LATENCY.other.base, noDocuments());
      }
    }
    // The bell's changes to the records it follows: never asked while it follows none.
    if (
      method === 'POST' &&
      path === '/nuxeo/api/v1/automation/Audit.QueryWithPageProvider' &&
      /^SELECT \* FROM LogEntry WHERE docUUID IN \(/.test(String(body?.params?.query ?? ''))
    ) {
      return answer('background', LATENCY.other.base, {
        'entity-type': 'logEntries',
        entries: [],
        isNextPageAvailable: false,
      });
    }
    if (method === 'POST' && path === '/nuxeo/api/v1/automation/Directory.SuggestEntries') {
      const name = String(body?.params?.directoryName ?? '');
      if (!vocabularies.has(name)) {
        return answer('unknown', 0, nuxeoError(404, `no vocabulary ${name}`), 404);
      }
      return answer(
        'directory',
        LATENCY.directory.base,
        vocabularies.get(name).map((entry) => ({
          id: entry.id,
          label: entry.label,
          displayLabel: entry.label,
          parent: entry.parent,
          obsolete: entry.obsolete,
          ordering: entry.ordering,
        })),
      );
    }
    return answer('unknown', 0, nuxeoError(404, `${method} ${path}`), 404);
  }

  function staticFile(path) {
    const file = resolveStaticFile(dist, path);
    return file !== null && existsSync(file) && statSync(file).isFile() ? file : null;
  }

  /**
   * The application's first script, `main-<hash>.js`, as `index.html` names it: what `padMainBytes`
   * makes heavier, for the control that stands for a first bundle grown by that much.
   */
  const mainScript = /src="(main-[A-Za-z0-9_-]+\.js)"/.exec(
    readFileSync(join(dist, 'index.html'), 'utf8'),
  )?.[1];
  if (padMainBytes > 0 && !mainScript) {
    throw new Error('index.html names no main-<hash>.js to pad');
  }
  const mainPadding =
    padMainBytes > 0 ? Buffer.from(`\n/*${noise(padMainBytes, 7).toString('base64')}*/\n`) : null;
  const staticBytes = (file) => {
    const bytes = readFileSync(file);
    return mainPadding && file.endsWith(`${sep}${mainScript}`)
      ? Buffer.concat([bytes, mainPadding])
      : bytes;
  };

  /** The request's body, read whole, as JSON where it is: `null` when there is none or it is not. */
  const bodyOf = (request) =>
    new Promise((done) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        if (chunks.length === 0) return done(null);
        try {
          done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          done(null);
        }
      });
      request.on('error', () => done(null));
    });

  /** Each request's record, so that one the handler throws on is still finished. */
  const records = new WeakMap();

  const handle = async (request, response) => {
    const started = performance.now();
    const record = {
      at: started,
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      query: '',
      kind: 'static',
      status: 0,
      bytes: 0,
      ms: 0,
      done: false,
    };
    log.push(record);
    records.set(request, record);
    inFlight += 1;
    const finish = (status, bytes) => {
      record.status = status;
      record.bytes = bytes;
      record.ms = performance.now() - started;
      record.done = true;
      inFlight -= 1;
    };
    const url = new URL(request.url ?? '/', `http://${host}`);
    const path = url.pathname;
    const method = record.method;
    record.path = path;
    record.query = url.search;

    if (path.startsWith('/nuxeo/')) {
      const body = method === 'POST' ? await bodyOf(request) : null;
      const reply = api(method, path, url.searchParams, body);
      record.kind = reply.kind;
      if (reply.pastWindow) record.pastWindow = true;
      const payload = Buffer.isBuffer(reply.body)
        ? reply.body
        : Buffer.from(JSON.stringify(reply.body));
      await until(started, reply.ms);
      finish(reply.status, send(request, response, reply.status, payload, reply.type ?? undefined));
      return;
    }
    if (path.startsWith('/agentic-ui-config/')) {
      const file = path.slice('/agentic-ui-config/'.length);
      const body = config.get(file);
      // A home, a task form or another language's labels: the kit has none, so 404, as on the
      // development server.
      const none = /^(home\.json|tasks\/[^/]+|labels\/[^/]+\.json)$/.test(file);
      record.kind = body !== undefined || none ? 'config' : 'unknown';
      await until(started, LATENCY.config.base);
      if (body === undefined) finish(404, send(request, response, 404, nuxeoError(404, path)));
      else finish(200, send(request, response, 200, body, undefined, {}, `config:${file}`));
      return;
    }
    const file = staticFile(path);
    await until(started, 0);
    if (file === null) {
      // The application's own routes are hash routes, so anything else is not the app's.
      record.kind = 'unknown';
      finish(404, send(request, response, 404, 'not found', 'text/plain; charset=utf-8'));
      return;
    }
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    // As a server would: the hashed bundles kept, the page itself asked for again.
    const cache = file.endsWith('index.html')
      ? 'no-cache'
      : /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    finish(
      200,
      send(request, response, 200, staticBytes(file), type, { 'Cache-Control': cache }, file),
    );
  };

  // A request the handler throws on is answered 500 and filed as unknown, which fails the check,
  // rather than ending the run with an unhandled rejection and no report.
  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      const record = records.get(request);
      if (record && !record.done) {
        record.kind = 'unknown';
        record.status = 500;
        record.error = String(error);
        record.ms = performance.now() - record.at;
        record.done = true;
        inFlight -= 1;
      }
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(String(error));
    });
  });

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done());
  });

  return {
    // The address listened on, by its number: `localhost` may be tried as ::1 first, which is
    // slower on some systems and may reach another server. The port is the one asked for, or the
    // one the system chose for 0.
    url: `http://${host}:${server.address().port}`,
    log,
    library,
    inFlight: () => inFlight,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}
