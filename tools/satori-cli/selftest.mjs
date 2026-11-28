#!/usr/bin/env node
/**
 * The controls of `@nuxeo/satori-cli`: that the tool and `scripts/app-package.mjs` are one builder,
 * that the tool runs outside this repository with Node alone, and that each thing it is to refuse
 * it refuses at its own step. It builds the tool first, into a scratch folder, with `build.mjs`.
 *
 *   node tools/satori-cli/selftest.mjs        (the project's `test` target)
 *
 * 1. **One builder.** Every kit in `business-apps/packages/` is built by `app-package.mjs` and by
 *    the tool, as CI builds it, and the two zips must have the same SHA-256; the validator's report
 *    of each kit, through `bin.mjs` and through the tool's `validator.mjs`, must be the same text.
 *    The control on it: the tool with one byte of its builder changed gives another digest, so the
 *    comparison would see a tool whose builder is not the pipeline's.
 * 2. **Outside the repository.** `npm pack` makes the tool's package; it is unpacked into a new
 *    folder with no `node_modules`, and its `satori.mjs` builds a copy of a kit, to the digest of 1,
 *    and a repository `satori create` writes, under Node's permission model: no Node process of the
 *    run, the tool, its validator or its builder, may read or write anything outside that folder.
 *    The control on it: under the same permissions, reading this repository's `package.json` fails.
 * 3. **Refusals, each at its own step:** a version 2 file broken, a Layer 1 key and a Layer 0 key
 *    the application does not read, a preset's, a model property the type does not have, a name
 *    Satori itself uses (by `create`, by a package, by a fragment), version 2 files with no
 *    `app.json`, a key the builder refuses, a symbolic link, and the command's own errors. And what
 *    passes: the scaffold, a package mixing every layer, a package whose `build.mjs` is old,
 *    `validate` writing nothing, the upgrade check against a folder and a zip, and `model pull`
 *    against a stand-in server, which must receive the credentials in a header and nowhere else.
 * 4. **The names Satori uses** are the `config-package` generator's, in both its copies.
 * 5. **`agents sync`** writes the skill, AGENTS.md's section and the MCP server's entries, with no
 *    value of the environment in any of them, however the credentials are set; run again, it writes
 *    nothing and touches no file; a customer's text outside AGENTS.md's section and their own
 *    servers and keys are kept to the byte while what is the tool's is put back; `--check` sees
 *    each; and a file it cannot read whole, a marker repeated, or a link, refuses it with nothing
 *    written. The controls on it: a planted secret, and text planted outside the section, are seen.
 * 6. **The MCP server outside the repository,** in the folder of 2, started from the tarball as
 *    `satori mcp` under Node's permission model, given on its command line so that every process it
 *    starts is confined too: its tools are the repository's server's, name for name and schema for
 *    schema; `validate_package` passes the scaffold; a write with an unregistered widget is refused
 *    with the package unchanged; a generator's write is kept; `preview_package` refuses. The
 *    bundles hold no path of this repository. The control on the confinement: a process the
 *    confined one starts, with no environment, cannot read this repository either.
 * 7. **One generator.** Every app generator, in the order a kit is made, is run through the
 *    repository's runner, with Nx's tree and Prettier, and through the bundled one, on the same
 *    package, and their answers must be the same bytes. The control on it: the bundled runner
 *    given another print width answers otherwise.
 * 8. **`sign` and `verify`,** outside the repository on the scaffold's zip, with keys made at run
 *    time: a key held outside the repository signs, and one inside it is refused; refused are a
 *    changed byte, a signer not trusted, and another version three ways; and `verify` with no
 *    trusted signers, and `--keyless` off a tag build.
 * 9. **What `create` writes for agents and CI:** the skill a customer gets names every tool the
 *    server has and nothing of this repository's (this repository's own skill is the control), and
 *    the workflow checks the agent files and signs only in its one job with an identity, only once
 *    configured; each of three breaks of the workflow is seen.
 *
 * Exit 0 when every control holds, 1 when one does not.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnToolSync } from '../../scripts/beta-harness/package-command.mjs';
import { SATORI_NAMES } from '../../scripts/package-pipeline/configuration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const KITS = join(REPO, 'business-apps', 'packages');
const PLATFORM = JSON.parse(
  readFileSync(join(REPO, 'libs', 'platform', 'package.json'), 'utf8'),
).version;
/** The tool's version, as its project's package.json says, which the published one must carry. */
const VERSION_OF_SOURCE = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;
const PIPELINE = join(REPO, 'scripts', 'app-package.mjs');
const VALIDATOR = join(REPO, 'libs', 'shared', 'app-definition', 'src', 'bin.mjs');
const PAYERS = join(KITS, 'payers-claims-demo');
const LAYOUT = 'bundle/agentic-ui-config/layouts/Claim/view.layout.json';
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** The files `agents sync` manages, from a repository's root. */
const AGENT_FILES = [
  '.cursor/skills/satori-app-builder/SKILL.md',
  '.claude/skills/satori-app-builder/SKILL.md',
  '.agent/skills/satori-app-builder/SKILL.md',
  'AGENTS.md',
  '.mcp.json',
  '.cursor/mcp.json',
];
const SECTION_BEGIN = '<!-- BEGIN satori agents';
const SECTION_END = '<!-- END satori agents -->';
/** An MCP entry's environment, as the tool writes it: a reference to a variable, in either form. */
const REFERENCE = /^\$\{(?:env:)?(NUXEO_URL|NUXEO_USER|NUXEO_PASS)(?::-)?\}$/;

/** What a customer's skill may not say: this repository's places and commands. */
const REPOSITORY_ONLY = [
  [/\bclone\b/i, 'tells them to clone'],
  [/business-apps\/packages/, 'names business-apps/packages'],
  [/tools\/builder-mcp|tools\/satori-generators/, 'names a tool of this repository by its path'],
  [/npx nx\b|nx serve|npm run app-package/, "runs this repository's commands"],
  [/nuxeo-builder/, "names this repository's server"],
  [/\blibs\/|docs\/business-apps/, "names this repository's sources or documents"],
];

const failures = [];
let held = 0;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'satori-cli-selftest-')));
const fail = (what, why, output = '') =>
  failures.push(`${what}: ${why}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);

try {
  // The tool, built from this repository as it is.
  const tool = join(scratch, 'tool');
  const built = node([join(HERE, 'build.mjs'), '--out', tool]);
  if (built.status !== 0) throw new Error(`the tool did not build:\n${built.output}`);
  const satori = join(tool, 'satori.mjs');
  // The same bytes when it is built from another folder: nothing of where the build ran is in it.
  const elsewhere = join(scratch, 'tool-elsewhere');
  const again = node([join(HERE, 'build.mjs'), '--out', elsewhere], { cwd: scratch });
  if (
    again.status !== 0 ||
    JSON.stringify(fingerprint(elsewhere)) !== JSON.stringify(fingerprint(tool))
  )
    fail(
      'the tool built from another folder',
      `exit ${again.status}, or other bytes`,
      again.output,
    );
  else held++;

  oneBuilder(satori, tool);
  const kitDigest = digestOf(buildWith(PIPELINE, PAYERS, join(scratch, 'pipeline-payers')));
  const tools = await repositoryTools();
  packContents(tool);
  const confined = await outsideTheRepository(tool, kitDigest, tools);
  refusals(satori);
  await modelPull(satori, confined);
  reservedNames();
  agentsSync(satori, tool);
  oneGenerator(tool);
  customerSkill(tool, tools);
  workflowTemplate(tool);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`satori-cli selftest: ${failures.length} control(s) failed:\n`);
  for (const failure of failures) console.error(`- ${failure}\n`);
  process.exit(1);
}
console.log(`satori-cli selftest: ${held} controls held.`);

// --- 1. One builder ------------------------------------------------------------------------------

function oneBuilder(satori, tool) {
  const kits = readdirSync(KITS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (kits.length === 0) fail('the kits', `${KITS} holds no kit, so nothing was compared`);
  for (const kit of kits) {
    const directory = join(KITS, kit);
    const pipeline = buildWith(PIPELINE, directory, join(scratch, 'pipeline', kit));
    const ours = buildWith(satori, directory, join(scratch, 'tool-out', kit), ['build']);
    const [was, is] = [digestOf(pipeline), digestOf(ours)];
    if (pipeline.status !== 0 || ours.status !== 0)
      fail(
        kit,
        `app-package.mjs exited ${pipeline.status}, the tool ${ours.status}`,
        pipeline.output + ours.output,
      );
    else if (was === null || was !== is)
      fail(kit, `app-package.mjs built ${was}, and the tool ${is}`);
    else held++;
    // The validator's report, through bin.mjs and through the tool's bundle of the same source.
    const root = join(directory, 'bundle', 'agentic-ui-config');
    const flags = [
      '--platform',
      PLATFORM,
      '--catalogue',
      join(REPO, 'apps', 'nuxeo-ui', 'public', 'i18n', 'en.json'),
    ];
    if (existsSync(join(directory, 'content-model.json')))
      flags.push('--model', join(directory, 'content-model.json'));
    const allowList = join(directory, 'deployment', 'build-allow-list.json');
    if (existsSync(allowList)) flags.push('--allow-list', allowList);
    const [source, bundled] = [VALIDATOR, join(tool, 'validator.mjs')].map((file) =>
      node([file, 'validate', root, ...flags]),
    );
    if (source.status !== bundled.status || source.output !== bundled.output)
      fail(
        `${kit}'s validation`,
        "bin.mjs and the tool's validator.mjs answer differently",
        `${source.output}\n---\n${bundled.output}`,
      );
    else held++;
  }
  // The control on the comparison: one byte of the builder changed changes the digest.
  const changed = join(scratch, 'tool-changed');
  cpSync(tool, changed, { recursive: true });
  const builder = join(changed, 'builder', 'build.mjs');
  const text = readFileSync(builder, 'utf8');
  const date = 'const DOS_DATE = (0 << 9) | (1 << 5) | 1;';
  if (!text.includes(date))
    fail('the control on the comparison', `the builder no longer has ${date}`);
  else {
    writeFileSync(builder, text.replace(date, 'const DOS_DATE = (0 << 9) | (1 << 5) | 2;'));
    const other = buildWith(join(changed, 'satori.mjs'), PAYERS, join(scratch, 'changed-out'), [
      'build',
    ]);
    const pipeline = buildWith(PIPELINE, PAYERS, join(scratch, 'pipeline-again'));
    if (other.status !== 0 || digestOf(other) === digestOf(pipeline))
      fail(
        'the control on the comparison',
        'a tool whose builder differs by a byte built the same zip, or none',
        other.output,
      );
    else held++;
  }
}

// --- 2. Outside the repository -------------------------------------------------------------------

