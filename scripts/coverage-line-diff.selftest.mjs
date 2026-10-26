#!/usr/bin/env node
/**
 * Controls for `coverage-line-diff.mjs`: it must exit 1 on a real loss, or its "REAL LOSS 0" means
 * nothing. Builds a throwaway git repository and synthetic istanbul reports under `os.tmpdir()`.
 *
 *   node scripts/coverage-line-diff.selftest.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TOOL = resolve(import.meta.dirname, 'coverage-line-diff.mjs');
const repo = mkdtempSync(join(tmpdir(), 'coverage-line-diff-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'selftest@example.invalid');
git('config', 'user.name', 'selftest');
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src/a.ts'), 'export function f() {\n  return 1;\n}\n');
writeFileSync(join(repo, 'src/b.ts'), 'export function g() {\n  return 2;\n}\n');
writeFileSync(join(repo, 'src/c.ts'), 'export function h(flag) {\n  return flag ? 1 : 2;\n}\n');
writeFileSync(
  join(repo, 'src/d.ts'),
  'export const X = init();\nexport function unused() {\n  return 0;\n}\n',
);
git('add', '.');
git('commit', '-qm', 'one');
const ONE = git('rev-parse', 'HEAD');
writeFileSync(join(repo, 'src/b.ts'), 'export function g() {\n  return 3;\n}\n');
git('commit', '-qam', 'two');
const TWO = git('rev-parse', 'HEAD');

const loc = (sl, sc, el, ec) => ({
  start: { line: sl, column: sc },
  end: { line: el, column: ec },
});
const at = (line) => loc(line, 0, line, 20);

/** A raw istanbul entry for `name`. */
const entry = (name, { statementMap, s, fnMap = {}, f = {}, branchMap = {}, b = {} }) => ({
  [join(repo, 'src', name)]: {
    path: join(repo, 'src', name),
    statementMap,
    s,
    fnMap,
    f,
    branchMap,
    b,
  },
});

/** One file: a function spanning lines 1-3 called `calls` times, its body statement hit `hits` times. */
const file = (name, calls, hits) =>
  entry(name, {
    statementMap: { 0: at(1), 1: at(2) },
    s: { 0: 1, 1: hits },
    fnMap: { 0: { name: name[0], loc: loc(1, 0, 3, 1) } },
    f: { 0: calls },
  });

/**
 * `before` and `after` are a report, or an array of reports for several projects measuring the
 * same file.
 */
