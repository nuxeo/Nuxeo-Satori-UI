/**
 * The "could not measure" exit for the diagnostics.
 *
 * ## Why this is shared rather than inline
 *
 * `run.mjs` gives the three diagnostics `preflight: false` — they answer in seconds and
 * waiting on a Nuxeo document query would cost more than it buys. The bargain is that each
 * then checks its own preconditions and reports them as **exit 2**, the
 * `precondition-not-met` convention: fix the environment, do not iterate on the code.
 *
 * Each of them held up one half of that bargain. Importing `@playwright/test` was guarded;
 * *launching* the browser was not, and neither was the first navigation. A missing Chromium
 * therefore surfaced as an uncaught rejection — exit 1, with a stack trace — which reads as
 * "the diagnostic found a problem in the application" rather than "nothing measured anything".
 * Flagged in review on PR #225, and observed the same day: a shell exported
 * `PLAYWRIGHT_BROWSERS_PATH` pointing at an empty cache and `route-render-check` failed with
 * exit 1 as though the routes were broken.
 *
 * Exit 2 is not cosmetic here. `run.mjs` propagates it specifically so a caller can tell a
 * broken environment from a failing check, and flattening everything to 1 erases that.
 */

import { judgeMe } from '../../scripts/beta-harness/identity-guard.mjs';
import { hasAdministrationAccess, nuxeoBasicAuthHeader, requireNuxeoCredentials } from '../env.mjs';
import { sessionAdoptionProblem, sessionIdentityProblem } from '../session.mjs';

/**
 * @param {string} tool   the diagnostic's name, so the message says who could not measure
 * @param {string} reason
 * @param {string} [fix]  the command that would resolve it
 * @returns {never}
 */
export function cannotMeasure(tool, reason, fix) {
  console.error(`${tool}: cannot measure — ${reason}`);
  if (fix) console.error(`  ${fix}`);
  process.exit(2);
}

/**
 * `NUXEO_USER` and `NUXEO_PASS`, or exit 2.
 *
 * `requireNuxeoCredentials()` throws, which is right for the Playwright config (a thrown config
 * error stops the run with its message) and wrong at the top of a diagnostic, where the throw
 * became an uncaught exception and exit 1 — the first precondition every diagnostic checks,
 * reported as a finding. Flagged in review on PR #225, once per diagnostic.
 *
 * @param {string} tool
 * @returns {{username: string, password: string}}
 */
export function credentialsOrExit(tool) {
  try {
    return requireNuxeoCredentials();
  } catch (err) {
    return cannotMeasure(tool, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Launch Chromium, or exit 2 explaining how to get one.
 *
 * @template Browser
 * @param {{launch: (o: object) => Promise<Browser>}} chromium
 * @param {string} tool
 * @returns {Promise<Browser>}
 */
export async function launchChromium(chromium, tool) {
  try {
    return await chromium.launch({ headless: process.env['A11Y_HEADED'] !== '1' });
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    return cannotMeasure(tool, `chromium will not launch: ${first}`, 'npx playwright install chromium');
  }
}

/**
 * Prove the backend answers before measuring anything, or exit 2.
 *
 * The status check existed inline in two diagnostics; the **throw** did not. Both sat in a
 * `try { … } finally { … }` with no `catch`, so a refused connection — the dev server simply
 * not running, the most ordinary failure there is — propagated as an unhandled rejection and
 * exited 1. The status path reported "cannot measure" properly and the connection path did
 * not, which is the worse half to get wrong.
 *
 * @param {{request: {get: (url: string, o?: object) => Promise<{status: () => number}>}}} page
 * @param {string} baseUrl
 * @param {string} tool
 */
export async function requireBackend(page, baseUrl, tool) {
  const url = `${baseUrl}/nuxeo/api/v1/me`;
  let res;
  try {
    // The header stated, not left to the context: a guest-enabled Nuxeo never challenges, so
    // challenge-based `httpCredentials` never went out and this asked who the *guest* was.
    res = await page.request.get(url, {
      failOnStatusCode: false,
      headers: { Authorization: nuxeoBasicAuthHeader() },
    });
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    return cannotMeasure(tool, `${url} is not reachable: ${first}`, 'npx nx serve nuxeo-ui');
  }
  if (res.status() !== 200) {
    return cannotMeasure(
      tool,
      `${url} returned ${res.status()}. An empty screen scans clean and proves nothing.`,
      'Check both the dev server and the Nuxeo container are up.',
    );
  }
  // A 200 is not an identity: a guest-enabled Nuxeo answers 200 as `Anonymous`, and
  // `requireAdministrationAccess` grants on the configured *username* alone (NXSAT-643).
  const me = await res.json().catch(() => null);
  const { problem } = judgeMe({ status: 200, body: me }, requireNuxeoCredentials().username);
  if (problem) {
    return cannotMeasure(tool, `${url}: ${problem}. A scan as the wrong user proves nothing about the right one.`);
  }
  // Returned so a caller that visits an admin-only route can check the identity with
  // `requireAdministrationAccess` without a second request.
  return me;
}

/**
 * Exit 2 if this identity cannot reach `/#/administration` and the diagnostic is about to
 * measure it. Without this the route redirects to the dashboard, and the diagnostic measures
 * the dashboard under the administration label.
 *
 * @param {unknown} me        the body `requireBackend` returned
 * @param {string}  username
 * @param {string}  tool
 */
export function requireAdministrationAccess(me, username, tool) {
  if (!hasAdministrationAccess(me, username)) {
    cannotMeasure(
      tool,
      `${username} has no administration access, and /#/administration is one of the routes ` +
        'measured here — adminGuard would redirect it to the dashboard.',
      'Use an administrator or powerusers account.',
    );
  }
}

/**
 * Exit 2 unless the app adopted the session this diagnostic injected — see `../session.mjs`.
 * Call it once the page has loaded an app route. Without it a drifted session copy is
 * invisible: the app signs in through `httpCredentials` instead and everything still renders.
 *
 * Then asks Nuxeo who the adopted session runs as (`sessionIdentityProblem`), on the configured
 * app origin, and refuses an app that sent API requests elsewhere — pass the watcher started
 * before the diagnostic's first navigation.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {string} tool
 * @param {{ baseUrl: string, foreignApiOrigins: Set<string> }} identity
 */
export async function requireSessionAdopted(page, username, tool, { baseUrl, foreignApiOrigins }) {
  const problem = await sessionAdoptionProblem(page, username);
  if (problem) cannotMeasure(tool, `not signed in by the injected session: ${problem}`);
  const identity = await sessionIdentityProblem(page, username, { baseUrl, foreignApiOrigins });
  if (identity) cannotMeasure(tool, identity);
}

export { watchNuxeoApiOrigins } from '../session.mjs';

/**
 * Navigate, or exit 2.
 *
 * For the **first** navigation of a diagnostic, where a failure means the app is not serving
 * rather than that this route is broken. Per-route navigations inside a measurement loop must
 * NOT use this: there the failure is a finding about that route, and the loops already record
 * it as one.
 *
 * @param {{goto: (url: string, o?: object) => Promise<unknown>}} page
 * @param {string} url
 * @param {string} tool
 * @param {object} [options]
 */
export async function gotoOrExit(page, url, tool, options = { waitUntil: 'domcontentloaded' }) {
  try {
    await page.goto(url, options);
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    cannotMeasure(tool, `${url} could not be loaded: ${first}`, 'npx nx serve nuxeo-ui');
  }
}
