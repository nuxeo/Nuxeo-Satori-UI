import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const projectConfig = readFileSync(
  join(root, 'libs/features/document-detail/vite.config.mts'),
  'utf8',
);

test('document-detail preserves native console output without pending console RPCs', () => {
  assert.match(projectConfig, /^\s*disableConsoleIntercept:\s*true,/m);
  const directory = mkdtempSync(join(root, '.windows-console-control-'));
  try {
    writeFileSync(
      join(directory, 'vitest.config.mjs'),
      `export default { test: {
        include: ['console.test.mjs'], pool: 'threads', disableConsoleIntercept: true
      } };`,
    );
    const cases = [
      {
        name: 'console output survives worker teardown',
        body: `test('passes', () => { expect(true).toBe(true); });
          afterAll(() => {
            console.error('CONSOLE_ERROR_REMAINS_VISIBLE');
            queueMicrotask(() => console.warn('TEARDOWN_WARNING_REMAINS_VISIBLE'));
          });`,
        status: 0,
        expected: ['CONSOLE_ERROR_REMAINS_VISIBLE', 'TEARDOWN_WARNING_REMAINS_VISIBLE'],
      },
      {
        name: 'an assertion failure still fails the runner',
        body: `test('fails', () => { expect('actual').toBe('expected'); });`,
        status: 1,
        expected: ['AssertionError'],
      },
      {
        name: 'an unhandled rejection still fails the runner',
        body: `test('rejects', async () => {
          Promise.reject(new Error('UNHANDLED_ERROR_REMAINS_FATAL'));
          await new Promise(resolve => setTimeout(resolve, 20));
        });`,
        status: 1,
        expected: ['UNHANDLED_ERROR_REMAINS_FATAL', 'Unhandled Rejection'],
      },
    ];
    for (const control of cases) {
      writeFileSync(
        join(directory, 'console.test.mjs'),
        `import { afterAll, expect, test } from 'vitest';\n${control.body}`,
      );
      const result = spawnSync(
        process.execPath,
        [vitest, 'run', '--config', 'vitest.config.mjs'],
        { cwd: directory, encoding: 'utf8', timeout: 60_000 },
      );
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      assert.ifError(result.error);
      assert.equal(result.status, control.status, `${control.name}\n${output}`);
      for (const expected of control.expected) {
        assert.ok(output.includes(expected), `${control.name}: missing ${expected}\n${output}`);
      }
      assert.ok(!output.includes('Closing rpc'), output);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
