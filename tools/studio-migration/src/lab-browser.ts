/**
 * Lab mode's browser: one document opened in Web UI and in the new app, each in a fresh Chromium
 * context, as the same user, with every request each sends recorded (`lab.ts` compares them).
 *
 * - **Read only.** Every request either app sends goes through {@link refusal} first: anything
 *   but a `GET`, `HEAD` or `OPTIONS` is refused, unless it runs one of the
 *   {@link READ_ONLY_OPERATIONS}, and so is every download, which the server may write to its
 *   audit log. A refused request is never sent, and is listed in the report.
 * - **As the same user.** Web UI is sent the user's `Authorization` on every request to the Nuxeo
 *   server's origin, and nowhere else. The new app is given the session its sign-in writes, as
 *   the Beta harness's `h.login()` gives it, before its first script runs, and every request it
 *   sends to Nuxeo's API must carry that header. Each `/me` either app reads, and Web UI's
 *   sign-in, must name the user (the Beta harness's identity guard, `judgeMe`).
 * - **Playwright is not a dependency** of this repository, as for the Beta harness: it is loaded
 *   when lab mode runs, and installed with `npm install --no-save @playwright/test`.
 *
 * The credentials stay in memory: in the header and the session given to the browser, and nowhere
 * in what is recorded, printed or written.
 */
import { join } from 'node:path';
import { judgeMe, sameUser } from '../../../scripts/beta-harness/identity-guard.mjs';
import {
  appLayouts,
  asksForTheDocument,
  webUiLayoutMode,
  webUiLayouts,
  appLayoutMode,
  type AppPage,
  type AppRecording,
  type LabApp,
  type LabDocument,
  type RecordedRequest,
} from './lab';

/** The operations lab mode lets an app run: each only reads. */
export const READ_ONLY_OPERATIONS: ReadonlySet<string> = new Set([
  // Web UI's sign-in, `/automation/login`: it answers who the user is.
  'login',
  'Repository.Query',
  'Repository.PageProvider',
  'Directory.SuggestEntries',
  // The document's history, which the new app reads.
  'Audit.QueryWithPageProvider',
  // The user's synchronisation roots, which Web UI's Drive add-on reads.
  'NuxeoDrive.GetRoots',
]);

/** Why lab mode refuses to send a request, or `null` when it may go. */
export function refusal(method: string, url: URL): string | null {
  const path = url.pathname;
  if (
    /\/@(?:blob|rendition|preview|convert)(?:\/|$)/.test(path) ||
    /^\/nuxeo\/(?:nxfile|nxbigfile|nxthumb|nxpicsfile|nxdoc)\//.test(path)
  )
    return 'a download, which the server may write to its audit log';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
  const operation = /\/automation\/([^/]+)$/.exec(path)?.[1];
  let name = operation;
  try {
    name = operation === undefined ? undefined : decodeURIComponent(operation);
  } catch {
    // Kept as sent, and so on no list.
  }
  if (method === 'POST' && name !== undefined && READ_ONLY_OPERATIONS.has(name)) return null;
  return name === undefined
    ? `a ${method}, which may write`
    : `the operation ${name}, which may write`;
}

/** A fault lab mode puts into what the new app sends or receives, for the rule to report. */
export type LabControl =
  | { readonly kind: 'withhold-property'; readonly xpath: string }
  | { readonly kind: 'narrow-schemas'; readonly schemas: string };

export const LAB_CONTROLS: readonly { readonly name: string; readonly description: string }[] = [
  {
    name: 'withhold-property=<prefix:field>',
    description:
      'takes the property out of every answer for the document the new app receives, as an app that never asked for it would; the rule must report that Web UI shows it and the new app does not fetch it',
  },
  {
    name: 'narrow-schemas=<schema,...>',
    description:
      'makes the new app ask for the document with those schemas alone; the rule must report a schema Web UI asks for that it does not',
  },
];

