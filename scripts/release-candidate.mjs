#!/usr/bin/env node
/**
 * A release candidate across all kits, assembled offline: no Nuxeo server, no credential, no
 * signature, no tag and no publishing (docs/business-apps/package-pipeline.md, section 11; the
 * development plan's phase 10, "a release candidate across all kits").
 *
 *   node scripts/release-candidate.mjs --out <new directory> --since <git ref> [--version <version>]
 *
 * In order, each stage stopping the run when it refuses:
 *
 *   1. The command. `--out` names nothing yet, and is not under `business-apps/packages/`, where it
 *      would be read as a kit: a candidate never overwrites an earlier one. `--since`, the last
 *      release, is a commit. Maven and `unzip` are there.
 *   2. Every kit under `business-apps/packages/`, through the pipeline (`app-package.mjs`, steps 1
 *      to 6), with the candidate's platform version, `libs/platform`'s, so a kit whose platform range
 *      leaves it out is refused at the pipeline's step 2; and held with `--previous` to the kit as it
 *      was at `--since`, so a version that did not move as far as its changes need is refused at
 *      step 3. A kit `--since` does not have is new, and held to nothing.
 *   3. The kits as a set, read from the zips the pipeline wrote: no two contribute the same package
 *      name, app id, address, queue, action, component, document type, facet, schema, lifecycle,
 *      page provider, automation chain or operation, directory, workflow, layout, or the other
 *      names `release-candidate-set.mjs` lists. An extension point it does not know is listed as
 *      not compared, never passed in silence.
 *   4. The client app's production bundle, as the Maven module `apps/nuxeo-ui` and
 *      `build-marketplace.yml` build it, `nx build nuxeo-ui --configuration=production
 *      --base-href=/nuxeo/agentic-ui/`, with Node 24 and without Nx's cache.
 *   5. The server packages: `mvn package` at the root, tests included, every module but
 *      `apps/nuxeo-ui`, whose own build stage 4 is. It runs in a scratch copy of the working tree,
 *      every file git does not ignore, whose version is set to the candidate's as
 *      `build-marketplace.yml` sets it: `versions:set`, and `@VERSION@` in a package's
 *      `package.xml`. So the repository's poms are never edited. The `nuxeo-agentic-ui` package
 *      must carry the bundle stage 4 built, file for file and byte for byte: its assembly skips a
 *      missing bundle without a word.
 *   6. The packages as a set: each one's dependencies are in the candidate at a version Nuxeo counts
 *      as meeting them, no two conflict, and each one's target platform is one its dependencies
 *      install on (`release-candidate-set.mjs`, Nuxeo's rules, ported).
 *   7. The beta harness's demo steps a server run would execute, with the users and seeds each needs,
 *      listed without running any (`release-candidate-demo.mjs`).
 *   8. Written into `--out`: the artifacts, `manifest.json` with each one's version and SHA-256,
 *      `SHA256SUMS` in the form `sha256sum -c` reads, `RELEASE-NOTES.md` with what changed in each
 *      kit since `--since`, and `DEMO-STEPS.md`.
 *
 * The candidate's version is the root pom's without `-SNAPSHOT`, or `--version`. Nuxeo counts
 * neither a snapshot nor an `rc` classifier as meeting a dependency on the release
 * (`release-candidate-set.mjs`), so a candidate built at `2026.0.2-SNAPSHOT` or `2026.0.2-rc.1`
 * could not install a kit that depends on `nuxeo-agentic-ui:2026.0.2`: a release candidate carries
 * the version it would be released as. The working tree is built as it is, and the manifest names
 * the commit and every uncommitted path, so a candidate built from changes nobody committed says so.
 *
 * It runs unconditionally, as `app-package.mjs` does: a "was I started directly?" guard is how
 * another gate here once exited 0 having checked nothing. `release-candidate.selftest.mjs` runs it
 * as a command.
 *
 * macOS and Linux; it has not been run on Windows, where Maven is a `.cmd` that Node does not start
 * without a shell.
 *
 * Exit codes: 0, a candidate written; 1, refused, with `--out` removed, since it was this run's;
 * 2, the command was wrong, and nothing was written.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnToolSync } from './beta-harness/package-command.mjs';
import { withoutCredentials } from './nuxeo-content-model.mjs';
import { demoSteps, demoStepsMarkdown } from './release-candidate-demo.mjs';
import {
  descriptorOf,
  duplicatesAcross,
  readKit,
  setProblems,
  unpack,
} from './release-candidate-set.mjs';
import { withoutCommentsOrInstructions } from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(REPO, 'business-apps', 'packages');
const APP_PACKAGE = join(REPO, 'scripts', 'app-package.mjs');
const STEPS = join(REPO, 'scripts', 'beta-harness', 'steps');
/** The Maven module that builds the client with its own Node: stage 4 builds it instead. */
const CLIENT_MODULE = 'apps/nuxeo-ui';
/** Where the `nuxeo-agentic-ui` package deploys the bundle, and what its assembly leaves out. */
const DEPLOYED_BUNDLE = ['web', 'nuxeo.war', 'agentic-ui'];
const NOT_PACKAGED = 'agentic-ui-config';
const USAGE =
  'usage: node scripts/release-candidate.mjs --out <new directory> --since <git ref> [--version <version>]';
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const VALUED = ['--out', '--since', '--version'];
/** A version Maven and a file name both take: digits, then a classifier. */
const VERSION = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** A refusal: the stage, and why. Thrown, so that the output directory is removed once. */
class Refused extends Error {}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    // An empty value is refused, not taken as no option: `--since "$BASE"` unset would otherwise
    // hold no kit to anything.
    if (
      VALUED.includes(arg) &&
      argv[index + 1] !== undefined &&
      argv[index + 1] !== '' &&
      !argv[index + 1].startsWith('--') &&
      options[arg.slice(2)] === undefined
    )
      options[arg.slice(2)] = argv[++index];
    else return null;
  }
  return options.out !== undefined && options.since !== undefined ? options : null;
}

