#!/usr/bin/env node
/**
 * Refuse to run the E2E suite against a stack that is not there.
 *
 * Playwright's own behaviour when the dev server is absent is a wall of navigation
 * timeouts, which reads as thirteen product failures. The real message — "nothing was
 * serving" — is nowhere in it. Worse is the other direction: a suite pointed at a live app
 * with an **empty** Nuxeo passes every render assertion and proves nothing, which is the
 * vacuous-pass shape this repository has been caught by repeatedly.
 *
 * So four preconditions, each with the specific fix, and **exit 2** rather than 1 — the
 * `precondition-not-met` convention `phase-runner.mjs` established: fix the environment,
 * do not iterate on the code.
 *
 * Usage:
 *   node scripts/beta-harness/e2e-preflight.mjs
 */

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';

const { parseAllowedHosts, isHostAllowed, ALLOWED_HOSTS_ENV } = await import(
  new URL('../../libs/integration-tests/src/lib/integration-preflight.ts', import.meta.url).href,
);
const { checkFetchIdentity, ME_PATH } = await import(new URL('./identity-guard.mjs', import.meta.url).href);

const E2E_ALLOWED_HOSTS_ENV = 'E2E_ALLOWED_HOSTS';

const problems = [];
const ok = [];

/**
 * 0a. The app origin is named before any Basic header is built or sent.
 *
 * Enforced by `hostAllowed` on every check that sends the header (3a, 3). Until NXSAT-643 the
 * refusal was only reported: check 3 still sent the pair to a host this check had just refused.
 */
let hostAllowed = false;
const allowedHosts = parseAllowedHosts(
  process.env[E2E_ALLOWED_HOSTS_ENV] ?? process.env[ALLOWED_HOSTS_ENV],
);
if (allowedHosts.length === 0) {
  problems.push(
    `${E2E_ALLOWED_HOSTS_ENV} (or ${ALLOWED_HOSTS_ENV}) must name the host(s) this run may target.\n\n` +
      '    export E2E_ALLOWED_HOSTS=localhost:4200\n\n' +
      '  Default deny — localhost is not implicit. A mistyped E2E_BASE_URL must not receive\n' +
      '  NUXEO_USER/NUXEO_PASS before the run refuses.',
  );
} else {
  try {
    if (!isHostAllowed(BASE, allowedHosts)) {
      problems.push(
        `E2E_BASE_URL (${BASE}) is not named in ${E2E_ALLOWED_HOSTS_ENV} / ${ALLOWED_HOSTS_ENV}.\n` +
          `  Allowed: ${allowedHosts.join(', ')}\n\n` +
          '  Fix the base URL or extend the allowlist — do not point destructive credentials at an\n' +
          '  unintended host.',
      );
    } else {
      hostAllowed = true;
      ok.push(`E2E_BASE_URL host is named in ${E2E_ALLOWED_HOSTS_ENV} / ${ALLOWED_HOSTS_ENV}`);
    }
  } catch (error) {
    problems.push(
      `E2E_BASE_URL is not usable: ${error instanceof Error ? error.message : String(error)}\n` +
        '  Set E2E_BASE_URL to a full http(s) URL with a host, e.g. http://localhost:4200',
    );
  }
}

/**
 * 0. The credentials, from the environment, with **no** fallback — the same rule
 * `apps/nuxeo-ui-e2e/src/nuxeo-credentials.ts` enforces for the suite this gate runs ahead of.
 *
 * These two lines each carried `?? 'Administrator'`, which `.cursor/rules/security.mdc`
 * forbids outright: a working Basic-auth pair compiled into the repository. It also put the
 * two stages of `beta:e2e` into disagreement, which is how it was reported. With the variables
 * unset this preflight invented the pair, sent it at check 3, and could report **pass**;
 * `playwright.config.ts` then called `nuxeoCredentials()` at config-load time, which throws,
 * and Playwright exited **1**. So the one missing precondition in the run arrived as the code
 * that means "a product defect" — from the stage *after* the gate whose entire job is to say
 * "fix the environment" with exit 2.
 *
 * Checked before anything else, and the checks that need the header are skipped without it:
 * there is nothing to authenticate with, and guessing is the defect.
 */
const USER = process.env['NUXEO_USER'];
const PASS = process.env['NUXEO_PASS'];
const auth = USER && PASS ? `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` : null;

if (auth) {
  ok.push('NUXEO_USER and NUXEO_PASS are both set');
} else {
  problems.push(
    'NUXEO_USER and NUXEO_PASS must both be set to run the e2e suite.\n\n' +
      '    export NUXEO_USER=<user> NUXEO_PASS=<password>\n\n' +
      '  There is deliberately no default. A default that suits one instance is wrong on every\n' +
      '  other, and it embeds a usable credential in the repository. `playwright.config.ts`\n' +
      '  refuses the same way at config load — this reports it as a precondition (exit 2)\n' +
      '  rather than letting the run reach Playwright and fail as exit 1.',
  );
}

/** 1. Playwright, which is deliberately not a tracked dependency. */
let playwright = null;
try {
  playwright = await import('@playwright/test');
  ok.push('@playwright/test is importable');
} catch {
  problems.push(
    '`@playwright/test` is not installed. It is intentionally not a tracked dependency,\n' +
      '  so CI installs stay unaffected by a browser download:\n\n' +
      '    npm install --no-save @playwright/test @axe-core/playwright\n' +
      '    npx playwright install chromium webkit\n\n' +
      '  Both packages in ONE command: `npm install --no-save X` prunes anything previously\n' +
      '  installed with --no-save, so installing them separately removes the first.',
  );
}

