#!/usr/bin/env node
/**
 * Offline controls for the identity guard (NXSAT-643): the judgement in `identity-guard.mjs` and
 * the step-boundary wiring in `helpers.mjs`, with no browser and no server.
 *
 * The live half — a real guest-enabled Nuxeo rejecting a dropped credential and an adopted guest
 * cookie — is `identity-guard.controls.mjs`. This half pins every rule those runs depend on, so a
 * guard edited into one that accepts `Anonymous`, ignores the stored session, trusts a stubbed or
 * redirected `/me`, ignores what the page's own requests carried, or lets a step boundary go
 * unchecked or unawaited turns this red without a server. Each negative
 * control names the rule it protects; the positives prove the guard does not reject good results,
 * which would make it an always-red gate that gets bypassed.
 *
 *   node scripts/beta-harness/identity-guard.selftest.mjs
 */

import { createHelpers, PreconditionError } from './helpers.mjs';
import {
  checkFetchIdentity,
  checkPageIdentity,
  checkRequestIdentity,
  createIdentityMonitor,
  isAnonymousMe,
  judgeApi,
  judgeApp,
  judgeMe,
  parseStoredSession,
  sameUser,
  watchNuxeoApiOrigins,
} from './identity-guard.mjs';

/** @type {{ name: string, kind: 'negative' | 'positive', ok: boolean, detail?: string }[]} */
const controls = [];
/**
 * @param {'negative' | 'positive'} kind
 * @param {string} name
 * @param {boolean} ok
 * @param {unknown} [detail]
 */
function control(kind, name, ok, detail) {
  controls.push({ name, kind, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });
}

const ADMIN = { 'entity-type': 'user', id: 'Administrator', isAnonymous: false };
const GUEST = { 'entity-type': 'user', id: 'Anonymous', isAnonymous: true };
const b64 = (s) => Buffer.from(s).toString('base64');
const basicSession = (username, basic = b64(`${username}:pw`)) =>
  JSON.stringify({ kind: 'basic', username, basic, isAdministrator: true, groups: [] });
const ok200 = (body) => ({ status: 200, body });
const both = (body) => ({ inPage: ok200(body), replayed: ok200(body) });

// ── judgeMe ──────────────────────────────────────────────────────────────────────────────────────
control(
  'positive',
  'the expected user is accepted',
  judgeMe(ok200(ADMIN), 'Administrator').problem === null,
);
control(
  'negative',
  'a differently cased id is rejected: not every directory ignores case, so the guard fails closed',
  judgeMe(ok200(ADMIN), 'administrator').problem !== null &&
    judgeMe(ok200({ id: 'alice' }), 'Alice').problem !== null,
);
control(
  'negative',
  'the guest is rejected by its flag',
  judgeMe(ok200(GUEST), 'Administrator').problem !== null,
);
control(
  'negative',
  'the guest is rejected by its id when the flag is missing, in any case',
  judgeMe(ok200({ id: 'Anonymous' }), 'Administrator').problem !== null &&
    judgeMe(ok200({ id: 'ANONYMOUS' }), 'Administrator').problem !== null,
);
control(
  'negative',
  'a flagged guest is rejected under any id',
  judgeMe(ok200({ id: 'Administrator', isAnonymous: true }), 'Administrator').problem !== null,
);
control(
  'negative',
  'another user is rejected',
  judgeMe(ok200({ id: 'jdoe' }), 'Administrator').problem !== null,
);
control(
  'negative',
  'a 401 is rejected',
  judgeMe({ status: 401, body: null }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a non-200 is rejected even when its body names the user',
  judgeMe({ status: 500, body: ADMIN }, 'Administrator').problem !== null,
);
control(
  'negative',
  'no answer is rejected',
  judgeMe({ status: 0, body: null, error: 'ECONNREFUSED' }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a 200 with no id is rejected',
  judgeMe(ok200({}), 'Administrator').problem !== null,
);
control(
  'negative',
  'a 200 that is not JSON is rejected',
  judgeMe(ok200(null), 'Administrator').problem !== null,
);
control(
  'negative',
  'expecting Anonymous, in any case, proves nothing',
  judgeMe(ok200(GUEST), 'Anonymous').problem !== null &&
    judgeMe(ok200(GUEST), 'anonymous').problem !== null,
);
control('negative', 'expecting nobody proves nothing', judgeMe(ok200(ADMIN), '').problem !== null);
control(
  'negative',
  'sameUser matches nothing for a non-string',
  !sameUser(undefined, undefined) && !sameUser('', ''),
);
control('positive', 'isAnonymousMe is false for a real user', !isAnonymousMe(ADMIN));

// ── stored sessions ─────────────────────────────────────────────────────────────────────────────
const parsed = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'sessionStorage',
  basicSession('Administrator', 'QUJD'),
);
control(
  'positive',
  'a basic session yields the header the app sends',
  !('problem' in parsed) &&
    parsed.authorization === 'Basic QUJD' &&
    parsed.username === 'Administrator',
  parsed,
);
const cookie = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'sessionStorage',
  JSON.stringify({ kind: 'cookie', username: 'Anonymous', isAdministrator: false, groups: [] }),
);
control(
  'positive',
  'a cookie session sends no header',
  !('problem' in cookie) && cookie.authorization === null,
  cookie,
);
const legacy = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'localStorage',
  JSON.stringify({ username: 'Administrator', basic: 'QUJD' }),
);
control(
  'positive',
  'a stored value without kind but with basic is read as basic, as the app does',
  !('problem' in legacy) && legacy.kind === 'basic',
  legacy,
);
const template = parseStoredSession(
  'satori_template_session',
  'sessionStorage',
  JSON.stringify({ username: 'Administrator', basic: 'QUJD' }),
);
control(
  'positive',
  "the template app's session is read",
  !('problem' in template) && template.authorization === 'Basic QUJD',
  template,
);
control(
  'negative',
  'a value that is not JSON is a problem',
  'problem' in parseStoredSession('k', 'sessionStorage', '{'),
);
control(
  'negative',
  'a basic session with no basic is a problem',
  'problem' in
    parseStoredSession('k', 'sessionStorage', JSON.stringify({ kind: 'basic', username: 'x' })),
);

