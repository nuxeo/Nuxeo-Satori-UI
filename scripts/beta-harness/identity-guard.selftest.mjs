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
import { POST_FAULT_ASSERTION, judgeControlRun } from './identity-guard.control-verdict.mjs';
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
  pendingAcrossSignIn,
  sameUser,
  strayRequests,
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
const cookieSession = (username) =>
  JSON.stringify({ kind: 'cookie', username, isAdministrator: true, groups: [] });
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
    requestWaiters: [],
    /** What a document `goto` loads sends before anything else, signed out. */
    bootRequests: [],
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
      const store = (area) => ({
        getItem: (k) => state.storage[`${area}:${k}`] ?? null,
        setItem: (k, v) => {
          state.storage[`${area}:${k}`] = String(v);
        },
        removeItem: (k) => {
          delete state.storage[`${area}:${k}`];
        },
      });
      const saved = ['sessionStorage', 'localStorage', 'fetch'].map((k) => [k, globalThis[k]]);
      const stand = {
        sessionStorage: store('sessionStorage'),
        localStorage: store('localStorage'),
        fetch: async (url, init) => {
          const auth = init?.headers?.['Authorization'] ?? null;
          state.headersSeen.push(auth);
          // Trigger request event for waitForRequest (P1 fix needs this). Simulate browser behavior:
          // with credentials: 'same-origin', the browser includes cookies from the jar automatically.
          const allHeaders = {};
          if (auth) allHeaders['authorization'] = auth;
          // Include cookies from the jar if credentials: 'same-origin' (the default for identity probes)
          if (init?.credentials === 'same-origin' && state.cookies.length > 0) {
            allHeaders['cookie'] = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
          }
          const request = {
            url: () => String(url),
            method: () => init?.method ?? 'GET',
            allHeaders: async () => allHeaders,
          };
          for (const w of state.requestWaiters.splice(0)) if (w.pred(request)) w.resolve(request);
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
    context: () => ({
      clearCookies: async () => {
        // The page is still live while `h.login()` clears the cookies and writes the session,
        // so a request can complete in that gap — after the boot-navigation verification, and
        // before the reload.
        state.duringClear?.();
      },
      cookies: async () => state.cookies,
    }),
    waitForResponse: (pred) => new Promise((resolve) => state.waiters.push({ pred, resolve })),
    waitForRequest: (pred) => new Promise((resolve) => state.requestWaiters.push({ pred, resolve })),
    on: (event, fn) => {
      (state.listeners[event] ??= []).push(fn);
    },
    /**
     * Make the page send a request and finish it, as the app would. `authorization` is the header
     * it went out with; `navigation` loads a new main-frame document; `cookie` is the session
     * cookie value at request time (for testing cookie sessions, Gap 1).
     *
     * @param {string} url
     * @param {{ authorization?: string | null, type?: string, navigation?: boolean, cookie?: string | null }} [options]
     */
    send: (url, { authorization = null, type = 'xhr', navigation = false, cookie = null } = {}) => {
      const allHeaders = {};
      if (authorization) allHeaders['authorization'] = authorization;
      if (cookie) allHeaders['cookie'] = `JSESSIONID=${cookie}`;
      const request = {
        url: () => url,
        method: () => 'GET',
        resourceType: () => (navigation ? 'document' : type),
        isNavigationRequest: () => navigation,
        frame: () => mainFrame,
        headers: () => (authorization ? { authorization } : {}),
        allHeaders: async () => allHeaders,
      };
      for (const fn of state.listeners['request'] ?? []) fn(request);
      // Resolve any waitForRequest waiters
      for (const w of state.requestWaiters.splice(0)) if (w.pred(request)) w.resolve(request);
      // Call requestfinished handlers. These are async in production, and tests must exercise
      // the real async path (P2). Fire them but don't await - matches Playwright's behavior.
      for (const fn of state.listeners['requestfinished'] ?? []) {
        const result = fn(request);
        // Catch errors but don't wait - Playwright doesn't await event listeners
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    },
    /**
     * Start a request and leave it in flight: `request` fires now, `requestfinished` only when
     * the returned `finish` is called — or `requestfailed`, through `fail`. What a transition
     * declared while the app is still waiting for a response sees.
     *
     * @param {string} url
     * @param {{ authorization?: string | null, type?: string, cookie?: string | null }} [options]
     */
    begin: (url, { authorization = null, type = 'xhr', cookie = null } = {}) => {
      const allHeaders = {};
      if (authorization) allHeaders['authorization'] = authorization;
      if (cookie) allHeaders['cookie'] = `JSESSIONID=${cookie}`;
      const request = {
        url: () => url,
        method: () => 'GET',
        resourceType: () => type,
        isNavigationRequest: () => false,
        frame: () => mainFrame,
        headers: () => (authorization ? { authorization } : {}),
        allHeaders: async () => allHeaders,
      };
      for (const fn of state.listeners['request'] ?? []) fn(request);
      // Resolve any waitForRequest waiters
      for (const w of state.requestWaiters.splice(0)) if (w.pred(request)) w.resolve(request);
      const emit = (event) => {
        for (const fn of state.listeners[event] ?? []) fn(request);
      };
      return { finish: () => emit('requestfinished'), fail: () => emit('requestfailed') };
    },
    /** Make the page send a request, as the app would. */
    emitRequest: (url) => page.send(url),
    goto: async (url) => {
      state.url = url;
      page.send(url, { navigation: true });
      // A `bootRequests` entry is a bare URL when the boot is signed out, or `{ url,
      // authorization }` when a session is already installed and the app's interceptor puts its
      // header on what the boot sends — which is what a *repeated* `h.login()` boots into.
      for (const r of state.bootRequests) {
        if (typeof r === 'string') page.send(r, { authorization: null });
        else page.send(r.url, { authorization: r.authorization });
      }
      // What the booted app goes on to do while the caller waits: `h.login()` sits for 800 ms
      // after this navigation, and a request emitted in that interval is the one nothing used
      // to judge.
      state.duringGoto?.();
    },
    reload: async () => page.send(state.url, { navigation: true }),
    waitForTimeout: async () => undefined,
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
  // A sign-in reload: the app boots signed out, the session is written, the marked reload uses it.
  const { page: reloaded, traffic: t1 } = watchedPage();
  reloaded.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
  t1.restartAtNextLoad();
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
  const r2 = await checkPageIdentity(form, { unsigned: 'Administrator' }, APP, {
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

{
  // The request Copilot described: read as the guest, then reload with the session restored.
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
  page.send(`${APP}/`, { navigation: true });
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    'a headerless data request is still refused after a reload restores the session',
    !r.ok && /without the header/.test(r.problem ?? '') && /search/.test(r.problem ?? ''),
    r,
  );
}

{
  // A data read that lost its header, then a request that recovered it (Copilot, on dff50ace6).
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    'a data read that lost its header is refused, though a later request recovered it',
    !r.ok && /without the header/.test(r.problem ?? '') && /search/.test(r.problem ?? ''),
    r,
  );
}
{
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
  page.send(`${APP}/`, { navigation: true });
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    'a signed-out boot is excused only when the reload that installs the session is marked',
    !r.ok && /without the header/.test(r.problem ?? ''),
    r,
  );
}

{
  // Gap 1, P2: Cookie session with null expectedCookie (cleared after probes but before check)
  const SESSION_KEY = 'agentic_ui_nuxeo_session';
  const cookieSessionStorage = {
    [`sessionStorage:${SESSION_KEY}`]: cookieSession('Administrator'),
  };
  const { page, traffic } = watchedPage({
    storage: cookieSessionStorage,
    meFor: () => ADMIN,
  });
  page.state.cookies = [{ name: 'JSESSIONID', value: 'admin-cookie' }];
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null, cookie: 'admin-cookie' });
  // Request without cookie - should be refused even when expectedCookie is null
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null, cookie: null });
  // Drain pending headers before checking (P1) - async requestfinished means headers may not be ready
  await traffic.drainPendingHeaders();
  // Simulate cleared cookie by passing null as expectedCookie
  const stored = {
    key: SESSION_KEY,
    storage: 'sessionStorage',
    kind: 'cookie',
    username: 'Administrator',
    authorization: null,
  };
  const stray = strayRequests(traffic, stored, { signingIn: false, expectedCookie: null });
  control(
    'negative',
    'a cookie session with null expectedCookie fails closed and reports ALL requests as stray (Gap 1, P2)',
    stray.length === 2 &&
      stray.some((r) => r.path === '/nuxeo/api/v1/me') &&
      stray.some((r) => r.path === '/nuxeo/api/v1/search/lang/NXQL/execute'),
    { strayCount: stray.length, stray: stray.map((r) => r.path) },
  );
}

