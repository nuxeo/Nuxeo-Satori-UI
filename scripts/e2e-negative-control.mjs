#!/usr/bin/env node
/**
 * Vacuity control: compare a normal run with E2E_STARVE_APP=1, preserving both sets of reports.
 * Wrong credentials fail in identity setup before assertions run and cannot measure data sensitivity.
 * Discovery requests and /me remain live; only the app's repository responses are starved.
 */
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnToolSync } from './beta-harness/package-command.mjs';

export function minimumFailures(value = '5') {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error('min-expected-failures must be a positive safe integer (at least 1).');
  }
  return Number(value);
}

export function runVacuity(root, minimum, run = spawnToolSync) {
  const out = resolve(root, 'dist', 'e2e');
  const reports = ['results.json', 'assertion-failures.json'];
  const directories = ['vacuity-baseline', 'vacuity-starved'].map((name) => resolve(out, name));
  for (const directory of directories) {
    rmSync(directory, { force: true, recursive: true });
    mkdirSync(directory, { recursive: true });
  }
  for (const report of reports) rmSync(resolve(out, report), { force: true });
  const preflight = run('npx', ['tsx', 'scripts/beta-harness/e2e-preflight.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (preflight.status !== 0) return 2;
  for (const [index, directory] of directories.entries()) {
    const child = run(
      'npx',
      [
        'playwright',
        'test',
        '-c',
        'apps/nuxeo-ui-e2e/playwright.config.ts',
        '--project=chromium',
        '--retries=0',
        '--output',
        resolve(directory, 'artifacts'),
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, E2E_STARVE_APP: String(index) },
      },
    );
    if (child.error || child.signal) return 2;
    for (const report of reports) {
      const source = resolve(out, report);
      if (!existsSync(source)) {
        console.error(`${source} was not written by run ${index + 1}; no verdict can be read.`);
        return 2;
      }
      renameSync(source, resolve(directory, report));
    }
  }
  const verdict = run(
    process.execPath,
    [
      'scripts/beta-harness/vacuity-verdict.mjs',
      resolve(directories[0], reports[0]),
      resolve(directories[1], reports[0]),
      resolve(directories[1], reports[1]),
      String(minimum),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  return verdict.status ?? 2;
}

function main() {
  let minimum;
  try {
    minimum = minimumFailures(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const root = resolve(import.meta.dirname, '..');
  return runVacuity(root, minimum);
}

// Node loads the main module by its real path, so an aliased entry must be resolved to match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  process.exitCode = main();
