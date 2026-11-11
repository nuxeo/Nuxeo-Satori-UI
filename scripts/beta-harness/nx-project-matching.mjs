#!/usr/bin/env node
/**
 * Nx project-pattern matching gate.
 *
 * ## Why this exists
 *
 * `npm run beta:gate` was green and CI's `test` job was red, for the same structural reason the
 * `lockfile` gate exists: the two run different nx commands, so "green locally" and "green in
 * CI" made different claims and nothing said so.
 *
 * The break: a security override forced `minimatch` to 11.0.1 across the tree
 * (`"minimatch@^10": "11.0.1"`, which npm applies to nx's exact `10.2.5` pin as well, because
 * `10.2.5` is a subset of `^10`). minimatch 11.0.1 **removed `makeRe`** — from the module's
 * named exports and from the `minimatch` function's own properties — and nx calls
 * `minimatch.makeRe` in three places, one of them `nx/dist/src/utils/find-matching-projects.js`.
 * The affected leg of CI's `test` job then died with
 * `minimatch_1.minimatch.makeRe is not a function` (run 42932394850) **after** the four
 * explicitly-named projects had passed, so every project in its tail — `@nuxeo-satori/generators`
 * among them — silently did not run its tests. A red job that has already printed four green
 * projects reads as a test failure, and it was not one.
 *
 * ## Why no existing gate could see it
 *
 * `verify-gate.mjs` builds its nx gates as `nx affected -t <target> --base=<base>` or
 * `nx run-many -t <target> --all`. Neither passes `--exclude` or a project *pattern*, and
 * `findMatchingProjects` is only reached through those. CI's affected leg does pass
 * `--exclude=browse,document-detail,knowledge-discovery,search`, so CI walked a code path no
 * local gate walked.
 *
 * Worse, the crash was **input-dependent**, which is why it survived a run on `main`. nx tries an
 * exclude pattern as a project *name* first and only falls through to matching it against project
 * *directories* — the `makeRe` path — when the name matches nothing in the current selection. On
 * the run that passed, the root `package.json` had changed, so every project was affected, all
 * four excluded names matched by name, and the directory matcher was never reached. On the next
 * run three files under one library had changed, the four names were not in the affected set, and
 * it crashed. A guard watching only CI's exit code would have called the tree healthy for as long
 * as the diffs stayed big.
 *
 * ## What this gate asserts
 *
 * Two probes against the installed nx, built so that neither can pass vacuously and neither
 * depends on what today's diff happens to touch:
 *
 *   A. `nx show projects --projects=<subject> --exclude=<other>` must return exactly
 *      `["<subject>"]`. `<other>` is a real project that is NOT in the selection, so nx's name
 *      matcher misses it and falls through to the directory matcher — the exact shape that
 *      crashed, through the same `addMatchingProjectsByDirectory` frame. Under the broken tree
 *      this probe does not return a wrong answer, it throws.
 *
 *   B. `nx show projects --projects=<subject> --exclude=<subject-root-glob>` must return exactly
 *      `[]`. The pattern is the subject's own root with its last character replaced by `*`, so
 *      answering correctly needs `makeRe` to compile a working regex and that regex to match.
 *      B is what stops A from passing on an exclude that silently does nothing: if exclusion were
 *      a no-op, A would still be green and B would return `["<subject>"]`.
 *
 * Plus one check on the cause, so a red gate names it instead of leaving it to be rediscovered:
 *
 *   C. Every `minimatch` member nx's compiled output references — read out of `nx/dist/src`
 *      rather than hardcoded, so it stays true if nx starts calling something else — exists on
 *      the `minimatch` that nx actually resolves.
 *
 * ## Inspection gaps fail
 *
 * No roster, fewer than two projects, no project with a usable root, nx missing from the tree,
 * nx unable to resolve `minimatch`, or a C scan that finds no `minimatch` reference at all (nx
 * changed how it emits that import and this scanner needs re-pointing) each exit 2. Reading
 * nothing must not pass as finding nothing.
 *
 * ## Seen failing on purpose
 *
 * With `node_modules/nx/node_modules/minimatch` swapped for 11.0.1, A and B both fail and C
 * names `makeRe`; with the tree as the lock describes it, all three pass. The lockfile's own
 * minimatch shape is what decides it, which is the point: this gate is the thing that goes red
 * if an `overrides` entry forces a major on nx again.
 *
 * Usage:
 *   node scripts/beta-harness/nx-project-matching.mjs [--json]
 *
 * Exit: 0 pass · 1 a probe or the API check failed · 2 something could not be inspected.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { spawnToolSync } from './package-command.mjs';

const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));
const asJson = args.has('json');
const repoRoot = process.cwd();

/** Repo-relative, with the separator this platform actually uses, so Windows reads the same. */
const relative = (path) =>
  path.startsWith(repoRoot + sep) ? path.slice(repoRoot.length + 1) : path;

/** @type {{ check: string, detail: string }[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

/** Exit 2 and say what could not be looked at. Never a pass. */
function gap(detail) {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, exit: 2, gap: detail, notes }, null, 2));
  } else {
    for (const note of notes) console.log(`  ${note}`);
    console.error(`nx-project-matching: cannot inspect — ${detail}`);
  }
  process.exit(2);
}

