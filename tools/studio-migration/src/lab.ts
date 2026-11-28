/**
 * Lab mode's comparison: one document opened in Web UI and in the new app, as the same user, and
 * the requests each sent to Nuxeo held to the request-log rule (README, **Lab mode**). This file
 * reads recordings and writes nothing; `lab-browser.ts` makes them, against a real server.
 *
 * **The rule**, check 7's server half on a document's page. For each document:
 *
 * 1. **The document.** Web UI's page asks for it (a `GET` by id or by path); the new app's page
 *    must too, and be answered as Web UI was: both read it, or neither.
 * 2. **Its schemas.** Every schema Web UI asks for it with, in `properties`, `X-NXproperties` or
 *    `X-NXDocumentProperties` (`*` being every schema), the new app asks for too. What a request
 *    asks is read as the browser sent it: the new app's development server adds
 *    `X-NXproperties: *` to everything it proxies (`apps/nuxeo-ui/proxy.conf.json`), so what the
 *    new app receives there can be more than it asks.
 * 3. **Its properties.** Every property Web UI fetches and shows, the new app fetches and can
 *    show. Web UI shows a property when a document layout it loaded for the document names it in a
 *    place outside every condition ({@link webUiLayouts}), and fetched it when its answer for the
 *    document holds it. The new app fetches it when an answer for the document it received holds
 *    it, and can show it when its page holds a field of it (`data-field`), when a `view` or
 *    `metadata` layout file it loaded for the document's type lists it, or when its page draws it
 *    itself ({@link DRAWN_BY_THE_PAGE}). A property named only under a condition is listed, not
 *    held: whether it shows is the condition's, which check 5 holds.
 *
 * Listed side by side for the reviewer, and held to nothing yet: the enrichers each app asks the
 * document with, the page providers each asks with their parameters and result counts, the other
 * endpoints, and the requests lab mode refused.
 */
import type { CheckResult } from './harness';
import { layoutFields } from './app-walk';
import { isCondition } from './inventory';
import { parseHtml } from './markup';

/** The two apps lab mode opens a document in. */
export type LabApp = 'web-ui' | 'new-app';
export const APP_NAMES: Readonly<Record<LabApp, string>> = {
  'web-ui': 'Web UI',
  'new-app': 'the new app',
};

/** A document lab mode opens, as the server answered for it before either app did. */
export interface LabDocument {
  readonly uid: string;
  readonly path: string;
  readonly type: string;
  readonly title: string;
}

/** One request an app sent, as lab mode recorded it. Never a credential. */
export interface RecordedRequest {
  readonly method: string;
  /** The path, percent-encoded as sent. */
  readonly path: string;
  /** The query, with its `?`, or empty. */
  readonly query: string;
  /** What the browser says it is: `document`, `xhr`, `fetch`, and so on. */
  readonly kind: string;
  /** The headers that say what it asks for, lower-cased: properties, enrichers, fetch, depth. */
  readonly asks: Readonly<Record<string, string>>;
  /** The status; `refused` when lab mode stopped it, `failed` when nothing answered. */
  readonly status: number | 'refused' | 'failed';
  /** Why lab mode refused it, or what failed. */
  readonly reason?: string;
  /** Whether it went out with the user's `Authorization`, as lab mode expected. */
  readonly signed: boolean;
  /** For the document's own answer: the properties it holds, by name. */
  readonly documentProperties?: readonly string[];
  /** For a page of results: how many the server counted. */
  readonly resultsCount?: number;
  /** For `/me` and Web UI's sign-in: who the server said the request ran as. */
  readonly answeredAs?: string | null;
  /** For `/me`: whether the server said that is the guest. */
  readonly answeredAnonymous?: boolean;
}

