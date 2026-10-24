#!/usr/bin/env node
/**
 * Did coverage go down, or did the measurement change?
 *
 * For a toolchain change that alters how coverage is counted — Vitest 3 to 4 counted statements
 * per line before and per syntax node after — percentages cannot answer that question. This
 * compares two sets of istanbul `coverage-final.json` files line by line instead: a line is
 * covered when any statement starting on it ran. Only source files identical between the two
 * revisions are compared, so a difference cannot come from the code under test.
 *
 * A line covered before and not after is classified, and only an unexplained one is a loss:
 *   neverRanEither          inside a function or branch arm unexecuted in both runs
 *   contradictedBefore      the earlier run's own function/branch data says it did not execute;
 *                           its whole-line statement credited it anyway
 *   fileNeverInvokedBefore  the earlier run called no function in the file at all
 *   notModelledBefore       inside a function uncalled now that the earlier run did not model
 *   realLoss                anything else — exits 1
 *
 * Not a gate: it needs both runs' reports. `docs/angular-21-migration.md` has the commands.
 *
 *   node scripts/coverage-line-diff.mjs --before <dir> --before-root <checkout> --before-rev <rev>
 *                                       --after <dir>  --after-root <checkout>  --after-rev <rev>
 *                                       [--json <out>]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
for (const k of ['before', 'before-root', 'before-rev', 'after', 'after-root', 'after-rev']) {
  if (!args[k]) {
    console.error(`coverage-line-diff: --${k} is required`);
    process.exit(2);
  }
}

function* reports(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* reports(p);
    else if (e === 'coverage-final.json') yield p;
  }
}

/** repo-relative path -> { project, covered, measured, statements, hit, raw } */
function load(dir, root) {
  const out = new Map();
  for (const f of reports(dir)) {
    const project = relative(dir, f).replace(/\/?coverage-final\.json$/, '') || '.';
    for (const [abs, cov] of Object.entries(JSON.parse(readFileSync(f, 'utf8')))) {
      const rel = relative(root, abs);
      const e = out.get(rel) ?? {
        project,
        covered: new Set(),
        measured: new Set(),
        statements: 0,
        hit: 0,
        raw: [],
      };
      e.raw.push(cov);
      for (const [id, loc] of Object.entries(cov.statementMap)) {
        e.measured.add(loc.start.line);
        e.statements++;
        if (cov.s[id] > 0) {
          e.covered.add(loc.start.line);
          e.hit++;
        }
      }
      out.set(rel, e);
    }
  }
  return out;
}

const before = load(args.before, args['before-root']);
const after = load(args.after, args['after-root']);
const changed = new Set(
  execFileSync(
    'git',
    ['-C', args['after-root'], 'diff', '--name-only', args['before-rev'], args['after-rev']],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean),
);

const lost = [];
const gained = [];
const perProject = {};
const onlyBefore = [];
const onlyAfter = [];
let compared = 0;
let skippedChanged = 0;
for (const [file, b] of before) {
  if (changed.has(file)) {
    skippedChanged++;
    continue;
  }
  const x = after.get(file);
  if (!x) {
    onlyBefore.push(file);
    continue;
  }
  compared++;
  const p = (perProject[b.project] ??= {
    files: 0,
    lostLines: 0,
    gainedLines: 0,
    beforeStatements: 0,
    afterStatements: 0,
    beforeHit: 0,
    afterHit: 0,
  });
  p.files++;
  p.beforeStatements += b.statements;
  p.afterStatements += x.statements;
  p.beforeHit += b.hit;
  p.afterHit += x.hit;
  for (const line of b.covered) {
    if (!x.covered.has(line) && x.measured.has(line)) {
      lost.push([file, line]);
      p.lostLines++;
    }
  }
  for (const line of x.covered) {
    if (!b.covered.has(line) && b.measured.has(line)) {
      gained.push([file, line]);
      p.gainedLines++;
    }
  }
}
for (const file of after.keys()) if (!before.has(file) && !changed.has(file)) onlyAfter.push(file);

const inside = (loc, line) => loc && loc.start.line <= line && line <= loc.end.line;

/** The function or branch arm containing `line` that never ran in this data, or null. */
function unexecuted(entry, line) {
  for (const cov of entry.raw) {
    for (const [id, fn] of Object.entries(cov.fnMap)) {
      if (cov.f[id] === 0 && inside(fn.loc, line))
        return `function ${fn.name || '(anonymous)'}@${fn.loc.start.line}`;
    }
    for (const [id, br] of Object.entries(cov.branchMap)) {
      const arm = br.locations.find((l, i) => cov.b[id][i] === 0 && inside(l, line));
      if (arm) return `branch@${arm.start.line}`;
    }
  }
  return null;
}

