/**
 * The identity guard: a result counts only if the run actually obtained it as the user it says.
 *
 * ## Why a status code is not enough
 *
 * Some Nuxeo servers have anonymous authentication switched on. The shared local one does. On
 * those, a request with no credentials is not refused: Nuxeo answers it `200` as a guest called
 * `Anonymous`, with no `WWW-Authenticate` challenge. Every signal a harness had used — the status,
 * a non-empty result, a rendered page — looks the same either way. A permission check then passes
 * for the wrong reason ("Delete is hidden" because a guest can do nothing, not because the rule
 * works), and the evidence says nothing about it. NXSAT-643.
 *
 * Measured against that server (Playwright 1.63, Nuxeo 2025):
 *
 * - `httpCredentials` with the default `send: 'unauthorized'` is never sent, because no challenge
 *   arrives. `page.request`, a context's `request` and the browser itself all ran as `Anonymous`.
 * - `send: 'always'` makes `page.request` and `context.request` send it, and nothing else: browser
 *   navigation and in-page `fetch` still ran as `Anonymous`. It also **replaces** an explicit
 *   `Authorization` header on the request, so a request meant to run as another user runs as the
 *   context's user instead. Use a separate `request.newContext()` or `fetch` for a second identity.
 * - A guest `JSESSIONID` that has already answered an API request as the guest **beats a valid
 *   Basic header**: with that cookie, `/me` answers `Anonymous` even with the administrator's
 *   header on the same request. (Fresh from Nuxeo's entry page, before any API call, it does not.)
 *   The app adds to it: with no stored session it asks `/me`, gets `Anonymous`, and stores that as
 *   a cookie session (`tryEstablishCookieSessionOnly` in `auth.service.ts`), after which it sends
 *   no `Authorization` header at all. `page.request` shares the browser's cookie jar, so a guest
 *   cookie the browser picked up moves the harness's own API calls too.
 *
 * ## What the guard checks
 *
 * Nuxeo is asked who the request ran as — `GET /nuxeo/api/v1/me`, the one response that names the
 * principal — **through the same channel the result came from**, never through a fresh one:
 *
 * - `api` — a Playwright `APIRequestContext` (`page.request`, or a context of its own) exactly as
 *   the harness's own requests use it, or Node `fetch` with the header a script sends.
 * - `app` — the browser page. The app's stored session is read from the same storage the app
 *   reads, and `/me` is asked twice with the header the app's interceptor adds for that session:
 *   from inside the page, through whatever routes and cookies the page has — what the app's own
 *   requests get — and replayed from Node with the same header and the browser's cookies, which no
 *   `page.route` can intercept, so a stubbed `/me` cannot certify a principal Nuxeo never saw.
 *   `/me` vouches only for the header it was asked with, so the requests the page actually sent
 *   to Nuxeo are judged too (`watchNuxeoApiOrigins`): each must have gone out with that header.
 *
 * No probe follows a redirect. Whoever answers at the destination is not the server the result
 * came from, and could name any user; a `/me` that redirects is no answer.
 *
 * A result is rejected when an answer is `Anonymous` (`isAnonymous`, or the id itself), another
 * user, or no answer, and when the app holds a session for anyone but the expected user. Being
 * signed out, or off the app, is accepted only before the run has signed the app in, or after the
 * steps declared a sign-out (`AppPolicy`): a run that loses its session without saying so could be
 * hiding a result it obtained as someone else.
 *
 * ## What it assumes, and checks
 *
 * The app talks to Nuxeo on its own origin (`/nuxeo` through the dev proxy or same-origin in
 * production), which is where the guard asks. It does not assume it: `watchNuxeoApiOrigins`
 * records any Nuxeo API request to another origin — an app configured with a different
 * `nuxeoApiOrigin` — and the app channel is then refused rather than judged on the wrong server.
 *
 * Plain ESM with no imports, so `.mjs` harnesses and the Playwright suites (`apps/nuxeo-ui-e2e`,
 * `a11y/`) share this one copy. Nothing here decides what to do about a problem: the callers turn
 * a report into `precondition-not-met` (the phase runner), a thrown error (fixtures, preflights),
 * or an exit code.
 */

/** Where Nuxeo names the principal a request ran as. */
export const ME_PATH = '/nuxeo/api/v1/me';

/**
 * How long one `/me` probe may take, headers and body together. A probe that never finishes must
 * end as a rejected identity, not hang the run before it can report or clean up.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/** Marks the guard's own in-page `/me`, so it is not counted among the requests the page sent. */
const PROBE_MARK = 'identityGuard=';

/** The request types the app's HTTP client sends, and so the ones its interceptor authenticates. */
const APP_REQUEST_TYPES = new Set(['fetch', 'xhr']);

/**
 * The storage keys a browser session can live under, in the order they are read.
 *
 * Mirrors `STORAGE_KEY` in `apps/nuxeo-ui/src/app/auth/auth.service.ts`, which reads
 * `sessionStorage` then `localStorage`, and `STORAGE_KEY` in
 * `apps/nuxeo-satori-template/src/app/template-session.service.ts` (`sessionStorage` only).
 */
