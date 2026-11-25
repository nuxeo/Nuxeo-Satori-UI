#!/usr/bin/env node
/**
 * npm run app-definition:server-validator [-- --check]
 *
 * Writes the validator the server runs and its parity corpus, or with `--check` exits 1 when the
 * committed ones are not what the source builds now (`server-validator-build.mjs`). It runs
 * unconditionally, as `bin.mjs` does: a "was I started directly?" guard is how a gate here once
 * exited 0 having checked nothing.
 *
 * Exit codes: 0, written or current; 1, out of date; 2, the command was wrong.
 */
import './typescript-hook.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { buildOutputs, outOfDate } from './server-validator-build.mjs';

const { validateDeploymentFile } = await import('./server-validator.ts');

const args = process.argv.slice(2);
const check = args.includes('--check');
if (args.some((arg) => arg !== '--check')) {
  console.error('usage: npm run app-definition:server-validator [-- --check]');
  process.exit(2);
}
const outputs = await buildOutputs(validateDeploymentFile);
const shown = (path) => relative(process.cwd(), path) || path;
if (check) {
  const stale = outOfDate(outputs);
  for (const { path } of stale)
    console.error(
      `${shown(path)} is not what server-validator.ts builds now: run npm run app-definition:server-validator and commit it.`,
    );
  if (stale.length > 0) process.exit(1);
  console.log(`${outputs.map(({ path }) => shown(path)).join(' and ')} are what server-validator.ts builds.`);
} else {
  for (const { path, text } of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`Wrote ${shown(path)}, ${text.length} bytes.`);
  }
}
