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
 *
 * First it removes the zip, checksum and changelog an earlier run left for the package's name and version, so
 * that a refused package leaves nothing installable behind; a package.xml that is a symbolic link is
 * not read for them. Then, in order, each step stopping the run when it fails:
 *   1. nothing in the package is a symbolic link, so no step reads a file from elsewhere, and the
 *      package's `build.mjs` is the generator's, byte for byte, so the code that builds it is
 *      code this repository reviewed; and a `package/install.xml` there is a file, not a folder,
 *      since no step before the builder reads it;
 *   2. `bundle/agentic-ui-config/` is an app definition: it has an `app.json`, and the validator of
 *      `libs/shared/app-definition` finds nothing in it, given the deployment's allow-list, what
 *      it registers, its platform version, the platform's English catalogue, which with the
 *      package's labels must give every label key a text, and a content model: the one given, or,
 *      for a package that ships a stand-in model, its own `content-model.json`. A queue's facet and
 *      a home's figure name an aggregate their page provider defines, when the package's own
 *      model defines it. The layouts the component contributes are the files the validator read, in the modes it
 *      read them in: none inline, none from elsewhere; and every file under `layouts/` is
 *      contributed, since the server would never serve one that is not. The package contributes
 *      its app to the app registry once, from its `app.json`, naming every file of the app
 *      definition the registry serves and nothing else. No component contributes to the server's
 *      allow-list of the operations an app's buttons may run, `org.nuxeo.agentic.ui.operations`,
 *      which is the deployment's, never a package's. A manifest that is not a file, and a
 *      component path that leaves
 *      `bundle/` or names a folder or a hard link, are refused before they are read (a missing one
 *      is the builder's to refuse, at step 4);
 *   3. `app.json`'s `packageVersion` and the manifest's `Bundle-Version` are `package.xml`'s
 *      version, and a tag, when given, is
 *      `app-package/<name>/<version>` for this package; given the package as it was before,
 *      `--previous`, the version moved as far as what changed needs (the validator's `changes`,
 *      `libs/shared/app-definition/src/lib/changes.ts`), and the package's name did not change;
 *   4. `build.mjs` writes the zip, refusing what the server would;
 *   5. `verify-package-zip.mjs` finds a well-formed Nuxeo Package;
 *   6. the zip's SHA-256 goes beside it, as `<zip>.sha256`, in the form `sha256sum -c` reads, and,
 *      given `--previous`, what changed since, as `<name>-<version>.changes.md`.
 *
 * Node 24 and the system's `unzip`, which reads the zip back at step 5, run all of it: no install
 * and no credential, so that a package's checks need nothing a customer's repository does not have.
 * The content model is the one input that may need a server, and it is opt in: `--model` names a
 * file `app-package-model.mjs` exported, and `--model-server` reads the model live, with
 * `NUXEO_USER` and `NUXEO_PASS` from the environment. Given neither, a package that ships a
 * stand-in model, a component of its own registering document types, is held to the
 * `content-model.json` beside its `bundle/`, which `app-model` writes to describe it; a package on
 * a server's model is held to none.
 * The XML is read by `verify-package-zip.mjs`'s own helpers, the builder's grammar ported, so that
 * the three cannot disagree about what a descriptor says.
 *
 * It runs unconditionally. A "was I started directly?" guard is how another gate here once exited
 * 0 having checked nothing, so its controls (`app-package.selftest.mjs`) run it as CI does: as a
 * command.
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_PRECONDITION,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from './beta-harness/nuxeo-credentials.mjs';
import { readServerModel, serverBase, withoutCredentials } from './nuxeo-content-model.mjs';
import {
  attribute,
  attributesOf,
  componentPathsOf,
  componentXmlOf,
  TAG,
  verifyPackageZip,
  withoutCdata,
  withoutCommentsOrInstructions,
} from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(
  REPO,
  'tools',
  'satori-generators',
  'src',
  'config-package',
  'files',
  'build.mjs__tmpl__',
);
const VALIDATOR = join(REPO, 'libs', 'shared', 'app-definition', 'src', 'bin.mjs');
/** The platform's English catalogue, which a package's label keys may name besides its own. */
const CATALOGUE = join(REPO, 'apps', 'nuxeo-ui', 'public', 'i18n', 'en.json');
/** The file `app-model` writes beside `bundle/`: the package's stand-in model, described. */
const OWN_MODEL = 'content-model.json';
const USAGE =
  'usage: node scripts/app-package.mjs <package directory> [--out <directory>] [--tag <tag>]' +
  ' [--allow-list <file>] [--registered <file>] [--platform <version>]' +
  ' [--model <file> | --model-server <address>] [--previous <package directory>]';
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
];

