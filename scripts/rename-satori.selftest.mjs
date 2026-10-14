#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { applyPlan, main, planRename, readTree } from './rename-satori.mjs';

const SCRIPT = resolve(import.meta.dirname, 'rename-satori.mjs');
const OLD = '@nuxeo-satori' + '/platform';
const NEW = '@nuxeo' + '/satori-platform';
const tree = (entries) =>
  new Map(Object.entries(entries).map(([path, body]) => [path, Buffer.from(body)]));
const content = (plan, path) => plan.next.get(path).toString();
function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), 'rename-satori-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '--quiet');
  for (const [path, body] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  git('add', '.');
  git(
    '-c',
    'user.name=Codemod Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  return { root, git };
}

for (const path of [
  'apps/nuxeo-ui/src/app.ts',
  'apps/nuxeo-satori-template/src/app.ts',
  'libs/extensions/acme-extensions/src/index.ts',
  'tools/satori-generators/files/extension.ts.template',
  'tsconfig.base.json',
  'libs/platform/package.json',
  'docs/api/platform.api.md',
  'AGENTS.md',
  'package-lock.json',
  '.cursor/skills/example/SKILL.md',
])
  test(`renames package and secondary entries in ${path}`, () => {
    const body = `${OLD} ${OLD}/ui ${OLD}/components ${OLD}-extra`;
    const plan = planRename(tree({ [path]: body }));
    assert.equal(content(plan, path), `${NEW} ${NEW}/ui ${NEW}/components ${OLD}-extra`);
    assert.equal(plan.changes[0].edits[0].line, 1);
  });

test('renames locally owned selectors and path references, preserving upstream names and theme tokens', () => {
  const plan = planRename(
    tree({
      'libs/shared/adf-hx-bridge/src/hxp-widget.ts':
        "selector: 'hxp-widget', templateUrl: './hxp-widget.html'",
      'libs/shared/adf-hx-bridge/src/hxp-widget.html':
        '<hxp-widget /><hxp-upstream /> .hxp-widget { color: var(--hxp-widget); }',
      'app.ts': `import { HxpWidget } from '@agentic-ui/shared/adf-hx-bridge';\nconst route = 'browse-adf-hx';\nconst other = 'search-adf-hx';`,
      'upstream.ts':
        "const packageName = '@alfresco/adf-hx-content-services'; const url = 'https://example.com/adf-hx-bridge';",
    }),
  );
  assert.equal(
    content(plan, 'libs/shared/satori-bridge/src/nxs-widget.ts'),
    "selector: 'nxs-widget', templateUrl: './nxs-widget.html'",
  );
  assert.equal(
    content(plan, 'libs/shared/satori-bridge/src/nxs-widget.html'),
    '<nxs-widget /><hxp-upstream /> .nxs-widget { color: var(--hxp-widget); }',
  );
  assert.match(content(plan, 'app.ts'), /shared\/satori-bridge/);
  assert.match(content(plan, 'app.ts'), /browse-satori/);
  assert.match(content(plan, 'app.ts'), /search-satori/);
  assert.equal(
    plan.changes.some(({ from }) => from === 'upstream.ts'),
    false,
  );
  assert.equal(planRename(plan.next).changes.length, 0);
});

test('preserves CHANGELOG history at any depth, binaries and the codemod fixtures', () => {
  const files = tree({
    'CHANGELOG.md': OLD,
    'libs/platform/Changelog.md': OLD,
    'changelog/history.md': OLD,
    'scripts/rename-satori.mjs': OLD,
    'scripts/rename-satori.selftest.mjs': OLD,
    'binary.png': '\0' + OLD,
  });
  const plan = planRename(files);
  assert.equal(plan.changes.length, 0);
  for (const [path, body] of files) assert.deepEqual(plan.next.get(path), body);
});

test('renames BEM classes derived from local selectors and file stems only', () => {
  const plan = planRename(
    tree({
      'component.ts': "selector: 'hxp-widget'",
      'hxp-row.scss': '.hxp-row__cell {} .hxp-row--selected {}',
      'template.html':
        '<div class="hxp-widget__title hxp-widget--active hxp-widget__title--compact hxp-row__cell"></div>',
      'styles.scss':
        '.hxp-widget__title {} .hxp-widget--active {} .hxp-upstream__title {} .hxp-upstream--active {}\n' +
        '.hxp-widget-extra {} .hxp-widget_extra {} :root { --hxp-widget: red; --hxp-widget__title: blue; --hxp-widget--active: green; }',
    }),
  );
  assert.equal(content(plan, 'nxs-row.scss'), '.nxs-row__cell {} .nxs-row--selected {}');
  assert.equal(
    content(plan, 'template.html'),
    '<div class="nxs-widget__title nxs-widget--active nxs-widget__title--compact nxs-row__cell"></div>',
  );
  assert.equal(
    content(plan, 'styles.scss'),
    '.nxs-widget__title {} .nxs-widget--active {} .hxp-upstream__title {} .hxp-upstream--active {}\n' +
      '.hxp-widget-extra {} .hxp-widget_extra {} :root { --hxp-widget: red; --hxp-widget__title: blue; --hxp-widget--active: green; }',
  );
  assert.equal(planRename(plan.next).changes.length, 0);
});

test('working-tree mode skips unstaged tracked deletions and retains local edits', (t) => {
  const { root, git } = fixture(t, {
    'deleted.ts': OLD,
    'deleted-directory/child.ts': OLD,
    'edited.ts': OLD,
    'kept.ts': OLD,
  });
  rmSync(join(root, 'deleted.ts'));
  rmSync(join(root, 'deleted-directory'), { recursive: true });
  writeFileSync(join(root, 'edited.ts'), NEW);
  const files = readTree(root);
  assert.deepEqual([...files.keys()].sort(), ['edited.ts', 'kept.ts']);
  assert.equal(files.get('edited.ts').toString(), NEW);
  assert.ok(readTree(root, 'HEAD').has('deleted.ts'));
  const before = git('diff', '--binary');
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: 1 files, 0 moves, 1 changed lines/);
  assert.equal(git('diff', '--binary'), before);
});

