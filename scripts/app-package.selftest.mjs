#!/usr/bin/env node
/**
 * Negative controls for `app-package.mjs`, the package pipeline's first stage, and for
 * `app-package-model.mjs`, which exports the content model it can be held to.
 *
 * In CI that script runs on packages that are meant to pass, so every run of it is green, and a
 * check only ever seen green is an assertion. Each control here is the demo package broken in one
 * way, and each must be refused at its own step, for its own reason, with no zip written; the
 * sound package must pass and write a zip whose checksum holds. The first control is phase 0's
 * demo step 1: a layout that names a widget the platform does not have.
 *
 * It runs `app-package.mjs` as CI does, as a command, so that its exit codes and output are what
 * is checked.
 *
 * Usage: node scripts/app-package.selftest.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attribute, withoutCommentsOrInstructions } from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'app-package.mjs');
const EXPORT = join(REPO, 'scripts', 'app-package-model.mjs');
const DEMO = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
// The demo's version, read rather than written down: raising it is how a package is released, and
// that must not break these controls on the way to the tag.
const VERSION = attribute(
  withoutCommentsOrInstructions(readFileSync(join(DEMO, 'package', 'package.xml'), 'utf8')),
  'package',
  'version',
);
if (!VERSION) throw new Error("the demo's package.xml names no version");
/** Another version: the demo's with the patch of its core raised, so `0.1.0-alpha` gives `0.1.1-alpha`. */
const OTHER = VERSION.replace(
  /^(\d+\.\d+\.)(\d+)/,
  (_, head, patch) => `${head}${Number(patch) + 1}`,
);
if (OTHER === VERSION) throw new Error(`no other version can be made from ${VERSION}`);
const ZIP = `payers-claims-demo-${VERSION}.zip`;

const failures = [];
let negative = 0;
let positive = 0;

/** A control that changes nothing: the sound package. */
const unchanged = () => undefined;

/** The demo package, copied without its build output, then changed by `change`. */
function packageWith(change = unchanged) {
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-'));
  const directory = join(scratch, 'payers-claims-demo');
  cpSync(DEMO, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
  const edit = (file, from, to) => {
    const path = join(directory, file);
    const text = readFileSync(path, 'utf8');
    if (!text.includes(from))
      throw new Error(`the control's edit does not apply to ${file}: ${from}`);
    writeFileSync(path, text.replace(from, to));
  };
  const write = (file, text) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), text);
  };
  change({ directory, edit, write });
  return { scratch, directory, out: join(scratch, 'out') };
}