async function outsideTheRepository(tool, kitDigest, tools) {
  const packed = join(scratch, 'packed');
  mkdirSync(packed);
  // From a folder of its own, so that no .npmrc of this repository is read.
  const pack = spawnToolSync('npm', ['pack', tool, '--pack-destination', packed, '--silent'], {
    cwd: packed,
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
  });
  const tarball = readdirSync(packed).find((name) => name.endsWith('.tgz'));
  if (pack.status !== 0 || tarball === undefined) {
    fail('npm pack', `exit ${pack.status}`, `${pack.stdout}${pack.stderr}${pack.error ?? ''}`);
    return;
  }
  const outside = join(scratch, 'outside');
  mkdirSync(outside, { recursive: true });
  const untar = spawnSync('tar', ['-xzf', join(packed, tarball), '-C', outside], {
    encoding: 'utf8',
  });
  if (untar.status !== 0) {
    fail('the tarball', 'tar could not unpack it', untar.stderr);
    return;
  }
  const bin = join(outside, 'package', 'satori.mjs');
  if (
    existsSync(join(outside, 'node_modules')) ||
    existsSync(join(outside, 'package', 'node_modules'))
  )
    fail('the tarball', 'a node_modules folder is beside the tool');
  cpSync(PAYERS, join(outside, 'payers-claims-demo'), {
    recursive: true,
    filter: (path) => basename(path) !== 'dist',
  });
  // Every Node process of the run may read and write this folder, and nothing else: not even the
  // system's temporary folder, which TMPDIR, TEMP and TMP still name, as a customer's do. What a
  // run writes for itself goes in its --out, or in --tmp, inside the folder.
  const env = {
    ...process.env,
    NODE_OPTIONS: `--permission --allow-fs-read=${outside} --allow-fs-write=${outside} --allow-child-process`,
  };
  const confined = (args, cwd = outside) => node(args, { cwd, env });
  const probe = confined([
    '-e',
    `require('node:fs').readFileSync(${JSON.stringify(join(REPO, 'package.json'))})`,
  ]);
  if (probe.status === 0 || !probe.output.includes('ERR_ACCESS_DENIED'))
    fail(
      'the control on the confinement',
      "a Node process confined to the folder read this repository's package.json",
      probe.output,
    );
  else held++;
  // The control on the temporary folder: a confined process may not write the system's, so each
  // run below that passes does so without it.
  const system = confined([
    '-e',
    "const fs = require('node:fs'); fs.rmdirSync(fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'satori-probe-')))",
  ]);
  if (system.status === 0 || !system.output.includes('ERR_ACCESS_DENIED'))
    fail(
      'the control on the temporary folder',
      `a confined process wrote the system's temporary folder, ${tmpdir()}, so the runs below prove nothing of --tmp`,
      system.output,
    );
  else held++;

  // A build under the permission model, with only the folder allowed: its step 5 folder goes in
  // --out, which it writes anyway, and nothing of it is left there.
  const allowList = join(outside, 'payers-claims-demo', 'deployment', 'build-allow-list.json');
  const allowed = existsSync(allowList) ? ['--allow-list', allowList] : [];
  const kit = confined([
    bin,
    'build',
    join(outside, 'payers-claims-demo'),
    '--out',
    join(outside, 'payers-out'),
    ...allowed,
  ]);
  const digest = digestOf({ ...kit, out: join(outside, 'payers-out') });
  if (kit.status !== 0 || digest !== kitDigest)
    fail(
      'a kit, outside the repository, under the permission model',
      `exit ${kit.status}, digest ${digest}, and app-package.mjs's is ${kitDigest}`,
      kit.output,
    );
  else held++;
  onlyTheZip('satori build --out, under the permission model', join(outside, 'payers-out'));
  // And with no --out: in the package's own dist/.
  const inPackage = confined([bin, 'build', join(outside, 'payers-claims-demo'), ...allowed]);
  if (inPackage.status !== 0)
    fail(
      'satori build into the package, under the permission model',
      `exit ${inPackage.status}`,
      inPackage.output,
    );
  else held++;
  onlyTheZip(
    'satori build into the package, under the permission model',
    join(outside, 'payers-claims-demo', 'dist'),
  );
  // An --out the permission model does not allow is refused before anything runs, and said.
  const forbidden = join(scratch, 'not-allowed');
  const refusedOut = confined([
    bin,
    'build',
    join(outside, 'payers-claims-demo'),
    '--out',
    forbidden,
  ]);
  if (
    refusedOut.status !== 2 ||
    !refusedOut.output.includes("Node's permission model does not let it write there") ||
    existsSync(forbidden)
  )
    fail(
      'satori build into a folder the permission model does not allow',
      `exit ${refusedOut.status}, not 2 saying so`,
      refusedOut.output,
    );
  else held++;
  // A relative path given to the permission model: Node passes it, as written, to the builder,
  // which reads it from the package's folder and stops at step 4. Refused before anything runs,
  // on the command line and in NODE_OPTIONS.
  const relativeFlags = ['--permission', '--allow-fs-read=.', '--allow-fs-write=.'];
  for (const [how, args, environment] of [
    [
      'on the command line',
      [...relativeFlags, '--allow-child-process', bin],
      { ...process.env, NODE_OPTIONS: '' },
    ],
    [
      'each given as a flag and a value apart',
      [
        '--permission',
        '--allow-fs-read',
        '.',
        '--allow-fs-write',
        '.',
        '--allow-child-process',
        bin,
      ],
      { ...process.env, NODE_OPTIONS: '' },
    ],
    [
      'in NODE_OPTIONS',
      [bin],
      { ...process.env, NODE_OPTIONS: `${relativeFlags.join(' ')} --allow-child-process` },
    ],
  ]) {
    const relativeOut = join(outside, 'relative-out');
    const run = node([...args, 'build', 'payers-claims-demo', '--out', relativeOut, ...allowed], {
      cwd: outside,
      env: environment,
    });
    if (run.status !== 2 || !run.output.includes('not absolute') || existsSync(relativeOut))
      fail(
        `satori build with the permission model's paths relative, ${how}`,
        `exit ${run.status}, not 2 saying to give absolute paths`,
        run.output,
      );
    else held++;
  }
  // --tmp inside what the package packages is refused, and nothing is made there.
  const inBundle = join(outside, 'payers-claims-demo', 'bundle', 'tmp');
  const packaged = confined([
    bin,
    'validate',
    join(outside, 'payers-claims-demo'),
    '--tmp',
    inBundle,
    ...allowed,
  ]);
  if (
    packaged.status !== 2 ||
    !packaged.output.includes("inside the package's bundle/") ||
    existsSync(inBundle)
  )
    fail(
      "satori validate with --tmp inside the package's bundle/",
      `exit ${packaged.status}, not 2 saying so`,
      packaged.output,
    );
  else held++;

  const created = confined([
    bin,
    'create',
    join(outside, 'acme-satori'),
    '--name',
    'acme-config',
    '--owner',
    'acme',
  ]);
  const repository = join(outside, 'acme-satori');
  const expected = [
    'package.json',
    '.npmrc',
    'AGENTS.md',
    '.gitignore',
    '.github/workflows/satori.yml',
    'config-packages/acme-config/package/package.xml',
    '.cursor/skills/satori-app-builder/SKILL.md',
    '.claude/skills/satori-app-builder/SKILL.md',
    '.agent/skills/satori-app-builder/SKILL.md',
    '.mcp.json',
    '.cursor/mcp.json',
  ];
  const missing = expected.filter((file) => !existsSync(join(repository, ...file.split('/'))));
  if (created.status !== 0 || missing.length > 0)
    fail(
      'satori create, outside the repository',
      `exit ${created.status}, missing ${missing.join(', ') || 'nothing'}`,
      created.output,
    );
  else held++;
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  if (
    manifest.devDependencies?.['@nuxeo/satori-cli'] !==
    JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version
  )
    fail('satori create', 'package.json does not pin the tool as a dev dependency');
  else held++;
  // npm finds the tool on Nuxeo's registry by its scope alone, with no token in the file.
  const npmrc = existsSync(join(repository, '.npmrc'))
    ? readFileSync(join(repository, '.npmrc'), 'utf8')
    : '';
  const settings = npmrc.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  if (
    JSON.stringify(settings) !==
    JSON.stringify(['@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/'])
  )
    fail('satori create', `.npmrc is not the @nuxeo scope's registry alone: ${settings}`);
  else held++;
  if (existsSync(join(repository, 'config-packages', 'acme-config', 'project.json')))
    fail('satori create', "the generator's project.json, which is Nx's, was kept");
  // validate always makes a temporary folder, so under the permission model it needs --tmp, and
  // says so before it runs rather than stopping halfway.
  const unplaced = confined(
    [bin, 'validate', 'config-packages/acme-config', '--kits', 'config-packages'],
    repository,
  );
  if (
    unplaced.status !== 2 ||
    !unplaced.output.includes('Give --tmp <directory>') ||
    existsSync(join(repository, 'tmp'))
  )
    fail(
      'satori validate with no --tmp, under the permission model',
      `exit ${unplaced.status}, not 2 naming --tmp`,
      unplaced.output,
    );
  else held++;
  for (const step of ['validate', 'build']) {
    const run = confined(
      [
        bin,
        step,
        'config-packages/acme-config',
        ...(step === 'build' ? ['--out', 'dist'] : ['--tmp', 'tmp']),
        '--kits',
        'config-packages',
      ],
      repository,
    );
    if (run.status !== 0)
      fail(
        `satori ${step} of the scaffold, outside the repository`,
        `exit ${run.status}`,
        run.output,
      );
    else held++;
  }
  if (!existsSync(join(repository, 'dist', 'acme-config-1.0.0.zip')))
    fail('satori build of the scaffold', 'no zip in dist/');
  onlyTheZip('satori build of the scaffold', join(repository, 'dist'));
  if (existsSync(join(repository, 'config-packages', 'acme-config', 'dist')))
    fail('satori validate of the scaffold', 'it wrote into the package');
  if (existsSync(join(repository, 'tmp')))
    fail('satori validate --tmp tmp', 'it left tmp/, which it made, behind');
  // upgrade-check makes one only to unpack a zip: refused then without --tmp, and run with it.
  const upgrade = (more) =>
    confined(
      [
        bin,
        'upgrade-check',
        'config-packages/acme-config',
        '--previous',
        'dist/acme-config-1.0.0.zip',
        ...more,
      ],
      repository,
    );
  const noPlace = upgrade([]);
  if (noPlace.status !== 2 || !noPlace.output.includes('Give --tmp <directory>'))
    fail(
      'satori upgrade-check of a zip with no --tmp, under the permission model',
      `exit ${noPlace.status}, not 2 naming --tmp`,
      noPlace.output,
    );
  else held++;
  const placed = upgrade(['--tmp', 'tmp']);
  if (placed.status !== 0 || !placed.output.includes('every configuration is kept'))
    fail(
      'satori upgrade-check of a zip with --tmp, under the permission model',
      `exit ${placed.status}`,
      placed.output,
    );
  else held++;

  // What create wrote for agents is what agents sync writes: --check finds it in step.
  const checked = node([bin, 'agents', 'sync', '--check'], { cwd: repository, env });
  if (checked.status !== 0 || !checked.output.includes('are those @nuxeo/satori-cli'))
    fail('satori agents sync --check of the scaffold', `exit ${checked.status}`, checked.output);
  else held++;

  await mcpOutside(outside, bin, repository, tools);
  signAndVerify(outside, bin, repository, env);
  releaseChecks(outside, bin, repository, env);
  // For `model pull`, run as a customer runs it, confined to the folder: section 3.
  return { bin, outside, env };
}

// --- 2a. What the tarball holds ------------------------------------------------------------------

/**
 * `pack-check.mjs`, which the publish workflow runs before anything is published, passes the tool
 * as it is built, and refuses each thing a tarball of it may not hold, planted in a copy of it: the
 * controls on the check. The key is made, and the token assembled, here at run time.
 */
function packContents(tool) {
  const check = (folder) => node([join(HERE, 'pack-check.mjs'), folder]);
  const built = check(tool);
  if (built.status !== 0 || !built.output.includes('may be published'))
    fail('pack-check.mjs on the tool as it is built', `exit ${built.status}`, built.output);
  else held++;
  const manifest = JSON.parse(readFileSync(join(tool, 'package.json'), 'utf8'));
  if ('private' in manifest || manifest.version !== VERSION_OF_SOURCE)
    fail('the published package.json', `private, or not version ${VERSION_OF_SOURCE}`);
  else held++;
  const { privateKey } = generateKeyPairSync('ed25519');
  const token = ['gh', 'p_'].join('') + randomBytes(30).toString('hex').slice(0, 36);
  const json = (file, change) => (folder) => {
    const path = join(folder, file);
    writeFileSync(path, `${JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8'))))}\n`);
  };
  const plant = (file, text) => (folder) => {
    mkdirSync(dirname(join(folder, ...file.split('/'))), { recursive: true });
    writeFileSync(join(folder, ...file.split('/')), text);
  };
  let copy = 0;
  for (const [what, change, says] of [
    ['a private package.json', json('package.json', (m) => ({ ...m, private: true })), '"private"'],
    [
      'another registry',
      json('package.json', (m) => ({
        ...m,
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
      })),
      'publishConfig',
    ],
    [
      'an install script',
      json('package.json', (m) => ({ ...m, scripts: { postinstall: 'node satori.mjs' } })),
      'has scripts',
    ],
    ['a source map', plant('platform/en.json.map', '{}\n'), 'is a source map'],
    [
      'a file npm would leave out of the tarball',
      plant('agents/.npmrc', 'registry=https://example.invalid/\n'),
      'npm would not pack it',
    ],
    ['a test fixture', plant('templates/__fixtures__/kit.json', '{}\n'), 'is a test or a fixture'],
    [
      'a private key',
      plant('agents/signing.txt', privateKey.export({ type: 'pkcs8', format: 'pem' })),
      'shaped like a private key',
    ],
    ['a token', plant('templates/notes.txt', `token: ${token}\n`), 'shaped like a GitHub token'],
    [
      "this repository's folder",
      plant('agents/where.txt', `${REPO}\n`),
      'a folder of the machine that built it',
    ],
    [
      'a README that links by a path of this repository',
      plant('README.md', '# x\n\nSee [the guide](../../docs/business-apps/README.md).\n'),
      'lead nowhere on the registry',
    ],
  ]) {
    const folder = join(scratch, 'pack-checks', String(++copy));
    cpSync(tool, folder, { recursive: true });
    change(folder);
    const run = check(folder);
    if (run.status !== 1 || !run.output.includes(says))
      fail(
        `the control on pack-check.mjs: ${what}`,
        `exit ${run.status}, not 1 saying "${says}"`,
        run.output,
      );
    else held++;
  }
}