{
  // Gap 1, P2: Cookie session with null expectedCookie and wrong-user Authorization header
  const SESSION_KEY = 'agentic_ui_nuxeo_session';
  const WRONG_USER_AUTH = 'Basic ' + b64('WrongUser:pw');
  const cookieSessionStorage = {
    [`sessionStorage:${SESSION_KEY}`]: cookieSession('Administrator'),
  };
  const { page, traffic } = watchedPage({
    storage: cookieSessionStorage,
    meFor: () => ADMIN,
  });
  page.state.cookies = [{ name: 'JSESSIONID', value: 'admin-cookie' }];
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null, cookie: 'admin-cookie' });
  // Request with wrong user's Authorization header - should be refused when expectedCookie is null
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: WRONG_USER_AUTH, cookie: null });
  // Drain pending headers before checking (P1)
  await traffic.drainPendingHeaders();
  const stored = {
    key: SESSION_KEY,
    storage: 'sessionStorage',
    kind: 'cookie',
    username: 'Administrator',
    authorization: null,
  };
  const stray = strayRequests(traffic, stored, { signingIn: false, expectedCookie: null });
  control(
    'negative',
    'a cookie session with null expectedCookie reports wrong-user Authorization header as stray (Gap 1, P2)',
    stray.length === 2 &&
      stray.some((r) => r.path === '/nuxeo/api/v1/search/lang/NXQL/execute' && r.authorization === WRONG_USER_AUTH),
    { strayCount: stray.length, stray: stray.map((r) => ({ path: r.path, auth: r.authorization })) },
  );
}

