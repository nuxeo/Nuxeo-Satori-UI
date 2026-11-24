#!/usr/bin/env node
/**
 * Write the claims review workflow's route model zip, `bundle/data/PayersClaimReview.zip`, from its
 * source, `workflow/PayersClaimReview/` (route-model.mjs says how, and why the bytes never vary).
 *
 *   node business-apps/packages/payers-claims-demo/workflow/build-route-model.mjs [--check]
 *
 * The zip is committed, because the package's `build.mjs` is the generator's, byte for byte, and
 * packages what `bundle/` holds. Run this after changing the source. `--check` writes nothing and
 * fails when the committed zip is not what the source gives, which `route-model.selftest.mjs` runs.
 *
 * It runs unconditionally, with no "was I started directly?" guard.
 *
 * Exit codes: 0, written or up to date; 1, the zip differs (`--check`) or the source is refused;
 * 2, the command was wrong.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { KIT, SOURCE, ZIP, routeModelZip } from './route-model.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) {
  console.error('usage: node build-route-model.mjs [--check]');
  process.exit(2);
}
const check = args.includes('--check');

let built;
try {
  built = routeModelZip();
} catch (error) {
  console.error(`route model not built: ${error.message}`);
  process.exit(1);
}
const where = relative(process.cwd(), ZIP) || ZIP;
const committed = existsSync(ZIP) ? readFileSync(ZIP) : null;
if (check) {
  if (committed === null || !committed.equals(built)) {
    console.error(
      `${where} is ${committed === null ? 'missing' : 'not what its source gives'}: run ` +
        `node ${relative(process.cwd(), `${KIT}/workflow/build-route-model.mjs`)} after changing ` +
        `${relative(process.cwd(), SOURCE)}/`,
    );
    process.exit(1);
  }
  console.log(`${where} is the route model's source, byte for byte (${built.length} bytes).`);
  process.exit(0);
}
mkdirSync(dirname(ZIP), { recursive: true });
writeFileSync(ZIP, built);
console.log(`wrote ${where} (${built.length} bytes)`);
