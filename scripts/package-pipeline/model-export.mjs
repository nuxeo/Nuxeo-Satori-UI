/**
 * Exports a Nuxeo server's content model to a file, for the package pipeline's `--model`
 * (docs/business-apps/package-pipeline.md, section 4). One implementation, which two commands run:
 * `scripts/app-package-model.mjs` here, and `satori model pull` (`tools/satori-cli`), each giving
 * `modelExportCommand` its usage line and the validator it reads the file back with.
 *
 *   NUXEO_USER=<user> NUXEO_PASS=<password> <command> --server <address> --out <file>
 *
 * The file is `{ doctypes, facets, schemas }`, read as `nuxeo-content-model.mjs` says, so a
 * package's checks can hold its layouts to the model where no server or credential is: in a pull
 * request, for one. It reads only: `GET`s of the server's configuration endpoints. The credentials
 * come from the environment only, and are not written anywhere. Once written, the file is read back
 * as `--model` reads it, with the validator's `model` command: an answer the validator could not
 * read whole is removed, not left for `--model` to refuse.
 *
 * The folder `--out` names is made when it is not there, as the pipeline makes its `--out`: a
 * repository `satori create` writes has no `tmp/`, and the customer's guide gives `--out
 * tmp/content-model.json`. Under Node's permission model, an `--out` the process may not write and
 * read back is refused before the server is asked, so that nothing is read for a file that cannot be
 * kept; the folders a run made are removed again when it leaves no file in them.
 *
 * Exit codes: 0, written; 1, the server's answer could not be read; 2, the command was wrong, the
 * credentials are not set, or the answer could not be written to `--out`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  EXIT_PRECONDITION,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from '../beta-harness/nuxeo-credentials.mjs';
import { readServerModel, serverBase, withoutCredentials } from '../nuxeo-content-model.mjs';

/**
 * The export, as a command: `argv` is `--server <address> --out <file>`, in either order, or
 * `--out <file>` alone with `NUXEO_URL` set, its `/nuxeo`, so that the command an agent runs
 * names no variable, which Claude Code cannot check before it runs. `host`
 * gives `usage`, said with every command-line error, and `validator`, the command that runs the
 * app definition's validator, given `model <file>`.
 */
export async function modelExportCommand(argv, host) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!['--server', '--out'].includes(key) || value === undefined || value.startsWith('--')) {
      console.error(host.usage);
      return 2;
    }
    options[key.slice(2)] = value;
  }
  if (!options.server && process.env.NUXEO_URL)
    options.server = `${process.env.NUXEO_URL.replace(/\/+$/, '').replace(/\/nuxeo$/, '')}/nuxeo`;
  if (!options.server || !options.out) {
    console.error(host.usage);
    return 2;
  }
  const where = serverBase(options.server);
  if (where.problem) {
    console.error(`--server: ${where.problem}\n${host.usage}`);
    return 2;
  }
  const credentials = readNuxeoCredentials();
  if (!credentials) {
    console.error(missingNuxeoCredentialsMessage(`read the content model of ${where.base}`));
    return EXIT_PRECONDITION;
  }
  const file = resolve(options.out);
  const folder = dirname(file);
  const permission = process.permission;
  if (
    permission !== undefined &&
    !(permission.has('fs.write', file) && permission.has('fs.read', file))
  ) {
    console.error(
      `--out ${options.out}: Node's permission model does not let it write there and read the file back. Allow its folder with --allow-fs-write and --allow-fs-read, or give a file in a folder they allow: tmp/content-model.json, say.\n${host.usage}`,
    );
    return 2;
  }
  let model;
  try {
    model = await readServerModel(where.base, credentials);
  } catch (error) {
    console.error(`The content model of ${where.base} was not read: ${error.message}`);
    return 1;
  }
  // Made only now, once there is something to write, so that a server that answers nothing leaves
  // no empty folder behind.
  let made;
  try {
    if (!existsSync(folder)) made = mkdirSync(folder, { recursive: true });
    writeFileSync(file, `${JSON.stringify(model, null, 2)}\n`);
  } catch (error) {
    removeIfEmpty(folder, made);
    console.error(
      `The content model of ${where.base} was read, and could not be written to ${options.out}: ${error.message}\n${host.usage}`,
    );
    return 2;
  }
  const check = spawnSync(host.validator[0], [...host.validator.slice(1), 'model', options.out], {
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (check.status !== 0) {
    rmSync(file, { force: true });
    removeIfEmpty(folder, made);
    process.stderr.write(check.stdout ?? '');
    process.stderr.write(check.stderr ?? '');
    console.error(
      `The content model of ${where.base} was not read: the validator cannot read its answer as a content model, so no file is left`,
    );
    return 1;
  }
  process.stdout.write(
    `${options.out}: the content model of ${where.base}, ${Object.keys(model.doctypes).length} document types, ` +
      `${model.facets.length} facets and ${model.schemas.length} schemas.\n`,
  );
  return 0;
}

/** `folder`, and each folder above it up to `made`, the first this run made, while each is empty. */
function removeIfEmpty(folder, made) {
  if (made === undefined) return;
  for (let at = folder; ; at = dirname(at)) {
    try {
      rmdirSync(at);
    } catch {
      return;
    }
    if (at === made || dirname(at) === at) return;
  }
}
