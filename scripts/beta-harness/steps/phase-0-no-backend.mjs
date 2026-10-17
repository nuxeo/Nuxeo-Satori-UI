/**
 * Phase 0 — fallback baseline for a machine with NO Nuxeo backend.
 *
 * > **Only run this when no backend is reachable.** It asserts that the Nuxeo
 * > API is *unavailable* and that routes redirect to login, so against a live
 * > Nuxeo it fails by design. `phase-0-baseline.mjs` is the real Phase 0 gate;
 * > this exists so a baseline can still be recorded without Docker.
 *
 * Companion to `phase-0-baseline.mjs`. That file asserts the authenticated
 * browse surfaces and therefore requires a reachable Nuxeo; this one covers
 * everything provable without one.
 *
 * What this proves: the Angular 20 build serves, the app bootstraps, the router
 * and auth guards work, and the login surface renders. What it deliberately does
 * not prove: any data-bearing screen. Those remain unverified until a backend is
 * available — see the final step, which records that precondition as a fact
 * rather than leaving it implied.
 *
 * Run:
 *   npm run beta:evidence -- phase-0-no-backend
 */

/**
 * This file proves the absence of a backend, so it needs no credentials, and the runner neither
 * requires `NUXEO_USER` / `NUXEO_PASS` for it nor sends them (NXSAT-649).
 */
export const skipHttpCredentials = true;

/**
 * Did Nuxeo itself answer `/nuxeo/api/v1/me`?
 *
 * `200` (an authenticated or anonymous session), `401` and `403` are all Nuxeo's answers, so a
 * backend is there. No response, a dev-proxy error (`5xx` — Vite answers `500` when the target
 * refuses) or a `404` from a server with no proxy means it is not.
 *
 * Both probes in this file used to test `status !== 200`. That was sound only while the runner
 * sent a Basic pair on every request — it defaulted one in. Unauthenticated, a live Nuxeo
 * answers `401`, which `!== 200` reads as "no backend": the precondition would pass and the run
 * would report a page of reds for one environment mismatch, the 2026-08-20 failure the
 * precondition exists to stop. It was already wrong with a mistyped password, for the same reason.
 *
 * @param {number | undefined} status
 */
function nuxeoAnswered(status) {
  return status === 200 || status === 401 || status === 403;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // Checked FIRST, and aborting, because this file's assertions are only meaningful
  // when it holds. The 2026-08-20T23-55-38 run recorded 9 of 13 checks failed with
  // Nuxeo up: one precondition mismatch dressed as nine defects.
  h.step('Precondition: no Nuxeo backend is reachable');
  // `page.request` deliberately bypasses the page, so this works before the app has
  // loaded and cannot be affected by any route interception a step might add later.
  const probe = await page.request.get(`${h.baseUrl}/nuxeo/api/v1/me`, { failOnStatusCode: false }).catch(() => null);
  h.requirePrecondition(
    'Nuxeo API is unreachable through the dev proxy',
    !nuxeoAnswered(probe?.status()),
    `/nuxeo/api/v1/me returned ${probe?.status() ?? 'no response'} — a backend IS available here, ` +
      'so this steps file does not apply. Run `npm run beta:evidence -- phase-0-baseline` instead.',
  );
  h.note('authenticated, data-bearing surfaces — covered by phase-0-baseline, which needs a backend');

  h.step('Dev server serves the built application');
  const response = await page.goto(`${h.baseUrl}/`, { waitUntil: 'networkidle' });
  h.check('root responds 200', response?.status() === 200, `status was ${response?.status()}`);
  await page.waitForTimeout(2000);
  h.check('document title is set', (await page.title()) === 'Nuxeo Platform', await page.title());
  await h.expectVisible('Angular root bootstrapped', 'app-root');
  await h.screenshot('app-serves');

  h.step('Unauthenticated access is redirected to login by the auth guard');
  h.check('redirected to /#/login', page.url().includes('/#/login'), page.url());
  await h.expectVisible('login page component rendered', 'app-login-page');
  await h.screenshot('login-page');

  h.step('Login surface renders Satori branding and auth options');
  await h.expectVisible('Satori logo present', 'sat-logo');
  await h.expectText('username field labelled', 'app-login-page', 'Username (required)');
  await h.expectText('Log in action present', 'app-login-page', 'Log in');
  await h.expectText('SAML sign-in offered', 'app-login-page', 'SAML');
  await h.screenshot('login-controls');

  h.step('Protected Beta route is guarded');
  await h.goTo('/#/browse-adf-hx');
  h.check(
    'adf-hx POC route requires auth',
    page.url().includes('/#/login'),
    `expected redirect to login, landed on ${page.url()}`,
  );
  await h.screenshot('adf-hx-route-guarded');

  h.step('Production browse route is guarded');
  await h.goTo('/#/browse');
  h.check('browse route requires auth', page.url().includes('/#/login'), page.url());
  await h.screenshot('browse-route-guarded');

  h.step('The backend is still unreachable from inside the loaded app');
  // Re-checked from the page, not just via `page.request`, because the app reaches
  // Nuxeo through the dev proxy from browser context — a different path from the
  // precondition probe, and the one that actually matters to the assertions above.
  const apiStatus = await page.evaluate(async () => {
    try {
      const r = await fetch('/nuxeo/api/v1/me', { headers: { Accept: 'application/json' } });
      return r.status;
    } catch {
      return 0;
    }
  });
  h.check(
    'Nuxeo API unreachable from browser context too',
    !nuxeoAnswered(apiStatus),
    `/nuxeo/api/v1/me returned ${apiStatus} from the page although the precondition probe found no backend`,
  );
  // Deliberately a note, not a check. `check(name, true)` cannot fail, so it
  // certifies nothing while inflating the total — the exact pattern the Phase 1
  // review called out.
  h.note('any data-bearing screen: unverifiable without a backend, by construction');
}
