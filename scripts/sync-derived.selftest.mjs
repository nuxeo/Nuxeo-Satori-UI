#!/usr/bin/env node
/**
 * Controls for `scripts/sync-derived.mjs`: which conflicted paths it regenerates and which it
 * leaves for a person, which coverage entries it measures again, what it does in a real merge
 * conflict, and what it stages. The fixtures are throwaway git repositories under the temp dir.
 * Most are run with `--dry-run --no-gates`. One is run for real, with stand-ins for the steps that
 * build, to read what step 3 put in the index. Nothing here builds, measures or writes outside
 * the fixtures.
 *
 * Usage: node scripts/sync-derived.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { DERIVED, disagreeingProjects, isDerived, planConflicts } from './sync-derived.mjs';

const REPO = resolve(import.meta.dirname, '..');
const SCRIPT = resolve(import.meta.dirname, 'sync-derived.mjs');
const failures = [];
let controls = 0;

/**
 * The environment every child process here gets: this one, without `NX_BASE` and without the
 * variables git names as locating a repository (`git rev-parse --local-env-vars`). Git exports
 * those to its hooks. Inherited, they would send the fixtures' git commands, and the real run
 * below, to the checkout this selftest lives in.
 */
const LOCATING = (
  spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout ?? ''
)
  .split('\n')
  .filter(Boolean);
if (!LOCATING.includes('GIT_DIR')) {
  console.error('sync-derived selftest: `git rev-parse --local-env-vars` did not name GIT_DIR.');
  process.exit(1);
}
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name !== 'NX_BASE' && !LOCATING.includes(name)),
);

function check(label, actual, expected) {
  controls += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same)
    failures.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ------------------------------------------------------------- isDerived, a row per variant ----

for (const [path, expected] of [
  [DERIVED.fallback, true],
  [DERIVED.apiSnapshot, true],
  [DERIVED.coverageBaseline, true],
  ['.claude/skills/fix-bug/SKILL.md', true],
  ['.agent/agents/evidence-auditor.md', true],
  ['.claude/rules/security.mdc', true],
  ['.claude/MIRROR.md', true],
  ['.agent/MIRROR.md', true],
  ['.cursor/skills/fix-bug/SKILL.md', false],
  ['.claude/settings.json', false],
  ['.claude/launch.json', false],
  ['.claude/MIRROR.md.orig', false],
  ['.claude/skills', false],
  ['docs/api/platform.api.md.orig', false],
  ['xdocs/api/platform.api.md', false],
  ['docs/api/Platform.api.md', false],
  ['./docs/api/platform.api.md', false],
  ['libs/shared/ui/src/lib/i18n/platform-en.spec.ts', false],
  ['apps/nuxeo-ui/public/i18n/en.json', false],
  ['libs/shared/satori-components/src/index.ts', false],
]) {
  check(`isDerived(${JSON.stringify(path)})`, isDerived(path), expected);
}

check(
  'planConflicts splits derived files from real merges',
  planConflicts([DERIVED.apiSnapshot, 'libs/x.ts', '.agent/skills/a.md']),
  { regenerate: [DERIVED.apiSnapshot, '.agent/skills/a.md'], byHand: ['libs/x.ts'] },
);
check('planConflicts with nothing conflicted', planConflicts([]), { regenerate: [], byHand: [] });

// ------------------------------------------------------- disagreeingProjects, a row per case ----

const baseline = (projects) => JSON.stringify({ target: 90, projects }, null, 2);
const ui = { lines: 90, statements: 90, sTotal: 10, sCovered: 9 };
for (const [label, ours, theirs, expected] of [
  ['identical sides', baseline({ ui }), baseline({ ui }), []],
  ['one number changed', baseline({ ui }), baseline({ ui: { ...ui, lines: 91 } }), ['ui']],
  ['a project on one side only', baseline({ ui }), baseline({ ui, browse: ui }), ['browse']],
  [
    'the same numbers in another key order',
    baseline({ ui }),
    baseline({ ui: { sCovered: 9, sTotal: 10, statements: 90, lines: 90 } }),
    [],
  ],
  ['a side that is not JSON', baseline({ ui }), '{ "projects": ', null],
]) {
  check(`disagreeingProjects: ${label}`, disagreeingProjects(ours, theirs), expected);
}