/** The control `--control` names, or the reason it names none. */
export function labControl(text: string): LabControl | string {
  const [name, value] = [text.slice(0, text.indexOf('=')), text.slice(text.indexOf('=') + 1)];
  if (text.includes('=') && name === 'withhold-property' && /^[\w-]+:[\w-]+$/.test(value))
    return { kind: 'withhold-property', xpath: value };
  if (text.includes('=') && name === 'narrow-schemas' && /^[\w-]+(?:,[\w-]+)*$/.test(value))
    return { kind: 'narrow-schemas', schemas: value };
  return `${text} is not a control: ${LAB_CONTROLS.map((control) => control.name).join(', ')}`;
}

export interface LabTarget {
  /** The Nuxeo server's origin, such as `http://localhost:8080`. */
  readonly nuxeo: string;
  /** Web UI's address, such as `http://localhost:8080/nuxeo/ui/`. */
  readonly webUi: string;
  /** The new app's address, such as `http://localhost:4200/`. */
  readonly app: string;
}

export interface LabCredentials {
  readonly username: string;
  readonly password: string;
}

// What lab mode uses of Playwright: it is not a dependency, so its types are not in hand.
interface PwResponse {
  status(): number;
  body(): Promise<Buffer>;
}
interface PwRequest {
  method(): string;
  url(): string;
  resourceType(): string;
  headers(): Record<string, string>;
  allHeaders(): Promise<Record<string, string>>;
  response(): Promise<PwResponse | null>;
  failure(): { errorText: string } | null;
}
interface PwRoute {
  request(): PwRequest;
  abort(code?: string): Promise<void>;
  continue(options?: { headers?: Record<string, string> }): Promise<void>;
  fetch(): Promise<PwResponse & { headers(): Record<string, string> }>;
  fulfill(options: {
    status: number;
    headers: Record<string, string>;
    body: string;
  }): Promise<void>;
}
interface PwPage {
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  on(
    event: 'request' | 'requestfinished' | 'requestfailed',
    handler: (request: PwRequest) => void,
  ): void;
  evaluate<R>(script: string): Promise<R>;
  screenshot(options: { path: string }): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  route(url: string, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  close(): Promise<void>;
}
export interface PwBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    serviceWorkers: 'block';
  }): Promise<PwContext>;
  close(): Promise<void>;
}

/** Chromium, from a Playwright installed beside the repository, or the reason there is none. */
export async function launchChromium(): Promise<PwBrowser | string> {
  let chromium: { launch(options: { headless: boolean }): Promise<PwBrowser> };
  try {
    // A name in a variable, so that nothing resolves it before lab mode runs.
    const name = '@playwright/test';
    ({ chromium } = (await import(name)) as { chromium: typeof chromium });
  } catch {
    return 'Playwright is not installed. It is not a dependency of this repository, as for the Beta harness: npm install --no-save @playwright/test, then npx playwright install chromium';
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    return `Chromium did not start: ${(error as Error).message.split('\n')[0]}. npx playwright install chromium`;
  }
}

/** Where the new app keeps its session, as `scripts/beta-harness/helpers.mjs` writes it. */
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/** How long a page must send nothing to count as settled, and the most lab mode waits for it. */
export const QUIET_MS = 2_000;
export const SETTLE_MS = 60_000;
const VIEWPORT = { width: 1440, height: 900 };
/** Requests whose kind says they are code or pictures: sent, never recorded. */
const STATIC_KINDS = new Set(['script', 'stylesheet', 'image', 'font', 'media', 'manifest']);
const ASK_HEADERS =
  /^(?:properties|x-nxproperties|x-nxdocumentproperties|enrichers[-.].+|fetch[-.].+|depth)$/;