// ── the app channel's policy ────────────────────────────────────────────────────────────────────
const NONE = { inPage: null, replayed: null };
control(
  'positive',
  'before the run signs in, no session is accepted as signed-out',
  judgeApp(null, NONE, { unsigned: 'Administrator' }).ok,
);
control(
  'positive',
  'before the run signs in, a page off the app is accepted',
  judgeApp('not-on-app', NONE, { unsigned: 'Administrator' }).ok,
);
control(
  'negative',
  'after the run signed in, losing the session is rejected (it can hide a guest result)',
  !judgeApp(null, NONE, 'Administrator').ok && !judgeApp(null, NONE, { user: 'Administrator' }).ok,
);
control(
  'negative',
  'after the run signed in, leaving the app is rejected',
  !judgeApp('not-on-app', NONE, 'Administrator').ok,
);
control(
  'negative',
  'even before signing in, a guest session the app adopted on its own is rejected',
  !judgeApp(cookie, NONE, { unsigned: 'Administrator' }).ok,
);
control(
  'positive',
  'a basic session for the user, confirmed both ways, is accepted',
  judgeApp(parsed, both(ADMIN), 'Administrator').ok,
);
control(
  'negative',
  "a guest's cookie session is rejected before /me is asked",
  !judgeApp(cookie, NONE, 'Administrator').ok,
);
control(
  'negative',
  'a session the server answers as the guest is rejected',
  !judgeApp(parsed, both(GUEST), 'Administrator').ok,
);
control(
  'negative',
  'a stubbed /me in the page cannot certify a session the server answers as someone else',
  !judgeApp(parsed, { inPage: ok200(ADMIN), replayed: ok200(GUEST) }, 'Administrator').ok,
);
control(
  'negative',
  'what the page sees counts too: a route stripping the header is rejected',
  !judgeApp(parsed, { inPage: ok200(GUEST), replayed: ok200(ADMIN) }, 'Administrator').ok,
);
control(
  'negative',
  'a session stored for another user is rejected even when /me agrees with the run',
  !judgeApp(
    parseStoredSession('agentic_ui_nuxeo_session', 'sessionStorage', basicSession('jdoe')),
    both(ADMIN),
    'Administrator',
  ).ok,
);
control(
  'negative',
  'an unreadable session is rejected',
  !judgeApp({ problem: 'x' }, NONE, 'Administrator').ok,
);
control(
  'negative',
  'the api channel rejects the guest',
  !judgeApi(ok200(GUEST), 'Administrator').ok,
);