function run(directory, out, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, directory, '--out', out, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** The arguments, given as they are or made from the control's scratch directory. */
const argsFor = (args, scratch) => (typeof args === 'function' ? args(scratch) : args);

/**
 * Refused with exit 1 at `step`, saying `reason`, with no zip left: neither one of its own, nor the
 * one an earlier run of the same name and version left there, which `stale` plants first.
 */
function expectRefused(what, change, step, reason, args = [], { stale = true } = {}) {
  negative++;
  const { scratch, directory, out } = packageWith(change);
  try {
    if (stale) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, ZIP), 'an earlier run left this');
      writeFileSync(join(out, `${ZIP}.sha256`), 'an earlier run left this too');
    }
    const { status, output } = run(directory, out, argsFor(args, scratch));
    const problems = [];
    if (status !== 1) problems.push(`exit ${status}, not 1`);
    if (!output.includes(`step ${step} refused it`)) problems.push(`not refused at step ${step}`);
    if (!output.includes(reason)) problems.push(`no "${reason}"`);
    if (existsSync(join(out, ZIP))) problems.push('a zip is left');
    if (existsSync(join(out, `${ZIP}.sha256`))) problems.push('a checksum is left');
    if (problems.length > 0)
      failures.push(`${what}: ${problems.join('; ')}\n${output.trim().replace(/^/gm, '    ')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Built, with exit 0, and a checksum file that holds for the zip beside it. */
function expectBuilt(what, change, args = []) {
  positive++;
  const { scratch, directory, out } = packageWith(change);
  try {
    const { status, output } = run(directory, out, argsFor(args, scratch));
    const zip = join(out, ZIP);
    const problems = [];
    if (status !== 0) problems.push(`exit ${status}, not 0`);
    if (!existsSync(zip)) problems.push('no zip');
    else {
      const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
      const line = existsSync(`${zip}.sha256`) ? readFileSync(`${zip}.sha256`, 'utf8') : '';
      if (line !== `${digest}  ${ZIP}\n`)
        problems.push(`the checksum file is ${JSON.stringify(line)}`);
    }
    if (problems.length > 0)
      failures.push(`${what}: ${problems.join('; ')}\n${output.trim().replace(/^/gm, '    ')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const LAYOUT = 'bundle/agentic-ui-config/layouts/Claim/view.layout.json';

// Phase 0's demo, step 1: the pipeline fails, and names the widget.
expectRefused(
  'a layout naming a widget the platform does not have',
  ({ edit }) => edit(LAYOUT, '"widget": "document-link"', '"widget": "calendar"'),
  2,
  'cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]',
);
expectRefused(
  "a build.mjs that is not the generator's",
  ({ edit }) => edit('build.mjs', '#!/usr/bin/env node', '#!/usr/bin/env node\n// changed'),
  1,
  "build.mjs is not the generator's, byte for byte",
);
expectRefused(
  'no app.json',
  ({ directory }) => rmSync(join(directory, 'bundle/agentic-ui-config/app.json')),
  2,
  'has no app.json',
);
expectRefused(
  "an operation the deployment's allow-list does not hold",
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/actions.json',
      '"transition": "approve",',
      '"operation": "Payers.ApproveClaim",',
    ),
  2,
  `the operation "Payers.ApproveClaim" is not on this deployment's allow-list`,
);
expectRefused(
  "app.json's version apart from package.xml's",
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/app.json',
      `"packageVersion": "${VERSION}"`,
      `"packageVersion": "${OTHER}"`,
    ),
  3,
  `app.json's packageVersion is ${OTHER}, and package.xml's version is ${VERSION}`,
);
expectRefused(
  'a tag for another version',
  unchanged,
  3,
  `the tag app-package/payers-claims-demo/${OTHER} is not app-package/payers-claims-demo/${VERSION}`,
  ['--tag', `app-package/payers-claims-demo/${OTHER}`],
);
expectRefused(
  "a component without Satori's defaults first, which build.mjs refuses",
  ({ edit }) =>
    edit(
      'bundle/OSGI-INF/payers-claims-demo-config.xml',
      '<require>org.nuxeo.agentic.ui.config.defaults</require>',
      '',
    ),
  4,
  'build.mjs refused the package',
);

expectRefused(
  'an install.xml that deploys the bundle elsewhere, which build.mjs packages and the verifier refuses',
  ({ edit }) => edit('package/install.xml', 'todir="${env.bundles}"', 'todir="${env.lib}"'),
  5,
  'is not a well-formed Nuxeo Package',
);

const COMPONENT = 'bundle/OSGI-INF/payers-claims-demo-config.xml';
/** A version 2 layout naming a widget the platform does not have. */
const CALENDAR =
  '{"version":2,"cards":[{"id":"c","fields":[{"field":"a:b","widget":"calendar"}]}]}';
const CONTRIBUTION =
  '<layout type="Claim" mode="view" src="agentic-ui-config/layouts/Claim/view.layout.json" />';

// The server serves what the component contributes, so a layout this stage did not read is refused.
expectRefused(
  'a layout contributed inline, which the validator never sees',
  ({ edit }) =>
    edit(
      COMPONENT,
      CONTRIBUTION,
      '<layout type="Claim" mode="view"><json>{"version":2,"cards":[{"id":"c","fields":' +
        '[{"field":"a:b","widget":"calendar"}]}]}</json></layout>',
    ),
  2,
  'contributes the Claim/view layout inline, which this stage cannot check',
);
expectRefused(
  'a layout contributed in a mode other than the one the validator read it in',
  ({ edit }) => edit(COMPONENT, 'mode="view"', 'mode="edit"'),
  2,
  'contributes the Claim/edit layout from agentic-ui-config/layouts/Claim/view.layout.json',
);

