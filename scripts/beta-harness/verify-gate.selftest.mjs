#!/usr/bin/env node
/**
 * Controls for how `verify-gate.mjs` counts gates: a gate that did not run is never green.
 *
 * Two of the controls run the real runner and the real code-scanning gate with
 * `BETA_SKIP_CODE_SCANNING=1`, the one path that skips a gate today, and read their output and
 * report. The rest drive `gate-summary.mjs` with made-up results, because a full run takes a
 * quarter of an hour. Reports go to a temporary evidence directory, removed at the end.
 *
 * Usage:  node scripts/beta-harness/verify-gate.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { NOT_RUN_EXIT_CODE, classify, summarize } from './gate-summary.mjs';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..', '..');
const evidence = mkdtempSync(join(tmpdir(), 'verify-gate-selftest-'));
const env = { ...process.env, AGENTIC_UI_EVIDENCE_DIR: evidence, BETA_SKIP_CODE_SCANNING: '1' };

const controls = [];
function control(name, fn) {
  try {
    fn();
    controls.push({ name, ok: true });
  } catch (error) {
    controls.push({ name, ok: false, why: error.message });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const pass = (id) => ({
  id,
  status: 'pass',
  passed: true,
  command: `node ${id}.mjs`,
  outputTail: '',
});
const notRun = (id) => ({
  id,
  status: 'not-run',
  passed: false,
  command: `node ${id}.mjs`,
  outputTail: '',
});
const fail = (id) => ({
  id,
  status: 'fail',
  passed: false,
  command: `node ${id}.mjs`,
  outputTail: `${id} broke`,
});
const ids = (n) => Array.from({ length: n }, (_, i) => `g${i + 1}`);

control('the code-scanning gate, skipped, exits with the not-run code', () => {
  const run = spawnSync(process.execPath, [join(here, 'code-scanning.mjs')], {
    env,
    encoding: 'utf8',
  });
  expect(run.status === NOT_RUN_EXIT_CODE, `exit ${run.status}, expected ${NOT_RUN_EXIT_CODE}`);
  expect(/NOT RUN/.test(run.stdout), 'no NOT RUN banner');
});

control('the real runner counts a skipped code-scanning gate as NOT RUN, not green', () => {
  const run = spawnSync(
    process.execPath,
    [join(here, 'verify-gate.mjs'), '--gates', 'code-scanning', '--phase', 'selftest'],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    },
  );
  const out = `${run.stdout}${run.stderr}`;
  expect(
    run.status === 0,
    `runner exited ${run.status}, expected 0: a gate that did not run is not a failure`,
  );
  expect(
    /\[run \] Code scanning \(CodeQL\) \.\.\. NOT RUN/.test(out),
    'the gate line does not say NOT RUN',
  );
  expect(
    /0 of \d+ gates green, 1 NOT RUN \(code-scanning\)/.test(out),
    `summary does not say "0 of N gates green, 1 NOT RUN (code-scanning)":\n${out.slice(-600)}`,
  );
  expect(!/1 of \d+ gates green/.test(out), 'summary counts the skipped gate as green');
  const reports = readdirSync(join(evidence, 'beta', 'gates')).filter((f) =>
    f.endsWith('-selftest.json'),
  );
  expect(reports.length === 1, `expected one report, found ${reports.length}`);
  const report = JSON.parse(readFileSync(join(evidence, 'beta', 'gates', reports[0]), 'utf8'));
  expect(
    JSON.stringify(report.gates.notRun) === '["code-scanning"]',
    `gates.notRun is ${JSON.stringify(report.gates.notRun)}`,
  );
  expect(report.gates.ran.length === 0, `gates.ran is ${JSON.stringify(report.gates.ran)}`);
  expect(
    report.results[0].status === 'not-run' && report.results[0].passed === false,
    'the result is not marked not-run',
  );
  expect(
    report.counts.green === 0 && report.counts.notRun === 1,
    `counts are ${JSON.stringify(report.counts)}`,
  );
});

control('--require-complete fails a run whose verdict is short of pass: here pass-partial', () => {
  const run = spawnSync(
    process.execPath,
    [
      join(here, 'verify-gate.mjs'),
      '--gates',
      'code-scanning',
      '--phase',
      'selftest-require-complete',
      '--require-complete',
    ],
    { cwd: repoRoot, env, encoding: 'utf8' },
  );
  expect(run.status === 1, `runner exited ${run.status}, expected 1`);
  expect(
    /verdict pass-partial: --require-complete accepts only every gate run and green/.test(
      run.stderr,
    ),
    `stderr does not name the verdict it refused:\n${run.stderr.slice(-400)}`,
  );
});

control('the real runner carries on after a gate that did not run', () => {
  const run = spawnSync(
    process.execPath,
    [
      join(here, 'verify-gate.mjs'),
      '--gates',
      'code-scanning,node',
      '--phase',
      'selftest-carry-on',
    ],
    { cwd: repoRoot, env, encoding: 'utf8' },
  );
  const out = `${run.stdout}${run.stderr}`;
  expect(run.status === 0, `runner exited ${run.status}`);
  expect(/\[run \] Node runtime preflight \.\.\. pass/.test(out), 'the gate after it never ran');
  expect(
    /1 of \d+ gates green, 1 NOT RUN \(code-scanning\)/.test(out),
    `summary was:\n${out.slice(-400)}`,
  );
  const name = readdirSync(join(evidence, 'beta', 'gates')).find((f) =>
    f.endsWith('-selftest-carry-on.json'),
  );
  const report = JSON.parse(readFileSync(join(evidence, 'beta', 'gates', name), 'utf8'));
  expect(
    JSON.stringify(report.gates.ran) === '["node"]',
    `gates.ran is ${JSON.stringify(report.gates.ran)}`,
  );
});

control(
  'the summary of a full run with code scanning not run says "28 green, 1 NOT RUN", never "all 29 green"',
  () => {
    const results = [...ids(28).map(pass), notRun('code-scanning')];
    const { verdict, lines } = summarize({ total: 29, notRequested: [], skipped: [], results });
    expect(verdict === 'pass-incomplete', `verdict ${verdict}`);
    expect(
      lines[0] === 'verdict  PASS (INCOMPLETE) — 28 green, 1 NOT RUN (code-scanning)',
      `line was: ${lines[0]}`,
    );
    expect(!lines.some((l) => /all \d+ gates green/.test(l)), 'a line still says all gates green');
  },
);

control(
  'the summary of a full run where every gate ran green still says "all 29 gates green"',
  () => {
    const { verdict, lines } = summarize({
      total: 29,
      notRequested: [],
      skipped: [],
      results: ids(29).map(pass),
    });
    expect(
      verdict === 'pass' && lines[0] === 'verdict  PASS — all 29 gates green',
      `${verdict}: ${lines[0]}`,
    );
  },
);

control(
  'a partial run names not-requested gates as NOT REQUESTED, and counts only green ones',
  () => {
    const { verdict, lines } = summarize({
      total: 29,
      notRequested: ids(27),
      skipped: [],
      results: [pass('a'), notRun('code-scanning')],
    });
    expect(verdict === 'pass-partial', `verdict ${verdict}`);
    expect(
      lines[0] === 'verdict  PASS (PARTIAL) — 1 of 29 gates green, 1 NOT RUN (code-scanning)',
      `line was: ${lines[0]}`,
    );
    expect(
      lines.some((l) => l.startsWith('         NOT REQUESTED: g1, g2')),
      'no NOT REQUESTED line',
    );
  },
);

control('a failure after a not-run gate fails, and still names the gate that did not run', () => {
  const { verdict, lines } = summarize({
    total: 29,
    notRequested: [],
    skipped: ['z'],
    results: [notRun('code-scanning'), fail('lint')],
  });
  expect(verdict === 'fail', `verdict ${verdict}`);
  expect(lines[0] === 'verdict  FAIL — first failing gate: lint', `line was: ${lines[0]}`);
  expect(
    lines.some((l) => l === 'not run  code-scanning'),
    'the not-run gate is not named',
  );
});

control('only a gate declared able to report it is not-run on the not-run exit code', () => {
  expect(classify({ mayNotRun: true }, 0) === 'pass', 'exit 0');
  expect(
    classify({ mayNotRun: true }, NOT_RUN_EXIT_CODE) === 'not-run',
    'declared gate, not-run code',
  );
  expect(classify({}, NOT_RUN_EXIT_CODE) === 'fail', 'undeclared gate, not-run code must fail');
  expect(classify({ mayNotRun: true }, 1) === 'fail', 'exit 1');
  expect(classify({ mayNotRun: true }, null) === 'fail', 'killed by a signal');
});

/* `platformSensitive` decides what a cross-platform run covers, so the declaration itself needs
 * controls. Read out of the source rather than imported, because `verify-gate.mjs` is a script
 * that runs gates on import — the same reason the controls above drive it as a subprocess. */