/** A layout file an app loaded for the document, and the properties its fields name. */
export interface LoadedLayout {
  readonly path: string;
  readonly status: number;
  /** The mode, from its name: `view`, `metadata`, `edit`. */
  readonly mode: string;
  readonly fields: readonly { readonly xpath: string; readonly conditional: boolean }[];
  /** Web UI: the elements of its fields that name no property, such as a viewer: not held. */
  readonly unbound?: readonly string[];
  /** Web UI: the properties it names outside every field, held as any field's are. */
  readonly outside?: readonly string[];
  /** Why what it holds could not be read, which stops the document's comparison. */
  readonly unreadable?: string;
}

/** The new app's pages, as lab mode tells them apart. */
export type AppPage = 'document' | 'browse' | 'other';

export interface AppRecording {
  readonly app: LabApp;
  /** The address opened. */
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  /** Web UI: its document layouts for the type. The new app: its layout files for the type. */
  readonly layouts: readonly LoadedLayout[];
  /** The new app's page: which one it is, and the `data-field` of each field it holds. */
  readonly page?: { readonly kind: AppPage; readonly fields: readonly string[] };
  /** What went wrong with who the requests ran as; empty when they all ran as the user. */
  readonly identity: readonly string[];
  /** Said when the page did not stop sending within lab mode's wait. */
  readonly unsettled?: string;
  /** What lab mode could not read of what the app showed: its page, or a layout it loaded. */
  readonly unreadable?: readonly string[];
  /** The screenshot's file name, in `--out`. */
  readonly screenshot?: string;
}

/**
 * What the new app's pages draw themselves, outside any layout file, by the properties they read:
 *
 * - **`document`**, the document page (`lib-document-detail`): its header's title, and the
 *   Properties panel (`nxs-properties-panel`, `properties-panel.component.ts` in
 *   libs/shared/satori-components), with the note's format the page hands it;
 * - **`browse`**, a folder's page (`lib-browse`): its info panel, `browse.html` and `browse.ts` in
 *   libs/features/browse, with a folder's details (`folderDetails`), the five rows of Web UI's
 *   folder metadata layout. Its State row also reads `dc:nature`, and is not what counts it: it
 *   shows the value under another name than Web UI's Nature, which the details' Nature row uses.
 *
 * A copy of those files: `lab.spec.ts` holds it to them, so the two cannot drift apart unseen.
 */
export const DRAWN_BY_THE_PAGE: Readonly<Record<AppPage, ReadonlySet<string>>> = {
  document: new Set([
    'dc:title',
    'dc:description',
    'dc:nature',
    'dc:subjects',
    'dc:coverage',
    'dc:expired',
    'dc:created',
    'dc:modified',
    'dc:creator',
    'dc:contributors',
    'nxtag:tags',
    'file:content',
    'note:mime_type',
  ]),
  browse: new Set([
    'dc:title',
    'dc:created',
    'dc:creator',
    'dc:lastContributor',
    'nxtag:tags',
    'dc:description',
    'dc:nature',
    'dc:subjects',
    'dc:coverage',
    'dc:expired',
  ]),
  other: new Set(),
};

/** The modes of the new app's layout files its document page shows: the record page and its panel. */
export const SHOWN_MODES: ReadonlySet<string> = new Set(['view', 'metadata']);

/** The headers a request names the schemas it wants in. */
const PROPERTY_HEADERS = ['properties', 'x-nxproperties', 'x-nxdocumentproperties'];
/** The headers a request names a document's enrichers in. */
const ENRICHER_HEADERS = ['enrichers-document', 'enrichers.document'];

/** Where Web UI loads a type's document layout from, as Studio and Web UI write them. */
export function webUiLayoutPath(type: string, mode: string): string {
  const name = type.toLowerCase();
  return `document/${name}/nuxeo-${name}-${mode}-layout.html`;
}

/** The mode of a Web UI document layout of `type` at `path` under `/ui/`, or `null`. */
export function webUiLayoutMode(type: string, path: string): string | null {
  const name = type.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`/ui/document/${name}/nuxeo-${name}-([a-z]+)-layout\\.html$`).exec(path)?.[1] ?? null
  );
}