// Every layout the package holds is checked, whatever its directory is called.
expectRefused(
  'a contributed layout of the type node_modules, which a walk that passed over dependencies missed',
  ({ edit, write }) => {
    edit(
      COMPONENT,
      CONTRIBUTION,
      `${CONTRIBUTION}\n    <layout type="node_modules" mode="view" src="agentic-ui-config/layouts/node_modules/view.layout.json" />`,
    );
    write('bundle/agentic-ui-config/layouts/node_modules/view.layout.json', CALENDAR);
  },
  2,
  'the widget "calendar" is not registered',
);

// The manifest is read as the builder reads it, so no component is hidden from step 2.
const MANIFEST = 'bundle/META-INF/MANIFEST.MF';
const SECOND = `<?xml version="1.0"?>
<component name="nuxeo.config.second" version="1.0">
  <require>org.nuxeo.agentic.ui.config.defaults</require>
  <extension target="org.nuxeo.agentic.ui.config" point="configuration">
    <layout type="Claim" mode="edit"><json>${CALENDAR}</json></layout>
  </extension>
</component>
`;
/** The demo's manifest headers, without its Nuxeo-Component line. */
const headersBut = () =>
  readFileSync(join(DEMO, MANIFEST), 'utf8')
    .trimEnd()
    .split(/\r\n|\r|\n/)
    .filter((line) => !line.startsWith('Nuxeo-Component:'));
expectRefused(
  'a second component behind a manifest continuation after a bare CR',
  ({ write }) => {
    const lines = [
      ...headersBut(),
      'Nuxeo-Component: OSGI-INF/payers-claims-demo-config.xml,',
      ' OSGI-INF/second.xml',
    ];
    write(MANIFEST, `${lines.join('\r')}\r`);
    write('bundle/OSGI-INF/second.xml', SECOND);
  },
  2,
  'OSGI-INF/second.xml contributes the Claim/edit layout inline',
);
expectRefused(
  'a second component named first in a manifest that opens with a byte-order mark',
  ({ write }) => {
    const lines = [
      'Nuxeo-Component: OSGI-INF/payers-claims-demo-config.xml, OSGI-INF/second.xml',
      ...headersBut(),
    ];
    write(MANIFEST, `\uFEFF${lines.join('\n')}\n`);
    write('bundle/OSGI-INF/second.xml', SECOND);
  },
  2,
  'OSGI-INF/second.xml contributes the Claim/edit layout inline',
);
// The server's manifest reader keeps the last of a repeated header, whatever its case. Step 2
// checks the components of every header, so none the server could load escapes it; a manifest that
// two readers could take differently is the builder's to refuse, at step 4.
expectRefused(
  'a component named only in a second Nuxeo-Component header, which the server would load',
  ({ write }) => {
    const lines = [
      ...headersBut(),
      'Nuxeo-Component: OSGI-INF/payers-claims-demo-config.xml',
      'Nuxeo-Component: OSGI-INF/second.xml',
    ];
    write(MANIFEST, `${lines.join('\n')}\n`);
    write('bundle/OSGI-INF/second.xml', SECOND);
  },
  2,
  'OSGI-INF/second.xml contributes the Claim/edit layout inline',
);
expectRefused(
  'a second Nuxeo-Component header, even one that names nothing wrong',
  ({ write }) => {
    const line = 'Nuxeo-Component: OSGI-INF/payers-claims-demo-config.xml';
    write(MANIFEST, `${[...headersBut(), line, line].join('\n')}\n`);
  },
  4,
  'has 2 Nuxeo-Component headers',
);
expectRefused(
  'a Nuxeo-Component header spelt in another case',
  ({ write }) => {
    const lines = [...headersBut(), 'nuxeo-component: OSGI-INF/payers-claims-demo-config.xml'];
    write(MANIFEST, `${lines.join('\n')}\n`);
  },
  4,
  'spells its Nuxeo-Component header "nuxeo-component"',
);
expectBuilt('a manifest whose lines end with a bare CR', ({ write }) =>
  write(
    MANIFEST,
    `${readFileSync(join(DEMO, MANIFEST), 'utf8').trimEnd().split('\n').join('\r')}\r`,
  ),
);

