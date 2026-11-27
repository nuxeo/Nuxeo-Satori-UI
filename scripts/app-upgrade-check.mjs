#!/usr/bin/env node
/**
 * The upgrade check (docs/business-apps/package-pipeline.md, section 10), as this repository runs
 * it: moving a kit, or the platform under it, from one version to the next must keep every
 * customer configuration made on the version before.
 *
 *   node scripts/app-upgrade-check.mjs [<package directory>...] --since <git ref>
 *     [--root <repository>] [--deployment <file>] [--json]
 *   node scripts/app-upgrade-check.mjs <package directory> --previous <package directory>
 *     [--previous-platform <repository>] [--root <repository>] [--deployment <file>] [--json]
 *   node scripts/app-upgrade-check.mjs --export <git ref> <directory> [--root <repository>]
 *   node scripts/app-upgrade-check.mjs --place-at <git ref> <package directory> [--root <repository>]
 *   node scripts/app-upgrade-check.mjs <package directory> --server <address>
 *     [--previous <package directory>] [--root <repository>] [--json]
 *
 * The check is `scripts/package-pipeline/upgrade-check.mjs`'s, which `satori upgrade-check` runs
 * too (`tools/satori-cli`): one implementation, which this file gives this repository as the
 * platform as it is, and the server half, `app-upgrade-server.mjs`. What it refuses, and why, is in
 * that file's header. The library's TypeScript loads through the hook imported below.
 *
 * It runs unconditionally, as the pipeline's scripts do.
 *
 * Exit codes: 0, every configuration is kept; 1, one is not; 2, the command was wrong.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../libs/shared/app-definition/src/typescript-hook.mjs';

const USAGE =
  'usage: node scripts/app-upgrade-check.mjs [<package directory>...] --since <git ref> [--root <repository>]' +
  ' [--deployment <file>] [--json]\n' +
  '       node scripts/app-upgrade-check.mjs <package directory> --previous <package directory>' +
  ' [--previous-platform <repository>] [--root <repository>] [--deployment <file>] [--json]\n' +
  '       node scripts/app-upgrade-check.mjs --export <git ref> <directory> [--root <repository>]\n' +
  '       node scripts/app-upgrade-check.mjs --place-at <git ref> <package directory> [--root <repository>]\n' +
  '       node scripts/app-upgrade-check.mjs <package directory> --server <address> [--previous <package directory>]' +
  ' [--root <repository>] [--json]';

const { main, parse, Usage } = await import('./package-pipeline/upgrade-check.mjs');

const options = parse(process.argv.slice(2));
if (!options) {
  console.error(USAGE);
  process.exit(2);
}
try {
  process.exit(
    await main(options, {
      root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      serverHalf: () => import('./app-upgrade-server.mjs'),
    }),
  );
} catch (error) {
  // Any run that ends here could not be made, so it exits 2: a crash must not read as "not kept".
  // The server half's refusals are said as the command's own errors are: the message alone.
  console.error(
    error instanceof Usage || error?.name === 'Refusal'
      ? `app-upgrade-check: ${error.message}`
      : error,
  );
  process.exit(2);
}