/** The mode of a new app layout file of `type` at `path`, wherever it is served from, or `null`. */
export function appLayoutMode(type: string, path: string): string | null {
  const name = encodeURIComponent(type).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/layouts/${name}/([A-Za-z]+)\\.layout\\.json$`).exec(path)?.[1] ?? null;
}

/**
 * Web UI's document layouts, given as the files it loaded, read as the inventory reads a
 * package's: parsed with its markup reader, which runs nothing, its fields the elements marked
 * `role="widget"`, and its conditions what the inventory takes for one (`isCondition`).
 *
 * A field shows each property it names: every `document.properties.<prefix>:<name>` in its
 * attributes and text, and each `xpath` that is a property, as `nuxeo-document-blob` takes one.
 * Each place a property is named is under a condition or not, so one field can show a property to
 * everyone and another only while a condition passes. A property named outside every field is
 * read the same way: Web UI shows it as much.
 */
export function webUiLayouts(
  files: readonly { readonly path: string; readonly status: number; readonly body: Buffer }[],
  type: string,
): LoadedLayout[] {
  return files.flatMap((file): LoadedLayout[] => {
    const mode = webUiLayoutMode(type, file.path);
    if (mode === null) return [];
    if (file.status !== 200) return [{ path: file.path, status: file.status, mode, fields: [] }];
    const { fields, unbound, outside } = layoutBindings(file.body.toString('utf8'));
    return [{ path: file.path, status: file.status, mode, fields, unbound, outside }];
  });
}

/** Every property a Web UI layout names, each held to whether it is named outside a condition. */
function layoutBindings(html: string): {
  fields: { xpath: string; conditional: boolean }[];
  unbound: string[];
  outside: string[];
} {
  const widgets: { element: string; shown: Set<string>; guarded: Set<string> }[] = [];
  const loose = { shown: new Set<string>(), guarded: new Set<string>() };
  const name = (texts: readonly string[], widget: number | null, guarded: boolean): void => {
    const into = widget === null ? loose : widgets[widget];
    for (const text of texts)
      for (const match of text.matchAll(/document\.properties\.([\w-]+:[\w-]+)/g))
        (guarded ? into.guarded : into.shown).add(match[1]);
  };
  // Walked by hand, as the inventory walks conditions: a template's content does not lead back to
  // the template, so what is around a place cannot be found by climbing from it.
  const visit = (node: ParentNode, widget: number | null, guarded: boolean): void => {
    name(
      Array.from(node.childNodes)
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent ?? ''),
      widget,
      guarded,
    );
    for (const child of Array.from(node.children)) {
      const at =
        child.getAttribute('role') === 'widget'
          ? widgets.push({ element: child.localName, shown: new Set(), guarded: new Set() }) - 1
          : widget;
      // A condition's own attributes test a value rather than show it: they count as under it.
      const under = guarded || isCondition(child);
      name(
        Array.from(child.attributes).map((attribute) => attribute.value),
        at,
        under,
      );
      const xpath = child.getAttribute('xpath') ?? '';
      if (/^[\w-]+:[\w-]+$/.test(xpath)) name([`document.properties.${xpath}`], at, under);
      visit(child, at, under);
      const content = (child as Partial<HTMLTemplateElement>).content;
      if (child.localName === 'template' && content) visit(content, at, under);
    }
  };
  visit(parseHtml(html), null, false);

  const fields: { xpath: string; conditional: boolean }[] = [];
  const add = (shown: ReadonlySet<string>, guarded: ReadonlySet<string>): void => {
    for (const xpath of shown) fields.push({ xpath, conditional: false });
    for (const xpath of guarded) if (!shown.has(xpath)) fields.push({ xpath, conditional: true });
  };
  for (const widget of widgets) add(widget.shown, widget.guarded);
  add(loose.shown, loose.guarded);
  return {
    fields,
    unbound: widgets
      .filter((widget) => widget.shown.size === 0 && widget.guarded.size === 0)
      .map((widget) => widget.element),
    outside: [...new Set([...loose.shown, ...loose.guarded])],
  };
}

/** The new app's layout files for the type, given as it loaded them, by the fields they list. */
export function appLayouts(
  files: readonly { readonly path: string; readonly status: number; readonly body: Buffer }[],
  type: string,
): LoadedLayout[] {
  return files.flatMap((file) => {
    const mode = appLayoutMode(type, file.path);
    if (mode === null) return [];
    let parsed: unknown = null;
    if (file.status === 200) {
      try {
        parsed = JSON.parse(file.body.toString('utf8'));
      } catch {
        parsed = null;
      }
    }
    // The configuration servlet, and `npm run config:dev` after it, answer a layout in an
    // envelope of the fragment it came from; the app registry answers the file itself.
    if (isObject(parsed) && parsed['layer'] === 'layout' && isObject(parsed['content']))
      parsed = parsed['content'];
    return [
      {
        path: file.path,
        status: file.status,
        mode,
        fields: layoutFields(parsed).flatMap((field) =>
          field.field !== null && field.field.includes(':')
            ? [{ xpath: field.field, conditional: false }]
            : [],
        ),
      },
    ];
  });
}

/** True when `request` asks for the document itself: a read of it by id or by path, no adapter. */
export function asksForTheDocument(request: RecordedRequest, document: LabDocument): boolean {
  if (request.method !== 'GET') return false;
  let path: string;
  try {
    path = decodeURIComponent(request.path).replace(/\/+$/, '');
  } catch {
    return false;
  }
  const api = /^\/nuxeo\/api\/v1(?:\/repo\/[^/]+)?\/(.*)$/.exec(path)?.[1];
  if (api === undefined) return false;
  return api === `id/${document.uid}` || `/${api}` === `/path${document.path}`;
}

/** The schemas a request asks for, as the browser sent it: `*` for every one. */
export function schemasAsked(request: RecordedRequest): Set<string> {
  const schemas = new Set<string>();
  for (const header of PROPERTY_HEADERS)
    for (const schema of (request.asks[header] ?? '').split(','))
      if (schema.trim()) schemas.add(schema.trim());
  return schemas;
}

/** The document enrichers a request asks for. */
export function enrichersAsked(request: RecordedRequest): Set<string> {
  const enrichers = new Set<string>();
  for (const header of ENRICHER_HEADERS)
    for (const name of (request.asks[header] ?? '').split(','))
      if (name.trim()) enrichers.add(name.trim());
  return enrichers;
}

export interface DocumentComparison {
  readonly document: LabDocument;
  /** Checks 6 and 7, on this document's page, in the harness's form. */
  readonly checks: readonly CheckResult[];
  /** What each app asked, side by side, one line each. */
  readonly listing: readonly string[];
  /** True when the comparison could not be made as the user: the run's environment is wrong. */
  readonly identityFailed: boolean;
}

const NOT_YET_7 =
  "The document's page only: the lists and buttons, and their result counts, are not recorded in lab mode yet";

/** One document's two recordings, held to the rule. */
export function compareDocument(
  document: LabDocument,
  web: AppRecording,
  app: AppRecording,
): DocumentComparison {
  const listing = listingOf(document, web, app);
  const identity = [
    ...web.identity.map((problem) => `Web UI: ${problem}`),
    ...app.identity.map((problem) => `the new app: ${problem}`),
  ];
  const seen: CheckResult = {
    number: 6,
    name: 'What people see',
    status: 'partial',
    findings: [],
    reason: `${
      web.screenshot && app.screenshot
        ? `Screenshots of both apps are in ${web.screenshot} and ${app.screenshot}`
        : 'No screenshot was taken'
    }; the values are not compared yet`,
  };
  // A page still sending, or one lab mode could not read in full, would hold the rule to less
  // than either app showed: such a document is not compared.
  const unread = [web, app].flatMap((recording) => [
    ...[
      ...(recording.unreadable ?? []),
      ...recording.layouts.flatMap((layout) =>
        layout.unreadable === undefined ? [] : [`its layout ${layout.path}: ${layout.unreadable}`],
      ),
      ...(recording.unsettled ? [recording.unsettled] : []),
    ].map((problem) => `${APP_NAMES[recording.app]}: ${problem}`),
  ]);
  if (identity.length > 0 || unread.length > 0) {
    const reason =
      identity.length > 0
        ? `Not compared, because not every request ran as the user: ${identity.join('; ')}`
        : `Not compared, because lab mode could not read all each app showed, or a page did not settle: ${unread.join('; ')}`;
    return {
      document,
      listing,
      identityFailed: identity.length > 0,
      checks: [
        { ...seen, status: 'not run', reason },
        { number: 7, name: 'What the server is asked', status: 'not run', findings: [], reason },
      ],
    };
  }

  const findings: string[] = [];
  const webAsks = web.requests.filter((request) => asksForTheDocument(request, document));
  const appAsks = app.requests.filter((request) => asksForTheDocument(request, document));
  if (webAsks.length === 0) {
    const reason =
      "Web UI's page never asked for the document, so there is nothing to hold the new app to: did it open the document?";
    return {
      document,
      listing,
      identityFailed: false,
      checks: [
        { ...seen, status: 'not run', reason },
        { number: 7, name: 'What the server is asked', status: 'not run', findings: [], reason },
      ],
    };
  }

  // 1. The document.
  const read = (asks: readonly RecordedRequest[]): boolean =>
    asks.some((request) => request.status === 200);
  if (appAsks.length === 0)
    findings.push(
      `the new app never asks for the document, which Web UI asks for with ${described(webAsks[0])}`,
    );
  else if (read(webAsks) !== read(appAsks))
    findings.push(
      `the document is answered ${statuses(webAsks)} to Web UI and ${statuses(appAsks)} to the new app`,
    );

  // 2. Its schemas.
  const union = (asks: readonly RecordedRequest[]): Set<string> =>
    new Set(asks.flatMap((request) => [...schemasAsked(request)]));
  const webSchemas = union(webAsks);
  const appSchemas = union(appAsks);
  if (appAsks.length > 0 && !appSchemas.has('*')) {
    if (webSchemas.has('*'))
      findings.push(
        `Web UI asks for the document with every schema (*), the new app only with ${appSchemas.size > 0 ? [...appSchemas].sort().join(', ') : 'none'}`,
      );
    else
      for (const schema of [...webSchemas].sort())
        if (!appSchemas.has(schema))
          findings.push(
            `Web UI asks for the document with the schema ${schema}, the new app does not`,
          );
  }

  // 3. Its properties.
  const fetched = (asks: readonly RecordedRequest[]): Set<string> =>
    new Set(
      asks
        .filter((request) => request.status === 200)
        .flatMap((request) => request.documentProperties ?? []),
    );
  const webFetched = fetched(webAsks);
  const appFetched = fetched(appAsks);
  // A layout file for a form, `edit` or `create`, shows nothing on the document's page.
  const appShows = new Set([
    ...(app.page?.fields ?? []),
    ...app.layouts
      .filter((layout) => layout.status === 200 && SHOWN_MODES.has(layout.mode))
      .flatMap((layout) => layout.fields.map((field) => field.xpath)),
    ...DRAWN_BY_THE_PAGE[app.page?.kind ?? 'other'],
  ]);
  const held = new Set<string>();
  for (const layout of web.layouts.filter((candidate) => candidate.status === 200))
    for (const field of layout.fields) {
      if (field.conditional || !webFetched.has(field.xpath) || held.has(field.xpath)) continue;
      held.add(field.xpath);
      const where = layoutName(layout.path);
      if (!appFetched.has(field.xpath))
        findings.push(`Web UI shows ${field.xpath} (${where}); the new app does not fetch it`);
      else if (!appShows.has(field.xpath))
        findings.push(
          `Web UI shows ${field.xpath} (${where}); the new app fetches it, but its ${pageName(app.page?.kind)} does not show it: no field of the page, no layout file it loaded for ${document.type}, and no row it draws itself`,
        );
    }

  return {
    document,
    listing,
    identityFailed: false,
    checks: [
      seen,
      {
        number: 7,
        name: 'What the server is asked',
        status: findings.length > 0 ? 'fail' : 'partial',
        findings,
        reason: NOT_YET_7,
      },
    ],
  };
}

/** What each app asked and loaded, side by side, for the reviewer. */
function listingOf(document: LabDocument, web: AppRecording, app: AppRecording): string[] {
  const lines: string[] = [];
  const both = [web, app];
  const asks = (recording: AppRecording): RecordedRequest[] =>
    recording.requests.filter((request) => asksForTheDocument(request, document));

  lines.push(
    `Requests to Nuxeo: ${both
      .map((recording) => {
        const api = recording.requests.filter((request) => request.path.startsWith('/nuxeo/api/'));
        const refused = recording.requests.filter((request) => request.status === 'refused');
        return `${APP_NAMES[recording.app]} ${api.length}${refused.length ? `, ${refused.length} refused by lab mode` : ''}`;
      })
      .join('; ')}`,
  );
  for (const recording of both) {
    const own = asks(recording);
    lines.push(
      `${capital(APP_NAMES[recording.app])} asks for the document: ${
        own.length === 0
          ? 'never'
          : own
              .map(
                (request) =>
                  `${described(request)}, with ${[...schemasAsked(request)].join(', ') || 'no schema'}`,
              )
              .join('; ')
      }`,
    );
  }
  const enrichers = both.map(
    (recording) => new Set(asks(recording).flatMap((request) => [...enrichersAsked(request)])),
  );
  lines.push(...sideBySide("The document's enrichers", enrichers[0], enrichers[1]));

  lines.push(
    `Web UI's layouts for ${document.type}: ${
      web.layouts.length === 0
        ? 'none loaded'
        : web.layouts
            .map((layout) => {
              const conditional = layout.fields.filter((field) => field.conditional).length;
              const unbound = layout.unbound ?? [];
              const outside = layout.outside ?? [];
              return `${layoutName(layout.path)} ${layout.status}${
                layout.status === 200
                  ? `, binding ${layout.fields.map((field) => field.xpath).join(', ') || 'no property'}${conditional ? `, ${conditional} of them under a condition, not held` : ''}${outside.length ? `; ${outside.join(', ')} named outside every field` : ''}${unbound.length ? `; ${unbound.length === 1 ? 'a field' : `${unbound.length} fields`} naming no property, not held: ${unbound.join(', ')}` : ''}`
                  : ''
              }`;
            })
            .join('; ')
    }`,
  );
  if (!web.layouts.some((layout) => layout.status === 200))
    lines.push(
      `Web UI has no document layout for ${document.type} on this server, so the rule holds none of the document's properties: what Web UI's page shows outside its layouts, such as its info rows, it does not hold yet`,
    );
  const kind = app.page?.kind ?? 'other';
  lines.push(
    `The new app's page: ${pageName(kind)}, with ${
      (app.page?.fields ?? []).length > 0
        ? `the fields ${[...new Set(app.page?.fields)].join(', ')}`
        : 'no field of a layout'
    }; its layout files for ${document.type}: ${
      app.layouts.length === 0
        ? 'none loaded'
        : app.layouts
            .map(
              (layout) =>
                `${layout.path} ${layout.status}, listing ${layout.fields.map((field) => field.xpath).join(', ') || 'no property'}`,
            )
            .join('; ')
    }; the rows it draws itself: ${[...DRAWN_BY_THE_PAGE[kind]].join(', ') || 'none'}`,
  );

  const providers = both.map((recording) => providersOf(recording.requests));
  for (const [index, recording] of both.entries())
    lines.push(
      `${capital(APP_NAMES[recording.app])}'s page providers: ${providers[index].join('; ') || 'none'}`,
    );
  const endpoints = both.map(
    (recording) =>
      new Set(
        recording.requests
          .filter(
            (request) => request.path.startsWith('/nuxeo/api/') && request.status !== 'refused',
          )
          .map((request) => endpointOf(request, document)),
      ),
  );
  lines.push(...sideBySide('Other endpoints', endpoints[0], endpoints[1]));
  for (const recording of both) {
    const refused = recording.requests.filter((request) => request.status === 'refused');
    if (refused.length > 0)
      lines.push(
        `Refused by lab mode, so never sent, from ${APP_NAMES[recording.app]}: ${[
          ...new Set(
            refused.map(
              (request) => `${request.method} ${shortPath(request.path)} (${request.reason})`,
            ),
          ),
        ].join('; ')}`,
      );
    if (recording.unsettled)
      lines.push(`${capital(APP_NAMES[recording.app])}: ${recording.unsettled}`);
  }
  return lines;
}

