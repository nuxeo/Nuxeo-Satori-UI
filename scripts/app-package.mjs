#!/usr/bin/env node
/**
 * The package pipeline's first stage, for one app definition package
 * (docs/business-apps/package-pipeline.md): check it, build it, verify the zip, and write its
 * checksum. Signing and publishing are the workflow's (`.github/workflows/app-packages.yml`), which
 * runs them on the zip this writes and never on the package's own code.
 *
 *   node scripts/app-package.mjs <package directory> [--out <directory>] [--tag <tag>]
 *     [--allow-list <file>] [--registered <file>] [--platform <version>]
 *     [--model <file> | --model-server <address>] [--previous <package directory>]
 *     [--previous-platform <repository>] [--kits <folder>]
 *
 * The steps are `scripts/package-pipeline/pipeline.mjs`'s, which `@nuxeo/satori-cli` runs too
 * (`tools/satori-cli`): one implementation, which this file gives this repository's paths. Here a
 * package is an app definition, with an `app.json`; its `build.mjs` is the generator's, byte for
 * byte, and is what step 4 runs; and a kit in `business-apps/packages/` is compared with the
 * others there. The validator runs from its TypeScript, through the hook imported below, and so
 * does the upgrade check (`app-upgrade-check.mjs`).
 *
 * Node 24 and the system's `unzip` run all of it: no install and no credential. It runs
 * unconditionally. A "was I started directly?" guard is how another gate here once exited 0 having
 * checked nothing, so its controls (`app-package.selftest.mjs`) run it as CI does: as a command.
 *
 * Exit codes: 0, built; 1, refused; 2, the command was wrong.
 */
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../libs/shared/app-definition/src/typescript-hook.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = join(REPO, 'tools', 'satori-generators', 'src', 'config-package', 'files');
const { pipelineCommand } = await import('./package-pipeline/pipeline.mjs');

process.exit(
  await pipelineCommand(process.argv.slice(2), {
    usage:
      'usage: node scripts/app-package.mjs <package directory> [--out <directory>] [--tag <tag>]' +
      ' [--allow-list <file>] [--registered <file>] [--platform <version>]' +
      ' [--model <file> | --model-server <address>] [--previous <package directory>]' +
      ' [--previous-platform <repository>] [--kits <folder>]',
    validator: [process.execPath, join(REPO, 'libs', 'shared', 'app-definition', 'src', 'bin.mjs')],
    upgradeCheck: [process.execPath, join(REPO, 'scripts', 'app-upgrade-check.mjs')],
    catalogue: join(REPO, 'apps', 'nuxeo-ui', 'public', 'i18n', 'en.json'),
    kits: join(REPO, 'business-apps', 'packages'),
    builder: {
      template: join(GENERATOR, 'build.mjs__tmpl__'),
      shownTemplate: relative(REPO, join(GENERATOR, 'build.mjs__tmpl__')),
      runs: 'package',
    },
    requireApp: true,
    schemas: {
      bootstrap: join(GENERATOR, 'schema', 'bootstrap.schema.json__tmpl__'),
      manifest: join(GENERATOR, 'schema', 'manifest.schema.json__tmpl__'),
    },
    platformVersion: undefined,
  }),
);