{
  // Gap 1: cookie-authenticated traffic is invisible to the traffic log.
  // A cookie session stores authorization: null, and a guest request also has authorization: null.
  // Before the fix, the guard compared r.authorization !== stored.authorization (null !== null = false),
  // so the guest request was NOT considered stray. After the fix, it checks cookies for cookie sessions.
  const SESSION_KEY = 'agentic_ui_nuxeo_session';
  const ADMIN_COOKIE = 'admin-cookie-value';
  const cookieSessionStorage = {
    [`sessionStorage:${SESSION_KEY}`]: cookieSession('Administrator'),
  };
  const { page, traffic } = watchedPage({
    storage: cookieSessionStorage,
    meFor: () => ADMIN, // /me answers as Admin when called with the cookie
  });
  // Simulate the page's actual cookie
  page.state.cookies = [{ name: 'JSESSIONID', value: ADMIN_COOKIE }];
  // First request with the cookie (simulating authenticated traffic)
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null, cookie: ADMIN_COOKIE });
  // Second request without the cookie (guest traffic that should be rejected)
  page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null, cookie: null });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'negative',
    'a cookie session: a request sent without the session cookie is refused (Gap 1 - cookie traffic visibility)',
    !r.ok && /without the header/.test(r.problem ?? ''),
    r,
  );
}

