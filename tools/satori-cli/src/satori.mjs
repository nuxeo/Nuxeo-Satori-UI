#!/usr/bin/env node
/**
 * `satori`, the one builder of a customer's configuration (docs/business-apps/extension-model.md,
 * section 5, decision K's first step). It checks and builds a configuration package holding any mix
 * of Layer 0 and Layer 1 fragments, assets, version 1 layouts and an app definition of version 2,
 * and writes the Marketplace zip `scripts/app-package.mjs` writes, by the same steps: this file runs
 * `scripts/package-pipeline/`, the one implementation both run, bundled with the validator into
 * plain JavaScript by `tools/satori-cli/build.mjs`, so that it runs outside this repository with
 * Node and the system's `unzip` alone.
 *
 *   satori validate <package> [options]              every step, writing nothing
 *   satori build <package> [--out <directory>] [options]
 *   satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json]
 *   satori model pull --server <address> --out <file>
 *   satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]
 *
 * What it carries, beside this file, each from this repository when the tool is built:
 * `validator.mjs`, the app definition's validator; `builder/build.mjs`, the `config-package`
 * generator's builder, byte for byte, which it runs on a package instead of the package's own;
 * `config-package/`, that generator's scaffolder and templates, which `create` runs; `schemas/`, the
 * JSON Schemas of both layers and of the app definition; and `platform/`, the platform's English
 * catalogue and what the upgrade check reads of the platform (`platform.json`).
 *
 * Exit codes: 0, done; 1, refused; 2, the command was wrong, or could not be run.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelExportCommand } from '../../../scripts/package-pipeline/model-export.mjs';
import { pipelineCommand } from '../../../scripts/package-pipeline/pipeline.mjs';
import {
  check,
  platformFromSnapshot,
  readDeployment,
  readKit,
  report,
  Usage,
} from '../../../scripts/package-pipeline/upgrade-check.mjs';
import { unpack } from '../../../scripts/release-candidate-set.mjs';
import { createCommand } from './create.mjs';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const { version: VERSION } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
/** What the tool carries of the platform it was built from. */
const PLATFORM = JSON.parse(readFileSync(join(HERE, 'platform', 'platform.json'), 'utf8'));

const BUILD_OPTIONS = `options of validate and build:
  --platform <version>        the platform version app.json's range must hold
                              (default: ${PLATFORM.version}, the platform this tool carries)
  --model <file>              the content model layouts, queues and page providers are held to
  --model-server <address>    the same, read from the server, with NUXEO_USER and NUXEO_PASS
                              from the environment. Given neither, a package that ships a stand-in
                              model is held to its own content-model.json, and any other to none
  --allow-list <file>         the deployment's allow-list of the operations a button may run
  --registered <file>         what the deployment registers in code: rules, actions, pages, connectors
  --previous <directory or zip>
                              the package as it was: its version and its upgrade are held to it
  --kits <folder>             compare the package's names with every other package in the folder
  --tag <tag>                 app-package/<name>/<version>, when the build is a release`;

const USAGE = `usage: satori <command> [arguments]

  satori validate <package> [options]
      Check a configuration package by every step build takes, and write nothing.
  satori build <package> [--out <directory>] [options]
      Check it and write its Marketplace zip and checksum, to <package>/dist by default.
  satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json]
      Hold it to the package it was: what a customer may override or name stays.
  satori model pull --server <address> --out <file>
      Write a server's content model to a file, reading only, as NUXEO_USER with NUXEO_PASS.
  satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]
      Scaffold a configuration repository, with a first package that builds.
  satori --version | --help

${BUILD_OPTIONS}

Not in this version: agents sync, signing, preview and the MCP server.`;

const BUILD_USAGE = `usage: satori build <package> [--out <directory>] [options]
       satori validate <package> [options]

${BUILD_OPTIONS}`;
const UPGRADE_USAGE =
  'usage: satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json]';
const MODEL_USAGE = 'usage: satori model pull --server <address> --out <file>';

/** The pipeline's host: where everything outside the package is, for this tool. */
const HOST = {
  usage: BUILD_USAGE,
  validator: [process.execPath, join(HERE, 'validator.mjs')],
  upgradeCheck: [process.execPath, SELF, 'upgrade-check'],
  catalogue: join(HERE, 'platform', 'en.json'),
  kits: null,
  builder: {
    template: join(HERE, 'builder', 'build.mjs'),
    shownTemplate: "builder/build.mjs, the config-package generator's",
    runs: 'carried',
  },
  requireApp: false,
  schemas: {
    bootstrap: join(HERE, 'schemas', 'bootstrap.schema.json'),
    manifest: join(HERE, 'schemas', 'manifest.schema.json'),
  },
  platformVersion: PLATFORM.version ?? undefined,
};

const [command, ...rest] = process.argv.slice(2);
process.exitCode = await dispatch(command, rest);

async function dispatch(name, args) {
  switch (name) {
    case 'validate':
      return validate(args);
    case 'build':
      return build(args);
    case 'upgrade-check':
      return upgradeCheck(args);
    case 'model':
      if (args[0] === 'pull')
        return modelExportCommand(args.slice(1), {
          usage: MODEL_USAGE,
          validator: HOST.validator,
        });
      console.error(MODEL_USAGE);
      return 2;
    case 'create':
      return createCommand(args, { here: HERE, version: VERSION });
    case '--version':
      process.stdout.write(`@nuxeo/satori-cli ${VERSION}, platform ${PLATFORM.version}\n`);
      return 0;
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(`${USAGE}\n`);
      return 0;
    default:
      console.error(USAGE);
      return 2;
  }
}

