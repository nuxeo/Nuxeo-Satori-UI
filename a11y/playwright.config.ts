import { defineConfig, devices } from '@playwright/test';
import { resolveBaseUrl } from './env.mjs';
import { requireNuxeoCredentials } from './fixtures';
import { JOURNEY_SCREENS, journeyProjectName, journeyTag } from './specs/journey.screens';

/**
 * Playwright configuration for the runtime accessibility suite.
 *
 * ## Why this whole folder is self-contained
 *
 * Everything this suite needs — specs, fixtures, config, diagnostics, tool docs and report
 * output — lives under `a11y/`, and nothing under `apps/` or `libs/` is modified to support
 * it. That is deliberate: this is development tooling with an expected end date, and the
 * removal procedure in `README.md` is `rm -rf a11y/`, one line of `package.json`, and an
 * edit to `docs/accessibility.md` — nothing in application code.
 *
 * It costs one thing, recorded here rather than discovered later: `installSession()` in
 * `./fixtures.ts` is a copy of the same function in `apps/nuxeo-ui-e2e/src/fixtures.ts`. A
 * shared import would have been one definition, but it would also have been a second reason
 * this folder cannot simply be deleted. The copy does **not** fail loudly on its own, which
 * this comment used to claim: a session the app no longer recognises sends it to `/me`, which
 * the `httpCredentials` below answer, and every spec passes under a cookie session instead.
 * So the drift is checked rather than assumed — `./session.mjs` proves the app adopted the
 * injected session, and the `signedIn` fixture fails the test when it did not.
 *
 * ## Why it is not a project inside the critical-path config
 *
 * `apps/nuxeo-ui-e2e` needs only Playwright and a live stack. This needs both a11y-scout
 * tarballs, which are hand-distributed and resolvable from no registry, so collecting these
 * specs there would fail thirteen critical-path specs with ERR_MODULE_NOT_FOUND on any
 * machine that has not downloaded them. Separate directory, separate config, no overlap —
 * which is also why the critical-path config needs no `testIgnore` for us.
 */

/**
 * Where the app is served — resolved by the same function the preflight and all three
 * diagnostics use, so every `a11y:scan` subcommand points at the same place.
 *
 * This config and the preflight previously read `E2E_BASE_URL` while the diagnostics read
 * `APP_URL`. Behind one entry point that meant either documented override sent some
 * subcommands at the requested deployment and left the rest on localhost, so a `surfaces`
 * run and a `reflow` run could describe two different applications and still be compared.
 */
const baseURL = resolveBaseUrl();

/**
 * Browser and context settings shared by every project below.
 *
 * Chromium only. WebKit would emit a second report with near-identical findings, because
 * axe's rule set is engine-independent and the keyboard walk drives the same DOM. Add a
 * WebKit project if a WebKit-specific accessibility question ever needs answering.
 *
 * Authentication needs **both** mechanisms and this was established the hard way: injecting a
 * session into `sessionStorage` satisfies the route guard so pages render, but does not
 * reliably authenticate XHRs, which surfaces as intermittent 403s on `/nuxeo/api` paths.
 * `httpCredentials` is the other half.
 *
 * Credentials are **required**, not defaulted — `requireNuxeoCredentials()` throws when either
 * variable is unset, so the config fails to load rather than scanning as a guessed identity.
 * Both halves read the same function, so they cannot diverge.
 *
 * Hoisted so every project shares it by reference — a new project cannot pick up a different
 * browser by copy-pasting the wrong line.
 */
const CHROMIUM = {
  ...devices['Desktop Chrome'],
  baseURL,
  viewport: { width: 1440, height: 900 },
  // `send: 'always'` (NXSAT-643): a guest-enabled Nuxeo never answers with a 401 challenge, so
  // challenge-based credentials were never sent and the specs' `page.request` calls ran as
  // `Anonymous`. It reaches `page.request` only; the browser is signed in by the injected
  // session, and `signedIn` checks both against `/me` (`scripts/beta-harness/identity-guard.mjs`).
  httpCredentials: {
    ...requireNuxeoCredentials(),
    origin: new URL(baseURL).origin,
    send: 'always' as const,
  },
  trace: 'retain-on-failure' as const,
  screenshot: 'only-on-failure' as const,
  video: 'retain-on-failure' as const,
};

