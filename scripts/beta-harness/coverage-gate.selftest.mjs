#!/usr/bin/env node
/**
 * Negative controls for `coverage-gate.mjs`'s full-run check (`--expect-all`).
 *
 * The blind spot these hold shut: SonarCloud runs every Vitest project with `continue-on-error`,
 * Vitest writes no `coverage-final.json` for a project whose tests fail, and the gate read a
 * missing report as "outside the affected set" — so on PR #679 two red projects passed it
 * unnamed. Each control runs the real gate against a three-project fixture workspace under
 * `os.tmpdir()` via `--root`, so it needs no test run and leaves this checkout untouched.
 *
 * Load-bearing: the deleted-report and unbaselined-project controls, which must be red, and the
 * workflow control, which ties SonarCloud's `run-many` to the flag. The partial-run controls are
 * the other direction — the local loop and `sync-derived.mjs` rely on a missing report passing
 * without the flag — so a fix that simply failed every missing report would break them. The
 * allowlist control is both: an unreported project's entries are not stale, a measured one's are.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = join(here, 'coverage-gate.mjs');
const SONAR = join(here, '..', '..', '.github', 'workflows', 'sonarcloud.yml');

/** The two `FLOORS` projects must exist, or every run fails on "the floor guards nothing". */
const PROJECTS = ['satori-components', 'satori-components-satori', 'shared-queues'];
const ENTRY = {
  lines: 100,
  statements: 100,
  branches: 100,
  functions: 100,
  sTotal: 1,
  sCovered: 1,
};

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const reportPath = (root, project) =>
  join(root, 'coverage', 'libs', project, 'coverage-final.json');

/** Adds a Vitest project with one source file and one spec, and no coverage report. */
function addProject(root, name) {
  const dir = join(root, 'libs', name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  const test = {
    executor: '@nx/vitest:test',
    options: { reportsDirectory: `coverage/libs/${name}` },
  };
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name, targets: { test } }));
  const source = join(dir, 'src', 'lib.ts');
  writeFileSync(source, 'export const x = 1;\n');
  writeFileSync(join(dir, 'src', 'lib.spec.ts'), "it('x', () => {});\n");
  // An hour in the past, so a report written now is never older than its source.
  const past = new Date(Date.now() - 3_600_000);
  for (const f of [source, join(dir, 'src', 'lib.spec.ts')]) utimesSync(f, past, past);
  return source;
}

/** Writes the report a passing run leaves: one statement, covered. */
function writeReport(root, name, source) {
  const at = { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } };
  const data = {
    [source]: {
      path: source,
      statementMap: { 0: at },
      s: { 0: 1 },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    },
  };
  mkdirSync(dirname(reportPath(root, name)), { recursive: true });
  writeFileSync(reportPath(root, name), JSON.stringify(data));
}

