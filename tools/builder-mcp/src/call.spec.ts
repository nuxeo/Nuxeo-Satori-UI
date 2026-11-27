/**
 * `call.ts`, one call to the server from a shell, run as a person runs it: a command, which starts
 * the real entry point over stdio. No Nuxeo is read: the environment has no credentials.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';

const CALL = fileURLToPath(new URL('./call.ts', import.meta.url));

function call(args: string[], input?: string) {
  const env = { ...process.env };
  for (const key of ['NUXEO_URL', 'NUXEO_USER', 'NUXEO_PASS', 'BUILDER_PACKAGE_ROOTS'])
    delete env[key];
  const run = spawnSync(process.execPath, [CALL, ...args], {
    encoding: 'utf8',
    env,
    input,
    timeout: 300_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('call.ts', () => {
  it("lists the server's tools, the write tools among them", () => {
    const listed = call(['--list']);
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toContain(
      'remove_package_file: Remove a package file, if the result validates\n',
    );
    expect(listed.stdout).toContain('get_content_model: Content model\n');
  });

  it("prints a tool's error to stderr and exits 1, the credentials it lacks named, not given", () => {
    const refused = call(['get_content_model']);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('NUXEO_USER and NUXEO_PASS must both be set');
  });

  it('refuses arguments that are not one JSON object, and a tool the server has not', () => {
    expect(call(['validate_package', 'not json']).status).toBe(2);
    expect(call(['validate_package', '[1]']).status).toBe(2);
    const unknown = call(['no_such_tool']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('no_such_tool');
    // Arguments the tool does not take: the server's refusal, exit 1, and no usage text.
    const wrong = call(['validate_package', '{ "package": 3 }']);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).not.toContain('usage:');
  });

  it("starts the server with nothing of the shell's but what it reads and what Node needs", () => {
    // NODE_OPTIONS loads a probe into every Node process that is given it: call.ts is, and the
    // server must not be. The probe writes down, in the server only, the variables it was given.
    const scratch = mkdtempSync(join(tmpdir(), 'builder-call-'));
    const seen = join(scratch, 'seen.txt');
    const probe = join(scratch, 'probe.cjs');
    writeFileSync(
      probe,
      `if ((process.argv[1] || '').endsWith('main.ts')) require('node:fs').writeFileSync(${JSON.stringify(seen)}, Object.keys(process.env).sort().join('\\n'));\n`,
    );
    try {
      const run = spawnSync(process.execPath, [CALL, '--list'], {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'],
          NODE_OPTIONS: `--require ${probe}`,
          UNRELATED_SETTING: 'for another tool',
        },
        timeout: 120_000,
      });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('get_content_model: Content model');
      // Given the whole environment, the server would have loaded the probe, and written its keys.
      expect(existsSync(seen) ? readFileSync(seen, 'utf8') : 'not loaded').toBe('not loaded');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it.skipIf(!PIPELINE_TESTS_RUN)('validates a kit, its arguments read from standard input', () => {
    const checked = call(
      ['validate_package', '-'],
      '{ "package": "business-apps/packages/facilities-demo" }',
    );
    expect(checked.status, checked.stderr).toBe(0);
    expect(JSON.parse(checked.stdout)).toMatchObject({ passed: true, asCi: true });
  });
});
