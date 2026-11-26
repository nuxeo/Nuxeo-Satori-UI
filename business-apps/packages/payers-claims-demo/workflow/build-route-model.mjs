#!/usr/bin/env node
/**
 * Write the kit's route model zips, `bundle/data/<model>.zip`, each from its source,
 * `workflow/<model>/` (route-model.mjs says how, and why the bytes never vary): the claims review's,
 * `PayersClaimReview`, and since 0.7.0 the appeal review's, `PayersAppealReview`.
 *
 *   node business-apps/packages/payers-claims-demo/workflow/build-route-model.mjs [--check]
 *
 * The zips are committed, because the package's `build.mjs` is the generator's, byte for byte, and
 * packages what `bundle/` holds. Run this after changing a source. `--check` writes nothing and
 * fails when a committed zip is not what its source gives, which `route-model.selftest.mjs` runs.
 *
 * It runs unconditionally, with no "was I started directly?" guard.
 *
 * Exit codes: 0, written or up to date; 1, a zip differs (`--check`) or a source is refused;
 * 2, the command was wrong.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { KIT, MODELS, routeModelZip, sourceOf, zipOf } from './route-model.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) {
  console.error('usage: node build-route-model.mjs [--check]');
  process.exit(2);
}
const check = args.includes('--check');

const built = new Map();
for (const model of MODELS) {
  try {
    built.set(model, routeModelZip(sourceOf(model)));
  } catch (error) {
    console.error(`route model ${model} not built: ${error.message}`);
    process.exit(1);
  }
}
let differs = false;
for (const [model, bytes] of built) {
  const zip = zipOf(model);
  const where = relative(process.cwd(), zip) || zip;
  if (check) {
    const committed = existsSync(zip) ? readFileSync(zip) : null;
    if (committed === null || !committed.equals(bytes)) {
      console.error(
        `${where} is ${committed === null ? 'missing' : 'not what its source gives'}: run ` +
          `node ${relative(process.cwd(), `${KIT}/workflow/build-route-model.mjs`)} after changing ` +
          `${relative(process.cwd(), sourceOf(model))}/`,
      );
      differs = true;
      continue;
    }
    console.log(`${where} is the route model's source, byte for byte (${bytes.length} bytes).`);
    continue;
  }
  mkdirSync(dirname(zip), { recursive: true });
  writeFileSync(zip, bytes);
  console.log(`wrote ${where} (${bytes.length} bytes)`);
}
process.exit(differs ? 1 : 0);