/** A workspace where every project passed and reported, and every project is baselined. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'coverage-gate-selftest-'));
  roots.push(root);
  for (const p of PROJECTS) writeReport(root, p, addProject(root, p));
  mkdirSync(join(root, '.ai', 'state'), { recursive: true });
  writeFileSync(
    join(root, '.ai', 'state', 'coverage-baseline.json'),
    JSON.stringify({ projects: Object.fromEntries(PROJECTS.map((p) => [p, ENTRY])) }),
  );
  return root;
}

function gate(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const baselineOf = (root) =>
  JSON.parse(readFileSync(join(root, '.ai', 'state', 'coverage-baseline.json'), 'utf8')).projects;

test('a full run in which every project reported passes', () => {
  const r = gate(workspace(), '--expect-all');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Full run \(--expect-all\): all 3 Vitest project\(s\) must report/);
  assert.match(r.out, /coverage-gate: pass/);
});

test('a baselined project with no report fails a full run, and says which and why', () => {
  const root = workspace();
  rmSync(reportPath(root, 'shared-queues'));
  const r = gate(root, '--expect-all');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NO COVERAGE REPORT — 1 Vitest project\(s\)/);
  assert.match(
    r.out,
    /shared-queues {2}no coverage-final\.json \(coverage\/libs\/shared-queues\/coverage-final\.json\), baselined at 100%/,
  );
  assert.match(r.out, /reportOnFailure/);
  assert.match(r.out, /coverage-gate: FAIL — 1 project\(s\) with no coverage report\./);
  // The exact sentence this control exists to keep out of a full run's output.
  assert.doesNotMatch(r.out, /outside the affected set\): shared-queues/);

  // `ok` and the exit code must agree; they have disagreed in this gate before.
  const json = gate(root, '--expect-all', '--json');
  assert.equal(json.code, 1);
  const parsed = JSON.parse(json.out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.expectAll, true);
  assert.deepEqual(
    parsed.missing.map((m) => [m.project, m.why]),
    [['shared-queues', 'no coverage-final.json']],
  );
});

test('the same reports still pass a partial run, which the local loop relies on', () => {
  const root = workspace();
  rmSync(reportPath(root, 'shared-queues'));
  const r = gate(root);
  assert.equal(r.code, 0, r.out);
  assert.match(
    r.out,
    /Partial run: a project with no report is taken to be outside the affected set/,
  );
  assert.match(r.out, /Not measured this run \(outside the affected set\): shared-queues/);
  assert.match(r.out, /re-run with --expect-all/);
});

test('a project with no report and no baseline entry fails a full run too', () => {
  // PR #679's two red projects had no baseline entry yet, so they were not even listed.
  const root = workspace();
  addProject(root, 'shared-notifications');
  const full = gate(root, '--expect-all');
  assert.equal(full.code, 1, full.out);
  assert.match(full.out, /shared-notifications {2}no coverage-final\.json .*, no baseline entry/);
  assert.equal(gate(root).code, 0, 'a partial run cannot tell it from a project that did not run');
});

test('a report that does not parse, or lists no files, is no report', () => {
  for (const [body, why] of [
    ['{"truncated', 'coverage-final.json does not parse'],
    ['{}', 'coverage-final.json lists no files'],
  ]) {
    const root = workspace();
    writeFileSync(reportPath(root, 'shared-queues'), body);
    const r = gate(root, '--expect-all');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`shared-queues {2}${why}`));
  }
});

test('an allowlist entry is called stale only if its project was measured, or its file is gone', () => {
  const allow = (root, body) =>
    writeFileSync(
      join(root, '.ai', 'state', 'coverage-uninstrumented-allowlist.json'),
      JSON.stringify(body),
    );
  // `lib.ts` has a covered statement, so an exemption for it is stale whenever it is measured.
  const covered = { noStatements: { 'libs/shared-queues/src/lib.ts': 'fixture' } };

  // Measured: the check still fires. Without this the fix below could be "never stale".
  const measuredRoot = workspace();
  allow(measuredRoot, covered);
  const measuredRun = gate(measuredRoot, '--expect-all');
  assert.equal(measuredRun.code, 1, measuredRun.out);
  assert.match(
    measuredRun.out,
    /Stale allowlist — 1 entr\(ies\)[^\n]*\n {4}libs\/shared-queues\/src\/lib\.ts/,
  );

  // Not measured: the run cannot say. It used to, and told the reader to delete a true entry.
  const unreportedRoot = workspace();
  allow(unreportedRoot, covered);
  rmSync(reportPath(unreportedRoot, 'shared-queues'));
  const full = gate(unreportedRoot, '--expect-all');
  assert.equal(full.code, 1, full.out);
  assert.match(full.out, /coverage-gate: FAIL — 1 project\(s\) with no coverage report\./);
  assert.doesNotMatch(full.out, /Stale allowlist/);
  const partial = gate(unreportedRoot);
  assert.equal(partial.code, 0, partial.out);

  // A deleted file is stale whether or not its project ran.
  allow(unreportedRoot, {
    files: { 'libs/shared-queues/src/deleted.ts': { until: '2099-01-01', why: 'fixture' } },
  });
  const gone = gate(unreportedRoot);
  assert.equal(gone.code, 1, gone.out);
  assert.match(
    gone.out,
    /Stale allowlist — 1 entr\(ies\)[^\n]*\n {4}libs\/shared-queues\/src\/deleted\.ts/,
  );
});

test('--update-baseline keeps the entry of a project a full run did not measure, and fails', () => {
  const root = workspace();
  rmSync(reportPath(root, 'shared-queues'));
  const full = gate(root, '--update-baseline', '--expect-all');
  assert.equal(full.code, 1, full.out);
  assert.match(full.out, /coverage-gate: FAIL — 1 project\(s\) with no coverage report\./);
  assert.deepEqual(baselineOf(root)['shared-queues'], ENTRY);

  // `sync-derived.mjs` measures only the projects a merge disagreed on, then records.
  const partial = gate(root, '--update-baseline');
  assert.equal(partial.code, 0, partial.out);
  assert.deepEqual(baselineOf(root)['shared-queues'], ENTRY);
});

test('--root cannot be combined with --run, which measures the current checkout', () => {
  const r = gate(workspace(), '--run');
  assert.equal(r.code, 1);
  assert.match(r.out, /--root .* cannot take --run/);
});

test('SonarCloud tests every project, and holds the gate to every project', () => {
  const steps = load(readFileSync(SONAR, 'utf8')).jobs.sonarcloud.steps;
  const tests = steps.findIndex((s) => /\bnx\b.*-t test\b.*--coverage/.test(s.run ?? ''));
  const coverage = steps.findIndex((s) => s.run?.includes('beta:coverage'));
  assert.ok(tests >= 0, 'no Vitest test-with-coverage step');
  assert.ok(coverage > tests, 'the gate must read the reports after the step that writes them');
  // The flag is a claim about the step above, so the two are checked together: `affected` with
  // `--expect-all` fails every unaffected project, and `run-many` without it is the blind spot.
  assert.match(steps[tests].run, /\bnx run-many\b/);
  assert.doesNotMatch(steps[tests].run, /\baffected\b/);
  assert.match(steps[coverage].run, /--expect-all\b/);
  assert.notEqual(steps[coverage]['continue-on-error'], true, 'the gate itself must block');
});
