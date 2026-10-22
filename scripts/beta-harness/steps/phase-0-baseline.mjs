/**
 * Phase 0 — authenticated baseline against a live Nuxeo instance.
 *
 * Captures the state of the application before any Beta work begins, so later
 * phases have something to be compared against. Everything asserted here is
 * expected to pass on the current branch; if it does not, Phase 0 has found a
 * real regression and the plan should not proceed past it.
 *
 * Two things learned while first running this, both encoded below:
 *
 * 1. The adf-hx nav drawer only mounts when the route is entered through the
 *    platform nav item, because the shell owns the drawer state. Navigating
 *    straight to the URL renders the page without a drawer, so asserting the
 *    tree after a direct `goTo` tests the wrong entry path.
 * 2. This Nuxeo instance does not provide the `AI.Insights` automation
 *    operation, and the app probes `/nuxeo/logout` on boot. Both surface as
 *    console errors that have nothing to do with browse, so they are ignored
 *    explicitly — and still counted in the report.
 *
 * Prerequisites:
 *   docker start nuxeo          (container `nuxeo`, published on 8080)
 *   npx nx serve nuxeo-ui       (separate terminal)
 *
 * Run:
 *   npm run beta:evidence -- phase-0-baseline
 */

/**
 * Errors this environment always produces, unrelated to the browse surfaces.
 * `AI.*` operations come from a marketplace package that is not installed on a
 * plain local Nuxeo, and the app probes `/nuxeo/logout` on boot.
 *
 * The last two entries were added later than the others, and the reason matters:
 * they are a *Phase 1* behaviour appearing in a *Phase 0* baseline. The app loads
 * its configuration from `agentic-ui-config/`, which nothing answers under
 * `nx serve` unless a developer has put a file there, so the fetches 404 and the
 * app falls back to the packaged default by design. This file was written before that existed and
 * failed on it when re-run — a stale baseline, not a regression.
 *
 * Suppressing it is only safe because this run separately proves the fallback
 * worked: "platform nav offers the adf-hx entry" below is fed by the manifest, so
 * if the packaged default had not loaded, that check would fail rather than pass
 * quietly. `phase-1-config` asserts the fallback path directly.
 */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Application loads and authenticates against live Nuxeo');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');
  // Who the run signed in as is checked by the identity guard at the next boundary (NXSAT-643).
  await h.screenshot('app-shell');

  await h.step('Production browse renders real repository content');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.expectText('repository content listed', 'lib-browse', 'Default domain');
  await h.screenshot('production-browse');

  await h.step('adf-hx POC browse renders real repository content');
  // Entered directly: the page and its hxp components must render on their own.
  await h.goTo('/#/browse-adf-hx');
  await h.expectVisible('POC page rendered', 'lib-browse-adf-hx-poc');
  await h.expectVisible('hxp folder header present', 'hxp-folder-header');
  await h.expectVisible('hxp document list present', 'hxp-document-list');
  await h.expectText('Nuxeo children listed', 'hxp-document-list', 'Default domain');
  await h.expectText('Last Contributor column populated', 'hxp-document-list', 'Administrator');
  await h.screenshot('adf-hx-poc-browse');

  await h.step('POC tabs render');
  await h.expectVisible('hxp tabs present', 'hxp-browse-tabs');
  await h.screenshot('adf-hx-poc-tabs');

  await h.step('Nav drawer and folder tree mount when entered via platform nav');
  await h.goTo('/#/browse');
  const navEntry = page
    .locator('a,button')
    .filter({ hasText: /adf-hx/i })
    .first();
  h.check('platform nav offers the adf-hx entry', (await navEntry.count()) > 0);
  await navEntry.click();
  await page.waitForTimeout(3000);
  await h.expectVisible('hxp nav drawer mounted', 'hxp-browse-nav-drawer');
  await h.screenshot('adf-hx-poc-nav-drawer');

  await h.step('Baseline health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