// --- 3. Refusals, each at its own step -----------------------------------------------------------

function refusals(satori) {
  const scaffold = join(scratch, 'scaffold');
  const created = node([satori, 'create', scaffold, '--name', 'acme-config', '--owner', 'acme']);
  if (created.status !== 0) {
    fail('satori create', `exit ${created.status}`, created.output);
    return;
  }
  const first = join(scaffold, 'config-packages', 'acme-config');
  const copies = join(scratch, 'copies');
  let copy = 0;
  /** A copy of `from`, changed by `change`. */
  const changed = (from, change) => {
    const directory = join(copies, String(++copy), basename(from));
    cpSync(from, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
    const edit = (file, was, is) => {
      const path = join(directory, ...file.split('/'));
      const text = readFileSync(path, 'utf8');
      if (!text.includes(was))
        throw new Error(`the control's edit does not apply to ${file}: ${was}`);
      writeFileSync(path, text.replace(was, is));
    };
    const write = (file, text) => {
      mkdirSync(dirname(join(directory, ...file.split('/'))), { recursive: true });
      writeFileSync(join(directory, ...file.split('/')), text);
    };
    change({ directory, edit, write });
    return directory;
  };
  const refused = (what, from, change, step, reason, args = []) => {
    const directory = changed(from, change);
    const run = node([satori, 'validate', directory, ...args(directory)]);
    if (run.status !== 1) fail(what, `exit ${run.status}, not 1`, run.output);
    else if (!run.output.includes(`step ${step} refused it`))
      fail(what, `not refused at step ${step}`, run.output);
    else if (!run.output.includes(reason)) fail(what, `no "${reason}"`, run.output);
    else held++;
  };
  const passes = (what, from, change, says, args = () => []) => {
    const directory = changed(from, change);
    const run = node([satori, 'validate', directory, ...args(directory)]);
    if (run.status !== 0) fail(what, `exit ${run.status}, not 0`, run.output);
    else if (says !== undefined && !run.output.includes(says))
      fail(what, `no "${says}"`, run.output);
    else held++;
    return directory;
  };
  const withAllowList = (directory) => {
    const file = join(directory, 'deployment', 'build-allow-list.json');
    return existsSync(file) ? ['--allow-list', file] : [];
  };
  const none = () => [];
  const json =
    (path, change) =>
    ({ directory }) => {
      const file = join(directory, ...path.split('/'));
      const value = JSON.parse(readFileSync(file, 'utf8'));
      change(value);
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    };
  const MANIFEST = 'bundle/agentic-ui-config/manifest.json';
  const BOOTSTRAP = 'bundle/agentic-ui-config/bootstrap.json';
  const COMPONENT = 'bundle/OSGI-INF/acme-config-config.xml';

  // A version 2 file: phase 0's demo, step 1, through the tool.
  refused(
    'a layout naming a widget the platform does not have',
    PAYERS,
    ({ edit }) => edit(LAYOUT, '"widget": "document-link"', '"widget": "calendar"'),
    2,
    'cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]',
    withAllowList,
  );
  // A Layer 1 key, and a Layer 0 key, the application would ignore.
  refused(
    'a Layer 1 key the application does not read',
    first,
    json(MANIFEST, (value) => (value.featureToggle = { search: false })),
    2,
    '"featureToggle" is not a key a manifest fragment has there, so the application would ignore it in silence; perhaps "featureToggles" [unknown]',
    none,
  );
  refused(
    'a Layer 0 key, inside a section, the application does not read',
    first,
    json(BOOTSTRAP, (value) => (value.branding.applicationTitel = 'Acme')),
    2,
    'branding.applicationTitel: "applicationTitel" is not a key a bootstrap fragment has there',
    none,
  );
  refused(
    "a preset's Layer 1 key the application does not read",
    first,
    json(BOOTSTRAP, (value) => {
      value.presales = {
        presetSwitching: true,
        presets: { demo: { label: 'Demo', manifest: { lables: {} } } },
      };
    }),
    2,
    'presales.presets.demo.manifest.lables: "lables" is not a key',
    none,
  );
  // A model property: a field the type does not have, held to the model --model names.
  refused(
    'a field whose property the type does not have, held to --model',
    PAYERS,
    ({ edit }) => edit(LAYOUT, '"claim:number",', '"claim:numbr",'),
    2,
    '"claim:numbr" is not a property of the type "Claim" or of its facets [unknown]',
    (directory) => [...withAllowList(directory), '--model', join(directory, 'content-model.json')],
  );
  // The names Satori itself uses, in a package and in a fragment.
  refused(
    "a package named as Satori's own",
    first,
    ({ edit }) => edit('package/package.xml', 'name="acme-config"', 'name="nuxeo-agentic-ui"'),
    3,
    'names the package "nuxeo-agentic-ui", a name Satori itself uses',
    none,
  );
  refused(
    "a fragment named as Satori's own",
    first,
    ({ edit }) =>
      edit(
        COMPONENT,
        '<fragment name="acme-config" layer="manifest"',
        '<fragment name="defaults" layer="manifest"',
      ),
    2,
    '"defaults" is a name Satori itself uses',
    none,
  );
  // An app definition's file with no app.json: nothing would check it.
  refused(
    'a home with no app.json',
    first,
    ({ write }) => write('bundle/agentic-ui-config/home.json', '{ "version": 2, "cards": [] }\n'),
    2,
    'the package holds bundle/agentic-ui-config/home.json, of an app definition, and no bundle/agentic-ui-config/app.json',
    none,
  );
  refused(
    'an <app> with no app.json, which the registry would serve unchecked',
    first,
    ({ edit, write }) => {
      write('bundle/apps/app.json', '{ "version": 2, "id": "acme", "bogus": true }\n');
      edit(
        COMPONENT,
        '  </extension>',
        '    <app id="acme" src="apps/app.json" />\n  </extension>',
      );
    },
    2,
    'the app "acme" that OSGI-INF/acme-config-config.xml contributes, of an app definition',
    none,
  );
  refused(
    'a layout of version 2 outside agentic-ui-config/, with no app.json',
    first,
    ({ edit, write }) => {
      write('bundle/elsewhere/view.json', '{ "version": 2, "cards": [] }\n');
      edit(
        COMPONENT,
        '  </extension>',
        '    <layout type="File" mode="view" src="elsewhere/view.json" />\n  </extension>',
      );
    },
    2,
    'bundle/elsewhere/view.json, a layout of version 2',
    none,
  );
  refused(
    'a manifest that is a folder, in a package with no app.json',
    first,
    ({ directory }) => {
      const manifest = join(directory, 'bundle', 'META-INF', 'MANIFEST.MF');
      rmSync(manifest);
      mkdirSync(manifest);
    },
    2,
    'bundle/META-INF/MANIFEST.MF is not a file',
    none,
  );
  // What the builder refuses, through the tool: the configuration builder's checks run.
  refused(
    'a Layer 1 fragment repeating a key, which the builder refuses',
    first,
    ({ write }) => write(MANIFEST, '{ "version": 1, "version": 1 }\n'),
    4,
    'build.mjs refused the package',
    none,
  );
  // A symbolic link, which no step follows.
  refused(
    'a symbolic link in the package',
    first,
    ({ directory }) =>
      symlinkSync(
        join(directory, MANIFEST),
        join(directory, 'bundle', 'agentic-ui-config', 'linked.json'),
      ),
    1,
    'is a symbolic link, which is not followed',
    none,
  );

  // A name Satori uses, refused by create before anything is written.
  const reserved = join(scratch, 'reserved');
  const named = node([satori, 'create', reserved, '--name', 'defaults', '--owner', 'acme']);
  if (
    named.status !== 1 ||
    !named.output.includes('"defaults" is a name Satori itself uses') ||
    existsSync(reserved)
  )
    fail(
      'satori create --name defaults',
      `exit ${named.status}, the folder ${existsSync(reserved) ? 'written' : 'not written'}`,
      named.output,
    );
  else held++;
  const occupied = node([satori, 'create', scaffold, '--name', 'other', '--owner', 'acme']);
  if (occupied.status !== 1 || !occupied.output.includes('is not empty'))
    fail(
      'satori create into a folder that is not empty',
      `exit ${occupied.status}`,
      occupied.output,
    );
  else held++;

  // The command's own errors.
  for (const [what, args, says] of [
    ['validate with --out', ['validate', first, '--out', join(scratch, 'x')]],
    [
      '--previous-platform',
      ['build', PAYERS, '--previous', PAYERS, '--previous-platform', REPO],
      '--previous-platform reads the platform',
    ],
    ['no command', []],
    ['upgrade-check with no --previous', ['upgrade-check', first]],
    ['model pull with no --out', ['model', 'pull', '--server', 'https://nuxeo.example/nuxeo']],
  ]) {
    const run = node([satori, ...args]);
    if (run.status !== 2) fail(what, `exit ${run.status}, not 2`, run.output);
    else if (says !== undefined && !run.output.includes(says))
      fail(what, `no "${says}"`, run.output);
    else held++;
  }

  // A --model that cannot be read is the command's error, exit 2, whether or not the package has
  // an app.json: only an app definition's step 2 reads the model, so unless the pipeline reads it
  // first, a package that is configuration alone passes, given a file that is not there, and says
  // nothing.
  const noModel = join(scratch, 'no-such-file.json');
  const brokenModel = join(scratch, 'broken-model.json');
  writeFileSync(brokenModel, '{ "doctypes": ');
  const modelOut = join(scratch, 'model-out');
  const builtFirst = node([satori, 'build', first, '--out', modelOut]);
  const earlierZip = join(modelOut, 'acme-config-1.0.0.zip');
  if (builtFirst.status !== 0 || !existsSync(earlierZip))
    fail(
      'satori build of the scaffold, before a --model',
      `exit ${builtFirst.status}`,
      builtFirst.output,
    );
  for (const [what, args, says] of [
    [
      'validate, a package with no app.json, --model naming no file',
      [satori, 'validate', first, '--model', noModel],
      `--model ${noModel} names no file`,
    ],
    [
      'validate, a package with no app.json, --model a file that is not JSON',
      [satori, 'validate', first, '--model', brokenModel],
      `--model ${brokenModel} cannot be read as a content model`,
    ],
    [
      'validate, a package with no app.json, --model a folder',
      [satori, 'validate', first, '--model', scratch],
      `--model ${scratch} is not a file`,
    ],
    [
      'build, a package with no app.json, --model naming no file',
      [satori, 'build', first, '--out', modelOut, '--model', noModel],
      `--model ${noModel} names no file`,
    ],
    [
      'validate, an app definition, --model naming no file',
      [satori, 'validate', PAYERS, ...withAllowList(PAYERS), '--model', noModel],
      `--model ${noModel} names no file`,
    ],
    // The pipeline's own command, which is the same module: there it stopped at step 2 instead,
    // with exit 1, for the app.json app-package.mjs requires.
    [
      'app-package.mjs, a package with no app.json, --model naming no file',
      [PIPELINE, first, '--out', join(scratch, 'model-pipeline-out'), '--model', noModel],
      `--model ${noModel} names no file`,
    ],
  ]) {
    const run = node(args);
    if (run.status !== 2) fail(what, `exit ${run.status}, not 2`, run.output);
    else if (!run.output.includes(says)) fail(what, `no "${says}"`, run.output);
    else held++;
  }
  // As a model --model-server cannot read: an earlier run's zip is removed first, so a wrong
  // command leaves nothing installable behind.
  if (builtFirst.status === 0) {
    if (existsSync(earlierZip))
      fail(
        'satori build with --model naming no file',
        `it left ${earlierZip}, an earlier run's zip`,
      );
    else held++;
  }

  // What passes: the scaffold, as it is and mixing every layer; an old build.mjs, not run.
  const sound = passes(
    'the scaffold',
    first,
    () => undefined,
    'No app definition: bundle/agentic-ui-config/ has no app.json',
  );
  if (existsSync(join(sound, 'dist'))) fail('satori validate', 'it wrote into the package');
  passes(
    'a package of Layer 0, Layer 1, a version 1 layout and an app definition',
    first,
    ({ edit, write }) => {
      write(
        'bundle/agentic-ui-config/app.json',
        `${JSON.stringify({ version: 2, id: 'acme', labelKey: 'acme.app', packageVersion: '1.0.0', platform: `>=${PLATFORM} <1.0.0`, address: 'acme', groups: ['members'] }, null, 2)}\n`,
      );
      write(
        'bundle/agentic-ui-config/navigation.json',
        '{ "version": 2, "entries": [{ "id": "home", "labelKey": "acme.nav.home", "icon": "home", "page": "home" }] }\n',
      );
      write(
        'bundle/agentic-ui-config/labels/en.json',
        '{ "version": 2, "labels": { "acme.app": "Acme", "acme.nav.home": "Home" } }\n',
      );
      write(
        'bundle/agentic-ui-config/layouts/File/metadata.layout.json',
        '{ "version": 1, "display": "sections", "sections": [{ "id": "main", "label": "Main", "fields": ["dc:title"] }] }\n',
      );
      edit(
        COMPONENT,
        '  </extension>',
        '    <layout type="File" mode="metadata" src="agentic-ui-config/layouts/File/metadata.layout.json" />\n' +
          '    <app id="acme" src="agentic-ui-config/app.json">\n      <file path="navigation.json" />\n      <file path="labels/en.json" />\n    </app>\n  </extension>',
      );
    },
    '1 in version 1, which this does not check',
  );
  // A build.mjs that would fail if it ran, so that the tool is seen not to run it.
  passes(
    "a package whose build.mjs is not the tool's, and is not run",
    first,
    ({ edit }) => edit('build.mjs', '#!/usr/bin/env node', '#!/usr/bin/env node\nprocess.exit(3);'),
    'note: build.mjs is not the builder this tool carries',
  );
  passes(
    'a package whose build.mjs is a folder',
    first,
    ({ directory }) => {
      rmSync(join(directory, 'build.mjs'));
      mkdirSync(join(directory, 'build.mjs'));
    },
    'note: build.mjs is not the builder this tool carries',
  );
  // A version 1 package may name its bodies as it likes: a manifest called navigation.json.
  passes(
    'a Layer 1 fragment whose body is called navigation.json',
    first,
    ({ directory, edit }) => {
      const config = join(directory, 'bundle', 'agentic-ui-config');
      writeFileSync(join(config, 'navigation.json'), readFileSync(join(config, 'manifest.json')));
      rmSync(join(config, 'manifest.json'));
      edit(
        COMPONENT,
        'src="agentic-ui-config/manifest.json"',
        'src="agentic-ui-config/navigation.json"',
      );
    },
    'No app definition',
  );
  passes(
    'a configuration package given --kits, which compares only app definitions',
    first,
    () => undefined,
    'it was compared with nothing',
    () => ['--kits', join(scaffold, 'config-packages')],
  );

  // A refusal is the pipeline's and the tool's alike: the same exit code and the same words.
  for (const [what, change] of [
    [
      'a widget the platform does not have',
      ({ edit }) => edit(LAYOUT, '"widget": "document-link"', '"widget": "calendar"'),
    ],
    [
      'a property the type does not have',
      ({ edit }) => edit(LAYOUT, '"claim:number",', '"claim:numbr",'),
    ],
    [
      "app.json's version not package.xml's",
      ({ edit }) =>
        edit('bundle/agentic-ui-config/app.json', '"packageVersion": "', '"packageVersion": "9.'),
    ],
  ]) {
    const directory = changed(PAYERS, change);
    const [pipeline, ours] = [
      node([PIPELINE, directory, '--out', join(directory, '..', 'p'), ...withAllowList(directory)]),
      node([
        satori,
        'build',
        directory,
        '--out',
        join(directory, '..', 't'),
        ...withAllowList(directory),
      ]),
    ];
    const refusal = (run) => run.output.split('\n').find((line) => line.includes(' refused it: '));
    if (
      pipeline.status !== 1 ||
      ours.status !== pipeline.status ||
      refusal(ours) !== refusal(pipeline)
    )
      fail(
        `${what}, through both`,
        `app-package.mjs exited ${pipeline.status}, the tool ${ours.status}`,
        `${refusal(pipeline)}\n${refusal(ours)}`,
      );
    else held++;
  }

  // The upgrade check: against a folder and a zip of the kit as it is, and a queue removed.
  const payersZip = join(scratch, 'payers-zip');
  const builtPayers = buildWith(satori, PAYERS, payersZip, ['build']);
  const zip = join(
    payersZip,
    readdirSync(payersZip).find((name) => name.endsWith('.zip')) ?? 'none.zip',
  );
  for (const [what, previous] of [
    ['the kit held to itself, a folder', PAYERS],
    ['the kit held to its own zip', zip],
  ]) {
    const run = node([satori, 'upgrade-check', PAYERS, '--previous', previous]);
    if (
      builtPayers.status !== 0 ||
      run.status !== 0 ||
      !run.output.includes('every configuration is kept')
    )
      fail(`satori upgrade-check, ${what}`, `exit ${run.status}`, run.output);
    else held++;
  }
  const withoutQueue = changed(PAYERS, ({ directory }) => {
    const queues = join(directory, 'bundle', 'agentic-ui-config', 'queues');
    rmSync(join(queues, readdirSync(queues).sort()[0]));
  });
  const lost = node([satori, 'upgrade-check', withoutQueue, '--previous', zip]);
  if (lost.status !== 1 || !lost.output.includes('kit, queue '))
    fail(
      'satori upgrade-check, a queue removed at the same version',
      `exit ${lost.status}`,
      lost.output,
    );
  else held++;
  const held2 = node([
    satori,
    'build',
    PAYERS,
    '--out',
    join(scratch, 'held'),
    '--previous',
    zip,
    ...withAllowList(PAYERS),
  ]);
  if (held2.status !== 0)
    fail('satori build --previous <zip>', `exit ${held2.status}`, held2.output);
  else held++;
  // A body a src names, not called .json, is packaged compact: held to its own zip, no change.
  const body = changed(PAYERS, ({ directory, write }) => {
    write('bundle/fragments/payers.manifest', '{\n  "version": 1,\n  "labels": {}\n}\n');
    const component = join(directory, 'bundle', 'OSGI-INF', 'payers-claims-demo-config.xml');
    const text = readFileSync(component, 'utf8');
    const extension = '<extension target="org.nuxeo.agentic.ui.config" point="configuration">';
    if (!text.includes(extension)) throw new Error(`${component} has no ${extension}`);
    writeFileSync(
      component,
      text.replace(
        extension,
        `${extension}\n    <fragment name="payers-claims-demo" layer="manifest" src="fragments/payers.manifest" />`,
      ),
    );
  });
  const bodyZip = join(scratch, 'named-zip');
  const bodyBuilt = node([satori, 'build', body, '--out', bodyZip, ...withAllowList(body)]);
  const bodyHeld = node([
    satori,
    'build',
    body,
    '--out',
    join(scratch, 'named-held'),
    '--previous',
    join(bodyZip, readdirSync(bodyZip).find((name) => name.endsWith('.zip')) ?? 'none.zip'),
    ...withAllowList(body),
  ]);
  if (bodyBuilt.status !== 0 || bodyHeld.status !== 0)
    fail(
      'a fragment body not called .json, held to its own zip',
      `built ${bodyBuilt.status}, held ${bodyHeld.status}`,
      bodyBuilt.output + bodyHeld.output,
    );
  else held++;
  // A check that cannot be made exits 2, never 1, which would read as "not kept".
  if (process.platform !== 'win32') {
    const unreadable = changed(PAYERS, () => undefined);
    const locked = join(unreadable, 'bundle', 'schemas');
    chmodSync(locked, 0);
    try {
      const run = node([satori, 'upgrade-check', unreadable, '--previous', PAYERS]);
      if (run.status !== 2)
        fail(
          'satori upgrade-check of a package it cannot read',
          `exit ${run.status}, not 2`,
          run.output,
        );
      else held++;
    } finally {
      chmodSync(locked, 0o755);
    }
  }
}

/**
 * `satori model pull` against a stand-in Nuxeo: the credentials arrive in the Authorization header
 * of every read, the file is the model the server answered, and an address carrying credentials is
 * refused before anything is read. `--out`'s folder is made when it is not there, as
 * customer-config-repository.md's `--out tmp/content-model.json` needs in a repository `create`
 * wrote, which has no `tmp/`: there, under Node's permission model, as `confined` runs it; and an
 * `--out` the permission model does not allow is refused before the server is asked. A file that
 * cannot be written once the model is read is said as that, not as a model not read.
 */
async function modelPull(satori, confined) {
  const user = 'selftest-user';
  const secret = `selftest-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12)}`;
  const expected = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  // What the stand-in answers: the Payers kit's model, as a server with the kit installed answers it.
  const model = JSON.parse(readFileSync(join(PAYERS, 'content-model.json'), 'utf8'));
  const unauthorised = [];
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    if (request.headers.authorization !== expected) unauthorised.push(request.url);
    const path = new URL(request.url, 'http://localhost').pathname;
    const schema = /^\/nuxeo\/api\/v1\/config\/schemas\/([^/]+)$/.exec(path);
    const answer =
      path === '/nuxeo/api/v1/config/types'
        ? { doctypes: model.doctypes }
        : path === '/nuxeo/api/v1/config/facets'
          ? model.facets
          : path === '/nuxeo/api/v1/config/schemas'
            ? model.schemas.map(({ name, prefix }) => ({ name, prefix }))
            : schema !== null
              ? model.schemas.find(({ name }) => name === decodeURIComponent(schema[1]))
              : undefined;
    response.writeHead(answer === undefined ? 404 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer ?? {}));
  });
  await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
  try {
    const { port } = server.address();
    const out = join(scratch, 'pulled-model.json');
    const env = { ...process.env, NUXEO_USER: user, NUXEO_PASS: secret };
    const pulled = await nodeAsync(
      [satori, 'model', 'pull', '--server', `http://127.0.0.1:${port}/nuxeo`, '--out', out],
      { env },
    );
    if (pulled.status !== 0 || !existsSync(out))
      fail('satori model pull', `exit ${pulled.status}`, pulled.output);
    else if (unauthorised.length > 0)
      fail('satori model pull', `read without the credentials: ${unauthorised.join(', ')}`);
    else if (readFileSync(out, 'utf8').includes(secret))
      fail('satori model pull', 'the file holds the password');
    else if (
      JSON.stringify(JSON.parse(readFileSync(out, 'utf8')).doctypes) !==
      JSON.stringify(model.doctypes)
    )
      fail('satori model pull', 'the file is not the model the server answered');
    else held++;
    const carried = await nodeAsync(
      [
        satori,
        'model',
        'pull',
        '--server',
        `http://${user}:${secret}@127.0.0.1:${port}/nuxeo`,
        '--out',
        join(scratch, 'refused.json'),
      ],
      { env },
    );
    if (
      carried.status !== 2 ||
      carried.output.includes(secret) ||
      existsSync(join(scratch, 'refused.json'))
    )
      fail(
        'satori model pull, an address carrying credentials',
        `exit ${carried.status}`,
        carried.output.replaceAll(secret, '<secret>'),
      );
    else held++;
    const address = `http://127.0.0.1:${port}/nuxeo`;
    // --out in folders that are not there: they are made, as build makes its --out.
    const deep = join(scratch, 'pulled', 'tmp', 'content-model.json');
    const into = await nodeAsync([satori, 'model', 'pull', '--server', address, '--out', deep], {
      env,
    });
    if (into.status !== 0 || !existsSync(deep))
      fail(
        'satori model pull, --out in a folder that is not there',
        `exit ${into.status}`,
        into.output,
      );
    else held++;
    // A file that cannot be written once the model is read, its folder a file: said as that, and
    // as the command's error, not as a model the server did not give.
    const blocked = join(out, 'content-model.json');
    const unwritten = await nodeAsync(
      [satori, 'model', 'pull', '--server', address, '--out', blocked],
      { env },
    );
    if (
      unwritten.status !== 2 ||
      !unwritten.output.includes(`was read, and could not be written to ${blocked}`) ||
      unwritten.output.includes('was not read')
    )
      fail(
        'satori model pull, an --out that cannot be written',
        `exit ${unwritten.status}, not 2 saying the model was read and not written`,
        unwritten.output,
      );
    else held++;
    // In a repository create has just written, which has no tmp/: not the scaffold of section 2,
    // to which the MCP server's run has given a tmp/ of its own.
    const repository = confined && join(confined.outside, 'acme-model-pull');
    const created =
      confined &&
      (await nodeAsync(
        [confined.bin, 'create', repository, '--name', 'acme-config', '--owner', 'acme'],
        { cwd: confined.outside, env: confined.env },
      ));
    if (confined !== undefined && (created.status !== 0 || existsSync(join(repository, 'tmp'))))
      fail(
        'satori create, for model pull as section 3 gives it',
        `exit ${created.status}, or it wrote a tmp/, so the run below would not show model pull makes one`,
        created.output,
      );
    else if (confined !== undefined) {
      const { bin } = confined;
      // Node 25's permission model allows no network without --allow-net, which Node 24 has not.
      const net = process.allowedNodeEnvironmentFlags.has('--allow-net') ? ' --allow-net' : '';
      const confinedEnv = {
        ...confined.env,
        NODE_OPTIONS: `${confined.env.NODE_OPTIONS}${net}`,
        NUXEO_USER: user,
        NUXEO_PASS: secret,
      };
      // Word for word as customer-config-repository.md, section 3, gives it.
      const documented = await nodeAsync(
        [bin, 'model', 'pull', '--server', address, '--out', 'tmp/content-model.json'],
        { cwd: repository, env: confinedEnv },
      );
      const file = join(repository, 'tmp', 'content-model.json');
      if (
        documented.status !== 0 ||
        !existsSync(file) ||
        JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).doctypes) !==
          JSON.stringify(model.doctypes)
      )
        fail(
          'satori model pull --out tmp/content-model.json, in a repository create wrote, under the permission model',
          `exit ${documented.status}`,
          documented.output.replaceAll(secret, '<secret>'),
        );
      else held++;
      // And what the file is for: validate takes it, as section 3 says.
      const withModel = await nodeAsync(
        [
          bin,
          'validate',
          'config-packages/acme-config',
          '--tmp',
          'tmp',
          '--model',
          'tmp/content-model.json',
        ],
        { cwd: repository, env: confined.env },
      );
      if (withModel.status !== 0)
        fail(
          'satori validate --model tmp/content-model.json, under the permission model',
          `exit ${withModel.status}`,
          withModel.output,
        );
      else held++;
      rmSync(join(repository, 'tmp'), { recursive: true, force: true });
      // Outside the folder the permission model allows: refused before the server is asked, and
      // its folder not made.
      const forbidden = join(scratch, 'model-not-allowed', 'content-model.json');
      const asked = requests;
      const refused = await nodeAsync(
        [bin, 'model', 'pull', '--server', address, '--out', forbidden],
        { cwd: repository, env: confinedEnv },
      );
      if (
        refused.status !== 2 ||
        !refused.output.includes("Node's permission model does not let it write") ||
        existsSync(dirname(forbidden)) ||
        requests !== asked
      )
        fail(
          'satori model pull into a folder the permission model does not allow',
          `exit ${refused.status}, ${requests - asked} request(s) to the server, the folder ${existsSync(dirname(forbidden)) ? 'made' : 'not made'}`,
          refused.output.replaceAll(secret, '<secret>'),
        );
      else held++;
    }
  } finally {
    await new Promise((closed) => server.close(closed));
  }
}

