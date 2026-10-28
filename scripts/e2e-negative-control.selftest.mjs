import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { minimumFailures, runVacuity } from './e2e-negative-control.mjs';

test('a symlinked CLI entry still rejects an invalid threshold', () => {
  // Node resolves the main module through links, so `import.meta.url` is the real path while
  // `process.argv[1]` keeps the alias. Comparing them unresolved skips `main()` and exits 0.
  const aliasRoot = mkdtempSync(join(tmpdir(), 'e2e-negative-control-selftest-'));
  try {
    const alias = join(aliasRoot, 'scripts');
    symlinkSync(import.meta.dirname, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const run = spawnSync(process.execPath, [join(alias, 'e2e-negative-control.mjs'), '0'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /min-expected-failures/);
  } finally {
    rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test('a threshold cannot make the negative control unconditional', () => {
  assert.equal(minimumFailures(), 5);
  assert.equal(minimumFailures('7'), 7);
  for (const invalid of ['0', '-1', '', 'abc', '1.5', '9007199254740992'])
    assert.throws(() => minimumFailures(invalid));
});

test('vacuity compares baseline and starved runs without corrupting credentials or artifacts', () => {
  const root = mkdtempSync(resolve(import.meta.dirname, '..', '.vacuity-test-'));
  const calls = [];
  try {
    const result = runVacuity(root, 5, (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'playwright') {
        for (const report of ['results.json', 'assertion-failures.json'])
          writeFileSync(resolve(root, 'dist', 'e2e', report), options.env.E2E_STARVE_APP);
        // The starved run is expected to fail; its reports still must reach the verdict.
        return { status: Number(options.env.E2E_STARVE_APP) };
      }
      return { status: 0 };
    });
    assert.equal(result, 0);
    assert.equal(calls.length, 4);
    assert.deepEqual(
      calls.slice(1, 3).map((call) => call.options.env.E2E_STARVE_APP),
      ['0', '1'],
    );
    for (const call of calls.slice(1, 3)) {
      assert.equal(call.options.env.NUXEO_PASS, process.env.NUXEO_PASS);
      assert.ok(call.args.includes('--retries=0'));
    }
    assert.notEqual(calls[1].args.at(-1), calls[2].args.at(-1));
    for (const [index, name] of ['baseline', 'starved'].entries())
      assert.equal(
        readFileSync(resolve(root, 'dist', 'e2e', `vacuity-${name}`, 'results.json'), 'utf8'),
        String(index),
      );
    assert.equal(calls[3].args[0], 'scripts/beta-harness/vacuity-verdict.mjs');
    assert.equal(calls[3].args.at(-1), '5');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing reports or failed preflight are environment errors, not vacuity verdicts', () => {
  const root = mkdtempSync(resolve(import.meta.dirname, '..', '.vacuity-test-'));
  try {
    assert.equal(
      runVacuity(root, 5, () => ({ status: 2 })),
      2,
    );
    assert.equal(
      runVacuity(root, 5, () => ({ status: 0 })),
      2,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing data-sensitivity verdict remains a failure', () => {
  const root = mkdtempSync(resolve(import.meta.dirname, '..', '.vacuity-test-'));
  try {
    assert.equal(
      runVacuity(root, 5, (command, args) => {
        if (args[0] === 'playwright') {
          for (const report of ['results.json', 'assertion-failures.json'])
            writeFileSync(resolve(root, 'dist', 'e2e', report), '{}');
        }
        return { status: command === process.execPath ? 1 : 0 };
      }),
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
