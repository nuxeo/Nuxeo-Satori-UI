#!/usr/bin/env node
/**
 * Refuse to run an accessibility scan against a stack that is not there.
 *
 * A scan of a page that did not render is clean, fast and worthless — the vacuous pass this
 * repository has been caught by repeatedly. Playwright's own behaviour when the dev server is
 * absent is a wall of navigation timeouts, which reads as product failures rather than as
 * "nothing was serving".
 *
 * Deliberately a sibling of `scripts/beta-harness/e2e-preflight.mjs` rather than a flag on it.
 * The critical-path suite needs Playwright and a live stack; this needs both a11y-scout
 * tarballs as well, and a missing tarball must cost the accessibility run and nothing else.
 * Keeping it here is also what lets `a11y/` be deleted without editing a shared script.
 *
 * Exits **2**, not 1 — the `precondition-not-met` convention that
 * `scripts/beta-harness/phase-runner.mjs` established:
 * fix the environment, do not iterate on the code.
 */

import { checkFetchIdentity, ME_PATH } from '../scripts/beta-harness/identity-guard.mjs';
import { parseCliOrExit } from './cli.mjs';
import {
  hasAdministrationAccess,
  isFullAdministrator,
  nuxeoBasicAuthHeader,
  requireNuxeoCredentials,
  resolveBaseUrl,
} from './env.mjs';
import {
  A11Y_SCOUT_VERSION,
  BASELINE_AXE_CORE,
  PINNED,
  PINNED_INSTALL_ARGS,
  installedVersion,
} from './versions.mjs';

const BASE = resolveBaseUrl();

/**
 * Set by `run.mjs` for the suites that scan `/#/administration`. The one that does not
 * (interaction states) never goes there, and refusing it for an identity that could run it
 * perfectly well would be a false precondition failure.
 *
 * `--needs-full-admin` is for the journey, whose last screen asserts the analytics tab. A
 * powerusers member passes the broader check, is sent to `users-groups` by
 * `administrationLandingGuard`, and would fail that screen after "the stack is ready".
 */
const cli = parseCliOrExit('a11y preflight', {
  'needs-admin': { type: 'boolean' },
  'needs-full-admin': { type: 'boolean' },
});
const NEEDS_FULL_ADMIN = cli['needs-full-admin'] === true;
const NEEDS_ADMIN = NEEDS_FULL_ADMIN || cli['needs-admin'] === true;

const problems = [];
const ok = [];

/**
 * Credentials first, because this is the "startup validation" the security rule asks for and
 * because every later check depends on them. Reported as a problem rather than thrown, so one
 * run lists everything that is wrong instead of one thing at a time.
 */
let auth = null;
try {
  auth = nuxeoBasicAuthHeader();
  ok.push('NUXEO_USER and NUXEO_PASS are set');
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
}

const INSTALL = [
  `    npm install --no-save ${PINNED_INSTALL_ARGS} \\`,
  `      <path>/a11y-scout-${A11Y_SCOUT_VERSION}.tgz <path>/a11y-scout-playwright-${A11Y_SCOUT_VERSION}.tgz`,
  '',
  '  All packages in ONE command: `npm install --no-save X` prunes anything previously',
  '  installed with --no-save, so installing them separately removes the first.',
].join('\n');

/**
 * 1. Every untracked package this folder needs, driven by `PINNED` rather than listed again.
 *
 * This list used to be written out by hand and omitted `@axe-core/playwright`, which
 * `axe-differential.mjs` imports and which is one of the four in the install command above.
 * Section 1a below skips a package it cannot find a version for, on the grounds that a
 * missing install is reported here — so the one package missing from this list was the one
 * whose absence nothing reported, and `preflight` exited 0 without it. Flagged in review on
 * PR #225. Sharing `PINNED` is the fix: the two lists can no longer disagree.
 */
let playwright = null;
let scout = null;
for (const pkg of Object.keys(PINNED)) {
  try {
    const mod = await import(pkg);
    if (pkg === '@playwright/test') playwright = mod;
    if (pkg === 'a11y-scout') scout = mod;
    ok.push(`${pkg} is importable`);
  } catch {
    problems.push(
      `\`${pkg}\` is not installed. None of these are tracked dependencies — the a11y-scout\n` +
        '  packages are distributed by hand and resolve from no registry, and Playwright is\n' +
        '  kept untracked so CI installs stay unaffected by a browser download.\n\n' +
        INSTALL,
    );
  }
}