/** A command's result, with its output as text. */
function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
    env: withoutCredentials(process.env),
    ...options,
  });
}

/** `git`'s answer, or `null` when it refused. */
function git(args) {
  const result = run('git', args);
  return result.status === 0 ? result.stdout : null;
}

/** A path from the repository's root, with `/` between its parts, for the log and the manifest. */
const fromRepo = (path) => {
  const near = relative(REPO, path);
  return near.startsWith('..') ? path : near.split(sep).join('/');
};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A path inside `--out`, from it, with `/` between its parts. Hoisted: the stages below use it. */
function fromOut(path) {
  return relative(out, path).split(sep).join('/');
}

/** Every file under `directory`, as paths relative to it with `/` between their parts, sorted. */
function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

/** Prints a stage's heading. */
const stage = (number, text) => process.stdout.write(`\n== ${number}. ${text}\n`);

// ── 1. The command ────────────────────────────────────────────────────────────────────────────
const options = parse(process.argv.slice(2));
if (!options) {
  console.error(USAGE);
  process.exit(2);
}
const out = resolve(options.out);
if (lstatSync(out, { throwIfNoEntry: false })) {
  console.error(
    `${options.out} exists. A release candidate never overwrites an earlier one, nor writes into a ` +
      `folder it did not make: give --out a new directory.\n${USAGE}`,
  );
  process.exit(2);
}
if (out === PACKAGES || out.startsWith(PACKAGES + sep)) {
  console.error(
    `${options.out} is under business-apps/packages/, where every folder is read as a kit. Put the candidate elsewhere.\n${USAGE}`,
  );
  process.exit(2);
}
const sinceCommit = git([
  'rev-parse',
  '--verify',
  '--quiet',
  '--end-of-options',
  `${options.since}^{commit}`,
])?.trim();
if (!sinceCommit) {
  console.error(`--since ${options.since} is not a commit this clone has.\n${USAGE}`);
  process.exit(2);
}
for (const [tool, args, why] of [
  ['unzip', ['-v'], 'the pipeline reads each zip back with it'],
  ['mvn', ['-v'], 'the server packages are built with it'],
]) {
  if (run(tool, args).status !== 0) {
    console.error(`${tool} is not on the PATH, and ${why}.`);
    process.exit(2);
  }
}
const rootPom = withoutCommentsOrInstructions(readFileSync(join(REPO, 'pom.xml'), 'utf8'));
const pomVersion = /<version>\s*([^<\s]+)\s*<\/version>/.exec(
  rootPom.replace(
    /<(parent|dependencyManagement|dependencies|build|properties|repositories|pluginRepositories|profiles)>[\s\S]*?<\/\1>/g,
    '',
  ),
)?.[1];
const version = options.version ?? pomVersion?.replace(/-SNAPSHOT$/, '');
if (!version || !VERSION.test(version)) {
  console.error(
    `${options.version === undefined ? `The root pom's version, ${pomVersion},` : `--version ${options.version}`} is not a version a release candidate can carry.\n${USAGE}`,
  );
  process.exit(2);
}
const modules = [
  ...(/<modules>([\s\S]*?)<\/modules>/.exec(rootPom)?.[1] ?? '').matchAll(
    /<module>\s*([^<\s]+)\s*<\/module>/g,
  ),
].map(([, module]) => module);
const platform = JSON.parse(readFileSync(join(REPO, 'libs', 'platform', 'package.json'), 'utf8'));
const head = git(['rev-parse', 'HEAD'])?.trim() ?? null;
const uncommitted = (git(['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? '')
  .split('\0')
  .filter(Boolean)
  .map((line) => line.slice(3));

try {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
} catch (error) {
  console.error(`${options.out} could not be made (${error.code ?? error.message}).\n${USAGE}`);
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'release-candidate-'));
let code = 0;
try {
  await build();
} catch (error) {
  // A refusal says why; anything else is this script's own failure, and says where. Either way
  // what was written is no candidate, and the folder was this run's.
  console.error(
    error instanceof Refused
      ? `\nThe release candidate is refused: ${error.message}`
      : `\nThe release candidate was not assembled: ${error.stack ?? error}`,
  );
  rmSync(out, { recursive: true, force: true });
  console.error(`${options.out} is removed: it was this run's, and holds no candidate.`);
  code = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);

async function build() {
  process.stdout.write(
    `Release candidate ${version}, from ${head?.slice(0, 12) ?? 'no commit'}` +
      `${uncommitted.length > 0 ? ` with ${uncommitted.length} uncommitted path(s)` : ''}, ` +
      `held to ${options.since} (${sinceCommit.slice(0, 12)}), on @nuxeo/satori-platform ${platform.version}.\n`,
  );
  if (uncommitted.length > 0)
    process.stdout.write(
      `Built as the working tree is, not as ${head?.slice(0, 12)} is: the manifest lists every uncommitted path.\n`,
    );

  const kits = buildKits();
  checkKits(kits);
  const bundle = buildClient();
  const server = buildServer(bundle);

  stage(6, 'The packages as a set');
  const packages = [
    ...server.packages.map((each) => ({ ...each.descriptor, artifact: each.path })),
    ...kits.map((kit) => ({ ...kit.read.descriptor, artifact: kit.path })),
  ];
  const problems = setProblems(packages);
  for (const each of packages)
    process.stdout.write(
      `${each.name} ${each.version}: depends on ${each.dependencies.join(', ') || 'nothing'}; ` +
        `targets ${each.targetPlatform ? `${each.targetPlatform.name} ${each.targetPlatform.version}` : 'every platform'}.\n`,
    );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Refused(`stage 6: ${problems.length} problem(s) between the packages, listed above.`);
  }
  process.stdout.write(
    'Every dependency is met in the candidate, none conflict, and every target platform is one its dependencies install on.\n',
  );

  stage(7, 'The demo steps a server run would execute, listed, not run');
  const demo = await listDemoSteps(kits);

  stage(8, 'Written');
  write({ kits, bundle, server, demo });
}

// ── 2. Every kit through the pipeline ─────────────────────────────────────────────────────────
function buildKits() {
  stage(2, `Every kit through the pipeline, held to ${options.since}`);
  const directories = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (directories.length === 0) throw new Refused(`stage 2: business-apps/packages/ holds no kit.`);
  const kitsOut = join(out, 'kits');
  mkdirSync(kitsOut);
  const refused = [];
  const kits = [];
  for (const name of directories) {
    const directory = join(PACKAGES, name);
    const previous = kitAt(sinceCommit, `business-apps/packages/${name}`);
    const args = [APP_PACKAGE, directory, '--out', kitsOut, '--platform', platform.version];
    if (previous !== null) args.push('--previous', previous.directory);
    process.stdout.write(
      `\n${name}: ${previous === null ? `not in ${options.since}, so it is new and held to nothing` : `held to ${previous.version}, as it was in ${options.since}`}.\n`,
    );
    const result = spawnSync(process.execPath, args, {
      cwd: REPO,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: withoutCredentials(process.env),
    });
    if (result.status !== 0) {
      refused.push(`${name} (exit ${result.status})`);
      continue;
    }
    const descriptor = descriptorOf(
      readFileSync(join(directory, 'package', 'package.xml'), 'utf8'),
    );
    const zip = join(kitsOut, `${descriptor.name}-${descriptor.version}.zip`);
    if (!existsSync(zip))
      throw new Refused(`stage 2: the pipeline passed ${name} and wrote no ${basename(zip)}.`);
    const changes = join(kitsOut, `${descriptor.name}-${descriptor.version}.changes.md`);
    kits.push({
      directory,
      name: descriptor.name,
      version: descriptor.version,
      path: fromOut(zip),
      changes: existsSync(changes) ? fromOut(changes) : null,
      previous: previous?.version ?? null,
    });
  }
  if (refused.length > 0)
    throw new Refused(`stage 2: the pipeline refused ${refused.join(', ')}, as above.`);
  // A kit the last release had and this candidate has not: the release note says so.
  const listed = git(['ls-tree', '-d', '--name-only', sinceCommit, 'business-apps/packages/']);
  if (listed === null)
    throw new Refused(`stage 2: git could not list business-apps/packages/ at ${options.since}.`);
  kits.removed = listed
    .split('\n')
    .filter(Boolean)
    .map((path) => path.split('/').pop())
    .filter((name) => !directories.includes(name));
  for (const name of kits.removed)
    process.stdout.write(`\n${name}: in ${options.since}, and not in this candidate.\n`);
  return kits;
}

/**
 * The kit at `path` as `commit` has it, written into the scratch folder for `--previous`, with the
 * version its `package.xml` gave, or `null` when the commit has no kit there. Read through `git
 * cat-file`, so nothing but git is needed. A link in it is refused: the pipeline follows none.
 */
function kitAt(commit, path) {
  const listed = run('git', ['ls-tree', '-r', '-z', '--full-tree', commit, '--', path]);
  if (listed.status !== 0)
    throw new Refused(`stage 2: git ls-tree ${commit} ${path} failed: ${listed.stderr.trim()}`);
  const entries = listed.stdout
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      const [mode, type, object] = meta.split(' ');
      return { mode, type, object, file };
    });
  if (!entries.some((entry) => entry.file === `${path}/package/package.xml`)) return null;
  const links = entries.filter((entry) => entry.mode === '120000' || entry.type !== 'blob');
  if (links.length > 0)
    throw new Refused(
      `stage 2: ${links[0].file} at ${options.since} is a symbolic link or a submodule, which the pipeline does not follow.`,
    );
  const batch = spawnSync('git', ['cat-file', '--batch'], {
    cwd: REPO,
    input: `${entries.map((entry) => entry.object).join('\n')}\n`,
    maxBuffer: OUTPUT_LIMIT * 4,
  });
  if (batch.status !== 0)
    throw new Refused(`stage 2: git cat-file could not read ${path} at ${options.since}.`);
  const into = join(scratch, 'previous');
  let at = 0;
  for (const entry of entries) {
    const end = batch.stdout.indexOf(0x0a, at);
    const [, , size] = batch.stdout.subarray(at, end).toString('utf8').split(' ');
    const bytes = batch.stdout.subarray(end + 1, end + 1 + Number(size));
    at = end + 1 + Number(size) + 1;
    const file = join(into, ...entry.file.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const directory = join(into, ...path.split('/'));
  const previous = descriptorOf(readFileSync(join(directory, 'package', 'package.xml'), 'utf8'));
  return { directory, version: previous.version };
}

// ── 3. The kits as a set ──────────────────────────────────────────────────────────────────────
function checkKits(kits) {
  stage(3, 'The kits as a set, read from their zips');
  for (const kit of kits) {
    kit.read = readKit(join(out, kit.path), join(scratch, 'kits', kit.name));
    process.stdout.write(
      `${kit.name} ${kit.version}: the app ${kit.read.app.id} at /${kit.read.app.address ?? kit.read.app.id}, ` +
        `platform ${kit.read.app.platform}, which admits ${platform.version} (the pipeline's step 2); ` +
        `${kit.read.contributes.length} names compared.\n`,
    );
  }
  const unknown = kits.flatMap((kit) => kit.read.unknown.map((point) => `${kit.name}: ${point}`));
  for (const point of unknown)
    process.stdout.write(`  not compared, a point this check does not know: ${point}\n`);
  const duplicates = duplicatesAcross(
    kits.map((kit) => ({ name: kit.name, contributes: kit.read.contributes })),
  );
  if (duplicates.length > 0) {
    for (const { kind, key, kits: owners } of duplicates)
      console.error(`  - the ${kind} ${key} is contributed by ${owners.join(' and ')}`);
    throw new Refused(
      `stage 3: ${duplicates.length} name(s) contributed by more than one kit, listed above. On one server the later replaces the earlier, or is refused.`,
    );
  }
  process.stdout.write(`No two of the ${kits.length} kits contribute the same name.\n`);
}

// ── 4. The client app's production bundle ─────────────────────────────────────────────────────
function buildClient() {
  stage(4, "The client app's production bundle");
  // Where the Maven assembly of nuxeo-agentic-ui-package looks for it: `../dist/nuxeo-ui/browser`.
  const output = join(scratch, 'maven', 'dist', 'nuxeo-ui');
  const result = spawnToolSync(
    'nx',
    [
      'build',
      'nuxeo-ui',
      '--configuration=production',
      '--base-href=/nuxeo/agentic-ui/',
      `--output-path=${output}`,
      '--skip-nx-cache',
    ],
    { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'], env: withoutCredentials(process.env) },
  );
  if (result.status !== 0)
    throw new Refused(
      `stage 4: the production build exited ${result.status ?? result.error?.message}.`,
    );
  const browser = join(output, 'browser');
  if (!existsSync(join(browser, 'index.html')))
    throw new Refused(
      `stage 4: the production build wrote no ${fromRepo(join(browser, 'index.html'))}.`,
    );
  // What the package carries: the assembly leaves a developer's local configuration out.
  const files = filesUnder(browser).filter(
    (file) => file !== NOT_PACKAGED && !file.startsWith(`${NOT_PACKAGED}/`),
  );
  const left = filesUnder(browser).length - files.length;
  const copy = join(out, 'client', 'nuxeo-ui', 'browser');
  for (const file of files)
    cpSync(join(browser, ...file.split('/')), join(copy, ...file.split('/')));
  const listing = join(out, 'client', `nuxeo-ui-${version}.sha256`);
  writeFileSync(
    listing,
    files
      .map((file) => `${sha256(join(copy, ...file.split('/')))}  nuxeo-ui/browser/${file}\n`)
      .join(''),
  );
  process.stdout.write(
    `${files.length} files${left > 0 ? `, and ${left} of ${NOT_PACKAGED}/ left out, as the package leaves them` : ''}; their digests in ${fromOut(listing)}.\n`,
  );
  return { browser, files, listing };
}

// ── 5. The server packages ────────────────────────────────────────────────────────────────────
function buildServer(bundle) {
  stage(5, `The server packages: mvn package at the root, at ${version}`);
  // The whole working tree, every file git does not ignore, and so no `target/`, `dist/` or
  // `node_modules/`: a module's tests may read beyond it, as nuxeo-agentic-assets' read the brand
  // kit's policy, and a copy of the modules alone fails them.
  const root = join(scratch, 'maven');
  const listed = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.status !== 0)
    throw new Refused(`stage 5: git ls-files failed: ${listed.stderr.trim()}`);
  for (const file of new Set(listed.stdout.split('\0').filter(Boolean))) {
    const source = join(REPO, ...file.split('/'));
    const entry = lstatSync(source, { throwIfNoEntry: false });
    // A file deleted from the working tree, but not from the index, is not built.
    if (!entry || entry.isDirectory()) continue;
    const copy = join(root, ...file.split('/'));
    mkdirSync(dirname(copy), { recursive: true });
    if (entry.isSymbolicLink()) symlinkSync(readlinkSync(source), copy);
    else copyFileSync(source, copy);
  }
  for (const module of modules)
    if (!existsSync(join(root, module, 'pom.xml')))
      throw new Refused(`stage 5: the root pom names the module ${module}, which has no pom.xml.`);
  const maven = (args) => {
    const result = spawnSync('mvn', ['-B', '-nsu', '--no-transfer-progress', ...args], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: withoutCredentials(process.env),
    });
    if (result.status !== 0)
      throw new Refused(
        `stage 5: mvn ${args[0]} exited ${result.status ?? result.error?.message}.`,
      );
  };
  maven(['versions:set', `-DnewVersion=${version}`, '-DgenerateBackupPoms=false']);
  // build-marketplace.yml stamps nuxeo-agentic-ui-package's package.xml with sed; its assembly takes
  // the file unfiltered, so without this the package is `@VERSION@`, 0.0.0 to Nuxeo.
  const stamped = [];
  for (const module of modules.filter((each) => each !== CLIENT_MODULE)) {
    const main = join(root, module, 'src', 'main');
    if (!existsSync(main)) continue;
    for (const file of filesUnder(main).filter((each) => basename(each) === 'package.xml')) {
      const path = join(main, ...file.split('/'));
      const text = readFileSync(path, 'utf8');
      if (!text.includes('@VERSION@')) continue;
      writeFileSync(path, text.replaceAll('@VERSION@', version));
      stamped.push(`${module}/src/main/${file}`);
    }
  }
  process.stdout.write(`Stamped ${version} into ${stamped.join(', ') || 'no package.xml'}.\n`);
  maven(['package', ...(modules.includes(CLIENT_MODULE) ? ['-pl', `!${CLIENT_MODULE}`] : [])]);

  const serverOut = join(out, 'server');
  mkdirSync(serverOut);
  const artifacts = [];
  for (const module of modules.filter((each) => each !== CLIENT_MODULE)) {
    const target = join(root, module, 'target');
    const built = existsSync(target)
      ? readdirSync(target).filter(
          (name) =>
            name.endsWith('.zip') ||
            (name.endsWith(`-${version}.jar`) && !/-(tests|sources|javadoc)\.jar$/.test(name)),
        )
      : [];
    if (built.length === 0)
      throw new Refused(
        `stage 5: ${module} built nothing with the candidate's version in target/.`,
      );
    for (const name of built.sort()) {
      cpSync(join(target, name), join(serverOut, name));
      artifacts.push({ module, file: join(serverOut, name) });
    }
  }
  const packages = [];
  for (const artifact of artifacts.filter((each) => each.file.endsWith('.zip'))) {
    const unpacked = unpack(artifact.file, join(scratch, 'server', basename(artifact.file)));
    const descriptorFile = join(unpacked, 'package.xml');
    if (!existsSync(descriptorFile))
      throw new Refused(
        `stage 5: ${basename(artifact.file)} has no package.xml, so it is not a Nuxeo package.`,
      );
    packages.push({
      module: artifact.module,
      path: fromOut(artifact.file),
      descriptor: descriptorOf(readFileSync(descriptorFile, 'utf8')),
      unpacked,
    });
  }
  // The package that deploys the client must deploy this bundle, and nothing else there.
  const carriers = packages.filter((each) => existsSync(join(each.unpacked, ...DEPLOYED_BUNDLE)));
  if (carriers.length === 0)
    throw new Refused(
      `stage 5: no server package deploys the client into ${DEPLOYED_BUNDLE.join('/')}/.`,
    );
  for (const carrier of carriers) {
    const deployed = join(carrier.unpacked, ...DEPLOYED_BUNDLE);
    const shipped = filesUnder(deployed);
    const missing = bundle.files.filter((file) => !shipped.includes(file));
    const extra = shipped.filter((file) => !bundle.files.includes(file));
    const differing = bundle.files.filter(
      (file) =>
        shipped.includes(file) &&
        sha256(join(deployed, ...file.split('/'))) !==
          sha256(join(bundle.browser, ...file.split('/'))),
    );
    if (missing.length + extra.length + differing.length > 0)
      throw new Refused(
        `stage 5: ${carrier.path} does not carry the bundle stage 4 built: ${missing.length} file(s) missing ` +
          `(${missing.slice(0, 3).join(', ')}), ${extra.length} more (${extra.slice(0, 3).join(', ')}), ` +
          `${differing.length} with other bytes (${differing.slice(0, 3).join(', ')}).`,
      );
    process.stdout.write(
      `${carrier.descriptor.name} ${carrier.descriptor.version} (${carrier.path}) carries the bundle: ${shipped.length} files, byte for byte.\n`,
    );
  }
  return { artifacts, packages };
}

