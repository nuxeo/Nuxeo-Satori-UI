#!/usr/bin/env node
/**
 * The identity guard's live negative controls (NXSAT-643): prove, on a real server that lets
 * guests in, that the guard rejects a run that lost its identity — and only such a run.
 *
 * Three runs of `fixtures/identity-guard/control.steps.mjs` through the real phase runner:
 *
 * | Control                  | Fault, applied after a correct sign-in            | Must end as                    |
 * | ------------------------ | ------------------------------------------------- | ------------------------------ |
 * | `none`                   | none                                              | exit 0, identity valid         |
 * | `drop-credentials`       | credentials removed from the context and browser  | exit 2, rejected as Anonymous  |
 * | `adopt-anonymous-cookie` | guest `JSESSIONID` picked up, app session lost    | exit 2, rejected as Anonymous  |
 *
 * And for the two faulted runs, every check of the steps' own passed: without the guard they
 * would have been green, which is the failure the guard exists for. A control that went red on
 * its own checks would prove nothing about the guard.
 *
 * Needs a server with anonymous authentication on — otherwise Nuxeo itself refuses a dropped
 * credential, and the controls cannot show the guard doing anything. Checked first; exit 2 when
 * it does not hold. Changes no data and no server configuration: every request is a read.
 *
 * Usage (the app served on APP_URL, proxying to the Nuxeo under test):
 *   NUXEO_USER=… NUXEO_PASS=… APP_URL=http://localhost:4200 \
 *     node scripts/beta-harness/identity-guard.controls.mjs
 *
 * Exit 0 when all three ended as above, 1 when any did not, 2 when the environment cannot run them.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { ME_PATH, isAnonymousMe } from './identity-guard.mjs';
import { nuxeoCredentialsOrExit } from './nuxeo-credentials.mjs';

const HERE = import.meta.dirname;
const STEPS = resolve(HERE, 'fixtures', 'identity-guard', 'control.steps.mjs');
const RUNNER = resolve(HERE, 'phase-runner.mjs');

nuxeoCredentialsOrExit('run the identity guard controls');
const appUrl = process.env['APP_URL'] ?? 'http://localhost:4200';
const origin = new URL(appUrl).origin;

// ── Is this a server the controls can say anything about? ──────────────────────────────────────
const guest = await fetch(`${origin}${ME_PATH}`, { headers: { Accept: 'application/json' } })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
  .catch((err) => ({ status: 0, body: null, error: String(err) }));
if (guest.status !== 200 || !isAnonymousMe(guest.body)) {
  console.error(
    `identity-guard controls: NOT APPLICABLE — an unauthenticated ${origin}${ME_PATH} answered ` +
      `${guest.status || 'nothing'}${guest.status === 200 ? ' without the guest' : ''}. The controls need a ` +
      'Nuxeo with anonymous authentication on, where a request without credentials is answered ' +
      'as Anonymous instead of refused.',
  );
  process.exit(2);
}
console.log(
  `identity-guard controls against ${origin} — an unauthenticated /me answers ${guest.body.id}\n`,
);

const CONTROLS = [
  { mode: 'none', exit: 0, valid: true },
  { mode: 'drop-credentials', exit: 2, valid: false },
  { mode: 'adopt-anonymous-cookie', exit: 2, valid: false },
];

const results = [];
for (const control of CONTROLS) {
  const phase = `identity-guard-control-${control.mode}`;
  const run = spawnSync('node', [RUNNER, phase, STEPS], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IDENTITY_GUARD_CONTROL: control.mode,
      EVIDENCE_HEADLESS: '1',
      EVIDENCE_SLOWMO: '0',
    },
  });
  const report = /report\s+(\S+INDEX\.md)/.exec(run.stdout ?? '')?.[1];
  /** @type {any} */
  let manifest = null;
  if (report)
    manifest = JSON.parse(await readFile(resolve(dirname(report), 'manifest.json'), 'utf8'));

  const problems = [];
  if (run.status !== control.exit) problems.push(`exited ${run.status}, expected ${control.exit}`);
  if (!manifest) problems.push('wrote no manifest');
  else {
    if (manifest.identity?.valid !== control.valid) {
      problems.push(`identity.valid is ${manifest.identity?.valid}, expected ${control.valid}`);
    }
    const ownChecks = manifest.steps
      .flatMap((s) => s.checks)
      .filter((c) => !c.name.includes('identity guard'));
    const ownFailed = ownChecks.filter((c) => !c.passed);
    if (ownFailed.length) {
      problems.push(
        `the steps' own checks failed (${ownFailed.map((c) => c.name).join(', ')}), so this says nothing about the guard`,
      );
    }
    if (!control.valid) {
      const rejected = manifest.identity.checks.flatMap((c) => c.reports).filter((r) => !r.ok);
      if (!rejected.some((r) => /Anonymous/.test(r.problem ?? ''))) {
        problems.push(
          `rejected, but not for running as Anonymous: ${JSON.stringify(rejected.map((r) => r.problem))}`,
        );
      }
      if (manifest.verdict !== 'precondition-not-met') problems.push(`verdict ${manifest.verdict}`);
    }
  }
  const line = manifest?.identity?.checks
    ?.flatMap((c) =>
      c.reports.filter((r) => !r.ok).map((r) => `${c.at} [${r.channel}] ${r.problem}`),
    )
    .join(' | ');
  results.push({ ...control, ok: problems.length === 0, problems, report });
  console.log(
    `  [${problems.length ? 'FAIL' : 'pass'}] ${control.mode}: exit ${run.status}, verdict ${manifest?.verdict}`,
  );
  if (line) console.log(`         ${line}`);
  for (const p of problems) console.log(`         ${p}`);
  if (report) console.log(`         ${report}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed
    ? `\nidentity-guard controls: FAIL — ${failed} of ${results.length} did not end as expected.`
    : `\nidentity-guard controls: pass — 1 positive, 2 negative, each ended as expected.`,
);
process.exit(failed ? 1 : 0);