export const APP_SESSION_SOURCES = /** @type {const} */ ([
  { key: 'agentic_ui_nuxeo_session', storage: 'sessionStorage' },
  { key: 'agentic_ui_nuxeo_session', storage: 'localStorage' },
  { key: 'satori_template_session', storage: 'sessionStorage' },
]);

/**
 * @typedef {object} MeAnswer
 * @property {number} status HTTP status, or 0 when nothing answered
 * @property {unknown} body parsed JSON, or null
 * @property {string} [error] why there is no answer
 */

/**
 * @typedef {object} StoredSession
 * @property {string} key
 * @property {string} storage
 * @property {string} kind `basic`, `cookie`, or `template` (the template app's basic shape)
 * @property {string | null} username
 * @property {string | null} authorization the header the app sends for it, or null for a cookie session
 */

/**
 * A request the page's main frame sent to Nuxeo on the app origin.
 *
 * @typedef {object} SentRequest
 * @property {string} method
 * @property {string} path
 * @property {boolean} finished
 * @property {boolean} failed the page will never receive a response: aborted, or a network error.
 *   Not `finished`, so nothing judges it — and nothing can have read it either
 * @property {string | null} authorization the header it went out with, after any `page.route`
 *   rewrite; read when it finished
 */

/**
 * @typedef {object} ChannelReport
 * @property {'api' | 'app' | 'step'} channel `step` when a step boundary could not be judged
 * @property {boolean} ok
 * @property {string} state `authenticated`, `signed-out`, `not-on-app`, or `rejected`
 * @property {string | null} expected
 * @property {string | null} user the principal Nuxeo named, or null
 * @property {string | null} [session] the stored session's kind and user, for the app channel
 * @property {string | null} problem why the result is rejected, or null
 */

/**
 * What a check requires of the app channel.
 *
 * - `{ user }` — the app must hold a session for `user` that Nuxeo answers as `user`. Signed out,
 *   or off the app, is a rejection.
 * - `{ unsigned: user }` — the run has not signed the app in yet, or the steps declared a sign-out.
 *   No session and no app are accepted; a session that is there is still judged against `user`, so
 *   a guest the app adopted on its own is rejected even then.
 *
 * A bare string means `{ user: string }`.
 *
 * @typedef {{ user: string } | { unsigned: string } | string} AppPolicy
 */

/**
 * Exact comparison. Nuxeo's default user directory ignores case, but not every directory does,
 * and `alice` and `Alice` can be two principals; a guard for "any Nuxeo server" fails closed.
 * Spell `NUXEO_USER` the way `/me` names it. Anything that is not a non-empty string matches
 * nothing.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameUser(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a !== '' && a === b;
}

/** @param {unknown} id */
function isAnonymousId(id) {
  // Case-insensitive here only: failing closed means treating any spelling of the guest as one.
  return typeof id === 'string' && id.toLowerCase() === 'anonymous';
}

/**
 * Whether a `/me` body describes the guest. The flag is authoritative; the id is checked too, for
 * a server whose body lacks the flag.
 *
 * @param {unknown} body
 */
export function isAnonymousMe(body) {
  if (!body || typeof body !== 'object') return false;
  const me = /** @type {Record<string, unknown>} */ (body);
  return me['isAnonymous'] === true || isAnonymousId(me['id']);
}

/**
 * Judge one `/me` answer against the user the result claims to be from.
 *
 * @param {MeAnswer} answer
 * @param {string} expected
 * @returns {{ user: string | null, problem: string | null }}
 */
export function judgeMe(answer, expected) {
  if (!expected || isAnonymousId(expected)) {
    return {
      user: null,
      problem: `the expected identity is ${JSON.stringify(expected)}, which proves nothing`,
    };
  }
  if (answer.status !== 200) {
    const why = answer.error ? ` (${answer.error})` : '';
    return { user: null, problem: `${ME_PATH} answered ${answer.status || 'nothing'}${why}` };
  }
  const body =
    answer.body && typeof answer.body === 'object'
      ? /** @type {Record<string, unknown>} */ (answer.body)
      : null;
  const id = typeof body?.['id'] === 'string' ? /** @type {string} */ (body['id']) : null;
  if (!id) return { user: null, problem: `${ME_PATH} answered 200 with no user id` };
  if (isAnonymousMe(body)) {
    return {
      user: id,
      problem: `Nuxeo ran the request as ${id}, the anonymous guest, not as ${expected}`,
    };
  }
  if (!sameUser(id, expected)) {
    return { user: id, problem: `Nuxeo ran the request as ${id}, not as ${expected}` };
  }
  return { user: id, problem: null };
}

/**
 * Parse one stored value into the session the app would act on, or a reason it cannot be read.
 *
 * @param {string} key
 * @param {string} storage
 * @param {string} raw
 * @returns {StoredSession | { problem: string }}
 */