/**
 * Run `nx <argv>` and hand back its streams and status.
 *
 * `stderr` is returned rather than printed: nx writes advisory lines there on a healthy run, and
 * the useful half — the crash message — only matters once a probe has already gone wrong.
 *
 * @param {string[]} argv
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function nx(argv) {
  const run = spawnToolSync('nx', argv, { cwd: repoRoot, encoding: 'utf8' });
  if (run.error) gap(`cannot launch nx (${run.error.message})`);
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** Strip ANSI so a failure detail is readable in a log file as well as a terminal. */
function plain(text) {
  // eslint-disable-next-line no-control-regex -- reading nx's own coloured output
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * The JSON array `nx show projects --json` prints, or why it could not be read.
 *
 * nx prints advisory lines around the payload on some installs ("Your AI agent configuration is
 * outdated"), so the array is located rather than assumed to be the whole of stdout.
 *
 * @param {{ status: number | null, stdout: string, stderr: string }} run
 * @returns {{ projects: string[] } | { error: string }}
 */
function parseProjects(run) {
  if (run.status !== 0) {
    const message = plain(`${run.stderr}\n${run.stdout}`)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' / ');
    return { error: `nx exited ${run.status}: ${message || '(no output)'}` };
  }
  const text = plain(run.stdout);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return { error: `no JSON array in nx output: ${text.trim()}` };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== 'string')) {
      return { error: 'nx printed a JSON value that is not an array of project names' };
    }
    return { projects: parsed };
  } catch (error) {
    return { error: `nx output is not valid JSON (${error.message})` };
  }
}

/* --------------------------------------------------------------- the roster and the subject */

const roster = parseProjects(nx(['show', 'projects', '--json']));
if ('error' in roster) gap(`cannot read the project roster — ${roster.error}`);
if (roster.projects.length < 2) {
  gap(`the roster holds ${roster.projects.length} project(s); these probes need at least two`);
}

const names = [...roster.projects].sort();

/**
 * A project whose root is a real subdirectory, chosen deterministically so two runs of this gate
 * on the same tree make the same claim.
 *
 * The workspace root itself (`.`) is rejected: probe B would build the pattern `*`, which
 * minimatch does not match against `.` without `dot`, so the probe would report a defect that is
 * really an artefact of the subject. Roots shorter than two characters go for the same reason —
 * a character has to be left over once the last one becomes `*`.
 */
let subject = null;
for (const name of names) {
  const shown = nx(['show', 'project', name, '--json']);
  if (shown.status !== 0) continue;
  const text = plain(shown.stdout);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) continue;
  let root;
  try {
    root = JSON.parse(text.slice(start, end + 1)).root;
  } catch {
    continue;
  }
  if (typeof root !== 'string' || root.length < 2 || root.startsWith('.')) continue;
  subject = { name, root };
  break;
}
if (!subject) gap('no project has a root this gate can build a directory pattern from');

const other = names.find((name) => name !== subject.name);
const rootGlob = `${subject.root.slice(0, -1)}*`;

notes.push(`subject            ${subject.name}  (root ${subject.root})`);
notes.push(`A excludes by name ${other}  — not in the selection, so it must change nothing`);
notes.push(`B excludes by glob ${rootGlob}  — matches the subject's root, so it must empty it`);

/* --------------------------------------------------------------------------------- probe A */

const probeA = parseProjects(
  nx(['show', 'projects', `--projects=${subject.name}`, `--exclude=${other}`, '--json']),
);
if ('error' in probeA) {
  /* Only now is the control worth its second of runtime: it separates "exclusion is broken" from
   * "this subject was never selectable in the first place". */
  const control = parseProjects(nx(['show', 'projects', `--projects=${subject.name}`, '--json']));
  failures.push({
    check: 'A: an exclude pattern that is outside the selection',
    detail:
      `\`nx show projects --projects=${subject.name} --exclude=${other}\` produced no project ` +
      `list — ${probeA.error}\n  ` +
      ('error' in control
        ? `Selecting ${subject.name} with no --exclude also fails (${control.error}), so the ` +
          'fault may be the project graph rather than the matcher.'
        : `Selecting ${subject.name} with no --exclude returns ` +
          `${JSON.stringify(control.projects)}, so the fault is in --exclude, not in the graph.`),
  });
} else if (probeA.projects.length !== 1 || probeA.projects[0] !== subject.name) {
  failures.push({
    check: 'A: an exclude pattern that is outside the selection',
    detail:
      `expected exactly ["${subject.name}"], got ${JSON.stringify(probeA.projects)}. ` +
      `\`${other}\` is not in the selection, so excluding it must change nothing.`,
  });
}

/* --------------------------------------------------------------------------------- probe B */