// --------------------------------------------------------- a real merge conflict, dry run ----

/** A repository with `main` and `topic` both changing `files`, merged so they conflict. */
function conflicted(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-derived-selftest-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });
    return result;
  };
  const write = (path, body) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'selftest@example.invalid');
  git('config', 'user.name', 'Sync Selftest');
  git('config', 'commit.gpgsign', 'false');
  for (const [path, [base]] of Object.entries(files)) write(path, base);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'base');
  git('checkout', '--quiet', '-b', 'topic');
  for (const [path, [, , topic]] of Object.entries(files)) write(path, topic);
  git('commit', '--quiet', '-am', 'topic');
  git('checkout', '--quiet', 'main');
  for (const [path, [, mainSide]] of Object.entries(files)) write(path, mainSide);
  git('commit', '--quiet', '-am', 'main');
  git('merge', '--quiet', 'topic');
  return { dir, git };
}

function dryRun(dir) {
  const result = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--no-gates'], {
    cwd: dir,
    encoding: 'utf8',
    env: ENV,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function scenario(label, files, { code, says = [], unresolved = [] }) {
  const { dir, git } = conflicted(files);
  try {
    const result = dryRun(dir);
    controls += 1;
    if (result.code !== code)
      failures.push(`${label}: exited ${result.code}, expected ${code}:\n${result.out}`);
    for (const pattern of says) {
      controls += 1;
      if (!pattern.test(result.out))
        failures.push(`${label}: output lacks /${pattern.source}/:\n${result.out}`);
    }
    const still = git('diff', '--name-only', '--diff-filter=U').stdout.split('\n').filter(Boolean);
    check(`${label}: conflicts left as they were by a dry run`, still.sort(), unresolved.sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sides = (base, main, topic) => [base, main, topic];

scenario(
  'a conflict in a source file next to a derived one',
  {
    'libs/x.ts': sides('a\n', 'b\n', 'c\n'),
    [DERIVED.apiSnapshot]: sides('a\n', 'b\n', 'c\n'),
  },
  {
    code: 2,
    says: [/these conflicts are real merges/, /^ {2}libs\/x\.ts$/m],
    unresolved: ['libs/x.ts', DERIVED.apiSnapshot],
  },
);

scenario(
  'a conflict in the API snapshot alone',
  { [DERIVED.apiSnapshot]: sides('a\n', 'b\n', 'c\n') },
  {
    code: 0,
    says: [
      /would take this branch's side of docs\/api\/platform\.api\.md/,
      /would regenerate the API snapshot/,
      /coverage baseline: no conflict and no --coverage, so not measured/,
    ],
    unresolved: [DERIVED.apiSnapshot],
  },
);

scenario(
  'a conflict in a mirrored skill',
  { '.claude/skills/x/SKILL.md': sides('a\n', 'b\n', 'c\n') },
  {
    code: 0,
    says: [
      /would take this branch's side of \.claude\/skills\/x\/SKILL\.md/,
      /would regenerate the agent-config mirrors/,
    ],
    unresolved: ['.claude/skills/x/SKILL.md'],
  },
);

scenario(
  'a conflict in the coverage baseline measures the disagreeing projects and the floors',
  {
    [DERIVED.coverageBaseline]: sides(
      baseline({ ui, browse: ui }),
      baseline({ ui: { ...ui, lines: 92 }, browse: ui }),
      baseline({ ui: { ...ui, lines: 93 }, browse: ui }),
    ),
  },
  {
    code: 0,
    says: [
      /would measure ui, satori-components, satori-components-satori: npx nx run-many -t test/,
    ],
    unresolved: [DERIVED.coverageBaseline],
  },
);

// ------------------------------------------- a real run: what step 3 stages, and what it leaves ----
//
// The merge of `main` in #628 committed a `.claude/launch.json` nobody meant to commit: the desktop
// app's local preview configuration, untracked and not ignored, staged by step 3 along with the
// rest of `.claude/`. So this runs the script for real, in a fixture laid out like this repository
// wherever step 3 looks, and reads the index afterwards. The mirror script is the real one, copied
// in, so what it writes is what step 3 has to stage. The steps that build are stand-ins:
// `platform-english.mjs` and `api-surface.mjs` each rewrite their derived file, as regenerating
// after a merge does, and `npx` (so `nx build platform`) is a stub reached through `npm_execpath`,
// the first place `package-command.mjs` looks for it.

/** Untracked and not ignored, as on a developer's machine. Step 3 must leave both alone. */
const MACHINE_LOCAL = {
  '.claude/launch.json': '{ "version": "0.0.1", "configurations": [] }\n',
  '.agent/notes.local.md': 'Notes kept on one machine.\n',
};

/** Prints what it was asked to run. Uses nothing but `process`, so it runs as either module type. */
const NPX_STAND_IN =
  "process.stdout.write('npx stand-in: ' + JSON.stringify(process.argv.slice(2)) + '\\n');\n";

/** A stand-in regenerator: rewrites its one derived file, as the real one does after a merge. */
const regenerates = (path) =>
  `import { writeFileSync } from 'node:fs';\n` +
  `writeFileSync(${JSON.stringify(path)}, 'regenerated from the merged tree\\n');\n`;

/** Builds the fixture under `dir`, runs the script in it, and returns what the index then holds. */
function runForReal(dir) {
  const repo = join(dir, 'repo');
  const npm = join(dir, 'npm');
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: ENV });
  const must = (result, what) => {
    if (result.status === 0) return result;
    throw new Error(`fixture: ${what} exited ${result.status}:\n${result.stdout}${result.stderr}`);
  };
  const setup = (...args) => must(git(...args), `git ${args.join(' ')}`);
  const write = (path, body) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  };

  mkdirSync(npm);
  writeFileSync(join(npm, 'npx-cli.js'), NPX_STAND_IN);
  mkdirSync(repo);
  setup('init', '--quiet', '--initial-branch=main');
  setup('config', 'user.email', 'selftest@example.invalid');
  setup('config', 'user.name', 'Sync Selftest');
  setup('config', 'commit.gpgsign', 'false');
  setup('config', 'core.autocrlf', 'false');
  // No user-wide ignore file: one naming `launch.json` would let the controls below pass for the
  // wrong reason. `ignored` records whether anything else ignores the machine-local files.
  setup('config', 'core.excludesFile', join(dir, 'no-such-ignore-file'));

  // The base: the mirrors in step with `.cursor/`, but each with an older notice.
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(
    join(REPO, 'scripts', 'mirror-agent-config.mjs'),
    join(repo, 'scripts', 'mirror-agent-config.mjs'),
  );
  write('tools/i18n/platform-english.mjs', regenerates(DERIVED.fallback));
  write('scripts/beta-harness/api-surface.mjs', regenerates(DERIVED.apiSnapshot));
  write(DERIVED.fallback, 'before the merge\n');
  write(DERIVED.apiSnapshot, 'before the merge\n');
  write('.cursor/skills/existing/SKILL.md', '# A skill both branches have\n');
  write('.cursor/agents/auditor.md', '# An agent\n');
  write('.cursor/rules/retired.mdc', 'The only rule, which the merged branch retires.\n');
  const mirror = ['scripts/mirror-agent-config.mjs', 'sync'];
  must(spawnSync(process.execPath, mirror, { cwd: repo, encoding: 'utf8', env: ENV }), 'mirror');
  for (const target of ['.claude', '.agent']) write(`${target}/MIRROR.md`, 'An older notice.\n');
  setup('add', '-A');
  setup('commit', '--quiet', '-m', 'base');

  // The merged tree, staged as a merge leaves it: a skill edited, one added, the only rule retired.
  write('.cursor/skills/existing/SKILL.md', '# A skill both branches have, edited on one\n');
  write('.cursor/skills/new-skill/SKILL.md', '# A skill the merged branch adds\n');
  rmSync(join(repo, '.cursor', 'rules', 'retired.mdc'));
  // And a new file in every other directory this repository's `.cursor/` has, so a subtree the
  // mirror script starts copying is exercised here without anyone adding it. Not `rules/`: its
  // last file going is the case where staging narrower than `.claude/` could drop a deletion.
  for (const entry of readdirSync(join(REPO, '.cursor'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'rules')
      write(`.cursor/${entry.name}/selftest-seed.md`, `# Seeded into ${entry.name}/\n`);
  }
  setup('add', '-A', '--', '.cursor');
  for (const [path, body] of Object.entries(MACHINE_LOCAL)) write(path, body);

  // Exit 1 with no output is "none of them is ignored"; 0 names the ignored ones, 128 is an error.
  const ignoring = git('check-ignore', '--', ...Object.keys(MACHINE_LOCAL));
  const ignored = [ignoring.status, ignoring.stdout.trim()];
  const run = spawnSync(process.execPath, [SCRIPT, '--no-gates'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...ENV, npm_execpath: join(npm, 'npm-cli.js') },
  });
  const status = Object.fromEntries(
    setup('status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames')
      .stdout.split('\0')
      .filter(Boolean)
      .map((entry) => [entry.slice(3), entry.slice(0, 2)]),
  );
  return { ignored, run, out: `${run.stdout}${run.stderr}`, status };
}

{
  const dir = mkdtempSync(join(tmpdir(), 'sync-derived-run-'));
  try {
    const { ignored, run, out, status } = runForReal(dir);
    const of = (...paths) => paths.map((path) => status[path] ?? 'unchanged');

    // Preconditions, not claims: the run finished, its build went to the stand-in rather than a
    // real npx, and nothing ignores the machine-local files, without which the two negative
    // controls below would pass on the ignore rules instead of on the script.
    controls += 1;
    if (run.status !== 0) failures.push(`a real run: exited ${run.status}, expected 0:\n${out}`);
    check(
      'a real run: the platform build went to the npx stand-in',
      /^npx stand-in: \["nx","build","platform","--skip-nx-cache"\]$/m.test(out),
      true,
    );
    check('a real run: nothing ignores the machine-local files', ignored, [1, '']);

    // Negative controls, load-bearing: the file #628 committed, and the same case in `.agent/`.
    check(
      'a real run leaves an untracked .claude/launch.json unstaged',
      of('.claude/launch.json'),
      ['??'],
    );
    check(
      'a real run leaves an untracked file elsewhere in .agent/ unstaged',
      of('.agent/notes.local.md'),
      ['??'],
    );

    // Positive controls: what the mirror and the stand-ins wrote is staged, in both mirrors.
    check(
      'a real run stages a skill the mirror added',
      of('.claude/skills/new-skill/SKILL.md', '.agent/skills/new-skill/SKILL.md'),
      ['A ', 'A '],
    );
    check(
      'a real run stages a skill the mirror rewrote',
      of('.claude/skills/existing/SKILL.md', '.agent/skills/existing/SKILL.md'),
      ['M ', 'M '],
    );
    check(
      'a real run stages the removal of the last file in a mirrored subtree',
      of('.claude/rules/retired.mdc', '.agent/rules/retired.mdc'),
      ['D ', 'D '],
    );
    check(
      'a real run stages the MIRROR.md notices the mirror rewrote',
      of('.claude/MIRROR.md', '.agent/MIRROR.md'),
      ['M ', 'M '],
    );
    check(
      'a real run stages the derived files it regenerated',
      of(DERIVED.fallback, DERIVED.apiSnapshot),
      ['M ', 'M '],
    );

    // And across the whole tree: everything the run wrote is in the index, and the only changes
    // left out of it are the machine-local files.
    check(
      'a real run leaves out of the index only the machine-local files',
      Object.keys(status)
        .filter((path) => status[path][1] !== ' ')
        .sort(),
      Object.keys(MACHINE_LOCAL).sort(),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`sync-derived selftest: ${controls} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('All controls behaved as required.');