export function parseStoredSession(key, storage, raw) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: `${storage}[${key}] does not hold JSON` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      problem: `${storage}[${key}] holds ${parsed === null ? 'null' : typeof parsed}, not a session`,
    };
  }
  const s = /** @type {Record<string, unknown>} */ (parsed);
  const username = typeof s['username'] === 'string' ? s['username'] : null;
  const basic = typeof s['basic'] === 'string' && s['basic'] !== '' ? s['basic'] : null;
  // The app's own reader treats a value without `kind` as basic when it carries `basic`.
  const kind =
    typeof s['kind'] === 'string'
      ? s['kind']
      : key === 'satori_template_session'
        ? 'template'
        : basic
          ? 'basic'
          : 'unknown';
  if (kind === 'cookie') return { key, storage, kind, username, authorization: null };
  if ((kind === 'basic' || kind === 'template') && basic) {
    return { key, storage, kind, username, authorization: `Basic ${basic}` };
  }
  return { problem: `${storage}[${key}] holds a "${kind}" session the app cannot sign in with` };
}

/** @param {AppPolicy} policy */
function normalisePolicy(policy) {
  if (typeof policy === 'string') return { user: policy, required: true };
  if ('user' in policy) return { user: policy.user, required: true };
  return { user: policy.unsigned, required: false };
}

/**
 * Judge the app channel: the session the page holds, what `/me` answered for it — asked from
 * inside the page, and replayed from Node with the same header and cookies — and whether the
 * page's own requests went out with that session's header (`strayRequests`).
 *
 * @param {StoredSession | { problem: string } | null | 'not-on-app'} stored
 * @param {{ inPage: MeAnswer | null, replayed: MeAnswer | null }} answers null when not asked
 * @param {AppPolicy} policy
 * @param {SentRequest[]} [stray] requests the page sent without the session's header
 * @returns {ChannelReport}
 */
export function judgeApp(stored, answers, policy, stray = []) {
  const { user: expected, required } = normalisePolicy(policy);
  const base = { channel: /** @type {const} */ ('app'), expected, user: null, session: null };
  /** @param {string} problem @param {object} [extra] */
  const reject = (problem, extra = {}) => ({
    ...base,
    ok: false,
    state: 'rejected',
    problem,
    ...extra,
  });

  if (stored === null || stored === 'not-on-app') {
    const state = stored === null ? 'signed-out' : 'not-on-app';
    if (!required) return { ...base, ok: true, state, problem: null };
    return reject(
      stored === null
        ? `the app holds no session, but this run signed it in as ${expected} and declared no sign-out`
        : `the page is not on the app, but this run signed it in as ${expected}; its result cannot be judged`,
    );
  }
  if ('problem' in stored) return reject(stored.problem);
  const session = `${stored.kind} session for ${stored.username ?? '(no user)'}`;
  if (!sameUser(stored.username, expected)) {
    return reject(`the app holds a ${session}, not for ${expected}`, { session });
  }
  /** @type {[string, MeAnswer | null][]} */
  const asked = [
    ['asked from the page', answers.inPage],
    ['replayed from Node with its header and cookies', answers.replayed],
  ];
  for (const [via, answer] of asked) {
    const verdict = judgeMe(answer ?? { status: 0, body: null, error: 'not asked' }, expected);
    if (verdict.problem) {
      return reject(`the app's ${session}, ${via}: ${verdict.problem}`, {
        session,
        user: verdict.user,
      });
    }
  }
  if (stray.length) {
    const shown = stray
      .slice(0, 3)
      .map(
        (r) =>
          `${r.method} ${r.path} ${r.authorization === null ? 'with no Authorization' : 'with another Authorization'}`,
      )
      .join('; ');
    return reject(
      `the page sent ${stray.length} Nuxeo request(s) without the header of the app's ${session} ` +
        `(${shown}${stray.length > 3 ? '; …' : ''}), so their results were not obtained as ` +
        `${expected}; /me, asked with that header, does not speak for them`,
      { session },
    );
  }
  return { ...base, ok: true, state: 'authenticated', user: expected, session, problem: null };
}

/**
 * @param {MeAnswer} answer
 * @param {string} expected
 * @param {string} [via] how the request was made, for the report
 * @returns {ChannelReport}
 */
export function judgeApi(answer, expected, via = 'the API context') {
  const verdict = judgeMe(answer, expected);
  return {
    channel: 'api',
    expected,
    ok: verdict.problem === null,
    state: verdict.problem === null ? 'authenticated' : 'rejected',
    user: verdict.user,
    problem: verdict.problem && `${via}: ${verdict.problem}`,
  };
}

// ── Probes ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Ask `/me` through a Playwright `APIRequestContext` — `page.request`, `context.request` or one
 * from `request.newContext()` — with nothing added, so the answer is what that context's other
 * requests get.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} url absolute `/me` URL, or a path when the context has a `baseURL`
 * @returns {Promise<MeAnswer>}
 */
export async function askThroughRequest(request, url) {
  try {
    const res = await request.get(url, {
      headers: { Accept: 'application/json' },
      failOnStatusCode: false,
      maxRedirects: 0,
      // Playwright reads the whole body before resolving, so this bounds it too.
      timeout: PROBE_TIMEOUT_MS,
    });
    if (isRedirect(res.status())) return redirected(res.status(), res.headers()['location']);
    // A body that is not JSON is no identity: `judgeMe` rejects a null body, so nothing is lost.
    return { status: res.status(), body: await res.json().catch(() => null) };
  } catch (err) {
    return { status: 0, body: null, error: firstLine(err) };
  }
}

