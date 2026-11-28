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
 *   satori agents sync [<directory>] [--check]       the skill, AGENTS.md's section, the MCP entry
 *   satori mcp [--root <directory>]                  the Builder MCP server, over stdio
 *   satori sign <zip> (--key <file> | --ephemeral-key --signers-out <file> | --keyless ...)
 *   satori verify <zip> --trusted-signers <file> [options]
 *   satori release-check <package> [--previous <directory or zip>] [--json] [options]
 *
 * Every temporary file a run makes, and every process it starts, is in one place
 * ({@link inTemporaryPlace}): `--tmp <directory>`; else, for `build`, its `--out` folder, which it
 * writes anyway; else the system's. So under Node's permission model, `--allow-fs-write` on the
 * folders a run works in is enough, and nothing needs `TMPDIR` set from outside.
 *
 * What it carries, beside this file, each from this repository when the tool is built:
 * `validator.mjs`, the app definition's validator; `builder/build.mjs`, the `config-package`
 * generator's builder, byte for byte, which it runs on a package instead of the package's own;
 * `config-package/`, that generator's scaffolder and templates, which `create` runs; `schemas/`, the
 * JSON Schemas of both layers and of the app definition; and `platform/`, the platform's English
 * catalogue and what the upgrade check reads of the platform (`platform.json`). And for `agents
 * sync`, `agents/`, the skill and AGENTS.md's section; for `mcp`, `mcp.mjs`, the Builder MCP server
 * bundled, `mcp-generator.mjs`, its generators' process, and `generators/`, what they read.
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
  rmdirSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative as relativeTo, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelExportCommand } from '../../../scripts/package-pipeline/model-export.mjs';
import { parse, pipelineCommand } from '../../../scripts/package-pipeline/pipeline.mjs';
import { releaseCheckCommand } from '../../../scripts/package-pipeline/release-check.mjs';
import {
  gitTopLevel,
  signatureCommand,
} from '../../../scripts/package-pipeline/signature-command.mjs';
import {
  check,
  platformFromSnapshot,
  readDeployment,
  readKit,
  report,
  Usage,
} from '../../../scripts/package-pipeline/upgrade-check.mjs';
import { unpack } from '../../../scripts/release-candidate-set.mjs';
import { agentsCommand } from './agents.mjs';
import { connectCommand } from './connect.mjs';
import { createCommand } from './create.mjs';
import { toolCommand } from './tool.mjs';
import { versionCommand } from './version.mjs';

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
  --tag <tag>                 app-package/<name>/<version>, when the build is a release
  --tmp <directory>           where the run's temporary files go, in a folder of its own that is
                              removed (default: build's --out folder; for validate, the system's)`;

const TMP_OPTION = `--tmp <directory>: the run's temporary files, and those of every process it
starts, go in a folder of its own inside <directory>, removed when it ends. Under Node's
permission model, give one that --allow-fs-write allows. Without it, build works in its --out
folder, and validate, release-check, upgrade-check, verify and mcp in the system's temporary folder.`;