// ── a fake page, for the probes and the step boundaries ─────────────────────────────────────────
/**
 * Just enough of a Playwright `Page`: `url()`, `evaluate()` that runs the real browser-side code
 * against stand-ins for storage and `fetch`, `request.get()`, `context().cookies()` and
 * `clearCookies()`, plus a `fetch` for the Node-side replay. `meFor` answers the page's `/me` by
 * the header sent; `replayFor` answers the replay (default: the same). `send()` makes the page
 * send a request to Nuxeo and finish it, as the app's HTTP client would.
 *
 * A redirected `/me` (`redirect*`) behaves as measured on Chromium: followed, the destination
 * answers as the administrator; not followed, the page sees an opaque redirect, Node a 302.
 */
function fakePage({
  url = 'http://app.test/#/browse',
  storage = {},
  meFor = () => ADMIN,
  replayFor,
  apiMe = ADMIN,
} = {}) {
  const state = {
    url,
    storage: { ...storage },
    apiMe,
    meFor,
    replayFor,
    apiGate: null,
    apiScript: null,
    evaluations: 0,
    headersSeen: [],
    replayHeaders: [],
    cookies: [{ name: 'JSESSIONID', value: 'S1' }],
    /** The page's `/me` is fulfilled by a route: its response has no server address. */
    stubbedMe: false,
    /** Navigate the page here as soon as the in-page probe runs. */
    navigateDuringProbe: null,
    /** Navigate the page here while the Node replay is in flight. */
    navigateDuringReplay: null,
    /** Never answer the in-page probe; only an abort ends it. */
    inPageHangs: false,
    /** Never answer the Node replay; only an abort ends it. */
    replayHangs: false,
    /** The in-page `/me` redirects to another origin. */
    redirectInPage: false,
    /** The Node replay's `/me` redirects to another origin. */
    redirectReplay: false,
    /** `page.request`'s `/me` redirects to another origin. */
    redirectApi: false,
    waiters: [],
    /** @type {Record<string, ((request: object) => void)[]>} */
    listeners: {},
  };
  const mainFrame = {};
  const ELSEWHERE = 'https://elsewhere.test/identity';
  const page = {
    state,
    url: () => state.url,
    mainFrame: () => mainFrame,
    async evaluate(fn, arg) {
      state.evaluations++;
      const store = (area) => ({ getItem: (k) => state.storage[`${area}:${k}`] ?? null });
      const saved = ['sessionStorage', 'localStorage', 'fetch'].map((k) => [k, globalThis[k]]);
      const stand = {
        sessionStorage: store('sessionStorage'),
        localStorage: store('localStorage'),
        fetch: async (url, init) => {
          const auth = init?.headers?.['Authorization'] ?? null;
          state.headersSeen.push(auth);
          const response = {
            url: () => String(url),
            serverAddr: async () => (state.stubbedMe ? null : { ipAddress: '::1', port: 4200 }),
          };
          for (const w of state.waiters.splice(0)) if (w.pred(response)) w.resolve(response);
          if (state.navigateDuringProbe) state.url = state.navigateDuringProbe;
          if (state.inPageHangs) return hangUntilAborted(init?.signal);
          if (state.redirectInPage) {
            if (init?.redirect === 'manual') {
              return {
                status: 0,
                type: 'opaqueredirect',
                json: async () => Promise.reject(new Error('opaque')),
              };
            }
            return { status: 200, type: 'cors', json: async () => ADMIN };
          }
          return { status: 200, json: async () => state.meFor(auth) };
        },
      };
      for (const [k, v] of Object.entries(stand)) {
        Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
      }
      try {
        return await fn(arg);
      } finally {
        for (const [k, v] of saved) {
          Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
        }
      }
    },
    request: {
      async get(_url, options) {
        if (state.redirectApi) {
          if (options?.maxRedirects === 0) {
            return {
              status: () => 302,
              headers: () => ({ location: ELSEWHERE }),
              json: async () => null,
            };
          }
          return { status: () => 200, json: async () => ADMIN };
        }
        // `apiScript`, when set, answers the calls in order: [gate or null, body] per call.
        const scripted = state.apiScript?.shift();
        if (scripted) {
          if (scripted[0]) await scripted[0];
          return { status: () => 200, json: async () => scripted[1] };
        }
        if (state.apiGate) await state.apiGate;
        return { status: () => 200, json: async () => state.apiMe };
      },
    },
    context: () => ({ clearCookies: async () => undefined, cookies: async () => state.cookies }),
    waitForResponse: (pred) => new Promise((resolve) => state.waiters.push({ pred, resolve })),
    on: (event, fn) => {
      (state.listeners[event] ??= []).push(fn);
    },
    /**
     * Make the page send a request and finish it, as the app would. `authorization` is the header
     * it went out with; `navigation` loads a new main-frame document.
     *
     * @param {string} url
     * @param {{ authorization?: string | null, type?: string, navigation?: boolean }} [options]
     */
    send: (url, { authorization = null, type = 'xhr', navigation = false } = {}) => {
      const request = {
        url: () => url,
        method: () => 'GET',
        resourceType: () => (navigation ? 'document' : type),
        isNavigationRequest: () => navigation,
        frame: () => mainFrame,
        headers: () => (authorization ? { authorization } : {}),
      };
      for (const fn of state.listeners['request'] ?? []) fn(request);
      for (const fn of state.listeners['requestfinished'] ?? []) fn(request);
    },
    /** Make the page send a request, as the app would. */
    emitRequest: (url) => page.send(url),
    /** The Node-side replay's `fetch`. */
    fetch: async (url, init) => {
      const auth = init?.headers?.['Authorization'] ?? null;
      state.replayHeaders.push({
        url: String(url),
        auth,
        cookie: init?.headers?.['Cookie'] ?? null,
      });
      if (state.navigateDuringReplay) state.url = state.navigateDuringReplay;
      if (state.replayHangs) return hangUntilAborted(init?.signal);
      if (state.redirectReplay) {
        if (init?.redirect === 'manual') {
          return {
            status: 302,
            headers: new Headers({ location: ELSEWHERE }),
            text: async () => '',
          };
        }
        return { status: 200, text: async () => JSON.stringify(ADMIN) };
      }
      const body = (state.replayFor ?? state.meFor)(auth);
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return page;
}

/** A response that never arrives: only the caller's abort signal can end the wait. */
function hangUntilAborted(signal) {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted by the probe deadline')));
  });
}