/**
 * Ask `/me` from Node with the exact headers a script sends — Node's `fetch` keeps no cookies, so
 * with no `Cookie` this is the same channel as the script's other requests.
 *
 * @param {string} url absolute `/me` URL
 * @param {string | null} authorization
 * @param {typeof fetch} [fetchImpl]
 * @param {string} [cookie] a `Cookie` header to replay
 * @param {number} [timeoutMs]
 * @returns {Promise<MeAnswer>}
 */
export async function askThroughFetch(
  url,
  authorization,
  fetchImpl = fetch,
  cookie,
  timeoutMs = PROBE_TIMEOUT_MS,
) {
  try {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' };
    if (authorization) headers['Authorization'] = authorization;
    if (cookie) headers['Cookie'] = cookie;
    // The signal bounds the body read too: an abort rejects `text()` as well as `fetch()`.
    const res = await fetchImpl(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (isRedirect(res.status)) return redirected(res.status, res.headers.get('location'));
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: firstLine(err) };
  }
}

/**
 * Read the page's stored session and, when it holds one, ask `/me` for it from inside the page and
 * from Node. Retried, because a page between navigations has no context to evaluate in.
 *
 * Every request goes to `appOrigin`, the origin the caller validated — never to wherever the page
 * has navigated since — and a page that leaves it during the probe is reported, not followed, so
 * the session's header cannot be sent to another host.
 *
 * The in-page answer must come from a server. A `page.route` that fulfils `/me` itself would
 * otherwise vouch for the session while other routes strip the header from every data request;
 * Playwright reports no server address for a fulfilled response, so such an answer is refused.
 * (Measured on Chromium and WebKit: a real response has one, a fulfilled one has `null`.)
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} appOrigin
 * @param {typeof fetch} [fetchImpl] for the replay
 * @param {number} [timeoutMs] per probe, body included
 * @returns {Promise<{ stored: StoredSession | { problem: string } | null, answers: { inPage: MeAnswer | null, replayed: MeAnswer | null } }>}
 */
export async function askThroughPage(
  page,
  appOrigin,
  fetchImpl = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
) {
  const none = { inPage: null, replayed: null };
  const origin = originOf(appOrigin);
  const stillOnApp = () => originOf(safeUrl(page)) === origin;
  const left = () => ({
    stored: { problem: `the page left ${origin} during the identity check (now ${safeUrl(page)})` },
    answers: none,
  });
  /** @type {unknown} */
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const found = await page.evaluate((sources) => {
        for (const s of sources) {
          const raw = (s.storage === 'localStorage' ? localStorage : sessionStorage).getItem(s.key);
          if (raw !== null) return { key: s.key, storage: s.storage, raw };
        }
        return null;
      }, APP_SESSION_SOURCES);
      if (!stillOnApp()) return left();
      if (!found) return { stored: null, answers: none };
      const stored = parseStoredSession(found.key, found.storage, found.raw);
      if ('problem' in stored) return { stored, answers: none };

      const nonce = `${PROBE_MARK}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      const seen = page
        .waitForResponse((r) => r.url().includes(nonce), { timeout: timeoutMs + 1_000 })
        // No response seen is itself a verdict: the in-page answer is refused below.
        .catch(() => null);
      /** @type {MeAnswer} */
      let inPage = await page.evaluate(
        async ({ url, authorization, timeoutMs }) => {
          // Bounds the request and its body: aborting rejects a pending `json()` as well.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            /** @type {Record<string, string>} */
            const headers = { Accept: 'application/json' };
            if (authorization) headers['Authorization'] = authorization;
            const res = await fetch(url, {
              headers,
              credentials: 'same-origin',
              redirect: 'manual',
              signal: controller.signal,
            });
            if (res.type === 'opaqueredirect') {
              return {
                status: 0,
                body: null,
                error: 'redirected, and a redirected /me is refused',
              };
            }
            // Not JSON means no identity, which `judgeMe` rejects; an abort lands in the catch.
            const body = await res.json().catch((err) => {
              if (controller.signal.aborted) throw err;
              return null;
            });
            return { status: res.status, body };
          } catch (err) {
            return { status: 0, body: null, error: String(err) };
          } finally {
            clearTimeout(timer);
          }
        },
        {
          url: `${origin}${ME_PATH}?${nonce}`,
          authorization: stored.authorization,
          timeoutMs,
        },
      );
      const response = await seen;
      // No address, for whatever reason, is treated as a stub and refused below. An answer that
      // is already refused keeps its own reason: Playwright reports no response for a manual
      // redirect (measured on Chromium, 1.63), and "no response seen" would hide why.
      const server = response ? await response.serverAddr().catch(() => null) : null;
      if (!server && !inPage.error) {
        inPage = {
          status: 0,
          body: null,
          error: response
            ? 'answered by a page.route stub, not by a server'
            : 'no response to the probe was seen',
        };
      }
      if (!stillOnApp()) return left();

      const url = `${origin}${ME_PATH}`;
      const cookies = await page.context().cookies(url);
      const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const replayed = await askThroughFetch(
        url,
        stored.authorization,
        fetchImpl,
        cookie,
        timeoutMs,
      );
      // And after the replay: a page that navigated during `cookies()` or the request is no
      // longer the page these answers describe.
      if (!stillOnApp()) return left();
      return { stored, answers: { inPage, replayed } };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return {
    stored: {
      problem: `could not read the page's session on ${safeUrl(page)}: ${firstLine(lastError)}`,
    },
    answers: none,
  };
}

