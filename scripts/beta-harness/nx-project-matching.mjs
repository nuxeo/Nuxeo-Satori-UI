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
 *      rather than hardcoded, so it stays true if nx starts calling something else — exists **at
 *      the access path the call site uses**.
 *
 * ### Why C keeps the access path, rather than accepting either
 *
 * tsc emits two shapes for a CommonJS import, and they are not interchangeable at runtime:
 * `minimatch_1.makeRe(…)` reads the named export, `minimatch_1.minimatch.makeRe(…)` reads a
 * property of the exported function. minimatch 10 carried `makeRe` in both places and 11.0.1
 * dropped it from both, so collapsing the two and accepting either was green against *this*
 * break — and it would have been green against half of it. A minimatch that kept the named
 * export and dropped the function property would satisfy "either", while every
 * `minimatch_1.minimatch.makeRe(…)` call site still threw, and C — the check whose whole job is
 * to name the cause — would have said nothing. Review (#586) caught that; the controls in
 * `nx-project-matching.selftest.mjs` pin each one-sided removal to its own failing case.
 *
 * ## Inspection gaps fail
 *
 * No roster, fewer than two projects, no project with a usable root, nx missing from the tree, nx
 * unable to resolve `minimatch`, an unreadable directory under `nx/dist/src`, or a C scan that
 * finds no `minimatch` reference at all (nx changed how it emits that import and this scanner
 * needs re-pointing) each exit 2. Reading nothing must not pass as finding nothing.
 *
 * ## Seen failing on purpose
 *
 * With `node_modules/nx/node_modules/minimatch` swapped for 11.0.1, A and B both fail and C names
 * `makeRe`; with the tree as the lock describes it, all three pass. The lockfile's own minimatch
 * shape is what decides it, which is the point: this gate is the thing that goes red if an
 * `overrides` entry forces a major on nx again.
 *
 * ## What is pure, and therefore under control
 *
 * `pickSubject`, `minimatchMembersUsedUnder`, `missingUsages` and `evaluate` are exported and
 * side-effect free, and the selftest drives all four. Gathering — spawning nx, resolving
 * `minimatch` from nx's own tree — is the only part that is not, so a gap raised while gathering
 * (`cannot launch nx`, `nx cannot resolve minimatch`) is the one class of verdict the controls
 * cannot reach. Said rather than left for a reader to work out.
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

/**
 * The two shapes tsc emits for a member of a CommonJS `minimatch` import, and the runtime path
 * each one actually reads. Keyed by the name used throughout this file and its controls.
 */
export const ACCESS = Object.freeze({
  /** `minimatch_1.makeRe(…)` — the named export. */
  namespace: 'namespace',
  /** `minimatch_1.minimatch.makeRe(…)` — a property of the exported function. */
  function: 'function',
});

/** How a usage of `<member>` via `<access>` reads off a loaded module. Used by C and its controls. */
export function readUsage(module, usage) {
  const holder = usage.access === ACCESS.function ? module?.minimatch : module;
  return holder?.[usage.member];
}

/** `minimatch_1.makeRe` / `minimatch_1.minimatch.makeRe` as the source text spells it. */
export function usageExpression(usage) {
  return usage.access === ACCESS.function
    ? `minimatch.${usage.member}`
    : `minimatch_1.${usage.member}`;
}

/**
 * Pick the project the probes run against, and a second project to exclude by name.
 *
 * Deterministic — sorted order, first usable root — so two runs on the same tree make the same
 * claim. `rootOf` is called lazily and only until a usable root turns up, because in the gate it
 * is an `nx show project` spawn costing about a second each.
 *
 * The workspace root itself (`.`) is rejected: probe B would build the pattern `*`, which
 * minimatch does not match against `.` without `dot`, so the probe would report a defect that is
 * really an artefact of the subject. Roots shorter than two characters go for the same reason — a
 * character has to be left over once the last one becomes `*`.
 *
 * @param {string[]} names
 * @param {(name: string) => string | null} rootOf
 * @returns {{ subject: { name: string, root: string }, other: string, rootGlob: string } | { gap: string }}
 */
export function pickSubject(names, rootOf) {
  if (names.length < 2) {
    return { gap: `the roster holds ${names.length} project(s); these probes need at least two` };
  }
  const sorted = [...names].sort();
  for (const name of sorted) {
    const root = rootOf(name);
    if (typeof root !== 'string' || root.length < 2 || root.startsWith('.')) continue;
    return {
      subject: { name, root },
      other: sorted.find((candidate) => candidate !== name),
      rootGlob: `${root.slice(0, -1)}*`,
    };
  }
  return { gap: 'no project has a root this gate can build a directory pattern from' };
}

/**
 * Every `minimatch` member a compiled file references, **with the access path it reads through**.
 *
 * One member can appear under both access paths in different files, so each (member, access) pair
 * is its own usage with its own file list. `minimatch_1.minimatch(…)` on its own is the binding
 * being called, not a member of it, and is skipped.
 *
 * Throws rather than exiting, so the caller decides what a gap means; the gate turns it into
 * exit 2.
 *
 * @param {string} dir
 * @returns {{ member: string, access: string, files: string[] }[]} sorted by access then member
 */
export function minimatchMembersUsedUnder(dir) {
  /** @type {Map<string, { member: string, access: string, files: string[] }>} */
  const found = new Map();
  /* Group 1 is non-empty only for the `.minimatch.` form, which is what tells the two apart. */
  const pattern = /\bminimatch_1\.(minimatch\.)?([A-Za-z_$][\w$]*)/g;
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const source = readFileSync(path, 'utf8');
      if (!source.includes('minimatch_1.')) continue;
      for (const match of source.matchAll(pattern)) {
        const access = match[1] ? ACCESS.function : ACCESS.namespace;
        const member = match[2];
        /* The import binding itself, not a member of it. */
        if (access === ACCESS.namespace && member === 'minimatch') continue;
        const key = `${access}:${member}`;
        const usage = found.get(key) ?? { member, access, files: [] };
        if (usage.files.length < 3) usage.files.push(path);
        found.set(key, usage);
      }
    }
  };
  walk(dir);
  return [...found.values()].sort(
    (a, b) => a.access.localeCompare(b.access) || a.member.localeCompare(b.member),
  );
}