// --- 4. The names Satori uses ---------------------------------------------------------------------

function reservedNames() {
  const generator = join(REPO, 'tools', 'satori-generators', 'src', 'config-package');
  for (const file of ['generator.ts', 'create.mjs']) {
    const text = readFileSync(join(generator, file), 'utf8');
    const block = /SATORI_NAMES = new Map\(\[([\s\S]*?)\]\);/.exec(text)?.[1] ?? '';
    const names = [...block.matchAll(/\[\s*'([^']+)',\s*'([^']+)',?\s*\]/g)].map(
      ([, name, why]) => [name, why],
    );
    const ours = [...SATORI_NAMES];
    if (JSON.stringify(names) !== JSON.stringify(ours))
      fail(
        `the names Satori uses, against ${file}`,
        `${file} has ${JSON.stringify(names)}, and configuration.mjs ${JSON.stringify(ours)}`,
      );
    else held++;
  }
}

// --- 5. agents sync ------------------------------------------------------------------------------

/** Why the agent files in `repository` hold a secret, or a value that is not a reference. */
function secretProblems(repository, secrets) {
  const problems = [];
  for (const file of AGENT_FILES) {
    const path = join(repository, ...file.split('/'));
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const secret of secrets)
      if (text.includes(secret)) problems.push(`${file} holds a value of the environment`);
    if (!file.endsWith('mcp.json')) continue;
    const entry = JSON.parse(text).mcpServers?.['nuxeo-satori'];
    for (const [key, value] of Object.entries(entry?.env ?? {}))
      if (!REFERENCE.test(value) || !value.includes(key))
        problems.push(`${file}: ${key} is ${JSON.stringify(value)}, not a reference to ${key}`);
  }
  return problems;
}