const USAGE = `usage: satori <command> [arguments]

  satori validate <package> [options]
      Check a configuration package by every step build takes, and write nothing.
  satori build <package> [--out <directory>] [options]
      Check it and write its Marketplace zip and checksum, to <package>/dist by default.
  satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json]
      [--tmp <directory>]
      Hold it to the package it was: what a customer may override or name stays.
  satori model pull [--server <address>] --out <file>
      Write a server's content model to a file, reading only, as NUXEO_USER with NUXEO_PASS;
      the server is NUXEO_URL's when --server is not given.
  satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]
      Scaffold a configuration repository, with a first package that builds, its agent files
      and a workflow that validates, builds and, once trusted-signers.json says who, signs.
  satori agents sync [<directory>] [--check]
      Install or refresh the app builder skill, AGENTS.md's and CLAUDE.md's sections, the MCP
      server's entry in .mcp.json and .cursor/mcp.json, and the tool's entries in
      .claude/settings.json. --check writes nothing, and exits 1 when they differ.
  satori connect [<directory>] [--server <origin>] [--user <name>] [--password-stdin] [--check]
      Give the MCP server the development server's address and an account, for an AI IDE that
      does not start it from a shell, such as the Claude app: asked for in a terminal, checked
      against the server, and kept in .claude/settings.local.json, which git must ignore.
  satori version <package> <x.y.z | patch | minor | major>
      Raise a package's version in package.xml, its bundle's manifest and app.json together,
      so that a change installs over the one before it.
  satori mcp [--root <directory>] [--tmp <directory>]
      The Builder MCP server, over stdio, for an AI IDE, in a configuration repository.
  satori tool --list | satori tool <name> ['<arguments as JSON>']
      Call one of the MCP server's tools from the command line, the same reads and the same
      validated writes, where an IDE cannot run the server: such as under a policy that allows
      only the MCP servers an organisation lists.
  satori sign <zip> --key <file> | --ephemeral-key --signers-out <file> [--commit <sha>] [--out <file>]
  satori sign <zip> --keyless --trusted-signers <file> --predicate-out <file>
      Sign a zip with a key you hold, outside the repository; or, in CI, decide whether the run
      may sign keyless and write what actions/attest signs.
  satori verify <zip> --trusted-signers <file> [--signature <file>] [--name <package>]
      [--version <version>] [--trusted-root <file>] [--tmp <directory>]
      Verify a zip's signature against the signers you trust.
  satori release-check <package> [--previous <directory or zip>] [--json] [options]
      Whether the package is ready for a person to release: it builds and passes every step,
      keeps what --previous had, and its tag app-package/<name>/<version> is not one git has;
      and the tag a person pushes. It never tags, pushes or publishes.
  satori --version | --help

${BUILD_OPTIONS}

${TMP_OPTION}

Not in this version: preview, publishing and promotion, and who may sign for a deployment
(decision M). Publishing is a person's step: release-check says the tag they push.`;

const BUILD_USAGE = `usage: satori build <package> [--out <directory>] [options]
       satori validate <package> [options]

${BUILD_OPTIONS}`;
const UPGRADE_USAGE =
  'usage: satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json] [--tmp <directory>]';
const MODEL_USAGE =
  'usage: satori model pull [--server <address>] --out <file>   (--server defaults to $NUXEO_URL/nuxeo)';
const SIGN_USAGE = [
  'usage: satori sign <zip> (--key <file> | --ephemeral-key --signers-out <file>) [--commit <sha>] [--out <file>]',
  '       satori sign <zip> --keyless --trusted-signers <file> --predicate-out <file>',
  '       satori verify <zip> --trusted-signers <file> [--signature <file>] [--name <package>]',
  '         [--version <version>] [--trusted-root <file>] [--tmp <directory>]',
].join('\n');
const MCP_USAGE = 'usage: satori mcp [--root <directory>] [--tmp <directory>]';
const RELEASE_USAGE = `usage: satori release-check <package> [--previous <directory or zip>] [--json] [options]

${BUILD_OPTIONS.replace('options of validate and build:', 'options, those of build but --out and --tag:')}`;

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

/** The commands that make temporary files, each with its usage, and so take `--tmp`. */
const TEMPORARY_USAGE = new Map([
  ['validate', BUILD_USAGE],
  ['build', BUILD_USAGE],
  ['upgrade-check', UPGRADE_USAGE],
  ['release-check', RELEASE_USAGE],
  ['verify', SIGN_USAGE],
  ['mcp', MCP_USAGE],
]);
/**
 * Those of them that make one whatever they are given, and so are refused before they run when they
 * may not. `upgrade-check` makes one only to unpack a zip, and is refused then; `verify` only to
 * check a keyless signature.
 */
const ALWAYS_TEMPORARY = new Set(['validate', 'release-check', 'mcp']);

