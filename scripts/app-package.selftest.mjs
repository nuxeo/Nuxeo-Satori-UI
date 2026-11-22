#!/usr/bin/env node
/**
 * Negative controls for `app-package.mjs`, the package pipeline's first stage.
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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
// The server's manifest reader keeps the last of a repeated header, whatever its case; the builder
// reads the first, spelt exactly. So a manifest that could be read either way is refused.
expectRefused(
  'a second Nuxeo-Component header, which the server would load and the builder never read',
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
  'names components in 2 Nuxeo-Component headers',
);
expectRefused(
  'a Nuxeo-Component header spelt in another case, which only the server reads',
  ({ write }) => {
    const lines = [...headersBut(), 'nuxeo-component: OSGI-INF/payers-claims-demo-config.xml'];
    write(MANIFEST, `${lines.join('\n')}\n`);
  },
  2,
  'spells its header "nuxeo-component"',
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

if (failures.length > 0) {
  console.error(`app-package selftest: ${failures.length} control(s) did not hold:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `app-package selftest: ${negative} negative controls refused, each at its own step and for its own reason, and ${positive} sound packages built.\n`,
);