function agentsSync(satori, tool) {
  const version = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;
  const repository = join(scratch, 'agents');
  mkdirSync(repository);
  // Credentials and an address in the environment, made for this run: none may be written.
  const secrets = [
    `selftest-user-${randomBytes(6).toString('hex')}`,
    `selftest-${randomBytes(12).toString('hex')}`,
    `https://nuxeo-${randomBytes(4).toString('hex')}.example`,
  ];
  const env = {
    ...process.env,
    NUXEO_USER: secrets[0],
    NUXEO_PASS: secrets[1],
    NUXEO_URL: secrets[2],
  };
  const sync = (...args) => node([satori, 'agents', 'sync', ...args], { cwd: repository, env });

  const first = sync();
  const missing = AGENT_FILES.filter((file) => !existsSync(join(repository, ...file.split('/'))));
  if (first.status !== 0 || missing.length > 0)
    fail(
      'satori agents sync, in a repository with none of its files',
      `exit ${first.status}, missing ${missing.join(', ') || 'nothing'}`,
      first.output,
    );
  else held++;
  const carried = readFileSync(
    join(tool, 'agents', 'skills', 'satori-app-builder', 'SKILL.md'),
    'utf8',
  );
  const skills = AGENT_FILES.slice(0, 3).map((file) =>
    readFileSync(join(repository, ...file.split('/')), 'utf8'),
  );
  if (
    new Set(skills).size !== 1 ||
    !skills[0].startsWith(carried.slice(0, carried.indexOf('\n---\n') + 5)) ||
    !skills[0].includes(carried.slice(carried.indexOf('\n---\n') + 5)) ||
    !skills[0].includes(`@nuxeo/satori-cli ${version}`)
  )
    fail(
      'the skill agents sync installs',
      "the three copies are not the carried skill, with the version's line",
    );
  else held++;
  const server = JSON.parse(readFileSync(join(repository, '.mcp.json'), 'utf8')).mcpServers?.[
    'nuxeo-satori'
  ];
  if (server?.command !== 'node_modules/.bin/satori' || JSON.stringify(server.args) !== '["mcp"]')
    fail(
      '.mcp.json',
      `the server is ${JSON.stringify(server)}, not satori mcp from node_modules/.bin`,
    );
  else held++;

  // No value of the environment, and every one a reference; the control: a planted one is seen.
  const leaked = secretProblems(repository, secrets);
  if (leaked.length > 0) fail('agents sync and the environment', leaked.join('; '));
  else held++;
  const planted = join(scratch, 'agents-planted');
  cpSync(repository, planted, { recursive: true });
  const mcp = JSON.parse(readFileSync(join(planted, '.mcp.json'), 'utf8'));
  mcp.mcpServers['nuxeo-satori'].env.NUXEO_PASS = secrets[1];
  writeFileSync(join(planted, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);
  if (secretProblems(planted, secrets).length < 2)
    fail('the control on the secrets', 'a password planted in .mcp.json was not seen');
  else held++;

  // Idempotent: run again, nothing is written, and no file is touched.
  const past = new Date(Date.UTC(2020, 0, 1));
  for (const file of AGENT_FILES) utimesSync(join(repository, ...file.split('/')), past, past);
  const before = fingerprint(repository);
  const again = sync();
  const touched = AGENT_FILES.filter(
    (file) => statSync(join(repository, ...file.split('/'))).mtimeMs !== past.getTime(),
  );
  if (
    again.status !== 0 ||
    !again.output.includes('nothing was written') ||
    touched.length > 0 ||
    JSON.stringify(fingerprint(repository)) !== JSON.stringify(before)
  )
    fail(
      'satori agents sync, run again',
      `exit ${again.status}, touched ${touched.join(', ') || 'nothing'}`,
      again.output,
    );
  else held++;
  const inStep = sync('--check');
  if (inStep.status !== 0)
    fail('satori agents sync --check, in step', `exit ${inStep.status}`, inStep.output);
  else held++;

  // A customer's own text and servers, kept; the tool's section and entry, put back.
  const agents = join(repository, 'AGENTS.md');
  const ours = readFileSync(agents, 'utf8');
  const start = ours.indexOf(SECTION_BEGIN);
  const end = ours.indexOf(SECTION_END) + SECTION_END.length;
  const prefix = `# Acme's own rules\r\n\r\nNever name a customer.\n\n`;
  const suffix = `\n## Acme's appendix\n\nKept as written.   \n`;
  writeFileSync(
    agents,
    `${prefix}${ours.slice(start, end).replace('## Nuxeo Satori: rules', '## Rules, edited')}${suffix}`,
  );
  // The entry edited, and nothing else, in the file as the tool laid it out.
  const mcpFile = join(repository, '.mcp.json');
  const laidOut = readFileSync(mcpFile, 'utf8');
  if (!laidOut.includes('"command": "node_modules/.bin/satori"'))
    fail('the control on the entry', "the tool's .mcp.json no longer has its command as expected");
  writeFileSync(
    mcpFile,
    laidOut.replace('"command": "node_modules/.bin/satori"', '"command": "npx"'),
  );
  const drifted = sync('--check');
  if (
    drifted.status !== 1 ||
    !drifted.output.includes('AGENTS.md') ||
    !drifted.output.includes('.mcp.json') ||
    drifted.output.includes('.cursor/mcp.json')
  )
    fail(
      'satori agents sync --check, with the section and the entry edited',
      `exit ${drifted.status}`,
      drifted.output,
    );
  else held++;
  const restored = sync();
  const text = readFileSync(agents, 'utf8');
  if (
    restored.status !== 0 ||
    !text.startsWith(prefix) ||
    !text.endsWith(suffix) ||
    text.slice(prefix.length, text.length - suffix.length) !== ours.slice(start, end) ||
    readFileSync(mcpFile, 'utf8') !== laidOut
  )
    fail(
      "satori agents sync, with a customer's own text and servers",
      "what is outside the section, or the other servers, was not kept, or what is the tool's was not put back",
      `${restored.output}\n${text.slice(0, 300)}`,
    );
  else held++;
  // The control on it: text planted inside the section is not kept.
  if (text.includes('## Rules, edited'))
    fail('the control on the section', 'an edit inside the section survived the sync');
  else held++;

  // A customer's own servers and keys, in their own layout, with the entry as this version
  // writes it: in step, and not written.
  const entry = JSON.parse(laidOut).mcpServers['nuxeo-satori'];
  const theirs = JSON.stringify({
    acmeSetting: { kept: true },
    mcpServers: { acme: { command: 'acme-mcp', args: ['--stdio'] }, 'nuxeo-satori': entry },
  });
  writeFileSync(mcpFile, theirs);
  const theirsChecked = sync('--check');
  const theirsSynced = sync();
  if (
    theirsChecked.status !== 0 ||
    theirsSynced.status !== 0 ||
    readFileSync(mcpFile, 'utf8') !== theirs
  )
    fail(
      "satori agents sync, a customer's own layout with this version's entry",
      `--check exit ${theirsChecked.status}, or the file was written again`,
      theirsChecked.output + theirsSynced.output,
    );
  else held++;
  // With a stale entry, the entry is put back, and their servers and keys kept.
  writeFileSync(mcpFile, theirs.replace('"command":"node_modules/.bin/satori"', '"command":"npx"'));
  const refreshed = sync();
  const kept = JSON.parse(readFileSync(mcpFile, 'utf8'));
  if (
    refreshed.status !== 0 ||
    kept.acmeSetting?.kept !== true ||
    JSON.stringify(kept.mcpServers.acme) !==
      JSON.stringify({ command: 'acme-mcp', args: ['--stdio'] }) ||
    JSON.stringify(kept.mcpServers['nuxeo-satori']) !== JSON.stringify(entry)
  )
    fail(
      "satori agents sync, a customer's file with a stale entry",
      'their servers were not kept, or the entry not put back',
      refreshed.output,
    );
  else held++;

  // Refused, with nothing written: a marker repeated, an MCP file that is not JSON, a link.
  let refusedCount = 0;
  const refusedWith = (what, change, says) => {
    const folder = join(scratch, `agents-refused-${++refusedCount}`);
    mkdirSync(folder);
    change(folder);
    const was = fingerprint(folder);
    const run = node([satori, 'agents', 'sync'], { cwd: folder, env });
    if (
      run.status !== 1 ||
      !run.output.includes(says) ||
      JSON.stringify(fingerprint(folder)) !== JSON.stringify(was)
    )
      fail(
        `satori agents sync, ${what}`,
        `exit ${run.status}, or something was written`,
        run.output,
      );
    else held++;
  };
  refusedWith(
    'with its section begun twice',
    (folder) =>
      writeFileSync(
        join(folder, 'AGENTS.md'),
        `${SECTION_BEGIN} -->\n${SECTION_BEGIN} -->\n${SECTION_END}\n`,
      ),
    'its satori section is not one',
  );
  refusedWith(
    'with a .mcp.json that is not JSON',
    (folder) => writeFileSync(join(folder, '.mcp.json'), '{ "mcpServers": { // a comment\n'),
    'it is not JSON',
  );
  refusedWith(
    'with a .mcp.json that JSON would not give back, a key given twice',
    (folder) =>
      writeFileSync(
        join(folder, '.mcp.json'),
        '{ "mcpServers": { "acme": { "command": "acme" } }, "mcpServers": { "other": { "command": "other" } } }\n',
      ),
    'JSON would not give it back as it is',
  );
  refusedWith(
    'with .claude a link to a folder elsewhere',
    (folder) => {
      const elsewhere = join(scratch, 'agents-elsewhere');
      mkdirSync(elsewhere, { recursive: true });
      symlinkSync(elsewhere, join(folder, '.claude'));
    },
    '.claude is a link, which is not followed',
  );
  if (existsSync(join(scratch, 'agents-elsewhere', 'skills')))
    fail('satori agents sync, with .claude a link', 'it wrote through the link');
}

/** Every file under `directory`, by its path, with its SHA-256. */
function fingerprint(directory) {
  const found = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        found[relative(directory, path).split(sep).join('/')] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
      else found[relative(directory, path).split(sep).join('/')] = 'link';
    }
  };
  walk(directory);
  return found;
}

