#!/usr/bin/env node
/**
 * Exports a Nuxeo server's content model to a file, for the package pipeline's `--model`
 * (docs/business-apps/package-pipeline.md, section 4):
 *
 *   NUXEO_USER=<user> NUXEO_PASS=<password> \
 *     node scripts/app-package-model.mjs --server <address> --out <file>
 *
 * The export is `scripts/package-pipeline/model-export.mjs`'s, which `satori model pull` runs too
 * (`tools/satori-cli`): one implementation, which this file gives this repository's validator to
 * read the file back with. What it reads, and where the credentials go, is in that file's header.
 *
 * It runs unconditionally, as `app-package.mjs` does: a "was I started directly?" guard is how
 * another gate here once exited 0 having checked nothing.
 *
 * Exit codes: 0, written; 1, the server's answer could not be read; 2, the command was wrong, the
 * credentials are not set, or the answer could not be written to `--out`.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelExportCommand } from './package-pipeline/model-export.mjs';

process.exit(
  await modelExportCommand(process.argv.slice(2), {
    usage: 'usage: node scripts/app-package-model.mjs --server <address> --out <file>',
    validator: [
      process.execPath,
      join(
        resolve(dirname(fileURLToPath(import.meta.url)), '..'),
        'libs',
        'shared',
        'app-definition',
        'src',
        'bin.mjs',
      ),
    ],
  }),
);
