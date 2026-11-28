/**
 * The package pipeline's steps, for one configuration package (docs/business-apps/package-pipeline.md):
 * check it, build it, verify the zip, and write its checksum. One implementation, which two commands
 * run: `scripts/app-package.mjs`, the pipeline CI and every kit in this repository build with, and
 * `@nuxeo/satori-cli` (`tools/satori-cli`), the builder a customer runs on their own configuration
 * repository, outside this one. Each gives `pipelineCommand` its `platform`: where the validator, the
 * upgrade check, the builder, the English catalogue and the configuration schemas are, and which of
 * the two it is. Signing and publishing are the workflow's (`.github/workflows/app-packages.yml`),
 * which runs them on the zip this writes and never on the package's own code.
 *
 *   <command> <package directory> [--out <directory>] [--tag <tag>]
 *     [--allow-list <file>] [--registered <file>] [--platform <version>]
 *     [--model <file> | --model-server <address>] [--previous <package directory>]
 *     [--previous-platform <repository>] [--kits <folder>]
 *
 * First it removes the zip, checksum and changelog an earlier run left for the package's name and version, so
 * that a refused package leaves nothing installable behind; a package.xml that is a symbolic link is
 * not read for them. Then, in order, each step stopping the run when it fails:
 *   1. nothing in the package is a symbolic link, so no step reads a file from elsewhere, and the
 *      code that builds it is code this repository reviewed: for `app-package.mjs`, the package's
 *      `build.mjs` is the generator's, byte for byte, and it is what step 4 runs; for the tool,
 *      the generator's builder the tool carries, which step 4 runs on the package, so a package's
 *      own `build.mjs` is not run and need not be there. And a `package/install.xml` there is a
 *      file, not a folder, since no step before the builder reads it;
 *   2. the configuration. Its Layer 0 and Layer 1 fragments name only keys the platform's schemas
 *      have, since the application ignores any other in silence (`configuration.mjs`), and no
 *      fragment and no package takes a name Satori itself uses. No component contributes to the
 *      server's allow-list of the operations an app's buttons may run,
 *      `org.nuxeo.agentic.ui.operations`, which is the deployment's, never a package's, nor to the
 *      embedded panels' hosts, nor a chain with a platform operation's id.
 *      Then the app definition. `bundle/agentic-ui-config/` has an `app.json`, which
 *      `app-package.mjs` requires and the tool requires only of a package holding any file of
 *      version 2, and the validator of
 *      `libs/shared/app-definition` finds nothing in it, given the deployment's allow-list, what
 *      it registers, its platform version, the platform's English catalogue, which with the
 *      package's labels must give every label key a text, and a content model: the one given, or,
 *      for a package that ships a stand-in model, its own `content-model.json`. A queue's facet and
 *      a home's figure name an aggregate their page provider defines, when the package's own
 *      model defines it; the NXQL of a page provider the package defines holds nothing Nuxeo's
 *      grammar has no place for, by a check of its tokens, not a parse, and, given a model, it,
 *      its sorts and its aggregates name only properties, types and facets the model has, each
 *      property on the type the NXQL lists when it says; a queue, a related list and a home's
 *      figure give such a page provider as many parameters as its NXQL's ?; a queue's and a related
 *      list's columns and sorts, on such a page provider whose NXQL says the type it lists, name
 *      that type's properties in the content model, with widgets that show them. The layouts the
 *      component contributes are the files the validator read, in the modes it
 *      read them in: none inline, none from elsewhere; and every file under `layouts/` is
 *      contributed, since the server would never serve one that is not. The package contributes
 *      its app to the app registry once, from its `app.json`, naming every file of the app
 *      definition the registry serves and nothing else. And no name it gives is another kit's:
 *      compared with every kit folder in `--kits`, or, for a kit in the repository's
 *      `business-apps/packages/`, the other kits there, as the release candidate's stage 3 compares
 *      them (`readKitFolder`), its name, its app's id and address, its queues, its actions, what its
 *      components register, its own label keys and its connectors. A manifest that is not a file, and a
 *      component path that leaves
 *      `bundle/` or names a folder or a hard link, are refused before they are read (a missing one
 *      is the builder's to refuse, at step 4);
 *   3. for an app definition, `app.json`'s `packageVersion` and the manifest's `Bundle-Version` are
 *      `package.xml`'s version, and a tag, when given, is
 *      `app-package/<name>/<version>` for this package; given the package as it was before,
 *      `--previous`, the version moved as far as what changed needs (the validator's `changes`,
 *      `libs/shared/app-definition/src/lib/changes.ts`), the package's name did not change, and
 *      the upgrade keeps every customer configuration (`upgrade-check.mjs`): what a customer
 *      may override or name is removed only with a migration note, and the version rises as far as
 *      that needs; given the platform as it was, `--previous-platform`, nothing the package names
 *      is gone from the platform without one;
 *   4. the configuration package builder, the generator's `build.mjs`, writes the zip, refusing
 *      what the server would;
 *   5. `verify-package-zip.mjs` finds a well-formed Nuxeo Package, and installing it writes
 *      nothing into the server's own configuration;
 *   6. the zip's SHA-256 goes beside it, as `<zip>.sha256`, in the form `sha256sum -c` reads, and,
 *      given `--previous`, what changed since, as `<name>-<version>.changes.md`, with the migration
 *      notes that cover it.
 *
 * Node 24 and the system's `unzip`, which reads the zip back at step 5, run all of it: no install
 * and no credential, so that a package's checks need nothing a customer's repository does not have.
 * The content model is the one input that may need a server, and it is opt in: `--model` names a
 * file `model-export.mjs` exported, and `--model-server` reads the model live, with
 * `NUXEO_USER` and `NUXEO_PASS` from the environment. Either is read before step 1, for every
 * package, and one that cannot be read stops the run with exit 2. Given neither, a package that
 * ships a stand-in model, a component of its own registering document types, is held to the
 * `content-model.json` beside its `bundle/`, which `app-model` writes to describe it; a package on
 * a server's model is held to none, and the run says so.
 * The XML is read by `verify-package-zip.mjs`'s own helpers, the builder's grammar ported, so that
 * the three cannot disagree about what a descriptor says.
 *
 * Nothing here reads where it is: every path outside the package is the `platform`'s, so the same
 * module runs from this repository, through the TypeScript hook, and bundled into the tool.
 *
 * Exit codes: 0, built; 1, refused; 2, the command was wrong.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  listedColumnFindings,
  listedType,
  nxqlNameProblems,
  nxqlProblems,
  parameterFindings,
  positionalParameters,
  propertyNameProblem,
} from '../../libs/shared/app-definition/src/lib/page-providers.ts';
import {
  propertiesOf,
  readContentModel,
} from '../../libs/shared/app-definition/src/lib/content-model.ts';
import {
  EXIT_PRECONDITION,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from '../beta-harness/nuxeo-credentials.mjs';
import { readServerModel, serverBase, withoutCredentials } from '../nuxeo-content-model.mjs';
import { readKitFolder } from '../release-candidate-set.mjs';
import {
  attribute,
  attributesOf,
  componentPathsOf,
  componentXmlOf,
  TAG,
  verifyPackageZip,
  withoutCdata,
  withoutCommentsOrInstructions,
} from '../verify-package-zip.mjs';
import { configurationFindings, reservedName, versionTwoFiles } from './configuration.mjs';

/** The file `app-model` writes beside `bundle/`: the package's stand-in model, described. */
const OWN_MODEL = 'content-model.json';
/**
 * The connectors add-on's rules for what a contribution names, as `Connector.of` holds them
 * (nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/Connector.java): the add-on
 * leaves out a connector that breaks one, and its card then shows its error state.
 */
const CONNECTOR = {
  id: /^[A-Za-z][A-Za-z0-9._-]{0,63}$/,
  type: /^[A-Za-z][A-Za-z0-9_-]{0,127}$/,
  field: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
  xpath: /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/,
  permission: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
  property: /^[A-Za-z][A-Za-z0-9._-]{0,127}$/,
  env: /^[A-Z_][A-Z0-9_]{0,127}$/,
  /** One name after the connector's own prefix: never a dot, so never another's setting. */
  ownName: /^[A-Za-z0-9_-]{1,64}$/,
  ownEnvName: /^[A-Z0-9]{1,64}$/,
  header: /^[A-Za-z0-9-]{1,64}$/,
  /** Headers the credential may not go in: Java's client refuses them, or they change the request. */
  forbiddenHeaders: new Set([
    'connection',
    'content-length',
    'expect',
    'host',
    'upgrade',
    'transfer-encoding',
    'te',
    'trailer',
    'keep-alive',
    'proxy-authorization',
    'proxy-connection',
    'accept',
    'cookie',
    'content-type',
  ]),
  limits: {
    connectTimeout: [100, 10_000],
    timeout: [100, 30_000],
    maxBytes: [1024, 1_048_576],
    maxConcurrent: [1, 64],
  },
};

/** `Connector.soundPath`: from `/`, `{key}` once, the add-on's characters, no empty or dot segment. */
function soundConnectorPath(path) {
  if (typeof path !== 'string' || path.length > 256 || !path.startsWith('/')) return false;
  const at = path.indexOf('{key}');
  if (at < 0 || path.indexOf('{key}', at + 1) >= 0) return false;
  const around = `${path.slice(0, at)}k${path.slice(at + '{key}'.length)}`;
  if (!/^[A-Za-z0-9/._~-]*$/.test(around)) return false;
  return around
    .slice(1)
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
// `spawnSync` truncates a child's output in silence past its limit, 1 MiB by default.
const OUTPUT_LIMIT = 64 * 1024 * 1024;
/** `build.mjs`'s rule for a package name or version: a single file name, nothing above it. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The files of an app definition the app registry serves besides `app.json`, each at its place:
 * `ConfigSnapshot.APP_FILES` in nuxeo-agentic-core, with the names the validator gives each one.
 */
/** More files than this, and the server refuses the app: `ContributionRegistry.MAX_APP_FILES`. */
const MAX_APP_FILES = 256;

/** The component that holds the server's allow-list of the operations an app's buttons may run. */
const ALLOW_LIST_COMPONENT = 'org.nuxeo.agentic.ui.operations';

/**
 * The component that registers the host applications an embedded panel's token is exchanged for
 * (nuxeo-agentic-embedded): which systems may sign the server's users in is the deployment's.
 */
const EMBEDDED_HOSTS_COMPONENT = 'org.nuxeo.agentic.embedded';

/** The one command a configuration package's `install.xml` holds: the bundle, into the bundles. */
const INSTALL_UPDATE = { file: '${package.root}/install/bundles', todir: '${env.bundles}' };

const REGISTRY_FILES = [
  /^home\.json$/,
  /^navigation\.json$/,
  /^actions\.json$/,
  /^queues\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/,
  /^labels\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.json$/,
  /^tasks\/[A-Za-z][A-Za-z0-9_-]{0,127}\.[A-Za-z][A-Za-z0-9_-]{0,127}\.layout\.json$/,
];

const VALUED = [
  '--out',
  '--tag',
  '--allow-list',
  '--registered',
  '--platform',
  '--model',
  '--model-server',
  '--previous',
  '--previous-platform',
  '--kits',
];

/** The command line, or `null` when it is not one. */
export function parse(argv) {
  const options = {};
  const paths = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    // An empty value is refused, not taken as no option: `--model "$MODEL"` with the variable unset
    // would otherwise skip the check it asks for.
    if (
      VALUED.includes(arg) &&
      argv[index + 1] !== undefined &&
      argv[index + 1] !== '' &&
      !argv[index + 1].startsWith('--')
    )
      options[arg.slice(2)] = argv[++index];
    else if (arg.startsWith('--')) return null;
    else paths.push(arg);
  }
  // One content model: a file, or the server's, not both.
  if (options.model !== undefined && options['model-server'] !== undefined) return null;
  // The platform as it was is held to only with the package as it was.
  if (options['previous-platform'] !== undefined && options.previous === undefined) return null;
  return paths.length === 1 ? { directory: paths[0], ...options } : null;
}