{
  // `AppConfigService` and `DocumentLayoutService` read these through `HttpBackend` on every load.
  const { page, traffic } = watchedPage();
  page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
  page.send(`${APP}/`, { navigation: true });
  for (const file of [
    'bootstrap.json',
    'manifest.json',
    'layouts.json',
    'layouts/File/view.layout.json',
  ]) {
    page.send(`${APP}/nuxeo/agentic-ui-config/${file}`, { authorization: null });
  }
  page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
  const r = await checkPageIdentity(page, 'Administrator', APP, {
    fetchImpl: page.fetch,
    foreignApiOrigins: traffic,
  });
  control(
    'positive',
    "the configuration service's files, read without the header by design, are not held against the session",
    r.ok,
    r,
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
    // Declared while the session is still there, so the sign-out can judge what it is ending.
    await h.signedOut('selftest: driving the sign-in form');
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
    // Declared first, then installed: the switch judges the identity it is leaving, so the
    // outgoing session must still be the one in place.
    await h.signedInAs('parity-user', 'selftest');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
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
    // Administrator, then parity-user, then back, in one document as a header rewrite allows.
    // Without a restart at each declared switch, parity-user's request is judged as Administrator's.
    const UFU = 'Basic UFU=';
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h, identity } = harness(page);
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
    await h.step('two');
    await h.signedInAs('parity-user', 'selftest');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === UFU ? { id: 'parity-user' } : GUEST);
    page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: UFU });
    await h.step('three');
    await h.signedInAs('Administrator', 'selftest');
    page.state.storage = { ...signedIn };
    page.state.meFor = (auth) => (auth === H ? ADMIN : GUEST);
    page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
    const thrown = await thrownBy(() => h.finish());
    control(
      'positive',
      "a declared switch, and a switch back, does not hold one identity's requests against the other",
      // Five: three boundaries, and the verification each declared switch now makes first.
      thrown === null && identity.checks.length === 5 && identity.checks.every((c) => c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    const UFU = 'Basic UFU=';
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h } = harness(page);
    await h.step('one');
    await h.signedInAs('parity-user', 'selftest');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === UFU ? { id: 'parity-user' } : GUEST);
    page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: UFU });
    page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
    const thrown = await thrownBy(() => h.step('two'));
    control(
      'negative',
      "after a declared switch, the new identity's headerless request is still refused",
      thrown instanceof PreconditionError && /without the header/.test(thrown.message),
      String(thrown),
    );
  }
  {
    // The outgoing session's traffic, at a declared switch. `expectApp` restarts the request
    // window, so a headerless request made before the switch is outside the next boundary's
    // window: unless the switch verifies first, that request is never judged by anything.
    const UFU = 'Basic UFU=';
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h } = harness(page);
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
    const thrown = await thrownBy(async () => {
      await h.signedInAs('parity-user', 'selftest');
      // Only reached when the switch did not refuse: the new session, as the parity steps file
      // installs it, and a boundary that would otherwise find nothing to judge.
      page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
        'parity-user',
        'UFU=',
      );
      page.state.meFor = (auth) => (auth === UFU ? { id: 'parity-user' } : GUEST);
      await h.step('two');
    });
    control(
      'negative',
      "a declared switch refuses the outgoing session's headerless request instead of discarding it",
      thrown instanceof PreconditionError && /without the header/.test(thrown.message),
      String(thrown),
    );
  }
  {
    // The same hole at the other transition: `expectSignedOut` restarts the window too, and a
    // sign-out that is accepted leaves the discarded request unjudged for the rest of the run.
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h } = harness(page);
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
    const thrown = await thrownBy(async () => {
      await h.signedOut('selftest: driving the sign-in form');
      page.state.storage = {};
      await h.step('two');
    });
    control(
      'negative',
      "a declared sign-out refuses the outgoing session's headerless request instead of discarding it",
      thrown instanceof PreconditionError && /without the header/.test(thrown.message),
      String(thrown),
    );
  }
  {
    // A request still *in flight* at a declared switch. Verifying the outgoing session does not
    // reach it: `strayRequests` judges only finished records, and `restart` then moves `since`
    // past this one, so it is judged by nothing, ever — and the run still ends `identity.valid:
    // true` over traffic the guard could not read. The switch must refuse instead.
    const UFU = 'Basic UFU=';
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h, identity } = harness(page);
    await h.step('one');
    const inFlight = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
    const thrown = await thrownBy(async () => {
      await h.signedInAs('parity-user', 'selftest');
      // Only reached when the switch did not refuse: the new session, and the pending request
      // landing headerless afterwards, where no later boundary's window contains it.
      page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
        'parity-user',
        'UFU=',
      );
      page.state.meFor = (auth) => (auth === UFU ? { id: 'parity-user' } : GUEST);
      inFlight.finish();
      await h.step('two');
      await h.finish();
    });
    control(
      'negative',
      'a request in flight at a declared switch refuses the switch, names the request, and invalidates the run',
      thrown instanceof PreconditionError &&
        /in flight/.test(thrown.message) &&
        /search\/lang\/NXQL\/execute/.test(thrown.message) &&
        identity.checks.some((c) => !c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // The same at the other transition: `expectSignedOut` restarts the window too.
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h, identity } = harness(page);
    await h.step('one');
    const inFlight = page.begin(`${APP}/nuxeo/api/v1/path/default-domain`);
    const thrown = await thrownBy(async () => {
      await h.signedOut('selftest: driving the sign-in form');
      page.state.storage = {};
      inFlight.finish();
      await h.step('two');
      await h.finish();
    });
    control(
      'negative',
      'a request in flight at a declared sign-out refuses the sign-out, names the request, and invalidates the run',
      thrown instanceof PreconditionError &&
        /in flight/.test(thrown.message) &&
        /path\/default-domain/.test(thrown.message) &&
        identity.checks.some((c) => !c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // A request that was in flight, then *failed*: the page never received a response, so no step
    // could have read it, and `requestfailed` is the only event it will ever emit. Treating it as
    // pending would refuse every transition after a navigation aborted a request.
    const page = fakePage({ storage: signedIn, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const { h, identity } = harness(page);
    await h.step('one');
    const aborted = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
    aborted.fail();
    // Inside `thrownBy` so a refusal here is reported as this control failing, not as the
    // selftest aborting: over-refusal is the failure mode this control exists to catch.
    const thrown = await thrownBy(async () => {
      await h.signedOut('selftest: driving the sign-in form');
      page.state.storage = {};
      await h.step('two');
      await h.finish();
    });
    control(
      'positive',
      'a request that failed before the transition is not in flight, so the transition is allowed',
      thrown === null && identity.checks.every((c) => c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // h.login() itself: the page boots signed out, then the session is written and the page reloaded.
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: LOGIN });
      const thrown = await thrownBy(() => h.step('two'));
      control(
        'positive',
        "h.login()'s signed-out boot is not held against the session it installs",
        thrown === null && identity.checks.length === 1 && identity.checks[0].ok,
        { thrown: String(thrown), checks: identity.checks },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // Repeated h.login() before a step boundary: the headerless request from the first authenticated
    // session must be caught, not hidden by the window reset.
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
      const thrown = await thrownBy(() => h.login());
      const failedCheck = recorder.steps[0]?.checks.find((c) => !c.passed);
      control(
        'negative',
        'repeated h.login() verifies the current session before resetting, catching headerless traffic',
        thrown instanceof PreconditionError &&
          /without the header/.test(thrown.message) &&
          failedCheck &&
          /identity guard/.test(failedCheck.name),
        { thrown: String(thrown), checks: identity.checks, failedCheck },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // `h.login()`'s reload path with a request in flight. `restartAtNextLoad` moves the window at
    // the reload, so the pending record is behind `since` by the time it finishes: the third way
    // into the same hole, and the one the parity step's own comment describes.
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      const inFlight = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
      const thrown = await thrownBy(async () => {
        await h.login();
        inFlight.finish();
        await h.step('two');
        await h.finish();
      });
      const failedCheck = recorder.steps[0]?.checks.find((c) => !c.passed);
      control(
        'negative',
        "a request in flight at repeated h.login() refuses the reload path, names the request, and fails the step's check",
        thrown instanceof PreconditionError &&
          /in flight/.test(thrown.message) &&
          /search\/lang\/NXQL\/execute/.test(thrown.message) &&
          failedCheck !== undefined &&
          /identity guard/.test(failedCheck.name),
        { thrown: String(thrown), failedCheck },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  // The interval *inside* a repeated `h.login()`: its verification has already passed, and the
  // boot navigation and 800 ms wait that follow still run under the session being replaced. A
  // request emitted there used to be discarded by `restartAtNextLoad` as though it belonged to
  // the initial signed-out boot — the verification could not have seen it, and no later boundary
  // ever did. These three emit during the call rather than before it.
  for (const variant of [
    {
      kind: /** @type {const} */ ('negative'),
      name: "a headerless request emitted during repeated h.login()'s boot interval is refused, not discarded with the window",
      path: '/nuxeo/api/v1/search/lang/NXQL/execute',
      first: false,
      emit: (/** @type {any} */ page, /** @type {string} */ url) =>
        page.send(url, { authorization: null }),
      expect: /without the header/,
    },
    {
      kind: /** @type {const} */ ('negative'),
      name: "a request still in flight from repeated h.login()'s boot interval refuses the login",
      path: '/nuxeo/api/v1/path/default-domain',
      first: false,
      emit: (/** @type {any} */ page, /** @type {string} */ url) => page.begin(url),
      expect: /in flight/,
    },
    {
      kind: /** @type {const} */ ('positive'),
      name: "the same headerless request during the run's *first* h.login() is still exempt: that boot really is signed out",
      path: '/nuxeo/api/v1/search/lang/NXQL/execute',
      first: true,
      emit: (/** @type {any} */ page, /** @type {string} */ url) =>
        page.send(url, { authorization: null }),
      expect: null,
    },
  ]) {
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      if (!variant.first) await h.login();
      // Nothing headerless from the boot itself, so the only request this can refuse for is the
      // one emitted in the interval — otherwise the control would pass on the wrong evidence.
      page.state.bootRequests = [];
      page.state.duringGoto = () => variant.emit(page, `${APP}${variant.path}`);
      const thrown = await thrownBy(async () => {
        await h.login();
        page.state.duringGoto = undefined;
        page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: LOGIN });
        await h.step('two');
        await h.finish();
      });
      control(
        variant.kind,
        variant.name,
        variant.expect
          ? thrown instanceof PreconditionError &&
              variant.expect.test(thrown.message) &&
              thrown.message.includes(variant.path) &&
              /after its boot navigation/.test(thrown.message)
          : thrown === null && identity.checks.every((c) => c.ok),
        { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // Off-app navigation cannot bypass verification when the policy requires a signed-in user.
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: LOGIN });
      page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
      page.state.url = 'about:blank';
      const thrown = await thrownBy(() => h.login());
      const failedCheck = recorder.steps[0]?.checks.find((c) => !c.passed);
      control(
        'negative',
        'off-app navigation cannot bypass verification when policy requires a signed-in user',
        thrown instanceof PreconditionError &&
          /without the header/.test(thrown.message) &&
          failedCheck &&
          /identity guard/.test(failedCheck.name),
        { thrown: String(thrown), url: page.state.url, failedCheck },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // Session restoration: save synthetic session, replace with genuine, call h.login().
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      page.state.storage = { ...signedIn };
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      // Simulate the synthetic-user block: save genuine, replace with synthetic.
      const genuine = page.state.storage['sessionStorage:agentic_ui_nuxeo_session'];
      page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession('jdoe', 'UFU=');
      // Restore genuine before h.login() so pre-restoration verification sees it.
      page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = genuine;
      // This login replaces a session rather than installing the first one, so the page it boots
      // still holds that session and its interceptor authenticates what the boot sends. That
      // traffic is now judged instead of discarded, so the fake has to send it as the real app
      // does — every green evidence run already proves an authenticated boot sends no headerless
      // `/nuxeo/api/` request, because the reload below produces the same boot and the next step
      // boundary judges it.
      page.state.bootRequests = [{ url: `${APP}/nuxeo/api/v1/me`, authorization: LOGIN }];
      await h.login();
      const thrown = await thrownBy(() => h.step('two'));
      control(
        'positive',
        'restoring genuine session before h.login() lets the pre-restoration check pass',
        thrown === null && identity.checks.every((c) => c.ok),
        { thrown: String(thrown), checks: identity.checks },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // The same form sign-in, with a request the app started *after* it still in flight at the
    // boundary that recognises it. Recognising the sign-in restarts the window at the probe's
    // mark, which puts that request behind `since` where no later boundary contains it: it
    // completes headerless, nothing judges it, and the run still ends valid. The recognition
    // must refuse instead — a transition in everything but name.
    const page = fakePage({ url: `${APP}/#/`, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const recorder = { steps: [], consoleErrors: [] };
    const identity = createIdentityMonitor({
      page,
      baseUrl: APP,
      username: 'Administrator',
      fetchImpl: page.fetch,
    });
    const h = createHelpers(page, '/tmp', recorder, { identity });
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
    page.state.storage = { ...signedIn };
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
    const inFlight = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
    const thrown = await thrownBy(async () => {
      await h.step('two');
      // Only reached when the recognition did not refuse: the search lands headerless, behind
      // `since`, and every remaining boundary reports a clean run over it.
      inFlight.finish();
      await h.step('three');
      await h.finish();
    });
    control(
      'negative',
      'a request in flight across a recognised form sign-in refuses the promotion, names the request, and invalidates the run',
      thrown instanceof PreconditionError &&
        /in flight/.test(thrown.message) &&
        /search\/lang\/NXQL\/execute/.test(thrown.message) &&
        identity.checks.some((c) => !c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // Cookie-session variant: form sign-in using cookie, with in-flight request (Finding 4)
    const COOKIE_VAL = 'admin-session-cookie';
    const cookieSessionStorage = {
      'sessionStorage:agentic_ui_nuxeo_session': cookieSession('Administrator'),
    };
    const page = fakePage({
      url: `${APP}/#/`,
      meFor: () => ADMIN,
    });
    page.state.cookies = [{ name: 'JSESSIONID', value: COOKIE_VAL }];
    const recorder = { steps: [], consoleErrors: [] };
    const identity = createIdentityMonitor({
      page,
      baseUrl: APP,
      username: 'Administrator',
      fetchImpl: page.fetch,
    });
    const h = createHelpers(page, '/tmp', recorder, { identity });
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null, cookie: null });
    page.state.storage = { ...cookieSessionStorage };
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null, cookie: COOKIE_VAL });
    const inFlight = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { cookie: null });
    const thrown = await thrownBy(async () => {
      await h.step('two');
      inFlight.finish();
      await h.step('three');
      await h.finish();
    });
    control(
      'negative',
      'a cookie-session form sign-in with in-flight request refuses the promotion (Finding 4)',
      thrown instanceof PreconditionError &&
        /in flight/.test(thrown.message) &&
        /search\/lang\/NXQL\/execute/.test(thrown.message) &&
        identity.checks.some((c) => !c.ok),
      { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
    );
  }
  {
    // The bootstrap exemption, kept: a request in flight from *before* anything carried a header
    // is the signed-out page's own. It has no identity to strand, and refusing it would make
    // every run that signs in through the form while its boot is still settling red.
    const page = fakePage({ url: `${APP}/#/`, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const recorder = { steps: [], consoleErrors: [] };
    const identity = createIdentityMonitor({
      page,
      baseUrl: APP,
      username: 'Administrator',
      fetchImpl: page.fetch,
    });
    const h = createHelpers(page, '/tmp', recorder, { identity });
    await h.step('one');
    const booting = page.begin(`${APP}/nuxeo/api/v1/me`);
    page.state.storage = { ...signedIn };
    const thrown = await thrownBy(() => h.step('two'));
    booting.finish();
    control(
      'positive',
      'a request in flight from the signed-out bootstrap does not refuse the form sign-in: it carries no identity to strand',
      thrown === null && identity.checks.every((c) => c.ok) && 'user' in identity.appPolicy,
      { thrown: String(thrown), policy: identity.appPolicy },
    );
  }
  {
    // The same promotion reached through a declared transition. `verifyBeforeTransition` reads
    // `required` *before* its verification, so when that verification is what recognises the
    // form sign-in, the pending-request refusal below it is skipped as though no session were
    // required — and the window has already been reset by then. Refusing inside the promotion
    // closes this entry point too, without the transition having to recompute anything.
    const savedUrl = process.env['APP_URL'];
    // `verifyBeforeTransition` compares `page.url()` against the helpers' own base URL, which
    // defaults to localhost; without this the transition reads the page as off-app and returns
    // before verifying anything, and the control would pass on the wrong evidence.
    process.env['APP_URL'] = APP;
    try {
      const page = fakePage({ url: `${APP}/#/`, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      page.state.storage = { ...signedIn };
      page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
      const inFlight = page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
      const thrown = await thrownBy(async () => {
        await h.signedOut('selftest: driving the sign-in form');
        page.state.storage = {};
        inFlight.finish();
        await h.step('two');
        await h.finish();
      });
      control(
        'negative',
        'a transition whose own verification recognises the form sign-in still refuses a request in flight across it',
        thrown instanceof PreconditionError &&
          /in flight/.test(thrown.message) &&
          /search\/lang\/NXQL\/execute/.test(thrown.message) &&
          identity.checks.some((c) => !c.ok),
        { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
      );
    } finally {
      if (savedUrl === undefined) Reflect.deleteProperty(process.env, 'APP_URL');
      else process.env['APP_URL'] = savedUrl;
    }
  }
  {
    // The interval a probe cannot cover however late it runs: the page is live while
    // `h.login()` clears the cookies and writes the new session, after the boot-navigation
    // verification and before the reload. A repeated login therefore declines the signed-out
    // exemption entirely, so this traffic stays in the window and the next boundary judges it
    // against the session being installed.
    const saved = Object.fromEntries(
      ['APP_URL', 'NUXEO_USER', 'NUXEO_PASS'].map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, { APP_URL: APP, NUXEO_USER: 'Administrator', NUXEO_PASS: 'pw' });
    const LOGIN = `Basic ${Buffer.from('Administrator:pw').toString('base64')}`;
    try {
      const page = fakePage({
        url: 'about:blank',
        meFor: (auth) => (auth === LOGIN ? ADMIN : GUEST),
      });
      page.state.bootRequests = [`${APP}/nuxeo/api/v1/me`];
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      await h.login();
      // The repeated login's own boot is authenticated and clean; the only offending request is
      // the one that completes while the cookies are being cleared.
      page.state.bootRequests = [{ url: `${APP}/nuxeo/api/v1/me`, authorization: LOGIN }];
      page.state.duringClear = () =>
        page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
      const thrown = await thrownBy(async () => {
        await h.login();
        page.state.duringClear = undefined;
        await h.step('two');
        await h.finish();
      });
      control(
        'negative',
        'a headerless request completing while repeated h.login() clears cookies and installs the session is still judged',
        thrown instanceof PreconditionError &&
          /without the header/.test(thrown.message) &&
          /search\/lang\/NXQL\/execute/.test(thrown.message),
        { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // Gap 2: the re-login interval after the second verification is unjudged for cross-user logins.
    // When h.login() is replacing a session for a DIFFERENT user, expectApp() restarts the window,
    // putting requests from the clearCookies/storage interval behind `since` where no boundary sees them.
    // This control simulates a cross-user re-login (after h.signedInAs) with a request during that interval.
    const saved = { NUXEO_USER: process.env['NUXEO_USER'], NUXEO_PASS: process.env['NUXEO_PASS'], APP_URL: process.env['APP_URL'] };
    process.env['NUXEO_USER'] = 'Administrator';
    process.env['NUXEO_PASS'] = 'adminpw';
    process.env['APP_URL'] = APP;
    try {
      const page = fakePage({ url: `${APP}/#/`, storage: { ...signedIn } });
      const ALT_USER = 'AlternateUser';
      const ALT_AUTH = `Basic ${b64(`${ALT_USER}:altpw`)}`;
      page.state.meFor = (/** @type {string | null} */ auth) =>
        auth === H ? ADMIN : auth === ALT_AUTH ? { id: ALT_USER, isAnonymous: false } : GUEST;
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      // Sign in as alternate user, then switch back to Administrator (cross-user re-login)
      await h.signedInAs(ALT_USER, 'altpw', 'switch to alternate user');
      page.state.storage = { 'sessionStorage:agentic_ui_nuxeo_session': basicSession(ALT_USER, b64(`${ALT_USER}:altpw`)) };
      page.send(`${APP}/nuxeo/api/v1/me`, { authorization: ALT_AUTH });
      // The boot navigation happens while the AlternateUser session is still active, so it uses ALT_AUTH
      page.state.bootRequests = [{ url: `${APP}/nuxeo/api/v1/me`, authorization: ALT_AUTH }];
      // During clearCookies, send a headerless request that should be caught but currently escapes (Gap 2)
      page.state.duringClear = () =>
        page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null, cookie: null });
      const thrown = await thrownBy(async () => {
        await h.login(); // Cross-user: from AlternateUser back to Administrator
        page.state.duringClear = undefined;
        await h.step('two');
        await h.finish();
      });
      control(
        'negative',
        'a cross-user re-login: a request during the post-verification interval is refused (Gap 2 - re-login interval)',
        thrown instanceof PreconditionError &&
          /identity guard/.test(thrown.message) &&
          (/without the .* session's credential/.test(thrown.message) || /in flight/.test(thrown.message)) &&
          /search\/lang\/NXQL\/execute/.test(thrown.message) &&
          identity.checks.some((c) => !c.ok && c.at.includes('cross-user re-login')),
        { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }
  {
    // The other side of the same stale `required`: a request the app starts *during* the probe.
    // It is beyond the promotion's mark, so `pendingAcrossSignIn` rightly leaves it in the
    // window for a later boundary — but the transition reads `required` from before the
    // verification, skips the pending check, and then restarts the window over it.
    const savedUrl = process.env['APP_URL'];
    process.env['APP_URL'] = APP;
    try {
      const page = fakePage({ url: `${APP}/#/` });
      /** @type {{ finish: () => void } | null} */
      let inFlight = null;
      page.state.meFor = (/** @type {string | null} */ auth) => {
        inFlight ??= page.begin(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`);
        return auth === H ? ADMIN : GUEST;
      };
      const recorder = { steps: [], consoleErrors: [] };
      const identity = createIdentityMonitor({
        page,
        baseUrl: APP,
        username: 'Administrator',
        fetchImpl: page.fetch,
      });
      const h = createHelpers(page, '/tmp', recorder, { identity });
      await h.step('one');
      page.state.storage = { ...signedIn };
      page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
      const thrown = await thrownBy(async () => {
        await h.signedOut('selftest: driving the sign-in form');
        page.state.storage = {};
        inFlight?.finish();
        await h.step('two');
        await h.finish();
      });
      control(
        'negative',
        'a request started while the boundary probe runs is not discarded by the transition that follows it',
        thrown instanceof PreconditionError &&
          /in flight/.test(thrown.message) &&
          /search\/lang\/NXQL\/execute/.test(thrown.message) &&
          identity.checks.some((c) => !c.ok),
        { thrown: String(thrown), checks: identity.checks.map((c) => [c.at, c.ok]) },
      );
    } finally {
      if (savedUrl === undefined) Reflect.deleteProperty(process.env, 'APP_URL');
      else process.env['APP_URL'] = savedUrl;
    }
  }
  {
    // `pendingAcrossSignIn` on its own: where the bootstrap exemption ends, and what the
    // promotion's mark excludes.
    const req = (/** @type {any} */ over) => ({
      method: 'GET',
      path: '/nuxeo/api/v1/x',
      finished: true,
      networkComplete: true,
      failed: false,
      authorization: null,
      cookie: null,
      ...over,
    });
    const signedInBoot = req({ authorization: H });
    const flying = req({ path: '/nuxeo/api/v1/search', finished: false });
    /** @param {any[]} sent */
    const log = (sent) => /** @type {any} */ ({ sent, since: 0 });

    control(
      'negative',
      'a request in flight after the first header-carrying one is reported: the app was signed in when it started it',
      pendingAcrossSignIn(log([req({}), signedInBoot, flying]), 3).length === 1,
    );
    control(
      'positive',
      "a request in flight before anything carried a header is the signed-out page's own, and is not reported",
      pendingAcrossSignIn(log([req({}), flying, req({})]), 3).length === 0,
    );
    control(
      'positive',
      'a request that failed is not in flight, so it is not reported',
      pendingAcrossSignIn(log([signedInBoot, req({ finished: false, failed: true })]), 2).length ===
        0,
    );
    control(
      'positive',
      "a request started after the probe's mark is not reported: the restart leaves it in the window for a later boundary",
      pendingAcrossSignIn(log([signedInBoot, flying]), 1).length === 0,
    );
  }
  {
    // A form sign-in, seen at a boundary rather than declared.
    const page = fakePage({ url: `${APP}/#/`, meFor: (auth) => (auth === H ? ADMIN : GUEST) });
    const recorder = { steps: [], consoleErrors: [] };
    const identity = createIdentityMonitor({
      page,
      baseUrl: APP,
      username: 'Administrator',
      fetchImpl: page.fetch,
    });
    const h = createHelpers(page, '/tmp', recorder, { identity });
    await h.step('one');
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: null });
    page.state.storage = { ...signedIn };
    page.send(`${APP}/nuxeo/api/v1/me`, { authorization: H });
    const atSignIn = await thrownBy(() => h.step('two'));
    page.send(`${APP}/nuxeo/api/v1/path/default-domain`, { authorization: H });
    const after = await thrownBy(() => h.step('three'));
    page.send(`${APP}/nuxeo/api/v1/search/lang/NXQL/execute`, { authorization: null });
    const thrown = await thrownBy(() => h.step('four'));
    control(
      'negative',
      'after a form sign-in, the signed-out requests before it stay excused and a headerless one after it is refused',
      atSignIn === null &&
        after === null &&
        thrown instanceof PreconditionError &&
        /without the header/.test(thrown.message),
      { atSignIn: String(atSignIn), after: String(after), thrown: String(thrown) },
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

// ── the live controls' own verdict ──────────────────────────────────────────────────────────────
// `identity-guard.controls.mjs` is the evidence every other claim about the guard rests on, so
// its accept/reject rule is held to the same standard as the guard itself: shown rejecting a run
// that proved nothing, and accepting one that did.
{
  const faulted = { mode: 'drop-credentials', exit: 2, valid: false };
  const rejectedAsGuest = {
    identity: {
      valid: false,
      checks: [{ at: 'at the start', reports: [{ ok: false, problem: 'ran as Anonymous' }] }],
    },
    verdict: 'precondition-not-met',
  };
  /** @param {any[]} checks */
  const withSteps = (checks) => ({ ...rejectedAsGuest, steps: [{ checks }] });

  control(
    'negative',
    'a faulted control that never reached its fault is rejected: exit, verdict and the Anonymous rejection all match, and it still proves nothing',
    judgeControlRun(faulted, 2, { ...rejectedAsGuest, steps: [] }).some((p) =>
      p.includes(POST_FAULT_ASSERTION),
    ),
    judgeControlRun(faulted, 2, { ...rejectedAsGuest, steps: [] }),
  );
  control(
    'negative',
    'a faulted control whose own checks failed is rejected: it would have been red without the guard, so it says nothing about it',
    judgeControlRun(faulted, 2, withSteps([{ name: POST_FAULT_ASSERTION, passed: false }])).some(
      (p) => p.includes("the steps' own checks failed"),
    ),
  );
  control(
    'negative',
    'the guard checks alone cannot certify a control: a manifest carrying only them is rejected',
    judgeControlRun(
      faulted,
      2,
      withSteps([{ name: 'precondition: identity guard at the start', passed: true }]),
    ).some((p) => p.includes(POST_FAULT_ASSERTION)),
  );
  control(
    'positive',
    'a faulted control that reached its fault, asserted after it, and was rejected as Anonymous is accepted',
    judgeControlRun(faulted, 2, withSteps([{ name: POST_FAULT_ASSERTION, passed: true }]))
      .length === 0,
    judgeControlRun(faulted, 2, withSteps([{ name: POST_FAULT_ASSERTION, passed: true }])),
  );
  control(
    'positive',
    'the unfaulted control is accepted when it ran to the end',
    judgeControlRun({ mode: 'none', exit: 0, valid: true }, 0, {
      identity: { valid: true, checks: [] },
      verdict: 'complete',
      steps: [{ checks: [{ name: POST_FAULT_ASSERTION, passed: true }] }],
    }).length === 0,
  );
}

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