export default defineConfig({
  testDir: './specs',
  // Both the directory and the suffix, deliberately. The directory is what `testDir` selects,
  // which is Playwright's documented mechanism for suites that live apart; the suffix keeps a
  // spec self-describing in a stack trace, a report and a `git log`, where a directory is easy
  // to miss.
  testMatch: '**/*.a11y.spec.ts',

  // Diagnostics land inside this folder so that deleting it takes them too.
  outputDir: './artifacts',

  // A scan is not a page load. Each surface runs axe, a keyboard walk of up to 300 real key
  // presses, and reflow geometry. The critical-path suite's 45s budget does not begin to cover
  // it — the first run took 2.8 minutes on `trash` and exceeded 240s on `browse`.
  //
  // Raised from 600s to 900s after `browse` took **11.1 minutes** on 2026-09-29 and timed out.
  // The cost of getting this wrong is worse than a slow run, and it is not a lost test: a
  // Playwright timeout **restarts the worker**, which recreates the worker-scoped a11y-scout
  // accumulator, so every surface scanned before it is dropped from the consolidated report.
  // That run reported `pages scanned: 1` after five successful scans. The
  // `pagesScanned.length` assertion is what made it visible rather than silent.
  //
  // Generous on purpose: this is an opt-in local scan, not a PR gate, so a slow pass beats a
  // timeout that discards the work already done.
  timeout: 900_000,
  expect: { timeout: 15_000 },

  // The findings accumulator is worker-scoped, so one worker is what produces ONE consolidated
  // report per project instead of a folder of disconnected ones.
  workers: 1,

  // No retries. A retried scan re-adds the same page to the accumulator, which would
  // double-count its findings in the consolidated report.
  retries: 0,

  // A project per suite, and the split is load-bearing rather than cosmetic. The a11y-scout
  // accumulator is worker-scoped, so spec files sharing a worker share one report — and
  // `surfaces.a11y.spec.ts` asserts its report covers exactly its own seven surfaces, which a
  // second file appending to the same accumulator would break. A project gets its own worker,
  // so each suite accumulates and emits independently.
  //
  // They are run separately because the surfaces scan alone takes 27 minutes; making one
  // command imply all of them would give people a reason not to run any.
  //
  // Grouped by what the scan looks at rather than by rule. Both lists below are declarations:
  // adding a suite is one entry here, adding a journey screen is one entry in
  // `specs/journey.screens.ts`.
  projects: [
    ...(
      [
        ['surfaces', 'pages, in their default loaded state'],
        ['interaction-states', 'components and overlays, reachable only behind a click'],
        ['display-modes', 'the same pages under dark, forced-colors and reduced-motion'],
      ] as ReadonlyArray<readonly [name: string, covers: string]>
    ).map(([name]) => ({
      name,
      use: CHROMIUM,
      testMatch: `**/${name}.a11y.spec.ts`,
    })),

    // The journey suite — one project per screen, and here the split is about the deliverable
    // itself. `journey.a11y.spec.ts` produces a SELF-CONTAINED report per screen, and the
    // accumulator is never cleared by `generateReport()`. One call per screen in one worker would
    // emit login, then login+dashboard, then login+dashboard+browse — each labelled with one screen
    // and containing several. `emitScreenReport()` asserts `pagesScanned.length === 1` so the
    // day that stops being true is a red run rather than a quietly wrong artifact.
    //
    // Generated from `JOURNEY_SCREENS` rather than written out, because the project name, the
    // `grep` and the test's tag have to agree and nothing used to make them. A project whose
    // grep matches nothing is dropped **silently** when other projects match — measured, not
    // assumed: a fifth project grepping a typo'd tag produced "Total: 4 tests, exit 0".
    ...JOURNEY_SCREENS.map((screen) => ({
      name: journeyProjectName(screen.id),
      // Unauthenticated screens drop `httpCredentials`: with them set, Playwright answers the
      // Basic auth challenge on the app's anonymous `/nuxeo/api/v1/me` hydration probe, the app
      // builds a session from the reply, and `authGuard` forwards `/` to the dashboard.
      use: screen.authenticated ? CHROMIUM : { ...CHROMIUM, httpCredentials: undefined },
      testMatch: '**/journey.a11y.spec.ts',
      // Bounded on the right, so a screen id that is a prefix of another (`search` and a future
      // `search-results`) cannot pull the other screen's test into this project.
      grep: new RegExp(`${journeyTag(screen.id)}(?![\\w-])`),
    })),
  ],

  reporter: [['list']],
});