/**
 * 1a. Those packages are the versions the recorded findings were measured against.
 *
 * Importable is not enough. These four are installed `--no-save`, so nothing in the
 * repository records what is actually on disk: no lockfile entry, no `package.json` range,
 * and `npm ci` neither installs nor removes them. A tree installed before the pins moved
 * keeps working and says nothing, and the numbers in `docs/accessibility.md` are the output
 * of a specific axe engine and a specific browser runner — a re-scan under a different one
 * is a different measurement being compared to the old baseline.
 *
 * Reviewed on PR #225: writing the version into the install command pins it only for
 * somebody who runs that exact command today. This is the check that makes the pin real, so
 * it is a problem (exit 2, "fix the environment") rather than a note.
 */
for (const [pkg, want] of Object.entries(PINNED)) {
  const found = installedVersion(pkg);
  // Not installed at all is reported by the loop above — which walks these same keys, so
  // this cannot silently skip a package nothing else checked. Saying it twice in different
  // words would read as two faults.
  if (found === null) continue;
  if (found === want) ok.push(`${pkg}@${found} matches the pin`);
  else
    problems.push(
      `\`${pkg}\` is ${found}, but this folder's findings were measured against ${want}.\n` +
        '  Rule sets and rendering both move between versions, so a scan under it is not\n' +
        `  comparable to the baseline in docs/accessibility.md. Reinstall at the pin:\n\n${INSTALL}\n\n` +
        `  If ${found} is deliberate, re-pin a11y/versions.mjs and re-measure the baseline in\n` +
        '  the same change — otherwise the recorded numbers describe an engine nobody is running.',
    );
}

/** `axe-core` itself, which arrives transitively — reported, not enforced. See versions.mjs. */
{
  const axe = installedVersion('axe-core');
  if (axe !== null)
    ok.push(
      `axe-core@${axe}` +
        (axe === BASELINE_AXE_CORE
          ? ' matches the baseline engine'
          : ` — the baseline was measured with ${BASELINE_AXE_CORE}, so rule coverage may differ`),
    );
}

/**
 * 1b. Chromium, checked by launching rather than by looking for a directory.
 *
 * A partially extracted download leaves the path in place and fails at launch, and "the folder
 * exists" is not the claim being made. Chromium only: this suite runs no WebKit project.
 */
if (playwright) {
  try {
    const browser = await playwright.chromium.launch();
    const v = browser.version();
    await browser.close();
    ok.push(`chromium launches (${v})`);
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0];
    problems.push(`\`chromium\` will not launch: ${first}\n\n    npx playwright install chromium`);
  }
}