const [command, ...rest] = process.argv.slice(2);
const relative = relativePermissions();
if (relative.length > 0 && !['--version', '--help', '-h', 'help'].includes(command)) {
  console.error(
    `satori: Node's permission model was given ${relative.join(' ')}, a path that is not absolute. Node gives the flag, as it is written, to every Node process the tool starts, and each reads it from its own working folder: the builder, which runs in the package's folder, would be allowed another folder than the one meant, and stop with ERR_ACCESS_DENIED. Give absolute paths, such as --allow-fs-read="$PWD" --allow-fs-write="$PWD".`,
  );
  process.exitCode = 2;
} else process.exitCode = await inTemporaryPlace(command, rest, dispatch);

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
    case 'agents':
      return agentsCommand(args, { here: HERE, version: VERSION });
    case 'connect':
      return connectCommand(args);
    case 'tool':
      return toolCommand(args, { here: HERE });
    case 'version':
      return versionCommand(args);
    case 'mcp':
      return mcp(args);
    case 'sign':
    case 'verify':
      return signature(name, args);
    case 'release-check':
      // This tool's own build and upgrade check, as commands: a --previous zip is read as they read one.
      return releaseCheckCommand(args, {
        usage: RELEASE_USAGE,
        pipeline: [process.execPath, SELF, 'build'],
        upgradeCheck: [process.execPath, SELF, 'upgrade-check'],
        program: 'satori release-check',
        after:
          "For the tag, the repository's workflow builds the package again and, once trusted-signers.json names it, signs it. Nothing promotes it to a server.",
      });
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

/**
 * `run(name, args)` with every temporary file in one place, so that under Node's permission model
 * `--allow-fs-write` on the folders the run works in is enough. Without this, `satori build` made
 * its step 5 folder in `os.tmpdir()`, which a customer's `--allow-fs-write=<work folder>` does not
 * allow, and stopped with `ERR_ACCESS_DENIED`.
 *
 * - **`--tmp <directory>`** names the place, for each command of {@link TEMPORARY_USAGE}. It is made
 *   if it is not there, and removed afterwards if this run made it and left it empty.
 * - **Else `build` works in its `--out` folder,** `<package>/dist` by default, which it writes into
 *   anyway: the pipeline's own command line, read by its own `parse`, says which.
 * - **Else the system's temporary folder,** as before, and nothing is changed. Under the permission
 *   model, a command of {@link ALWAYS_TEMPORARY} that may not write there is refused before it
 *   runs, with `--tmp` named, rather than stopping halfway with `ERR_ACCESS_DENIED`.
 *
 * In a place it is given, a run works in a folder of its own, `.satori-tmp-<random>`, removed when
 * the command ends, and the process's temporary folder, `TMPDIR`, `TEMP` and `TMP`, is that folder:
 * so the package pipeline's modules, which ask `os.tmpdir()`, and every process the run starts, the
 * validator, the builder, `unzip` and the tool again for `release-check`, write there and nowhere
 * else. `mcp` runs until its client stops it, so it is given the place itself: each tool call makes
 * a folder of its own there and removes it.
 */
async function inTemporaryPlace(name, args, run) {
  const usage = TEMPORARY_USAGE.get(name);
  if (usage === undefined) return run(name, args);
  const at = args.indexOf('--tmp');
  const value = at >= 0 ? args[at + 1] : undefined;
  if (
    at >= 0 &&
    (value === undefined ||
      value === '' ||
      value.startsWith('-') ||
      args.indexOf('--tmp', at + 1) >= 0)
  ) {
    console.error(`--tmp takes one folder, once.\n${usage}`);
    return 2;
  }
  const given = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args;
  let place;
  let named;
  if (value !== undefined) {
    place = resolve(value);
    named = `--tmp ${value}`;
    const inside = insideThePackage(name, given, place);
    if (inside !== null) {
      console.error(`${inside}\n${usage}`);
      return 2;
    }
  } else if (name === 'build') {
    const options = parse(given);
    // A command line the pipeline refuses, it refuses in its own words.
    if (options === null || !existsSync(options.directory)) return run(name, given);
    place = resolve(options.out ?? join(options.directory, 'dist'));
    named = `its --out folder, ${place}`;
  } else {
    if (ALWAYS_TEMPORARY.has(name) && !mayWrite(tmpdir())) {
      console.error(
        `satori ${name} makes temporary files, and Node's permission model does not let it write the system's temporary folder, ${tmpdir()}. Give --tmp <directory>, a folder --allow-fs-write allows: --tmp tmp, say, which the .gitignore satori create writes ignores.\n${usage}`,
      );
      return 2;
    }
    return run(name, given);
  }
  if (!mayWrite(place)) {
    console.error(
      `satori ${name} works in ${named}, and Node's permission model does not let it write there: allow it with --allow-fs-write, or give --tmp <directory>, a folder it allows.\n${usage}`,
    );
    return 2;
  }
  let made;
  let folder;
  try {
    made = mkdirSync(place, { recursive: true });
    folder = name === 'mcp' ? place : mkdtempSync(join(place, '.satori-tmp-'));
  } catch (error) {
    console.error(`satori ${name} could not work in ${named}: ${error.message}\n${usage}`);
    return 2;
  }
  for (const variable of ['TMPDIR', 'TEMP', 'TMP']) process.env[variable] = folder;
  if (name === 'mcp') return run(name, given);
  // A run stopped by a signal, as by Ctrl-C, leaves its folder, as it left one in the system's
  // temporary folder before: no handler is installed, so the signal stops the command as it did,
  // in the middle of a step, and `.satori-tmp-*` may be removed by hand.
  try {
    return await run(name, given);
  } finally {
    rmSync(folder, { recursive: true, force: true });
    if (made !== undefined) removeIfEmpty(place, made);
  }
}