export interface RecordOptions {
  /** Where the screenshot goes: `--out`, and its file name there. */
  readonly screenshot: { readonly out: string; readonly file: string };
  /** A fault to put into the new app's side; Web UI's is never touched. */
  readonly control?: LabControl;
  /** How long a page must send nothing, and the most lab mode waits; the defaults otherwise. */
  readonly quietMs?: number;
  readonly settleMs?: number;
}

/** Opens `document` in `app`, records what it sends, and takes a screenshot. */
export async function recordApp(
  browser: PwBrowser,
  app: LabApp,
  target: LabTarget,
  credentials: LabCredentials,
  document: LabDocument,
  options: RecordOptions,
): Promise<AppRecording> {
  const { screenshot, quietMs = QUIET_MS, settleMs = SETTLE_MS } = options;
  const control = app === 'new-app' ? options.control : undefined;
  const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  const nuxeoOrigin = new URL(target.nuxeo).origin;
  const appOrigin = new URL(target.app).origin;
  const url =
    app === 'web-ui'
      ? `${target.webUi.replace(/\/?$/, '/')}#!/doc/${document.uid}`
      : `${target.app.replace(/\/?$/, '/')}#/doc/${document.uid}`;
  const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    const refused = new Map<PwRequest, string>();
    /** What a request was sent with, where lab mode changed it, for the record to say so. */
    const sentWith = new Map<PwRequest, Record<string, string>>();
    const injected = new Set<PwRequest>();

    if (app === 'web-ui') {
      // Web UI waits for an `automation-ready` event under automation unless this is set
      // (main.bundle.js: `!navigator.webdriver || window.automationReady`).
      await context.addInitScript({ content: 'window.automationReady = true;' });
    } else {
      // The session the app's sign-in writes, in place before its first script runs, as
      // `h.login()` writes it (scripts/beta-harness/helpers.mjs), so that it never boots signed out.
      const session = JSON.stringify({
        kind: 'basic',
        username: credentials.username,
        basic: Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'),
        isAdministrator: credentials.username.toLowerCase() === 'administrator',
        groups: [],
      });
      await context.addInitScript({
        content: `if (location.origin === ${JSON.stringify(appOrigin)}) { localStorage.removeItem(${JSON.stringify(SESSION_KEY)}); sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(session)}); sessionStorage.removeItem(${JSON.stringify(SIGNED_OUT_KEY)}); }`,
      });
    }

    await context.route('**/*', async (route) => {
      const request = route.request();
      const at = new URL(request.url());
      const why = refusal(request.method(), at);
      if (why !== null) {
        refused.set(request, why);
        await route.abort('blockedbyclient');
        return;
      }
      // `control` is the new app's alone, so Web UI's requests are never changed.
      const theDocument =
        control !== undefined &&
        asksForTheDocument(
          {
            method: request.method(),
            path: at.pathname,
            query: at.search,
            kind: '',
            asks: {},
            status: 0,
            signed: false,
          },
          document,
        );
      if (theDocument && control?.kind === 'narrow-schemas') {
        const headers = Object.fromEntries(
          Object.entries(request.headers()).filter(
            ([name]) => !['properties', 'x-nxproperties', 'x-nxdocumentproperties'].includes(name),
          ),
        );
        headers['properties'] = control.schemas;
        sentWith.set(request, headers);
        await route.continue({ headers });
        return;
      }
      if (theDocument && control?.kind === 'withhold-property') {
        const response = await route.fetch();
        const text = (await response.body()).toString('utf8');
        let body = text;
        try {
          const parsed = JSON.parse(text) as { properties?: Record<string, unknown> };
          if (parsed.properties && typeof parsed.properties === 'object')
            delete parsed.properties[control.xpath];
          body = JSON.stringify(parsed);
        } catch {
          // Not JSON: passed on as it came.
        }
        const headers = { ...response.headers() };
        delete headers['content-length'];
        delete headers['content-encoding'];
        await route.fulfill({ status: response.status(), headers, body });
        return;
      }
      if (app === 'web-ui' && at.origin === nuxeoOrigin) {
        injected.add(request);
        await route.continue({ headers: { ...request.headers(), authorization } });
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const recorded: Promise<RecordedRequest | null>[] = [];
    const layoutFiles: Promise<{ path: string; status: number; body: Buffer } | null>[] = [];
    let inFlight = 0;
    let lastActivity = Date.now();

    const nuxeoBound = (at: URL): boolean =>
      at.origin === nuxeoOrigin || (at.origin === appOrigin && at.pathname.startsWith('/nuxeo/'));
    const interesting = (request: PwRequest, at: URL): boolean =>
      refused.has(request) ||
      (nuxeoBound(at) && !STATIC_KINDS.has(request.resourceType())) ||
      (app === 'new-app' &&
        at.origin === appOrigin &&
        appLayoutMode(document.type, at.pathname) !== null);

    page.on('request', () => {
      inFlight++;
      lastActivity = Date.now();
    });
    const done = (request: PwRequest, failed: boolean): void => {
      inFlight = Math.max(0, inFlight - 1);
      lastActivity = Date.now();
      const at = new URL(request.url());
      if (!interesting(request, at)) return;
      recorded.push(record(request, at, failed));
      const layout =
        app === 'web-ui'
          ? webUiLayoutMode(document.type, at.pathname)
          : appLayoutMode(document.type, at.pathname);
      if (layout !== null && !failed)
        layoutFiles.push(
          request
            .response()
            .then(async (response) =>
              response
                ? { path: at.pathname, status: response.status(), body: await response.body() }
                : null,
            )
            .catch(() => null),
        );
    };
    page.on('requestfinished', (request) => done(request, false));
    page.on('requestfailed', (request) => done(request, true));

    const record = async (
      request: PwRequest,
      at: URL,
      failed: boolean,
    ): Promise<RecordedRequest | null> => {
      const headers =
        sentWith.get(request) ?? (await request.allHeaders().catch(() => request.headers()));
      const asks = Object.fromEntries(
        Object.entries(headers).filter(([name]) => ASK_HEADERS.test(name)),
      );
      const signed =
        app === 'web-ui' ? injected.has(request) : headers['authorization'] === authorization;
      const base = {
        method: request.method(),
        path: at.pathname,
        query: at.search,
        kind: request.resourceType(),
        asks,
        signed,
      };
      if (refused.has(request)) return { ...base, status: 'refused', reason: refused.get(request) };
      if (failed)
        return { ...base, status: 'failed', reason: request.failure()?.errorText ?? 'no answer' };
      const response = await request.response().catch(() => null);
      if (!response) return { ...base, status: 'failed', reason: 'no answer' };
      const status = response.status();
      const extra: {
        documentProperties?: readonly string[];
        resultsCount?: number;
        answeredAs?: string | null;
        answeredAnonymous?: boolean;
      } = {};
      const answer = at.pathname.startsWith('/nuxeo/api/') ? await jsonOf(response) : undefined;
      const record: RecordedRequest = { ...base, status };
      if (isObject(answer)) {
        if (
          asksForTheDocument(record, document) &&
          answer['entity-type'] === 'document' &&
          answer['uid'] === document.uid
        )
          extra.documentProperties = Object.keys(
            isObject(answer['properties']) ? answer['properties'] : {},
          );
        if (typeof answer['resultsCount'] === 'number') extra.resultsCount = answer['resultsCount'];
        if (/\/api\/v1\/me\/?$/.test(at.pathname)) {
          extra.answeredAs = typeof answer['id'] === 'string' ? answer['id'] : null;
          extra.answeredAnonymous = answer['isAnonymous'] === true;
        }
        if (/\/automation\/login$/.test(at.pathname))
          extra.answeredAs = typeof answer['username'] === 'string' ? answer['username'] : null;
      }
      return { ...record, ...extra };
    };

    let unsettled: string | undefined;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: settleMs });
    } catch (error) {
      unsettled = `the page did not load within ${settleMs / 1000} s (${(error as Error).message.split('\n')[0]}); what it sent until then is recorded`;
    }
    const started = Date.now();
    while (unsettled === undefined) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, quietMs)));
      if (inFlight === 0 && Date.now() - lastActivity >= quietMs) break;
      if (Date.now() - started > settleMs)
        unsettled = `the page was still sending after ${settleMs / 1000} s; what it sent until then is recorded`;
    }

    let pageSeen: { kind: AppPage; fields: string[] } | undefined;
    if (app === 'new-app') {
      pageSeen = await page
        .evaluate<{ kind: AppPage; fields: string[] }>(
          `({
            kind: document.querySelector('lib-document-detail') ? 'document' : document.querySelector('lib-browse') ? 'browse' : 'other',
            fields: [...document.querySelectorAll('[data-field]')].map((element) => element.getAttribute('data-field')).filter((field) => field && field.includes(':')),
          })`,
        )
        .catch(() => ({ kind: 'other' as const, fields: [] }));
    }
    let shot: string | undefined;
    try {
      await page.screenshot({ path: join(screenshot.out, screenshot.file) });
      shot = screenshot.file;
    } catch {
      shot = undefined;
    }

    const requests = (await Promise.all(recorded)).filter(
      (request): request is RecordedRequest => request !== null,
    );
    const files = (await Promise.all(layoutFiles)).filter(
      (file): file is { path: string; status: number; body: Buffer } => file !== null,
    );
    return {
      app,
      url,
      requests,
      layouts:
        app === 'web-ui' ? webUiLayouts(files, document.type) : appLayouts(files, document.type),
      ...(pageSeen ? { page: pageSeen } : {}),
      identity: identityProblems(app, requests, credentials.username),
      ...(unsettled ? { unsettled } : {}),
      ...(shot ? { screenshot: shot } : {}),
    };
  } finally {
    await context.close();
  }
}