/**
 * The usages whose own access path is absent from a loaded `minimatch`.
 *
 * Deliberately NOT "present under either path". See the header: accepting either was green
 * against the break that prompted this gate and would have been green against half of it.
 *
 * @param {{ member: string, access: string, files: string[] }[]} usages
 * @param {unknown} module
 */
export function missingUsages(usages, module) {
  return usages.filter((usage) => typeof readUsage(module, usage) !== 'function');
}

/**
 * The verdict, from inputs alone — no spawning, no filesystem, no `process.exit`.
 *
 * @param {object} input
 * @param {{ name: string, root: string }} input.subject
 * @param {string} input.other
 * @param {string} input.rootGlob
 * @param {{ projects: string[] } | { error: string }} input.probeA
 * @param {{ projects: string[] } | { error: string }} input.probeB
 * @param {() => ({ projects: string[] } | { error: string })} input.controlProbe  only consulted
 *        when probe A errored, where it separates "exclusion is broken" from "this subject was
 *        never selectable"
 * @param {{ member: string, access: string, files: string[] }[]} input.usages
 * @param {{ version: string, path: string, module: unknown }} input.minimatch
 * @param {(path: string) => string} [input.relative]
 * @returns {{ exit: 0 | 1 | 2, gap?: string, failures: { check: string, detail: string }[], notes: string[] }}
 */
