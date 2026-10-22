#!/usr/bin/env node
/**
 * The verdict for the E2E vacuity control: which specs' own assertions actually depend on
 * what the repository returned.
 *
 * ## Why this is a differential, and not a single run
 *
 * The control this replaces ran the suite once with a wrong password and counted specs that
 * failed at an `expect()` of their own. Two separate things broke that:
 *
 * 1. **NXSAT-643's identity guard made the count structurally zero.** A wrong password now
 *    fails in the `signedIn` fixture and in `test.beforeAll`, and
 *    `assertion-failure-reporter.ts` excludes both by design — a spec that dies in setup
 *    "would have failed identically if its body were empty". So every repository-data spec
 *    failed in excluded territory, the 8 that remained were `auth.spec.ts` (which passes
 *    with any password on purpose), and the counted population was empty for every possible
 *    run. Measured on 2026-10-22: 9 failed, 0 counted, threshold 5 — a control that could
 *    only ever print FAIL, which its own header already warned is worse than no control.
 *
 * 2. **A single run cannot tell a sensitive assertion from an already-broken one.** Measured
 *    on the same day: `auth.spec.ts:211` fails at its own assertion on the *unmodified*
 *    harness with correct credentials, because `httpCredentials: { send: 'always' }`
 *    authenticates the "anonymous visitor" it exists to deny. A single starved run counted
 *    it among the sensitive seven. It is not sensitive to anything; it is red either way.
 *    Counting it is the same class of defect as everything above — a number that does not
 *    measure what its message claims.
 *
 * So the measurement is the **difference between two runs of the same specs**: a baseline,
 * and one where the app in the page is starved of data. A spec counts only if it
 * **passed the baseline and then failed at its own assertion when starved**. That is the
 * definition of "this assertion's outcome depends on what the repository returned", and it
 * is immune to both a spec that was already failing and a spec that fails in setup.
 *
 * ## What the three populations mean
 *
 * | population        | baseline | starved            | reading                                   |
 * | ----------------- | -------- | ------------------ | ----------------------------------------- |
 * | `counted`         | pass     | fail at own expect | the assertion reads repository data       |
 * | `vacuous`         | pass     | pass               | the assertion survives an empty repository |
 * | `inconclusive`    | pass     | fail, but in a hook| starvation broke its setup; says nothing  |
 * | `baselineFailure` | fail     | either             | not measurable until the spec is fixed    |
 * | `notPerturbed`    | pass     | pass, unstarved    | never starved, so it proves nothing      |
 *
 * `notPerturbed` exists because starvation rides on the `signedIn` fixture, and
 * `auth.spec.ts` imports `test` from `@playwright/test` directly — deliberately, since it
 * tests the guards that fixture defeats. Its specs are therefore never starved, and counting
 * them as "passed with the repository empty" claimed they survived a perturbation they never
 * saw. The fixture now annotates each test it starves, and a spec with no such annotation is
 * reported here instead.
 *
 * `vacuous` is the finding, not an error: some specs legitimately assert non-data things
 * (chrome, a redirect, a negative case). They are **named** in the output so the distinction
 * stays visible instead of being asserted once in a comment and then rotting. A spec that
 * claims to read repository data and appears here is a defect.
 *
 * ## The limitation to know before quoting the number
 *
 * This measures **per spec, not per assertion**, because `spec.ok` and the assertion reporter
 * both work at that granularity. So a vacuous assertion can hide inside a spec that has at
 * least one real one: measured while building this, `browse.spec.ts` "lists repository content
 * at the root" stayed in `counted` with its data assertion reverted to the vacuous form,
 * because its other assertion — the toolbar's `Create / Import` — fails under starvation and
 * carries the whole spec. `counted` therefore means "this spec has at least one data-sensitive
 * assertion", not "every assertion in it is data-sensitive".
 *
 * Usage:
 *   node vacuity-verdict.mjs <baseline-results.json> <starved-results.json> \
 *        <starved-assertion-failures.json> [min-expected]
 *
 * Exit codes:
 *   0  pass — at least `min-expected` specs are data-sensitive
 *   1  fail — below the threshold, so assertions may be vacuous
 *   2  usage or input problem (fix the environment, do not iterate on the code)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Every spec in a Playwright `results.json`, flattened out of the suite tree.
 *
 * The key is `file:line:project:title` rather than the `id` Playwright also provides. Both
 * are stable across two runs of identical code, but the assertion reporter's output carries
 * only file, line, project and title — so joining on `id` would work for the two results
 * files and then need a second, different join for the third input. One key for all three
 * inputs is the reason the three files cannot disagree about which spec is which.
 *
 * The **full title** is in the key because `file:line:project` alone is not unique: tests
 * registered in a loop from one `test()` call all report the same line, so a parameterized
 * spec would collide with its siblings and the join would silently pick whichever came
 * first. There are none in this suite today, and a key that depends on that staying true is
 * the kind of assumption this control exists to stop relying on.
 *
 * The whole describe chain, not just the leaf: a first attempt used the leaf alone, which
 * still collides when two parameterized `describe` blocks register the same test name at the
 * same line. The chains are safe to compare because the two sources produce them
 * identically — verified against a real run, where every title in
 * `assertion-failures.json` appears verbatim among the chains built from `results.json`.
 *
 * `basename` because the two sources spell the path differently: `results.json` says
 * `auth.spec.ts` and `assertion-failures.json` says `src/auth.spec.ts`.
 */