/**
 * 1b. Both browser engines, because the suite has run on two since Phase 6 step 5.
 *
 * Checked by launching rather than by looking for a directory: a partially extracted download
 * leaves the path in place and fails at launch, and "the folder exists" is not the claim. A
 * missing engine otherwise surfaces as every WebKit spec failing, which reads as seventeen
 * product defects rather than one absent browser.
 */
if (playwright) {
  for (const name of ['chromium', 'webkit']) {
    try {
      const browser = await playwright[name].launch();
      const v = browser.version();
      await browser.close();
      ok.push(`${name} launches (${v})`);
    } catch (err) {
      problems.push(
        `\`${name}\` will not launch: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}\n\n` +
          `    npx playwright install ${name}\n\n` +
          '  The Beta checklist asks for Chrome AND Safari. Running only the engine that happens\n' +
          '  to be installed, and reporting a pass, is how "cross-browser verified" stops meaning\n' +
          'anything.',
      );
    }
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
      '  Without this every spec fails as a navigation timeout, which reads as thirteen\n' +
      '  product defects rather than one missing server.',
  );
}

/**
 * 3a. Nuxeo answers the header **as NUXEO_USER**, through the same proxy.
 *
 * Check 3 cannot tell: measured on a Nuxeo with guests enabled, the File query below returns
 * one row to `Anonymous` and 1154 to the administrator, so it passes either way. Only `/me`
 * names the principal (NXSAT-643, `identity-guard.mjs`).
 */
let identityOk = false;
if (appStatus !== null && auth && hostAllowed) {
  const identity = await checkFetchIdentity(new URL(ME_PATH, BASE).href, auth, USER);
  if (identity.ok) {
    identityOk = true;
    ok.push(`Nuxeo answers the credentials as ${identity.user} through the dev proxy`);
  } else {
    problems.push(
      `${identity.problem}.\n` +
        '  The suite would run as the wrong user and still pass its render assertions, because a\n' +
        '  guest-enabled Nuxeo answers 200 either way. Fix NUXEO_USER / NUXEO_PASS, or whatever\n' +
        '  between here and Nuxeo drops the Authorization header.',
    );
  }
}

/**
 * 3. Nuxeo, through the app's own proxy, **with documents in it**.
 *
 * Reached via the proxy rather than :8080 directly, because the proxy is what the specs
 * use — testing :8080 would pass while a broken `proxy.conf.json` failed every spec.
 *
 * The document count is the load-bearing part. Every critical-path spec asserts repository
 * data, so an empty repository is not a pass, it is an untested run. Asked only once 3a has
 * shown the header runs as the right user, or the count would be the guest's.
 */
if (appStatus !== null && auth && identityOk) {
  try {
    const url = new URL('/nuxeo/api/v1/search/lang/NXQL/execute', BASE);
    url.searchParams.set(
      'query',
      "SELECT * FROM Document WHERE ecm:primaryType = 'File' AND ecm:isTrashed = 0",
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
      // A negative `resultsCount` is UNKNOWN, not a count, and the entries decide.
      //
      // Nuxeo's page provider answers -1 (`UNKNOWN_SIZE`) and -2 (`UNKNOWN_SIZE_AFTER_QUERY`)
      // when the total exceeds its count limit, and `??` passes both straight through because
      // neither is null or undefined. A populated repository therefore scored -2, failed
      // `count > 0`, and this preflight reported "holds no File documents" and exited 2 —
      // inverting its answer on exactly the large repositories it is least able to doubt.
      // Identical defect and identical fix to `libs/integration-tests/…/integration-preflight.ts`,
      // where four unit cases cover both sentinels in both directions; it survived here because
      // this file is a separate copy of the same logic. `scripts/e2e-negative-control.sh` runs
      // this preflight as its first step, so the control could not start against a real
      // repository.
      //
      // The entries are the evidence, and the total is only the nicer number to print.
      //
      // That sentence stood here while the condition was `(total ?? entries) > 0`, which
      // trusts the total whenever there is one — the opposite of what it says. This endpoint
      // is index-backed and a stale index answers with a count for documents it can no longer
      // resolve, measured on this deployment at `resultsCount` 1026 with zero entries. The
      // preflight would then let the whole E2E suite start against a repository from which
      // no spec can retrieve a row. Same defect, same fix, as the integration-preflight copy
      // beside it; reported on the pull request against both.
      //
      // `pageSize=1` is asked for, so one returned row is all the evidence there is to want.
      const entries = Array.isArray(body.entries) ? body.entries.length : 0;
      const total = typeof body.resultsCount === 'number' && body.resultsCount >= 0 ? body.resultsCount : null;
      if (entries > 0) {
        ok.push(`Nuxeo has ${total ?? `at least ${entries}`} File document(s) the specs can assert against`);
      } else {
        problems.push(
          'Nuxeo is reachable but returned no File documents.\n' +
            '  Specs that assert repository rows need at least one File to exercise; chrome,\n' +
            '  routing, and accessibility specs may still run, but data-dependent assertions\n' +
            '  would vacuously pass against an empty index.\n' +
            (total !== null && total > 0
              ? `  The query reported a total of ${total} and returned nothing, which is what a\n` +
                '  stale search index looks like. Reindex, or import a document.'
              : '  Import a document first.'),
        );
      }
    }
  } catch (error) {
    problems.push(
      `Could not query Nuxeo through the proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (problems.length) {
  console.error(`\ne2e-preflight: PRECONDITION NOT MET — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`- ${p}\n`);
  if (ok.length) console.error(`  Satisfied: ${ok.join('; ')}\n`);
  // 2, not 1: fix the environment, do not iterate on the code.
  process.exit(2);
}

console.log('e2e-preflight: pass — the stack is ready');
for (const o of ok) console.log(`  - ${o}`);