test('reports both path and selector collisions', () => {
  const plan = planRename(
    tree({
      'hxp-widget.ts': "selector: 'hxp-widget'",
      'nxs-widget.ts': "selector: 'nxs-widget'",
    }),
  );
  assert.ok(plan.blockers.some((item) => item.startsWith('Path collision:')));
  assert.ok(plan.blockers.some((item) => item.startsWith('Destination already exists:')));
  assert.ok(plan.blockers.some((item) => item.startsWith('Selector collision:')));
});

test('dry run does not touch tracked or untracked files and reports each edit and move', (t) => {
  const { root, git } = fixture(t, {
    'adf-hx-bridge/hxp-widget.ts': `selector: 'hxp-widget'\nconst p = '${OLD}/ui';`,
    'CHANGELOG.md': OLD,
  });
  writeFileSync(join(root, 'untracked.ts'), OLD);
  const report = join(root, 'dry-run.json');
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--report', report], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('diff', '--stat'), '');
  assert.equal(readFileSync(join(root, 'untracked.ts'), 'utf8'), OLD);
  const data = JSON.parse(readFileSync(report));
  assert.equal(data.changedFiles, 1);
  assert.equal(data.movedFiles, 1);
  assert.deepEqual(
    data.changes[0].edits.map(({ line }) => line),
    [1, 2],
  );
  assert.equal(data.secondRunChanges, 0);
  assert.equal(data.commit, git('rev-parse', 'HEAD').trim());
});

test('a real write followed by a second write produces no incremental diff', (t) => {
  const { root, git } = fixture(t, {
    'adf-hx-bridge/hxp-widget.ts': `selector: 'hxp-widget'; const p = '${OLD}';`,
    'CHANGELOG.md': OLD,
  });
  const run = () =>
    spawnSync(process.execPath, [SCRIPT, '--root', root, '--write'], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(existsSync(join(root, 'adf-hx-bridge/hxp-widget.ts')), false);
  assert.match(readFileSync(join(root, 'satori-bridge/nxs-widget.ts'), 'utf8'), /nxs-widget/);
  git('add', '-A');
  const before = git('diff', '--cached', '--binary');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /write: 0 files, 0 moves, 0 changed lines/);
  assert.equal(git('diff', '--stat'), '');
  assert.equal(git('diff', '--cached', '--binary'), before);
  assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), OLD);
});

