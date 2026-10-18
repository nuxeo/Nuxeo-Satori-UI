#!/usr/bin/env node
/**
 * Route render probe — the negative control for every route an accessibility scan visits.
 *
 * An empty screen scans clean. That is the single most dangerous failure mode in this repository's
 * accessibility tooling, because it produces a **green result that means nothing**, and it has
 * already happened three times:
 *
 *   - `scripts/beta-harness/steps/phase-6-a11y.mjs` shipped a step labelled "Login surface" that
 *     actually scanned the
 *     dashboard, caught only because a selector assertion failed;
 *   - the same file's "browse cards" step scanned the table view, because the view mode is held in
 *     a service and survived navigation;
 *   - and it still scans `/#/collections`, which has **no matching route** — `collectionsRoutes`
 *     declares exactly one path, `:uid`, so the bare path renders nothing and the clean result is
 *     counted as a pass. That is `docs/accessibility.md` gap 5.
 *
 * Two of those were found by a selector assertion. The third was never caught because that step has
 * no selector assertion. This script is that assertion, applied uniformly to every route rather
 * than to whichever ones somebody remembered.
 *
 * It runs no axe and needs no scanner, so it is seconds rather than minutes and can be run before
 * any scan to establish that the scan will have something to look at.
 *
 * Prerequisites (version kept in sync with a11y/versions.mjs):
 *   npm install --no-save @playwright/test@1.63.0
 *   npm run beta:backend && npx nx serve nuxeo-ui
 *
 * Usage:
 *   node a11y/diagnostics/route-render-check.mjs
 *
 * Exit codes: 0 every route rendered, 1 at least one rendered nothing or only its error state,
 * 2 could not measure (a precondition failed, or any route could not be loaded and none rendered
 * nothing).
 */
import { parseCliOrExit } from '../cli.mjs';
import { resolveBaseUrl } from '../env.mjs';
import { injectedSession, SESSION_KEY, SIGNED_OUT_KEY } from '../session.mjs';
import { ERROR_STATE_SELECTOR, screenUnsettledReason } from '../surface.mjs';
import { PINNED_PLAYWRIGHT_TEST } from '../versions.mjs';
import {
  credentialsOrExit,
  gotoOrExit,
  launchChromium,
  requireAdministrationAccess,
  requireBackend,
  requireSessionAdopted,
} from './preconditions.mjs';

parseCliOrExit('route-render-check', {});

const baseUrl = resolveBaseUrl();
// Required, never defaulted - see ../env.mjs for why a default is worse than an error here.
const { username: user, password: pass } = credentialsOrExit('route-render-check');

/**
 * Every route `phase-6-a11y.mjs` scans, with the feature host it must render.
 *
 * `/#/collections` is listed with the host it *would* need. It is expected to fail, and that
 * expectation is the point — a probe whose every row passes on the day it is written has not been
 * shown to be capable of failing.
 */
const ROUTES = [
  // `app-dashboard-page`, not `app-shell`. `/` redirects to `/#/dashboard`, but `app-shell` is
  // the PARENT route component: it stays visible when the child redirect or the dashboard
  // itself fails to render, so asserting it makes this diagnostic pass for a dead landing
  // surface — the exact false-clean condition the file exists to detect. Flagged in review on
  // PR #225.
  ['landing', '/', 'app-dashboard-page'],
  ['browse', '/#/browse', 'lib-browse'],
  ['search', '/#/search', 'lib-search'],
  ['trash', '/#/trash', 'lib-trash'],
  ['tasks', '/#/tasks', 'lib-tasks-page'],
  ['collections', '/#/collections', 'lib-collection-detail'],
  ['administration', '/#/administration', 'lib-administration-shell'],
  ['knowledge-discovery', '/#/knowledge-discovery', 'lib-knowledge-discovery'],
];

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch (err) {
  console.error(
    `route-render-check: cannot measure — ${err instanceof Error ? err.message : err}\n` +
      `  npm install --no-save ${PINNED_PLAYWRIGHT_TEST}`,
  );
  process.exit(2);
}

const browser = await launchChromium(chromium, 'route-render-check');
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // `send: 'always'`: a guest-enabled Nuxeo never challenges, so without it
  // `page.request` ran as Anonymous (NXSAT-643).
  httpCredentials: { username: user, password: pass, origin: baseUrl, send: 'always' },
});
const page = await context.newPage();

/** @type {{label:string, route:string, host:string, hostPresent:boolean, textLen:number, errorState?:boolean, error?:string}[]} */
const results = [];