/**
 * The pipeline, as a command: `argv` read, then each step run on the package it names. `host` is
 * the command that runs it, `app-package.mjs` or the tool, and says where everything outside the
 * package is:
 *
 * - `usage`, the command's usage line, said with every command-line error;
 * - `validator`, the command that runs the app definition's validator (`bin.mjs` here, the tool's
 *   bundle of the same source there), given `validate`, `model` or `changes` and their arguments;
 * - `upgradeCheck`, the command that runs the upgrade check, given the package, `--previous`,
 *   `--previous-platform` when there is one, and `--json`;
 * - `catalogue`, the platform's English catalogue;
 * - `kits`, the folder whose kits a package in it is compared with when no `--kits` is given, or
 *   `null`;
 * - `builder`: `template`, the generator's `build.mjs`, and `shownTemplate`, how a message names
 *   it; `runs`, `'package'` when step 4 runs the package's own `build.mjs`, which step 1 holds to
 *   the template byte for byte, or `'carried'` when it runs the template itself on the package, which
 *   need have no `build.mjs` of its own;
 * - `requireApp`, whether a package with no `app.json` is refused at step 2, or built as a
 *   configuration package with no app definition;
 * - `schemas`, the Layer 0 and Layer 1 fragments' JSON Schemas, `{ bootstrap, manifest }`, files;
 * - `platformVersion`, the platform version `--platform` is when it is not given, or `undefined`.
 *
 * Exit codes: 0, built; 1, refused; 2, the command was wrong.
 */
export async function pipelineCommand(argv, host) {
  const options = parse(argv);
  if (!options || !existsSync(options.directory)) {
    console.error(options ? `${options.directory} does not exist.\n${host.usage}` : host.usage);
    return 2;
  }
  if (
    options.kits !== undefined &&
    !lstatSync(options.kits, { throwIfNoEntry: false })?.isDirectory()
  ) {
    console.error(`--kits ${options.kits} is not a folder of kits.\n${host.usage}`);
    return 2;
  }
  return withModel(
    options.platform === undefined && host.platformVersion !== undefined
      ? { ...options, platform: host.platformVersion }
      : options,
    host,
  );
}

/**
 * `run`, with the content model read first: the file `--model` names, or the server's when
 * `--model-server` names it, into a file the validator reads as it reads `--model`'s, and which is
 * removed afterwards. A model that cannot be read stops the run with exit 2, once an earlier run's
 * zip is removed: the package is neither refused nor built on a model nobody saw. The file is read
 * here for every package, since only an app definition's step 2 holds anything to it: a package
 * that is configuration alone would otherwise pass with a `--model` that names nothing.
 */
async function withModel(options, host) {
  if (options.model !== undefined) {
    const unread = unreadModel(options.model, host);
    return run(unread === null ? options : { ...options, unread }, host);
  }
  if (options['model-server'] === undefined) return run(options, host);
  const read = await serverModel(options['model-server'], host);
  if (typeof read === 'string') return run({ ...options, unread: read }, host);
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-model-'));
  try {
    const file = join(scratch, 'content-model.json');
    writeFileSync(file, JSON.stringify(read.model));
    process.stdout.write(`The content model was read from ${read.base}.\n`);
    return run({ ...options, model: file }, host);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Why the file `--model` names cannot be held to, or `null`: it is not there, it is not a file, or
 * the validator's `model` command, which reads it as `validate --model` does, cannot read the whole
 * of it as a content model.
 */
function unreadModel(file, host) {
  let entry;
  try {
    entry = statSync(file, { throwIfNoEntry: false });
  } catch (error) {
    return `--model ${file} cannot be read (${error.code ?? error.message}).\n${host.usage}`;
  }
  if (entry === undefined)
    return `--model ${file} names no file: write a server's content model to it first, or give the file it was written to.\n${host.usage}`;
  if (!entry.isFile())
    return `--model ${file} is not a file: give the file a server's content model was written to.\n${host.usage}`;
  const read = validator(host, ['model', file]);
  if (read.status === 0) return null;
  const said =
    `${read.stdout ?? ''}${read.stderr ?? ''}`.trim().replace(`${file}: `, '') ||
    read.error?.message ||
    `the validator exited ${read.status}`;
  return `--model ${file} cannot be read as a content model: ${said}\n${host.usage}`;
}

/** The content model `server` answers, with `NUXEO_USER` and `NUXEO_PASS`, or why it was not read. */
async function serverModel(server, host) {
  const where = serverBase(server);
  if (where.problem) return `--model-server: ${where.problem}\n${host.usage}`;
  const credentials = readNuxeoCredentials();
  if (!credentials)
    return missingNuxeoCredentialsMessage(`read the content model of ${where.base}`);
  try {
    return { base: where.base, model: await readServerModel(where.base, credentials) };
  } catch (error) {
    return `The content model of ${where.base} was not read: ${error.message}`;
  }
}

/** The validator, run as a command with `args`, as CI runs it: no credential in its environment. */
function validator(host, args) {
  return spawnSync(host.validator[0], [...host.validator.slice(1), ...args], {
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: OUTPUT_LIMIT,
  });
}

function run(
  {
    directory,
    out,
    tag,
    'allow-list': allowList,
    registered,
    platform,
    model,
    unread,
    previous,
    'previous-platform': previousPlatform,
    kits,
  },
  host,
) {
  const near = relative(process.cwd(), resolve(directory));
  const shown = near === '' ? '.' : near.startsWith('..') ? resolve(directory) : near;
  const refuse = (step, message) => {
    console.error(`${shown}: step ${step} refused it: ${message}`);
    return 1;
  };

  // No step reads through a symbolic link, so the package is searched for one before anything in
  // it is read: a link can point anywhere, and what a step reads it may quote back. The builder
  // refuses one in bundle/ or package/ at step 4; a linked build.mjs would have step 1 compare, and
  // step 4 run, a file from elsewhere. Refused at step 1, below, once older output is cleared.
  const found = firstLink(directory);

  // What an earlier run left for this package's name and version goes first, so that a run that
  // refuses the package leaves no installable zip behind, this run's or an older one's. The name
  // and version are the package's own, so they name a file only once they are single file names,
  // as the builder requires: a name such as `../x` must not reach outside the output directory.
  // A package.xml reached through a link is not read: an older zip of that package stays.
  const descriptorFile = join(directory, 'package', 'package.xml');
  const throughLink =
    typeof found === 'string' &&
    (descriptorFile === found || descriptorFile.startsWith(found + sep));
  let descriptor = null;
  let unreadable = null;
  if (!throughLink && existsSync(descriptorFile)) {
    try {
      descriptor = withoutCdata(
        withoutCommentsOrInstructions(readFileSync(descriptorFile, 'utf8')),
      );
    } catch (error) {
      // Unreadable, it names no older zip, and step 3 says so.
      unreadable = error.code ?? error.message;
    }
  }
  const name = descriptor === null ? null : attribute(descriptor, 'package', 'name');
  const version = descriptor === null ? null : attribute(descriptor, 'package', 'version');
  const output = resolve(out ?? join(directory, 'dist'));
  if (FILE_NAME.test(name ?? '') && FILE_NAME.test(version ?? '')) {
    const earlier = join(output, `${name}-${version}.zip`);
    for (const left of [earlier, `${earlier}.sha256`, changesFile(output, name, version)])
      rmSync(left, { force: true });
  }
  // A content model `--model-server` could not read.
  if (unread !== undefined) {
    console.error(unread);
    return EXIT_PRECONDITION;
  }

  // 1. The package holds its own files, and the builder is the reviewed one.
  if (typeof found === 'string')
    return refuse(
      1,
      `${relative(directory, found).split(sep).join('/') || 'the package folder'} is a symbolic ` +
        'link, which is not followed. Put the file itself there, so the package holds only what ' +
        'was reviewed.',
    );
  if (found !== null)
    return refuse(
      1,
      `${relative(directory, found.path).split(sep).join('/') || 'the package folder'} cannot be ` +
        `read (${found.code}), so it cannot be told whether it holds a symbolic link.`,
    );
  const builder = join(directory, 'build.mjs');
  const template = readFileSync(host.builder.template);
  // A folder there is no builder, and is not read as one.
  const builderEntry = lstatSync(builder, { throwIfNoEntry: false });
  const reviewed = builderEntry?.isFile() === true && readFileSync(builder).equals(template);
  if (host.builder.runs === 'package' && !reviewed)
    return refuse(
      1,
      `build.mjs is not the generator's, byte for byte. Copy ${host.builder.shownTemplate} over it,` +
        ' so that what builds the package is code this repository reviewed.',
    );
  // The tool runs its own builder on the package, never the package's: one there that is not the
  // tool's is said, since `node build.mjs` would then build it with other checks than these.
  if (host.builder.runs === 'carried' && builderEntry !== undefined && !reviewed)
    process.stdout.write(
      `note: build.mjs is not the builder this tool carries, ${host.builder.shownTemplate}, byte for byte. It is not run: the package is built with the tool's own.\n`,
    );
  // No other step before the builder reads install.xml, so without this a folder there would be
  // refused only at step 4.
  const installXml = join(directory, 'package', 'install.xml');
  if (existsSync(installXml) && !lstatSync(installXml).isFile())
    return refuse(
      1,
      'package/install.xml is not a file. Put the file itself there: it is what installs the bundle.',
    );

  // 2. The configuration: the Layer 0 and Layer 1 fragments, the names Satori itself uses, and,
  // with an app.json, the app definition, as the validator reads it.
  const root = join(directory, 'bundle', 'agentic-ui-config');
  const configured = configurationFindings(directory, componentsOf(directory), host.schemas);
  if (configured.length > 0) {
    for (const finding of configured) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      'a Layer 0 or Layer 1 fragment names a key the application does not read, which it would ignore in silence, or takes a name Satori itself uses, listed above.',
    );
  }
  const appFile = join(root, 'app.json');
  const app = existsSync(appFile);
  if (!app && host.requireApp)
    return refuse(2, 'bundle/agentic-ui-config/ has no app.json, which an app definition needs.');
  if (!app) {
    // As layoutContributions refuses it for an app definition: a folder there names no component.
    const manifestEntry = lstatSync(join(directory, 'bundle', 'META-INF', 'MANIFEST.MF'), {
      throwIfNoEntry: false,
    });
    if (manifestEntry !== undefined && !manifestEntry.isFile())
      return refuse(
        2,
        "bundle/META-INF/MANIFEST.MF is not a file. A bundle's manifest is a file, which names its components.",
      );
    // What only an app definition holds, with no app.json: checked by nothing, or served by nothing.
    const unowned = versionTwoFiles(directory, componentsOf(directory));
    if (unowned.length > 0)
      return refuse(
        2,
        `the package holds ${unowned.join(', ')}, of an app definition, and no bundle/agentic-ui-config/app.json: an app definition needs one, and without it none of it would be checked, or served as it was checked.`,
      );
    const reached = allowListContributions(directory);
    if (reached) return refuse(2, reached);
    process.stdout.write(
      'No app definition: bundle/agentic-ui-config/ has no app.json, so the package is configuration alone, Layer 0, Layer 1, assets and version 1 layouts, which the builder checks at step 4.\n',
    );
    // The other kits' names are an app definition's to compare: said, not passed in silence.
    if (kits !== undefined)
      process.stdout.write(
        `note: --kits ${kits}: the names a package shares with the other packages are compared for an app definition, and this package has none, so it was compared with nothing.\n`,
      );
  } else {
    const defined = appDefinition(
      { directory, root, model, allowList, registered, platform, kits },
      host,
      refuse,
    );
    if (defined !== null) return defined;
  }

  // 3. One version, written in three places, `package.xml` read as the builder reads it.
  if (unreadable !== null) return refuse(3, `package/package.xml cannot be read (${unreadable}).`);
  if (descriptor === null) return refuse(3, 'package/package.xml is missing.');
  if (!name || !version)
    return refuse(3, 'package/package.xml has no <package name="..." version="...">.');
  const taken = reservedName(name);
  if (taken !== null)
    return refuse(
      3,
      `package/package.xml names the package "${name}", a name Satori itself uses: ${taken}. Choose another name, such as acme-config.`,
    );
  // The version rules are an app definition's: a configuration package alone is held to the
  // builder's, which read no version but the one package.xml gives.
  const definition = app ? JSON.parse(readFileSync(appFile, 'utf8').replace(/^\uFEFF/, '')) : null;
  if (definition !== null && definition.packageVersion !== version)
    return refuse(
      3,
      `app.json's packageVersion is ${definition.packageVersion}, and package.xml's version is ${version}.` +
        ' They are one version: raise both together.',
    );
  // The third place: the manifest's Bundle-Version, its lines unfolded as the builder unfolds
  // them. A manifest that names no Bundle-Version has nothing to disagree with.
  const manifestFile = join(directory, 'bundle', 'META-INF', 'MANIFEST.MF');
  if (definition !== null && existsSync(manifestFile)) {
    const headers = readFileSync(manifestFile, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n /g, '');
    const bundleVersion = /^Bundle-Version:[ \t]*([^\n]*)$/im.exec(headers)?.[1]?.trim();
    if (bundleVersion !== undefined && bundleVersion !== version)
      return refuse(
        3,
        `the manifest's Bundle-Version is ${bundleVersion}, and package.xml's version is ${version}.` +
          " They are one version: raise package.xml's, app.json's and the manifest's together.",
      );
  }
  if (tag !== undefined && tag !== `app-package/${name}/${version}`)
    return refuse(
      3,
      `the tag ${tag} is not app-package/${name}/${version}, this package as it is.`,
    );
  let changelog = null;
  if (previous !== undefined && definition === null) {
    console.error(
      `--previous holds an app definition's version to what it was, and ${shown} has no app.json: the upgrade check compares a configuration package with what it was.\n${host.usage}`,
    );
    return 2;
  }
  if (previous !== undefined) {
    const compared = sinceThePrevious(previous, directory, name, host);
    if (typeof compared === 'number') return compared;
    if (compared.refused !== null) {
      for (const change of compared.changes) console.error(`  - ${change.level}: ${change.what}`);
      return refuse(3, compared.refused);
    }
    // The changelog's first sentence: how many changes, what they need, what was raised.
    process.stdout.write(`${compared.changelog.split('\n')[0]}\n`);
    // The upgrade: what a customer's configuration made on the version before still finds.
    const upgrade = upgradeSince(previous, directory, previousPlatform, host);
    if (typeof upgrade === 'number') return upgrade;
    if (upgrade.findings.length > 0) {
      for (const finding of upgrade.findings)
        console.error(`  - ${finding.side}, ${finding.item}: ${finding.what}`);
      return refuse(
        3,
        `the upgrade from ${compared.previous} does not keep every customer configuration: ` +
          `${upgrade.findings.length === 1 ? '1 finding' : `${upgrade.findings.length} findings`}, listed above ` +
          '(package-pipeline.md, section 10).',
      );
    }
    for (const line of upgrade.said) process.stdout.write(`note: ${line}\n`);
    changelog = compared.changelog + upgradeNotes(upgrade.covered);
  }

  // 4. The zip, from version 1's builder, which checks the component XML the way the server does:
  // the package's own build.mjs, held to the generator's at step 1, or the generator's the tool
  // carries, run on the package as its own would be (`carriedBuild`).
  const build =
    host.builder.runs === 'package'
      ? spawnSync(process.execPath, [builder, '--out', output], {
          encoding: 'utf8',
          env: withoutCredentials(process.env),
          maxBuffer: OUTPUT_LIMIT,
        })
      : carriedBuild(template, directory, output);
  if (build.status !== 0) {
    process.stderr.write(build.stdout ?? '');
    process.stderr.write(build.stderr ?? '');
    return refuse(4, 'build.mjs refused the package, as above.');
  }
  const zip = join(output, `${name}-${version}.zip`);

  // 5. The zip, read back by a reader that did not write it.
  const problems = verifyPackageZip(zip);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    // A refused zip is not left where someone could install it.
    rmSync(zip, { force: true });
    return refuse(5, `${basename(zip)} is not a well-formed Nuxeo Package, and is removed.`);
  }
  const reach = configurationReach(directory);
  if (reach) {
    rmSync(zip, { force: true });
    return refuse(5, `${reach} ${basename(zip)} is removed.`);
  }

  // 6. Its checksum, which the publishing job checks before it signs anything, and what changed.
  const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
  writeFileSync(`${zip}.sha256`, `${digest}  ${basename(zip)}\n`);
  if (changelog !== null)
    writeFileSync(changesFile(output, name, version), `# ${name} ${version}\n\n${changelog}`);
  const where = relative(process.cwd(), zip);
  process.stdout.write(
    `${name} ${version}: checked, built and verified: ${where.startsWith('..') ? zip : where}, sha256 ${digest}\n`,
  );
  return 0;
}

