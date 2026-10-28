#!/usr/bin/env node
import { spawnToolSync } from './package-command.mjs';

/**
 * Negative controls for `apps/nuxeo-ui-e2e/assertion-failure-reporter.ts`.
 *
 * The reporter is what `scripts/e2e-negative-control.sh` counts, and that control is the
 * thing standing between this repository and a suite full of assertions that pass vacuously.
 * A control nobody checks is worth what the last one was worth: its first version could only
 * ever print FAIL, and the version after that counted navigation timeouts as assertions.
 * Both were wrong for weeks because nothing exercised them.
 *
 * So the five shapes are kept executable. `cases.spec.ts` fails on purpose in each of them
 * and this asserts the reporter's verdict, including two silence assertions — a reporter
 * that counted everything would satisfy the positive check alone.
 *
 *   counted   a failing expect() in the test body
 *   excluded  a throw from a helper in another file
 *   excluded  a rejection on a line the spec wrote, with no expect run   <- the review finding
 *   excluded  a failing expect() inside beforeEach, body never ran
 *   excluded  a failing expect() inside a test fixture, body never ran
 *   absent    a spec that passed
 *
 * ## The mutation this file's authority rests on
 *
 * Replace the `category === 'expect'` rule in the reporter with the old filename test —
 * count a failure when `errorLocation.file` ends in `*.spec.ts` — and the counted total goes
 * from **1 to 3**: the spec-line rejection and the `beforeEach` assertion both surface at a
 * `cases.spec.ts` line and are admitted, while only the helper throw, located in `helper.ts`,
 * is still excluded. Measured 2026-09-24.
 *
 * The fixture's name is what makes that mutation meaningful, and it was wrong until review
 * pointed it out. While the file was `cases.case.ts` the old rule matched none of the four
 * shapes, so the mutation scored 0 rather than 3 — the self-test could show the old rule
 * counting *nothing*, which is not the defect, and could not show it over-counting, which is.
 * See the header of `cases.spec.ts`.
 *
 * Usage: node scripts/beta-harness/assertion-reporter.selftest.mjs
 * Exit 1 if any expectation is unmet.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const fixtureDir = resolve(repoRoot, 'scripts/beta-harness/fixtures/assertion-reporter');
const configFile = resolve(fixtureDir, 'playwright.config.ts');
// Must match `outputFile` in the fixture config; both sit under gitignored `dist/`.
const outputFile = resolve(repoRoot, 'dist/e2e/assertion-reporter-selftest/out.json');

rmSync(outputFile, { force: true });

const run = spawnToolSync('npx', ['playwright', 'test', '-c', configFile], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env },
});

// A non-zero exit is expected — five of the six cases fail on purpose. What is NOT expected
// is the reporter failing to load, which Playwright also reports as a non-zero exit with no
// output file. Distinguishing the two is the point of checking the file rather than the code.
if (!existsSync(outputFile)) {
  console.error('assertion-reporter.selftest: the reporter wrote no output file.\n');
  console.error(run.stdout ?? '');
  console.error(run.stderr ?? '');
  console.error(
    '\nThe reporter did not load. A `.ts` reporter is transpiled and loaded through\n' +
      '`require`, so any `import.meta` in it makes Node treat the file as an ES module and\n' +
      'the run dies on `exports is not defined in ES module scope` before a test starts.',
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(outputFile, 'utf8'));
const byTitle = new Map(report.specs.map((s) => [s.title, s]));

const failures = [];
/** @param {string} label @param {boolean} ok @param {string} detail */
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

const counted = (title) => byTitle.get(title)?.failedAtAssertion === true;
const excluded = (title) => byTitle.has(title) && byTitle.get(title).failedAtAssertion === false;

console.log('assertion-reporter selftest — six deliberate cases\n');

const bodyAssertion = 'counts: a failing expect in the test body';
const helperThrow = 'excluded: throws from a helper in another file';
const specLineThrow = 'excluded: rejects on a line the spec wrote, with no expect run';
const hookAssertion =
  'hook failures > excluded: the assertion that failed was in a hook, so the body never ran';
const fixtureAssertion =
  'excluded: the assertion that failed was in a fixture, so the body never ran';
const passing = 'passes, so it is not in the report at all';

check(
  'a failing expect() in the test body is COUNTED',
  counted(bodyAssertion),
  JSON.stringify(byTitle.get(bodyAssertion) ?? null),
);
check(
  'a throw from a helper in another file is EXCLUDED',
  excluded(helperThrow),
  JSON.stringify(byTitle.get(helperThrow) ?? null),
);
check(
  'a rejection on a spec-file line with no expect is EXCLUDED (the review finding)',
  excluded(specLineThrow),
  JSON.stringify(byTitle.get(specLineThrow) ?? null),
);
check(
  'a failing expect() inside beforeEach is EXCLUDED',
  excluded(hookAssertion),
  JSON.stringify(byTitle.get(hookAssertion) ?? null),
);
// Review asked for a separate `category === 'fixture'` exclusion, expecting this case to be
// counted without one. It is not: Playwright nests fixture setup inside `Before Hooks`, so
// the hook exclusion already reaches it. Kept as a check rather than as a comment, and it is
// capable of failing — emptying the exclusion set entirely turns this one red along with the
// beforeEach case, `atAssertion` going 1 -> 3.
check(
  'a failing expect() inside a test fixture is EXCLUDED',
  excluded(fixtureAssertion),
  JSON.stringify(byTitle.get(fixtureAssertion) ?? null),
);
// Silence assertions: a reporter that counted every failure, or listed passing specs, would
// satisfy the first check above and still be useless.
check('a passing spec is ABSENT from the report', !byTitle.has(passing), 'it was listed');
check(
  'exactly 1 of 5 failures is counted as an assertion',
  report.atAssertion === 1 && report.beforeAssertion === 4 && report.failedSpecs === 5,
  `atAssertion=${report.atAssertion} beforeAssertion=${report.beforeAssertion} failedSpecs=${report.failedSpecs}`,
);
// Not a regex on the step title: Playwright uses `expect`'s custom message as the step
// title when one is given, so matching the word "expect" would fail on every assertion
// written with a message — which is most of them in this suite.
check(
  'the counted failure records where the assertion was, not where the error surfaced',
  /^cases\.spec\.ts:\d+$/.test(byTitle.get(bodyAssertion)?.assertion?.where ?? '') &&
    (byTitle.get(bodyAssertion)?.assertion?.assertion ?? '').length > 0,
  JSON.stringify(byTitle.get(bodyAssertion)?.assertion ?? null),
);
// The describe title must survive. It did not: the fixture config leaves its project
// unnamed, `titlePath()` then carries two empty entries, and filtering before slicing
// dropped `hook failures` from the title. Kept as a check because production has a named
// project and would never have shown it.
check(
  'a describe title is preserved in the reported spec title',
  [...byTitle.keys()].some((t) => t.startsWith('hook failures > ')),
  [...byTitle.keys()].join(' | '),
);

rmSync(outputFile, { force: true });

if (failures.length) {
  console.error(`\nassertion-reporter.selftest: FAIL — ${failures.length} expectation(s) unmet.`);
  process.exit(1);
}
console.log('\nassertion-reporter.selftest: pass — all 9 expectations met.');