/** 2. The app, served. */
let appStatus = null;
try {
  const res = await fetch(BASE, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  appStatus = res.status;
  if (res.status >= 200 && res.status < 400) ok.push(`the app answers at ${BASE} (${res.status})`);
  else problems.push(`${BASE} answered ${res.status}, so the app is not serving normally.`);
} catch {
  problems.push(
    `Nothing is serving at ${BASE}.\n\n` +
      '    npx nx serve nuxeo-ui\n\n' +
      '  Without this every scan fails as a navigation timeout, which reads as a broken suite\n' +
      '  rather than one missing server.',
  );
}

/**
 * 3a. Nuxeo answers the credentials **as NUXEO_USER**, through the same proxy (NXSAT-643).
 *
 * Everything below reads a `200` as "authenticated", and on a Nuxeo with guests enabled a
 * request whose header never arrived is answered `200` as `Anonymous`: the File query still
 * finds a document the guest can read, and 3b's `hasAdministrationAccess` grants access on the
 * *configured* username alone. So the principal is asked for by name first, with the one guard
 * the Playwright side uses too (`scripts/beta-harness/identity-guard.mjs`), and nothing after it
 * runs on a run that is not the user it says.
 */
let identityOk = false;
if (appStatus !== null && auth) {
  const identity = await checkFetchIdentity(
    new URL(ME_PATH, BASE).href,
    auth,
    requireNuxeoCredentials().username,
  );
  if (identity.ok) {
    identityOk = true;
    ok.push(`Nuxeo answers the credentials as ${identity.user} through the dev proxy`);
  } else {
    problems.push(
      `${identity.problem}.\n` +
        '  Every scan would run as the wrong user, and still pass, because a guest-enabled Nuxeo\n' +
        '  answers 200 either way. Fix NUXEO_USER / NUXEO_PASS, or whatever drops the header.',
    );
  }
}

/**
 * 3. Nuxeo, through the app's own proxy, with documents in it.
 *
 * Reached via the proxy rather than :8080 directly, because the proxy is what the specs use —
 * testing :8080 would pass while a broken `apps/nuxeo-ui/proxy.conf.json` failed every scan.
 *
 * The document count is load-bearing twice over here. Surfaces and interaction states scan
 * lists and dialogs that are empty without content, and `journey.a11y.spec.ts` resolves a real
 * `File` uid to open the document-detail screen at all.
 */
if (appStatus !== null && auth && identityOk) {
  try {
    const url = new URL('/nuxeo/api/v1/search/lang/NXQL/execute', BASE);
    url.searchParams.set(
      'query',
      "SELECT * FROM File WHERE ecm:mixinType <> 'HiddenInNavigation' AND ecm:isTrashed = 0",
    );
    url.searchParams.set('pageSize', '1');
    const res = await fetch(url, {
      headers: { Authorization: auth, 'X-NXproperties': '*' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 200) {
      problems.push(
        `Nuxeo answered ${res.status} through the dev proxy at ${BASE}/nuxeo/api/v1/…\n` +
          '  Check the container is up (`docker ps`) and NUXEO_USER / NUXEO_PASS are right.',
      );
    } else {
      const body = await res.json();
      // Existence comes from the returned entries, not from `resultsCount`.
      //
      // `resultsCount` is not a plain count: Nuxeo returns negative sentinels for "unknown"
      // — notably with an elasticsearch page provider — and `resultsCount ?? entries.length`
      // selects the sentinel, because -2 is neither null nor undefined. A populated
      // repository then reads as empty and every scan is refused. Flagged in review on
      // PR #225; it does not reproduce on this instance, which returns a real count, but the
      // ordering is wrong regardless and `entries` answers the question being asked.
      const returned = Array.isArray(body.entries) ? body.entries.length : 0;
      if (returned > 0) {
        const total = typeof body.resultsCount === 'number' && body.resultsCount >= 0
          ? `${body.resultsCount} File document(s)`
          : 'File documents (exact count not reported by this page provider)';
        ok.push(`Nuxeo has ${total} to scan against`);
      } else {
        problems.push(
          'Nuxeo is reachable but returned no File documents.\n' +
            '  A scan of an empty list is clean and proves nothing, and the document-detail\n' +
            '  screen cannot be reached at all. Import a document first.',
        );
      }
    }
  } catch (error) {
    problems.push(
      `Could not query Nuxeo through the proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 3b. The identity can reach `/#/administration`, when the suite being guarded scans it.
 *
 * Checked against `/me` rather than assumed from the username, because a powerusers member
 * who is not `Administrator` is allowed in, and an `Administrator`-named account on a server
 * that says otherwise is still let in by the app's own rule — `hasAdministrationAccess`
 * mirrors that rule exactly, including the username fallback.
 */
if (appStatus !== null && auth && identityOk) {
  try {
    const res = await fetch(new URL('/nuxeo/api/v1/me', BASE), {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 200) {
      const { username } = requireNuxeoCredentials();
      const me = await res.json();
      const allowed = hasAdministrationAccess(me, username);
      if (allowed && NEEDS_FULL_ADMIN && !isFullAdministrator(me, username)) {
        problems.push(
          `${username} is in powerusers but is not an administrator, and this suite asserts the\n` +
            '  analytics tab /#/administration lands an administrator on. A powerusers member is\n' +
            '  sent to users-groups instead (fullAdministratorGuard), so that screen would fail.\n' +
            '  Use an administrator account.',
        );
      } else if (allowed && NEEDS_FULL_ADMIN) {
        ok.push(`${username} is an administrator, so /#/administration lands on analytics`);
      } else if (allowed) {
        ok.push(
          isFullAdministrator(me, username)
            ? `${username} is an administrator, so /#/administration will render (and journey can run)`
            : `${username} has administration access as a powerusers member, so /#/administration ` +
                'will render — but journey needs an administrator and will refuse it',
        );
      } else if (NEEDS_ADMIN) {
        problems.push(
          `${username} is neither an administrator nor in powerusers, and this suite scans\n` +
            '  /#/administration. adminGuard would redirect it to the dashboard, so that surface\n' +
            '  would fail — or worse, be measured as the dashboard. ' +
            (NEEDS_FULL_ADMIN
              ? 'Use an administrator account.'
              : 'Use an account with\n  administration access, or run the suite that does not visit it (states).'),
        );
      } else {
        ok.push(
          `${username} has no administration access — enough for states, which does not visit ` +
            '/#/administration; surfaces, modes, journey and the diagnostics will refuse it',
        );
      }
    } else {
      // A problem for EVERY suite, not only the ones that scan /#/administration.
      //
      // This used to be an `ok` line for the rest, reading "states does not need it". States
      // needs it as much as any of them: the session this harness injects is a `basic` one,
      // and `AuthService.runHydration` validates it by calling /me. On a non-200 the app
      // never adopts the injected session — `applyBasicSessionFromMe` does not run, so the
      // marker it would clear stays — and `signedIn`'s teardown then fails the test after it
      // has otherwise passed. Confirmed by stubbing /me to 500 while building that check.
      //
      // Not "already reported by the document query" either: that is a different endpoint and
      // can return 200 while this one fails. Both flagged in review on PR #225.
      problems.push(
        `/nuxeo/api/v1/me returned HTTP ${res.status}.\n` +
          '  Every suite needs it: the injected session is a basic one and the app validates it\n' +
          '  through /me while hydrating, so without it no scan runs as the signed-in user.' +
          (NEEDS_ADMIN
            ? '\n  It is also how administration access is established, which this suite scans.'
            : '') +
          '\n  Check the backend and the NUXEO_USER / NUXEO_PASS account.',
      );
    }
  } catch (error) {
    problems.push(
      `Could not read /nuxeo/api/v1/me through the proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 4. The LLM provider — reported, never enforced.
 *
 * In mock mode axe, the keyboard walk and reflow all still produce real findings but the AI
 * content-quality checks are **skipped entirely**. That covers eleven WCAG criteria (1.1.1,
 * 1.3.3, 2.4.2, 2.4.4, 2.5.3, 3.3.1, 3.3.2 at A; 1.3.5, 2.4.6, 3.1.2, 3.3.3 at AA), so an empty
 * semantic result means "not measured", not "clean". Saying so up front is the difference
 * between a partial scan and a misread one.
 *
 * The provider is a11y-scout's own answer, not ours. This used to test `HAIP_API_KEY` alone,
 * which is one of several inputs to a11y-scout's `detectProvider()`: `A11Y_LLM_PROVIDER` wins
 * outright, `CLAUDE_CODE_USE_BEDROCK=1` selects Bedrock even when a HAIP key is set, and
 * `AWS_PROFILE` selects it when no HAIP key is. A Bedrock setup was told its AI checks were
 * skipped, and a HAIP key under `CLAUDE_CODE_USE_BEDROCK` was reported as HAIP. Flagged in
 * review on PR #225. `createLlmProvider()` with no options is the call the
 * `@a11y-scout/playwright` fixture makes, so the two cannot disagree; constructing one only
 * builds a client and sends nothing.
 */
const NOT_PROOF =
  'Selected is not proof they ran: on 2026-09-22 HAIP reported READY, billed 15 calls, and ' +
  'every content-quality call still returned 403. `aiGenerated: 0` alone cannot tell a clean ' +
  'result from a failed one; a "content-quality: LLM call failed" line on stderr means the ' +
  'criteria were not measured.';
if (scout) {
  try {
    const llm = scout.createLlmProvider();
    const { provider } = llm.describe();
    if (llm.isMock) {
      ok.push(
        'a11y-scout is in mock mode — AI content-quality checks skipped (11 WCAG criteria ' +
          'unmeasured, not clean). `npx a11y-scout doctor` says why.',
      );
    } else if (provider === 'bedrock') {
      ok.push(
        'a11y-scout selected Bedrock — AI content-quality checks will be ATTEMPTED with the AWS ' +
          'credential chain, which this preflight does not test. ' +
          NOT_PROOF,
      );
    } else {
      ok.push(`a11y-scout selected ${provider} — AI content-quality checks will be ATTEMPTED. ${NOT_PROOF}`);
    }
  } catch (err) {
    ok.push(
      'Could not ask a11y-scout which LLM provider it will use ' +
        `(${err instanceof Error ? err.message : String(err)}), so whether the AI ` +
        'content-quality checks run is unknown — read the report header.',
    );
  }
}

if (problems.length) {
  console.error(`\na11y preflight: PRECONDITION NOT MET — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`- ${p}\n`);
  if (ok.length) console.error(`  Satisfied: ${ok.join('; ')}\n`);
  process.exit(2);
}

console.log('a11y preflight: pass — the stack is ready');
for (const o of ok) console.log(`  - ${o}`);