expectBuilt('a package.xml written with single quotes and spaces around =', ({ edit }) =>
  edit(
    'package/package.xml',
    `<package type="addon" name="payers-claims-demo" version="${VERSION}">`,
    `<package type='addon' name = 'payers-claims-demo' version= '${VERSION}'>`,
  ),
);
expectBuilt('a disabled layout entry, which contributes nothing', ({ edit }) =>
  edit(
    COMPONENT,
    CONTRIBUTION,
    `${CONTRIBUTION}\n    <layout type="File" mode="edit" enabled="false" />`,
  ),
);

// With no package.xml there is no name to know an earlier zip by, so none is planted: refused, not
// a stack trace.
expectRefused(
  'no package.xml',
  ({ directory }) => rmSync(join(directory, 'package', 'package.xml')),
  3,
  'package/package.xml is missing',
  [],
  { stale: false },
);

// A name that reaches outside the output directory removes nothing there: the builder refuses it.
negative++;
{
  const { scratch, directory, out } = packageWith(({ edit }) =>
    edit('package/package.xml', 'name="payers-claims-demo"', 'name="../outside"'),
  );
  const outside = join(scratch, `outside-${VERSION}.zip`);
  writeFileSync(outside, "not the pipeline's to remove");
  const { status, output } = run(directory, out);
  if (status !== 1 || !output.includes('step 4 refused it'))
    failures.push(`a name that reaches outside: exit ${status}, not refused at step 4\n${output}`);
  if (!existsSync(outside))
    failures.push('a name that reaches outside removed a file outside the output directory');
  rmSync(scratch, { recursive: true, force: true });
}

expectBuilt('the demo package', unchanged);
expectBuilt('the demo package, for its own tag', unchanged, [
  '--tag',
  `app-package/payers-claims-demo/${VERSION}`,
]);
expectBuilt(
  'an operation the allow-list holds',
  ({ edit, write }) => {
    edit(
      'bundle/agentic-ui-config/actions.json',
      '"transition": "approve",',
      '"operation": "Payers.ApproveClaim",',
    );
    // The deployment's, so beside the package rather than in it.
    write('../allow-list.json', JSON.stringify({ operations: ['Payers.ApproveClaim'] }));
  },
  (scratch) => ['--allow-list', join(scratch, 'allow-list.json')],
);

// The content model, given as a file (package-pipeline.md, section 4). The demo's is beside it,
// and these controls copy the package with it, so each is held to the model it carries.
const MODEL = 'content-model.json';
const withModel = (scratch) => ['--model', join(scratch, 'payers-claims-demo', MODEL)];
/** The demo's received date shown as a yes or no: a widget the date property does not fit. */
const BOOLEAN_RECEIVED = ({ edit }) =>
  edit(
    LAYOUT,
    '{ "field": "claim:received", "widget": "date", "parameters": { "format": "long" } }',
    '{ "field": "claim:received", "widget": "boolean" }',
  );
const RECEIVED_REFUSED =
  'cards[0].fields[3].widget: the widget "boolean" does not show "claim:received", a date property: it takes boolean [parameter]';

expectRefused(
  'a widget that does not show its property, given the content model',
  BOOLEAN_RECEIVED,
  2,
  RECEIVED_REFUSED,
  withModel,
);
expectRefused(
  'a field whose property the type does not have, given the content model',
  ({ edit }) => edit(LAYOUT, '"claim:number",', '"claim:numbr",'),
  2,
  'cards[0].fields[0]: "claim:numbr" is not a property of the type "Claim" or of its facets [unknown]',
  withModel,
);
expectRefused(
  'a table column naming a subfield its property does not have, given the content model',
  ({ edit }) =>
    edit(
      LAYOUT,
      '"claim:number",',
      '"claim:number", { "field": "claim:lines", "widget": "table", "parameters": { "columns": ["line:code", "line:cost"] } },',
    ),
  2,
  'cards[0].fields[1].parameters.columns[1]: "claim:lines" has no subfield "cost" [unknown]',
  withModel,
);
expectRefused(
  'a layout for a type the content model does not have',
  ({ edit }) => edit(MODEL, '"Claim": {', '"Claims": {'),
  2,
  'the file: the document type "Claim" is not in the content model [unknown]',
  withModel,
);
expectBuilt('the demo package, held to its content model', unchanged, withModel);
// The control on the controls above: the same layout passes with no model, so it is the model that
// refuses it, and the model stays opt in.
expectBuilt('a widget that does not show its property, with no content model', BOOLEAN_RECEIVED);

