#!/usr/bin/env node
/**
 * Type-check every Storybook **stories** file, and the `.storybook/` support files beside them.
 *
 * ## The hole this closes
 *
 * This is the same hole `spec-typecheck.mjs` was built to close, one tsconfig over. Nothing in
 * the pipeline type-checked a `*.stories.ts` file:
 *
 * - Every project's `tsconfig.lib.json` lists `**\/*.stories.ts` and `**\/*.stories.js` in its
 *   `exclude` array, so the `typecheck` gate — which runs the per-project Nx targets, and those
 *   point at `tsconfig.lib.json` — skips them by construction.
 * - Each `tsconfig.spec.json` includes `src/**\/*.spec.ts`, `*.test.ts` and `*.d.ts`, so
 *   `spec-types` does not reach them either.
 * - `lint` parses them, which catches no type error; `test` runs through Vitest, which strips
 *   types through esbuild; `build` never sees a library's stories.
 * - The one tsconfig that *does* include them is `.storybook/tsconfig.json`, and until this gate
 *   no script ran `tsc` against it. Grepping `scripts/beta-harness/*.mjs` for `storybook/tsconfig`
 *   returned nothing.
 *
 * Measured on 2026-11-09: 65 `*.stories.ts` files under `apps/` and `libs/`, covered by two
 * `.storybook/tsconfig.json` files, checked by no gate.
 *
 * ## Why that is not cosmetic
 *
 * Stories here are not decoration. Their `play` functions carry real assertions — a picker
 * returns what was chosen, a date typed in French reads as French — and `scripts/storybook-
 * interactions.mjs` executes them as a gate of its own. A type error in a play function is an
 * assertion that may never have asserted, and the only thing that would have reported it was a
 * person opening the story in a browser.
 *
 * Unlike `spec-types`, this gate lands with no backlog: both configs type-check clean today, so
 * it is a prevention gate and was green the day it was written. What it was *not* green on is a
 * fresh clone — see `generated-inputs.mjs`, because `.storybook/preview.ts` and
 * `.storybook/compodoc.ts` both import the gitignored `documentation.json`.
 *
 * ## Three things it does that `spec-typecheck.mjs` does not
 *
 * 1. **It cannot reuse that script's directory walk.** The walk skips every entry whose name
 *    starts with `.`, and the directory this gate is looking for is `.storybook`. A copy of it
 *    finds nothing at all here. What makes that survivable rather than silent is the refusal
 *    below: finding no config is a failure, never a pass.
 * 2. **A non-zero `tsc` exit fails the gate even when no `error TS` line was matched.** `tsc`
 *    reports a config whose includes match nothing as `error TS18003: No inputs were found`,
 *    printed with no leading file path, so a check that counts `/ error TS\d+:/` lines alone
 *    scores it zero errors and passes having compiled nothing. The exit code is the backstop.
 * 3. **It asserts its own coverage.** Every `*.stories.ts` under `apps/` and `libs/` must appear
 *    in the resolved `files` of one of the discovered configs — read from `tsc --showConfig`,
 *    which expands the `include` globs without compiling. A stories file in a project with no
 *    `.storybook/tsconfig.json`, or excluded from the one it has, fails the gate instead of
 *    quietly not being checked. That is the whole failure mode this gate exists to end, and
 *    without this check the gate would be free to reproduce it one project over.
 *
 * Usage:
 *   node scripts/beta-harness/stories-typecheck.mjs [--root <dir>] [--json]
 *
 * Exit 1 if any stories file fails to type-check, if a stories file is covered by no config, or
 * if no config was found at all.
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { NO_PROGRESS, ensureGeneratedInputs } from './generated-inputs.mjs';
import { spawnToolSync } from './package-command.mjs';

const GATE = 'stories-typecheck';

/**
 * Where `npx tsc` is resolved from — always this repository, never `--root`.
 *
 * A control points `--root` at a miniature repository under `os.tmpdir()`, which has no
 * `node_modules`; spawning `npx tsc` there would send npx to the registry to *download* a
 * compiler. The config path is passed absolute, so the working directory has no say in what gets
 * compiled.
 */
const HARNESS_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Declared above `ROOT` on purpose: `ROOT`'s validation reads it, and a `const` referenced from
 * an initializer that runs before its own declaration throws a `ReferenceError` out of the
 * temporal dead zone — which surfaces as a stack trace and reads as a broken gate. The same
 * mistake has already been made once in `extension-reference-drift.mjs`, on its alias path.
 */