/**
 * What `watchNuxeoApiOrigins` records. It is the set of foreign origins, so a caller that only
 * passes it on needs no change, and it also keeps the requests sent on the app's own origin.
 */
class NuxeoApiTraffic extends Set {
  /** @type {SentRequest[]} */
  sent = [];
  /** Where the current session's requests start in `sent`. */
  since = 0;
  /** Set by `restartAtNextLoad`: the next main-frame load moves `since`. */
  armed = false;

  /**
   * From here on, every request must carry the session's header: a declared change of identity,
   * or a sign-in seen at a boundary. What the page sent before it is not the session's.
   *
   * @param {number} [at] a position in `sent`; by default, now
   */
  restart(at = this.sent.length) {
    this.since = at;
    this.armed = false;
  }

  /**
   * A session was just written into a page that booted signed out, and the reload about to happen
   * is where its requests start. What the signed-out document sent is not held against it.
   */
  restartAtNextLoad() {
    this.armed = true;
  }
}

/**
 * Same-origin reads the app makes without `Authorization` by design. `AppConfigService` and
 * `DocumentLayoutService` fetch the configuration service's files through `HttpBackend`, which
 * skips every interceptor; under the production base href `/nuxeo/agentic-ui/` that directory is
 * `/nuxeo/agentic-ui-config/`.
 *
 * @param {SentRequest} r
 */
function anonymousByDesign(r) {
  return r.method === 'GET' && r.path.startsWith('/nuxeo/agentic-ui-config/');
}

/**
 * Record what the page sends to Nuxeo, from before its first navigation:
 *
 * - every origin other than `appOrigin` it sends a Nuxeo API request to. The guard asks `/me` on
 *   the app's origin; an app configured with another `nuxeoApiOrigin` would be judged on the
 *   wrong server, so any request elsewhere makes `checkPageIdentity` refuse instead of assuming.
 * - every request the main frame's HTTP client sends to `/nuxeo/` on the app origin, the ones the
 *   app's interceptor authenticates, with the `Authorization` it went out with. It is read when
 *   the request finishes, because that is after any `page.route` rewrite: the `request` event
 *   reports the header the page set, not the one sent (measured on Chromium, Playwright 1.63).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} appOrigin
 * @returns {NuxeoApiTraffic} filled as requests are made
 */
export function watchNuxeoApiOrigins(page, appOrigin) {
  const origin = originOf(appOrigin);
  const traffic = new NuxeoApiTraffic();
  /** @type {WeakMap<object, SentRequest>} */
  const pending = new WeakMap();
  page.on('request', (request) => {
    if (fromMainFrame(page, request) && request.isNavigationRequest()) {
      if (traffic.armed) traffic.restart();
      return;
    }
    /** @type {URL} */
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (!url.pathname.startsWith('/nuxeo/')) return;
    if (url.origin !== origin) {
      traffic.add(url.origin);
      return;
    }
    if (url.search.includes(PROBE_MARK)) return;
    if (!APP_REQUEST_TYPES.has(request.resourceType()) || !fromMainFrame(page, request)) return;
    /** @type {SentRequest} */
    const record = {
      method: request.method(),
      path: url.pathname,
      finished: false,
      failed: false,
      authorization: null,
    };
    traffic.sent.push(record);
    pending.set(request, record);
  });
  page.on('requestfinished', (request) => {
    const record = pending.get(request);
    if (!record) return;
    record.authorization = request.headers()['authorization'] ?? null;
    record.finished = true;
  });
  // Aborted, or a network error: the only other event this request will emit. It is recorded so
  // `pendingRequests` does not report it as still in flight — a navigation aborts whatever was
  // outstanding, and `h.login()` navigates twice, so every transition after one would otherwise
  // refuse. The page received no response, so no step can have read it either.
  page.on('requestfailed', (request) => {
    const record = pending.get(request);
    if (record) record.failed = true;
  });
  return traffic;
}

/**
 * The requests the current session started that have neither finished nor failed: in flight, with
 * no `Authorization` read yet, so nothing can say who they ran as.
 *
 * `strayRequests` judges only finished records, and a transition's `restart` then moves `since`
 * past a pending one — so a request in flight at a transition is judged by nothing, ever, and the
 * run can still report `identity.valid: true` over it. A transition therefore **refuses** when
 * this is non-empty (`verifyBeforeTransition` in `helpers.mjs`) rather than discarding it.
 *
 * Refusing, not waiting, is deliberate. A guard that discards unjudged traffic is worse than the
 * hardcoded fallback it replaced, because it produces false evidence: a result read as the guest,
 * asserted on, and certified. Refusing is noisy and correct. A bounded wait would need a deadline
 * *and* a policy for its expiry, and buys the possibility of a harness that hangs instead of
 * reporting — its own failure mode. Refusing is blunt: a legitimately slow request fails a run
 * that was not compromised. That trade-off is NXSAT-703, not settled here.
 *
 * @param {Set<string> | undefined} traffic from `watchNuxeoApiOrigins`
 * @returns {SentRequest[]}
 */
