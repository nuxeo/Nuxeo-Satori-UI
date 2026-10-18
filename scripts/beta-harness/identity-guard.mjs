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
 *   context's user instead. Use a separate `request.newContext()` for a second identity.
 * - A guest `JSESSIONID` that has already answered an API request as the guest **beats a valid
 *   Basic header**: with that cookie, `/me` answers `Anonymous` even with the administrator's
 *   header on the same request. (Fresh from Nuxeo's entry page, before any API call, it does not.)
 *   A Basic-authenticated session does not stick the same way (its cookie alone answers
 *   `Anonymous`). The app adds to it: with no stored session it asks `/me`, gets `Anonymous`, and
 *   stores that as a cookie session (`tryEstablishCookieSessionOnly` in `auth.service.ts`), after
 *   which it sends no `Authorization` header at all. `page.request` shares the browser's cookie
 *   jar, so a guest cookie the browser picked up moves the harness's own API calls too.
 *
 * ## What the guard checks
 *
 * Nuxeo is asked who the request ran as — `GET /nuxeo/api/v1/me`, the one response that names the
 * principal — **through the same channel the result came from**, never through a fresh one:
 *
 * - `api` — a Playwright `APIRequestContext` (`page.request`, or a context of its own) exactly as
 *   the harness's own requests use it, or Node `fetch` with the header a script sends.
 * - `app` — the browser page. The app's stored session is read from the same storage the app
 *   reads, and `/me` is fetched **from inside the page** with the header the app's interceptor
 *   would add for that session, plus whatever cookies and routes the page has. That is what the
 *   app's own requests get.
 *
 * A result is rejected when the answer is `Anonymous` (`isAnonymous`, or the id itself), another
 * user, or no answer. A page that holds no session is reported as `signed-out` and accepted: the
 * route guard keeps a signed-out app on the sign-in page, so it has obtained nothing from Nuxeo as
 * anyone. A page that holds a guest's cookie session is not signed out — it is `Anonymous`, and is
 * rejected.
 *
 * Plain ESM with no imports, so `.mjs` harnesses and the Playwright suites (`apps/nuxeo-ui-e2e`,
 * `a11y/`) share this one copy. Nothing here decides what to do about a problem: the callers turn
 * a report into `precondition-not-met` (the phase runner), a thrown error (fixtures, preflights),
 * or an exit code.
 */

/** Where Nuxeo names the principal a request ran as. */
export const ME_PATH = '/nuxeo/api/v1/me';

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
 * @typedef {object} ChannelReport
 * @property {'api' | 'app'} channel
 * @property {boolean} ok
 * @property {string} state `authenticated`, `signed-out`, `not-on-app`, or `rejected`
 * @property {string | null} expected
 * @property {string | null} user the principal Nuxeo named, or null
 * @property {string | null} [session] the stored session's kind and user, for the app channel
 * @property {string | null} problem why the result is rejected, or null
 */

/**
 * Nuxeo user ids compare case-insensitively by default, so `administrator` and `Administrator`
 * are one principal. Anything that is not a non-empty string matches nothing.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameUser(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a !== '' &&
    a.toLowerCase() === b.toLowerCase()
  );
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
  return me['isAnonymous'] === true || sameUser(me['id'], 'Anonymous');
}

/**
 * Judge one `/me` answer against the user the result claims to be from.
 *
 * @param {MeAnswer} answer
 * @param {string} expected
 * @returns {{ user: string | null, problem: string | null }}
 */
export function judgeMe(answer, expected) {
  if (!expected || sameUser(expected, 'Anonymous')) {
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

/**
 * Judge the app channel: the session the page holds, and what `/me` answered when asked the way
 * the app asks.
 *
 * @param {StoredSession | { problem: string } | null} stored null when the page holds no session
 * @param {MeAnswer | null} answer null when there was no session to ask with
 * @param {string} expected
 * @returns {ChannelReport}
 */
export function judgeApp(stored, answer, expected) {
  const base = { channel: /** @type {const} */ ('app'), expected };
  if (stored === null) {
    return { ...base, ok: true, state: 'signed-out', user: null, session: null, problem: null };
  }
  if ('problem' in stored) {
    return {
      ...base,
      ok: false,
      state: 'rejected',
      user: null,
      session: null,
      problem: stored.problem,
    };
  }
  const session = `${stored.kind} session for ${stored.username ?? '(no user)'}`;
  if (!sameUser(stored.username, expected)) {
    return {
      ...base,
      ok: false,
      state: 'rejected',
      user: null,
      session,
      problem: `the app holds a ${session}, not for ${expected}`,
    };
  }
  const verdict = judgeMe(answer ?? { status: 0, body: null, error: 'not asked' }, expected);
  return {
    ...base,
    ok: verdict.problem === null,
    state: verdict.problem === null ? 'authenticated' : 'rejected',
    user: verdict.user,
    session,
    problem: verdict.problem && `the app's ${session}: ${verdict.problem}`,
  };
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
    });
    return { status: res.status(), body: await res.json().catch(() => null) };
  } catch (err) {
    return { status: 0, body: null, error: firstLine(err) };
  }
}

