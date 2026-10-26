/**
 * The app session this folder injects, and the check that the app actually used it.
 *
 * ## Why injecting it is not enough
 *
 * Every signed-in page here gets two credentials: `httpCredentials` on the browser context, and
 * a copy of `AuthService`'s basic session written into `sessionStorage`. The copy is what gets
 * past the route guard. It is a copy — of the storage key and of the session shape in
 * `apps/nuxeo-ui/src/app/auth/auth.service.ts` — and this folder used to say a drifted copy
 * "cannot fail quietly". It can. When `AuthService` does not recognise the stored session,
 * hydration falls back to `GET /nuxeo/api/v1/me`; `httpCredentials` answers that challenge, and
 * the app signs itself in with a **cookie** session. Every spec then passes, signed in by a
 * route nobody intended, and the copy is dead code nobody notices. Flagged in review on PR #225.
 *
 * ## How adoption is proved
 *
 * Reading the key back and finding `kind: 'basic'` proves nothing: if `AuthService` renamed its
 * key, the app never reads ours and the injected value sits there untouched. So the injected
 * session carries one field the app does not know, `a11yInjected`. A basic session the app
 * accepts is validated against `/me` and re-persisted from its own known fields, which drops
 * the marker. The marker gone, with `kind: 'basic'` and the expected user, can only mean the app
 * read this session and kept it.
 *
 * ## Why adoption is not enough either
 *
 * Adoption proves which session the app holds, not who Nuxeo answers it as. On a Nuxeo with
 * guests enabled those can differ — a guest `JSESSIONID` that has answered an API call outranks
 * the session's Basic header — and every scan still renders. So `sessionIdentityProblem` asks
 * `/me` the way the app does, from inside the page, and `apiIdentityProblem` asks it through the
 * context the specs' `page.request` calls use. Both are the shared guard in
 * `scripts/beta-harness/identity-guard.mjs` (NXSAT-643) — imported rather than copied, against
 * this folder's usual rule, because two copies of a security check are two things to keep right.
 */

import {
  checkPageIdentity,
  checkRequestIdentity,
  ME_PATH,
  watchNuxeoApiOrigins,
} from '../scripts/beta-harness/identity-guard.mjs';

export { watchNuxeoApiOrigins };

/** Mirrors `STORAGE_KEY` in `apps/nuxeo-ui/src/app/auth/auth.service.ts`. */
export const SESSION_KEY = 'agentic_ui_nuxeo_session';
/** Mirrors `SIGNED_OUT_KEY` in the same file. Set by `AuthService.markSignedOut()`. */
export const SIGNED_OUT_KEY = 'agentic_ui_signed_out';
const MARKER = 'a11yInjected';

/**
 * The JSON to store under `SESSION_KEY`. Credentials come from the caller, who reads them from
 * the environment; never hardcoded, never in a URL.
 *
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
export function injectedSession(username, password) {
  return JSON.stringify({
    kind: 'basic',
    username,
    basic: Buffer.from(`${username}:${password}`).toString('base64'),
    isAdministrator: username.toLowerCase() === 'administrator',
    groups: [],
    [MARKER]: true,
  });
}

/**
 * `null` once the app has adopted the injected session, otherwise why it has not.
 *
 * Polled rather than read once, because hydration is asynchronous and a full reload re-injects
 * the marker until the app has re-validated. Call it after the page has loaded an app route.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
export async function sessionAdoptionProblem(page, username, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  /** @type {string | null} */
  let problem = null;
  for (;;) {
    problem = await readProblem(page, username);
    if (problem === null || Date.now() >= deadline) return problem;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @returns {Promise<string | null>}
 */
async function readProblem(page, username) {
  /** @type {string | null} */
  let raw;
  try {
    raw = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    return `could not read sessionStorage on ${page.url()}: ${first}`;
  }
  if (raw === null) {
    return (
      `nothing is stored under ${SESSION_KEY} on ${page.url()}, so the app is signed in by ` +
      'some other route than the injected session, or not at all'
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${SESSION_KEY} does not hold JSON`;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return `${SESSION_KEY} holds ${parsed === null ? 'null' : typeof parsed}, not a session object`;
  }
  const stored = /** @type {Record<string, unknown>} */ (parsed);
  if (stored['kind'] !== 'basic') {
    return (
      `the app is signed in with a "${String(stored['kind'])}" session, not the injected basic ` +
      'one — it did not find or did not accept the injected session, and signed in through ' +
      'its /me fallback instead. Compare SESSION_KEY and injectedSession() in session.mjs with ' +
      'STORAGE_KEY and BasicStoredSession in auth.service.ts.'
    );
  }
  if (stored['username'] !== username) {
    return `the stored session is for "${String(stored['username'])}", not ${username}`;
  }
  if (stored[MARKER] === true) {
    return (
      `the injected session is untouched — the app never read ${SESSION_KEY}, or never ` +
      'validated it. Compare SESSION_KEY in session.mjs with STORAGE_KEY in auth.service.ts.'
    );
  }
  return null;
}

/**
 * `null` when Nuxeo answers the app in this page as `username`, otherwise why not — the app's
 * stored session read the way the app reads it, and `/me` asked with the header it sends.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {object} options
 * @param {string} options.baseUrl the app's configured URL. Not `page.url()`: the trusted origin
 *   must come from the configuration, or a page redirected to another deployment would be
 *   judged by that deployment's `/me`
 * @param {Set<string>} [options.foreignApiOrigins] from `watchNuxeoApiOrigins`, started before
 *   the first navigation, and told `restartAtNextLoad()` before a reload that signs in
 * @returns {Promise<string | null>}
 */
export async function sessionIdentityProblem(page, username, { baseUrl, foreignApiOrigins }) {
  const report = await checkPageIdentity(page, username, new URL(baseUrl).origin, {
    foreignApiOrigins,
  });
  if (!report.ok) return `identity guard: ${report.problem}`;
  if (report.state !== 'authenticated') {
    return `identity guard: the page holds no session for ${username} (${report.state})`;
  }
  return null;
}

/**
 * `null` when the context's requests run as `username`, otherwise why not.
 *
 * @param {import('@playwright/test').APIRequestContext} request e.g. `page.request`
 * @param {string} baseUrl
 * @param {string} username
 * @returns {Promise<string | null>}
 */
export async function apiIdentityProblem(request, baseUrl, username) {
  const report = await checkRequestIdentity(
    request,
    new URL(ME_PATH, baseUrl).href,
    username,
    'page.request',
  );
  return report.ok ? null : `identity guard: ${report.problem}`;
}