const gateSource = readFileSync(join(here, 'verify-gate.mjs'), 'utf8');
const gateBlock = gateSource.slice(
  gateSource.indexOf('const ALL_GATES = ['),
  gateSource.indexOf('\n];', gateSource.indexOf('const ALL_GATES = [')),
);
const declaredIds = [...gateBlock.matchAll(/\n\s+id: '([a-z0-9-]+)',/g)].map((m) => m[1]);
const declarations = [...gateBlock.matchAll(/\n\s+platformSensitive: (true|false),/g)].map(
  (m) => m[1],
);

control('every gate declares platformSensitive', () => {
  expect(
    declaredIds.length === declarations.length,
    `${declaredIds.length} gates but ${declarations.length} declarations — a gate without one ` +
      'would be included or excluded from the Windows run by accident',
  );
  expect(declaredIds.length > 0, 'found no gates, so this control asserted nothing');
});

control('a gate missing the declaration is refused, not defaulted', () => {
  /* The anti-drift property, exercised rather than asserted: strip one declaration and the
   * harness must refuse to run at all. Without this, a new gate silently inherits a default and
   * the cross-platform run quietly stops covering it. */
  const mutated = gateSource.replace(/\n(\s+)platformSensitive: (?:true|false),/, '');
  /* Beside the original, not in a temp directory: this script imports `./gate-summary.mjs` and
   * `../collect-evidence/evidence-path.mjs`, so a copy anywhere else dies on module resolution
   * with exit 1 and the control would pass for the wrong reason. It did, on the first run. */
  const copy = join(here, `verify-gate.platform-control-${process.pid}.mjs`);
  try {
    writeFileSync(copy, mutated);
    const run = spawnSync(process.execPath, [copy, '--gates', 'node', '--phase', 'selftest'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    });
    expect(run.status === 2, `expected exit 2, got ${run.status}`);
    expect(
      /without a `platformSensitive` declaration/.test(`${run.stdout}${run.stderr}`),
      `message did not name the problem: ${`${run.stdout}${run.stderr}`.trim().slice(0, 200)}`,
    );
  } finally {
    rmSync(copy, { force: true });
  }
});

