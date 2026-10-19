import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageCommand, spawnToolSync, execToolSync, spawnTool } from './package-command.mjs';

const args = [
  'with spaces',
  'double"quote',
  "single'quote",
  '&',
  '|',
  '%PATH%',
  '^',
  '()',
  '',
  'a\\b\\',
  '雪',
];

test('npm and npx preserve argv, cwd, env and exit status without a shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'package tools & spaces '));
  try {
    const bin = join(dir, 'npm bin');
    mkdirSync(bin);
    const source = `process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),marker:process.env.TOOL_TEST}));process.exitCode=Number(process.env.TOOL_EXIT ?? 0);`;
    for (const tool of ['npm', 'npx']) writeFileSync(join(bin, `${tool}-cli.js`), source);
    // Platforms can spell the same cwd differently (macOS /var resolves to /private/var,
    // while Windows can preserve a junction). Compare directory identity on every OS.
    const cwdAlias = join(dir, 'cwd alias');
    symlinkSync(bin, cwdAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const options = {
      cwd: cwdAlias,
      encoding: 'utf8',
      env: { ...process.env, npm_execpath: join(bin, 'npm-cli.js'), TOOL_TEST: 'kept' },
    };
    const parseOutput = (output) => {
      const actual = JSON.parse(output);
      return { ...actual, cwd: realpathSync(actual.cwd) };
    };
    for (const tool of ['npm', 'npx']) {
      const invocation = packageCommand(tool, args, options);
      assert.equal(invocation.command, process.execPath);
      assert.deepEqual(invocation.args.slice(1), args);
      const spawned = spawnToolSync(tool, args, options);
      assert.equal(spawned.status, 0, spawned.error?.message ?? spawned.stderr);
      const expected = { args, cwd: realpathSync(cwdAlias), marker: 'kept' };
      assert.deepEqual(parseOutput(spawned.stdout), expected);
      assert.deepEqual(parseOutput(execToolSync(tool, args, options)), expected);
      const child = spawnTool(tool, args, options);
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
      assert.deepEqual(parseOutput(output), expected);
      assert.equal(
        spawnToolSync(tool, args, { ...options, env: { ...options.env, TOOL_EXIT: '7' } }).status,
        7,
      );
      assert.throws(
        () => execToolSync(tool, args, { ...options, env: { ...options.env, TOOL_EXIT: '7' } }),
        (error) => error.status === 7,
      );
    }
    assert.throws(() => spawnToolSync('npm', args, { ...options, shell: true }), /without a shell/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the installed npm and npx launch from a scratch directory without npm_execpath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'package-tool-smoke-'));
  try {
    const env = { ...process.env };
    delete env.npm_execpath;
    for (const tool of ['npm', 'npx']) {
      const result = spawnToolSync(tool, ['--version'], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nx uses its installed manifest bin rather than assuming a version-specific path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nx-tool-'));
  try {
    const pkg = join(dir, 'node_modules', 'nx');
    mkdirSync(join(pkg, 'custom bin'), { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'nx', bin: { nx: './custom bin/cli.cjs' } }),
    );
    writeFileSync(
      join(pkg, 'custom bin', 'cli.cjs'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));',
    );
    const result = spawnToolSync('nx', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