function parse(argv) {
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
  return paths.length === 1 ? { directory: paths[0], ...options } : null;
}

const options = parse(process.argv.slice(2));
if (!options || !existsSync(options.directory)) {
  console.error(options ? `${options.directory} does not exist.\n${USAGE}` : USAGE);
  process.exit(2);
}
process.exit(await withModel(options));

/**
 * `run`, with the server's content model read first when `--model-server` names it, into a file
 * the validator reads as it reads `--model`'s, and which is removed afterwards. A model that cannot
 * be read stops the run with exit 2, as a wrong `--model` file does, once an earlier run's zip is
 * removed: the package is neither refused nor built on a model nobody saw.
 */
async function withModel(options) {
  if (options['model-server'] === undefined) return run(options);
  const read = await serverModel(options['model-server']);
  if (typeof read === 'string') return run({ ...options, unread: read });
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-model-'));
  try {
    const file = join(scratch, 'content-model.json');
    writeFileSync(file, JSON.stringify(read.model));
    process.stdout.write(`The content model was read from ${read.base}.\n`);
    return run({ ...options, model: file });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The content model `server` answers, with `NUXEO_USER` and `NUXEO_PASS`, or why it was not read. */
async function serverModel(server) {
  const where = serverBase(server);
  if (where.problem) return `--model-server: ${where.problem}\n${USAGE}`;
  const credentials = readNuxeoCredentials();
  if (!credentials)
    return missingNuxeoCredentialsMessage(`read the content model of ${where.base}`);
  try {
    return { base: where.base, model: await readServerModel(where.base, credentials) };
  } catch (error) {
    return `The content model of ${where.base} was not read: ${error.message}`;
  }
}

function run({
  directory,
  out,
  tag,
  'allow-list': allowList,
  registered,
  platform,
  model,
  unread,
  previous,
}) {
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
  if (!existsSync(builder) || !readFileSync(builder).equals(readFileSync(TEMPLATE)))
    return refuse(
      1,
      `build.mjs is not the generator's, byte for byte. Copy ${relative(REPO, TEMPLATE)} over it,` +
        ' so that what builds the package is code this repository reviewed.',
    );
  // No other step before the builder reads install.xml, so without this a folder there would be
  // refused only at step 4.
  const installXml = join(directory, 'package', 'install.xml');
  if (existsSync(installXml) && !lstatSync(installXml).isFile())
    return refuse(
      1,
      'package/install.xml is not a file. Put the file itself there: it is what installs the bundle.',
    );

  // 2. The app definition, as the validator reads it.
  const root = join(directory, 'bundle', 'agentic-ui-config');
  const appFile = join(root, 'app.json');
  if (!existsSync(appFile))
    return refuse(2, 'bundle/agentic-ui-config/ has no app.json, which an app definition needs.');
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
    const read = spawnSync(process.execPath, [VALIDATOR, 'model', own], {
      encoding: 'utf8',
      env: withoutCredentials(process.env),
      maxBuffer: OUTPUT_LIMIT,
    });
    if (read.status !== 0) {
      process.stderr.write(read.stdout ?? '');
      process.stderr.write(read.stderr ?? '');
      return refuse(
        2,
        `the package's own ${OWN_MODEL}, which describes its stand-in model, cannot be read as a content model, as above. Write it again with app-model, or mend it.`,
      );
    }
  }
  const flags = [
    ...(allowList ? ['--allow-list', allowList] : []),
    ...(registered ? ['--registered', registered] : []),
    ...(platform ? ['--platform', platform] : []),
    ...(heldTo ? ['--model', heldTo] : []),
    '--catalogue',
    CATALOGUE,
  ];
  const validation = spawnSync(process.execPath, [VALIDATOR, 'validate', root, ...flags], {
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: OUTPUT_LIMIT,
  });
  process.stdout.write(validation.stdout ?? '');
  process.stderr.write(validation.stderr ?? '');
  if (validation.status === 2) return 2;
  if (validation.status !== 0) return refuse(2, 'the app definition has findings, listed above.');
  const unanswered = unansweredAggregates(directory, root);
  if (unanswered.length > 0) {
    for (const finding of unanswered) process.stdout.write(`${finding}\n`);
    return refuse(
      2,
      'a facet or a figure names an aggregate its page provider does not define, listed above.',
    );
  }
  const contributed =
    layoutContributions(directory) ??
    allowListContributions(directory) ??
    appContributions(directory, root);
  if (contributed) return refuse(2, contributed);

  // 3. One version, written in three places, `package.xml` read as the builder reads it.
  if (unreadable !== null) return refuse(3, `package/package.xml cannot be read (${unreadable}).`);
  if (descriptor === null) return refuse(3, 'package/package.xml is missing.');
  if (!name || !version)
    return refuse(3, 'package/package.xml has no <package name="..." version="...">.');
  const app = JSON.parse(readFileSync(appFile, 'utf8').replace(/^\uFEFF/, ''));
  if (app.packageVersion !== version)
    return refuse(
      3,
      `app.json's packageVersion is ${app.packageVersion}, and package.xml's version is ${version}.` +
        ' They are one version: raise both together.',
    );
  // The third place: the manifest's Bundle-Version, its lines unfolded as the builder unfolds
  // them. A manifest that names no Bundle-Version has nothing to disagree with.
  const manifestFile = join(directory, 'bundle', 'META-INF', 'MANIFEST.MF');
  if (existsSync(manifestFile)) {
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
  if (previous !== undefined) {
    const compared = sinceThePrevious(previous, directory, name);
    if (typeof compared === 'number') return compared;
    if (compared.refused !== null) {
      for (const change of compared.changes) console.error(`  - ${change.level}: ${change.what}`);
      return refuse(3, compared.refused);
    }
    changelog = compared.changelog;
    // The changelog's first sentence: how many changes, what they need, what was raised.
    process.stdout.write(`${compared.changelog.split('\n')[0]}\n`);
  }

  // 4. The zip, from version 1's builder, which checks the component XML the way the server does.
  const build = spawnSync(process.execPath, [builder, '--out', output], {
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    maxBuffer: OUTPUT_LIMIT,
  });
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
function sinceThePrevious(previous, directory, name) {
  if (!existsSync(previous) || !lstatSync(previous).isDirectory()) {
    console.error(`--previous ${previous} is not a folder.\n${USAGE}`);
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
      `--previous ${previous} has no package/package.xml naming its package (a link is not followed).\n${USAGE}`,
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
  const compared = spawnSync(
    process.execPath,
    [VALIDATOR, 'changes', resolve(previous), resolve(directory)],
    { encoding: 'utf8', env: withoutCredentials(process.env), maxBuffer: OUTPUT_LIMIT },
  );
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
      components.push({ component, xml: componentXmlOf(readFileSync(file, 'utf8')) });
    } catch {
      // Unreadable: layoutContributions says so.
    }
  }
  return components;
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
 * the repository (`coreQueryPageProvider`) or is generic, such as the search index's, and the ids of
 * the aggregates it defines. A disabled definition takes the page provider away, as the server
 * does; of two definitions, the later the manifest loads is the one the server keeps.
 */
function pageProvidersOf(directory) {
  const providers = new Map();
  for (const { component, xml } of componentsOf(directory)) {
    for (const [from, to] of extensionsOf(
      xml,
      'org.nuxeo.ecm.platform.query.api.PageProviderService',
      'providers',
    )) {
      const extension = xml.slice(from, to);
      for (const match of extension.matchAll(
        new RegExp(`<(coreQueryPageProvider|genericPageProvider)${TAG}`, 'g'),
      )) {
        const [tag, element, inside] = match;
        const { name, enabled } = attributesOf(inside);
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
        const aggregates = [...definition.matchAll(new RegExp(`<aggregate${TAG}`, 'g'))]
          .map(([, attributes]) => attributesOf(attributes).id)
          .filter((id) => id !== undefined && id !== '');
        providers.set(name, {
          component,
          repository: element === 'coreQueryPageProvider',
          aggregates: new Set(aggregates),
        });
      }
    }
  }
  return providers;
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