// --- 6. The MCP server outside the repository ------------------------------------------------------

/** The tools the repository's own server lists, as `node tools/builder-mcp/src/main.ts` runs. */
async function repositoryTools() {
  const session = mcpSession([join(REPO, 'tools', 'builder-mcp', 'src', 'main.ts')], {
    cwd: REPO,
    env: { PATH: process.env.PATH ?? '', TMPDIR: tmpdir() },
  });
  try {
    await session.open();
    const listed = await session.request('tools/list');
    return listed.result?.tools ?? [];
  } finally {
    await session.close();
  }
}

/**
 * `satori mcp` from the tarball, in the scaffold, under Node's permission model given on its
 * command line: Node gives it to every Node process the server starts, the pipeline's and the
 * generators', which it would not from `NODE_OPTIONS`, a variable the server does not pass on.
 */
async function mcpOutside(outside, bin, repository, tools) {
  const confinement = [
    '--permission',
    `--allow-fs-read=${outside}`,
    `--allow-fs-write=${outside}`,
    '--allow-child-process',
  ];
  // No TMPDIR of the folder's: the server is given --tmp, and passes it on to what it starts.
  const env = { PATH: process.env.PATH ?? '' };
  // The control on the confinement: what a confined process starts, with no environment, is confined.
  const probe = node(
    [
      ...confinement,
      '-e',
      `const r = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(`require('node:fs').readFileSync(${JSON.stringify(join(REPO, 'package.json'))})`)}], { encoding: 'utf8', env: { PATH: process.env.PATH } }); process.stdout.write(r.stderr); process.exit(r.status);`,
    ],
    { cwd: outside, env },
  );
  if (probe.status === 0 || !probe.output.includes('ERR_ACCESS_DENIED'))
    fail(
      "the control on the server's confinement",
      'a process a confined one started, with no environment, read this repository',
      probe.output,
    );
  else held++;
  // No file the tarball ships names this repository's folder, or the home folder of whoever built
  // it: what the tool reads, it carries.
  const tool = dirname(bin);
  const places = [REPO.replace(/[\\/]$/, ''), homedir()].filter((place) => place.length > 1);
  const named = Object.keys(fingerprint(tool)).filter((file) => {
    const text = readFileSync(join(tool, ...file.split('/')), 'utf8');
    return places.some((place) => text.includes(place));
  });
  if (named.length > 0) fail('the tarball', `names this machine's folders: ${named.join(', ')}`);
  else held++;

  // The scaffold as a person keeps it, a git repository, for the release check.
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'scaffold'],
  ]) {
    const ran = git(repository, ...args);
    if (ran.status !== 0) fail(`git ${args[0]} in the scaffold`, `exit ${ran.status}`, ran.stderr);
  }

  // Without --tmp, the server would have nowhere to work, and refuses to start, saying so.
  const unplaced = node([...confinement, bin, 'mcp'], {
    cwd: repository,
    env,
    input: '',
    timeout: 60_000,
  });
  if (unplaced.status !== 2 || !unplaced.output.includes('Give --tmp <directory>'))
    fail(
      'satori mcp with no --tmp, under the permission model',
      `exit ${unplaced.status}, not 2 naming --tmp`,
      unplaced.output,
    );
  else held++;
  const session = mcpSession([...confinement, bin, 'mcp', '--tmp', join(outside, 'mcp-tmp')], {
    cwd: repository,
    env,
  });
  try {
    const opened = await session.open();
    const listed = (await session.request('tools/list')).result?.tools ?? [];
    // The same tools: names, titles, annotations and every argument, but for what their
    // descriptions say of where they run.
    if (tools.length < 18 || JSON.stringify(shapeOf(listed)) !== JSON.stringify(shapeOf(tools)))
      fail(
        "satori mcp's tools",
        `they are not the repository's server's: ${listed.map((each) => each.name).join(', ')}`,
      );
    else held++;
    // And what they say names nothing of this repository's; the control: the repository's do.
    const said = descriptionsOf({ instructions: opened?.instructions, tools: listed });
    const ours = REPOSITORY_ONLY.filter(([pattern]) => pattern.test(said)).map(([, why]) => why);
    if (ours.length > 0) fail("satori mcp's descriptions", ours.join('; '));
    else held++;
    if (!REPOSITORY_ONLY.some(([pattern]) => pattern.test(descriptionsOf({ tools }))))
      fail("the control on satori mcp's descriptions", "the repository's server's passed it");
    else held++;
    // The release check, through the server: ready, with the tag a person pushes, and no tag made.
    const release = await session.call('release_check', { package: 'config-packages/acme-config' });
    if (
      release.isError ||
      release.json?.ready !== true ||
      JSON.stringify(release.json?.commands) !==
        JSON.stringify([
          'git tag app-package/acme-config/1.0.0',
          'git push origin app-package/acme-config/1.0.0',
        ]) ||
      !String(release.json?.note).includes("Publishing is a person's step") ||
      git(repository, 'tag', '--list').stdout !== ''
    )
      fail(
        'release_check, outside the repository',
        'not ready with the tag, or a tag was made',
        release.text,
      );
    else held++;
    const valid = await session.call('validate_package', {
      package: 'config-packages/acme-config',
    });
    if (
      valid.isError ||
      valid.json?.passed !== true ||
      !String(valid.json?.command).startsWith('satori build')
    )
      fail('validate_package, outside the repository', 'the scaffold did not pass', valid.text);
    else held++;
    // A generator's write, kept: the bundled generators run confined, on the model in tmp/.
    mkdirSync(join(repository, 'tmp'), { recursive: true });
    cpSync(join(PAYERS, 'content-model.json'), join(repository, 'tmp', 'content-model.json'));
    const generated = await session.call('apply_generator', {
      package: 'config-packages/acme-claims',
      generator: 'app-package',
      options: {
        owner: 'acme',
        title: 'Acme Claims',
        groups: 'members',
        type: 'Claim',
        model: 'tmp/content-model.json',
      },
    });
    if (
      generated.isError ||
      generated.json?.written !== true ||
      !existsSync(
        join(
          repository,
          'config-packages',
          'acme-claims',
          'bundle',
          'agentic-ui-config',
          'layouts',
          'Claim',
          'view.layout.json',
        ),
      )
    )
      fail(
        'apply_generator app-package, outside the repository',
        'the package was not written',
        generated.text,
      );
    else held++;
    // A write with an unregistered widget, on the package just written: refused, nothing changed.
    const pkg = join(repository, 'config-packages', 'acme-claims');
    const was = existsSync(pkg) ? fingerprint(pkg) : {};
    const refused = await session.call('write_package_file', {
      package: 'config-packages/acme-claims',
      path: 'bundle/agentic-ui-config/layouts/Claim/view.layout.json',
      content: `${JSON.stringify({ version: 2, cards: [{ id: 'main', labelKey: 'acme.card.main', fields: [{ field: 'dc:title', widget: 'calendar' }] }] })}\n`,
    });
    if (
      refused.isError ||
      refused.json?.written !== false ||
      refused.json?.validation?.refusedAt?.step !== 2 ||
      !refused.text.includes('the widget \\"calendar\\" is not registered') ||
      !existsSync(pkg) ||
      JSON.stringify(fingerprint(pkg)) !== JSON.stringify(was)
    )
      fail(
        'a write with an unregistered widget, outside the repository',
        'not refused at step 2 with the package unchanged',
        refused.text,
      );
    else held++;
    const preview = await session.call('preview_package', {
      package: 'config-packages/acme-config',
    });
    if (!preview.isError || !preview.text.includes('does not run from @nuxeo/satori-cli'))
      fail('preview_package, outside the repository', 'it did not refuse', preview.text);
    else held++;
  } catch (error) {
    fail('satori mcp, outside the repository', error.message, session.stderr());
  } finally {
    await session.close();
  }
  rmSync(join(repository, 'config-packages', 'acme-claims'), { recursive: true, force: true });
}

/** Tools as their schemas shape them: every description taken out, the rest as it is. */
function shapeOf(tools) {
  const strip = (value) =>
    Array.isArray(value)
      ? value.map(strip)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== 'description')
              .map(([key, inner]) => [key, strip(inner)]),
          )
        : value;
  return strip(tools);
}