/** `build`: the pipeline's steps, with a previous package given as a zip unpacked first. */
async function build(args) {
  return withPrevious(args, (given) => pipelineCommand(given, HOST));
}

/**
 * `validate`: every step `build` takes, the zip built and verified in a scratch folder that is then
 * removed, so that nothing is written and nothing an earlier build left is touched.
 */
async function validate(args) {
  if (args.includes('--out')) {
    console.error(`validate writes nothing, so it takes no --out.\n${BUILD_USAGE}`);
    return 2;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'satori-validate-'));
  try {
    const code = await withPrevious(args, (given) =>
      pipelineCommand([...given, '--out', scratch], HOST),
    );
    if (code === 0)
      process.stdout.write(
        'satori validate: the package passes every step. Nothing was written: the zip was built in a scratch folder to check it, and is removed.\n',
      );
    return code;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * `run(args)`, with a `--previous` that names a zip unpacked first into the package it was built
 * from, and `--previous-platform` refused: the platform as it was is read from this repository's
 * sources, which the tool does not have.
 */
async function withPrevious(args, run) {
  if (args.includes('--previous-platform')) {
    console.error(
      `--previous-platform reads the platform's sources at another version, which only Nuxeo Satori UI's repository has: there, scripts/app-package.mjs takes it. The platform as it is is the one this tool carries, ${PLATFORM.version}.\n${BUILD_USAGE}`,
    );
    return 2;
  }
  const at = args.indexOf('--previous');
  const previous = at >= 0 ? args[at + 1] : undefined;
  if (previous === undefined || !isFile(previous)) return run(args);
  const scratch = mkdtempSync(join(tmpdir(), 'satori-previous-'));
  try {
    const unpacked = packageOfZip(previous, scratch);
    if (typeof unpacked !== 'string') {
      console.error(`--previous ${previous}: ${unpacked.problem}\n${BUILD_USAGE}`);
      return 2;
    }
    return await run(args.map((arg, index) => (index === at + 1 ? unpacked : arg)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * `upgrade-check`: the upgrade check's offline half on the kit's side, the package as it is held
 * to the package as it was, with the platform as it is the one this tool carries. The platform's
 * side, the platform as it was against the platform as it is, reads the platform's sources at both
 * versions, and stays with this repository's `app-upgrade-check.mjs`.
 */
async function upgradeCheck(args) {
  const options = { json: false };
  const packages = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    const given = value !== undefined && value !== '' && !value.startsWith('-');
    if (arg === '--json') options.json = true;
    else if ((arg === '--previous' || arg === '--deployment') && given && !options[arg.slice(2)]) {
      options[arg.slice(2)] = value;
      index++;
    } else if (arg.startsWith('-')) {
      console.error(UPGRADE_USAGE);
      return 2;
    } else packages.push(arg);
  }
  if (packages.length !== 1 || options.previous === undefined) {
    console.error(UPGRADE_USAGE);
    return 2;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'satori-previous-'));
  try {
    const previous = isFile(options.previous)
      ? packageOfZip(options.previous, scratch)
      : options.previous;
    if (typeof previous !== 'string')
      throw new Usage(`--previous ${options.previous}: ${previous.problem}`);
    for (const [what, path] of [
      ['the package', packages[0]],
      ['--previous', previous],
    ])
      if (!isDirectory(path)) throw new Usage(`${what} ${path} is not a folder.`);
    const kit = readKit(resolve(packages[0]));
    const before = readKit(resolve(previous));
    const deployment = options.deployment === undefined ? null : readDeployment(options.deployment);
    const current = platformFromSnapshot(PLATFORM, join(HERE, 'platform', 'platform.json'));
    return report([check(before, kit, { previous: null, current, notes: null }, deployment)], options.json);
  } catch (error) {
    if (!(error instanceof Usage)) throw error;
    console.error(`satori upgrade-check: ${error.message}\n${UPGRADE_USAGE}`);
    return 2;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The package a Marketplace zip was built from, unpacked into `scratch`: `package/package.xml` and
 * `package/install.xml` from the zip, and `bundle/` from its one bundle, `install/bundles/<name>.jar`.
 * Its JSON is as the builder packaged it, compact and without `$schema`, which the version rules and
 * the upgrade check read as they read the source. Read with the system's `unzip`, as step 5 reads a
 * zip. `{ problem }` when it is not such a zip.
 */
function packageOfZip(zip, scratch) {
  let unpacked;
  try {
    unpacked = unpack(zip, join(scratch, 'zip'));
  } catch (error) {
    return { problem: error.message };
  }
  const bundles = join(unpacked, 'install', 'bundles');
  const jars = isDirectory(bundles) ? readdirSync(bundles).filter((name) => name.endsWith('.jar')) : [];
  if (jars.length !== 1 || !isFile(join(unpacked, 'package.xml')))
    return {
      problem: `a configuration package's zip holds package.xml and one bundle, install/bundles/<name>.jar, and this one holds ${jars.length} bundle(s)${isFile(join(unpacked, 'package.xml')) ? '' : ' and no package.xml'}.`,
    };
  const directory = join(scratch, basename(zip).replace(/\.zip$/i, '') || 'previous');
  try {
    unpack(join(bundles, jars[0]), join(directory, 'bundle'));
  } catch (error) {
    return { problem: error.message };
  }
  mkdirSync(join(directory, 'package'), { recursive: true });
  for (const file of ['package.xml', 'install.xml'])
    if (isFile(join(unpacked, file)))
      copyFileSync(join(unpacked, file), join(directory, 'package', file));
  return directory;
}

function isFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function isDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}