export function loadSpecs(results) {
  const specs = [];
  const walk = (suite, ancestry) => {
    const titles = suite.title ? [...ancestry, suite.title] : ancestry;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        specs.push({
          key: specKey(spec.file, spec.line, test.projectName, [...titles, spec.title].join(' > ')),
          file: spec.file,
          line: spec.line,
          project: test.projectName,
          title: [...titles, spec.title].join(' > '),
          // `ok` is Playwright's own per-spec verdict and already accounts for retries and
          // for `expectedStatus`, which is why it is used rather than re-deriving a status
          // from the results array. A spec that only passed on retry is `ok`.
          passed: spec.ok === true,
          // Distinguished from a failure: a skipped spec was not measured, and treating it
          // as a pass would let `test.skip` manufacture a vacuous-looking entry.
          skipped: (spec.tests ?? []).every((t) => t.status === 'skipped'),
          // Written by the `signedIn` fixture when it installs the starvation route, so
          // "passed while starved" is distinguishable from "was never starved".
          starved: (test.annotations ?? []).some((a) => a.type === 'starved'),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, titles);
  };
  // The root suite's title is the spec file's path, which is already the left-hand column of
  // every report line, so it is not part of the displayed name. Its describes are.
  for (const suite of results.suites ?? []) {
    for (const spec of suite.specs ?? []) walk({ specs: [spec] }, []);
    for (const child of suite.suites ?? []) walk(child, []);
  }
  return specs;
}

export function specKey(file, line, project, title) {
  return `${basename(String(file))}:${line}:${project ?? ''}:${String(title ?? '').trim()}`;
}

/**
 * Which specs failed at an `expect()` the spec itself wrote, per the assertion reporter.
 *
 * Returns a Set of keys. Only `failedAtAssertion` rows are included: the reporter has
 * already decided that question from `TestStep.category === 'expect'`, which Playwright sets
 * and its JSON reporter does not serialize, and nothing here re-derives it from an error
 * location. An earlier version of this control did re-derive it from the filename and
 * counted navigation timeouts as assertions.
 */
export function assertionKeys(assertionReport) {
  const keys = new Set();
  for (const spec of assertionReport.specs ?? []) {
    if (spec.failedAtAssertion) {
      keys.add(specKey(spec.file, spec.line, spec.project, spec.title));
    }
  }
  return keys;
}

/**
 * @param {{baseline: object, starved: object, assertions: object, minExpected: number}} input
 */
export function classify({ baseline, starved, assertions }) {
  const baseSpecs = loadSpecs(baseline);
  const starvedSpecs = loadSpecs(starved);
  const atAssertion = assertionKeys(assertions);

  const starvedByKey = new Map(starvedSpecs.map((s) => [s.key, s]));

  const counted = [];
  const vacuous = [];
  const notPerturbed = [];
  const inconclusive = [];
  const baselineFailure = [];
  const missing = [];

  for (const base of baseSpecs) {
    if (base.skipped) continue;
    if (!base.passed) {
      baselineFailure.push(base);
      continue;
    }
    const starvedSpec = starvedByKey.get(base.key);
    // A spec present in the baseline and absent when starved is not evidence either way.
    // Silently dropping it would shrink the denominator without saying so, which is how a
    // filtered run comes to look like a full one.
    if (!starvedSpec || starvedSpec.skipped) {
      missing.push(base);
      continue;
    }
    // Checked before the outcome, and in both directions. Starvation is what this run
    // varies, so a spec it never reached tells us nothing — whichever way that spec went.
    // The first version of this guarded only the passing branch, which left the failing one
    // able to *credit* a spec that was never starved: an unrelated failure, or a flake, would
    // have counted as proof that the assertion reads repository data. Same false credit as
    // the `auth.spec.ts` specs appearing in the vacuity list, one branch over.
    if (!starvedSpec.starved) {
      notPerturbed.push(base);
      continue;
    }
    if (starvedSpec.passed) vacuous.push(base);
    else if (atAssertion.has(base.key)) counted.push(base);
    else inconclusive.push(base);
  }

  return { counted, vacuous, notPerturbed, inconclusive, baselineFailure, missing };
}

/** The whole control is the comparison against this number, so it is validated. */
export function parseThreshold(raw) {
  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `min-expected must be a positive integer, got '${raw}'.\n` +
        '  A word or a negative made the comparison true for every run, so the control\n' +
        '  reported success while proving nothing.',
    );
  }
  const n = Number(value);
  if (n < 1) {
    throw new Error(
      `min-expected must be at least 1, got ${n}.\n` +
        '  A threshold of 0 makes this control unconditional: it would pass on a run in\n' +
        '  which nothing was data-sensitive, which is the opposite of what it detects.',
    );
  }
  return n;
}