export function evaluate({
  subject,
  other,
  rootGlob,
  probeA,
  probeB,
  controlProbe,
  usages,
  minimatch,
  relative = (path) => path,
}) {
  const notes = [
    `subject            ${subject.name}  (root ${subject.root})`,
    `A excludes by name ${other}  — not in the selection, so it must change nothing`,
    `B excludes by glob ${rootGlob}  — matches the subject's root, so it must empty it`,
  ];

  if (usages.length === 0) {
    return {
      exit: 2,
      gap:
        "found no `minimatch_1.…` reference in nx's compiled sources. nx has changed how it " +
        'emits that import, so this scanner reports nothing for a reason that has nothing to do ' +
        'with the tree being healthy — re-point it rather than trusting it.',
      failures: [],
      notes,
    };
  }

  notes.push(
    `nx resolves       minimatch ${minimatch.version}  (${minimatch.path})`,
    `C checks         ${usages.map((u) => `${usageExpression(u)}`).join(', ')}`,
  );

  const failures = [];

  if ('error' in probeA) {
    const control = controlProbe();
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

  if ('error' in probeB) {
    failures.push({
      check: 'B: a glob exclude pattern matched against project roots',
      detail:
        `\`nx show projects --projects=${subject.name} --exclude=${rootGlob}\` produced no ` +
        `project list — ${probeB.error}`,
    });
  } else if (probeB.projects.length !== 0) {
    failures.push({
      check: 'B: a glob exclude pattern matched against project roots',
      detail:
        `expected [], got ${JSON.stringify(probeB.projects)}. \`${rootGlob}\` matches ` +
        `\`${subject.root}\`, so ${subject.name} must be excluded. An exclusion that compiles to ` +
        'a regex matching nothing, or that is silently skipped, looks exactly like this.',
    });
  }

  for (const usage of missingUsages(usages, minimatch.module)) {
    const sibling = usage.access === ACCESS.function ? ACCESS.namespace : ACCESS.function;
    const siblingPresent =
      typeof readUsage(minimatch.module, { ...usage, access: sibling }) === 'function';
    failures.push({
      check: `C: ${usageExpression(usage)} is missing`,
      detail:
        `nx reads \`${usageExpression(usage)}\` (${usage.files.map(relative).join(', ')}) and the ` +
        `copy it resolves — minimatch ${minimatch.version} at ${minimatch.path} — does not have ` +
        'it there. ' +
        (siblingPresent
          ? `It does carry \`${usageExpression({ ...usage, access: sibling })}\`, which is a ` +
            'different runtime path and does not save these call sites. '
          : '') +
        'An `overrides` entry that forces a major on nx is the usual cause: nx 23 and 24 both ' +
        'pin `minimatch` to 10.2.5, and npm applies a `minimatch@^10` override to that exact ' +
        'pin too.',
    });
  }

  return { exit: failures.length === 0 ? 0 : 1, failures, notes };
}

/* ------------------------------------------------------------------------------- the gate */

/* Importing this module must not run it: the selftest drives the four functions above directly,
 * and a module that spawns nx on import cannot be imported by anything cheap. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

function main() {
  const args = new Set(process.argv.slice(2).map((a) => a.replace(/^--/, '')));
  const asJson = args.has('json');
  const repoRoot = process.cwd();

  /** Repo-relative, with the separator this platform uses, so Windows reads the same. */
  const relative = (path) =>
    path.startsWith(repoRoot + sep) ? path.slice(repoRoot.length + 1) : path;

  /** Report a gap and exit 2. Never a pass. */
  const gap = (detail, notes = []) => {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, exit: 2, gap: detail, notes }, null, 2));
    } else {
      for (const note of notes) console.log(`  ${note}`);
      console.error(`nx-project-matching: cannot inspect — ${detail}`);
    }
    process.exit(2);
  };

  /** Strip ANSI so a failure detail reads the same in a log file as in a terminal. */
  const plain = (text) =>
    // eslint-disable-next-line no-control-regex -- reading nx's own coloured output
    text.replace(/\u001b\[[0-9;]*m/g, '');

  /**
   * Run `nx <argv>`. `stderr` is returned rather than printed: nx writes advisory lines there on
   * a healthy run, and the useful half — the crash message — only matters once something has
   * already gone wrong.
   */
  const nx = (argv) => {
    const run = spawnToolSync('nx', argv, { cwd: repoRoot, encoding: 'utf8' });
    if (run.error) gap(`cannot launch nx (${run.error.message})`);
    return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  };

  /**
   * The JSON array `nx show projects --json` prints, or why it could not be read. nx prints
   * advisory lines around the payload on some installs ("Your AI agent configuration is
   * outdated"), so the array is located rather than assumed to be the whole of stdout.
   */
  const parseProjects = (run) => {
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
  };

  const roster = parseProjects(nx(['show', 'projects', '--json']));
  if ('error' in roster) gap(`cannot read the project roster — ${roster.error}`);

  const picked = pickSubject(roster.projects, (name) => {
    const shown = nx(['show', 'project', name, '--json']);
    if (shown.status !== 0) return null;
    const text = plain(shown.stdout);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)).root ?? null;
    } catch {
      return null;
    }
  });
  if ('gap' in picked) gap(picked.gap);
  const { subject, other, rootGlob } = picked;

  const probe = (pattern) =>
    parseProjects(
      nx(['show', 'projects', `--projects=${subject.name}`, `--exclude=${pattern}`, '--json']),
    );

  const nxDist = resolve(repoRoot, 'node_modules/nx/dist/src');
  try {
    if (!statSync(nxDist).isDirectory()) gap(`${nxDist} is not a directory`);
  } catch (error) {
    gap(`cannot find nx's compiled sources at ${relative(nxDist)} (${error.message})`);
  }

  let usages;
  try {
    usages = minimatchMembersUsedUnder(nxDist);
  } catch (error) {
    gap(`cannot scan ${relative(nxDist)} (${error.message})`);
  }

  let minimatch;
  try {
    const requireFromNx = createRequire(join(repoRoot, 'node_modules/nx/package.json'));
    minimatch = {
      version: requireFromNx('minimatch/package.json').version,
      module: requireFromNx('minimatch'),
      path: relative(requireFromNx.resolve('minimatch/package.json')),
    };
  } catch (error) {
    gap(`nx cannot resolve minimatch (${error.message})`);
  }

  const verdict = evaluate({
    subject,
    other,
    rootGlob,
    probeA: probe(other),
    probeB: probe(rootGlob),
    controlProbe: () =>
      parseProjects(nx(['show', 'projects', `--projects=${subject.name}`, '--json'])),
    usages,
    minimatch,
    relative,
  });

  if (verdict.exit === 2) gap(verdict.gap, verdict.notes);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: verdict.exit === 0,
          exit: verdict.exit,
          failures: verdict.failures,
          notes: verdict.notes,
        },
        null,
        2,
      ),
    );
  } else {
    for (const note of verdict.notes) console.log(`  ${note}`);
    if (verdict.failures.length === 0) {
      console.log(
        `nx-project-matching: PASS — probes A and B, and ${usages.length} API access path(s), ` +
          `against minimatch ${minimatch.version}.`,
      );
    } else {
      for (const failure of verdict.failures) {
        console.error(`\nnx-project-matching: FAIL — ${failure.check}\n  ${failure.detail}`);
      }
      console.error(
        `\n${verdict.failures.length} failure(s). While this is red, \`nx affected\` with ` +
          '`--exclude` can die after the explicitly-named projects have passed, and every ' +
          'project in the tail silently does not run its tests.',
      );
    }
  }

  process.exit(verdict.exit);
}