export function pendingRequests(traffic) {
  // By shape, not `instanceof`, for the reason on `strayRequests`.
  const { sent, since } = /** @type {Partial<NuxeoApiTraffic>} */ (traffic ?? {});
  if (!Array.isArray(sent) || typeof since !== 'number') return [];
  return sent.slice(since).filter((r) => !r.finished && !r.failed && !anonymousByDesign(r));
}

/**
 * The in-flight requests that promoting a form sign-in would strand, in the window `[since, upTo)`
 * a promotion is about to discard.
 *
 * A sign-in the run did not declare is recognised at a boundary: the app is found authenticated
 * as the run's user, a session becomes required from then on, and the window restarts at the
 * probe's mark so what the page sent while signing in is not held against it. A request still in
 * flight at that mark is put *behind* `since` by that restart, and no later boundary's window
 * contains it — so when it completes, headerless or not, it is judged by nothing and the run can
 * still end `identity.valid: true` over what it returned. The promotion therefore refuses while
 * any remains, for the reason `pendingRequests` gives: unjudged traffic certified as valid is
 * false evidence, which is worse than a missing check.
 *
 * The signed-out bootstrap stays exempt, drawn where `strayRequests` draws it — at the first
 * request that carried *any* `Authorization`. Before that the app had no session to send, so its
 * requests are the signed-out page's and carry no identity to strand; after it the app is
 * signed in, and what it sends is the session's.
 *
 * @param {Set<string> | undefined} traffic from `watchNuxeoApiOrigins`
 * @param {number} upTo where the promotion would move `since` to
 * @returns {SentRequest[]}
 */
export function pendingAcrossSignIn(traffic, upTo) {
  // By shape, not `instanceof`, for the reason on `strayRequests`.
  const { sent, since } = /** @type {Partial<NuxeoApiTraffic>} */ (traffic ?? {});
  if (!Array.isArray(sent) || typeof since !== 'number') return [];
  const discarded = sent.slice(since, upTo).filter((r) => !anonymousByDesign(r));
  const signedIn = discarded.findIndex((r) => r.finished && r.authorization !== null);
  if (signedIn < 0) return [];
  return discarded.slice(signedIn).filter((r) => !r.finished && !r.failed);
}

/**
 * The requests the page sent to Nuxeo without `stored`'s header since its session's requests
 * began: the start of the page, or where the session was installed (`restart`,
 * `restartAtNextLoad`).
 *
 * Neither a reload nor a later request that carried the header excuses one sent without it: a
 * step could otherwise read as the guest, assert what it read, then recover the session. Only
 * while the app may still be signed out (`signingIn`) are the requests before the first that
 * carried the header excused; those are the signed-out page before a form sign-in.
 *
 * @param {Set<string> | undefined} traffic from `watchNuxeoApiOrigins`
 * @param {StoredSession} stored
 * @param {{ signingIn?: boolean }} [options]
 * @returns {SentRequest[]}
 */
export function strayRequests(traffic, stored, { signingIn = false } = {}) {
  // By shape, not `instanceof`: a second copy of this module, as a loader can make, would
  // otherwise switch the check off without a word.
  const { sent, since } = /** @type {Partial<NuxeoApiTraffic>} */ (traffic ?? {});
  if (!Array.isArray(sent) || typeof since !== 'number') return [];
  const judged = sent.slice(since).filter((r) => r.finished && !anonymousByDesign(r));
  const first = signingIn ? judged.findIndex((r) => r.authorization === stored.authorization) : 0;
  return judged.slice(Math.max(first, 0)).filter((r) => r.authorization !== stored.authorization);
}

// ── Checks ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The `api` channel: who an `APIRequestContext`'s requests run as.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} meUrl
 * @param {string} expected
 * @param {string} [via]
 * @returns {Promise<ChannelReport>}
 */
export async function checkRequestIdentity(request, meUrl, expected, via) {
  return judgeApi(await askThroughRequest(request, meUrl), expected, via);
}

/**
 * The `api` channel for a Node script: who its `Authorization` header runs as.
 *
 * @param {string} meUrl
 * @param {string} authorization
 * @param {string} expected
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ChannelReport>}
 */
export async function checkFetchIdentity(meUrl, authorization, expected, fetchImpl) {
  return judgeApi(await askThroughFetch(meUrl, authorization, fetchImpl), expected, 'the script');
}