control('--platform-sensitive selects exactly the declared set, nothing more or less', () => {
  /* Compares the actual selection against the declarations, via `--list-gates`. The previous
   * version of this control passed `--gates node` to stay cheap — which OVERRIDES the flag, so it
   * exercised precedence only and would have passed with the platform filter inverted or ignored
   * entirely. Review caught it, and it is the third hollow control of mine on this branch. */
  const expected = declaredIds
    .filter((id, i) => declarations[i] === 'true' || id === 'code-scanning')
    .sort();
  const run = spawnSync(
    process.execPath,
    [join(here, 'verify-gate.mjs'), '--platform-sensitive', '--list-gates'],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  expect(run.status === 0, `--list-gates exited ${run.status}: ${run.stderr.trim().slice(0, 160)}`);
  const actual = run.stdout.trim().split('\n').filter(Boolean).sort();
  expect(
    actual.join(',') === expected.join(','),
    `selection differs.\n      only selected: ${actual.filter((id) => !expected.includes(id))}` +
      `\n      only expected: ${expected.filter((id) => !actual.includes(id))}`,
  );
  expect(
    actual.length < declaredIds.length,
    `selected all ${declaredIds.length} gates, so the flag narrowed nothing`,
  );
});

control('an explicit --gates still overrides --platform-sensitive', () => {
  const run = spawnSync(
    process.execPath,
    [join(here, 'verify-gate.mjs'), '--platform-sensitive', '--gates', 'node', '--list-gates'],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  expect(run.stdout.trim() === 'node', `selected ${JSON.stringify(run.stdout.trim())}`);
});

control('--require-scope-complete passes a scoped run that is all green', () => {
  /* The bug this PR shipped before review caught it: the job used `--require-complete`, which a
   * filtered run can never satisfy, so Windows would have failed on every commit with every
   * selected gate green. */
  const run = spawnSync(
    process.execPath,
    [
      join(here, 'verify-gate.mjs'),
      '--gates',
      'node',
      '--require-scope-complete',
      '--phase',
      'selftest',
    ],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  expect(
    run.status === 0,
    `exit ${run.status}: ${`${run.stdout}${run.stderr}`.trim().split('\n').slice(-2).join(' | ')}`,
  );
});

control('--require-scope-complete rejects a selected gate that did not run', () => {
  /* The green-path control above would still exit 0 with the whole enforcement block deleted, so
   * on its own it proves nothing. `BETA_SKIP_CODE_SCANNING` in this suite's env makes
   * `code-scanning` report NOT RUN, which is the shortfall the flag exists to catch. */
  const run = spawnSync(
    process.execPath,
    [
      join(here, 'verify-gate.mjs'),
      '--gates',
      'code-scanning',
      '--require-scope-complete',
      '--phase',
      'selftest',
    ],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  const out = `${run.stdout}${run.stderr}`;
  expect(run.status === 1, `expected exit 1 for a skipped selected gate, got ${run.status}`);
  expect(
    /--require-scope-complete: 1 selected gate\(s\) did not run green: code-scanning/.test(out),
    `diagnostic did not name the shortfall: ${out.trim().split('\n').slice(-3).join(' | ')}`,
  );
});

control('--require-complete stays strict about a scoped run', () => {
  // Not loosened by this change: its strictness is the guard against claiming completeness.
  const run = spawnSync(
    process.execPath,
    [join(here, 'verify-gate.mjs'), '--gates', 'node', '--require-complete', '--phase', 'selftest'],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  expect(run.status === 1, `expected exit 1 for a partial scope, got ${run.status}`);
});

/* The scope resolution (G3). `--print-scope` prints the gates' own `argv` arrays, so these read
 * the command that would run rather than a second derivation of the decision. Each asserts the
 * mode it does NOT expect is absent as well: `affected` and `run-many` both contain the target
 * name, so matching only the one you want passes under either. */
function printScope(baseRef) {
  const run = spawnSync(
    process.execPath,
    [join(here, 'verify-gate.mjs'), '--base', baseRef, '--print-scope'],
    { cwd: repoRoot, encoding: 'utf8', env },
  );
  expect(
    run.status === 0,
    `--print-scope exited ${run.status}: ${run.stderr.trim().slice(0, 200)}`,
  );
  return run.stdout;
}

const SCOPED = ['lint', 'test', 'build', 'typecheck'];

control('a base that resolves to HEAD runs run-many --all, not affected', () => {
  /* The defect: on `main`, `base` is `origin/main` is HEAD, so `nx affected` matched zero
   * projects and lint/test/build/typecheck passed in seconds having checked nothing. */
  const out = printScope('HEAD');
  expect(/^scope all$/m.test(out), `scope line was not "all":\n${out}`);
  for (const target of SCOPED) {
    expect(
      new RegExp(`^${target} npx nx run-many -t ${target} --all$`, 'm').test(out),
      `${target} is not scoped to the whole workspace:\n${out}`,
    );
  }
  expect(!/nx affected/.test(out), `a gate is still on affected with the base at HEAD:\n${out}`);
});

control('a base that differs from HEAD still runs affected', () => {
  /* The other half, and the one that keeps the inner loop fast. Without it the control above
   * would pass with `scoped()` wired to `--all` unconditionally, which would make every branch
   * gate a full-workspace run. */
  const parent = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: repoRoot, encoding: 'utf8' });
  expect(parent.status === 0, 'no HEAD~1 in this clone, so this control cannot run');
  const sha = parent.stdout.trim();
  const out = printScope(sha);
  expect(/^scope affected$/m.test(out), `scope line was not "affected":\n${out}`);
  for (const target of SCOPED) {
    expect(
      new RegExp(`^${target} npx nx affected -t ${target} --base=${sha}$`, 'm').test(out),
      `${target} is not scoped to the diff:\n${out}`,
    );
  }
  expect(!/run-many/.test(out), `a gate widened to the workspace off HEAD:\n${out}`);
});

control('the scope is decided by resolved SHA, not by the ref name', () => {
  /* `--base=main` on `main` and `--base=origin/main` on a freshly pulled `main` are the same
   * situation as `--base=HEAD`, and only a SHA comparison sees that. Driven through the SHA of
   * HEAD, which is a different string from "HEAD" and must reach the same verdict. */
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  expect(sha.status === 0, 'git rev-parse HEAD failed');
  const out = printScope(sha.stdout.trim());
  expect(/^scope all$/m.test(out), `an explicit HEAD SHA read as a diff:\n${out}`);
  /* The commands too, not only the `scope` line. `scope` is computed beside the argv rather than
   * from it, so asserting the line alone passes with the gates still wired to `affected` — which
   * it did, when this control was first written that way. */
  expect(
    SCOPED.every((t) => new RegExp(`^${t} npx nx run-many -t ${t} --all$`, 'm').test(out)),
    `the scope line said "all" while a gate stayed on the diff:\n${out}`,
  );
});

control('an annotated tag on HEAD is recognised as HEAD, not as a diff', () => {
  /* `git rev-parse <annotated-tag>` returns the TAG OBJECT's SHA, not the commit's, so comparing
   * unpeeled made `--base=<tag-at-HEAD>` take the `affected` path — and Nx, which peels the ref
   * itself, then diffed HEAD against HEAD and ran zero projects. The vacuous pass, reachable
   * through a valid base ref. Review found it on PR #544.
   *
   * Driven against a real annotated tag, because the behaviour under test is git's and a fixture
   * that fakes `rev-parse` would prove nothing.
   *
   * A throwaway repository with one commit, not a clone of this one: `--print-scope` makes exactly
   * two git calls, both `rev-parse`, so that is all the subject needs. The runner is THIS working
   * tree's script, run with its cwd inside the fixture — a clone would carry whatever is
   * committed, which is how the first version of this control failed against its own fix. */
  const dir = mkdtempSync(join(tmpdir(), 'verify-gate-tag-'));
  try {
    const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    for (const args of [
      ['init', '--quiet', '--initial-branch=main'],
      ['config', 'user.email', 'selftest@example.invalid'],
      ['config', 'user.name', 'Verify Gate Selftest'],
      ['config', 'commit.gpgsign', 'false'],
    ]) {
      expect(run(args).status === 0, `git ${args[0]} failed in the fixture`);
    }
    writeFileSync(join(dir, 'f.txt'), 'x');
    expect(run(['add', '-A']).status === 0, 'git add failed in the fixture');
    expect(
      run(['commit', '--quiet', '-m', 'one']).status === 0,
      'git commit failed in the fixture',
    );
    const tagged = run(['tag', '-a', 'vg-selftest-tag', '-m', 'at HEAD']);
    expect(tagged.status === 0, `tag failed: ${tagged.stderr.trim().slice(0, 200)}`);

    // The premise: unpeeled, the tag does NOT look like HEAD. If git ever changed that, this
    // control would be asserting nothing, so it is checked rather than assumed.
    const unpeeled = run(['rev-parse', 'vg-selftest-tag']).stdout.trim();
    const head = run(['rev-parse', 'HEAD']).stdout.trim();
    expect(
      unpeeled !== head,
      'rev-parse on an annotated tag already returns the commit, so this control has no subject',
    );

    const scope = spawnSync(
      process.execPath,
      [join(here, 'verify-gate.mjs'), '--base', 'vg-selftest-tag', '--print-scope'],
      { cwd: dir, encoding: 'utf8', env },
    );
    expect(
      scope.status === 0,
      `--print-scope exited ${scope.status}: ${scope.stderr.slice(0, 200)}`,
    );
    expect(/^scope all$/m.test(scope.stdout), `a tag on HEAD was read as a diff:\n${scope.stdout}`);
    expect(
      !/nx affected/.test(scope.stdout),
      `a gate stayed on affected with the base peeling to HEAD:\n${scope.stdout}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

control('every gate built on the affected set declares itself scoped', () => {
  /* The anti-drift property. A fifth `nx affected` gate added without `scoped: true` would be
   * vacuous on `main` exactly as these four were, and `--print-scope` would not show it — so the
   * controls above would stay green while the hole reopened. */
  const scopedIds = [...gateBlock.matchAll(/\n\s+id: '([a-z0-9-]+)',[\s\S]*?\n\s{2}\},/g)]
    .filter((m) => /scoped: true/.test(m[0]))
    .map((m) => m[1]);
  expect(
    scopedIds.join(',') === SCOPED.join(','),
    `gates declaring \`scoped: true\` are ${JSON.stringify(scopedIds)}, expected ${JSON.stringify(SCOPED)}`,
  );
  const nxGates = [...gateBlock.matchAll(/\n\s+id: '([a-z0-9-]+)',[\s\S]*?\n\s{2}\},/g)]
    .filter((m) => /argv: \[\s*'nx',/.test(m[0]) || /argv: scoped\(/.test(m[0]))
    .map((m) => m[1]);
  expect(
    nxGates.join(',') === SCOPED.join(','),
    `gate(s) run Nx without declaring their scope: ${nxGates.filter((id) => !SCOPED.includes(id))}`,
  );
});

control('the cross-platform selection keeps the gate that waits for CodeQL', () => {
  /* `code-scanning` is not platform-sensitive and says so. It is still selected, because this is
   * the only job that waits for CodeQL on the revision — dropping it would remove CI's only
   * enforcement of alert severity and allowlist expiry rather than relocate it. */
  const block = gateBlock.slice(gateBlock.indexOf("id: 'code-scanning'"));
  const descriptor = block.slice(0, block.indexOf('\n  },'));
  expect(/platformSensitive: false/.test(descriptor), 'code-scanning should declare false');
  expect(
    /requiresCodeqlWait: true/.test(descriptor),
    'code-scanning must declare why it is still selected, or the selection silently drops it',
  );
  expect(
    /g\.platformSensitive \|\| g\.requiresCodeqlWait/.test(gateSource),
    'the selection must honour requiresCodeqlWait, not only platformSensitive',
  );
});

rmSync(evidence, { recursive: true, force: true });

for (const c of controls)
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
const failed = controls.filter((c) => !c.ok).length;
console.log(
  failed
    ? `\nverify-gate selftest: FAIL — ${failed} of ${controls.length} control(s) failed.`
    : `\nverify-gate selftest: pass — ${controls.length} control(s).`,
);
process.exit(failed ? 1 : 0);
