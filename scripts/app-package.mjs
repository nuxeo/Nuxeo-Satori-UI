#!/usr/bin/env node
/**
 * The package pipeline's first stage, for one app definition package
 * (docs/business-apps/package-pipeline.md): check it, build it, verify the zip, and write its
 * checksum. Signing and publishing are the workflow's (`.github/workflows/app-packages.yml`), which
 * runs them on the zip this writes and never on the package's own code.
 *
 *   node scripts/app-package.mjs <package directory> [--out <directory>] [--tag <tag>]
 *     [--allow-list <file>] [--registered <file>] [--platform <version>]
 *
 * First it removes the zip and checksum an earlier run left for the package's name and version, so
 * that a refused package leaves nothing installable behind. Then, in order, each step stopping the
 * run when it fails:
 *   1. the package's `build.mjs` is the generator's, byte for byte, so the code that builds it is
 *      code this repository reviewed;
 *   2. `bundle/agentic-ui-config/` is an app definition: it has an `app.json`, and the validator of
 *      `libs/shared/app-definition` finds nothing in it, given the deployment's allow-list, what
 *      it registers and its platform version. The layouts the component contributes are the files
 *      the validator read, in the modes it read them in: none inline, none from elsewhere;
 *   3. `app.json`'s `packageVersion` is `package.xml`'s version, and a tag, when given, is
 *      `app-package/<name>/<version>` for this package;
 *   4. `build.mjs` writes the zip, refusing what the server would;
 *   5. `verify-package-zip.mjs` finds a well-formed Nuxeo Package;
 *   6. the zip's SHA-256 goes beside it, as `<zip>.sha256`, in the form `sha256sum -c` reads.
 *
 * Node 24 and the system's `unzip`, which reads the zip back at step 5, run all of it: no install
 * and no credential, so that a package's checks need nothing a customer's repository does not have.
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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const USAGE =
  'usage: node scripts/app-package.mjs <package directory> [--out <directory>] [--tag <tag>]' +
  ' [--allow-list <file>] [--registered <file>] [--platform <version>]';
// `spawnSync` truncates a child's output in silence past its limit, 1 MiB by default.
const OUTPUT_LIMIT = 64 * 1024 * 1024;
/** `build.mjs`'s rule for a package name or version: a single file name, nothing above it. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const VALUED = ['--out', '--tag', '--allow-list', '--registered', '--platform'];

function parse(argv) {
  const options = {};
  const paths = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (VALUED.includes(arg) && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--'))
      options[arg.slice(2)] = argv[++index];
    else if (arg.startsWith('--')) return null;
    else paths.push(arg);
  }
  return paths.length === 1 ? { directory: paths[0], ...options } : null;
}

const options = parse(process.argv.slice(2));
if (!options || !existsSync(options.directory)) {
  console.error(options ? `${options.directory} does not exist.\n${USAGE}` : USAGE);
  process.exit(2);
}
process.exit(run(options));

function run({ directory, out, tag, 'allow-list': allowList, registered, platform }) {
  const near = relative(process.cwd(), resolve(directory));
  const shown = near === '' ? '.' : near.startsWith('..') ? resolve(directory) : near;
  const refuse = (step, message) => {
    console.error(`${shown}: step ${step} refused it: ${message}`);
    return 1;
  };

  // What an earlier run left for this package's name and version goes first, so that a run that
  // refuses the package leaves no installable zip behind, this run's or an older one's. The name
  // and version are the package's own, so they name a file only once they are single file names,
  // as the builder requires: a name such as `../x` must not reach outside the output directory.
  const descriptorFile = join(directory, 'package', 'package.xml');
  const descriptor = existsSync(descriptorFile)
    ? withoutCdata(withoutCommentsOrInstructions(readFileSync(descriptorFile, 'utf8')))
    : null;
  const name = descriptor === null ? null : attribute(descriptor, 'package', 'name');
  const version = descriptor === null ? null : attribute(descriptor, 'package', 'version');
  const output = resolve(out ?? join(directory, 'dist'));
  if (FILE_NAME.test(name ?? '') && FILE_NAME.test(version ?? '')) {
    const previous = join(output, `${name}-${version}.zip`);
    for (const left of [previous, `${previous}.sha256`]) rmSync(left, { force: true });
  }

  // 1. The builder is the reviewed one.
  const builder = join(directory, 'build.mjs');
  if (!existsSync(builder) || !readFileSync(builder).equals(readFileSync(TEMPLATE)))
    return refuse(
      1,
      `build.mjs is not the generator's, byte for byte. Copy ${relative(REPO, TEMPLATE)} over it,` +
        ' so that what builds the package is code this repository reviewed.',
    );

  // 2. The app definition, as the validator reads it.
  const root = join(directory, 'bundle', 'agentic-ui-config');
  const appFile = join(root, 'app.json');
  if (!existsSync(appFile))
    return refuse(2, 'bundle/agentic-ui-config/ has no app.json, which an app definition needs.');
  const flags = [
    ...(allowList ? ['--allow-list', allowList] : []),
    ...(registered ? ['--registered', registered] : []),
    ...(platform ? ['--platform', platform] : []),
  ];
  const validation = spawnSync(process.execPath, [VALIDATOR, 'validate', root, ...flags], {
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
  });
  process.stdout.write(validation.stdout ?? '');
  process.stderr.write(validation.stderr ?? '');
  if (validation.status === 2) return 2;
  if (validation.status !== 0) return refuse(2, 'the app definition has findings, listed above.');
  const contributed = layoutContributions(directory);
  if (contributed) return refuse(2, contributed);

  // 3. One version, written in three places, `package.xml` read as the builder reads it.
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
  if (tag !== undefined && tag !== `app-package/${name}/${version}`)
    return refuse(
      3,
      `the tag ${tag} is not app-package/${name}/${version}, this package as it is.`,
    );

  // 4. The zip, from version 1's builder, which checks the component XML the way the server does.
  const build = spawnSync(process.execPath, [builder, '--out', output], {
    encoding: 'utf8',
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

  // 6. Its checksum, which the publishing job checks before it signs anything.
  const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
  writeFileSync(`${zip}.sha256`, `${digest}  ${basename(zip)}\n`);
  const where = relative(process.cwd(), zip);
  process.stdout.write(
    `${name} ${version}: checked, built and verified: ${where.startsWith('..') ? zip : where}, sha256 ${digest}\n`,
  );
  return 0;
}

/**
 * What is wrong with the layouts the package's components contribute, or `null`. The validator read
 * the files at `layouts/<Type>/<mode>.layout.json`, each in the mode its path names; the server
 * serves what the component says. So a layout written inline, or contributed from another file or
 * in another mode, is one this stage did not check, and is refused rather than passed. A disabled
 * entry contributes nothing and is skipped, as the builder skips it.
 */
function layoutContributions(directory) {
  const bundle = join(directory, 'bundle');
  const manifest = join(bundle, 'META-INF', 'MANIFEST.MF');
  // A bundle with no manifest, or a component it cannot find, is the builder's to refuse.
  if (!existsSync(manifest)) return null;
  // The components this stage checks must be the ones the server loads, so they are found as
  // build.mjs finds them: its TextDecoder drops a byte-order mark, and componentPathsOf reads the
  // rest as the server's manifest reader does. Every header's components are checked, a superset
  // of what the server loads; a manifest with more than one header, or the header spelt another
  // way, is the builder's to refuse, at step 4.
  const text = readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '');
  for (const component of componentPathsOf(text)) {
    const file = join(bundle, component);
    if (!existsSync(file)) continue;
    const xml = componentXmlOf(readFileSync(file, 'utf8'));
    for (const [, tag] of xml.matchAll(new RegExp(`<layout${TAG}`, 'g'))) {
      const { type, mode, src, enabled } = attributesOf(tag);
      if (enabled !== undefined && enabled.toLowerCase() !== 'true') continue;
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
    }
  }
  return null;
}