/**
 * Step 2's app definition: the validator's findings, then the pipeline's own on the page providers,
 * the connectors, the contributions and the other kits' names. `null` when it passes, or the exit
 * code: 1, refused, with what refused it said, or 2, a command the validator could not run.
 */
function appDefinition(
  { directory, root, model, allowList, registered, platform, kits },
  host,
  refuse,
) {
  // With no model given, a package that ships a stand-in model is held to its own description of
  // it, so that a property it does not have is refused in CI as well.
  const own = model === undefined ? ownModel(directory) : null;
  const heldTo = model ?? own;
  if (own !== null) {
    process.stdout.write(
      `The content model is the package's own ${OWN_MODEL}, since the package ships a stand-in model and no --model was given.\n`,
    );
    // Read first, as the validator would: the package's own file that cannot be read is the
    // package's defect, refused here, not a command given wrongly, which --model's would be.
    const read = validator(host, ['model', own]);
    if (read.status !== 0) {
      process.stderr.write(read.stdout ?? '');
      process.stderr.write(read.stderr ?? '');
      return refuse(
        2,
        `the package's own ${OWN_MODEL}, which describes its stand-in model, cannot be read as a content model, as above. Write it again with app-model, or mend it.`,
      );
    }
  }
  // Said, so that a pass is not read as a check the model makes: a package on a customer's model
  // is held to it only when it is given.
  if (heldTo === undefined || heldTo === null)
    process.stdout.write(
      'No content model: none was given with --model or --model-server, and the package ships no stand-in model, so the checks that need one are not made. Give --model <file>, or --model-server <address> with NUXEO_USER and NUXEO_PASS, to hold the package to its server.\n',
    );
  const flags = [
    ...(allowList ? ['--allow-list', allowList] : []),
    ...(registered ? ['--registered', registered] : []),
    ...(platform ? ['--platform', platform] : []),
    ...(heldTo ? ['--model', heldTo] : []),
    '--catalogue',
    host.catalogue,
  ];
  const validation = validator(host, ['validate', root, ...flags]);
  process.stdout.write(validation.stdout ?? '');
  process.stderr.write(validation.stderr ?? '');
  if (validation.status === 2) return 2;
  if (validation.status !== 0) return refuse(2, 'the app definition has findings, listed above.');
  const refusedQueries = refusedNxql(directory);
  if (refusedQueries.length > 0) {
    for (const finding of refusedQueries) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      "a page provider's NXQL holds what Nuxeo refuses, listed above. This is a check of its tokens, not of the query: one it passes may still be refused on the server.",
    );
  }
  const unnamed = unmodelledNames(directory, heldTo);
  if (unnamed.length > 0) {
    for (const finding of unnamed) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      "a page provider's NXQL, sort, aggregate or predicate names a property the content model does not have, or misspells a type, a facet or a prefix, listed above.",
    );
  }
  const unanswered = unansweredAggregates(directory, root);
  if (unanswered.length > 0) {
    for (const finding of unanswered) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      'a facet or a figure names an aggregate its page provider does not define, listed above.',
    );
  }
  const unlisted = unlistedColumns(directory, root, heldTo);
  if (unlisted.length > 0) {
    for (const finding of unlisted) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      "a queue's or a related list's column or sort names a property the records its page provider lists do not have, or a widget that does not show one, listed above.",
    );
  }
  const unfilled = unfilledParameters(directory, root);
  if (unfilled.length > 0) {
    for (const finding of unfilled) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      "a queue, a related list or a home's figure gives a page provider of the package's own other than the parameters its NXQL takes, listed above.",
    );
  }
  const connected = connectorFindings(directory, root, heldTo);
  if (connected.length > 0) {
    for (const finding of connected) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      "a connector of the package's own, in connectors/, or an external card that reads one, is not what the connectors add-on would register or answer, listed above.",
    );
  }
  const contributed =
    layoutContributions(directory) ??
    allowListContributions(directory) ??
    appContributions(directory, root);
  if (contributed) return refuse(2, contributed);
  const others =
    kits === undefined
      ? host.kits !== null && resolve(dirname(resolve(directory))) === resolve(host.kits)
        ? resolve(host.kits)
        : null
      : resolve(kits);
  if (others !== null) {
    const compared = kitClashes(directory, others, host);
    for (const note of compared.notes) process.stdout.write(`note: ${note}\n`);
    if (compared.findings.length > 0) {
      for (const finding of compared.findings) process.stdout.write(`${finding}\n`);
      return refuse(
        2,
        `the package names what another kit in ${shownFolder(others)} names too, listed above. Give each a name of its own: installed on one server, one kit's would replace the other's, or be refused.`,
      );
    }
    process.stdout.write(
      `Compared with the ${compared.kits === 1 ? 'other kit' : `${compared.kits} other kits`} in ${shownFolder(others)}: no name of the package's is another's.\n`,
    );
  }
  return null;
}