const probeB = parseProjects(
  nx(['show', 'projects', `--projects=${subject.name}`, `--exclude=${rootGlob}`, '--json']),
);
if ('error' in probeB) {
  failures.push({
    check: 'B: a glob exclude pattern matched against project roots',
    detail:
      `\`nx show projects --projects=${subject.name} --exclude=${rootGlob}\` produced no project ` +
      `list — ${probeB.error}`,
  });
} else if (probeB.projects.length !== 0) {
  failures.push({
    check: 'B: a glob exclude pattern matched against project roots',
    detail:
      `expected [], got ${JSON.stringify(probeB.projects)}. \`${rootGlob}\` matches ` +
      `\`${subject.root}\`, so ${subject.name} must be excluded. An exclusion that compiles to a ` +
      'regex matching nothing, or that is silently skipped, looks exactly like this.',
  });
}

/* -------------------------------------------------- check C: the minimatch API nx relies on */

/**
 * Every member of `minimatch` that a compiled file references, in the two forms tsc emits for a
 * CommonJS import: `minimatch_1.minimatch.makeRe` (a property of the exported function) and
 * `minimatch_1.makeRe` (the named export). minimatch 10 had `makeRe` in both places and 11.0.1
 * dropped it from both, so both forms have to be read.
 *
 * @param {string} dir
 * @returns {Map<string, string[]>} member -> up to three repo-relative files that reference it
 */
function minimatchMembersUsedUnder(dir) {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  const pattern = /\bminimatch_1\.(?:minimatch\.)?([A-Za-z_$][\w$]*)/g;
  /** @param {string} current */
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      gap(`cannot list ${current} (${error.message})`);
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      let source;
      try {
        source = readFileSync(path, 'utf8');
      } catch (error) {
        gap(`cannot read ${path} (${error.message})`);
        return;
      }
      if (!source.includes('minimatch_1.')) continue;
      for (const match of source.matchAll(pattern)) {
        const member = match[1];
        /* The import binding itself, not a member of it. */
        if (member === 'minimatch') continue;
        const files = found.get(member) ?? [];
        if (files.length < 3) files.push(relative(path));
        found.set(member, files);
      }
    }
  };
  walk(dir);
  return found;
}

const nxDist = resolve(repoRoot, 'node_modules/nx/dist/src');
try {
  if (!statSync(nxDist).isDirectory()) gap(`${nxDist} is not a directory`);
} catch (error) {
  gap(`cannot find nx's compiled sources at ${nxDist} (${error.message})`);
}

const used = minimatchMembersUsedUnder(nxDist);
if (used.size === 0) {
  gap(
    `found no \`minimatch_1.…\` reference under ${relative(nxDist)}. nx has ` +
      'changed how it emits that import, so this scanner reports nothing for a reason that has ' +
      'nothing to do with the tree being healthy — re-point it rather than trusting it.',
  );
}

let resolvedMinimatch = null;
try {
  const requireFromNx = createRequire(join(repoRoot, 'node_modules/nx/package.json'));
  resolvedMinimatch = {
    version: requireFromNx('minimatch/package.json').version,
    module: requireFromNx('minimatch'),
    path: relative(requireFromNx.resolve('minimatch/package.json')),
  };
} catch (error) {
  gap(`nx cannot resolve minimatch (${error.message})`);
}

notes.push(
  `nx resolves       minimatch ${resolvedMinimatch.version}  (${resolvedMinimatch.path})`,
  `C checks members  ${[...used.keys()].sort().join(', ')}`,
);

for (const [member, files] of [...used].sort(([a], [b]) => a.localeCompare(b))) {
  const onNamespace = typeof resolvedMinimatch.module?.[member] === 'function';
  const onFunction = typeof resolvedMinimatch.module?.minimatch?.[member] === 'function';
  if (onNamespace || onFunction) continue;
  failures.push({
    check: `C: minimatch.${member} is missing`,
    detail:
      `nx calls \`minimatch.${member}\` (${files.join(', ')}) and the copy it resolves — ` +
      `minimatch ${resolvedMinimatch.version} at ${resolvedMinimatch.path} — does not have it. ` +
      'An `overrides` entry that forces a major on nx is the usual cause: nx 23 and 24 both pin ' +
      '`minimatch` to 10.2.5, and npm applies a `minimatch@^10` override to that exact pin too.',
  });
}

/* --------------------------------------------------------------------------------- verdict */

if (asJson) {
  console.log(
    JSON.stringify(
      { ok: failures.length === 0, exit: failures.length === 0 ? 0 : 1, failures, notes },
      null,
      2,
    ),
  );
} else {
  for (const note of notes) console.log(`  ${note}`);
  if (failures.length === 0) {
    console.log(
      `nx-project-matching: PASS — probes A and B, and ${used.size} API member(s), against ` +
        `minimatch ${resolvedMinimatch.version}.`,
    );
  } else {
    for (const failure of failures) {
      console.error(`\nnx-project-matching: FAIL — ${failure.check}\n  ${failure.detail}`);
    }
    console.error(
      `\n${failures.length} of 3 checks failed. While this is red, \`nx affected\` with ` +
        '`--exclude` can die after the explicitly-named projects have passed, and every project ' +
        'in the tail silently does not run its tests.',
    );
  }
}

process.exit(failures.length === 0 ? 0 : 1);