/**
 * Ask `/me` from Node with the exact `Authorization` header a script sends, and no cookies —
 * Node's `fetch` keeps none, so this is the same channel as the script's other requests.
 *
 * @param {string} url absolute `/me` URL
 * @param {string} authorization
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<MeAnswer>}
 */
export async function askThroughFetch(url, authorization, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: authorization },
    });
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
 * Read the page's stored session and, when it holds one, ask `/me` from inside the page the way
 * the app does. Retried, because a page between navigations has no context to evaluate in.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ stored: StoredSession | { problem: string } | null, answer: MeAnswer | null }>}
 */
export async function askThroughPage(page) {
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
      if (!found) return { stored: null, answer: null };
      const stored = parseStoredSession(found.key, found.storage, found.raw);
      if ('problem' in stored) return { stored, answer: null };
      const answer = await page.evaluate(
        async ({ mePath, authorization }) => {
          try {
            /** @type {Record<string, string>} */
            const headers = { Accept: 'application/json' };
            if (authorization) headers['Authorization'] = authorization;
            const res = await fetch(mePath, { headers, credentials: 'same-origin' });
            const body = await res.json().catch(() => null);
            return { status: res.status, body };
          } catch (err) {
            return { status: 0, body: null, error: String(err) };
          }
        },
        { mePath: ME_PATH, authorization: stored.authorization },
      );
      return { stored, answer };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return {
    stored: {
      problem: `could not read the page's session on ${safeUrl(page)}: ${firstLine(lastError)}`,
    },
    answer: null,
  };
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
 * The `app` channel: who the app in this page is acting as. A page not on `appOrigin` — the
 * initial `about:blank`, or a page outside the app — has no app session to judge.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} expected
 * @param {string} appOrigin
 * @returns {Promise<ChannelReport>}
 */
export async function checkPageIdentity(page, expected, appOrigin) {
  if (originOf(safeUrl(page)) !== originOf(appOrigin)) {
    return {
      channel: 'app',
      expected,
      ok: true,
      state: 'not-on-app',
      user: null,
      session: null,
      problem: null,
    };
  }
  const { stored, answer } = await askThroughPage(page);
  return judgeApp(stored, answer, expected);
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
 * The `api` identity is the run's own credentials and never changes. The `app` identity starts as
 * the same user, and a steps file that deliberately signs the browser in as someone else says so
 * with `expectApp`, which is recorded, so the switch is in the evidence rather than inferred.
 *
 * @param {object} options
 * @param {import('@playwright/test').Page} options.page
 * @param {string} options.baseUrl the app's URL; `/me` is asked through it, as the run's requests are
 * @param {string} options.username the run's credentials
 */
export function createIdentityMonitor({ page, baseUrl, username }) {
  const appOrigin = originOf(baseUrl);
  const meUrl = `${appOrigin}${ME_PATH}`;
  let expectedApp = username;
  /** @type {{ at: string, ok: boolean, reports: ChannelReport[] }[]} */
  const checks = [];
  /** @type {{ at: string, username: string, reason: string }[]} */
  const switches = [];

  return {
    expectedApi: username,
    get expectedApp() {
      return expectedApp;
    },
    checks,
    switches,

    /**
     * @param {string} user
     * @param {string} reason
     * @param {string} at
     */
    expectApp(user, reason, at) {
      if (!sameUser(user, expectedApp)) switches.push({ at, username: user, reason });
      expectedApp = user;
    },

    /**
     * @param {string} at where in the run, e.g. `start` or `after step 3`
     * @param {{ app?: boolean }} [options] `app: false` before the page has loaded the app
     */
    async verify(at, { app = true } = {}) {
      const reports = [await checkRequestIdentity(page.request, meUrl, username, 'page.request')];
      if (app) reports.push(await checkPageIdentity(page, expectedApp, appOrigin));
      const entry = { at, ok: reports.every((r) => r.ok), reports };
      checks.push(entry);
      console.log(`  [identity ${at}] ${reports.map(describeReport).join(' · ')}`);
      return entry;
    },
  };
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