try {
  const me = await requireBackend(page, baseUrl, 'route-render-check');
  requireAdministrationAccess(me, user, 'route-render-check');
  // `networkidle` rather than a fixed pause, so the app's own session hydration has very
  // likely finished before the session below is written. The reload after it is what makes
  // the written session the one the app starts from.
  await gotoOrExit(page, baseUrl, 'route-render-check', { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ key, value, signedOutKey }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(signedOutKey);
    },
    {
      key: SESSION_KEY,
      signedOutKey: SIGNED_OUT_KEY,
      value: injectedSession(user, pass),
    },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await requireSessionAdopted(page, user, 'route-render-check');

  for (const [label, route, host] of ROUTES) {
    // A navigation failure is "could not measure" for this route, not a crash that discards
    // every route already checked and exits 1 as though a route had rendered nothing.
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    } catch (err) {
      const error = `navigation failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`;
      results.push({ label, route, host, hostPresent: false, textLen: 0, error });
      continue;
    }

    // Waited for, not sampled after a fixed pause. `goto` to another `/#/…` is a same-document
    // navigation, so `networkidle` resolves at once and a 1.2s pause was the only wait there
    // was: a lazily loaded feature slower than that read as "absent", and a host caught
    // before its data arrived had its text measured mid-load. Flagged in review on PR #225.
    // The same timeout and the same settle definition as the specs.
    const unsettled = await screenUnsettledReason(page, { host, treeRequired: route === '/#/browse' });
    const hostPresent = await page
      .locator(host)
      .first()
      .isVisible()
      .catch(() => false);
    if (hostPresent && unsettled) {
      results.push({ label, route, host, hostPresent, textLen: 0, error: unsettled });
      continue;
    }

    // Text inside the feature host itself, not inside `main`.
    //
    // This measured `main, [role="main"]` and fell back to `document.body`. The signed-in shell
    // has no `main` — only the login page does — so on every route here it measured the body,
    // nav drawer and toolbar included. That text is never empty, so `textLen === 0` could not
    // fire and a host mounted around nothing still passed: `/#/collections` read 111 characters
    // with no host at all. Flagged in review on PR #225.
    const textLen = hostPresent
      ? await page
          .locator(host)
          .first()
          .innerText()
          .then((t) => t.trim().length)
          .catch(() => 0)
      : 0;

    // A host showing its error panel is visible and full of text, so the two checks above pass
    // it — and a scan of it measures the error. Knowledge discovery did exactly that on
    // 2026-10-01, when its agents call returned 500: 670 characters, "rendered", no row flagged.
    // The same selector the specs refuse to scan through.
    const errorState =
      hostPresent && (await page.locator(`${host} :is(${ERROR_STATE_SELECTOR})`).count()) > 0;

    results.push({ label, route, host, hostPresent, textLen, errorState });
  }
} finally {
  await context.close();
  await browser.close();
}

console.log(`App: ${baseUrl}\n`);
console.log(`${'route'.padEnd(24)}${'expected host'.padEnd(28)}${'rendered'.padEnd(10)}${'host text'.padStart(10)}`);
for (const r of results) {
  const rendered = r.error ? '?' : !r.hostPresent ? 'NO' : r.errorState ? 'ERROR' : 'yes';
  console.log(
    `${r.route.padEnd(24)}${r.host.padEnd(28)}${rendered.padEnd(10)}${String(r.textLen).padStart(10)}` +
      (r.error ? `  could not measure: ${r.error}` : ''),
  );
}

const unmeasured = results.filter((r) => r.error);

// An absent host OR a host with no text in it. `textLen` was measured, printed as evidence
// and then left out of the verdict, so a route whose host mounted around nothing still
// passed — which is the same clean-result-that-means-nothing this file opens by describing.
const dead = results.filter(
  (r) => !r.error && (!r.hostPresent || r.textLen === 0 || r.errorState),
);
if (dead.length > 0) {
  console.log(
    `\n--- ${dead.length} route(s) rendered nothing an accessibility scan could meaningfully check ---`,
  );
  for (const r of dead) {
    const why = !r.hostPresent
      ? `${r.host} absent`
      : r.errorState
        ? `${r.host} is showing its error state`
        : `${r.host} rendered with no text inside it`;
    console.log(`  ${r.route} — ${why}`);
  }
  console.log(
    '\nA scan of these routes measures an empty page or an error panel, not the screen. Either fix\n' +
      'the route or its backend, or remove it from the scan — do not leave it counting as a pass.',
  );
  // A confirmed empty route outranks an unmeasured one: the defect is real either way, and
  // the unmeasured routes are still listed above so they are not lost behind it.
  process.exit(1);
}

if (unmeasured.length > 0) {
  console.error(
    `\nroute-render-check: ${unmeasured.length} of ${results.length} route(s) could not be measured, ` +
      'so this is an incomplete result rather than a pass.',
  );
  process.exit(2);
}

console.log('\nroute-render-check: PASS — every scanned route rendered its feature host.');