const signedIn = {
  'sessionStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD'),
};
{
  const page = fakePage({
    storage: signedIn,
    meFor: (auth) => (auth === 'Basic QUJD' ? ADMIN : GUEST),
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'positive',
    'the page probe sends the stored header, and the replay sends it with the browser cookies',
    r.ok &&
      page.state.headersSeen[0] === 'Basic QUJD' &&
      page.state.replayHeaders[0]?.auth === 'Basic QUJD' &&
      page.state.replayHeaders[0]?.cookie === 'JSESSIONID=S1',
    { r, seen: page.state.headersSeen, replay: page.state.replayHeaders },
  );
}
{
  const page = fakePage({ storage: signedIn, meFor: () => GUEST });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control('negative', 'the page probe rejects a session the server answers as the guest', !r.ok, r);
}
{
  const page = fakePage({ storage: signedIn, meFor: () => ADMIN, replayFor: () => GUEST });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control('negative', 'the replay overrules a page whose /me was stubbed', !r.ok, r);
}
{
  const page = fakePage({ url: 'about:blank', storage: signedIn, meFor: () => GUEST });
  const unsigned = await checkPageIdentity(
    page,
    { unsigned: 'Administrator' },
    'http://app.test',
    page.fetch,
  );
  const required = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'positive',
    'a page off the app is not probed, and is accepted only before the run signed in',
    unsigned.ok && unsigned.state === 'not-on-app' && !required.ok && page.state.evaluations === 0,
    { unsigned, required },
  );
}
{
  const page = fakePage({
    storage: { 'localStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD') },
    meFor: (auth) => (auth === 'Basic QUJD' ? ADMIN : GUEST),
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'positive',
    "a remembered (localStorage) session is read, as the app's fallback",
    r.ok && r.state === 'authenticated',
    r,
  );
}
{
  const page = fakePage({
    storage: {
      'sessionStorage:agentic_ui_nuxeo_session': JSON.stringify({
        kind: 'cookie',
        username: 'Anonymous',
      }),
      'localStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD'),
    },
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control('negative', 'sessionStorage is read before localStorage, as the app reads it', !r.ok, r);
}
{
  const page = fakePage({ storage: signedIn });
  page.state.stubbedMe = true;
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'negative',
    'an in-page /me fulfilled by a page.route stub is refused, even when it names the user',
    !r.ok && /stub/.test(r.problem ?? ''),
    r,
  );
}
{
  const page = fakePage({ storage: signedIn });
  page.state.navigateDuringProbe = 'https://unintended.test/#/';
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'negative',
    "a page that navigates away during the probe is refused, and the session's header goes nowhere else",
    !r.ok && page.state.replayHeaders.every((h) => h.url.startsWith('http://app.test/')),
    { r, replay: page.state.replayHeaders },
  );
}
{
  const page = fakePage({ storage: signedIn });
  page.state.navigateDuringReplay = 'https://elsewhere.test/#/';
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'negative',
    'a page that navigates away while the Node replay is in flight is refused',
    !r.ok,
    r,
  );
}
{
  const page = fakePage({ storage: signedIn });
  page.state.replayHangs = true;
  // `AbortSignal.timeout` does not hold the event loop open; a real socket would, this fake does not.
  const keepAlive = setTimeout(() => undefined, 5_000);
  const t0 = Date.now();
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
    timeoutMs: 50,
  });
  control(
    'negative',
    'a Node replay that never answers ends at the deadline as a rejected identity',
    !r.ok && Date.now() - t0 < 5_000,
    { r, ms: Date.now() - t0 },
  );
  clearTimeout(keepAlive);
}
{
  const page = fakePage({ storage: signedIn });
  page.state.inPageHangs = true;
  const t0 = Date.now();
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
    timeoutMs: 50,
  });
  control(
    'negative',
    'an in-page probe that never answers ends at the deadline as a rejected identity',
    !r.ok && Date.now() - t0 < 5_000,
    { r, ms: Date.now() - t0 },
  );
}
{
  const page = fakePage({ storage: signedIn });
  const r0 = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'positive',
    "the replay goes to the validated app origin, not to the page's later URL",
    r0.ok && page.state.replayHeaders[0]?.url === 'http://app.test/nuxeo/api/v1/me',
    page.state.replayHeaders,
  );
}

