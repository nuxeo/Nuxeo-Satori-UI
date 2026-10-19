#!/usr/bin/env node
/** Credential sensitivity control. See the historical rationale in e2e-negative-control.sh. */
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnToolSync } from './beta-harness/package-command.mjs';

export function minimumFailures(value = '5') {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error('min-expected-failures must be a positive safe integer (at least 1).');
  }
  return Number(value);
}

export function classifyFailures(report) {
  if (!Array.isArray(report.specs)) throw new Error('Assertion report has no specs array.');
  return {
    atAssertion: report.specs.filter((spec) => spec.failedAtAssertion),
    beforeAssertion: report.specs.filter((spec) => !spec.failedAtAssertion),
  };
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
  const results = resolve(root, 'dist/e2e/results.json');
  const assertions = resolve(root, 'dist/e2e/assertion-failures.json');
  for (const file of [results, assertions]) rmSync(file, { force: true });
  console.log(
    `E2E negative control: expect at least ${minimum} failing spec assertions with wrong credentials.`,
  );
  const preflight = spawnToolSync('npx', ['tsx', 'scripts/beta-harness/e2e-preflight.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (preflight.status !== 0) {
    console.error(
      'Preflight failed with correct credentials. Fix the environment before running the control.',
    );
    return 2;
  }
  const run = spawnToolSync(
    'npx',
    ['playwright', 'test', '-c', 'apps/nuxeo-ui-e2e/playwright.config.ts', '--project=chromium'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NUXEO_PASS: 'wrong' },
    },
  );
  if (!existsSync(results) || !existsSync(assertions)) {
    console.error(
      `Playwright exited ${run.status}; results.json or assertion-failures.json was not written. Check the reporters.`,
    );
    return 2;
  }
  let classified;
  try {
    classified = classifyFailures(JSON.parse(readFileSync(assertions, 'utf8')));
  } catch (error) {
    console.error(`Cannot read assertion report: ${error.message}`);
    return 2;
  }
  console.log(`Failures at a spec's own assertion: ${classified.atAssertion.length} (counted)`);
  console.log(
    `Failures without an assertion reached: ${classified.beforeAssertion.length} (excluded)`,
  );
  for (const [kind, specs] of Object.entries(classified)) {
    for (const spec of specs)
      console.log(`  ${kind}: ${spec.title} — ${spec.assertion?.where ?? spec.errorLocation}`);
  }
  const pass = classified.atAssertion.length >= minimum;
  console.log(
    pass
      ? 'PASS: Negative control succeeded — the counted assertions are CREDENTIAL-SENSITIVE.'
      : `FAIL: Negative control failed — fewer than ${minimum} specs failed at their own assertions.`,
  );
  console.log(
    'This measures dependence on a valid session. It does not establish that assertions read repository data, and says nothing about passing specs or failures before an assertion.',
  );
  return pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main();