const listing = (rows) =>
  rows
    .map((r) => `    ${`${basename(String(r.file))}:${r.line}`.padEnd(32)} ${r.title}`)
    .join('\n');

export function report(result, minExpected) {
  const { counted, vacuous, notPerturbed = [], inconclusive, baselineFailure, missing } = result;
  const out = [];
  out.push('=== E2E vacuity control: do the specs notice an empty repository? ===');
  out.push('');
  out.push(`Data-sensitive (passed the baseline, failed at their own expect when starved): ${counted.length}`);
  out.push(`Expected minimum: ${minExpected}`);
  out.push('');
  if (counted.length) {
    out.push('  Counted — the assertion changed outcome with the data, so it reads it:');
    out.push(listing(counted));
    out.push('');
  }
  if (vacuous.length) {
    out.push('  Passed even with the repository empty — these assert something an empty');
    out.push('  repository satisfies. Legitimate for chrome, redirects and negative cases;');
    out.push('  a defect for anything claiming to read repository data:');
    out.push(listing(vacuous));
    out.push('');
  }
  if (notPerturbed.length) {
    out.push('  NOT PERTURBED — these never received the starvation, because it rides on the');
    out.push('  `signedIn` fixture and they do not use it. Their pass says nothing either way:');
    out.push(listing(notPerturbed));
    out.push('');
  }
  if (inconclusive.length) {
    out.push('  Inconclusive — failed when starved, but not at an assertion of their own, so');
    out.push('  starvation broke their setup and the run says nothing about what they check:');
    out.push(listing(inconclusive));
    out.push('');
  }
  if (baselineFailure.length) {
    out.push('  NOT MEASURED — already failing in the baseline, so no difference can be read.');
    out.push('  Fix these before quoting the number above as covering them:');
    out.push(listing(baselineFailure));
    out.push('');
  }
  if (missing.length) {
    out.push('  NOT MEASURED — present in the baseline, absent or skipped when starved:');
    out.push(listing(missing));
    out.push('');
  }

  const ok = counted.length >= minExpected;
  if (ok) {
    out.push(`PASS: ${counted.length} spec(s) are data-sensitive, at or above the ${minExpected} expected.`);
    out.push('');
    out.push('That is the whole of the claim: for those specs, an assertion the spec itself');
    out.push('wrote changes outcome when the app is served an empty repository. It says');
    out.push('nothing about the specs listed as vacuous, not perturbed, inconclusive or not');
    out.push('measured: those are gaps, and they are named above rather than folded into the');
    out.push('total.');
  } else {
    out.push(`FAIL: only ${counted.length} spec(s) are data-sensitive, below the ${minExpected} expected.`);
    out.push('');
    out.push('Either assertions are passing against an empty repository, or the starved run');
    out.push('collapsed before it could tell. Read the lists above: a large inconclusive or');
    out.push('baseline-failure count means fix that first — the control cannot measure');
    out.push('anything through a harness that fell over.');
  }
  return { text: out.join('\n'), ok };
}

/** Node 20 has no `import.meta.main`; this is the documented equivalent. */
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const argv = process.argv.slice(2);

  // `--check-threshold <n>`: validate and exit, without needing either report. The control
  // script calls this before spending ten minutes on two Playwright runs, so a threshold
  // that cannot fail is rejected up front rather than after the work.
  if (argv[0] === '--check-threshold') {
    try {
      parseThreshold(argv[1]);
      process.exit(0);
    } catch (error) {
      console.error(`vacuity-verdict: ${error instanceof Error ? error.message : error}`);
      process.exit(2);
    }
  }

  const [baselinePath, starvedPath, assertionsPath, rawThreshold = '5'] = argv;
  if (!baselinePath || !starvedPath || !assertionsPath) {
    console.error(
      'usage: vacuity-verdict.mjs <baseline-results.json> <starved-results.json> ' +
        '<starved-assertion-failures.json> [min-expected]',
    );
    process.exit(2);
  }
  let minExpected;
  let inputs;
  try {
    minExpected = parseThreshold(rawThreshold);
    const read = (p) => {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch (error) {
        // An unreadable or absent file is an environment failure, never an empty result.
        // Treating it as zero is the mistake that made the first version of this control
        // incapable of reporting anything but FAIL.
        throw new Error(`cannot read ${p}: ${error instanceof Error ? error.message : error}`);
      }
    };
    inputs = {
      baseline: read(baselinePath),
      starved: read(starvedPath),
      assertions: read(assertionsPath),
    };
  } catch (error) {
    console.error(`vacuity-verdict: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }

  const result = classify(inputs);
  const { text, ok } = report(result, minExpected);
  console.log(text);
  process.exit(ok ? 0 : 1);
}