// ── redirects: another server's answer is no answer ─────────────────────────────────────────────
{
  const page = fakePage({ storage: signedIn });
  page.state.redirectInPage = true;
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'negative',
    'an in-page /me that redirects to another origin is refused, though the destination names the user',
    !r.ok && /redirect/.test(r.problem ?? ''),
    r,
  );
}
{
  const page = fakePage({ storage: signedIn });
  page.state.redirectReplay = true;
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test', {
    fetchImpl: page.fetch,
  });
  control(
    'negative',
    'a Node replay whose /me redirects to another origin is refused',
    !r.ok && /redirect/.test(r.problem ?? ''),
    r,
  );
}
{
  const page = fakePage();
  page.state.redirectApi = true;
  const r = await checkRequestIdentity(
    page.request,
    'http://app.test/nuxeo/api/v1/me',
    'Administrator',
  );
  control(
    'negative',
    "page.request's /me that redirects to another origin is refused",
    !r.ok && /302/.test(r.problem ?? ''),
    r,
  );
}
{
  const page = fakePage();
  page.state.redirectReplay = true;
  const r = await checkFetchIdentity(
    'http://app.test/nuxeo/api/v1/me',
    'Basic QUJD',
    'Administrator',
    page.fetch,
  );
  control(
    'negative',
    "a script's /me (the preflights' channel) that redirects is refused",
    !r.ok && /302/.test(r.problem ?? ''),
    r,
  );
}

// ── what the page actually sent ─────────────────────────────────────────────────────────────────
const APP = 'http://app.test';
const H = 'Basic QUJD';
/** @param {Parameters<typeof fakePage>[0]} [options] */
function watchedPage(options) {
  const page = fakePage({
    storage: signedIn,
    meFor: (auth) => (auth === H ? ADMIN : GUEST),
    ...options,
  });
  return { page, traffic: watchNuxeoApiOrigins(page, APP) };
}
{
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    "the page's data requests that went without the session's header are refused, though /me answers as the user",
    !r.ok && /without the header/.test(r.problem ?? '') && /search/.test(r.problem ?? ''),
    r,
  );
}
{
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: 'Basic UFU=' });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    "the page's data requests sent with another user's header are refused",
    !r.ok && /another Authorization/.test(r.problem ?? ''),
    r,
  );
}
{
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: null });
  page.send(`${APP}/nuxeo/site/automation/Document.Query`, { authorization: null });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    "a document that never sent the session's header has every request judged, not none",
    !r.ok && /2 Nuxeo request/.test(r.problem ?? ''),
    r,
  );
}
{
  // h.login(): the app boots signed out, then the reload starts the document that holds the session.
  const { page: reloaded, traffic: t1 } = watchedPage();
  reloaded.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
  reloaded.send(`${APP}/`, { navigation: true });
  reloaded.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  reloaded.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
  const r1 = await checkPageIdentity(reloaded, 'Administrator', APP, {
    fetchImpl: reloaded.fetch,
    foreignApiOrigins: t1,
  });
  // A sign-in form: the same document, signed out until its own request sends the header.
  const { page: form, traffic: t2 } = watchedPage();
  form.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
  form.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  form.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
  // Thumbnails load as images, which no interceptor authenticates.
  form.send(`${APP}/nuxeo/api/v1/id/1/@rendition/thumbnail`, {
    authorization: null,
    type: 'image',
  });
  const r2 = await checkPageIdentity(form, 'Administrator', APP, {
    fetchImpl: form.fetch,
    foreignApiOrigins: t2,
  });
  control(
    'positive',
    "requests before the session was in use (a boot before h.login()'s reload, or before a sign-in form) are not held against it",
    r1.ok && r2.ok,
    { r1, r2 },
  );
}