/**
 * The paths of `--allow-fs-read` and `--allow-fs-write`, on Node's command line or in
 * `NODE_OPTIONS`, that are not absolute, when the permission model is on. Node passes the flags as
 * written to the Node processes the tool starts, and each reads a relative one from its own working
 * folder.
 */
function relativePermissions() {
  if (process.permission === undefined) return [];
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)];
  const relative = [];
  for (let index = 0; index < flags.length; index++) {
    // `--allow-fs-read=<path>`, or `--allow-fs-read <path>`, which Node takes too.
    const given = /^(--allow-fs-(?:read|write))(?:=(.*))?$/.exec(flags[index]);
    if (given === null) continue;
    const value = given[2] ?? flags[++index] ?? '';
    const path = value.replace(/^(["'])(.*)\1$/, '$2');
    if (path !== '*' && !isAbsolute(path))
      relative.push(given[2] === undefined ? `${given[1]} ${value}` : flags[index]);
  }
  return relative;
}

/**
 * Why `--tmp`, `place`, is no place for the command's package's files, or `null`: inside the
 * package's `bundle/` or `package/`, every file of which is checked and packaged.
 */
function insideThePackage(name, given, place) {
  const directory =
    name === 'validate' || name === 'build'
      ? parse(given)?.directory
      : name === 'release-check'
        ? // Its options are the pipeline's, with --json, wherever they are on the line.
          parse(given.filter((arg) => arg !== '--json'))?.directory
        : undefined;
  if (directory === undefined) return null;
  for (const part of ['bundle', 'package']) {
    const from = relativeTo(resolve(directory, part), place);
    if (from === '' || (!from.startsWith('..') && !isAbsolute(from)))
      return `--tmp ${place} is inside the package's ${part}/, every file of which is checked and packaged: give a folder outside it.`;
  }
  return null;
}

/** Whether Node's permission model, when it is on, lets this process read and write `path`. */
function mayWrite(path) {
  const permission = process.permission;
  return (
    permission === undefined ||
    (permission.has('fs.write', path) && permission.has('fs.read', path))
  );
}

/** `place`, and each folder above it up to `made`, the first this run made, while each is empty. */
function removeIfEmpty(place, made) {
  for (let at = place; ; at = dirname(at)) {
    try {
      rmdirSync(at);
    } catch {
      return;
    }
    if (at === made || dirname(at) === at) return;
  }
}

/**
 * `mcp`: the Builder MCP server, bundled, in the configuration repository it is started in, or
 * `--root`'s. Its stdout is the protocol's, so nothing else is written to it.
 */
async function mcp(args) {
  if (args.length === 2 && args[0] === '--root' && args[1] !== '') {
    if (!isDirectory(args[1])) {
      console.error(`--root ${args[1]} is not a folder.\n${MCP_USAGE}`);
      return 2;
    }
    process.chdir(args[1]);
  } else if (args.length > 0) {
    console.error(MCP_USAGE);
    return 2;
  }
  await import(pathToFileURL(join(HERE, 'mcp.mjs')).href);
  return 0;
}

/**
 * `sign` and `verify`: `scripts/package-pipeline/signature-command.mjs`, which
 * `scripts/app-package-signature.mjs` runs too, given the customer's repository, where git says
 * which commit a zip was built from and a key may not be, and no trusted signers of its own:
 * `verify` and `--keyless` are given the file the customer keeps. `--keyless` is that command's
 * `ci-plan`: the decision, and the predicate `actions/attest` signs.
 */
function signature(command, args) {
  const [zip, ...options] = args;
  let argv = [command, zip, ...options];
  if (command === 'sign' && options.includes('--keyless')) {
    const rest = options.filter((option) => option !== '--keyless');
    if (options.length - rest.length > 1) {
      console.error(`--keyless is given twice.\n${SIGN_USAGE}`);
      return 2;
    }
    const mixed = ['--key', '--ephemeral-key', '--signers-out', '--commit', '--out'].filter(
      (flag) => rest.includes(flag),
    );
    if (mixed.length > 0 || !rest.includes('--predicate-out')) {
      console.error(
        `--keyless signs in CI, through actions/attest with the run's identity: it takes --trusted-signers and --predicate-out${mixed.length > 0 ? `, and not ${mixed.join(', ')}` : ''}.\n${SIGN_USAGE}`,
      );
      return 2;
    }
    argv = ['ci-plan', zip, ...rest];
  }
  return signatureCommand(argv, {
    usage: SIGN_USAGE,
    program: 'satori',
    // The zip's own repository, wherever the command is run from: the working tree git keeps it
    // in, or else the nearest folder above it with a package.json, as a configuration
    // repository has, or else its own folder.
    repository: (zip) => gitTopLevel(dirname(zip)) ?? packageRoot(dirname(zip)) ?? dirname(zip),
    trustedSigners: null,
  });
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
        'satori validate: the package passes every step. Nothing was written: the zip named above was built in a scratch folder to check it, and is removed.\n',
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
  // The last one, as the pipeline's command line reads it.
  const at = args.lastIndexOf('--previous');
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
  // A folder of its own only to unpack a zip into: a folder --previous needs none.
  const zip = isFile(options.previous);
  if (zip && !mayWrite(tmpdir())) {
    console.error(
      `satori upgrade-check unpacks --previous's zip into a temporary folder, and Node's permission model does not let it write the system's, ${tmpdir()}. Give --tmp <directory>, a folder --allow-fs-write allows.\n${UPGRADE_USAGE}`,
    );
    return 2;
  }
  const scratch = zip ? mkdtempSync(join(tmpdir(), 'satori-previous-')) : null;
  try {
    const previous = scratch === null ? options.previous : packageOfZip(options.previous, scratch);
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
    return report(
      [check(before, kit, { previous: null, current, notes: null }, deployment)],
      options.json,
    );
  } catch (error) {
    // Any run that ends here could not be made, so it exits 2, as app-upgrade-check.mjs does: a
    // crash must not read as "not kept".
    console.error(
      error instanceof Usage ? `satori upgrade-check: ${error.message}\n${UPGRADE_USAGE}` : error,
    );
    return 2;
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
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
    // By its absolute path, so that a name beginning with "-" reaches unzip as a file.
    unpacked = unpack(resolve(zip), join(scratch, 'zip'));
  } catch (error) {
    return { problem: error.message };
  }
  const bundles = join(unpacked, 'install', 'bundles');
  const jars = isDirectory(bundles)
    ? readdirSync(bundles).filter((name) => name.endsWith('.jar'))
    : [];
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

/**
 * The nearest folder from `folder` up that holds a package.json, or `null`: up to the first that
 * cannot be read, as under Node's permission model, where a folder outside it is never the one.
 */
function packageRoot(folder) {
  for (let at = resolve(folder); ; at = dirname(at)) {
    // A home folder is not a repository, even with a package.json in it.
    if (at === resolve(homedir())) return null;
    try {
      if (isFile(join(at, 'package.json'))) return at;
    } catch {
      return null;
    }
    if (dirname(at) === at) return null;
  }
}

function isFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function isDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}
