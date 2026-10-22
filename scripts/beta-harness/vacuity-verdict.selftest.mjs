#!/usr/bin/env node
/**
 * Selftest for `vacuity-verdict.mjs` — the classifier the E2E vacuity control's exit code
 * comes from.
 *
 * Every expectation here is one the previous control got wrong at some point, which is why
 * they are stated as cases rather than as prose in the verdict's header:
 *
 *   - a spec failing in the baseline must not be counted (it is red either way —
 *     `auth.spec.ts:211` was counted that way on 2026-10-22);
 *   - a spec failing when starved but *not* at its own assertion must not be counted
 *     (that is the hook-shaped failure NXSAT-643's guard produces);
 *   - a spec passing both runs is the finding, and must be reported rather than counted;
 *   - the threshold must reject a value that cannot fail.
 *
 * Usage: node scripts/beta-harness/vacuity-verdict.selftest.mjs
 * Exit: 0 all expectations met, 1 otherwise.
 */
import { classify, loadSpecs, parseThreshold, report, specKey } from './vacuity-verdict.mjs';

let failures = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** A minimal `results.json` shaped like Playwright's, with one suite per file. */
const results = (specs) => ({
  suites: [
    {
      title: 'a suite',
      suites: [
        {
          title: 'inner',
          specs: specs.map((s) => ({
            title: s.title,
            file: s.file,
            line: s.line,
            ok: s.ok,
            tests: [{ projectName: 'chromium', status: s.status ?? (s.ok ? 'expected' : 'unexpected'), results: [] }],
          })),
        },
      ],
    },
  ],
});

const assertionReport = (rows) => ({
  specs: rows.map((r) => ({
    title: r.title,
    file: `src/${r.file}`,
    line: r.line,
    project: 'chromium',
    failedAtAssertion: r.failedAtAssertion,
    assertion: { assertion: 'something', where: `src/${r.file}:${r.line + 5}` },
    errorLocation: `src/${r.file}:${r.line + 5}`,
  })),
});

// ---------------------------------------------------------------- the four populations

const baseline = results([
  { title: 'reads data', file: 'a.spec.ts', line: 10, ok: true },
  { title: 'asserts chrome', file: 'a.spec.ts', line: 20, ok: true },
  { title: 'dies in setup when starved', file: 'a.spec.ts', line: 30, ok: true },
  { title: 'already broken', file: 'a.spec.ts', line: 40, ok: false },
  { title: 'vanishes when starved', file: 'a.spec.ts', line: 50, ok: true },
]);

const starved = results([
  { title: 'reads data', file: 'a.spec.ts', line: 10, ok: false },
  { title: 'asserts chrome', file: 'a.spec.ts', line: 20, ok: true },
  { title: 'dies in setup when starved', file: 'a.spec.ts', line: 30, ok: false },
  { title: 'already broken', file: 'a.spec.ts', line: 40, ok: false },
]);

const assertions = assertionReport([
  { title: 'reads data', file: 'a.spec.ts', line: 10, failedAtAssertion: true },
  { title: 'dies in setup when starved', file: 'a.spec.ts', line: 30, failedAtAssertion: false },
  { title: 'already broken', file: 'a.spec.ts', line: 40, failedAtAssertion: true },
]);

const r = classify({ baseline, starved, assertions });
const titles = (rows) => rows.map((x) => x.title).sort();

ok('a spec that passed the baseline and failed at its own expect is COUNTED',
  titles(r.counted).join() === 'inner > reads data', titles(r.counted).join());

ok('a spec that passed both runs is reported as VACUOUS, not counted',
  titles(r.vacuous).join() === 'inner > asserts chrome', titles(r.vacuous).join());

ok('a spec that failed when starved but not at an assertion is INCONCLUSIVE',
  titles(r.inconclusive).join() === 'inner > dies in setup when starved', titles(r.inconclusive).join());

ok('a spec already failing in the baseline is NOT MEASURED, even though it failed at an assertion',
  titles(r.baselineFailure).join() === 'inner > already broken' && !titles(r.counted).includes('inner > already broken'),
  titles(r.baselineFailure).join());

ok('a spec present in the baseline and absent when starved is NOT MEASURED',
  titles(r.missing).join() === 'inner > vanishes when starved', titles(r.missing).join());

ok('the four populations are disjoint',
  new Set([...r.counted, ...r.vacuous, ...r.inconclusive, ...r.baselineFailure, ...r.missing]
    .map((x) => x.key)).size === 5);

// ---------------------------------------------------------------- the verdict

ok('the verdict is PASS at exactly the threshold',
  report({ ...r, counted: [{ file: 'a', line: 1, title: 't' }] }, 1).ok === true);

ok('the verdict is FAIL one below the threshold',
  report(r, 2).ok === false, `counted=${r.counted.length}`);

ok('a vacuous spec is named in the output, not merely totalled',
  report(r, 1).text.includes('asserts chrome'));

ok('a baseline failure is named in the output as not measured',
  /NOT MEASURED[\s\S]*already broken/.test(report(r, 1).text));

// ---------------------------------------------------------------- skipped specs

const skippedBase = results([
  { title: 'skipped one', file: 'b.spec.ts', line: 10, ok: true, status: 'skipped' },
]);
ok('a skipped spec is not treated as a pass, so test.skip cannot manufacture a vacuous entry',
  (() => {
    const c = classify({ baseline: skippedBase, starved: results([]), assertions: assertionReport([]) });
    return c.counted.length === 0 && c.vacuous.length === 0 && c.missing.length === 0;
  })());

// ---------------------------------------------------------------- keys and threshold

ok('the spec key ignores the differing path prefixes of the two input files',
  specKey('auth.spec.ts', 211, 'chromium') === specKey('src/auth.spec.ts', 211, 'chromium'));

ok('the spec key separates the same spec on two browser projects',
  specKey('a.spec.ts', 1, 'chromium') !== specKey('a.spec.ts', 1, 'webkit'));

ok('loadSpecs keeps the describe title in the reported name',
  loadSpecs(baseline)[0].title === 'inner > reads data', loadSpecs(baseline)[0].title);

for (const bad of ['0', '-1', 'five', '', '2.5', ' ']) {
  ok(`a threshold of '${bad}' is rejected`, (() => {
    try {
      parseThreshold(bad);
      return false;
    } catch {
      return true;
    }
  })());
}
ok('a threshold of 1 is accepted', parseThreshold('1') === 1);
ok('a threshold of 5 is accepted', parseThreshold(5) === 5);

console.log('');
if (failures) {
  console.error(`vacuity-verdict.selftest: FAIL — ${failures} expectation(s) not met.`);
  process.exit(1);
}
console.log('vacuity-verdict.selftest: pass — all expectations met.');
