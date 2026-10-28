#!/usr/bin/env node
import { spawnToolSync } from './beta-harness/package-command.mjs';

/**
 * Regenerate the repository's shared derived files after merging a base branch — never hand-merge
 * them.
 *
 * Several files are generated from the rest of the tree, and every branch that touches what they
 * are generated from changes them. Two branches merged together then conflict on lines nobody
 * wrote, and a hand-merged generated file is wrong in ways no reviewer sees: the API snapshot two
 * branches each extended, the English fallback with each side's new keys. So after `git merge`:
 *
 *   npm run sync:derived -- --base origin/integration/nxsat-308
 *
 * 1. **Conflicts.** A conflicted derived file is reset to this branch's side (`git checkout
 *    --ours`), since it is about to be regenerated from the merged sources. Any other conflicted
 *    file stops the command: those are real merges, for a person.
 * 2. **Regenerate**, each from the merged tree:
 *    - the English fallback catalogue, `libs/shared/ui/src/lib/i18n/platform-en.ts`
 *      (`tools/i18n/platform-english.mjs`);
 *    - the agent-config mirrors under `.claude/` and `.agent/` (`mirror-agent-config.mjs sync`);
 *    - the platform build — which copies the extension reference into the package — and from it the
 *      API snapshot, `docs/api/platform.api.md` (`api-surface.mjs --update`);
 *    - the coverage baseline, `.ai/state/coverage-baseline.json`, but only when it conflicted or
 *      `--coverage` is given: the projects whose entries the two sides disagree on (or every
 *      project with `--coverage`), plus the floor projects, are measured again and recorded.
 * 3. **Stage** the derived files that changed, so the merge commit carries them.
 * 4. **The fast gates** — `node`, `lockfile`, `guardrails`, `reference-drift`, `nxs-comparison`,
 *    `agent-mirror`, `api-surface` — through `verify-gate.mjs`, so a regenerated file that still
 *    disagrees with the code is red here, not in CI.
 *
 * The Repository Guide's counts are not derived files: no gate reads them, and they are recounted
 * once, in the last pull request (plan section 11a).
 *
 * Usage:
 *   node scripts/sync-derived.mjs [--base <ref>] [--coverage] [--no-gates] [--dry-run]
 *
 * `--base` is passed to the gates (default `origin/main`, as `verify-gate.mjs`). `--dry-run`
 * prints what would be done and changes nothing; `sync-derived.selftest.mjs` runs it on fixtures.
 * Exit 0 when every step and gate passed, 1 when one failed, 2 on a conflict that needs a person.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The derived files: generated from the tree, never merged by hand. */
export const DERIVED = Object.freeze({
  fallback: 'libs/shared/ui/src/lib/i18n/platform-en.ts',
  apiSnapshot: 'docs/api/platform.api.md',
  coverageBaseline: '.ai/state/coverage-baseline.json',
});

/** The generated copies of `.cursor/{skills,agents,rules}` — `mirror-agent-config.mjs`. */
const MIRROR = /^\.(claude|agent)\/(skills|agents|rules)\//;

/** Whether a path is a derived file. */
export function isDerived(path) {
  return Object.values(DERIVED).includes(path) || MIRROR.test(path);
}

/**
 * The plan for a set of conflicted paths: which are reset to this side and regenerated, and which
 * need a person. Pure, so the selftest can hold it to its variant matrix.
 */
export function planConflicts(conflicted) {
  return {
    regenerate: conflicted.filter(isDerived),
    byHand: conflicted.filter((path) => !isDerived(path)),
  };
}

/**
 * The projects whose coverage entries the two sides of a conflicted baseline disagree on: present
 * on one side only, or with different numbers. `ours` and `theirs` are the baseline's JSON text.
 */
export function disagreeingProjects(ours, theirs) {
  const projects = (text) => {
    try {
      return JSON.parse(text)?.projects ?? {};
    } catch {
      return null;
    }
  };
  const a = projects(ours);
  const b = projects(theirs);
  if (!a || !b) return null;
  // Key order is not a disagreement: compare each entry with its keys sorted.
  const canonical = (entry) =>
    entry && typeof entry === 'object'
      ? JSON.stringify(
          Object.fromEntries(Object.entries(entry).sort(([x], [y]) => x.localeCompare(y))),
        )
      : JSON.stringify(entry);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => canonical(a[name]) !== canonical(b[name]))
    .sort();
}

/** Projects the coverage gate holds to a floor; they must be measured on every update. */
const FLOOR_PROJECTS = ['satori-components', 'satori-components-satori'];

const FAST_GATES = [
  'node',
  'lockfile',
  'guardrails',
  'reference-drift',
  'nxs-comparison',
  'agent-mirror',
  'api-surface',
];