/**
 * The generator's `build.mjs`, `template`, run on the package in `directory` as the package's own
 * copy of it would run: the same bytes, with the package's folder as the folder it builds. The
 * builder finds the package beside itself, in the folder of its own module URL, and a module Node reads from
 * standard input is one in the working directory (`file:///<cwd>/[eval1]`), so it is given the
 * template on standard input with the package's folder as its working directory. `--out` is
 * absolute, so the working directory names nothing else: only the line it prints once built, which
 * the pipeline does not show. What the builder refuses, it names from the package's folder, as it
 * does run from there. So the tool needs no copy of the package, and writes nothing into it.
 */
function carriedBuild(template, directory, output) {
  return spawnSync(process.execPath, ['--input-type=module', '-', '--out', output], {
    cwd: resolve(directory),
    input: template,
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: OUTPUT_LIMIT,
  });
}

/** Where the changelog goes, beside the zip. */
function changesFile(output, name, version) {
  return join(output, `${name}-${version}.changes.md`);
}

/**
 * The package against the one it was before (`--previous`): the validator's judgement of the
 * version, as JSON, or the exit code when the comparison could not be made. The previous package is
 * the operator's input, such as the base branch's copy; one with another name is another package,
 * and is refused.
 */
function sinceThePrevious(previous, directory, name, host) {
  if (!existsSync(previous) || !lstatSync(previous).isDirectory()) {
    console.error(`--previous ${previous} is not a folder.\n${host.usage}`);
    return 2;
  }
  const descriptor = join(previous, 'package', 'package.xml');
  let previousName = null;
  try {
    if (!lstatSync(descriptor).isSymbolicLink())
      previousName = attribute(
        withoutCdata(withoutCommentsOrInstructions(readFileSync(descriptor, 'utf8'))),
        'package',
        'name',
      );
  } catch {
    // Named below.
  }
  if (previousName === null) {
    console.error(
      `--previous ${previous} has no package/package.xml naming its package (a link is not followed).\n${host.usage}`,
    );
    return 2;
  }
  if (previousName !== name)
    return {
      changes: [],
      refused:
        `the previous package is ${previousName}, and this one is ${name}. A package keeps its` +
        ' name from one version to the next; a new name is a new package, compared with nothing.',
    };
  const compared = validator(host, ['changes', resolve(previous), resolve(directory)]);
  if (compared.status !== 0 && compared.status !== 1) {
    process.stderr.write(compared.stderr ?? '');
    return 2;
  }
  try {
    return JSON.parse(compared.stdout);
  } catch {
    process.stderr.write(compared.stdout ?? '');
    process.stderr.write(compared.stderr ?? '');
    return 2;
  }
}

/**
 * The upgrade check (`upgrade-check.mjs`, as the host runs it) on the package against the one it
 * was, and, given one, the platform against the one it was: its verdict for this package, as JSON,
 * or the exit code when the comparison could not be made. Run as a command, as the validator is.
 */
function upgradeSince(previous, directory, previousPlatform, host) {
  const checked = spawnSync(
    host.upgradeCheck[0],
    [
      ...host.upgradeCheck.slice(1),
      resolve(directory),
      '--previous',
      resolve(previous),
      ...(previousPlatform === undefined ? [] : ['--previous-platform', resolve(previousPlatform)]),
      '--json',
    ],
    { encoding: 'utf8', env: withoutCredentials(process.env), maxBuffer: OUTPUT_LIMIT },
  );
  if (checked.status !== 0 && checked.status !== 1) {
    process.stderr.write(checked.stderr ?? '');
    return 2;
  }
  try {
    const [verdict] = JSON.parse(checked.stdout).packages;
    if (verdict && Array.isArray(verdict.findings)) return verdict;
  } catch {
    // Said below.
  }
  process.stderr.write(checked.stdout ?? '');
  process.stderr.write(checked.stderr ?? '');
  return 2;
}

/**
 * The migration notes that cover the upgrade, for the changelog: each once, with the items it
 * covers, so that whoever installs the release reads what to change in their own configuration.
 */
function upgradeNotes(covered) {
  const notes = new Map();
  for (const { side, item, note } of covered) {
    const key = JSON.stringify(note);
    if (!notes.has(key)) notes.set(key, { note, items: [] });
    notes.get(key).items.push(side === 'kit' ? item : `the platform's ${item}`);
  }
  if (notes.size === 0) return '';
  const lines = ['', '## Upgrading', ''];
  for (const { note, items } of notes.values())
    lines.push(
      `- ${items.map((item) => `\`${item}\``).join(', ')}, since ${note.version}: ${note.note}`,
    );
  return `${lines.join('\n')}\n`;
}

/**
 * The first symbolic link at `path` or anywhere under it, `null` when there is none, or the place
 * that could not be read, `{ path, code }`: a folder that cannot be read is reported rather than
 * passed over. Not followed:
 * a link inside a package can point anywhere.
 */
function firstLink(path) {
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (!entry) return null;
    if (entry.isSymbolicLink()) return path;
    if (!entry.isDirectory()) return null;
    for (const name of readdirSync(path).sort()) {
      const found = firstLink(join(path, name));
      if (found !== null) return found;
    }
    return null;
  } catch (error) {
    return { path, code: error.code ?? error.message };
  }
}

/**
 * The file a component path names inside the bundle, `''` when there is none (the builder's to
 * refuse, at step 4), or why it is refused here. Step 1 has already refused any symbolic link in
 * the package, so what is left is the path itself. A component is read only when the path is
 * relative, stays inside `bundle/` once resolved (`..` cannot climb out), and names a regular file
 * with one name: not a folder, and not a hard link, whose other name can be anywhere on the volume.
 * Read, a component outside the bundle would have its layout attributes quoted back from wherever
 * it is, to whoever runs the pipeline, an agent included.
 */
function componentFileOf(root, component) {
  const refuse = (why) => ({
    problem: `the manifest names the component ${component}, which ${why}. A package's components are files in its bundle.`,
  });
  if (isAbsolute(component)) return refuse('is an absolute path');
  const file = resolve(root, component);
  if (file === root) return refuse('is bundle/ itself');
  if (!file.startsWith(root + sep)) return refuse('is outside bundle/');
  let entry;
  try {
    entry = lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    // A path through a file, such as `x.xml/y.xml`, names nothing: the builder's to refuse.
    if (error.code === 'ENOTDIR') return '';
    return refuse(`cannot be read: ${error.code ?? error.message}`);
  }
  if (!entry) return '';
  if (!entry.isFile()) return refuse('is a folder, not a file');
  // A checkout gives every file one name.
  if (entry.nlink > 1) return refuse('has a second name, a hard link');
  return file;
}

/**
 * What is wrong with the layouts the package's components contribute, or `null`. The validator read
 * the files at `layouts/<Type>/<mode>.layout.json`, each in the mode its path names; the server
 * serves what the component says. So a layout written inline, or contributed from another file or
 * in another mode, is one this stage did not check, and is refused rather than passed. A disabled
 * entry contributes nothing and is skipped, as the builder skips it. A manifest that is not a file
 * is refused before it is read, as is a component path that leaves `bundle/`, or names a folder or
 * a hard link (`componentFileOf`).
 *
 * The other way round too: a file under `agentic-ui-config/layouts/` that no enabled entry
 * contributes is one the validator passed and the server would never serve, so it is refused,
 * naming the file and the entry that would contribute it (`uncontributedLayout`). It is the step
 * that reads the contributions, so it is here.
 */
function layoutContributions(directory) {
  const bundle = join(directory, 'bundle');
  const manifest = join(bundle, 'META-INF', 'MANIFEST.MF');
  // A bundle with no manifest, or a component it cannot find, is the builder's to refuse.
  if (!existsSync(manifest)) return null;
  // A folder there names no component, and reading it would throw.
  if (!lstatSync(manifest).isFile())
    return "bundle/META-INF/MANIFEST.MF is not a file. A bundle's manifest is a file, which names its components.";
  // The components this stage checks must be the ones the server loads, so they are found as
  // build.mjs finds them: its TextDecoder drops a byte-order mark, and componentPathsOf reads the
  // rest as the server's manifest reader does. Every header's components are checked, a superset
  // of what the server loads; a manifest with more than one header, or the header spelt another
  // way, is the builder's to refuse, at step 4.
  const text = readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '');
  const root = resolve(bundle);
  /**
   * The files the enabled entries contribute, those only a disabled entry names, and those only an
   * entry outside the configuration's extension point names, where nothing registers it.
   */
  const contributed = new Set();
  const disabled = new Map();
  const misplaced = new Map();
  let missing = false;
  for (const component of componentPathsOf(text)) {
    const file = componentFileOf(root, component);
    if (typeof file !== 'string') return file.problem;
    if (file === '') {
      missing = true;
      continue;
    }
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error) {
      return `the manifest names the component ${component}, which cannot be read: ${error.code ?? error.message}.`;
    }
    const xml = componentXmlOf(source);
    const configuration = configurationExtensions(xml);
    for (const match of xml.matchAll(new RegExp(`<layout${TAG}`, 'g'))) {
      const { type, mode, src, enabled } = attributesOf(match[1]);
      if (enabled !== undefined && enabled.toLowerCase() !== 'true') {
        if (src !== undefined) disabled.set(posix.normalize(src), component);
        continue;
      }
      const checked = `agentic-ui-config/layouts/${type}/${mode}.layout.json`;
      if (src === undefined)
        return (
          `${component} contributes the ${type}/${mode} layout inline, which this stage cannot ` +
          `check. Write it to ${checked} and name that in src.`
        );
      if (posix.normalize(src) !== checked)
        return (
          `${component} contributes the ${type}/${mode} layout from ${src}. Contribute it from ` +
          `${checked}, where the validator reads it in that mode.`
        );
      if (configuration.some(([from, to]) => match.index > from && match.index < to))
        contributed.add(checked);
      else misplaced.set(checked, component);
    }
  }
  // A component that is missing is the builder's to refuse, at step 4: the layouts it would have
  // contributed are not called uncontributed first.
  if (missing) return null;
  return uncontributedLayout(bundle, contributed, disabled, misplaced);
}

/**
 * Where Nuxeo registers a `<layout>` or an `<app>` in a component's markup: its extensions to
 * `org.nuxeo.agentic.ui.config`'s "configuration" point, each as `[start, end]`. One anywhere else,
 * a misspelt point or another component's target, is registered by nothing.
 */
function configurationExtensions(xml) {
  return extensionsOf(xml, 'org.nuxeo.agentic.ui.config', 'configuration');
}