/** Two sets as one line in common, and one line for each side's own, when it has any. */
function sideBySide(what: string, web: ReadonlySet<string>, app: ReadonlySet<string>): string[] {
  const common = [...web].filter((item) => app.has(item)).sort();
  const webOnly = [...web].filter((item) => !app.has(item)).sort();
  const appOnly = [...app].filter((item) => !web.has(item)).sort();
  return [
    `${what}, asked by both: ${common.join(', ') || 'none'}`,
    ...(webOnly.length ? [`${what}, by Web UI only: ${webOnly.join(', ')}`] : []),
    ...(appOnly.length ? [`${what}, by the new app only: ${appOnly.join(', ')}`] : []),
  ];
}

/** Each page provider a recording asked, with its parameters, page size and result count. */
function providersOf(requests: readonly RecordedRequest[]): string[] {
  const seen = new Set<string>();
  for (const request of requests) {
    const name = /\/search\/pp\/([^/]+)\/execute$/.exec(request.path)?.[1];
    if (name === undefined) continue;
    const query = new URLSearchParams(request.query);
    const parameters = [...query]
      .filter(([key]) => !['currentPageIndex', 'offset', 'pageSize'].includes(key))
      .map(([key, value]) => `${key}=${value.length > 80 ? `${value.slice(0, 77)}...` : value}`);
    seen.add(
      `${decodeURIComponent(name)} (${parameters.join(', ') || 'no parameter'}; page size ${query.get('pageSize') ?? "the provider's"}) ${request.status}${
        request.resultsCount === undefined ? '' : `, ${request.resultsCount} results`
      }`,
    );
  }
  return [...seen];
}

/** A request as an endpoint: its method and path, the document's id and path written `{doc}`. */
function endpointOf(request: RecordedRequest, document: LabDocument): string {
  let path = request.path;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Kept as sent.
  }
  path = shortPath(path)
    .split(document.uid)
    .join('{doc}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{id}');
  if (path.startsWith(`path${document.path}`))
    path = `path{doc}${path.slice(`path${document.path}`.length)}`;
  return `${request.method} ${path}`;
}

function shortPath(path: string): string {
  return path.replace(/^\/nuxeo\/api\/v1\//, '').replace(/^\/nuxeo\//, '/');
}

function described(request: RecordedRequest): string {
  return `${request.method} ${request.path} ${request.status}`;
}

function statuses(asks: readonly RecordedRequest[]): string {
  return [...new Set(asks.map((request) => String(request.status)))].join(' and ');
}

function layoutName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function pageName(kind: AppPage | undefined): string {
  return kind === 'document'
    ? 'document page'
    : kind === 'browse'
      ? "folder's page (Browse)"
      : 'page, which is neither its document page nor Browse';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
