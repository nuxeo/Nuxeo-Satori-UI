#!/usr/bin/env node
/**
 * Whether an app definition package is ready for a person to release it, and the tag they push to
 * release it (docs/business-apps/package-pipeline.md, section 9). The check is
 * `package-pipeline/release-check.mjs`'s, which `satori release-check` runs too; this gives it this
 * repository's pipeline, `app-package.mjs`, and what `app-packages.yml` does with the tag.
 *
 *   node scripts/app-release-check.mjs <package> [--previous <package directory>] [--json]
 *     [the options of app-package.mjs but --out, --tag and --previous]
 *
 * `--previous` goes to `app-upgrade-check.mjs`, which holds the package to the folder it names.
 *
 * It never makes or pushes a tag, publishes nothing and reads no credential.
 *
 * Exit codes: 0, ready; 1, not ready; 2, the command was wrong, or could not be run.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseCheckCommand } from './package-pipeline/release-check.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

process.exit(
  releaseCheckCommand(process.argv.slice(2), {
    usage:
      'usage: node scripts/app-release-check.mjs <package directory> [--previous <package directory>]' +
      " [--json] [app-package.mjs's options but --out and --tag]",
    pipeline: [process.execPath, join(REPO, 'scripts', 'app-package.mjs')],
    upgradeCheck: [process.execPath, join(REPO, 'scripts', 'app-upgrade-check.mjs')],
    program: 'app-release-check.mjs',
    after:
      'For the tag, app-packages.yml builds the package again, signs it and publishes it to Marketplace preprod.',
  }),
);