// ── step boundaries ─────────────────────────────────────────────────────────────────────────────
const quiet = console.log;
/** @param {() => Promise<void>} fn */
async function silently(fn) {
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = quiet;
  }
}

/** @param {ReturnType<typeof fakePage>} page */
function harness(page) {
  const recorder = { steps: [], consoleErrors: [] };
  const identity = createIdentityMonitor({
    page,
    baseUrl: 'http://app.test',
    username: 'Administrator',
    fetchImpl: page.fetch,
  });
  identity.expectApp('Administrator', 'selftest sign-in', 'step 0');
  return { recorder, identity, h: createHelpers(page, '/tmp', recorder, { identity }) };
}

/** @param {() => Promise<unknown>} fn */
async function thrownBy(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

await silently(async () => {
  {
    const page = fakePage({ storage: signedIn });
    const { h, identity, recorder } = harness(page);
    await h.step('one');
    h.check('c', true);
    await h.step('two');
    h.check('c', true);
    await h.finish();
    control(
      'positive',
      'awaited steps on a good session: every boundary checked, nothing recorded as failed',
      identity.checks.length === 2 &&
        identity.checks.every((c) => c.ok) &&
        recorder.steps.every((s) => s.checks.every((c) => c.passed)),
      { checks: identity.checks.map((c) => c.at), steps: recorder.steps },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'a step that ended as the guest throws a PreconditionError at the next boundary',
      thrown instanceof PreconditionError && /after step 1/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, recorder } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      'the last step is judged too, by finish()',
      thrown instanceof PreconditionError &&
        recorder.steps[0].checks.some((c) => !c.passed && /identity guard/.test(c.name)),
      { thrown: String(thrown), checks: recorder.steps[0].checks },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.storage = {};
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'a step that signed in and ended with no session is rejected',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, identity } = harness(page);
    await h.step('one');
    h.signedOut('selftest: driving the sign-in form');
    page.state.storage = {};
    await h.step('two');
    await h.finish();
    control(
      'positive',
      'a declared sign-out is accepted and recorded',
      identity.checks.every((c) => c.ok) && identity.switches.some((s) => s.username === null),
      { checks: identity.checks, switches: identity.switches },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, recorder } = harness(page);
    // Held open, so this boundary is still running when the next step opens.
    let release = () => undefined;
    await h.step('one');
    page.state.apiGate = new Promise((r) => (release = r));
    const two = h.step('two'); // not awaited, on purpose
    const three = h.step('three');
    release();
    page.state.apiGate = null;
    await Promise.allSettled([two, three]);
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      'an un-awaited step boundary is recorded as a failed check on its step, and the run is refused',
      recorder.steps[0].checks.some((c) => !c.passed && /not awaited/.test(c.detail ?? '')) &&
        thrown instanceof PreconditionError &&
        /not awaited/.test(thrown.message),
      { checks: recorder.steps[0].checks, thrown: String(thrown) },
    );
  }
  {
    // The review's case: not awaited, and the check finishes during the next step's own work.
    const page = fakePage({ storage: signedIn });
    const { h, identity, recorder } = harness(page);
    await h.step('one');
    h.step('two'); // not awaited, on purpose
    await new Promise((r) => setTimeout(r, 20)); // the next step's work; the check settles meanwhile
    await h.step('three');
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      "an un-awaited boundary that settled during the next step's work is still refused",
      thrown instanceof PreconditionError &&
        /not awaited/.test(thrown.message) &&
        recorder.steps[0].checks.some((c) => !c.passed && /not awaited/.test(c.detail ?? '')) &&
        identity.checks.some((c) => !c.ok && c.reports.some((r) => r.channel === 'step')),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    const late = h.step('two');
    await new Promise((r) => setTimeout(r, 20)); // work done before the boundary is awaited
    await late;
    await h.step('three');
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      'a boundary awaited only after the next step has started work is refused',
      thrown instanceof PreconditionError && /not awaited/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    h.step('two').then(() => undefined); // chained, and the chain not awaited
    await h.step('three');
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      'a .then() chained on a boundary does not count as awaiting it unless the chain is awaited',
      thrown instanceof PreconditionError && /not awaited/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, recorder } = harness(page);
    await h.step('one');
    await h.step('two').then(() => undefined);
    await Promise.all([h.step('three')]);
    await h.finish();
    control(
      'positive',
      'an awaited .then() chain, or Promise.all, on a boundary counts as awaiting it',
      recorder.steps.every((s) => s.checks.every((c) => c.passed)),
      recorder.steps,
    );
  }
  {
    // Through the runner's path: the monitor watches the page's requests from its creation.
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h } = harness(page);
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
    page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      "a step whose data requests went without the session's header is refused at the next boundary",
      thrown instanceof PreconditionError && /without the header/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    h.step('two'); // not awaited: its rejection must not be lost
    await new Promise((r) => setTimeout(r, 20));
    // Healed before the next boundary, so only the held failure can make it throw.
    page.state.meFor = () => ADMIN;
    const thrown = await thrownBy(() => h.step('three'));
    control(
      'negative',
      'a boundary that failed while nobody awaited it is thrown at the next one',
      thrown instanceof PreconditionError && /Anonymous/.test(thrown.message),
      String(thrown),
    );
  }
  {
    // The review's case: `.then()` attached but not awaited, and a slow earlier boundary.
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    let release = () => undefined;
    page.state.apiGate = new Promise((r) => (release = r));
    page.state.apiMe = GUEST;
    h.step('two').then(
      () => undefined,
      () => undefined,
    );
    const finished = h.finish().then(
      () => 'returned',
      (err) => err,
    );
    await new Promise((r) => setTimeout(r, 20));
    release();
    page.state.apiGate = null;
    const outcome = await finished;
    // Its failure, not only "not awaited": that one is thrown whether finish() waited or not.
    control(
      'negative',
      'finish() waits for every pending boundary, not only the latest, and throws its failure',
      outcome instanceof PreconditionError && /Anonymous/.test(outcome.message),
      String(outcome),
    );
  }
  {
    // An earlier boundary slow and failing, a later one quick and passing: draining only the
    // latest, with checks not serialised, would let finish() return clean.
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    let release = () => undefined;
    page.state.apiScript = [
      [new Promise((r) => (release = r)), GUEST],
      [null, ADMIN],
      [null, ADMIN],
    ];
    h.step('two').catch(() => undefined); // its failure is what finish() must surface
    h.step('three').catch(() => undefined); // judged through finish(), not here
    const finished = h.finish().then(
      () => 'returned',
      (err) => err,
    );
    await new Promise((r) => setTimeout(r, 20));
    release();
    const outcome = await finished;
    control(
      'negative',
      'finish() is not satisfied by a later boundary while an earlier one is still failing',
      outcome instanceof PreconditionError && /Anonymous/.test(outcome.message),
      String(outcome),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, identity } = harness(page);
    await h.step('one');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
    h.signedInAs('parity-user', 'selftest');
    await h
      .step('two')
      .then(() => h.finish())
      // The control reads identity.checks below; a throw here would be a failure it reports.
      .catch(() => undefined);
    control(
      'positive',
      'a declared switch of browser identity is accepted and recorded',
      identity.checks.every((c) => c.ok) &&
        identity.switches.length === 1 &&
        identity.switches[0].username === 'parity-user',
      { checks: identity.checks, switches: identity.switches },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'an undeclared switch of browser identity is rejected',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn, apiMe: GUEST });
    const { h } = harness(page);
    await h.step('one');
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'page.request running as the guest is rejected',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    // Before any sign-in: a form sign-in seen at a boundary makes the session required after it.
    const page = fakePage({ url: 'about:blank' });
    const recorder = { steps: [], consoleErrors: [] };
    const identity = createIdentityMonitor({
      page,
      baseUrl: 'http://app.test',
      username: 'Administrator',
      fetchImpl: page.fetch,
    });
    const h = createHelpers(page, '/tmp', recorder, { identity });
    await h.step('one');
    await h.step('two');
    page.state.url = 'http://app.test/#/';
    page.state.storage = { ...signedIn };
    await h.step('three');
    page.state.storage = {};
    const thrown = await thrownBy(() => h.step('four'));
    control(
      'negative',
      'once seen signed in, an unannounced loss of the session is rejected even without h.login()',
      identity.checks[0].ok && identity.checks[1].ok && thrown instanceof PreconditionError,
      { checks: identity.checks.map((c) => [c.at, c.ok]), thrown: String(thrown) },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.emitRequest('https://elsewhere.test/nuxeo/api/v1/search/lang/NXQL/execute');
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'an app that sends Nuxeo API requests to another origin is refused, not judged on the wrong server',
      thrown instanceof PreconditionError && /elsewhere\.test/.test(thrown.message),
      String(thrown),
    );
  }
  {
    // One boundary already failed and latched, another still running: finish() must still wait.
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    let release = () => undefined;
    let settled = false;
    page.state.apiScript = [
      [null, GUEST],
      [new Promise((r) => (release = r)), ADMIN],
    ];
    h.step('two').catch(() => undefined); // its failure is what finish() must surface
    const three = h.step('three');
    three.catch(() => undefined); // its settling is observed through `settled` above
    await new Promise((r) => setTimeout(r, 20)); // two has failed and latched; three is held
    three.then(
      () => (settled = true),
      () => (settled = true),
    );
    const finished = h.finish().then(
      () => 'returned',
      (err) => err,
    );
    await new Promise((r) => setTimeout(r, 20));
    const earlyOutcome = settled;
    release();
    const outcome = await finished;
    control(
      'negative',
      'finish() drains a pending boundary before rethrowing an earlier failure',
      outcome instanceof PreconditionError && /Anonymous/.test(outcome.message) && settled,
      { outcome: String(outcome), settledBeforeRelease: earlyOutcome, settled },
    );
  }
  {
    // Violation accumulation across reload: a guest request followed by reload should still fail.
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.emitRequest('http://app.test/nuxeo/api/v1/search', { authorization: null });
    page.state.document++;
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      'violations accumulate across reload: a headerless request before reload is rejected after',
      thrown instanceof PreconditionError && /authorization.*differ/i.test(thrown.message),
      String(thrown),
    );
  }
  {
    // Cleared on identity switch: h.signedInAs clears baseDocument.
    const page = fakePage({ storage: signedIn });
    const { h, identity } = harness(page);
    await h.step('one');
    page.emitRequest('http://app.test/nuxeo/api/v1/search', { authorization: null });
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
    h.signedInAs('parity-user', 'selftest');
    page.state.document++;
    await h.step('two');
    await h.finish();
    control(
      'positive',
      'h.signedInAs clears violation history: headerless request under old identity is not held against new',
      identity.checks.every((c) => c.ok),
      { checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // Discarded Promise.all: should NOT count as awaited.
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    Promise.all([h.step('two')]).catch(() => undefined); // not awaited
    await new Promise((r) => setTimeout(r, 50)); // let the check run
    const thrown = await thrownBy(() => h.finish());
    control(
      'negative',
      'a discarded Promise.all([h.step(...)]) does not count as awaiting: the boundary fails for not being awaited',
      thrown instanceof PreconditionError && /not awaited/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn, meFor: () => GUEST });
    const recorder = { steps: [], consoleErrors: [] };
    const h = createHelpers(page, '/tmp', recorder);
    await h.step('one');
    await h.step('two');
    await h.finish();
    control(
      'positive',
      'without a monitor (story-runner) steps are unguarded, as before',
      page.state.evaluations === 0,
    );
  }
});

const negatives = controls.filter((c) => c.kind === 'negative');
const failed = controls.filter((c) => !c.ok);
for (const c of controls) {
  console.log(`  [${c.ok ? 'pass' : 'FAIL'}] (${c.kind}) ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
}
console.log(
  failed.length
    ? `\nidentity-guard selftest: FAIL — ${failed.length} of ${controls.length} control(s) failed.`
    : `\nidentity-guard selftest: pass — ${controls.length} controls (${negatives.length} negative, ${controls.length - negatives.length} positive).`,
);
process.exit(failed.length ? 1 : 0);