function run(label, beforeReport, afterReport, afterRev, expectExit) {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-line-diff-run-'));
  for (const [side, reports] of [
    ['before', beforeReport],
    ['after', afterReport],
  ]) {
    [reports].flat().forEach((report, i) => {
      mkdirSync(join(dir, side, `p${i}`), { recursive: true });
      writeFileSync(join(dir, side, `p${i}`, 'coverage-final.json'), JSON.stringify(report));
    });
  }
  const r = spawnSync(
    process.execPath,
    [
      TOOL,
      '--before',
      join(dir, 'before'),
      '--before-root',
      repo,
      '--before-rev',
      ONE,
      '--after',
      join(dir, 'after'),
      '--after-root',
      repo,
      '--after-rev',
      afterRev,
    ],
    { encoding: 'utf8' },
  );
  const ok = r.status === expectExit;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: exit ${r.status}, expected ${expectExit}`);
  if (!ok) console.log(r.stdout + r.stderr);
  return { ok, negative: expectExit !== 0 };
}

const results = [
  // NEGATIVE: the function ran and covered line 2 before; now it is never called.
  run(
    'a tested function that is no longer called is a real loss',
    file('a.ts', 1, 1),
    file('a.ts', 0, 0),
    ONE,
    1,
  ),
  // NEGATIVE: one project called the function, another did not. The second project's zero must
  // not explain away the first project's execution once both read zero.
  run(
    'a function one project called is judged on every project together',
    [file('a.ts', 1, 1), file('a.ts', 0, 0)],
    [file('a.ts', 0, 0), file('a.ts', 0, 0)],
    ONE,
    1,
  ),
  // NEGATIVE: `return flag ? 1 : 2;` ran before through its first arm. The untaken second arm on
  // the same line says nothing about `return flag`, which no longer runs.
  run(
    "an untaken arm does not explain the rest of the arm's line",
    entry('c.ts', {
      statementMap: { 0: loc(2, 0, 2, 22) },
      s: { 0: 1 },
      fnMap: { 0: { name: 'h', loc: loc(1, 0, 3, 1) } },
      f: { 0: 1 },
      branchMap: {
        0: { loc: loc(2, 9, 2, 21), locations: [loc(2, 16, 2, 17), loc(2, 20, 2, 21)] },
      },
      b: { 0: [1, 0] },
    }),
    entry('c.ts', {
      statementMap: { 0: loc(2, 2, 2, 22) },
      s: { 0: 0 },
      fnMap: { 0: { name: 'h', loc: loc(1, 0, 3, 1) } },
      f: { 0: 1 },
      branchMap: {
        0: { loc: loc(2, 9, 2, 21), locations: [loc(2, 16, 2, 17), loc(2, 20, 2, 21)] },
      },
      b: { 0: [0, 0] },
    }),
    ONE,
    1,
  ),
  // NEGATIVE: module-load code ran before and does not now. That the file's only function was
  // never called says nothing about code outside it.
  run(
    'module-level code that stopped running is a loss, even beside an unused function',
    entry('d.ts', {
      statementMap: { 0: at(1), 1: at(3) },
      s: { 0: 1, 1: 0 },
      fnMap: { 0: { name: 'unused', loc: loc(2, 0, 4, 1) } },
      f: { 0: 0 },
    }),
    entry('d.ts', {
      statementMap: { 0: at(1), 1: at(3) },
      s: { 0: 0, 1: 0 },
      fnMap: { 0: { name: 'unused', loc: loc(2, 0, 4, 1) } },
      f: { 0: 0 },
    }),
    ONE,
    1,
  ),
  // NEGATIVE: the earlier run did not model the function, so its call count is unknown, and the
  // credit its body statement got stands.
  run(
    'a function the earlier run did not model is not evidence its body never ran',
    entry('a.ts', { statementMap: { 0: at(1), 1: at(2) }, s: { 0: 1, 1: 1 } }),
    file('a.ts', 0, 0),
    ONE,
    1,
  ),
  // NEGATIVE: a file with covered lines before is absent afterwards, so nothing was compared.
  run(
    'a covered file missing from the later reports is an incomplete measurement',
    [file('a.ts', 1, 1), file('d.ts', 0, 0)],
    file('d.ts', 0, 0),
    ONE,
    3,
  ),
  // POSITIVE: a file at 0% before that is absent afterwards had nothing to lose.
  run(
    'an uncovered file missing from the later reports is not a loss',
    [
      entry('a.ts', {
        statementMap: { 0: at(1), 1: at(2) },
        s: { 0: 0, 1: 0 },
        fnMap: { 0: { name: 'f', loc: loc(1, 0, 3, 1) } },
        f: { 0: 0 },
      }),
      file('d.ts', 0, 0),
    ],
    file('d.ts', 0, 0),
    ONE,
    0,
  ),
  // POSITIVE: the earlier run credited line 2 although its own data says the function never ran.
  run(
    'a line credited by a function that never ran is not a loss',
    file('a.ts', 0, 1),
    file('a.ts', 0, 0),
    ONE,
    0,
  ),
  // POSITIVE: only the untaken arm is unexecuted now — the rest of the line is credited to a
  // statement starting on the line above — and that arm was untaken before too.
  run(
    'an arm untaken in both runs is not a loss',
    entry('c.ts', {
      statementMap: { 0: loc(2, 0, 2, 22) },
      s: { 0: 1 },
      fnMap: { 0: { name: 'h', loc: loc(1, 0, 3, 1) } },
      f: { 0: 1 },
      branchMap: {
        0: { loc: loc(2, 9, 2, 21), locations: [loc(2, 16, 2, 17), loc(2, 20, 2, 21)] },
      },
      b: { 0: [1, 0] },
    }),
    entry('c.ts', {
      statementMap: { 0: loc(1, 0, 2, 22), 1: loc(2, 20, 2, 21) },
      s: { 0: 1, 1: 0 },
      fnMap: { 0: { name: 'h', loc: loc(1, 0, 3, 1) } },
      f: { 0: 1 },
      branchMap: {
        0: { loc: loc(2, 9, 2, 21), locations: [loc(2, 16, 2, 17), loc(2, 20, 2, 21)] },
      },
      b: { 0: [1, 0] },
    }),
    ONE,
    0,
  ),
  // POSITIVE: a file changed between the revisions is skipped, whatever its coverage did.
  run(
    'a file changed between the revisions is not compared',
    file('b.ts', 1, 1),
    file('b.ts', 0, 0),
    TWO,
    0,
  ),
  run('identical coverage is not a loss', file('a.ts', 1, 1), file('a.ts', 1, 1), ONE, 0),
];
const failed = results.filter((r) => !r.ok).length;
const negative = results.filter((r) => r.negative).length;
console.log(
  `coverage-line-diff selftest: ${results.length - failed}/${results.length} controls behaved ` +
    `(${negative} negative, ${results.length - negative} positive)`,
);
process.exit(failed ? 1 : 0);