const SOURCE_ROOTS = ['apps', 'libs'];

/**
 * The repository to inspect. `--root <dir>` overrides it, following `dependency-tree.mjs` and
 * `extension-reference-drift.mjs`.
 *
 * It exists so this gate can have negative controls at all: run against this repository it is
 * green, and a gate that has only ever been observed passing is a gate nobody has seen work.
 *
 * `realpathSync` because macOS resolves `os.tmpdir()` to `/var/folders/...` while the paths a
 * walk of it produces are `/private/var/folders/...`. The coverage check below compares absolute
 * paths, and under the unresolved form every fixture stories file reads as uncovered.
 *
 * Validated rather than trusted, for the reason `--ledger` on `published-links.mjs` was: a flag
 * whose misuse surfaces as a Node stack trace reads as a defect in the gate.
 */
const ROOT = (() => {
  const at = process.argv.indexOf('--root');
  if (at === -1) return HARNESS_ROOT;
  const given = process.argv[at + 1];
  const refuse = (why) => {
    console.error(
      `${GATE}: --root ${why}\n` +
        `  Usage: node scripts/beta-harness/stories-typecheck.mjs [--root <dir>] [--json]\n` +
        '  The directory must contain at least one of apps/ or libs/.',
    );
    process.exit(1);
  };
  if (given === undefined || given.startsWith('--')) {
    refuse(`needs a directory, and was given ${given === undefined ? 'nothing' : `\`${given}\``}.`);
  }
  const root = resolve(given);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    refuse(`\`${given}\` is not a directory.`);
  }
  if (!SOURCE_ROOTS.some((dir) => existsSync(join(root, dir)))) {
    refuse(`\`${given}\` has no apps/ or libs/, so there are no stories to check.`);
  }
  return realpathSync(root);
})();

const asJson = process.argv.includes('--json');
const log = asJson ? NO_PROGRESS : (line) => console.log(line);

/* ── discovery ───────────────────────────────────────────────────────────────────────────────── */

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '.nx', '.angular']);

/**
 * One walk, collecting both halves of this gate's input: the configs to run, and the stories
 * files that must end up covered by them. One walk rather than two, so the two halves cannot
 * disagree about what is in scope — a coverage check run over a different set than the configs
 * were discovered from would compare two answers to two different questions.
 *
 * `SKIP` names the directories to leave out instead of skipping everything beginning with a dot,
 * which is what `spec-typecheck.mjs` does and why its walk could not be reused: the directory
 * this gate is looking for is `.storybook`. A `.storybook` is found by probing each directory for
 * it, and then descended into as well, so a stories file kept beside `preview.ts` is counted too.
 *
 * The depth cap is survivable for the same reason the coverage check exists: a `.storybook`
 * nested deeper than this is not quietly dropped — it leaves its project's stories covered by
 * nothing, and the gate goes red naming them.
 */
function walk(dir, depth, found) {
  if (depth > 6 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isFile()) {
      if (name.endsWith('.stories.ts')) found.stories.push(full);
      continue;
    }
    if (!stat.isDirectory()) continue;
    const config = join(full, '.storybook', 'tsconfig.json');
    if (existsSync(config)) found.configs.push(config);
    walk(full, depth + 1, found);
  }
}

const found = { configs: [], stories: [] };
for (const source of SOURCE_ROOTS) walk(join(ROOT, source), 0, found);
found.configs.sort();
found.stories.sort();

const rel = (path) => relative(ROOT, path).split('\\').join('/');

if (found.configs.length === 0) {
  console.error(
    `${GATE}: found no .storybook/tsconfig.json at all under apps/ or libs/. That is not a pass.\n` +
      `  ${found.stories.length} *.stories.ts file(s) are present and would have gone unchecked.\n` +
      '  If Storybook really has been removed, remove this gate in the same commit; until then an\n' +
      '  empty run is a gate that has stopped reading the thing it is named after.',
  );
  process.exit(1);
}

/* ── prerequisites ───────────────────────────────────────────────────────────────────────────── */

const prep = ensureGeneratedInputs({ root: ROOT, gate: GATE, log });
if (!prep.ok) {
  console.error(prep.message);
  process.exit(1);
}

/* ── run ─────────────────────────────────────────────────────────────────────────────────────── */

const tsc = (args) =>
  spawnToolSync('npx', ['tsc', ...args], { cwd: HARNESS_ROOT, encoding: 'utf8' });

