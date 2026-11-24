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
 * Two more guard the ratchet's own honesty: a `noStatements` file that gains code fails, and
 * `--update-baseline` does not lower an entry the gate never reported as fallen.
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

/** Writes the report a passing run leaves: `covered` of `total` statements hit, one per line. */
function writeReport(root, name, source, { total = 1, covered = total } = {}) {
  const ids = [...Array(total).keys()];
  const at = (i) => ({ start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 20 } });
  const data = {
    [source]: {
      path: source,
      statementMap: Object.fromEntries(ids.map((i) => [i, at(i)])),
      s: Object.fromEntries(ids.map((i) => [i, i < covered ? 1 : 0])),
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

test('a report that does not parse is reported as that alone, not also as stale', () => {
  const root = workspace();
  writeFileSync(reportPath(root, 'shared-queues'), '{"truncated');
  // Older than its source, so the age check would call it stale if it ran first.
  const past = new Date(Date.now() - 7_200_000);
  utimesSync(reportPath(root, 'shared-queues'), past, past);
  const r = gate(root, '--expect-all');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /coverage-gate: FAIL — 1 project\(s\) with no coverage report\./);
  assert.doesNotMatch(r.out, /STALE REPORTS/);
});

test('an allowlist entry is beyond judging only under a Vitest project that wrote no report', () => {
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
  // The same for dated debt under `files`, which has its own filter.
  allow(unreportedRoot, {
    files: { 'libs/shared-queues/src/lib.ts': { until: '2099-01-01', why: 'fixture' } },
  });
  const dated = gate(unreportedRoot, '--expect-all');
  assert.equal(dated.code, 1, dated.out);
  assert.doesNotMatch(dated.out, /Stale allowlist/);

  // An entry under a project this gate never measures can never be unmeasured, so it stays stale.
  const karma = join(unreportedRoot, 'libs', 'karma-app');
  mkdirSync(join(karma, 'src'), { recursive: true });
  writeFileSync(
    join(karma, 'project.json'),
    JSON.stringify({ name: 'karma-app', targets: { test: { executor: 'nx:run-commands' } } }),
  );
  writeFileSync(join(karma, 'src', 'main.ts'), 'export type T = 1;\n');
  allow(unreportedRoot, { noStatements: { 'libs/karma-app/src/main.ts': 'fixture' } });
  const underKarma = gate(unreportedRoot);
  assert.equal(underKarma.code, 1, underKarma.out);
  assert.match(
    underKarma.out,
    /Stale allowlist — 1 entr\(ies\)[^\n]*\n {4}libs\/karma-app\/src\/main\.ts/,
  );

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

test('a `noStatements` entry whose file gains code fails, read from the source', () => {
  const root = workspace();
  const barrel = join(root, 'libs', 'shared-queues', 'src', 'index.ts');
  const past = new Date(Date.now() - 3_600_000);
  const write = (text) => {
    writeFileSync(barrel, text);
    utimesSync(barrel, past, past);
  };
  writeFileSync(
    join(root, '.ai', 'state', 'coverage-uninstrumented-allowlist.json'),
    JSON.stringify({ noStatements: { 'libs/shared-queues/src/index.ts': 'barrel' } }),
  );
  // No spec imports it, so the report never lists it, whatever it holds. A barrel and a
  // constant table are what the exemption is for.
  write("export * from './lib';\nexport const T = Object.freeze([{ a: 1 }]);\n");
  const exempt = gate(root, '--expect-all');
  assert.equal(exempt.code, 0, exempt.out);

  write("export * from './lib';\nexport function f() {\n  return 1;\n}\n");
  const code = gate(root, '--expect-all');
  assert.equal(code.code, 1, code.out);
  assert.match(
    code.out,
    /Not statement-free — 1 `noStatements` entr\(ies\)[^\n]*\n {4}libs\/shared-queues\/src\/index\.ts {2}\(top-level FunctionDeclaration, line 2\)/,
  );
  assert.match(code.out, /FAIL — 1 `noStatements` entr\(ies\) holding code\./);
  assert.equal(JSON.parse(gate(root, '--expect-all', '--json').out).ok, false);

  // From the source, so a run that did not measure the project still sees it.
  rmSync(reportPath(root, 'shared-queues'));
  const partial = gate(root);
  assert.equal(partial.code, 1, partial.out);
  assert.match(partial.out, /Not statement-free/);
});

/** A workspace whose `shared-queues` is baselined at `was` and measured at `now`. */
function measuredAgainst(was, now) {
  const root = workspace();
  const projects = baselineOf(root);
  projects['shared-queues'] = was;
  writeFileSync(join(root, '.ai', 'state', 'coverage-baseline.json'), JSON.stringify({ projects }));
  remeasure(root, now);
  return root;
}
const remeasure = (root, now) =>
  writeReport(root, 'shared-queues', join(root, 'libs', 'shared-queues', 'src', 'lib.ts'), now);
const entry = (sCovered, sTotal) => ({
  ...ENTRY,
  lines: Math.round((sCovered / sTotal) * 10000) / 100,
  statements: Math.round((sCovered / sTotal) * 10000) / 100,
  sCovered,
  sTotal,
});
function update(root) {
  const r = gate(root, '--update-baseline');
  assert.equal(r.code, 0, r.out);
  return { out: r.out, entry: baselineOf(root)['shared-queues'] };
}

test('--update-baseline keeps a fall within the tolerance, and records a rise or an expansion', () => {
  // 99.9% -> 99.7% on the same code: noise the gate passes and does not mention. The whole entry
  // stays, counts included.
  const fall = update(measuredAgainst(entry(999, 1000), { total: 1000, covered: 997 }));
  assert.deepEqual(fall.entry, entry(999, 1000));
  assert.match(
    fall.out,
    /kept 1 whose fall is within the 0\.5pp tolerance: shared-queues \(-0\.2pp; entry kept, counts 999\/1000\)/,
  );

  // 99.5% -> 99.7%: a rise is recorded, however small.
  const rise = update(measuredAgainst(entry(995, 1000), { total: 1000, covered: 997 }));
  assert.equal(rise.entry.lines, 99.7);

  // 100% of 100 -> 99% of 1000: past the tolerance, but more is covered than before. The gate
  // reports that as `expanded` and asks for this write, so it is recorded.
  const expansion = update(measuredAgainst(entry(100, 100), { total: 1000, covered: 990 }));
  assert.equal(expansion.entry.lines, 99);
  assert.equal(expansion.entry.sTotal, 1000);
});

test('a fall kept on a grown denominator moves its counts, so a later deletion still fails', () => {
  // 90% of 1000 -> the code doubles to 1795 of 2000 (-0.25pp): the percentage is kept...
  const root = measuredAgainst(entry(900, 1000), { total: 2000, covered: 1795 });
  const kept = update(root);
  assert.equal(kept.entry.lines, 90);
  assert.deepEqual([kept.entry.sCovered, kept.entry.sTotal], [1795, 2000]);
  assert.match(
    kept.out,
    /shared-queues \(-0\.25pp; percentages kept, counts moved to 1795\/2000\)/,
  );

  // ...and when tests are then deleted, down to 1700 of 2000, it is a regression. With the counts
  // frozen at 900/1000 the gate called this "covered 900 -> 1700, not a regression".
  remeasure(root, { total: 2000, covered: 1700 });
  const r = gate(root, '--expect-all');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /1 project\(s\) lost coverage:\n {2}shared-queues {2}90% -> 85%/);
  assert.doesNotMatch(r.out, /Percentage fell but coverage did not/);
});

test('--update-baseline refuses to write from a full run that left a project unmeasured', () => {
  const root = workspace();
  const file = join(root, '.ai', 'state', 'coverage-baseline.json');
  const before = readFileSync(file, 'utf8');
  rmSync(reportPath(root, 'shared-queues'));
  const full = gate(root, '--update-baseline', '--expect-all');
  assert.equal(full.code, 1, full.out);
  assert.match(full.out, /FAIL — 1 project\(s\) with no coverage report; .* left as it was\./);
  assert.equal(readFileSync(file, 'utf8'), before, 'the baseline must not be rewritten at all');

  // `sync-derived.mjs` measures only the projects a merge disagreed on, then records.
  const partial = gate(root, '--update-baseline');
  assert.equal(partial.code, 0, partial.out);
  assert.deepEqual(baselineOf(root)['shared-queues'], ENTRY);
});

test('a full run fails a project whose report this gate cannot look for', () => {
  // An `@nx/vitest:test` target whose `reportsDirectory` lives only in vite.config.
  const root = workspace();
  addProject(root, 'shared-home');
  const json = join(root, 'libs', 'shared-home', 'project.json');
  writeFileSync(
    json,
    JSON.stringify({ name: 'shared-home', targets: { test: { executor: '@nx/vitest:test' } } }),
  );
  const unplaced = gate(root, '--expect-all');
  assert.equal(unplaced.code, 1, unplaced.out);
  assert.match(
    unplaced.out,
    /shared-home {2}its @nx\/vitest:test target names no reportsDirectory/,
  );
  assert.equal(gate(root).code, 0);

  // A baselined project whose test target is not Vitest at all: no run can check its entry.
  const karma = workspace();
  addProject(karma, 'nuxeo-ui');
  writeFileSync(
    join(karma, 'libs', 'nuxeo-ui', 'project.json'),
    JSON.stringify({ name: 'nuxeo-ui', targets: { test: { executor: 'nx:run-commands' } } }),
  );
  assert.equal(gate(karma, '--expect-all').code, 0, 'an unbaselined Karma project has no report');
  const projects = baselineOf(karma);
  projects['nuxeo-ui'] = ENTRY;
  writeFileSync(
    join(karma, '.ai', 'state', 'coverage-baseline.json'),
    JSON.stringify({ projects }),
  );
  for (const args of [['--expect-all'], []]) {
    const r = gate(karma, ...args);
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /nuxeo-ui {2}its test target is nx:run-commands, which this gate does not read/,
    );
  }
});

test("renaming a baselined project's test target does not prune it from the ratchet", () => {
  // Rename `test` to `unit-test` and lose the report: it used to read as orphaned, and
  // `--update-baseline --expect-all` pruned it with exit 0, after which every run passed.
  const root = workspace();
  const json = join(root, 'libs', 'shared-queues', 'project.json');
  const project = JSON.parse(readFileSync(json, 'utf8'));
  writeFileSync(
    json,
    JSON.stringify({ name: project.name, targets: { 'unit-test': project.targets.test } }),
  );
  rmSync(reportPath(root, 'shared-queues'));
  // Its allowlist entry is not "stale" either: restoring the target makes it true again.
  writeFileSync(
    join(root, '.ai', 'state', 'coverage-uninstrumented-allowlist.json'),
    JSON.stringify({ noStatements: { 'libs/shared-queues/src/lib.ts': 'fixture' } }),
  );
  const file = join(root, '.ai', 'state', 'coverage-baseline.json');
  const before = readFileSync(file, 'utf8');

  const write = gate(root, '--update-baseline', '--expect-all');
  assert.equal(write.code, 1, write.out);
  assert.match(write.out, /shared-queues {2}it has no `test` target/);
  assert.match(write.out, /1 baselined project\(s\) no run can measure; .* left as it was\./);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.doesNotMatch(write.out, /orphaned/);
  // Not only a full run's concern: no run of any kind can measure it.
  for (const args of [['--expect-all'], []]) {
    const r = gate(root, ...args);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CANNOT BE MEASURED — 1 baselined project\(s\)/);
    assert.doesNotMatch(r.out, /Stale allowlist/);
  }
});

test('an unknown argument is refused, not ignored', () => {
  // A misspelt `--expect-all` would otherwise make a full run partial again, without a word.
  for (const args of [['--expect-al'], ['--root=/nonexistent'], ['--today']]) {
    const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(`${r.stdout}${r.stderr}`, /unknown argument|needs a value/);
  }
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
  // After npm's `--`: `npm run beta:coverage --expect-all` hands the flag to npm, which drops it
  // as unknown config, and the gate gets no arguments.
  assert.match(
    steps[coverage].run.trim(),
    /^npm run beta:coverage -- (?:--[\w-]+ )*--expect-all(?: --[\w-]+)*$/,
  );
  for (const i of [tests, coverage])
    assert.equal(steps[i].if, undefined, `${steps[i].name} is conditional`);
  assert.notEqual(steps[coverage]['continue-on-error'], true, 'the gate itself must block');
});
