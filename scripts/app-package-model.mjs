#!/usr/bin/env node
/**
 * Exports a Nuxeo server's content model to a file, for the package pipeline's `--model`
 * (docs/business-apps/package-pipeline.md, section 4):
 *
 *   NUXEO_USER=<user> NUXEO_PASS=<password> \
 *     node scripts/app-package-model.mjs --server <address> --out <file>
 *
 * The file is `{ doctypes, facets, schemas }`, read as `nuxeo-content-model.mjs` says, so a
 * package's checks can hold its layouts to the model where no server or credential is: in a pull
 * request, for one. The credentials come from the environment only, and are not written anywhere.
 * Once written, the file is read back as `--model` reads it, with the validator's `model` command:
 * an answer the validator could not read whole is removed, not left for `--model` to refuse.
 *
 * It runs unconditionally, as `app-package.mjs` does: a "was I started directly?" guard is how
 * another gate here once exited 0 having checked nothing.
 *
 * Exit codes: 0, written; 1, the server's answer could not be read; 2, the command was wrong, or
 * the credentials are not set.
 */
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_PRECONDITION,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from './beta-harness/nuxeo-credentials.mjs';
import { readServerModel, serverBase, withoutCredentials } from './nuxeo-content-model.mjs';

const USAGE = 'usage: node scripts/app-package-model.mjs --server <address> --out <file>';
const VALIDATOR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  'libs',
  'shared',
  'app-definition',
  'src',
  'bin.mjs',
);

const argv = process.argv.slice(2);
const options = {};
for (let index = 0; index < argv.length; index += 2) {
  const [key, value] = [argv[index], argv[index + 1]];
  if (!['--server', '--out'].includes(key) || value === undefined || value.startsWith('--')) {
    console.error(USAGE);
    process.exit(2);
  }
  options[key.slice(2)] = value;
}
if (!options.server || !options.out) {
  console.error(USAGE);
  process.exit(2);
}
const where = serverBase(options.server);
if (where.problem) {
  console.error(`--server: ${where.problem}\n${USAGE}`);
  process.exit(2);
}
const credentials = readNuxeoCredentials();
if (!credentials) {
  console.error(missingNuxeoCredentialsMessage(`read the content model of ${where.base}`));
  process.exit(EXIT_PRECONDITION);
}
try {
  const model = await readServerModel(where.base, credentials);
  writeFileSync(options.out, `${JSON.stringify(model, null, 2)}\n`);
  const check = spawnSync(process.execPath, [VALIDATOR, 'model', options.out], {
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (check.status !== 0) {
    rmSync(options.out, { force: true });
    process.stderr.write(check.stdout ?? '');
    process.stderr.write(check.stderr ?? '');
    throw new Error('the validator cannot read its answer as a content model, so no file is left');
  }
  process.stdout.write(
    `${options.out}: the content model of ${where.base}, ${Object.keys(model.doctypes).length} document types, ` +
      `${model.facets.length} facets and ${model.schemas.length} schemas.\n`,
  );
} catch (error) {
  console.error(`The content model of ${where.base} was not read: ${error.message}`);
  process.exit(1);
}