/**
 * What says a recording did not run as the user: a request to Nuxeo's API sent without the user's
 * header, a `/me` or sign-in that names someone else or the guest, or no answer naming anyone.
 */
export function identityProblems(
  app: LabApp,
  requests: readonly RecordedRequest[],
  username: string,
): string[] {
  const problems: string[] = [];
  const unsigned = requests.filter(
    (request) =>
      request.path.startsWith('/nuxeo/api/') && request.status !== 'refused' && !request.signed,
  );
  if (unsigned.length > 0)
    problems.push(
      `${unsigned.length} ${unsigned.length === 1 ? 'request' : 'requests'} to Nuxeo's API went out without the user's credentials, such as ${unsigned[0].method} ${unsigned[0].path}`,
    );
  const answers = requests.filter((request) => request.answeredAs !== undefined);
  for (const request of answers) {
    const problem = /\/automation\/login$/.test(request.path)
      ? request.status !== 200
        ? `its sign-in answered ${request.status}`
        : !sameUser(request.answeredAs, username)
          ? `its sign-in answered as ${String(request.answeredAs)}, not as ${username}`
          : null
      : judgeMe(
          {
            status: typeof request.status === 'number' ? request.status : 0,
            body:
              request.answeredAs === null
                ? {}
                : { id: request.answeredAs, isAnonymous: request.answeredAnonymous === true },
          },
          username,
        ).problem;
    if (problem !== null) problems.push(problem);
  }
  if (!answers.some((request) => request.status === 200 && sameUser(request.answeredAs, username)))
    problems.push(
      `nothing ${app === 'web-ui' ? 'Web UI' : 'the new app'} read said who its requests ran as: neither /me nor a sign-in was answered for ${username}`,
    );
  return [...new Set(problems)];
}

async function jsonOf(response: PwResponse): Promise<unknown> {
  try {
    return JSON.parse((await response.body()).toString('utf8'));
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