/** The innermost function containing `line` that never ran, or null. */
function uncalledFn(entry, line) {
  let best = null;
  for (const cov of entry.raw) {
    for (const [id, fn] of Object.entries(cov.fnMap)) {
      if (
        cov.f[id] === 0 &&
        inside(fn.loc, line) &&
        (!best || fn.loc.start.line >= best.loc.start.line)
      )
        best = fn;
    }
  }
  return best;
}

/** Calls recorded for a function starting at the same place, or undefined when not modelled. */
function callsAt(entry, loc) {
  for (const cov of entry.raw) {
    for (const [id, fn] of Object.entries(cov.fnMap)) {
      if (
        fn.loc.start.line === loc.start.line &&
        Math.abs((fn.loc.start.column ?? 0) - (loc.start.column ?? 0)) <= 2
      )
        return cov.f[id];
    }
  }
  return undefined;
}

const classified = {
  neverRanEither: 0,
  contradictedBefore: 0,
  fileNeverInvokedBefore: 0,
  notModelledBefore: 0,
  notModelledSample: [],
  realLoss: [],
};
for (const [file, line] of lost) {
  const nowWhy = unexecuted(after.get(file), line);
  const thenWhy = unexecuted(before.get(file), line);
  if (nowWhy && thenWhy) {
    classified.neverRanEither++;
    continue;
  }
  if (thenWhy) {
    classified.contradictedBefore++;
    continue;
  }
  // Only module-load code ran in the file before. That code is still covered now, so a line
  // uncovered now is in a body that could not have run then either.
  const fnsBefore = before.get(file).raw.flatMap((c) => Object.keys(c.fnMap).map((id) => c.f[id]));
  if (fnsBefore.length && fnsBefore.every((n) => n === 0)) {
    classified.fileNeverInvokedBefore++;
    continue;
  }
  const fn = uncalledFn(after.get(file), line);
  const then = fn ? callsAt(before.get(file), fn.loc) : null;
  if (fn && then === undefined) {
    classified.notModelledBefore++;
    if (classified.notModelledSample.length < 8)
      classified.notModelledSample.push(`${file}:${line} ${fn.name}`);
    continue;
  }
  classified.realLoss.push(
    `${file}:${line}  (now: ${nowWhy ?? 'statement uncovered'}; before: ${
      then === null ? 'no uncalled function now' : `same function called ${then}x`
    })`,
  );
}

const pct = (h, n) => (n ? ((100 * h) / n).toFixed(2) : '-');
console.log(
  `unchanged files compared: ${compared}; skipped as changed between the revisions: ${skippedChanged}`,
);
console.log(`lines covered before and NOT after (lost): ${lost.length}`);
console.log(`lines covered after and not before (gained): ${gained.length}`);
console.log(
  `files measured before but absent after: ${onlyBefore.length}; absent before, measured after: ${onlyAfter.length}\n`,
);
console.log(
  'project'.padEnd(34),
  'files',
  'stmts before→after',
  ' stmt% before→after',
  ' lost gained',
);
for (const [k, p] of Object.entries(perProject).sort()) {
  console.log(
    k.padEnd(34),
    String(p.files).padStart(5),
    `${p.beforeStatements}→${p.afterStatements}`.padStart(18),
    `${pct(p.beforeHit, p.beforeStatements)}→${pct(p.afterHit, p.afterStatements)}`.padStart(20),
    String(p.lostLines).padStart(5),
    String(p.gainedLines).padStart(6),
  );
}
console.log(`\nneverRanEither         ${classified.neverRanEither}`);
console.log(`contradictedBefore     ${classified.contradictedBefore}`);
console.log(`fileNeverInvokedBefore ${classified.fileNeverInvokedBefore}`);
console.log(`notModelledBefore      ${classified.notModelledBefore}`);
for (const u of classified.notModelledSample) console.log(`  e.g. ${u}`);
console.log(`REAL LOSS              ${classified.realLoss.length}`);
for (const u of classified.realLoss) console.log(`  ${u}`);
if (onlyBefore.length) {
  console.log('\nmeasured before, absent after:');
  for (const f of onlyBefore) console.log(`  ${f}`);
}
if (args.json) {
  writeFileSync(
    args.json,
    JSON.stringify(
      { compared, skippedChanged, classified, lost, gained, onlyBefore, onlyAfter, perProject },
      null,
      2,
    ),
  );
}
process.exit(classified.realLoss.length ? 1 : 0);
