#!/usr/bin/env node
/**
 * Controls for `scripts/sync-derived.mjs`: which conflicted paths it regenerates and which it
 * leaves for a person, which coverage entries it measures again, and what it does in a real
 * merge conflict. The fixtures are throwaway git repositories under the temp dir, run with
 * `--dry-run --no-gates`, so nothing here builds, measures or writes outside them.
 *
 * Usage: node scripts/sync-derived.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { DERIVED, disagreeingProjects, isDerived, planConflicts } from './sync-derived.mjs';

const SCRIPT = resolve(import.meta.dirname, 'sync-derived.mjs');
const failures = [];
let controls = 0;

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
  ['.cursor/skills/fix-bug/SKILL.md', false],
  ['.claude/settings.json', false],
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
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
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
  const env = { ...process.env };
  delete env.NX_BASE;
  const result = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--no-gates'], {
    cwd: dir,
    encoding: 'utf8',
    env,
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

console.log(`sync-derived selftest: ${controls} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log('All controls behaved as required.');