// ── 7. The demo steps ─────────────────────────────────────────────────────────────────────────
async function listDemoSteps(kits) {
  const { problems, listing } = await demoSteps({
    repo: REPO,
    stepsDir: STEPS,
    kits: kits.map(({ name, version: kitVersion, directory }) => ({
      name,
      version: kitVersion,
      directory,
    })),
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Refused(
      `stage 7: ${problems.length} steps file(s) could not be listed, as above. A listing that left one out would make a kit's demo look shorter than it is.`,
    );
  }
  const markdown = demoStepsMarkdown(listing);
  process.stdout.write(markdown);
  return { listing, markdown };
}

// ── 8. Written ────────────────────────────────────────────────────────────────────────────────
function write({ kits, bundle, server, demo }) {
  const artifact = (kind, fields, path) => ({
    kind,
    ...fields,
    path: fromOut(path),
    sha256: sha256(path),
    bytes: lstatSync(path).size,
  });
  const artifacts = [
    artifact(
      'client bundle',
      { name: 'nuxeo-ui', version, files: bundle.files.length, platform: platform.version },
      bundle.listing,
    ),
    ...server.artifacts.map(({ module, file }) => {
      const held = server.packages.find((each) => each.path === fromOut(file));
      return held
        ? artifact(
            'server package',
            { name: held.descriptor.name, version: held.descriptor.version, module },
            file,
          )
        : artifact(
            'bundle',
            { name: basename(file).slice(0, -`-${version}.jar`.length), version, module },
            file,
          );
    }),
    ...kits.flatMap((kit) => [
      artifact('kit', { name: kit.name, version: kit.version }, join(out, kit.path)),
      ...(kit.changes
        ? [
            artifact(
              'kit changes',
              { name: kit.name, version: kit.version },
              join(out, kit.changes),
            ),
          ]
        : []),
    ]),
  ];

  const notes = releaseNotes({ kits, bundle, server });
  writeFileSync(join(out, 'RELEASE-NOTES.md'), notes);
  writeFileSync(join(out, 'DEMO-STEPS.md'), demo.markdown);
  const manifest = {
    format: 'nuxeo-satori-release-candidate/1',
    version,
    commit: head,
    uncommitted,
    since: { ref: options.since, commit: sinceCommit },
    platform: { name: platform.name, version: platform.version },
    artifacts,
    kits: kits.map((kit) => ({
      name: kit.name,
      version: kit.version,
      app: kit.read.app.id,
      address: kit.read.app.address ?? kit.read.app.id,
      platform: kit.read.app.platform,
      heldTo: kit.previous,
      dependencies: kit.read.descriptor.dependencies,
      targetPlatform: kit.read.descriptor.targetPlatform,
    })),
    removedSince: kits.removed,
    notCompared: kits.flatMap((kit) => kit.read.unknown.map((point) => `${kit.name}: ${point}`)),
    demoSteps: demo.listing,
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Every file the candidate holds, in the form `sha256sum -c SHA256SUMS` reads from `--out`.
  const sums = filesUnder(out)
    .filter((file) => file !== 'SHA256SUMS')
    .map((file) => `${sha256(join(out, ...file.split('/')))}  ${file}\n`);
  writeFileSync(join(out, 'SHA256SUMS'), sums.join(''));
  process.stdout.write(
    `\nRelease candidate ${version} written to ${fromRepo(out)}: ${artifacts.length} artifacts in manifest.json, ` +
      `${sums.length} files in SHA256SUMS, RELEASE-NOTES.md and DEMO-STEPS.md. Nothing was signed, tagged or published.\n`,
  );
}

/** The release note: the platform's packages, and each kit with what changed in it since `--since`. */
function releaseNotes({ kits, bundle, server }) {
  const lines = [
    `# Release candidate ${version}`,
    '',
    `Assembled offline from ${head?.slice(0, 12) ?? 'no commit'}` +
      `${uncommitted.length > 0 ? `, with ${uncommitted.length} uncommitted path(s) listed in manifest.json` : ''}, ` +
      `and compared with ${options.since} (${sinceCommit.slice(0, 12)}), the last release. Not signed, ` +
      'not published, and installed on no server.',
    '',
    '## The platform',
    '',
    '| Package | Version | Target platform | Depends on | File |',
    '| ------- | ------- | --------------- | ---------- | ---- |',
    ...server.packages.map(
      ({ descriptor, path }) =>
        `| ${descriptor.name} | ${descriptor.version} | ${descriptor.targetPlatform ? `${descriptor.targetPlatform.name} ${descriptor.targetPlatform.version}` : 'any'} | ${descriptor.dependencies.join(', ') || 'nothing'} | \`${path}\` |`,
    ),
    '',
    `The client app's production bundle, ${bundle.files.length} files, ships in ` +
      `${server.packages
        .filter((each) => existsSync(join(each.unpacked, ...DEPLOYED_BUNDLE)))
        .map((each) => `${each.descriptor.name} ${each.descriptor.version}`)
        .join(' and ')}, ` +
      `on ${platform.name} ${platform.version}.`,
    '',
    `## The kits, and what changed in each since ${options.since}`,
    '',
  ];
  for (const kit of kits) {
    lines.push(`### ${kit.name} ${kit.version}`, '');
    if (kit.previous === null) {
      lines.push(
        `New: ${options.since} has no business-apps/packages/${basename(kit.directory)}, so nothing is compared.`,
        '',
      );
      continue;
    }
    const changes = kit.changes ? readFileSync(join(out, kit.changes), 'utf8') : '';
    // The pipeline's changelog, under this kit's heading: its title dropped, its sections one level down.
    const body = changes
      .replace(/^# .*\n+/, '')
      .replace(/^## /gm, '#### ')
      .trim();
    lines.push(body || `Since ${kit.previous}: the pipeline wrote no changelog.`, '');
  }
  if (kits.removed.length > 0) {
    lines.push(`## Removed since ${options.since}`, '');
    for (const removed of kits.removed) lines.push(`- ${removed}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