function main() {
  const argv = process.argv.slice(2);
  const option = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const dryRun = argv.includes('--dry-run');
  const gates = !argv.includes('--no-gates');
  const allCoverage = argv.includes('--coverage');
  const base = option('--base') ?? process.env.NX_BASE ?? 'origin/main';

  const run = (cmd, args, { capture = false } = {}) =>
    spawnToolSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
  const git = (...args) => run('git', args, { capture: true });
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).stdout.trim();
  if (!root) {
    console.error('sync-derived: not inside a git work tree.');
    process.exit(2);
  }

  const say = (message) => console.log(`sync-derived: ${message}`);
  const step = (label, cmd, args) => {
    if (dryRun) {
      say(`would ${label}: ${[cmd, ...args].join(' ')}`);
      return;
    }
    say(`${label} …`);
    const result = run(cmd, args);
    if (result.status !== 0) {
      console.error(
        `sync-derived: FAIL — ${label} (${[cmd, ...args].join(' ')}) exited ${result.status}.`,
      );
      process.exit(1);
    }
  };

  // 1. Conflicts.
  const conflicted = git('diff', '--name-only', '--diff-filter=U')
    .stdout.split('\n')
    .filter(Boolean);
  const { regenerate, byHand } = planConflicts(conflicted);
  if (byHand.length) {
    console.error(
      'sync-derived: these conflicts are real merges, not derived files. Resolve them, `git add` ' +
        `them, and run this again:\n${byHand.map((path) => `  ${path}`).join('\n')}`,
    );
    process.exit(2);
  }
  let coverageProjects = allCoverage ? 'all' : null;
  if (regenerate.includes(DERIVED.coverageBaseline) && !allCoverage) {
    const side = (stage) => git('show', `:${stage}:${DERIVED.coverageBaseline}`).stdout;
    const disagreeing = disagreeingProjects(side(2), side(3));
    coverageProjects = disagreeing === null ? 'all' : disagreeing;
  }
  for (const path of regenerate) {
    if (dryRun) {
      say(`would take this branch's side of ${path}, to regenerate it`);
    } else {
      const result = git('checkout', '--ours', '--', path);
      if (result.status !== 0) {
        console.error(
          `sync-derived: FAIL — could not take this branch's side of ${path}:\n${result.stderr}`,
        );
        process.exit(1);
      }
      say(`took this branch's side of ${path}, to regenerate it`);
    }
  }

  // 2. Regenerate.
  step('regenerate the English fallback catalogue', 'node', ['tools/i18n/platform-english.mjs']);
  step('regenerate the agent-config mirrors', 'node', ['scripts/mirror-agent-config.mjs', 'sync']);
  step('build the platform package, with its extension reference copy', 'npx', [
    'nx',
    'build',
    'platform',
    '--skip-nx-cache',
  ]);
  step('regenerate the API snapshot', 'node', ['scripts/beta-harness/api-surface.mjs', '--update']);
  if (coverageProjects === null) {
    say('coverage baseline: no conflict and no --coverage, so not measured');
  } else {
    if (!dryRun) rmSync(join(root, 'coverage'), { recursive: true, force: true });
    if (coverageProjects === 'all') {
      step('measure every project and record the coverage baseline', 'node', [
        'scripts/beta-harness/coverage-gate.mjs',
        '--run',
        '--update-baseline',
      ]);
    } else {
      const projects = [...new Set([...coverageProjects, ...FLOOR_PROJECTS])];
      step(`measure ${projects.join(', ')}`, 'npx', [
        'nx',
        'run-many',
        '-t',
        'test',
        `--projects=${projects.join(',')}`,
        '--coverage.enabled=true',
      ]);
      step('record the coverage baseline', 'node', [
        'scripts/beta-harness/coverage-gate.mjs',
        '--update-baseline',
      ]);
    }
  }

  // 3. Stage what changed.
  const derivedPaths = [...Object.values(DERIVED), '.claude', '.agent'].filter((path) =>
    existsSync(join(root, path)),
  );
  if (dryRun) {
    say(`would stage changes to: ${derivedPaths.join(', ')}`);
  } else {
    const added = git('add', '--', ...derivedPaths);
    if (added.status !== 0) {
      console.error(`sync-derived: FAIL — could not stage the derived files:\n${added.stderr}`);
      process.exit(1);
    }
    const staged = git('diff', '--cached', '--name-only', '--', ...derivedPaths)
      .stdout.split('\n')
      .filter(Boolean);
    say(
      staged.length
        ? `staged:\n${staged.map((p) => `  ${p}`).join('\n')}`
        : 'no derived file changed',
    );
  }

  // 4. The fast gates.
  if (gates) {
    step('run the fast gates', 'node', [
      'scripts/beta-harness/verify-gate.mjs',
      '--phase',
      'sync-derived',
      '--base',
      base,
      '--gates',
      FAST_GATES.join(','),
    ]);
  } else {
    say('fast gates NOT RUN (--no-gates)');
  }
  say(dryRun ? 'dry run — nothing changed' : 'done');
  if (regenerate.length && !dryRun) {
    say(
      `conflicts left unresolved: ${git('diff', '--name-only', '--diff-filter=U').stdout.trim() || 'none'}`,
    );
  }
}

// Run when executed, not when the selftest imports the pure parts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