test('immutable ref mode ignores working edits and does not change HEAD', (t) => {
  const { root, git } = fixture(t, { 'a file.ts': OLD });
  const sha = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(root, 'a file.ts'), NEW);
  assert.equal(readTree(root, 'HEAD').get('a file.ts').toString(), OLD);
  assert.equal(planRename(readTree(root)).changes.length, 0);
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--ref', sha], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: 1 files/);
  assert.equal(git('rev-parse', 'HEAD').trim(), sha);
  assert.equal(readFileSync(join(root, 'a file.ts'), 'utf8'), NEW);
});

test('write refuses collisions before changing any source', (t) => {
  const { root, git } = fixture(t, {
    'old.ts': `selector: 'hxp-icon'; const p = '${OLD}';`,
    'new.ts': "selector: 'nxs-icon'",
  });
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--write'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Selector collision/);
  assert.equal(git('diff', '--stat'), '');
});

test('a stale source or newly occupied destination refuses the entire plan', (t) => {
  const { root, git } = fixture(t, { 'hxp-a.ts': OLD, 'z.ts': OLD });
  const files = readTree(root);
  const plan = planRename(files);
  writeFileSync(join(root, 'z.ts'), 'concurrent edit');
  assert.throws(() => applyPlan(root, files, plan), /Source changed/);
  assert.equal(existsSync(join(root, 'nxs-a.ts')), false);
  writeFileSync(join(root, 'z.ts'), OLD);
  writeFileSync(join(root, 'nxs-a.ts'), 'untracked destination');
  assert.throws(() => applyPlan(root, files, plan), /Destination already exists/);
  assert.equal(git('diff', '--stat'), '');
  assert.equal(readFileSync(join(root, 'nxs-a.ts'), 'utf8'), 'untracked destination');
});

test('rejects invalid CLI arguments and writing a ref', () => {
  assert.throws(() => main(['--unknown']), /Unknown option/);
  assert.throws(() => main(['--root']), /Missing value/);
  assert.throws(() => main(['--write', '--ref', 'HEAD']), /cannot be combined/);
});

test('rejects --write with --dry-run in either order before any changes', (t) => {
  const { root, git } = fixture(t, { 'a.ts': OLD });
  for (const flags of [
    ['--write', '--dry-run'],
    ['--dry-run', '--write'],
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...flags], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--write cannot be combined with --dry-run/);
    assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), OLD);
    assert.equal(git('diff', '--stat'), '');
  }
});

test('a destination created after preflight is preserved by exclusive creation', (t) => {
  const { root } = fixture(t, { 'hxp-a.ts': OLD });
  const files = readTree(root);
  const plan = planRename(files);
  const target = join(root, 'nxs-a.ts');
  const io = {
    ...fs,
    openSync(path, ...args) {
      if (path === target) writeFileSync(target, 'concurrent destination');
      return fs.openSync(path, ...args);
    },
  };
  assert.throws(() => applyPlan(root, files, plan, io), /Destination already exists/);
  assert.equal(readFileSync(target, 'utf8'), 'concurrent destination');
  assert.equal(readFileSync(join(root, 'hxp-a.ts'), 'utf8'), OLD);
});

test('exclusive moves preserve source permission bits', (t) => {
  const { root } = fixture(t, { 'hxp-script.sh': OLD });
  const source = join(root, 'hxp-script.sh');
  fs.chmodSync(source, 0o755);
  const mode = fs.statSync(source).mode & 0o777;
  const files = readTree(root);
  const originalMask = process.umask(0o077);
  try {
    applyPlan(root, files, planRename(files));
  } finally {
    process.umask(originalMask);
  }
  const target = join(root, 'nxs-script.sh');
  assert.equal(fs.statSync(target).mode & 0o777, mode);
  assert.equal(readFileSync(target, 'utf8'), NEW);
  assert.equal(existsSync(source), false);
});