/** A component's extensions to `target`'s `point`, each as `[start, end]` in its markup. */
function extensionsOf(xml, target, point) {
  return [
    ...xml.matchAll(new RegExp(`<extension${TAG}([\\s\\S]*?)</extension[ \\t\\r\\n]*>`, 'g')),
  ].flatMap((extension) => {
    const attributes = attributesOf(extension[1]);
    return attributes.target === target && attributes.point === point
      ? [[extension.index, extension.index + extension[0].length]]
      : [];
  });
}

/**
 * The components the manifest names that can be read inside the bundle, each with its markup as
 * the builder reads it. One that cannot is passed over: `layoutContributions` refuses it, and the
 * builder refuses one that is missing.
 */
function componentsOf(directory) {
  const bundle = join(directory, 'bundle');
  const manifest = join(bundle, 'META-INF', 'MANIFEST.MF');
  if (!existsSync(manifest) || !lstatSync(manifest).isFile()) return [];
  const components = [];
  for (const component of componentPathsOf(readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''))) {
    const file = componentFileOf(resolve(bundle), component);
    if (typeof file !== 'string' || file === '') continue;
    try {
      const source = readFileSync(file, 'utf8');
      // `xml` is `kept` with its CDATA and documentation blanked, offset for offset, so a text
      // found in one is read, CDATA and all, from the other.
      components.push({
        component,
        xml: componentXmlOf(source),
        kept: withoutCommentsOrInstructions(source),
      });
    } catch {
      // Unreadable: layoutContributions says so.
    }
  }
  return components;
}

/**
 * An element's text as the server reads it: a CDATA section's as written, the rest with its
 * entities and character references decoded.
 */
function xmlText(text) {
  return text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? part.slice('<![CDATA['.length, -']]>'.length)
        : part.replace(
            /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g,
            (reference, hex, decimal, named) => {
              if (named) return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[named];
              const codePoint = hex ? parseInt(hex, 16) : Number(decimal);
              return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : reference;
            },
          ),
    )
    .join('');
}

/**
 * The text of the first `<element>` of `blanked`, read from `kept` at the same offsets, or `null`
 * when there is none.
 */
function elementText(blanked, kept, element) {
  const open = new RegExp(`<${element}${TAG}`).exec(blanked);
  if (!open || open[1].trimEnd().endsWith('/')) return open ? '' : null;
  const start = open.index + open[0].length;
  const end = blanked.indexOf(`</${element}`, start);
  return xmlText(kept.slice(start, end === -1 ? kept.length : end));
}

/**
 * The package's own content model, when no other is given: `content-model.json` beside `bundle/`,
 * as `app-model` writes it, when the package ships a stand-in model, a component that registers
 * document types of its own. `null` otherwise: a package on a customer's model ships no types, and
 * a file there with no stand-in behind it describes a server, which may have changed since. A
 * `<doctype append="true">` adds to a type the server has, and is not one of the package's own.
 */
function ownModel(directory) {
  const file = join(directory, OWN_MODEL);
  if (!existsSync(file) || !lstatSync(file).isFile()) return null;
  const standIn = componentsOf(directory).some(({ xml }) =>
    extensionsOf(xml, 'org.nuxeo.ecm.core.schema.TypeService', 'doctype').some(([from, to]) =>
      [...xml.slice(from, to).matchAll(new RegExp(`<doctype${TAG}`, 'g'))].some(
        ([, attributes]) => attributesOf(attributes).append?.toLowerCase() !== 'true',
      ),
    ),
  );
  return standIn ? file : null;
}

/**
 * The page providers the package's own components define, by name: the component, whether it reads
 * the repository (`coreQueryPageProvider`) or is generic, such as the search index's, the ids of
 * the aggregates it defines, its NXQL, a pattern's or a where clause's fixed part, as the server
 * reads it, and the type its NXQL lists, when it says (`listedType`). A disabled definition takes
 * the page provider away, as the server does; of two definitions, the later the manifest loads is
 * the one the server keeps.
 */
function pageProvidersOf(directory) {
  const providers = new Map();
  for (const { component, xml, kept } of componentsOf(directory)) {
    for (const [from, to] of extensionsOf(
      xml,
      'org.nuxeo.ecm.platform.query.api.PageProviderService',
      'providers',
    )) {
      const extension = xml.slice(from, to);
      const extensionKept = kept.slice(from, to);
      for (const match of extension.matchAll(
        new RegExp(`<(coreQueryPageProvider|genericPageProvider)${TAG}`, 'g'),
      )) {
        const [tag, element, inside] = match;
        const { name, enabled, class: className } = attributesOf(inside);
        if (!name) continue;
        if (enabled !== undefined && enabled.toLowerCase() !== 'true') {
          providers.delete(name);
          continue;
        }
        const start = match.index + tag.length;
        const end = inside.trimEnd().endsWith('/')
          ? start
          : extension.indexOf(`</${element}`, start);
        const definition = extension.slice(start, end === -1 ? extension.length : end);
        const definitionKept = extensionKept.slice(start, end === -1 ? extension.length : end);
        const aggregateTags = [...definition.matchAll(new RegExp(`<aggregate${TAG}`, 'g'))].map(
          ([, attributes]) => attributesOf(attributes),
        );
        const aggregates = aggregateTags
          .map(({ id }) => id)
          .filter((id) => id !== undefined && id !== '');
        // The properties it names besides its NXQL: what it sorts by, what each aggregate groups
        // by, and what each predicate compares.
        const named = [
          ...[...definition.matchAll(new RegExp(`<sort${TAG}`, 'g'))]
            .map(([, attributes]) => attributesOf(attributes).column)
            .map((column, index) => ({ place: `sort[${index}].column`, xpath: column })),
          ...aggregateTags.map(({ id, parameter }) => ({
            place: `aggregates.${id}.parameter`,
            xpath: parameter,
          })),
          // A where clause's predicate, the property a search form's field is compared with.
          ...[...definition.matchAll(new RegExp(`<predicate${TAG}`, 'g'))]
            .map(([, attributes]) => attributesOf(attributes).parameter)
            .map((parameter, index) => ({
              place: `whereClause.predicates[${index}].parameter`,
              xpath: parameter,
            })),
        ].filter(({ xpath }) => typeof xpath === 'string' && xpath !== '');
        // Nuxeo builds the query from the where clause whenever there is one, and from the pattern
        // only when there is not.
        const whereClause = new RegExp(`<whereClause${TAG}`).exec(definition);
        const fixedPart =
          whereClause === null
            ? null
            : elementText(
                definition.slice(whereClause.index),
                definitionKept.slice(whereClause.index),
                'fixedPart',
              );
        const pattern =
          whereClause === null ? elementText(definition, definitionKept, 'pattern') : null;
        // Read only from a page provider that takes NXQL: the repository's, or a generic one of
        // Nuxeo's NXQL classes. Another class's pattern, such as the audit's, is another language.
        const takesNxql =
          element === 'coreQueryPageProvider' ||
          /(?:^|\.)(?:SearchServicePageProvider|ElasticSearchNxqlPageProvider|CoreQueryDocumentPageProvider|CoreQueryAndFetchPageProvider)$/.test(
            className ?? '',
          );
        const nxql = takesNxql ? (pattern ?? fixedPart) : null;
        providers.set(name, {
          component,
          repository: element === 'coreQueryPageProvider',
          aggregates: new Set(aggregates),
          nxql: nxql === null ? null : { text: nxql, pattern: pattern !== null },
          listed: nxql === null ? null : listedType(nxql, { pattern: pattern !== null }),
          named,
        });
      }
    }
  }
  return providers;
}

/**
 * The connectors the package contributes itself, each `<connector>` of a component in
 * `connectors/`, beside its bundle, as `app-connector` writes them: `[{ id, file, types, key,
 * fields, address, credential, text }]`, read as the builder reads a component, its comments left
 * out. Disabled ones register nothing, and are not read.
 */