// A model the validator cannot read stops the run, as a wrong allow-list does: exit 2, neither
// refused nor built on a model nobody saw.
negative++;
{
  const { scratch, directory, out } = packageWith(({ edit }) =>
    edit(MODEL, '},\n  "facets": [', '},\n  "facet": ['),
  );
  const { status, output } = run(directory, out, withModel(scratch));
  if (status !== 2 || !output.includes('"facet" is not a key of a content model'))
    failures.push(
      `a malformed content model exits ${status}, not 2, or does not say why\n${output}`,
    );
  if (existsSync(join(out, ZIP))) failures.push('a malformed content model left a zip');
  rmSync(scratch, { recursive: true, force: true });
}

// The usage errors exit 2, apart from a refusal: the command's own, and the validator's, such as
// an allow-list of the wrong shape.
negative++;
{
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-'));
  const wrong = join(scratch, 'allow-list.json');
  writeFileSync(wrong, JSON.stringify({ operations: [1] }));
  const { status } = run(DEMO, join(scratch, 'out'), ['--allow-list', wrong]);
  if (status !== 2) failures.push(`an allow-list of the wrong shape exits ${status}, not 2`);
  rmSync(scratch, { recursive: true, force: true });
}
for (const argv of [
  [],
  ['a', 'b'],
  [DEMO, '--colour', 'red'],
  [join(tmpdir(), 'no-such-package')],
]) {
  const { status } = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' });
  if (status !== 2) failures.push(`${JSON.stringify(argv)} exits ${status}, not 2`);
}
/** Made-up credentials, so that a refusal below is for the address, not for credentials missing. */
const madeUp = () => ({
  ...process.env,
  NUXEO_USER: randomBytes(6).toString('hex'),
  NUXEO_PASS: randomBytes(12).toString('hex'),
});
// One content model, a file or the server's: both is the command's usage, before any read.
negative++;
{
  const argv = [DEMO, '--model', join(DEMO, MODEL), '--model-server', 'http://localhost:1/nuxeo'];
  const { status, stderr } = spawnSync(process.execPath, [SCRIPT, ...argv], {
    encoding: 'utf8',
    env: madeUp(),
  });
  if (status !== 2 || !stderr.startsWith('usage: node scripts/app-package.mjs'))
    failures.push(`--model with --model-server exits ${status}, not 2 for its usage\n${stderr}`);
}
// Credentials never go over plain HTTP to another machine, nor in the address. `.invalid` never
// resolves, should a check be gone.
for (const [server, reason] of [
  [
    'http://nuxeo.invalid/nuxeo',
    'credentials are sent over HTTPS only, or over HTTP to this machine',
  ],
  ['https://someone:secret@nuxeo.invalid/nuxeo', 'the address carries credentials'],
  ['https://nuxeo.invalid/nuxeo?user=someone', 'with no query'],
  ['nuxeo.invalid', 'is not an address'],
]) {
  negative++;
  const { status, stderr } = spawnSync(process.execPath, [SCRIPT, DEMO, '--model-server', server], {
    encoding: 'utf8',
    env: madeUp(),
  });
  if (status !== 2 || !stderr.includes(`--model-server: `) || !stderr.includes(reason))
    failures.push(`--model-server ${server} exits ${status}, not 2 for "${reason}"\n${stderr}`);
}

