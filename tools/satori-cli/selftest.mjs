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
 *
 * Exit 0 when every control holds, 1 when one does not.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnToolSync } from '../../scripts/beta-harness/package-command.mjs';
import { SATORI_NAMES } from '../../scripts/package-pipeline/configuration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const KITS = join(REPO, 'business-apps', 'packages');
const PLATFORM = JSON.parse(
  readFileSync(join(REPO, 'libs', 'platform', 'package.json'), 'utf8'),
).version;
const PIPELINE = join(REPO, 'scripts', 'app-package.mjs');
const VALIDATOR = join(REPO, 'libs', 'shared', 'app-definition', 'src', 'bin.mjs');
const PAYERS = join(KITS, 'payers-claims-demo');
const LAYOUT = 'bundle/agentic-ui-config/layouts/Claim/view.layout.json';
const OUTPUT_LIMIT = 64 * 1024 * 1024;

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

  oneBuilder(satori, tool);
  const kitDigest = digestOf(buildWith(PIPELINE, PAYERS, join(scratch, 'pipeline-payers')));
  outsideTheRepository(tool, kitDigest);
  refusals(satori);
  await modelPull(satori);
  reservedNames();
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

function outsideTheRepository(tool, kitDigest) {
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
  mkdirSync(join(outside, 'tmp'), { recursive: true });
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
  // Every Node process of the run may read and write this folder, and nothing else.
  const env = {
    ...process.env,
    TMPDIR: join(outside, 'tmp'),
    TEMP: join(outside, 'tmp'),
    TMP: join(outside, 'tmp'),
    NODE_OPTIONS: `--permission --allow-fs-read=${outside} --allow-fs-write=${outside} --allow-child-process`,
  };
  const confined = (args) => node(args, { cwd: outside, env });
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

  const allowList = join(outside, 'payers-claims-demo', 'deployment', 'build-allow-list.json');
  const kit = confined([
    bin,
    'build',
    join(outside, 'payers-claims-demo'),
    '--out',
    join(outside, 'payers-out'),
    ...(existsSync(allowList) ? ['--allow-list', allowList] : []),
  ]);
  const digest = digestOf({ ...kit, out: join(outside, 'payers-out') });
  if (kit.status !== 0 || digest !== kitDigest)
    fail(
      'a kit, outside the repository',
      `exit ${kit.status}, digest ${digest}, and app-package.mjs's is ${kitDigest}`,
      kit.output,
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
    'AGENTS.md',
    '.gitignore',
    '.github/workflows/satori.yml',
    'config-packages/acme-config/package/package.xml',
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
  if (existsSync(join(repository, 'config-packages', 'acme-config', 'project.json')))
    fail('satori create', "the generator's project.json, which is Nx's, was kept");
  for (const step of ['validate', 'build']) {
    const run = node(
      [
        bin,
        step,
        'config-packages/acme-config',
        ...(step === 'build' ? ['--out', 'dist'] : []),
        '--kits',
        'config-packages',
      ],
      { cwd: repository, env },
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
  if (existsSync(join(repository, 'config-packages', 'acme-config', 'dist')))
    fail('satori validate of the scaffold', 'it wrote into the package');
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
    'holds home.json, of an app definition, and no app.json',
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
  for (const [what, args] of [
    ['validate with --out', ['validate', first, '--out', join(scratch, 'x')]],
    ['--previous-platform', ['build', first, '--previous', first, '--previous-platform', first]],
    ['no command', []],
    ['upgrade-check with no --previous', ['upgrade-check', first]],
    ['model pull with no --out', ['model', 'pull', '--server', 'https://nuxeo.example/nuxeo']],
  ]) {
    const run = node([satori, ...args]);
    if (run.status !== 2) fail(what, `exit ${run.status}, not 2`, run.output);
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
  passes(
    "a package whose build.mjs is not the tool's",
    first,
    ({ edit }) => edit('build.mjs', '#!/usr/bin/env node', '#!/usr/bin/env node\n// an older copy'),
    'note: build.mjs is not the builder this tool carries',
  );

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
}

/**
 * `satori model pull` against a stand-in Nuxeo: the credentials arrive in the Authorization header
 * of every read, the file is the model the server answered, and an address carrying credentials is
 * refused before anything is read.
 */
async function modelPull(satori) {
  const user = 'selftest-user';
  const secret = `selftest-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 12)}`;
  const expected = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  // What the stand-in answers: the Payers kit's model, as a server with the kit installed answers it.
  const model = JSON.parse(readFileSync(join(PAYERS, 'content-model.json'), 'utf8'));
  const unauthorised = [];
  const server = createServer((request, response) => {
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

/** The SHA-256 of the one zip a build wrote, or `null`. */
function digestOf({ out }) {
  if (!existsSync(out)) return null;
  const zips = readdirSync(out).filter((name) => name.endsWith('.zip'));
  if (zips.length !== 1) return null;
  return createHash('sha256')
    .update(readFileSync(join(out, zips[0])))
    .digest('hex');
}