test('per-mutation checks retain source edits made after preflight', (t) => {
  const { root } = fixture(t, { 'a.ts': OLD, 'z.ts': OLD });
  const files = readTree(root);
  const plan = planRename(files);
  const io = {
    ...fs,
    writeSync(...args) {
      const result = fs.writeSync(...args);
      writeFileSync(join(root, 'z.ts'), 'concurrent source edit');
      return result;
    },
  };
  assert.throws(() => applyPlan(root, files, plan, io), /Source changed: z.ts/);
  assert.equal(readFileSync(join(root, 'z.ts'), 'utf8'), 'concurrent source edit');
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), NEW);
});

test('in-place writes check their opened source before truncating it', (t) => {
  const { root } = fixture(t, { 'a.ts': OLD });
  const files = readTree(root);
  const plan = planRename(files);
  const target = join(root, 'a.ts');
  const io = {
    ...fs,
    openSync(path, ...args) {
      writeFileSync(target, 'edit before open');
      return fs.openSync(path, ...args);
    },
  };
  assert.throws(() => applyPlan(root, files, plan, io), /Source changed/);
  assert.equal(readFileSync(target, 'utf8'), 'edit before open');
});

test('a source edited while its move destination is written is retained', (t) => {
  const { root } = fixture(t, { 'hxp-a.ts': OLD });
  const files = readTree(root);
  const plan = planRename(files);
  const source = join(root, 'hxp-a.ts');
  const io = {
    ...fs,
    writeFileSync(...args) {
      fs.writeFileSync(...args);
      writeFileSync(source, 'edit during move');
    },
  };
  assert.throws(() => applyPlan(root, files, plan, io), /Source changed/);
  assert.equal(readFileSync(source, 'utf8'), 'edit during move');
  assert.equal(readFileSync(join(root, 'nxs-a.ts'), 'utf8'), NEW);
});

test('report cannot overwrite a tracked source', (t) => {
  const { root } = fixture(t, { 'a.ts': OLD });
  assert.throws(() => main(['--root', root, '--report', join(root, 'a.ts')]), /tracked file/);
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), OLD);
});

test('report cannot recreate a locally deleted tracked source', (t) => {
  const { root } = fixture(t, { 'deleted.ts': OLD });
  const target = join(root, 'deleted.ts');
  rmSync(target);
  assert.throws(() => main(['--root', root, '--report', target]), /tracked file/);
  assert.equal(existsSync(target), false);
});

test('report paths conservatively reject case-only aliases on every platform', (t) => {
  const { root } = fixture(t, { 'a.ts': OLD });
  assert.throws(() => main(['--root', root, '--report', join(root, 'A.ts')]), /tracked file/);
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), OLD);
});

test('report cannot overwrite a tracked source through an untracked hard-link alias', (t) => {
  const { root } = fixture(t, { 'a.ts': OLD });
  const target = join(root, 'alias.json');
  fs.linkSync(join(root, 'a.ts'), target);
  assert.throws(() => main(['--root', root, '--report', target]), /tracked file/);
  assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), OLD);
  assert.equal(readFileSync(target, 'utf8'), OLD);
});

test('report cannot recreate a deleted source through a directory alias', (t) => {
  const { root } = fixture(t, { 'tracked/a.ts': OLD });
  const alias = join(root, 'alias');
  fs.symlinkSync(join(root, 'tracked'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  rmSync(join(root, 'tracked/a.ts'));
  assert.throws(() => main(['--root', root, '--report', join(alias, 'a.ts')]), /tracked file/);
  assert.equal(existsSync(join(root, 'tracked/a.ts')), false);
});

test('Sass partial moves preserve underscore-free @use imports', () => {
  const plan = planRename(
    tree({
      'styles/_hxp-shared.scss': '.hxp-a {}',
      'styles/component.scss': "@use './hxp-shared';",
    }),
  );
  assert.ok(plan.next.has('styles/_nxs-shared.scss'));
  assert.equal(content(plan, 'styles/component.scss'), "@use './nxs-shared';");
  assert.equal(planRename(plan.next).changes.length, 0);
});