/** Every description a server gives, its instructions' and each tool's and argument's, as one text. */
function descriptionsOf(value) {
  if (Array.isArray(value)) return value.map(descriptionsOf).join('\n');
  if (value === null || typeof value !== 'object') return '';
  return Object.entries(value)
    .map(([key, inner]) =>
      typeof inner === 'string'
        ? ['description', 'instructions', 'title'].includes(key)
          ? inner
          : ''
        : descriptionsOf(inner),
    )
    .filter((text) => text !== '')
    .join('\n');
}

/** git in `cwd`, as a person with no configuration of their own runs it, and nothing signed. */
function git(cwd, ...args) {
  return spawnSync(
    'git',
    [
      '-c',
      'user.name=Satori CLI Selftest',
      '-c',
      'user.email=selftest@example.invalid',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'tag.gpgSign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

/** An MCP client over stdio, as small as it can be: JSON-RPC, one message a line. */
function mcpSession(args, options) {
  const child = spawn(process.execPath, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '';
  let stderr = '';
  let id = 0;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        stderr += `\n(stdout, not the protocol's) ${line}`;
        continue;
      }
      if (typeof message.id === 'number') pending.get(message.id)?.(message);
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const closed = new Promise((done) => child.on('close', done));
  const request = (method, params = {}) =>
    new Promise((answered, refused) => {
      const next = ++id;
      const timer = setTimeout(
        () => refused(new Error(`${method}: no answer in 4 minutes`)),
        240_000,
      );
      pending.set(next, (message) => {
        clearTimeout(timer);
        answered(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: next, method, params })}\n`);
    });
  return {
    request,
    stderr: () => stderr,
    async open() {
      const opened = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'satori-cli-selftest', version: '0' },
      });
      if (opened.error) throw new Error(`initialize: ${opened.error.message}`);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
      return opened.result;
    },
    async call(name, args) {
      const answer = await request('tools/call', { name, arguments: args });
      const text = answer.error
        ? answer.error.message
        : (answer.result?.content ?? []).map((block) => block.text).join('');
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // An error's text is a sentence.
      }
      return { isError: answer.error !== undefined || answer.result?.isError === true, text, json };
    },
    async close() {
      child.stdin.end();
      // It ends with its input; stopped only if it does not.
      const stop = setTimeout(() => child.kill(), 10_000);
      await closed;
      clearTimeout(stop);
    },
  };
}

// --- 7. One generator -----------------------------------------------------------------------------

/**
 * Every app generator, in the order a kit is made, run through the repository's runner and through
 * the bundled one on the same package, each answer the same bytes; then applied, for the next.
 */
function oneGenerator(tool) {
  const work = join(scratch, 'one-generator');
  mkdirSync(work);
  const packagePath = 'config-packages/acme-demo';
  const staging = join(work, 'staging', 'acme-demo');
  const model = join(staging, 'content-model.json');
  const repositoryRunner = join(REPO, 'tools', 'builder-mcp', 'src', 'run-generator.ts');
  const bundledRunner = join(tool, 'mcp-generator.mjs');
  const carried = join(tool, 'generators');
  // The control's root: the same, with another print width.
  const narrow = join(work, 'narrow');
  cpSync(carried, narrow, { recursive: true });
  const formatting = JSON.parse(readFileSync(join(narrow, 'formatting.json'), 'utf8'));
  for (const options of [...Object.values(formatting.byExtension), formatting.otherwise])
    options.printWidth = 40;
  writeFileSync(join(narrow, 'formatting.json'), JSON.stringify(formatting));
  const pkg = { package: packagePath };
  const steps = [
    [
      'app-package',
      {
        name: 'acme-demo',
        directory: 'config-packages',
        owner: 'acme',
        title: 'Acme Demo',
        groups: 'members',
      },
    ],
    [
      'app-model',
      {
        ...pkg,
        type: 'AcmeCase',
        schema: 'acmecase',
        prefix: 'acmecase',
        properties:
          'number,status=Open|Closed,amount:double,opened:date,party:complex{name,role=Buyer|Seller}',
      },
    ],
    [
      'app-model',
      {
        ...pkg,
        type: 'AcmeCase',
        pageProvider: 'acme_open_cases',
        where: "acmecase:status = 'Open'",
        sort: 'acmecase:opened',
        aggregates: 'acmecase:status',
      },
    ],
    ['app-layout', { ...pkg, type: 'AcmeCase', model }],
    [
      'app-form',
      { ...pkg, type: 'AcmeCase', mode: 'edit', required: 'dc:title,acmecase:number', model },
    ],
    [
      'app-queue',
      {
        ...pkg,
        id: 'open-cases',
        pageProvider: 'acme_open_cases',
        columns: 'acmecase:number,dc:title,acmecase:status',
        sort: 'acmecase:opened',
      },
    ],
    [
      'app-action',
      {
        ...pkg,
        id: 'acme-demo.close',
        transition: 'close',
        on: 'record,row',
        type: 'AcmeCase',
        confirm: 'Close this case?',
        queue: 'open-cases',
      },
    ],
    [
      'app-connector',
      {
        ...pkg,
        id: 'acme.caseSystem',
        type: 'AcmeCase',
        key: 'acmecase:number',
        path: '/cases/{key}',
        fields: 'state=/state,owner=/owner/name',
      },
    ],
    ['app-dependency', { ...pkg, name: 'nuxeo-agentic-signature', version: '0.1.0' }],
    ['app-registry', { ...pkg }],
  ];
  let count = 0;
  const run = (runner, root, generator, options) => {
    const folder = join(work, String(++count));
    const treeRoot = join(folder, 'tree');
    mkdirSync(treeRoot, { recursive: true });
    // As the server makes the tree's root: the formatting configuration the root has, and nothing else.
    for (const file of ['.prettierrc', '.editorconfig'])
      if (existsSync(join(root, file))) cpSync(join(root, file), join(treeRoot, file));
    const request = join(folder, 'request.json');
    const answer = join(folder, 'answer.json');
    writeFileSync(
      request,
      JSON.stringify({
        generator,
        factory: join(REPO, 'tools', 'satori-generators', 'src', generator, 'generator.ts'),
        options,
        root,
        treeRoot,
        packagePath,
        staging,
        answer,
      }),
    );
    const ran = node([runner, request], {
      cwd: REPO,
      env: { PATH: process.env.PATH ?? '', TMPDIR: folder },
    });
    return existsSync(answer)
      ? readFileSync(answer, 'utf8')
      : `no answer, exit ${ran.status}: ${ran.output}`;
  };
  for (const [generator, given] of steps) {
    const schema = JSON.parse(
      readFileSync(
        join(REPO, 'tools', 'satori-generators', 'src', generator, 'schema.json'),
        'utf8',
      ),
    );
    const options = { ...given };
    for (const [key, property] of Object.entries(schema.properties))
      if (options[key] === undefined && property.default !== undefined)
        options[key] = property.default;
    const ours = run(repositoryRunner, REPO, generator, options);
    const theirs = run(bundledRunner, carried, generator, options);
    let answer = null;
    try {
      answer = JSON.parse(ours);
    } catch {
      // Said below.
    }
    if (answer === null || 'error' in answer) {
      fail(
        `one generator, ${generator}`,
        "the repository's runner did not run it",
        ours.slice(0, 2000),
      );
      return;
    }
    if (ours !== theirs)
      fail(
        `one generator, ${generator}`,
        "the bundled runner's answer is not the repository's",
        `${ours.slice(0, 1500)}\n---\n${theirs.slice(0, 1500)}`,
      );
    else held++;
    if (generator === 'app-queue') {
      const other = run(bundledRunner, narrow, generator, options);
      if (other === ours)
        fail('the control on one generator', 'another print width answered the same');
      else held++;
    }
    for (const change of answer.changes) {
      if (!change.path.startsWith(`${packagePath}/`)) {
        fail(`one generator, ${generator}`, `it wrote ${change.path}, outside the package`);
        return;
      }
      const path = join(staging, ...change.path.slice(packagePath.length + 1).split('/'));
      if (change.type === 'DELETE') rmSync(path, { force: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.from(change.content, 'base64'));
      }
    }
  }
}

// --- 8. sign and verify -----------------------------------------------------------------------------

function signAndVerify(outside, bin, repository, env) {
  const zip = join(repository, 'dist', 'acme-config-1.0.0.zip');
  const commit = randomBytes(20).toString('hex');
  const satori = (args, cwd = repository) => node([bin, ...args], { cwd, env });
  const expect = (what, run, status, says) => {
    if (run.status !== status || (says !== undefined && !run.output.includes(says)))
      fail(
        what,
        `exit ${run.status}, not ${status}${says === undefined ? '' : `, with "${says}"`}`,
        run.output,
      );
    else held++;
  };
  const signers = join(outside, 'signers.json');
  const signed = satori([
    'sign',
    zip,
    '--ephemeral-key',
    '--signers-out',
    signers,
    '--commit',
    commit,
  ]);
  expect('satori sign with a key made for the run', signed, 0, 'signed by sha256:');
  expect(
    'satori verify against the signers trusted',
    satori([
      'verify',
      zip,
      '--trusted-signers',
      signers,
      '--name',
      'acme-config',
      '--version',
      '1.0.0',
    ]),
    0,
    'Verified.',
  );
  // A key the customer holds, outside the repository, signs; inside it, it is refused.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyFile = join(outside, 'keys', 'acme.pem');
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, pem, { mode: 0o600 });
  writeFileSync(join(repository, 'acme.pem'), pem, { mode: 0o600 });
  const own = join(outside, 'acme-signers.json');
  writeFileSync(
    own,
    JSON.stringify({
      signers: [
        {
          id: 'acme-release',
          kind: 'ed25519',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        },
      ],
    }),
  );
  const ownSignature = join(outside, 'own.sig.json');
  expect(
    'satori sign --key, a key held outside the repository',
    satori(['sign', zip, '--key', keyFile, '--commit', commit, '--out', ownSignature]),
    0,
  );
  expect(
    'satori verify of the signature by the key the customer holds',
    satori(['verify', zip, '--trusted-signers', own, '--signature', ownSignature]),
    0,
    'signed by acme-release',
  );
  expect(
    'satori sign --key, a key inside the repository',
    satori([
      'sign',
      zip,
      '--key',
      'acme.pem',
      '--commit',
      commit,
      '--out',
      join(outside, 'inside.sig.json'),
    ]),
    2,
    'is inside the repository',
  );
  // From another folder, the key inside the scaffold is still inside the zip's repository.
  expect(
    'satori sign --key, a key inside the repository, from another folder',
    satori(
      [
        'sign',
        zip,
        '--key',
        join(repository, 'acme.pem'),
        '--commit',
        commit,
        '--out',
        join(outside, 'inside-elsewhere.sig.json'),
      ],
      outside,
    ),
    2,
    'is inside the repository',
  );
  rmSync(join(repository, 'acme.pem'));
  // A key in another repository git keeps: one commit from being published there.
  const other = join(outside, 'other-repository');
  mkdirSync(other);
  git(other, 'init', '--quiet');
  writeFileSync(join(other, 'release.pem'), pem, { mode: 0o600 });
  expect(
    'satori sign --key, a key in another repository git keeps',
    satori(
      [
        'sign',
        zip,
        '--key',
        join(other, 'release.pem'),
        '--commit',
        commit,
        '--out',
        join(outside, 'other.sig.json'),
      ],
      outside,
    ),
    2,
    'which git keeps',
  );
  // A changed byte.
  const changed = join(outside, 'changed', basename(zip));
  mkdirSync(dirname(changed), { recursive: true });
  const bytes = readFileSync(zip);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  writeFileSync(changed, bytes);
  cpSync(`${zip}.sig.json`, `${changed}.sig.json`);
  expect(
    'satori verify, a changed byte',
    satori(['verify', changed, '--trusted-signers', signers]),
    1,
    'the zip is not the one signed',
  );
  // A signer not trusted.
  const stranger = join(outside, 'stranger', basename(zip));
  mkdirSync(dirname(stranger), { recursive: true });
  cpSync(zip, stranger);
  satori([
    'sign',
    stranger,
    '--ephemeral-key',
    '--signers-out',
    join(outside, 'stranger-signers.json'),
    '--commit',
    commit,
  ]);
  expect(
    'satori verify, a signer not trusted',
    satori(['verify', stranger, '--trusted-signers', signers]),
    1,
    "none of the trusted signers' keys",
  );
  // Another version: built at 1.0.1, renamed to it, and held to it.
  const next = join(outside, 'next', 'acme-config');
  cpSync(join(repository, 'config-packages', 'acme-config'), next, { recursive: true });
  const xml = join(next, 'package', 'package.xml');
  writeFileSync(xml, readFileSync(xml, 'utf8').replace('version="1.0.0"', 'version="1.0.1"'));
  const built = satori(['build', next, '--out', join(outside, 'next-out')]);
  const nextZip = join(outside, 'next-out', 'acme-config-1.0.1.zip');
  if (built.status !== 0 || !existsSync(nextZip))
    fail('the scaffold at 1.0.1', `exit ${built.status}`, built.output);
  else {
    expect(
      "satori verify, 1.0.1's zip with 1.0.0's signature",
      satori(['verify', nextZip, '--trusted-signers', signers, '--signature', `${zip}.sig.json`]),
      1,
      'the signature is for acme-config-1.0.0.zip',
    );
  }
  const renamed = join(outside, 'renamed', 'acme-config-1.0.1.zip');
  mkdirSync(dirname(renamed), { recursive: true });
  cpSync(zip, renamed);
  cpSync(`${zip}.sig.json`, `${renamed}.sig.json`);
  expect(
    'satori verify, 1.0.0 renamed to 1.0.1',
    satori(['verify', renamed, '--trusted-signers', signers]),
    1,
    'and the zip is named acme-config-1.0.1.zip',
  );
  expect(
    'satori verify, held to another version',
    satori(['verify', zip, '--trusted-signers', signers, '--version', '1.0.1']),
    1,
    'not 1.0.1',
  );
  // The command's own: no trusted signers, and keyless off a tag build.
  expect(
    'satori verify with no trusted signers',
    satori(['verify', zip]),
    2,
    '--trusted-signers is needed',
  );
  expect(
    'satori sign --keyless, not on a tag build',
    satori([
      'sign',
      zip,
      '--keyless',
      '--trusted-signers',
      signers,
      '--predicate-out',
      join(outside, 'predicate.json'),
    ]),
    1,
    'is not a tag app-package/<name>/<version>',
  );
  expect(
    'satori sign --keyless with a key',
    satori(['sign', zip, '--keyless', '--key', keyFile]),
    2,
    '--keyless signs in CI',
  );
}

// --- 8b. release-check --------------------------------------------------------------------------------

/**
 * `satori release-check`, on the scaffold, a git repository by now: ready, with the tag a person
 * pushes and no tag made; refused once that version is tagged, and for a package that does not
 * build; and its own errors.
 */
function releaseChecks(outside, bin, repository, env) {
  // Under the permission model, as every run of the folder is: its temporary files in --tmp.
  const place = join(outside, 'release-check-tmp');
  const satori = (args, cwd = repository) =>
    node([bin, 'release-check', ...args, '--tmp', place], { cwd, env });
  const unplaced = node([bin, 'release-check', 'config-packages/acme-config'], {
    cwd: repository,
    env,
  });
  if (unplaced.status !== 2 || !unplaced.output.includes('Give --tmp <directory>'))
    fail(
      'satori release-check with no --tmp, under the permission model',
      `exit ${unplaced.status}, not 2 naming --tmp`,
      unplaced.output,
    );
  else held++;
  const tag = 'app-package/acme-config/1.0.0';
  // As AGENTS.md gives it: the packages beside it compared by default, as the workflow compares them.
  const ready = satori(['config-packages/acme-config', '--previous', 'dist/acme-config-1.0.0.zip']);
  if (
    ready.status !== 0 ||
    !ready.output.includes(`  git tag ${tag}\n  git push origin ${tag}`) ||
    !ready.output.includes("Publishing is a person's step") ||
    !ready.output.includes('It keeps what dist/acme-config-1.0.0.zip had') ||
    git(repository, 'tag', '--list').stdout !== ''
  )
    fail(
      'satori release-check, a package ready to release',
      `exit ${ready.status}, or a tag was made`,
      ready.output,
    );
  else held++;
  // Tagged, it is released: not ready, for that reason.
  git(repository, 'tag', tag);
  const tagged = satori(['config-packages/acme-config']);
  if (
    tagged.status !== 1 ||
    !tagged.output.includes(`${tag} is a tag already`) ||
    tagged.output.includes('git push')
  )
    fail(
      'satori release-check, a version already tagged',
      `exit ${tagged.status}, not 1`,
      tagged.output,
    );
  else held++;
  // A package that does not build.
  const broken = join(outside, 'broken', 'acme-config');
  cpSync(join(repository, 'config-packages', 'acme-config'), broken, { recursive: true });
  writeFileSync(
    join(broken, 'bundle', 'agentic-ui-config', 'manifest.json'),
    '{ "version": 1, "version": 1 }\n',
  );
  const failed = satori([broken], outside);
  if (
    failed.status !== 1 ||
    !failed.output.includes('it does not build') ||
    !failed.output.includes('step 4 refused it')
  )
    fail(
      'satori release-check, a package that does not build',
      `exit ${failed.status}, not 1 saying it does not build, at step 4`,
      failed.output,
    );
  else held++;
  // Its own errors: an --out, which it would not write, no package, and a server to read.
  for (const [what, args, says] of [
    ['with --out', ['config-packages/acme-config', '--out', 'dist']],
    ['with no package', []],
    // It would have the pipeline send NUXEO_USER and NUXEO_PASS to the address.
    [
      'with --model-server',
      ['config-packages/acme-config', '--model-server', 'http://127.0.0.1:9/nuxeo'],
      'reads no credential',
    ],
    // A model file that is not there, for a package with no app.json, which nothing else reads it
    // for: the command was wrong, and is not "ready" or "not ready".
    [
      'with --model naming no file',
      ['config-packages/acme-config', '--model', 'tmp/no-such-file.json'],
      '--model tmp/no-such-file.json names no file',
    ],
  ]) {
    const run = satori(args);
    if (run.status !== 2 || (says !== undefined && !run.output.includes(says)))
      fail(`satori release-check ${what}`, `exit ${run.status}, not 2`, run.output);
    else held++;
  }
}

// --- 9. What create writes for agents and CI -----------------------------------------------------------

function skillProblems(text, tools) {
  const problems = [];
  if (!/^---\nname: satori-app-builder\n/.test(text))
    problems.push('its name is not satori-app-builder');
  for (const [pattern, why] of REPOSITORY_ONLY) if (pattern.test(text)) problems.push(why);
  for (const { name } of tools)
    if (!text.includes(`\`${name}\``)) problems.push(`it does not name ${name}`);
  return problems;
}

function customerSkill(tool, tools) {
  const problems = skillProblems(
    readFileSync(join(tool, 'agents', 'skills', 'satori-app-builder', 'SKILL.md'), 'utf8'),
    tools,
  );
  if (tools.length === 0 || problems.length > 0)
    fail("the customer's skill", problems.join('; ') || 'no tools listed');
  else held++;
  // The control: this repository's own edition is refused by the same check.
  if (
    skillProblems(
      readFileSync(join(REPO, '.cursor', 'skills', 'app-builder', 'SKILL.md'), 'utf8'),
      tools,
    ).length < 3
  )
    fail("the control on the customer's skill", "this repository's own skill passed it");
  else held++;
}

/** Why the workflow `create` writes does not check, sign and verify as it says it does. */
function workflowProblems(text) {
  const problems = [];
  const jobs = text.slice(text.indexOf('\njobs:\n'));
  const job = (name) => {
    const at = jobs.indexOf(`\n  ${name}:\n`);
    if (at < 0) return '';
    const rest = jobs.slice(at + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };
  const steps = (body) => body.split(/\n {6}- /).slice(1);
  const check = job('check');
  const sign = job('sign');
  if (!/satori agents sync --check/.test(check))
    problems.push('check does not check the agent files');
  if (!/satori validate/.test(check) || !/satori build/.test(check))
    problems.push('check does not validate and build');
  if ((text.match(/id-token: write/g) ?? []).length !== 1 || !sign.includes('id-token: write'))
    problems.push('an identity is held by a job other than sign');
  if (
    !/if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/app-package\/'\)/.test(
      sign,
    )
  )
    problems.push('sign runs on more than a tag build');
  const signSteps = steps(sign);
  const plan = signSteps.findIndex((step) => /satori sign "\$ZIP" --keyless/.test(step));
  const attest = signSteps.findIndex((step) => /uses: actions\/attest@/.test(step));
  const verify = signSteps.findIndex((step) =>
    /satori verify "\$ZIP" --trusted-signers/.test(step),
  );
  if (plan < 0 || !/if: steps\.zip\.outputs\.configured == 'true'/.test(signSteps[plan] ?? ''))
    problems.push('sign decides whether to sign without trusted-signers.json');
  if (attest < plan || !/if: steps\.plan\.outputs\.sign == 'true'/.test(signSteps[attest] ?? ''))
    problems.push('the attestation is made whatever the decision');
  if (verify < attest || !/if: steps\.plan\.outputs\.sign == 'true'/.test(signSteps[verify] ?? ''))
    problems.push('the signature is not verified once made');
  if (/secrets\./.test(text)) problems.push('it reads a secret');
  return problems;
}

function workflowTemplate(tool) {
  const text = readFileSync(join(tool, 'templates', 'satori.yml'), 'utf8');
  const problems = workflowProblems(text);
  if (problems.length > 0) fail('the workflow satori create writes', problems.join('; '));
  else held++;
  for (const [what, was, is] of [
    [
      'the attestation made whatever the decision',
      "        if: steps.plan.outputs.sign == 'true'\n        with:\n          subject-path",
      '        with:\n          subject-path',
    ],
    [
      'check given an identity',
      '  check:\n    name: Validate and build\n',
      '  check:\n    name: Validate and build\n    permissions:\n      id-token: write\n',
    ],
    [
      'signing without trusted-signers.json',
      "        if: steps.zip.outputs.configured == 'true'\n",
      '',
    ],
  ]) {
    if (!text.includes(was)) {
      fail(`the control on the workflow: ${what}`, 'its edit no longer applies');
      continue;
    }
    if (workflowProblems(text.replace(was, is)).length === 0)
      fail(`the control on the workflow: ${what}`, 'not seen');
    else held++;
  }
}

// --- Running ---------------------------------------------------------------------------------------

/** A Node command, with its output as one text. */
function node(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT,
    ...options,
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

/** The same, without blocking the stand-in server that answers it. */
function nodeAsync(args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolveRun({ status, output }));
  });
}

/** `directory` built by `script`, as CI builds a kit: its platform, its allow-list, the other kits. */
function buildWith(script, directory, out, prefix = []) {
  const allowList = join(directory, 'deployment', 'build-allow-list.json');
  const args = [
    script,
    ...prefix,
    directory,
    '--out',
    out,
    '--platform',
    PLATFORM,
    '--kits',
    KITS,
    ...(existsSync(allowList) ? ['--allow-list', allowList] : []),
  ];
  return { ...node(args), out };
}

/**
 * That a build's folder holds what it wrote, its zip, checksum and changelog, and nothing it worked
 * in: `--tmp`'s folder, or `--out`'s by default, is removed when the build ends.
 */
function onlyTheZip(what, folder) {
  const left = existsSync(folder)
    ? readdirSync(folder).filter((name) => !/\.zip(?:\.sha256)?$|\.changes\.md$/.test(name))
    : ['no folder at all'];
  if (left.length > 0) fail(what, `${folder} holds ${left.join(', ')} beside the zip`);
  else held++;
}

/** The SHA-256 of the one zip a build wrote, or `null`. */
function digestOf({ out }) {
  if (!existsSync(out)) return null;
  const zips = readdirSync(out).filter((name) => name.endsWith('.zip'));
  if (zips.length !== 1) return null;
  return createHash('sha256')
    .update(readFileSync(join(out, zips[0])))
    .digest('hex');
}