/**
 * The `app` channel: who the app in this page is acting as.
 *
 * @param {import('@playwright/test').Page} page
 * @param {AppPolicy} policy
 * @param {string} appOrigin
 * @param {{ fetchImpl?: typeof fetch, foreignApiOrigins?: Set<string>, timeoutMs?: number }} [options]
 *   `foreignApiOrigins` from `watchNuxeoApiOrigins`: any entry is a refusal, and so is a request
 *   it saw leave without the session's header. Without it, only `/me` is asked.
 * @returns {Promise<ChannelReport>}
 */
export async function checkPageIdentity(
  page,
  policy,
  appOrigin,
  { fetchImpl, foreignApiOrigins, timeoutMs } = {},
) {
  if (foreignApiOrigins?.size) {
    return judgeApp(
      {
        problem:
          `the app sent Nuxeo API requests to ${[...foreignApiOrigins].join(', ')}, not to ` +
          `${originOf(appOrigin)} where this guard asks who they ran as`,
      },
      { inPage: null, replayed: null },
      policy,
    );
  }
  const onApp = originOf(safeUrl(page)) === originOf(appOrigin);
  if (!onApp) {
    // Off-app, but if the policy requires a signed-in user and we have traffic to check, judge the
    // headerless requests that were sent before the navigation rather than letting them be hidden.
    const { user: expectedUser, required } = normalisePolicy(policy);
    if (required && foreignApiOrigins) {
      const signingIn = false;
      // Find what authorization the session used by looking at any authenticated request in the log.
      // Recent requests (since) may all be headerless, so look at the entire history to find what
      // the correct authorization was before the violation.
      // By shape, not `instanceof`: the imports may bring a Set<string> instead of NuxeoApiTraffic.
      const { sent, since } = /** @type {Partial<NuxeoApiTraffic>} */ (foreignApiOrigins ?? {});
      const expectedAuth = Array.isArray(sent)
        ? sent.find((r) => r.authorization)?.authorization
        : null;
      if (expectedAuth) {
        // Use a minimal stored session just for checking stray requests. The real session can't be
        // read because the page is off-app, but the traffic log has the authorization each request
        // carried, so strayRequests can still find headerless ones.
        const stored = {
          key: '',
          storage: '',
          kind: 'basic',
          username: expectedUser,
          authorization: expectedAuth,
        };
        const stray = strayRequests(foreignApiOrigins, stored, { signingIn });
        if (stray.length) {
          // Provide fake successful /me answers so judgeApp focuses on the stray requests.
          const fakeMe = { status: 200, body: { id: expectedUser } };
          return judgeApp(stored, { inPage: fakeMe, replayed: fakeMe }, policy, stray);
        }
      }
    }
    return judgeApp('not-on-app', { inPage: null, replayed: null }, policy);
  }
  const { stored, answers } = await askThroughPage(page, appOrigin, fetchImpl, timeoutMs);
  const signingIn = !normalisePolicy(policy).required;
  const stray =
    stored && !('problem' in stored) ? strayRequests(foreignApiOrigins, stored, { signingIn }) : [];
  return judgeApp(stored, answers, policy, stray);
}

/**
 * Throw when any report is rejected; the message names every problem.
 *
 * @param {ChannelReport[]} reports
 * @param {string} where e.g. `after test "lists repository content"`
 */
export function assertIdentity(reports, where) {
  const problems = reports.filter((r) => !r.ok).map((r) => `[${r.channel}] ${r.problem}`);
  if (problems.length) {
    const error = new Error(
      `identity guard, ${where}: this result was not obtained as the expected user, so it is invalid.\n  ` +
        problems.join('\n  '),
    );
    error.name = 'IdentityError';
    throw error;
  }
}

/** @param {ChannelReport} r */
export function describeReport(r) {
  if (!r.ok) return `[${r.channel}] REJECTED — ${r.problem}`;
  if (r.state === 'authenticated') return `[${r.channel}] ${r.user}`;
  return `[${r.channel}] ${r.state}`;
}

/**
 * Track the expected identity across a run and check it on demand — the phase runner's half.
 *
 * The `api` identity is the run's own credentials and never changes. The `app` channel starts
 * `unsigned` for the same user; signing in (`expectApp`, which `h.login()` calls), or being seen
 * signed in as that user, makes a session required from then on. A steps file that deliberately
 * signs the browser in as someone else, or out, says so (`h.signedInAs`, `h.signedOut`), and the
 * change is recorded so it is in the evidence rather than inferred.
 *
 * Checks are serialised: each starts after the previous one finished, so two never interleave.
 *
 * @param {object} options
 * @param {import('@playwright/test').Page} options.page
 * @param {string} options.baseUrl the app's URL; `/me` is asked through it, as the run's requests are
 * @param {string} options.username the run's credentials
 * @param {typeof fetch} [options.fetchImpl] for the app channel's replay
 */