/** The files a config resolves to, from `--showConfig`: the `include` globs already expanded. */
function resolvedFiles(config) {
  const proc = tsc(['-p', config, '--showConfig']);
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  if (proc.status !== 0) return { ok: false, why: output.trim() || `tsc exited ${proc.status}` };
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { ok: false, why: `--showConfig did not emit JSON:\n${output.slice(0, 400)}` };
  }
  const files = (parsed.files ?? []).map((file) => resolve(dirname(config), file));
  return { ok: true, files };
}

const results = [];
for (const config of found.configs) {
  const errors = [];
  /* `--showConfig` first. A config tsc cannot resolve — `TS18003: No inputs were found` is the
   * one that matters, because its `include` has stopped matching anything — cannot be compiled
   * either, so reporting it once is the whole story rather than the same cause counted twice. */
  const shown = resolvedFiles(config);
  if (!shown.ok) {
    errors.push(`${rel(config)}: tsc cannot resolve this config — ${shown.why}`);
  } else {
    const proc = tsc(['-p', config, '--noEmit']);
    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
    errors.push(
      ...output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /error TS\d+:/.test(line)),
    );
    /* A non-zero exit with nothing matched is still a failure — see point 2 in the header. Keep
     * whatever tsc did say, so the report is never "it failed and we cannot tell you why". */
    if (proc.status !== 0 && errors.length === 0) {
      errors.push(
        `${rel(config)}: tsc exited ${proc.status} reporting no \`error TS\` line. ` +
          `Output: ${output.trim().slice(0, 300) || '(none)'}`,
      );
    }
  }

  const stories = (shown.files ?? []).filter((file) => file.endsWith('.stories.ts'));
  results.push({
    config: rel(config),
    ok: errors.length === 0,
    count: errors.length,
    errors,
    files: shown.files ?? [],
    stories: stories.length,
    others: (shown.files ?? []).length - stories.length,
  });
  log(
    `  ${errors.length === 0 ? 'pass' : 'FAIL'}  ${rel(config)}  ` +
      `(${stories.length} stories + ${(shown.files ?? []).length - stories.length} support` +
      `${errors.length ? `, ${errors.length} error(s)` : ''})`,
  );
}

/* ── coverage ────────────────────────────────────────────────────────────────────────────────── */

const covered = new Set(results.flatMap((r) => r.files));
const uncovered = found.stories.filter((file) => !covered.has(file));

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.ok);
const ok = failed.length === 0 && uncovered.length === 0;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok,
        root: ROOT,
        storiesFound: found.stories.length,
        storiesCovered: found.stories.length - uncovered.length,
        uncovered: uncovered.map(rel),
        configs: results.map(({ files, ...rest }) => rest),
      },
      null,
      2,
    ),
  );
} else {
  console.log('');
  for (const r of failed) for (const line of r.errors) console.log(`  ${line}`);
  if (uncovered.length) {
    console.log(
      `  ${uncovered.length} *.stories.ts file(s) are covered by no .storybook/tsconfig.json, so ` +
        'nothing type-checks them:',
    );
    for (const file of uncovered) console.log(`    ${rel(file)}`);
    console.log(
      '  Add the project a .storybook/tsconfig.json whose `include` reaches them, or widen the\n' +
        '  `include` of the one it has. A stories file no config covers is the hole this gate closes.',
    );
  }
  if (ok) {
    const stories = results.reduce((sum, r) => sum + r.stories, 0);
    console.log(
      `${GATE}: pass — ${found.stories.length} stories file(s) type-checked through ` +
        `${results.length} .storybook/tsconfig.json (${stories} stories + ` +
        `${results.reduce((sum, r) => sum + r.others, 0)} .storybook support files), none uncovered.`,
    );
  } else {
    /* Name only what actually failed. The two halves fail independently, and a verdict reading
     * "0 type error(s) in 0 config(s)" over a pure coverage gap sends the reader looking for a
     * compile error that does not exist. */
    const total = failed.reduce((sum, r) => sum + r.count, 0);
    const reasons = [];
    if (failed.length) reasons.push(`${total} type error(s) in ${failed.length} config(s)`);
    if (uncovered.length) {
      reasons.push(`${uncovered.length} stories file(s) covered by no config at all`);
    }
    console.log(
      `\n${GATE}: FAIL — ${reasons.join(' and ')}. ` +
        'Neither `test` nor `typecheck` nor `spec-types` reads these files.',
    );
  }
}

process.exit(ok ? 0 : 1);