// The content model read live (`--model-server`), from a server that answers as Nuxeo does, with
// the demo's model. The credentials are made up for the run: what is checked is that they arrive,
// in the header, on every read.
await (async () => {
  const model = JSON.parse(readFileSync(join(DEMO, MODEL), 'utf8'));
  const credentials = {
    username: randomBytes(6).toString('hex'),
    password: randomBytes(12).toString('hex'),
  };
  const expected = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  const seen = { unauthorised: 0, schemas: new Set(), withoutFields: 0, elsewhere: 0 };
  let answer = (schema) => schema;
  let status = 200;
  let redirect = null;
  let doctypes = () => model.doctypes;
  const server = createServer((request, response) => {
    if (request.url === '/elsewhere') {
      seen.elsewhere++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (redirect !== null) {
      response.writeHead(302, { location: redirect });
      response.end();
      return;
    }
    const json = (body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== expected) {
      seen.unauthorised++;
      response.writeHead(401);
      response.end();
      return;
    }
    const path = new URL(request.url, 'http://localhost').pathname;
    const named = /^\/nuxeo\/api\/v1\/config\/schemas\/([^/]+)$/.exec(path);
    if (path === '/nuxeo/api/v1/config/types') json({ doctypes: doctypes(), schemas: {} });
    else if (path === '/nuxeo/api/v1/config/facets') json(model.facets);
    // The list, as Nuxeo answers it: no constraints, so no directory.
    else if (path === '/nuxeo/api/v1/config/schemas')
      json(model.schemas.map(({ name }) => ({ name, fields: {} })));
    else if (named) {
      const name = decodeURIComponent(named[1]);
      seen.schemas.add(name);
      if (request.headers['fetch-schema'] !== 'fields') seen.withoutFields++;
      json(answer(model.schemas.find((schema) => schema.name === name)));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = `http://127.0.0.1:${server.address().port}/nuxeo`;
  const env = {
    ...process.env,
    NUXEO_USER: credentials.username,
    NUXEO_PASS: credentials.password,
  };
  /** A command, run without blocking this process, which serves the model meanwhile. */
  const outputs = [];
  const command = (argv, environment) =>
    new Promise((done) => {
      const child = spawn(process.execPath, argv, { env: environment });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('close', (code) => {
        outputs.push(output);
        done({ status: code, output });
      });
    });
  const live = (directory, out, environment = env) =>
    command([SCRIPT, directory, '--out', out, '--model-server', address], environment);
  const bareEnv = () => {
    const bare = { ...process.env };
    delete bare.NUXEO_USER;
    delete bare.NUXEO_PASS;
    return bare;
  };
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-live-'));
  try {
    positive++;
    let result = await live(DEMO, join(scratch, 'sound'));
    if (result.status !== 0 || !result.output.includes(`read from ${address}`))
      failures.push(
        `the demo, held to the model read live: exit ${result.status}\n${result.output}`,
      );
    if (seen.unauthorised > 0)
      failures.push(`${seen.unauthorised} reads came without the credentials`);
    if (seen.withoutFields > 0)
      failures.push(`${seen.withoutFields} schemas were read without fetch-schema: fields`);
    if (seen.schemas.size !== model.schemas.length)
      failures.push(
        `${seen.schemas.size} of ${model.schemas.length} schemas were read on their own`,
      );

    // The server says the received date is a text: the layout's date widget is refused.
    negative++;
    answer = (schema) =>
      schema.name === 'claim'
        ? { ...schema, fields: { ...schema.fields, received: { type: 'string' } } }
        : schema;
    result = await live(DEMO, join(scratch, 'string'));
    const reason =
      'cards[0].fields[3].widget: the widget "date" does not show "claim:received", a string property: it takes date [parameter]';
    if (
      result.status !== 1 ||
      !result.output.includes('step 2 refused it') ||
      !result.output.includes(reason)
    )
      failures.push(
        `a model read live whose property the widget does not fit: exit ${result.status}\n${result.output}`,
      );
    if (existsSync(join(scratch, 'string', ZIP)))
      failures.push('a model read live left a zip it refused');

    // A server that refuses a read stops the run, with exit 2, and the zip an earlier run left is
    // removed, as a refusal removes it.
    negative++;
    answer = (schema) => schema;
    status = 500;
    mkdirSync(join(scratch, 'failing'), { recursive: true });
    writeFileSync(join(scratch, 'failing', ZIP), 'an earlier run left this');
    result = await live(DEMO, join(scratch, 'failing'));
    if (result.status !== 2 || !result.output.includes('answered 500, not 200'))
      failures.push(`a server that answers 500 exits ${result.status}, not 2\n${result.output}`);
    if (existsSync(join(scratch, 'failing', ZIP)))
      failures.push('a failed model read left the zip an earlier run wrote');
    status = 200;

    // The export: the model the server answers, written to a file the pipeline reads.
    positive++;
    const exported = join(scratch, 'exported.json');
    const exporting = await command([EXPORT, '--server', address, '--out', exported], env);
    if (exporting.status !== 0 || !existsSync(exported))
      failures.push(`the export exits ${exporting.status}, with no file\n${exporting.output}`);
    else {
      const written = JSON.parse(readFileSync(exported, 'utf8'));
      if (JSON.stringify(written) !== JSON.stringify(model))
        failures.push('the exported model is not the one the server answered');
      const held = run(DEMO, join(scratch, 'exported'), ['--model', exported]);
      if (held.status !== 0)
        failures.push(`the demo, held to the exported model: exit ${held.status}`);
    }
    // An answer the validator cannot read whole, a type naming a facet the server does not list,
    // is not left behind as a file that --model would then refuse.
    negative++;
    doctypes = () => ({ Claim: { ...model.doctypes.Claim, facets: ['Unlisted'] } });
    const unreadable = join(scratch, 'unreadable.json');
    const refusedExport = await command([EXPORT, '--server', address, '--out', unreadable], env);
    if (
      refusedExport.status !== 1 ||
      !refusedExport.output.includes('the facet "Unlisted" is not in facets') ||
      existsSync(unreadable)
    )
      failures.push(
        `an export the validator cannot read exits ${refusedExport.status}, not 1 with no file\n${refusedExport.output}`,
      );
    doctypes = () => model.doctypes;

    for (const [argv, environment, expected] of [
      [[EXPORT, '--server', address], env, 'usage:'],
      [
        [EXPORT, '--server', 'http://nuxeo.invalid/nuxeo', '--out', exported],
        env,
        '--server: credentials are sent over HTTPS only',
      ],
      [
        [EXPORT, '--server', address, '--out', exported],
        bareEnv(),
        'NUXEO_USER and NUXEO_PASS must both be set',
      ],
    ]) {
      negative++;
      const { status: code, output } = await command(argv, environment);
      if (code !== 2 || !output.includes(expected))
        failures.push(
          `${argv.slice(1).join(' ')} exports with exit ${code}, not 2 for "${expected}"\n${output}`,
        );
    }

    // No credentials in the environment: exit 2, before any read.
    negative++;
    const before = seen.unauthorised;
    result = await live(DEMO, join(scratch, 'bare'), bareEnv());
    if (
      result.status !== 2 ||
      !result.output.includes('NUXEO_USER and NUXEO_PASS must both be set')
    )
      failures.push(`no credentials exits ${result.status}, not 2\n${result.output}`);
    if (seen.unauthorised !== before)
      failures.push('a run with no credentials still asked the server');

    // A redirect is refused, not followed: the header goes only where it was sent.
    negative++;
    redirect = `http://127.0.0.1:${server.address().port}/elsewhere`;
    result = await live(DEMO, join(scratch, 'redirected'));
    if (result.status !== 2 || !result.output.includes('/api/v1/config/'))
      failures.push(`a server that redirects exits ${result.status}, not 2\n${result.output}`);
    if (seen.elsewhere > 0) failures.push('a redirect was followed');
    redirect = null;

    // Every run, the ones that read and the ones that failed: none printed the credentials.
    negative++;
    const leaked = outputs.filter(
      (output) => output.includes(credentials.password) || output.includes(expected.slice(6)),
    );
    if (leaked.length > 0) failures.push(`${leaked.length} runs printed the credentials`);
  } finally {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
})();

if (failures.length > 0) {
  console.error(`app-package selftest: ${failures.length} control(s) did not hold:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `app-package selftest: ${negative} negative controls refused, each at its own step and for its own reason, and ${positive} sound packages built.\n`,
);