export function createIdentityMonitor({ page, baseUrl, username, fetchImpl }) {
  const appOrigin = originOf(baseUrl);
  const meUrl = `${appOrigin}${ME_PATH}`;
  const foreignApiOrigins = watchNuxeoApiOrigins(page, appOrigin);
  /** @type {{ user: string } | { unsigned: string }} */
  let policy = { unsigned: username };
  /** @type {{ at: string, ok: boolean, reports: ChannelReport[] }[]} */
  const checks = [];
  /** @type {{ at: string, username: string | null, reason: string }[]} */
  const switches = [];
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  const expectedUser = () => ('user' in policy ? policy.user : policy.unsigned);

  return {
    expectedApi: username,
    get expectedApp() {
      return expectedUser();
    },
    get appPolicy() {
      return policy;
    },
    checks,
    switches,

    /** The current session's requests still in flight; any one of them refuses a transition. */
    pendingRequests() {
      return pendingRequests(foreignApiOrigins);
    },

    /**
     * From here on the app must be signed in as `user`.
     *
     * @param {string} user
     * @param {string} reason
     * @param {string} at
     */
    expectApp(user, reason, at) {
      if (!sameUser(user, expectedUser())) {
        switches.push({ at, username: user, reason });
        foreignApiOrigins.restart();
      }
      policy = { user };
    },

    /**
     * A session was just written into a page that booted signed out; it starts at the next load.
     *
     * The caller must have judged anything the page sent since the window last restarted, or this
     * discards it: on a *repeated* login the boot is not signed out, and its traffic belongs to
     * the session being replaced (`h.login()` in `helpers.mjs` verifies it first).
     */
    sessionInstalled() {
      foreignApiOrigins.restartAtNextLoad();
    },

    /**
     * From here on the app may be signed out; a session it still holds must be the run's own.
     *
     * @param {string} reason
     * @param {string} at
     */
    expectSignedOut(reason, at) {
      switches.push({ at, username: null, reason });
      policy = { unsigned: username };
      foreignApiOrigins.restart();
    },

    /**
     * Record a check that could not judge what it was for, so the run's identity is unproven.
     *
     * @param {string} at
     * @param {string} problem
     */
    reject(at, problem) {
      /** @type {ChannelReport} */
      const report = {
        channel: 'step',
        ok: false,
        state: 'rejected',
        expected: expectedUser(),
        user: null,
        problem,
      };
      checks.push({ at, ok: false, reports: [report] });
      console.log(`  [identity ${at}] ${describeReport(report)}`);
    },

    /**
     * @param {string} at where in the run, e.g. `at the start` or `after step 3`
     * @param {{ app?: boolean }} [options] `app: false` before the page has loaded the app
     */
    verify(at, { app = true } = {}) {
      const run = async () => {
        const mark = foreignApiOrigins.sent.length;
        const reports = [await checkRequestIdentity(page.request, meUrl, username, 'page.request')];
        if (app) {
          reports.push(
            await checkPageIdentity(page, policy, appOrigin, { fetchImpl, foreignApiOrigins }),
          );
        }
        const appReport = reports[1];
        // Seen signed in as the run's user without `h.login()` (a form sign-in): required from now.
        if (appReport?.ok && appReport.state === 'authenticated' && 'unsigned' in policy) {
          // Unless the sign-in left traffic the restart below would strand unjudged. This is a
          // transition in everything but name — it is just not declared by a steps file — so it
          // refuses on the same terms a declared one does rather than promoting over it.
          const stranded = pendingAcrossSignIn(foreignApiOrigins, mark);
          if (stranded.length) {
            const named = stranded.map((r) => `${r.method} ${r.path}`).join(', ');
            /** @type {ChannelReport} */
            const refusal = {
              channel: 'step',
              ok: false,
              state: 'rejected',
              expected: expectedUser(),
              user: null,
              problem:
                `the app was found signed in as ${username}, but ${stranded.length} Nuxeo ` +
                `request(s) it sent after signing in were still in flight: ${named}. Nothing can ` +
                'say who they ran as — they carry no readable Authorization yet, and recognising ' +
                'the sign-in here ends the window anything would judge them in. Let the app settle ' +
                "before the boundary (await the work that issued them, or `page.waitForLoadState('networkidle')`).",
            };
            reports.push(refusal);
          } else {
            policy = { user: username };
            // What the page sent before this check was judged as signing in; after it, strictly.
            foreignApiOrigins.restart(mark);
          }
        }
        const entry = { at, ok: reports.every((r) => r.ok), reports };
        checks.push(entry);
        console.log(`  [identity ${at}] ${reports.map(describeReport).join(' · ')}`);
        return entry;
      };
      const result = queue.then(run, run);
      // The queue only orders checks; the caller receives `result` and its failure.
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/** @param {number} status */
function isRedirect(status) {
  return status >= 300 && status < 400;
}

/**
 * @param {number} status
 * @param {string | null | undefined} location
 * @returns {MeAnswer}
 */
function redirected(status, location) {
  return {
    status,
    body: null,
    error: `redirected to ${location || 'nowhere stated'}, and a redirected /me is refused`,
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Request} request
 */
function fromMainFrame(page, request) {
  try {
    return request.frame() === page.mainFrame();
  } catch {
    // A service worker's request has no frame.
    return false;
  }
}

/** @param {unknown} err */
function firstLine(err) {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0];
}

/** @param {import('@playwright/test').Page} page */
function safeUrl(page) {
  try {
    return page.url();
  } catch {
    return '';
  }
}

/** @param {string} url */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
