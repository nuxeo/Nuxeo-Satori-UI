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
 * A line covered before and not after is judged column by column, using each run's own data. A
 * column ran when no uncalled function or untaken branch arm contains it and the innermost
 * statement containing it was hit; it did not run when either of those says so. A line is:
 *   neverRanEither          every column unexecuted now was unexecuted before as well
 *   notMeasuredBefore       the same, except some of those columns the earlier run did not measure
 *   realLoss                some column ran before and is unexecuted now
 *
 * Counters are summed by source location across every report that measured the file, so one
 * project's zero cannot explain away another project's execution. Missing evidence is not
 * evidence: a function the earlier run did not model leaves its statements' credit standing.
 *
 * Exit status: 0 no loss, 1 real loss, 2 usage error, 3 incomplete measurement — an unchanged
 * file with covered lines before is absent from the later reports, so its coverage is unknown.
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

const locKey = (l) => `${l.start.line}:${l.start.column}-${l.end.line}:${l.end.column}`;

/** Add `n` to the counter at `key`, creating it from `make()` the first time. */
function tally(map, key, make, n) {
  const c = map.get(key) ?? { ...make(), hits: 0 };
  c.hits += n ?? 0;
  map.set(key, c);
}

/**
 * repo-relative path -> { project, covered, measured, statements, hit, stmts, fns, arms }
 *
 * `stmts`, `fns` and `arms` are counters keyed by source location and summed over every report
 * that measured the file, so a file two projects measure is judged on both runs together.
 */
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
        stmts: new Map(),
        fns: new Map(),
        arms: new Map(),
      };
      for (const [id, loc] of Object.entries(cov.statementMap)) {
        e.statements++;
        if (cov.s[id] > 0) e.hit++;
        tally(e.stmts, locKey(loc), () => ({ loc }), cov.s[id]);
      }
      for (const [id, fn] of Object.entries(cov.fnMap)) {
        tally(e.fns, locKey(fn.loc), () => ({ loc: fn.loc, name: fn.name }), cov.f[id]);
      }
      for (const [id, br] of Object.entries(cov.branchMap)) {
        br.locations.forEach((loc, i) =>
          tally(
            e.arms,
            `${locKey(br.loc)}#${i}#${locKey(loc)}`,
            () => ({ loc, line: br.loc.start.line }),
            cov.b[id][i],
          ),
        );
      }
      out.set(rel, e);
    }
  }
  for (const e of out.values()) {
    for (const { loc, hits } of e.stmts.values()) {
      e.measured.add(loc.start.line);
      if (hits > 0) e.covered.add(loc.start.line);
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
const incomplete = [];
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
    if (b.covered.size) incomplete.push(`${file} (${b.covered.size} line(s) covered before)`);
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

/** Source lines of an unchanged file; its text is the same in both checkouts. */
const sourceLines = (file) => readFileSync(join(args['after-root'], file), 'utf8').split('\n');

/** The columns [from, to) that `loc` spans on `line`. An unknown column reaches the line's edge. */
function span(loc, line, length) {
  if (loc?.start.line === undefined || loc.end.line === undefined) return null;
  if (line < loc.start.line || line > loc.end.line) return null;
  const from = line === loc.start.line ? (loc.start.column ?? 0) : 0;
  const to = line === loc.end.line ? (loc.end.column ?? length) : length;
  return [from, to];
}

/**
 * What this run's data says about each column of `line`: 'ran', 'not' or null (not measured).
 *
 * A function or branch arm that never executed decides every column inside it, because nothing
 * inside an uncalled function or a skipped arm can have run, whatever a coarser statement says.
 * Otherwise the innermost statement covering the column decides. A called function or a taken
 * arm decides nothing: being entered does not mean every column of it ran.
 */
function columns(entry, line, length) {
  const state = new Array(length).fill(null);
  const paint = (regions, pick) => {
    for (const r of regions) {
      const s = span(r.loc, line, length);
      if (s) for (let c = Math.max(0, s[0]); c < Math.min(length, s[1]); c++) pick(c, r);
    }
  };
  // Innermost statement: the one starting latest, then ending earliest.
  const depth = new Array(length).fill(null);
  const inner = (a, b) =>
    a.loc.start.line !== b.loc.start.line
      ? a.loc.start.line > b.loc.start.line
      : (a.loc.start.column ?? 0) !== (b.loc.start.column ?? 0)
        ? (a.loc.start.column ?? 0) > (b.loc.start.column ?? 0)
        : a.loc.end.line !== b.loc.end.line
          ? a.loc.end.line < b.loc.end.line
          : (a.loc.end.column ?? Infinity) < (b.loc.end.column ?? Infinity);
  paint(entry.stmts.values(), (c, r) => {
    if (!depth[c] || inner(r, depth[c])) depth[c] = r;
  });
  for (let c = 0; c < length; c++) if (depth[c]) state[c] = depth[c].hits > 0 ? 'ran' : 'not';
  const unexecuted = [...entry.fns.values(), ...entry.arms.values()].filter((r) => r.hits === 0);
  paint(unexecuted, (c) => (state[c] = 'not'));
  return state;
}

const classified = {
  neverRanEither: 0,
  notMeasuredBefore: 0,
  realLoss: [],
};
const sources = new Map();
for (const [file, line] of lost) {
  if (!sources.has(file)) sources.set(file, sourceLines(file));
  const text = sources.get(file)[line - 1] ?? '';
  const now = columns(after.get(file), line, text.length);
  const then = columns(before.get(file), line, text.length);
  // A column is lost when the earlier run's data says it ran and this run's says it did not.
  const lostAt = [];
  let unmeasured = false;
  for (let c = 0; c < text.length; c++) {
    if (/\s/.test(text[c]) || now[c] !== 'not') continue;
    if (then[c] === 'ran') lostAt.push(c);
    else if (then[c] === null) unmeasured = true;
  }
  if (lostAt.length) {
    classified.realLoss.push(
      `${file}:${line}:${lostAt[0] + 1}  ran before, unexecuted now: ${JSON.stringify(
        text.slice(lostAt[0], lostAt.at(-1) + 1).trim(),
      )}`,
    );
  } else if (unmeasured) classified.notMeasuredBefore++;
  else classified.neverRanEither++;
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
console.log(`notMeasuredBefore      ${classified.notMeasuredBefore}`);
console.log(`REAL LOSS              ${classified.realLoss.length}`);
for (const u of classified.realLoss) console.log(`  ${u}`);
console.log(`INCOMPLETE             ${incomplete.length}`);
for (const u of incomplete) console.log(`  ${u}`);
if (onlyBefore.length) {
  console.log('\nmeasured before, absent after:');
  for (const f of onlyBefore) console.log(`  ${f}`);
}
if (args.json) {
  writeFileSync(
    args.json,
    JSON.stringify(
      {
        compared,
        skippedChanged,
        classified,
        incomplete,
        lost,
        gained,
        onlyBefore,
        onlyAfter,
        perProject,
      },
      null,
      2,
    ),
  );
}
process.exit(classified.realLoss.length ? 1 : incomplete.length ? 3 : 0);
