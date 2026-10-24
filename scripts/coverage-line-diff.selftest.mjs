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
git('add', '.');
git('commit', '-qm', 'one');
const ONE = git('rev-parse', 'HEAD');
writeFileSync(join(repo, 'src/b.ts'), 'export function g() {\n  return 3;\n}\n');
git('commit', '-qam', 'two');
const TWO = git('rev-parse', 'HEAD');

const at = (line) => ({ start: { line, column: 0 }, end: { line, column: 20 } });
/** One file: a function spanning lines 1-3 called `calls` times, its body statement hit `hits` times. */
const file = (name, calls, hits) => ({
  [join(repo, 'src', name)]: {
    path: join(repo, 'src', name),
    statementMap: { 0: at(1), 1: at(2) },
    s: { 0: 1, 1: hits },
    fnMap: {
      0: { name: name[0], loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } } },
    },
    f: { 0: calls },
    branchMap: {},
    b: {},
  },
});

function run(label, beforeReport, afterReport, afterRev, expectExit) {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-line-diff-run-'));
  for (const [side, report] of [
    ['before', beforeReport],
    ['after', afterReport],
  ]) {
    mkdirSync(join(dir, side, 'p'), { recursive: true });
    writeFileSync(join(dir, side, 'p', 'coverage-final.json'), JSON.stringify(report));
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
  return ok;
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
  // POSITIVE: the earlier run credited line 2 although its own data says the function never ran.
  run(
    'a line credited by a function that never ran is not a loss',
    file('a.ts', 0, 1),
    file('a.ts', 0, 0),
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
const failed = results.filter((ok) => !ok).length;
console.log(
  `coverage-line-diff selftest: ${results.length - failed}/${results.length} controls behaved (1 negative, 3 positive)`,
);
process.exit(failed ? 1 : 0);
