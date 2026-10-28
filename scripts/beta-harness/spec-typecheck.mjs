#!/usr/bin/env node
import { spawnToolSync } from './package-command.mjs';

/**
 * Type-check every project's **spec** files.
 *
 * ## The hole this closes
 *
 * `CLAUDE.md` warns that `test` does not typecheck, because Vitest strips types through
 * esbuild, and points at `build` and `typecheck` as the gates that do. Both halves of that
 * were true and the conclusion was still wrong:
 *
 * - 19 of 27 projects had no `typecheck` target at all, so nothing type-checked them.
 * - The 8 that did pointed it at `tsconfig.lib.json`, which **excludes** `*.spec.ts` by
 *   construction. So no gate anywhere had ever type-checked a spec file.
 *
 * Turning it on found 43 errors across six projects. They were not cosmetic:
 *
 * - `libs/shared/nuxeo-client` alone held 18, in the most depended-on library in the repo.
 * - Nine were `params.get(x)?.includes(y)` returning `boolean | undefined` where the
 *   `HttpTestingController` matcher requires `boolean`.
 * - `create-import-dialog.component.spec.ts` asserted on `mock.calls[0][1]` of a `vi.fn()`
 *   declared with no parameters, so the argument it checked could not exist at the type level.
 * - One was a genuine production defect: `directoryPickerLabel` required a `label` its own
 *   body read with `?.` and the Nuxeo `SuggestEntries` payload omits.
 *
 * ## Why a workspace gate rather than 27 project targets
 *
 * A per-project target has to be added to each new project and silently covers nothing when
 * it is forgotten — which is exactly how 19 projects came to have none. This discovers
 * `tsconfig.spec.json` from disk, so a new library is covered the moment it has specs, and a
 * project cannot opt out by omission.
 *
 * Usage:
 *   node scripts/beta-harness/spec-typecheck.mjs
 *   node scripts/beta-harness/spec-typecheck.mjs --json
 *
 * Exit 1 if any spec file fails to type-check.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const asJson = process.argv.includes('--json');

/** Every `tsconfig.spec.json` under `apps/` and `libs/`, at any nesting depth. */
function findSpecConfigs(dir, depth = 0) {
  if (depth > 3) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = resolve(dir, name);
    if (!statSync(full).isDirectory()) continue;
    const config = resolve(full, 'tsconfig.spec.json');
    if (existsSync(config)) found.push(config);
    found.push(...findSpecConfigs(full, depth + 1));
  }
  return found;
}

const configs = [
  ...findSpecConfigs(resolve(repoRoot, 'apps')),
  ...findSpecConfigs(resolve(repoRoot, 'libs')),
].sort();

if (configs.length === 0) {
  console.error('spec-typecheck: found no tsconfig.spec.json at all. That is not a pass.');
  process.exit(1);
}

const results = [];
for (const config of configs) {
  const rel = relative(repoRoot, config);
  const proc = spawnToolSync('npx', ['tsc', '-p', config, '--noEmit'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  const errors = output.split('\n').filter((line) => / error TS\d+:/.test(line));
  results.push({ config: rel, ok: errors.length === 0, count: errors.length, errors });
  if (!asJson) {
    console.log(
      `  ${errors.length === 0 ? 'pass' : 'FAIL'}  ${rel}${errors.length ? ` (${errors.length})` : ''}`,
    );
  }
}

const failed = results.filter((r) => !r.ok);

if (asJson) {
  console.log(JSON.stringify({ ok: failed.length === 0, projects: results }, null, 2));
} else {
  console.log('');
  for (const r of failed) {
    for (const line of r.errors) console.log(`  ${line.trim()}`);
  }
  if (failed.length) {
    const total = failed.reduce((sum, r) => sum + r.count, 0);
    console.log(
      `\nspec-typecheck: FAIL — ${total} type error(s) in ${failed.length} project(s). ` +
        'A green test run is not type safety; Vitest strips these.',
    );
  } else {
    console.log(`spec-typecheck: pass — ${results.length} project(s) type-check their specs.`);
  }
}

process.exit(failed.length ? 1 : 0);