function ownConnectors(directory) {
  const folder = join(directory, 'connectors');
  if (!existsSync(folder) || !lstatSync(folder).isDirectory()) return [];
  const found = [];
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (!name.endsWith('.xml') || !lstatSync(path).isFile()) continue;
    const xml = componentXmlOf(readFileSync(path, 'utf8'));
    for (const [start, end] of extensionsOf(xml, 'org.nuxeo.agentic.connectors', 'connectors'))
      for (const match of xml
        .slice(start, end)
        .matchAll(
          /<connector(?=[ \t\r\n/>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/connector[ \t\r\n]*>/g,
        )) {
        const attributes = attributesOf(match[1]);
        if (attributes.enabled !== undefined && attributes.enabled.toLowerCase() !== 'true')
          continue;
        const body = match[2];
        const tags = (element) =>
          [
            ...body.matchAll(
              new RegExp(`<${element}(?=[ \\t\\r\\n/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g'),
            ),
          ].map(([, inner]) => attributesOf(inner.replace(/\/$/, '')));
        const texts = (element) =>
          [...body.matchAll(new RegExp(`<${element}>([^<]*)</${element}>`, 'g'))].map(([, text]) =>
            text.trim(),
          );
        found.push({
          id: attributes.id ?? '',
          file: path,
          types: texts('type'),
          key: tags('key')[0]?.xpath,
          fields: tags('field').map((field) => ({
            name: field.name ?? '',
            pointer: field.pointer,
          })),
          address: tags('address'),
          addressText: texts('address'),
          path: texts('path'),
          permission: texts('permission'),
          credential: tags('credential')[0],
          limits: Object.fromEntries(
            Object.keys(CONNECTOR.limits).map((element) => [element, texts(element)]),
          ),
          text: match[0],
        });
      }
  }
  return found;
}

/**
 * What the package's own connectors are not, and each `external` card that reads one wrongly, as
 * findings in the validator's form (package-pipeline.md, section 2). The connectors add-on would
 * leave out a connector that breaks its rules, and the card would show its error state; a card's
 * field its connector does not return shows nothing, and a card on a type the connector does not
 * read shows nothing either. So:
 *
 * - **each connector** has an id of the add-on's form, once in the package; an address only as
 *   the server property `nuxeo.agentic.connectors.<id>.<name>`, and no text anywhere that is an
 *   address; a credential, if any, from a property under the same prefix or an environment
 *   variable `NUXEO_CONNECTOR_<ID>_<NAME>`, never written; 1 to 20 types and 1 to 50 fields of the
 *   add-on's form, each once; and a key, `<prefix>:<name>`;
 * - **given a content model,** each type is in it, and the key is a property of each, one value;
 * - **each `external` card** of a layout that names one of these connectors is on a type the
 *   connector reads, and names only fields it returns.
 *
 * A card naming a connector the package does not contribute is the server's, as `--registered`
 * says, and is not read here.
 */
function connectorFindings(directory, root, model) {
  const connectors = ownConnectors(directory);
  if (connectors.length === 0) return [];
  let read = null;
  if (model !== undefined && model !== null) {
    try {
      read =
        readContentModel(JSON.parse(readFileSync(model, 'utf8').replace(/^\uFEFF/, ''))).model ??
        null;
    } catch {
      // The validator has read it already, and said what was wrong.
    }
  }
  const findings = [];
  const say = (file, place, message, kind) =>
    findings.push(`${file}: ${place}: ${message} [${kind}]`);
  const seen = new Set();
  for (const connector of connectors) {
    const at = `connectors.${connector.id || '?'}`;
    const { id, file } = connector;
    if (!CONNECTOR.id.test(id) || /\.(?:http|cache|events)$/.test(id))
      say(
        file,
        at,
        `"${id}" is not a connector's id: 1 to 64 letters, digits, ".", "_" or "-", starting with a letter, and not ending in .http, .cache or .events`,
        'structure',
      );
    else if (seen.has(id))
      say(
        file,
        at,
        `the connector "${id}" is contributed twice: the later replaces the earlier`,
        'structure',
      );
    seen.add(id);
    const prefix = `nuxeo.agentic.connectors.${id}.`;
    const envPrefix = `NUXEO_CONNECTOR_${id.toUpperCase().replace(/[.-]/g, '_')}_`;
    /** `Connector.ownProperty`: the connector's prefix, then one name. */
    const ownProperty = (name) =>
      typeof name === 'string' &&
      CONNECTOR.property.test(name) &&
      name.startsWith(prefix) &&
      CONNECTOR.ownName.test(name.slice(prefix.length));
    const ownEnv = (name) =>
      typeof name === 'string' &&
      CONNECTOR.env.test(name) &&
      name.startsWith(envPrefix) &&
      CONNECTOR.ownEnvName.test(name.slice(envPrefix.length));
    if (/\/\/|\b(?:https?|ldaps?|ftps?|wss?):/i.test(connector.text))
      say(
        file,
        at,
        'holds an address: a connector names the server property its address is in, never the address',
        'structure',
      );
    if (connector.address.length !== 1 || connector.addressText.some((text) => text !== ''))
      say(
        file,
        `${at}.address`,
        'a connector has one <address property="..." />, the server property its address is in, and nothing in it',
        'structure',
      );
    else if (!ownProperty(connector.address[0].property))
      say(
        file,
        `${at}.address`,
        `its property is one of the connector's own, ${prefix}<name>, one name of letters, digits, "_" or "-"`,
        'structure',
      );
    if (connector.path.length !== 1 || !soundConnectorPath(connector.path[0]))
      say(
        file,
        `${at}.path`,
        'a connector has one <path>, from "/", holding {key} once, and otherwise only letters, digits, "/", ".", "_", "~" and "-", with no empty, "." or ".." segment and no query',
        'structure',
      );
    const permission = connector.permission[0] ?? '';
    if (
      connector.permission.length > 1 ||
      (permission !== '' && !CONNECTOR.permission.test(permission))
    )
      say(
        file,
        `${at}.permission`,
        'a connector names one Nuxeo permission, such as Read',
        'structure',
      );
    if (connector.credential) {
      const { header, prefix: written, property, env: variable } = connector.credential;
      if (
        header === undefined ||
        !CONNECTOR.header.test(header) ||
        CONNECTOR.forbiddenHeaders.has(header.toLowerCase()) ||
        header.toLowerCase().startsWith('proxy-')
      )
        say(
          file,
          `${at}.credential`,
          'a credential is sent in a header such as Authorization or X-Api-Key: not one that changes where or how the request goes',
          'structure',
        );
      if (written !== undefined && (written.length > 32 || !/^[\x20-\x7e]*$/.test(written)))
        say(
          file,
          `${at}.credential`,
          'its prefix is up to 32 printable characters, such as "Bearer "',
          'structure',
        );
      if (property === undefined && variable === undefined)
        say(
          file,
          `${at}.credential`,
          'a credential names the server property or the environment variable it is in, never the credential',
          'structure',
        );
      if (property !== undefined && !ownProperty(property))
        say(
          file,
          `${at}.credential`,
          `its property is one of the connector's own, ${prefix}<name>, one name of letters, digits, "_" or "-"`,
          'structure',
        );
      if (variable !== undefined && !ownEnv(variable))
        say(
          file,
          `${at}.credential`,
          `its environment variable is one of the connector's own, ${envPrefix}<NAME>, in capitals and digits`,
          'structure',
        );
    }
    for (const [element, [least, most]] of Object.entries(CONNECTOR.limits)) {
      const given = connector.limits[element];
      if (given.length === 0) continue;
      const value = Number(given[0]);
      if (given.length > 1 || !/^\d+$/.test(given[0]) || value < least || value > most)
        say(
          file,
          `${at}.${element}`,
          `<${element}> is one whole number from ${least} to ${most}`,
          'structure',
        );
    }
    if (
      connector.types.length === 0 ||
      connector.types.length > 20 ||
      !connector.types.every((type) => CONNECTOR.type.test(type))
    )
      say(
        file,
        `${at}.type`,
        "a connector reads 1 to 20 document types, each a type's name",
        'structure',
      );
    if (connector.fields.length === 0 || connector.fields.length > 50)
      say(file, `${at}.field`, 'a connector returns 1 to 50 fields', 'structure');
    const names = connector.fields.map((field) => field.name);
    connector.fields.forEach(({ name, pointer }, index) => {
      if (!CONNECTOR.field.test(name))
        say(
          file,
          `${at}.field[${index}]`,
          `"${name}" is not a field's name: letters, digits and "_", starting with a letter`,
          'structure',
        );
      else if (names.indexOf(name) !== index)
        say(file, `${at}.field[${index}]`, `the field "${name}" is listed twice`, 'structure');
      else if (pointer !== undefined && (!pointer.startsWith('/') || pointer.length > 256))
        say(
          file,
          `${at}.field[${index}]`,
          `the pointer of "${name}" is a JSON pointer into the answer, from "/", up to 256 characters`,
          'structure',
        );
    });
    if (
      typeof connector.key !== 'string' ||
      !CONNECTOR.xpath.test(connector.key) ||
      /^(?:ecm|var):/.test(connector.key)
    )
      say(
        file,
        `${at}.key`,
        'a connector reads its key from a property of the record, <key xpath="<prefix>:<name>" />',
        'structure',
      );
    else if (read !== null)
      for (const type of connector.types) {
        if (!read.types.has(type)) {
          say(
            file,
            `${at}.type`,
            `the document type "${type}" is not in the content model`,
            'unknown',
          );
          continue;
        }
        const property = propertiesOf(read, type)?.get(connector.key);
        if (!property)
          say(
            file,
            `${at}.key`,
            `"${connector.key}" is not a property of the type "${type}" or of its facets, so the connector has no key to read`,
            'unknown',
          );
        else if (property.list || property.type === 'complex' || property.type === 'blob')
          say(
            file,
            `${at}.key`,
            `"${connector.key}" holds ${property.list ? 'a list' : `a ${property.type} value`} on "${type}", and a key is one value`,
            'parameter',
          );
      }
  }
  // Each external card on one of these connectors, in each layout.
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));
  const layouts = join(root, 'layouts');
  if (existsSync(layouts) && lstatSync(layouts).isDirectory())
    for (const path of filesUnder(layouts)
      .filter((file) => file.endsWith('.layout.json'))
      .sort()) {
      const type = path.split('/')[0];
      const file = join(layouts, ...path.split('/'));
      const content = definitionFile(file);
      if (!isObject(content)) continue;
      const cards = (list, at) => {
        if (!Array.isArray(list)) return;
        list.forEach((card, index) => {
          const external = isObject(card) ? card.external : undefined;
          if (!isObject(external) || typeof external.connector !== 'string') return;
          const connector = byId.get(external.connector);
          if (!connector) return;
          const place = `${at}[${index}].external`;
          if (connector.types.length > 0 && !connector.types.includes(type))
            say(
              file,
              `${place}.connector`,
              `the connector "${connector.id}" (connectors/${basename(connector.file)}) reads ${connector.types.join(', ')}, not "${type}", so the card shows nothing`,
              'unknown',
            );
          if (!Array.isArray(external.fields)) return;
          external.fields.forEach((entry, inner) => {
            const name =
              typeof entry === 'string' ? entry : isObject(entry) ? entry.name : undefined;
            if (typeof name === 'string' && !connector.fields.some((field) => field.name === name))
              say(
                file,
                `${place}.fields[${inner}]${typeof entry === 'string' ? '' : '.name'}`,
                `the connector "${connector.id}" (connectors/${basename(connector.file)}) does not return the field "${name}": it returns ${connector.fields.map((field) => field.name).join(', ')}`,
                'unknown',
              );
          });
        });
      };
      cards(content.cards, 'cards');
      if (Array.isArray(content.tabs))
        content.tabs.forEach((tab, index) => {
          if (isObject(tab)) cards(tab.cards, `tabs[${index}].cards`);
        });
    }
  return findings;
}

/** A folder as the pipeline's messages name it: from the working directory when inside it. */
function shownFolder(folder) {
  const near = relative(process.cwd(), folder);
  return near === '' ? '.' : near.startsWith('..') || isAbsolute(near) ? folder : near;
}

/** The platform's own label keys, every key of its English catalogue, nested as the app reads it. */
function catalogueKeys(host) {
  const keys = new Set();
  const walk = (value, prefix) => {
    for (const [key, inner] of Object.entries(value)) {
      const named = prefix === '' ? key : `${prefix}.${key}`;
      if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) walk(inner, named);
      else keys.add(named);
    }
  };
  walk(JSON.parse(readFileSync(host.catalogue, 'utf8')), '');
  return keys;
}

/**
 * What the package names that another kit in `folder` names too, each a finding the way the
 * validator writes one, `<file>: <what>: <why> [clash]`: what the release candidate's stage 3
 * compares, the package's name, its app's id and address, its queues, its actions and what its
 * components register, read as `readKitFolder` reads a kit's folder, with the kit's own label keys
 * and its connectors. Every folder of `folder` with an app definition is a kit, but the one named
 * as this package's folder is, which is this package as it was, or this package. A kit that
 * cannot be read is not compared, and a note says so.
 */
function kitClashes(directory, folder, host) {
  const platformKeys = catalogueKeys(host);
  const notes = [];
  let own;
  try {
    own = readKitFolder(directory, { platformKeys });
  } catch (error) {
    return {
      kits: 0,
      findings: [],
      notes: [
        `the package's names were not compared with other kits: a file of it could not be read as a kit's (${error.name ?? 'Error'}).`,
      ],
    };
  }
  const name = basename(resolve(directory));
  const others = [];
  const entries = existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )
    : [];
  for (const entry of entries) {
    // A link is not followed, and the package's own folder is the package.
    if (!entry.isDirectory() || entry.name === name) continue;
    const kit = join(folder, entry.name);
    if (!existsSync(join(kit, 'bundle', 'agentic-ui-config', 'app.json'))) continue;
    // Read through no link: what is read can be named back, and a link can point anywhere.
    if (firstLink(kit) !== null) {
      notes.push(`${entry.name} was not compared: it holds a link, which is not followed.`);
      continue;
    }
    try {
      others.push({ folder: entry.name, read: readKitFolder(kit, { platformKeys }) });
    } catch (error) {
      // The reason by its kind only: a parser's message can quote the file it could not read.
      notes.push(
        `${entry.name} was not compared: a file of it could not be read as a kit's (${error.name ?? 'Error'}).`,
      );
    }
  }
  const findings = [];
  const seen = new Set();
  // A label key is a clash only when it is begun with the app's name of one of the two kits: the
  // app's own, which the other has too.
  const appOf = (read) => (typeof read.app?.id === 'string' ? `${read.app.id}.` : null);
  for (const [key, file] of own.labelKeys) {
    const owners = others.filter(
      (other) =>
        other.read.labelKeys.has(key) &&
        [appOf(own), appOf(other.read)].some((prefix) => prefix !== null && key.startsWith(prefix)),
    );
    if (owners.length === 0) continue;
    findings.push(
      `${join(directory, ...file.split('/'))}: labels[${JSON.stringify(key)}]: the label key is ${owners.map((owner) => owner.folder).join(' and ')}'s too, and is begun with an app's name, which makes it that app's own (app-definition-v2.md, section 7) [clash]`,
    );
  }
  for (const { kind, key, file } of own.contributes) {
    const id = `${kind}\u0000${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const owners = others.filter((other) =>
      other.read.contributes.some((entry) => entry.kind === kind && entry.key === key),
    );
    if (owners.length === 0) continue;
    const named = owners.map((owner) => owner.folder).join(' and ');
    const at = join(directory, ...file.split('/'));
    findings.push(
      `${at}: ${kind} ${JSON.stringify(key)}: ${named} ${owners.length === 1 ? 'contributes' : 'contribute'} it too [clash]`,
    );
  }
  return { kits: others.length, findings, notes };
}

/** A JSON file of the app definition, or `null` when it cannot be read: the validator says why. */
function definitionFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** A JSON object: not a list, not `null`. A declaration, since the run starts above it. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Each aggregate a queue's facet or a home's figure names on a page provider of the package's own
 * that does not define it, as a finding in the validator's form: the file, the place, why. Only the
 * search index answers aggregates, and only those a page provider defines: a facet on any other is
 * left out of the queue, and a figure reads "Unavailable", each said only in the browser's console.
 * A page provider the package does not define is the server's, and is not checked here.
 */
function unansweredAggregates(directory, root) {
  const providers = pageProvidersOf(directory);
  if (providers.size === 0) return [];
  const findings = [];
  const check = (file, place, pageProvider, aggregate) => {
    const provider = providers.get(pageProvider);
    if (
      provider === undefined ||
      typeof aggregate !== 'string' ||
      provider.aggregates.has(aggregate)
    )
      return;
    const defined = [...provider.aggregates];
    const why =
      defined.length > 0
        ? `it defines ${defined.join(', ')}`
        : provider.repository
          ? 'it reads the repository, which answers none. A facet or a figure needs a page provider of the search index that defines the aggregate, as app-model --aggregates writes one'
          : 'it defines none';
    findings.push(
      `${join(root, file)}: ${place}: the page provider "${pageProvider}", defined in ${provider.component}, has no aggregate "${aggregate}": ${why} [unknown]`,
    );
  };
  const queues = join(root, 'queues');
  if (existsSync(queues) && lstatSync(queues).isDirectory())
    for (const entry of readdirSync(queues, { withFileTypes: true })
      .filter((each) => each.isFile() && each.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const queue = definitionFile(join(queues, entry.name));
      if (!isObject(queue) || !Array.isArray(queue.facets)) continue;
      queue.facets.forEach((facet, index) =>
        check(
          join('queues', entry.name),
          `facets[${index}].aggregate`,
          queue.pageProvider,
          isObject(facet) ? facet.aggregate : undefined,
        ),
      );
    }
  const home = definitionFile(join(root, 'home.json'));
  if (isObject(home) && Array.isArray(home.cards))
    home.cards.forEach((card, index) => {
      const kpi = isObject(card) ? card.kpi : undefined;
      if (isObject(kpi))
        check('home.json', `cards[${index}].kpi.aggregate`, kpi.pageProvider, kpi.aggregate);
    });
  return findings;
}

/**
 * What Nuxeo refuses in the NXQL of each page provider the package defines, as a finding in the
 * validator's form: the component, the page provider and the element, why (`nxqlProblems`). A
 * check of the query's tokens for constructs Nuxeo's grammar has no place for, such as
 * `BETWEEN NOW(...)`, which a server answered 400: not a parse, so a query it passes may still be
 * refused on install (package-pipeline.md, section 2).
 */
function refusedNxql(directory) {
  const findings = [];
  for (const [name, { component, nxql }] of pageProvidersOf(directory)) {
    if (nxql === null) continue;
    const place = `pageProviders.${name}.${nxql.pattern ? 'pattern' : 'whereClause.fixedPart'}`;
    for (const problem of nxqlProblems(nxql.text, { pattern: nxql.pattern }))
      findings.push(
        `${join(directory, 'bundle', ...component.split('/'))}: ${place}: ${problem} [structure]`,
      );
  }
  return findings;
}

/** The content model in `file`, read; `null` when it cannot be, which the validator has said. */
function modelIn(file) {
  if (file === undefined || file === null) return null;
  try {
    return (
      readContentModel(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))).model ?? null
    );
  } catch {
    return null;
  }
}

/**
 * What each page provider the package defines names that `model`, the content model the validator
 * was given, does not have, as a finding in the validator's form: the component, the page provider
 * and the element, the property, the type or the facet, and why. Its NXQL (`nxqlNameProblems`),
 * and the properties its sorts, its aggregates and its predicates name (`propertyNameProblem`),
 * each held to the type the NXQL lists when it says. A misspelt property in a condition, such as the vehicle kit's
 * `vdocs:checklist/*\/don`, is a query the server refuses; a misspelt type or facet one that lists
 * nothing. None without a model.
 */
function unmodelledNames(directory, model) {
  const read = modelIn(model);
  if (read === null) return [];
  const findings = [];
  for (const [name, { component, nxql, listed, named }] of pageProvidersOf(directory)) {
    const file = join(directory, 'bundle', ...component.split('/'));
    if (nxql !== null)
      for (const problem of nxqlNameProblems(nxql.text, { pattern: nxql.pattern }, read))
        findings.push(
          `${file}: pageProviders.${name}.${nxql.pattern ? 'pattern' : 'whereClause.fixedPart'}: ${problem} [unknown]`,
        );
    for (const { place, xpath } of named) {
      const problem = propertyNameProblem(xpath, read, listed);
      if (problem !== null)
        findings.push(`${file}: pageProviders.${name}.${place}: ${problem} [unknown]`);
    }
  }
  return findings;
}

/**
 * Each queue, related list and home figure that gives a page provider of the package's own other
 * than as many parameters as its NXQL's `?` (`parameterFindings`), as a finding in the validator's
 * form. Needs no model: the count is the NXQL's.
 */
function unfilledParameters(directory, root) {
  const providers = new Map(
    [...pageProvidersOf(directory)].map(([name, { component, nxql }]) => [
      name,
      { component, parameters: nxql === null ? null : positionalParameters(nxql.text) },
    ]),
  );
  if (providers.size === 0) return [];
  const files = ['home.json'];
  for (const folder of ['queues', 'layouts']) {
    const at = join(root, folder);
    if (!existsSync(at) || !lstatSync(at).isDirectory()) continue;
    for (const path of filesUnder(at).filter((file) => file.endsWith('.json')))
      files.push(`${folder}/${path}`);
  }
  const findings = [];
  for (const file of files.sort()) {
    const path = join(root, ...file.split('/'));
    if (!existsSync(path)) continue;
    const content = definitionFile(path);
    if (content === null) continue;
    for (const finding of parameterFindings(file, content, providers))
      findings.push(`${path}: ${finding.path}: ${finding.message} [${finding.kind}]`);
  }
  return findings;
}

/**
 * Each column and sort of a queue, or of a layout's related list, on a page provider of the
 * package's own, that names a property the type it lists does not have, or a widget that does not
 * show its property, held to `model`, the content model the validator was given: as a finding in
 * the validator's form, the file, the place, why (`listedColumnFindings`). The type is the one the
 * page provider's NXQL lists, when it says plainly (`listedType`). None without a model, and none
 * for a page provider the package does not define, which is the server's.
 */
function unlistedColumns(directory, root, model) {
  if (model === undefined || model === null) return [];
  let read;
  try {
    read = readContentModel(JSON.parse(readFileSync(model, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    // The validator has read it already, and said what was wrong.
    return [];
  }
  if (!read.model) return [];
  const providers = new Map(
    [...pageProvidersOf(directory)].map(([name, { component, listed }]) => [
      name,
      { component, listed },
    ]),
  );
  if (providers.size === 0) return [];
  const findings = [];
  for (const folder of ['queues', 'layouts']) {
    const at = join(root, folder);
    if (!existsSync(at) || !lstatSync(at).isDirectory()) continue;
    for (const path of filesUnder(at)
      .filter((file) => file.endsWith('.json'))
      .sort()) {
      const file = `${folder}/${path}`;
      const content = definitionFile(join(root, ...file.split('/')));
      if (content === null) continue;
      for (const finding of listedColumnFindings(file, content, providers, read.model))
        findings.push(
          `${join(root, ...file.split('/'))}: ${finding.path}: ${finding.message} [${finding.kind}]`,
        );
    }
  }
  return findings;
}

/**
 * The first file under `bundle/agentic-ui-config/layouts/` that no enabled `<layout>` entry
 * contributes, said with the entry that would, or `null`. The server serves a layout only as a
 * component names it, so such a file would never be seen, though the validator passed it. A
 * Markdown file is not packaged (`build.mjs`), so it is not one. Step 1 has refused any symbolic
 * link, so the walk follows none.
 */
function uncontributedLayout(bundle, contributed, disabled, misplaced) {
  const layouts = join(bundle, 'agentic-ui-config', 'layouts');
  if (!existsSync(layouts) || !lstatSync(layouts).isDirectory()) return null;
  for (const path of filesUnder(layouts).sort()) {
    if (path.endsWith('.md')) continue;
    const src = `agentic-ui-config/layouts/${path}`;
    if (contributed.has(src)) continue;
    const shown = `bundle/${src}`;
    const place = /^([^/]+)\/([^/]+)\.layout\.json$/.exec(path);
    if (!place)
      return (
        `${shown} is not a layout any component can contribute: a layout is ` +
        'layouts/<Type>/<mode>.layout.json. Move it there and contribute it, or remove it, since ' +
        'the server would never serve it.'
      );
    const entry = `<layout type="${place[1]}" mode="${place[2]}" src="${src}" />`;
    const why = misplaced.has(src)
      ? `${misplaced.get(src)} names only outside an extension of org.nuxeo.agentic.ui.config's "configuration" point, where nothing registers it`
      : disabled.has(src)
        ? `${disabled.get(src)} names only in a disabled entry`
        : 'no component contributes';
    return (
      `${shown} is a layout ${why}, so the server would never serve it. Add ${entry} to the ` +
      'component\'s org.nuxeo.agentic.ui.config "configuration" extension, as the app-layout and ' +
      'app-form generators do, or remove the file.'
    );
  }
  return null;
}

/** Every file under `directory`, as a path relative to it with `/` between its parts. */
function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

/**
 * Whether installing the package could write into the server's own configuration, `nxserver/config/`,
 * where the allow-list of the operations an app's buttons may run is read from, and every other
 * `-config.xml` the server deploys in its own context: a problem, or `null`. Two ways a package
 * could, and both are refused, after the verifier has read the zip as well-formed:
 *
 * - **a deployment fragment,** `deployment-fragment.xml` anywhere in the bundle, which the server's
 *   preprocessor runs before it starts, and which may copy files and append to templates;
 * - **an `install.xml` that does more** than its one `<update>` of the bundle into `${env.bundles}`:
 *   another command, such as `<copy>` or `<config>`, or another `<update>`, may write anywhere,
 *   the configuration directory among them.
 *
 * So the allow-list cannot be widened by a package the pipeline built. One it did not build is not
 * checked by anything but the server's administrators, who install it.
 */
function configurationReach(directory) {
  const bundle = join(directory, 'bundle');
  const fragment = existsSync(bundle)
    ? filesUnder(bundle).find((path) => basename(path).toLowerCase() === 'deployment-fragment.xml')
    : undefined;
  if (fragment)
    return (
      `bundle/${fragment} is a deployment fragment, which the server runs before it starts and which ` +
      "may write into its own configuration, nxserver/config/, where the allow-list of an app's " +
      'buttons is read from. A configuration package has none.'
    );
  const installXml = join(directory, 'package', 'install.xml');
  if (!existsSync(installXml)) return null;
  const xml = withoutCommentsOrInstructions(
    readFileSync(installXml, 'utf8').replace(/^\uFEFF/, ''),
  );
  const elements = [...xml.matchAll(/<([A-Za-z_][\w.:-]*)/g)].map(([, name]) => name);
  const updates = [...xml.matchAll(new RegExp(`<update${TAG}`, 'g'))].map(([, tag]) =>
    attributesOf(tag),
  );
  const others = elements.filter((name) => name !== 'install' && name !== 'update');
  if (
    others.length > 0 ||
    updates.length !== 1 ||
    updates[0].file !== INSTALL_UPDATE.file ||
    updates[0].todir !== INSTALL_UPDATE.todir ||
    Object.keys(updates[0]).length !== 2
  )
    return (
      `package/install.xml does more than copy the bundle into the server's bundles` +
      (others.length > 0 ? `: it has <${others[0]}>` : '') +
      `. A configuration package's install.xml is <update file="${INSTALL_UPDATE.file}" ` +
      `todir="${INSTALL_UPDATE.todir}" /> alone, so that installing it writes nothing into the ` +
      "server's own configuration, nxserver/config/, where the allow-list of an app's buttons is read from."
    );
  return null;
}

/**
 * What is wrong with what the package contributes to the server's allow-list, or `null`: anything
 * at all. The allow-list is the deployment's, plan decision 3 on its recommendation: an app's
 * `actions.json` names an operation, and only a contribution the server's administrators install
 * allows it (nuxeo-agentic-core's README). A package that contributed to it would allow its own
 * buttons, and configuration could then widen the allow-list. Any extension whose target is the
 * component is refused, whatever its point, enabled or not: Nuxeo registers an extension by its
 * target, and a disabled entry still removes the deployment's. The target is compared as Nuxeo
 * reads a component's name: `service:org.nuxeo.agentic.ui.operations` is the same component, since a
 * name with no type is a service's (`ComponentName`). The server refuses such a contribution too,
 * from anywhere but its configuration directory (`OperationAllowListComponent`).
 *
 * The same holds for the host applications an embedded panel's token is exchanged for,
 * `org.nuxeo.agentic.embedded` (decision F): a package that registered one would let another system
 * sign the server's users in. The server refuses that from a bundle too (`EmbeddedPanelComponent`).
 *
 * Nor may a package contribute a chain whose id is the platform's, `AgenticUi.` and a name: a chain
 * and an operation share one registry, and a chain with the id of `AgenticUi.RunAction` or
 * `AgenticUi.RequireRunAction` would replace the endpoint, or the guard a button's chain begins
 * with. Called after `layoutContributions`, which has refused any component path that leaves
 * `bundle/`.
 */
function allowListContributions(directory) {
  const manifest = join(directory, 'bundle', 'META-INF', 'MANIFEST.MF');
  if (!existsSync(manifest)) return null;
  const text = readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '');
  for (const component of componentPathsOf(text)) {
    const file = componentFileOf(resolve(join(directory, 'bundle')), component);
    if (typeof file !== 'string' || file === '') continue;
    const xml = componentXmlOf(readFileSync(file, 'utf8'));
    // A chain's id and each of its aliases, and a scripted operation's, share one registry with the
    // operations, in which a later name replaces an earlier one (`OperationRegistry`).
    const names = [
      ...[...xml.matchAll(new RegExp(`<(?:chain|scriptedOperation)${TAG}`, 'g'))].map(
        ([, tag]) => attributesOf(tag).id ?? '',
      ),
      ...[...xml.matchAll(/<alias(?:\s[^>]*)?>([\s\S]*?)<\/alias\s*>/g)].map(([, alias]) =>
        withoutCdata(alias),
      ),
    ].map((name) => name.trim());
    const taken = names.find((name) => name.startsWith('AgenticUi.'));
    if (taken)
      return (
        `${component} names a chain or a scripted operation ${taken}, an id of the platform's own ` +
        "operations: under that name or alias it would replace the operation that runs an app's " +
        'buttons, or the guard their chains begin with. Name it after the package.'
      );
    for (const extension of xml.matchAll(new RegExp(`<extension${TAG}`, 'g'))) {
      const { target, point } = attributesOf(extension[1]);
      // As Nuxeo reads a component's name: a name with no type is a service's.
      const name = target?.trim().replace(/^service:/, '');
      if (name === ALLOW_LIST_COMPONENT)
        return (
          `${component} contributes to ${ALLOW_LIST_COMPONENT}${point ? `'s "${point}" point` : ''}, the ` +
          "server's allow-list of the operations an app's buttons may run. The allow-list is the " +
          "deployment's, never a package's: name the operation in actions.json, and give the server's " +
          "administrators the contribution that allows it, as the Payers kit's README does."
        );
      if (name === EMBEDDED_HOSTS_COMPONENT)
        return (
          `${component} contributes to ${EMBEDDED_HOSTS_COMPONENT}${point ? `'s "${point}" point` : ''}, ` +
          "the host applications that may exchange a token for the server's users. They are the " +
          "deployment's, never a package's: give the server's administrators the contribution, for " +
          'nxserver/config/, as nuxeo-agentic-embedded/README.md describes. The server refuses one from ' +
          'a bundle too.'
        );
    }
  }
  return null;
}

/**
 * What is wrong with the app the package contributes to the app registry, or `null`. The server
 * serves an app only as a component's `<app>` names it: its `app.json`, from `src`, and each file a
 * `<file path>` names, below the directory that holds it. So the package contributes its app once,
 * from `agentic-ui-config/app.json`, which the validator read, under the id that file gives, and
 * names exactly the files of the app definition the registry serves. A file it holds and does not
 * name would never be served; one it names and does not hold would be missing on the server. A
 * disabled entry contributes nothing and is skipped. A package that contributes no app is said and
 * built, for now: the Builder kit's generators write the contribution (`app-package` and
 * `app-registry`), and refusing one without it is the user's to decide. Called after
 * `layoutContributions`, which has refused any component path that leaves `bundle/`.
 */
function appContributions(directory, root) {
  const bundle = join(directory, 'bundle');
  const manifest = join(bundle, 'META-INF', 'MANIFEST.MF');
  if (!existsSync(manifest)) return null;
  const text = readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '');
  const apps = [];
  for (const component of componentPathsOf(text)) {
    const file = componentFileOf(resolve(bundle), component);
    if (typeof file !== 'string' || file === '') continue;
    const xml = componentXmlOf(readFileSync(file, 'utf8'));
    const configuration = configurationExtensions(xml);
    for (const match of xml.matchAll(new RegExp(`<app${TAG}`, 'g'))) {
      const attributes = attributesOf(match[1]);
      if (attributes.enabled !== undefined && attributes.enabled.toLowerCase() !== 'true') continue;
      if (!configuration.some(([from, to]) => match.index > from && match.index < to))
        return (
          `${component} contributes the app ${attributes.id ?? ''} outside an extension of ` +
          'org.nuxeo.agentic.ui.config\'s "configuration" point, where nothing registers it.'
        );
      const start = match.index + match[0].length;
      const end = match[1].trimEnd().endsWith('/') ? start : xml.indexOf('</app', start);
      const body = xml.slice(start, end === -1 ? xml.length : end);
      const files = [...body.matchAll(new RegExp(`<file${TAG}`, 'g'))].map(
        ([, tag]) => attributesOf(tag).path ?? '',
      );
      apps.push({ component, ...attributes, files });
    }
  }
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8').replace(/^\uFEFF/, ''));
  const element = `<app id="${app.id}" src="agentic-ui-config/app.json">`;
  if (apps.length === 0) {
    // Said, not refused, for now: a package written before the generators wrote the contribution
    // must still build until the user decides to refuse it.
    process.stdout.write(
      `note: no component contributes the app, so the app registry will not serve it on a server. ` +
        `Add ${element} to the component, with a <file path="..."> for each file of the app definition: ` +
        `the app-registry generator writes it.\n`,
    );
    return null;
  }
  if (apps.length > 1)
    return `${apps.map((each) => each.component).join(', ')} contribute ${apps.length} apps; a package is one app.`;
  const [{ component, id, src, files }] = apps;
  if (id !== app.id)
    return `${component} contributes the app "${id ?? ''}", and app.json's id is "${app.id}". Contribute it as ${element}.`;
  // As the server reads it, unnormalised: `./agentic-ui-config/app.json` is a `src` it refuses.
  if (src !== 'agentic-ui-config/app.json')
    return `${component} contributes the app ${id} from ${src ?? 'no src'}. Contribute it from agentic-ui-config/app.json, which the validator read.`;
  const held = new Set(
    filesUnder(root).filter((path) => REGISTRY_FILES.some((place) => place.test(path))),
  );
  if (files.length > MAX_APP_FILES)
    return `${component} names ${files.length} files of the app ${id}; the app registry serves at most ${MAX_APP_FILES} (ContributionRegistry.MAX_APP_FILES).`;
  const named = new Set();
  for (const path of files) {
    if (!REGISTRY_FILES.some((place) => place.test(path)))
      return `${component} names the file "${path}" of the app ${id}, which is not a file the app registry serves: home.json, navigation.json, actions.json, queues/<id>.json, labels/<language>.json or tasks/<workflow>.<step>.layout.json.`;
    if (named.has(path)) return `${component} names the file ${path} of the app ${id} twice.`;
    if (!held.has(path))
      return `${component} names the file ${path} of the app ${id}, and bundle/agentic-ui-config/ has no such file.`;
    named.add(path);
  }
  const unnamed = [...held].filter((path) => !named.has(path)).sort();
  if (unnamed.length > 0)
    return (
      `${component} does not name ${unnamed.join(', ')} in the app ${id}, so the app registry would ` +
      `not serve ${unnamed.length === 1 ? 'it' : 'them'}. Add a <file path="..."> for each, as the ` +
      'app-registry generator does.'
    );
  return null;
}
