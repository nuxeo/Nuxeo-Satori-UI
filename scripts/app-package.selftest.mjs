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
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServerModel, withoutCredentials } from './nuxeo-content-model.mjs';
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

/**
 * The allow-list a package names beside its bundle, for the deployment it is built for: what CI
 * gives the pipeline (`app-packages.yml`). The Payers kit's buttons run two chains.
 */
const BUILD_ALLOW_LIST = join('deployment', 'build-allow-list.json');

/** As CI runs it: given the package's own build allow-list, unless the control gives another. */
function run(directory, out, args = []) {
  const allowList = join(directory, BUILD_ALLOW_LIST);
  const withAllowList =
    !args.includes('--allow-list') && existsSync(allowList)
      ? [...args, '--allow-list', allowList]
      : args;
  const result = spawnSync(process.execPath, [SCRIPT, directory, '--out', out, ...withAllowList], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** The arguments, given as they are or made from the control's scratch directory. */
const argsFor = (args, scratch) => (typeof args === 'function' ? args(scratch) : args);

/**
 * Refused with exit 1 at `step`, saying `reason`, with no zip left: neither one of its own, nor the
 * one an earlier run of the same name and version left there, which `stale` plants first. When
 * `never` is given, the output must not hold it. `reason`, like `args`, may be made from the
 * control's scratch directory. `after` undoes what the control did that would stop its scratch
 * directory being removed. `staleStays` requires the earlier zip to be left as it was: for a
 * package whose name must not be read.
 */
function expectRefused(
  what,
  change,
  step,
  reason,
  args = [],
  { stale = true, staleStays = false, never, after } = {},
) {
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
    const expected = typeof reason === 'function' ? reason(scratch) : reason;
    if (!output.includes(expected)) problems.push(`no "${expected}"`);
    if (never !== undefined && output.includes(never)) problems.push(`"${never}" is in the output`);
    if (staleStays) {
      // The package's name was not read, so the earlier zip of that name could not be cleared.
      if (
        !existsSync(join(out, ZIP)) ||
        readFileSync(join(out, ZIP), 'utf8') !== 'an earlier run left this'
      )
        problems.push('the earlier zip did not stay as it was');
    } else {
      if (existsSync(join(out, ZIP))) problems.push('a zip is left');
      if (existsSync(join(out, `${ZIP}.sha256`))) problems.push('a checksum is left');
    }
    if (problems.length > 0)
      failures.push(`${what}: ${problems.join('; ')}\n${output.trim().replace(/^/gm, '    ')}`);
  } finally {
    after?.(directory);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Built, with exit 0, and a checksum file that holds for the zip beside it; saying `says`, when
 * given, and never saying `never`.
 */
function expectBuilt(what, change, args = [], says, never) {
  positive++;
  const { scratch, directory, out } = packageWith(change);
  try {
    const { status, output } = run(directory, out, argsFor(args, scratch));
    const zip = join(out, ZIP);
    const problems = [];
    if (status !== 0) problems.push(`exit ${status}, not 0`);
    if (says !== undefined && !output.includes(says)) problems.push(`no "${says}"`);
    if (never !== undefined && output.includes(never)) problems.push(`"${never}" is in the output`);
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
      '"transition": "pay",',
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
  "the manifest's Bundle-Version apart from package.xml's",
  ({ edit }) =>
    edit('bundle/META-INF/MANIFEST.MF', `Bundle-Version: ${VERSION}`, `Bundle-Version: ${OTHER}`),
  3,
  `the manifest's Bundle-Version is ${OTHER}, and package.xml's version is ${VERSION}`,
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
// And the other way round: a layout file the validator passes and no component contributes is one
// the server would never serve. Phase 3's contracts kit met it: an Edit form written, and passed.
/** A sound version 2 form for a Claim: it passes the validator, so only its contribution is missing. */
const CLAIM_FORM = '{"version":2,"cards":[{"id":"claim","fields":["claim:number"]}]}';
const CLAIM_FORM_FILE = 'bundle/agentic-ui-config/layouts/Claim/edit.layout.json';
const CLAIM_FORM_ENTRY =
  '<layout type="Claim" mode="edit" src="agentic-ui-config/layouts/Claim/edit.layout.json" />';
expectRefused(
  'a layout file no component contributes, which the server would never serve',
  ({ write }) => write(CLAIM_FORM_FILE, CLAIM_FORM),
  2,
  `${CLAIM_FORM_FILE} is a layout no component contributes, so the server would never serve it. Add ${CLAIM_FORM_ENTRY}`,
);
expectRefused(
  'a layout file only a disabled entry names',
  ({ edit, write }) => {
    write(CLAIM_FORM_FILE, CLAIM_FORM);
    edit(
      COMPONENT,
      CONTRIBUTION,
      `${CONTRIBUTION}\n    ${CLAIM_FORM_ENTRY.replace(' />', ' enabled="false" />')}`,
    );
  },
  2,
  `${CLAIM_FORM_FILE} is a layout OSGI-INF/payers-claims-demo-config.xml names only in a disabled entry`,
);
expectRefused(
  'a layout entry outside the configuration point, where nothing registers it',
  ({ edit }) =>
    edit(
      COMPONENT,
      `  ${CONTRIBUTION}\n`,
      `</extension>\n  <extension target="org.nuxeo.agentic.ui.config" point="configurations">\n    ${CONTRIBUTION}\n  </extension>\n  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n`,
    ),
  2,
  `${LAYOUT} is a layout OSGI-INF/payers-claims-demo-config.xml names only outside an extension of org.nuxeo.agentic.ui.config's "configuration" point`,
);
expectRefused(
  'a contributed layout whose file is taken away from the contribution, leaving the file',
  ({ edit }) => edit(COMPONENT, CONTRIBUTION, ''),
  2,
  `${LAYOUT} is a layout no component contributes`,
);
expectRefused(
  'a file under layouts/ at no place a layout has, which the validator does not read',
  ({ write }) => write('bundle/agentic-ui-config/layouts/Claim/notes.txt', 'a note'),
  2,
  'bundle/agentic-ui-config/layouts/Claim/notes.txt is not a layout any component can contribute',
);
expectBuilt(
  'a layout file the component contributes, as the generators write it',
  ({ edit, write }) => {
    write(CLAIM_FORM_FILE, CLAIM_FORM);
    edit(COMPONENT, CONTRIBUTION, `${CONTRIBUTION}\n    ${CLAIM_FORM_ENTRY}`);
  },
);
expectBuilt('a Markdown note among the layouts, which the zip does not hold', ({ write }) =>
  write('bundle/agentic-ui-config/layouts/README.md', '# Layouts\n'),
);

// The app registry serves the app as the component names it, so the component names it once, from
// the app.json the validator read, with exactly the package's files.
const APP_ELEMENT = '<app id="payers-claims" src="agentic-ui-config/app.json">';
const QUEUE_FILE = '<file path="queues/unassigned-claims.json" />';
expectBuilt(
  'an app the component does not contribute: built, and told the registry will not serve it',
  ({ edit }) =>
    edit(
      COMPONENT,
      APP_ELEMENT,
      '<app id="payers-claims" src="agentic-ui-config/app.json" enabled="false">',
    ),
  [],
  'note: no component contributes the app, so the app registry will not serve it on a server',
);
// An app's address, its id when it has none, is where the shell is to open it: one that is a page
// the platform has already is refused (PLATFORM_ROUTES in libs/shared/app-definition).
expectRefused(
  "an app whose address is one of the platform's routes",
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/app.json',
      '"id": "payers-claims",',
      '"id": "payers-claims",\n  "address": "contracts",',
    ),
  2,
  `address: the address "contracts" is the platform's own page, /contracts`,
);
// The same clash through the id, with no address written, is said and built: refused, it would
// refuse the contracts kit, built before the rule. The app-package generator writes the address.
expectBuilt(
  "an app whose id is one of the platform's routes, with no address: built, and told",
  ({ edit }) => {
    edit('bundle/agentic-ui-config/app.json', '"id": "payers-claims",', '"id": "contracts",');
    edit(COMPONENT, APP_ELEMENT, '<app id="contracts" src="agentic-ui-config/app.json">');
  },
  [],
  `note: with no "address", the app's address is its id, "contracts", which is the platform's own page, /contracts`,
);
expectRefused(
  "an app contributed under an id that is not app.json's",
  ({ edit }) =>
    edit(COMPONENT, APP_ELEMENT, '<app id="payers-claim" src="agentic-ui-config/app.json">'),
  2,
  `contributes the app "payers-claim", and app.json's id is "payers-claims"`,
);
expectRefused(
  'an app contributed from an app.json the validator did not read',
  ({ edit }) => edit(COMPONENT, APP_ELEMENT, '<app id="payers-claims" src="other/app.json">'),
  2,
  'contributes the app payers-claims from other/app.json',
);
expectRefused(
  'a file of the app the component does not name, which the registry would not serve',
  ({ edit }) => edit(COMPONENT, QUEUE_FILE, ''),
  2,
  'does not name queues/unassigned-claims.json in the app payers-claims',
);
expectRefused(
  'a file the component names and the package does not hold',
  ({ edit }) =>
    edit(COMPONENT, QUEUE_FILE, `${QUEUE_FILE}\n      <file path="queues/gone.json" />`),
  2,
  'names the file queues/gone.json of the app payers-claims, and bundle/agentic-ui-config/ has no such file',
);
expectRefused(
  'a file the component names at no place the registry serves',
  ({ edit }) =>
    edit(
      COMPONENT,
      QUEUE_FILE,
      `${QUEUE_FILE}\n      <file path="layouts/Claim/view.layout.json" />`,
    ),
  2,
  'names the file "layouts/Claim/view.layout.json" of the app payers-claims, which is not a file the app registry serves',
);
expectRefused(
  'a second app in the same package',
  ({ edit }) =>
    edit(
      COMPONENT,
      APP_ELEMENT,
      `<app id="other" src="agentic-ui-config/app.json" />\n    ${APP_ELEMENT}`,
    ),
  2,
  'contribute 2 apps; a package is one app',
);
expectRefused(
  'an app contributed from a src the server would not read as it is written',
  ({ edit }) =>
    edit(COMPONENT, APP_ELEMENT, '<app id="payers-claims" src="./agentic-ui-config/app.json">'),
  2,
  'contributes the app payers-claims from ./agentic-ui-config/app.json',
);
expectRefused(
  'an app contributed to a misspelt point, where nothing registers it',
  ({ edit }) =>
    edit(
      COMPONENT,
      `point="configuration">\n    ${APP_ELEMENT}`,
      `point="configurations">\n    ${APP_ELEMENT}`,
    ),
  2,
  `contributes the app payers-claims outside an extension of org.nuxeo.agentic.ui.config's "configuration" point`,
);
expectRefused(
  'an app naming more files than the registry serves',
  ({ edit }) =>
    edit(
      COMPONENT,
      QUEUE_FILE,
      Array.from({ length: 257 }, (_, i) => `<file path="queues/q${i}.json" />`).join('\n      '),
    ),
  2,
  'files of the app payers-claims; the app registry serves at most 256',
);
expectBuilt('an app whose files the component names in another order', ({ directory }) => {
  const path = join(directory, COMPONENT);
  const text = readFileSync(path, 'utf8');
  const files = [...text.matchAll(/^ *<file path="[^"]+" \/>\n/gm)].map(([line]) => line);
  if (files.length < 2) throw new Error('the demo names fewer than two files');
  writeFileSync(path, text.replace(files.join(''), [...files].reverse().join('')));
});

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
// Nothing is read through a symbolic link in the bundle, and a component path must stay in bundle/
// and name a file there. Step 2 refuses the rest before reading anything: read, a component outside would have its layout attributes quoted
// back, from wherever it is. The marker below is such an attribute; `never` holds it out of the
// output. Where a control's target is a folder, any read of it would crash instead of refusing.
const MARKER = 'read-from-outside-the-package';
const OUTSIDE = `<component name="outside"><extension target="org.nuxeo.agentic.ui.config" point="configuration"><layout type="Outside" mode="view" src="${MARKER}" /></extension></component>`;
const DEMO_COMPONENT = 'OSGI-INF/payers-claims-demo-config.xml';
/** The demo's manifest, naming its own component and `extra` after it. */
const manifestNaming = (extra) =>
  `${[...headersBut(), `Nuxeo-Component: ${DEMO_COMPONENT}, ${extra}`].join('\n')}\n`;
expectRefused(
  'a component path that climbs out of bundle/ with ..',
  ({ directory, write }) => {
    writeFileSync(join(directory, '..', 'outside.xml'), OUTSIDE);
    write(MANIFEST, manifestNaming('../../outside.xml'));
  },
  2,
  'names the component ../../outside.xml, which is outside bundle/',
  [],
  { never: MARKER },
);
expectRefused(
  'a component path that is absolute, naming a folder any read of which would crash',
  ({ directory, write }) => {
    mkdirSync(join(directory, '..', 'outside-folder'));
    write(MANIFEST, manifestNaming(join(directory, '..', 'outside-folder')));
  },
  2,
  (scratch) =>
    `names the component ${join(scratch, 'payers-claims-demo', '..', 'outside-folder')}, which is an absolute path`,
);
expectRefused(
  'a component that is a link to a file outside the package',
  ({ directory }) => {
    const outside = join(directory, '..', 'outside.xml');
    writeFileSync(outside, OUTSIDE);
    const component = join(directory, 'bundle', DEMO_COMPONENT);
    rmSync(component);
    symlinkSync(outside, component);
  },
  1,
  `bundle/${DEMO_COMPONENT} is a symbolic link, which is not followed`,
  [],
  { never: MARKER },
);
expectRefused(
  'a component reached through a folder that is a link out of the package',
  ({ directory, write }) => {
    const outside = join(directory, '..', 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'x.xml'), OUTSIDE);
    symlinkSync(outside, join(directory, 'bundle', 'LINKED'));
    write(MANIFEST, manifestNaming('LINKED/x.xml'));
  },
  1,
  'bundle/LINKED is a symbolic link, which is not followed',
  [],
  { never: MARKER },
);
expectRefused(
  'a component that is a hard link to a file outside the package',
  ({ directory }) => {
    const outside = join(directory, '..', 'outside.xml');
    writeFileSync(outside, OUTSIDE);
    const component = join(directory, 'bundle', DEMO_COMPONENT);
    rmSync(component);
    linkSync(outside, component);
  },
  2,
  `names the component ${DEMO_COMPONENT}, which has a second name, a hard link`,
  [],
  { never: MARKER },
);
expectRefused(
  'a component that names a folder of the bundle, which step 2 once crashed on',
  ({ write }) => write(MANIFEST, manifestNaming('OSGI-INF')),
  2,
  'names the component OSGI-INF, which is a folder, not a file',
);
expectRefused(
  'a MANIFEST.MF that is a folder, which step 2 once crashed on',
  ({ directory }) => {
    rmSync(join(directory, MANIFEST));
    mkdirSync(join(directory, MANIFEST));
  },
  2,
  'bundle/META-INF/MANIFEST.MF is not a file',
);
expectRefused(
  'a bundle/ that is itself a link, which the validator would read through',
  ({ directory }) => {
    const elsewhere = join(directory, '..', 'elsewhere');
    renameSync(join(directory, 'bundle'), elsewhere);
    symlinkSync(elsewhere, join(directory, 'bundle'));
  },
  1,
  'bundle is a symbolic link, which is not followed',
);
expectRefused(
  'an actions.json that is a link to a file outside, which the validator would quote',
  ({ directory }) => {
    const outside = join(directory, '..', 'outside.txt');
    writeFileSync(outside, MARKER);
    const actions = join(directory, 'bundle', 'agentic-ui-config', 'actions.json');
    rmSync(actions);
    symlinkSync(outside, actions);
  },
  1,
  'bundle/agentic-ui-config/actions.json is a symbolic link, which is not followed',
  [],
  { never: MARKER },
);
// Run as root, every file can be read, and Windows has no such mode bits, so these controls have
// nothing to show there.
const canHideFiles = process.platform !== 'win32' && process.getuid?.() !== 0;
if (canHideFiles)
  expectRefused(
    'a component that cannot be read, which step 2 once crashed on',
    ({ directory }) => chmodSync(join(directory, 'bundle', DEMO_COMPONENT), 0o000),
    2,
    `names the component ${DEMO_COMPONENT}, which cannot be read: EACCES`,
  );
expectRefused(
  'a build.mjs that is a link, which steps 1 and 4 would follow to another package',
  ({ directory }) => {
    const elsewhere = join(directory, '..', 'build.mjs');
    renameSync(join(directory, 'build.mjs'), elsewhere);
    symlinkSync(elsewhere, join(directory, 'build.mjs'));
  },
  1,
  'build.mjs is a symbolic link, which is not followed',
);
// Its name and version are not read through the link, so the earlier zip of that name stays: had
// the link been read, the zip would have been cleared.
expectRefused(
  'a package.xml that is a link, which would be read before step 1',
  ({ directory }) => {
    const elsewhere = join(directory, '..', 'package.xml');
    renameSync(join(directory, 'package', 'package.xml'), elsewhere);
    symlinkSync(elsewhere, join(directory, 'package', 'package.xml'));
  },
  1,
  'package/package.xml is a symbolic link, which is not followed',
  [],
  { staleStays: true },
);
// Nothing else before the builder looks at install.xml, so without step 1's check a folder there
// was refused only at step 4.
expectRefused(
  'an install.xml that is a folder',
  ({ directory }) => {
    rmSync(join(directory, 'package', 'install.xml'));
    mkdirSync(join(directory, 'package', 'install.xml'));
  },
  1,
  'package/install.xml is not a file',
);
// Its name cannot be read, so no earlier zip is planted, as for a package.xml that is missing.
expectRefused(
  'a package.xml that is a folder',
  ({ directory }) => {
    rmSync(join(directory, 'package', 'package.xml'));
    mkdirSync(join(directory, 'package', 'package.xml'));
  },
  3,
  'package/package.xml cannot be read (EISDIR)',
  [],
  { stale: false },
);
// Step 2 names nothing here and leaves it to the builder, which refuses the package at step 4.
expectRefused(
  'a component path through a file, which step 2 once crashed on',
  ({ write }) => write(MANIFEST, manifestNaming(`${DEMO_COMPONENT}/x.xml`)),
  4,
  'build.mjs refused the package',
);
if (canHideFiles)
  expectRefused(
    'a package.xml that cannot be read, which step 3 once called missing',
    ({ directory }) => chmodSync(join(directory, 'package', 'package.xml'), 0o000),
    3,
    'package/package.xml cannot be read (EACCES)',
    [],
    {
      stale: false,
      after: (directory) => chmodSync(join(directory, 'package', 'package.xml'), 0o644),
    },
  );
if (canHideFiles)
  expectRefused(
    'a folder of the package that cannot be read, which the search for links reports',
    ({ directory }) => chmodSync(join(directory, 'bundle', 'agentic-ui-config', 'queues'), 0o000),
    1,
    'bundle/agentic-ui-config/queues cannot be read (EACCES)',
    [],
    {
      after: (directory) =>
        chmodSync(join(directory, 'bundle', 'agentic-ui-config', 'queues'), 0o755),
    },
  );
expectRefused(
  'a component that names the bundle itself',
  ({ write }) => write(MANIFEST, manifestNaming('.')),
  2,
  'names the component ., which is bundle/ itself',
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
      '"transition": "pay",',
      '"operation": "Payers.ApproveClaim",',
    );
    // The deployment's, so beside the package rather than in it, with the kit's own two chains.
    const kit = JSON.parse(readFileSync(join(DEMO, BUILD_ALLOW_LIST), 'utf8')).operations;
    write('../allow-list.json', JSON.stringify({ operations: [...kit, 'Payers.ApproveClaim'] }));
  },
  (scratch) => ['--allow-list', join(scratch, 'allow-list.json')],
);

// The operation buttons (plan decision 3, on its recommendation): the kit's run two chains, which
// the deployment allows, and which a package may never allow itself.
expectRefused(
  "the kit's buttons, given an allow-list that holds none of their chains",
  ({ write }) => write('../empty-allow-list.json', JSON.stringify({ operations: [] })),
  2,
  `the operation "Payers.RequestMedicalRecords" is not on this deployment's allow-list`,
  (scratch) => ['--allow-list', join(scratch, 'empty-allow-list.json')],
);
const OPERATIONS = 'bundle/OSGI-INF/payers-claims-demo-operations.xml';
const ALLOW_ITSELF =
  '<extension target="org.nuxeo.agentic.ui.operations" point="allowList">\n' +
  '    <operation id="Payers.ReferToInvestigations" />\n  </extension>\n</component>';
expectRefused(
  "a package that allows its own operations, contributing to the server's allow-list",
  ({ edit }) => edit(OPERATIONS, '</component>', ALLOW_ITSELF),
  2,
  `contributes to org.nuxeo.agentic.ui.operations's "allowList" point, the server's allow-list`,
);
expectRefused(
  "a package that removes an operation from the server's allow-list, with a disabled entry",
  ({ edit }) =>
    edit(
      OPERATIONS,
      '</component>',
      ALLOW_ITSELF.replace(
        '<operation id="Payers.ReferToInvestigations" />',
        '<operation id="Payers.RequestMedicalRecords" enabled="false" />',
      ),
    ),
  2,
  'contributes to org.nuxeo.agentic.ui.operations',
);
expectRefused(
  "a package that contributes to the server's allow-list from another of its components",
  ({ edit }) =>
    edit(
      'bundle/OSGI-INF/payers-claims-demo-model.xml',
      '</component>',
      ALLOW_ITSELF.replace('point="allowList"', 'point="anything"'),
    ),
  2,
  `OSGI-INF/payers-claims-demo-model.xml contributes to org.nuxeo.agentic.ui.operations's "anything" point`,
);
expectRefused(
  "a package that names the allow-list's component as a service, which Nuxeo reads as the same",
  ({ edit }) =>
    edit(
      OPERATIONS,
      '</component>',
      ALLOW_ITSELF.replace(
        'target="org.nuxeo.agentic.ui.operations"',
        'target=" service:org.nuxeo.agentic.ui.operations "',
      ),
    ),
  2,
  `contributes to org.nuxeo.agentic.ui.operations's "allowList" point`,
);
expectRefused(
  "a package that replaces the guard a button's chain begins with, by a chain of its id",
  ({ edit }) =>
    edit(
      OPERATIONS,
      '<chain id="Payers.ReferToInvestigations">',
      '<chain id="AgenticUi.RequireRunAction"><operation id="Context.FetchDocument" /></chain>\n    <chain id="Payers.ReferToInvestigations">',
    ),
  2,
  'names a chain or a scripted operation AgenticUi.RequireRunAction',
);
expectRefused(
  "a package whose chain takes the guard's id as an alias, which replaces it as surely",
  ({ edit }) =>
    edit(
      OPERATIONS,
      '<chain id="Payers.ReferToInvestigations">',
      '<chain id="Payers.Noop"><aliases><alias> AgenticUi.RequireRunAction </alias></aliases><operation id="Context.FetchDocument" /></chain>\n    <chain id="Payers.ReferToInvestigations">',
    ),
  2,
  'names a chain or a scripted operation AgenticUi.RequireRunAction',
);
expectRefused(
  "a package whose scripted operation takes the run endpoint's id",
  ({ edit }) =>
    edit(
      OPERATIONS,
      '</component>',
      '<extension target="org.nuxeo.automation.scripting.internals.AutomationScriptingComponent" point="operation">\n    <scriptedOperation id="AgenticUi.RunAction"><script>function run(input, params) { return input; }</script></scriptedOperation>\n  </extension>\n</component>',
    ),
  2,
  'names a chain or a scripted operation AgenticUi.RunAction',
);
expectRefused(
  "a package with a deployment fragment, which could write into the server's configuration",
  ({ write }) =>
    write(
      'bundle/OSGI-INF/deployment-fragment.xml',
      '<?xml version="1.0"?>\n<fragment version="1"><install><copy from="x" to="${nuxeo.config.dir}/y-config.xml" /></install></fragment>\n',
    ),
  5,
  'bundle/OSGI-INF/deployment-fragment.xml is a deployment fragment',
);
expectRefused(
  "an install.xml that also copies a file into the server's configuration",
  ({ edit }) =>
    edit(
      'package/install.xml',
      '</install>',
      '  <copy file="${package.root}/install/bundles" todir="${env.config}" />\n</install>',
    ),
  5,
  "package/install.xml does more than copy the bundle into the server's bundles: it has <copy>",
);
expectRefused(
  "an install.xml with a second update, into the server's configuration",
  ({ edit }) =>
    edit(
      'package/install.xml',
      '</install>',
      '  <update file="${package.root}/install/bundles" todir="${env.config}" />\n</install>',
    ),
  5,
  'package/install.xml does more than copy the bundle',
);
// The verifier refuses this one before the configuration check would: a package's one update must
// copy its bundle into ${env.bundles}.
expectRefused(
  "an install.xml whose one update copies the bundle into the server's configuration",
  ({ edit }) => edit('package/install.xml', 'todir="${env.bundles}"', 'todir="${env.config}"'),
  5,
  'is not a well-formed Nuxeo Package',
);

// Versions (package-pipeline.md, section 8): given the package as it was, `--previous`, the
// version must move as far as what changed needs. Each control builds the previous package and this
// one from the demo, each at a version of its own, and changes one of them in one way. JSON is
// edited as JSON, so the controls hold whatever the demo's files say.
const NEXT_MINOR = VERSION.replace(
  /^(\d+)\.(\d+)\.\d+.*$/,
  (_, major, minor) => `${major}.${Number(minor) + 1}.0`,
);
const APP = 'bundle/agentic-ui-config/app.json';
const LABELS = 'bundle/agentic-ui-config/labels/en.json';
const ACTIONS = 'bundle/agentic-ui-config/actions.json';
const HOME = 'bundle/agentic-ui-config/home.json';
const NAVIGATION = 'bundle/agentic-ui-config/navigation.json';

/** `directory`'s package at `version`, in the three places that carry it. */
function setVersion(directory, version) {
  for (const [file, from, to] of [
    [APP, `"packageVersion": "${VERSION}"`, `"packageVersion": "${version}"`],
    ['package/package.xml', `version="${VERSION}">`, `version="${version}">`],
    ['bundle/META-INF/MANIFEST.MF', `Bundle-Version: ${VERSION}`, `Bundle-Version: ${version}`],
  ]) {
    const path = join(directory, file);
    const text = readFileSync(path, 'utf8');
    if (!text.includes(from)) throw new Error(`the control cannot set the version in ${file}`);
    writeFileSync(path, text.replace(from, to));
  }
}

/** A JSON file of `directory`, changed by `change` and written back. */
function jsonEdit(directory, file, change) {
  const path = join(directory, file);
  const content = JSON.parse(readFileSync(path, 'utf8'));
  change(content);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

/** The first queue file of `directory`'s package, relative to it. */
function firstQueue(directory) {
  const queues = join(directory, 'bundle/agentic-ui-config/queues');
  const name = readdirSync(queues).find((file) => file.endsWith('.json'));
  if (!name) throw new Error('the demo has no queue for the control to move');
  return `bundle/agentic-ui-config/queues/${name}`;
}

/**
 * The demo's component, changed by `change`: a control that adds or removes a file of the app
 * definition names it, or stops naming it, in the app's contribution too, as a package would.
 */
function contribution(directory, change) {
  const path = join(directory, 'bundle/OSGI-INF/payers-claims-demo-config.xml');
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before)
    throw new Error("the control's change to the app's contribution does not apply");
  writeFileSync(path, after);
}

/** `queues/added-queue.json` named in the app's contribution. */
const contributeAddedQueue = (directory) =>
  contribution(directory, (xml) =>
    xml.replace(
      '<app id="payers-claims" src="agentic-ui-config/app.json">',
      (app) => `${app}\n      <file path="queues/added-queue.json" />`,
    ),
  );

/** The first schema file of `directory`'s bundle, relative to it: outside the app definition. */
function firstSchema(directory) {
  const schemas = join(directory, 'bundle/schemas');
  const name = readdirSync(schemas).find((file) => file.endsWith('.xsd'));
  if (!name) throw new Error('the demo has no schema for the control to change');
  return `bundle/schemas/${name}`;
}

/**
 * The first queue removed, with the home's cards and the menu's entries that name it: the demo's
 * home and menu name every one of its queues, and a package that names a queue it lacks is refused
 * at step 2, before step 3 could judge the removal.
 */
const removeQueue = (directory) => {
  const queue = firstQueue(directory);
  const id = basename(queue, '.json');
  rmSync(join(directory, queue));
  // And its contribution to the app registry, which step 2 holds to the files the package has.
  contribution(directory, (xml) => xml.replace(`<file path="queues/${id}.json" />`, ''));
  for (const [file, list] of [
    [HOME, 'cards'],
    [NAVIGATION, 'entries'],
  ])
    if (existsSync(join(directory, file)))
      jsonEdit(directory, file, (content) => {
        content[list] = content[list].filter((item) => item.queue !== id);
      });
};
/**
 * `removeQueue`, with the migration note the upgrade check asks for (package-pipeline.md, section
 * 10): the queue and the menu entries that named it, at `version`.
 */
const removeQueueWithItsNote = (version) => (directory) => {
  const id = basename(firstQueue(directory), '.json');
  const entries = JSON.parse(readFileSync(join(directory, NAVIGATION), 'utf8'))
    .entries.filter((entry) => entry.queue === id)
    .map((entry) => `menu-entry ${entry.id}`);
  removeQueue(directory);
  writeFileSync(
    join(directory, 'upgrade-notes.json'),
    `${JSON.stringify({ version: 1, notes: [{ version, items: [`queue ${id}`, ...entries], note: `The queue ${id} is gone: name another.` }] }, null, 2)}\n`,
  );
};
const changeLabelText = (directory) =>
  jsonEdit(directory, LABELS, (labels) => {
    const [key] = Object.keys(labels.labels);
    labels.labels[key] = `${labels.labels[key]} (changed)`;
  });

/**
 * The previous package at `from`, changed by `before`, and this one at `to`, changed by `after`,
 * run with `--previous`, and `args`, made from the scratch directory, after it. `refused`: exit 1 at
 * step 3 for that reason, no zip and no changelog. Otherwise built, with a changelog holding each
 * of `changelog`.
 */
function expectVersion(
  what,
  { from, to, before = () => undefined, after = () => undefined, args = () => [] },
  expected,
) {
  if (expected.refused) negative++;
  else positive++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-version-'));
  const previous = join(scratch, 'previous');
  const directory = join(scratch, 'payers-claims-demo');
  const out = join(scratch, 'out');
  try {
    for (const [copy, version, change] of [
      [previous, from, before],
      [directory, to, after],
    ]) {
      cpSync(DEMO, copy, { recursive: true, filter: (path) => basename(path) !== 'dist' });
      setVersion(copy, version);
      change(copy);
    }
    const zip = join(out, `payers-claims-demo-${to}.zip`);
    const changes = join(out, `payers-claims-demo-${to}.changes.md`);
    // An earlier run's changelog for the same version: a refused run must not leave it, and a
    // built one must replace it.
    mkdirSync(out, { recursive: true });
    writeFileSync(changes, 'an earlier run left this');
    const { status, output } = run(directory, out, ['--previous', previous, ...args(scratch)]);
    const problems = [];
    if (expected.refused) {
      if (status !== 1) problems.push(`exit ${status}, not 1`);
      if (!output.includes('step 3 refused it')) problems.push('not refused at step 3');
      if (!output.includes(expected.refused)) problems.push(`no "${expected.refused}"`);
      if (existsSync(zip)) problems.push('a zip is left');
      if (existsSync(changes)) problems.push('a changelog is left');
    } else {
      if (status !== 0) problems.push(`exit ${status}, not 0`);
      if (!existsSync(zip)) problems.push('no zip');
      const text = existsSync(changes) ? readFileSync(changes, 'utf8') : '';
      if (!text.startsWith(`# payers-claims-demo ${to}\n`))
        problems.push('no changelog, under its heading');
      for (const line of expected.changelog)
        if (!text.includes(line)) problems.push(`the changelog has no "${line}"`);
    }
    if (problems.length > 0)
      failures.push(`${what}: ${problems.join('; ')}\n${output.trim().replace(/^/gm, '    ')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

expectVersion(
  'content changed, and the version did not move',
  { from: VERSION, to: VERSION, after: changeLabelText },
  {
    refused: `and the version is still ${VERSION}. Raise it to ${OTHER} at least, a patch version`,
  },
);
expectVersion(
  'a breaking change below 1.0.0, raising only the patch',
  { from: VERSION, to: OTHER, after: removeQueue },
  { refused: 'need a minor version (below 1.0.0, a breaking change raises the minor' },
);
expectVersion(
  'an addition from 1.0.0, raising only the patch',
  {
    from: '1.0.0',
    to: '1.0.1',
    // Named in both versions' contribution, so that the queue's file is the one change: the
    // component's own change would need a minor of itself.
    before: (directory) => contributeAddedQueue(directory),
    after: (directory) => {
      cpSync(
        join(directory, firstQueue(directory)),
        join(directory, 'bundle/agentic-ui-config/queues/added-queue.json'),
      );
      contributeAddedQueue(directory);
    },
  },
  {
    refused:
      'need a minor version, and 1.0.1 raises the patch. For one: The queue added-queue is added.',
  },
);
expectVersion(
  'a label key removed from 1.0.0, raising only the minor',
  {
    from: '1.0.0',
    to: '1.1.0',
    before: (directory) =>
      jsonEdit(directory, LABELS, (labels) => (labels.labels['payers.only.before'] = 'Gone')),
  },
  {
    refused:
      'need a major version, and 1.1.0 raises the minor. For one: The label payers.only.before, in en, is removed',
  },
);
expectVersion(
  'an action removed below 1.0.0, raising only the patch',
  {
    from: VERSION,
    to: OTHER,
    before: (directory) =>
      jsonEdit(directory, ACTIONS, (file) =>
        file.actions.push({ ...file.actions[0], id: 'payers.claim.reopen' }),
      ),
  },
  { refused: 'For one: The action payers.claim.reopen is removed' },
);
expectVersion(
  "the app's address changed from 1.0.0, raising only the minor",
  {
    from: '1.0.0',
    to: '1.1.0',
    after: (directory) => jsonEdit(directory, APP, (app) => (app.address = 'claims-desk')),
  },
  {
    refused:
      "need a major version, and 1.1.0 raises the minor. For one: The app's address is claims-desk",
  },
);
expectVersion(
  'a group losing the app from 1.0.0, raising only the minor',
  {
    from: '1.0.0',
    to: '1.1.0',
    // A group the demo does not give the app, so that the package as it is has lost it.
    before: (directory) => jsonEdit(directory, APP, (app) => app.groups.push('claims-auditors')),
  },
  { refused: 'For one: The group claims-auditors no longer has the app.' },
);
expectVersion(
  'a platform range that leaves out a version it admitted, from 1.0.0, raising only the minor',
  {
    from: '1.0.0',
    to: '1.1.0',
    before: (directory) => jsonEdit(directory, APP, (app) => (app.platform = '>=0.0.1 <1.0.0')),
    after: (directory) => jsonEdit(directory, APP, (app) => (app.platform = '>=0.0.1 <0.9.0')),
  },
  { refused: 'a server on a version the old range admitted cannot run this one' },
);
expectVersion(
  'a change outside the app definition from 1.0.0, raising only the patch',
  {
    from: '1.0.0',
    to: '1.0.1',
    after: (directory) => {
      const schema = join(directory, firstSchema(directory));
      writeFileSync(schema, `${readFileSync(schema, 'utf8')}<!-- changed -->\n`);
    },
  },
  { refused: 'need a minor version, and 1.0.1 raises the patch' },
);
expectVersion(
  'a version lower than the previous one',
  { from: OTHER, to: VERSION },
  { refused: `${VERSION} is lower than the previous version, ${OTHER}` },
);
expectVersion(
  "app.json's id changed",
  {
    from: VERSION,
    to: NEXT_MINOR,
    after: (directory) => {
      jsonEdit(directory, APP, (app) => (app.id = 'payers-claims-two'));
      // As a package that renames its app contributes it: step 2 holds the two to each other.
      contribution(directory, (xml) =>
        xml.replace('<app id="payers-claims" ', '<app id="payers-claims-two" '),
      );
    },
  },
  { refused: "app.json's id is payers-claims-two, and was payers-claims. An app keeps its id" },
);
expectVersion(
  "the package's name changed",
  {
    from: VERSION,
    to: NEXT_MINOR,
    before: (directory) => {
      const descriptor = join(directory, 'package/package.xml');
      writeFileSync(
        descriptor,
        readFileSync(descriptor, 'utf8').replace(
          'name="payers-claims-demo"',
          'name="payers-claims-old"',
        ),
      );
    },
  },
  { refused: 'the previous package is payers-claims-old, and this one is payers-claims-demo' },
);
expectVersion(
  'a breaking change in a later prerelease of a patch version',
  { from: '1.0.1-rc.1', to: '1.0.1-rc.2', after: removeQueue },
  {
    refused:
      'need a major version, and 1.0.1-rc.2 is a prerelease of 1.0.1, which raises the patch.',
  },
);
expectVersion(
  "the manifest's Bundle-Version changed alone, at the same version",
  {
    from: VERSION,
    to: VERSION,
    after: (directory) => {
      const manifest = join(directory, 'bundle/META-INF/MANIFEST.MF');
      writeFileSync(
        manifest,
        readFileSync(manifest, 'utf8').replace(
          `Bundle-Version: ${VERSION}`,
          'Bundle-Version: 9.9.9',
        ),
      );
    },
  },
  { refused: `the manifest's Bundle-Version is 9.9.9, and package.xml's version is ${VERSION}` },
);

expectVersion(
  'unchanged, at the same version',
  { from: VERSION, to: VERSION },
  { changelog: [`No change since ${VERSION}.`] },
);
expectVersion(
  'only the version raised, in its three places',
  { from: VERSION, to: OTHER },
  { changelog: [`No change since ${VERSION}; the version moved to ${OTHER} all the same.`] },
);
expectVersion(
  'a change, raising the patch',
  { from: VERSION, to: OTHER, after: changeLabelText },
  {
    changelog: [
      `Since ${VERSION}: 1 change, which needs a patch version. ${OTHER} raises the patch.`,
      '## Changed',
      ', in en, changed.',
    ],
  },
);
expectVersion(
  'a breaking change below 1.0.0, raising the minor, with its migration note',
  { from: VERSION, to: NEXT_MINOR, after: removeQueueWithItsNote(NEXT_MINOR) },
  {
    changelog: [
      '## Breaking',
      'is removed: a link to it, a menu entry or a home card naming it stops working.',
      '## Upgrading',
      `, since ${NEXT_MINOR}: The queue `,
    ],
  },
);
expectVersion(
  'a change outside the app definition from 1.0.0, raising the minor',
  {
    from: '1.0.0',
    to: '1.1.0',
    after: (directory) => {
      const schema = join(directory, firstSchema(directory));
      writeFileSync(schema, `${readFileSync(schema, 'utf8')}<!-- changed -->\n`);
    },
  },
  { changelog: ['## To judge', 'changed.', 'which a person decides'] },
);
expectVersion(
  'a platform range that admits more, from 1.0.0, raising the minor',
  {
    from: '1.0.0',
    to: '1.1.0',
    before: (directory) => jsonEdit(directory, APP, (app) => (app.platform = '>=0.0.1 <0.9.0')),
    after: (directory) => jsonEdit(directory, APP, (app) => (app.platform = '>=0.0.1 <1.0.0')),
  },
  { changelog: ['## Added', 'it admits more platform versions.'] },
);
expectVersion(
  'a Markdown file in the bundle and a JSON file re-spaced, neither of which the zip shows',
  {
    from: VERSION,
    to: VERSION,
    before: (directory) => writeFileSync(join(directory, 'bundle/NOTES.md'), 'one\n'),
    after: (directory) => {
      writeFileSync(join(directory, 'bundle/NOTES.md'), 'two\n');
      const labels = join(directory, LABELS);
      writeFileSync(labels, JSON.stringify(JSON.parse(readFileSync(labels, 'utf8'))));
    },
  },
  { changelog: [`No change since ${VERSION}.`] },
);
expectVersion(
  'a breaking change in a later prerelease of a major version, with its migration note',
  { from: '1.0.0-rc.1', to: '1.0.0-rc.2', after: removeQueueWithItsNote('1.0.0-rc.2') },
  { changelog: ['## Breaking', '1.0.0-rc.2 is a later prerelease of the same version.'] },
);

// The upgrade (package-pipeline.md, section 10): given the package as it was, step 3 also holds
// it to what a customer's configuration made on that version still finds. A menu entry is a
// change to the version rules, and a patch passes them; the upgrade check asks a note and a minor.
const dropMineEntry = (directory) =>
  jsonEdit(directory, NAVIGATION, (menu) => {
    menu.entries = menu.entries.filter((entry) => entry.id !== 'mine');
  });
expectVersion(
  'a menu entry removed at a patch version, which the version rules pass and the upgrade does not',
  { from: VERSION, to: OTHER, after: dropMineEntry },
  { refused: `the upgrade from ${VERSION} does not keep every customer configuration: 2 findings` },
);
expectVersion(
  'a menu entry removed, with its migration note, at a minor version',
  {
    from: VERSION,
    to: NEXT_MINOR,
    after: (directory) => {
      dropMineEntry(directory);
      writeFileSync(
        join(directory, 'upgrade-notes.json'),
        `${JSON.stringify({ version: 1, notes: [{ version: NEXT_MINOR, item: 'menu-entry mine', note: 'The entry is gone from the menu: open the queue my-claims at its address.' }] })}\n`,
      );
    },
  },
  {
    changelog: [
      '## Upgrading',
      `- \`menu-entry mine\`, since ${NEXT_MINOR}: The entry is gone from the menu: open the queue my-claims at its address.`,
    ],
  },
);

// The platform as it was, `--previous-platform`: a rule the package named as it was, which the
// platform as it was registered and this repository's does not, is refused at step 3 with no
// platform note. The package as it is no longer names it, so step 2 passes.
const UPGRADE_PLATFORM = [
  'docs/extension-reference.md',
  'libs/shared/app-definition/src/lib',
  'nuxeo-agentic-core/src/main/resources/OSGI-INF',
  'nuxeo-agentic-core/src/main/java',
  'apps/nuxeo-ui/src/app/business-apps.menu.ts',
  'libs/platform/package.json',
];
expectVersion(
  'a rule the package named, gone from the platform as it is, with no platform note',
  {
    from: VERSION,
    to: OTHER,
    before: (directory) =>
      jsonEdit(directory, HOME, (home) =>
        home.cards.push({
          id: 'urgent',
          queue: 'unassigned-claims',
          visibleWhen: 'app.rules.isUrgent',
        }),
      ),
    args: (scratch) => {
      const platform = join(scratch, 'platform-before');
      for (const path of UPGRADE_PLATFORM)
        cpSync(join(REPO, path), join(platform, path), { recursive: true });
      const registries = join(platform, 'libs/shared/app-definition/src/lib/registries.ts');
      const text = readFileSync(registries, 'utf8');
      const anchor = "    'app.rules.dateAfter',\n  ].map(";
      if (!text.includes(anchor))
        throw new Error("the control cannot add a rule to the platform's registries");
      writeFileSync(
        registries,
        text.replace(anchor, "    'app.rules.dateAfter',\n    'app.rules.isUrgent',\n  ].map("),
      );
      return ['--previous-platform', platform];
    },
  },
  {
    refused:
      'platform, id app.rules.isUrgent: The platform no longer has the ID app.rules.isUrgent',
  },
);

// The platform as it was is held to only with the package as it was: alone, it is the command's usage.
{
  negative++;
  const { scratch, directory, out } = packageWith();
  try {
    const { status } = run(directory, out, ['--previous-platform', REPO]);
    if (status !== 2)
      failures.push(`--previous-platform with no --previous exits ${status}, not 2`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The previous package is the operator's input: one that is not there stops the run, exit 2.
{
  negative++;
  const { scratch, directory, out } = packageWith();
  try {
    const { status, output } = run(directory, out, ['--previous', join(scratch, 'not-there')]);
    if (status !== 2 || !output.includes('is not a folder'))
      failures.push(`a --previous that is not there exits ${status}, not 2\n${output}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// A facet is one of its page provider's aggregates, and a home's figure may count one's buckets.
// Only a page provider of the search index answers aggregates, and only those it defines: on any
// other, the facet is left out and the figure reads "Unavailable", said only in the console. So a
// page provider the package's own model defines is held to what its definition lists.
const QUEUE = 'bundle/agentic-ui-config/queues/unassigned-claims.json';
expectRefused(
  'a facet naming an aggregate its page provider, in the package, does not define',
  ({ edit }) => edit(QUEUE, '"aggregate": "claim_status_agg"', '"aggregate": "claim_adjuster_agg"'),
  2,
  'queues/unassigned-claims.json: facets[0].aggregate: the page provider "payers_unassigned_claims", defined in OSGI-INF/payers-claims-demo-model.xml, has no aggregate "claim_adjuster_agg": it defines claim_status_agg [unknown]',
);
expectRefused(
  'a facet on a page provider of the package that reads the repository, which answers no aggregate',
  ({ edit }) =>
    edit(QUEUE, '"pageProvider": "payers_unassigned_claims"', '"pageProvider": "member_claims"'),
  2,
  'facets[0].aggregate: the page provider "member_claims", defined in OSGI-INF/payers-claims-demo-model.xml, has no aggregate "claim_status_agg": it reads the repository, which answers none',
);
expectRefused(
  "a home's figure counting an aggregate its page provider does not define",
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/home.json',
      '"kpi": { "pageProvider": "payers_unassigned_claims", "aggregate": "claim_status_agg" }',
      '"kpi": { "pageProvider": "payers_unassigned_claims", "aggregate": "claim_adjuster_agg" }',
    ),
  2,
  'kpi.aggregate: the page provider "payers_unassigned_claims", defined in OSGI-INF/payers-claims-demo-model.xml, has no aggregate "claim_adjuster_agg"',
);
// The controls on those: a page provider the package does not define is the server's, which this
// stage cannot read, so its facets are not held to anything; nor is one whose only definition in
// the package is disabled, which the server does not register.
expectBuilt('a facet on a page provider whose definition the package disables', ({ edit }) => {
  edit(
    'bundle/OSGI-INF/payers-claims-demo-model.xml',
    '<genericPageProvider name="payers_unassigned_claims"',
    '<genericPageProvider name="payers_unassigned_claims" enabled="false"',
  );
  edit(QUEUE, '"aggregate": "claim_status_agg"', '"aggregate": "claim_adjuster_agg"');
});
expectBuilt(
  "a facet on a page provider the package does not define, which is the server's",
  ({ edit }) =>
    edit(QUEUE, '"pageProvider": "payers_unassigned_claims"', '"pageProvider": "default_search"'),
);

// A queue's and a related list's columns and sorts name properties of the records their page
// provider lists. On a page provider of the package's own whose NXQL names its type, they are held
// to that type in the content model, as a layout's fields are held to the type its path names; a
// misspelt column otherwise shows an empty cell, and a misspelt sort fails on the server.
const MEMBER = 'bundle/agentic-ui-config/layouts/Member/view.layout.json';
expectRefused(
  "a queue's column naming a property the records its page provider lists do not have",
  ({ edit }) =>
    edit(QUEUE, '"field": "claim:received", "widget"', '"field": "claim:recieved", "widget"'),
  2,
  'queues/unassigned-claims.json: columns[3].field: "claim:recieved" is not a property of the type "Claim", which the page provider "payers_unassigned_claims" (OSGI-INF/payers-claims-demo-model.xml) lists, or of its facets [unknown]',
);
expectRefused(
  "a queue's sort on a property the records do not have",
  ({ edit }) =>
    edit(QUEUE, '"sort": [{ "field": "claim:received"', '"sort": [{ "field": "claim:receivedOn"'),
  2,
  'queues/unassigned-claims.json: sort[0].field: "claim:receivedOn" is not a property of the type "Claim"',
);
expectRefused(
  "a related list's column naming a property the listed records do not have",
  ({ edit }) => edit(MEMBER, '          "claim:status"\n', '          "claim:state"\n'),
  2,
  'layouts/Member/view.layout.json: cards[1].related.columns[2]: "claim:state" is not a property of the type "Claim", which the page provider "member_claims"',
);
expectRefused(
  "a related list's sort on a property the listed records do not have",
  ({ edit }) =>
    edit(
      MEMBER,
      '"sort": [{ "field": "claim:serviceDate"',
      '"sort": [{ "field": "claim:servicedOn"',
    ),
  2,
  'cards[1].related.sort[0].field: "claim:servicedOn" is not a property of the type "Claim"',
);
expectRefused(
  "a column whose widget does not show its property's type",
  ({ edit }) =>
    edit(QUEUE, '"claim:number",', '{ "field": "claim:number", "widget": "relative-date" },'),
  2,
  'queues/unassigned-claims.json: columns[0].widget: the widget "relative-date" does not show "claim:number", a string property of the type "Claim"',
);
// The controls on those: a page provider the package does not define is the server's, whose type
// this stage cannot read; and the server's own properties, ecm:, are in no schema.
expectBuilt(
  "a misspelt column on a page provider the package does not define, the server's",
  ({ edit }) => {
    edit(QUEUE, '"pageProvider": "payers_unassigned_claims"', '"pageProvider": "default_search"');
    edit(
      QUEUE,
      '"facets": [{ "aggregate": "claim_status_agg", "labelKey": "payers.facet.status" }],',
      '',
    );
    edit(QUEUE, '"field": "claim:received", "widget"', '"field": "claim:recieved", "widget"');
  },
);
expectBuilt("a column of one of the server's own properties", ({ edit }) =>
  edit(QUEUE, '"claim:number",', '"claim:number", "ecm:currentLifeCycleState",'),
);
// A page provider's NXQL is checked for what Nuxeo's grammar has no place for, before a server
// loads it: the moves kit's run found BETWEEN NOW(...) only by a query, which answered 400. Not a
// parse: these are the constructs it refuses, and the controls below are what it must pass.
const PAYERS_MODEL = 'bundle/OSGI-INF/payers-claims-demo-model.xml';
expectRefused(
  "a page provider's pattern with BETWEEN NOW(...), which Nuxeo answers 400",
  ({ edit }) =>
    edit(
      PAYERS_MODEL,
      "ecm:primaryType = 'Claim' AND claim:member = ?",
      "ecm:primaryType = 'Claim' AND claim:member = ? AND claim:serviceDate BETWEEN NOW('-P30D') AND NOW()",
    ),
  2,
  `OSGI-INF/payers-claims-demo-model.xml: pageProviders.member_claims.pattern: BETWEEN takes a literal on each side of its AND`,
);
expectRefused(
  "a page provider's fixed part with a parenthesis left open",
  ({ edit }) =>
    edit(
      PAYERS_MODEL,
      "ecm:primaryType = 'Claim' AND claim:adjuster IS NULL",
      "ecm:primaryType = 'Claim' AND (claim:adjuster IS NULL",
    ),
  2,
  'pageProviders.payers_unassigned_claims.whereClause.fixedPart: a "(" is not closed',
);
expectRefused(
  'BETWEEN NOW(...) in a CDATA section, which is read as the server reads it',
  ({ edit }) =>
    edit(
      PAYERS_MODEL,
      "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:member = ?",
      "<![CDATA[SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:member = ? AND claim:serviceDate BETWEEN NOW('-P30D') AND NOW()]]>",
    ),
  2,
  'pageProviders.member_claims.pattern: BETWEEN takes a literal',
);
// A page provider of a class that does not take NXQL, such as the audit's, whose pattern is a
// query of the audit's own entries, is not read as NXQL.
expectBuilt('an audit page provider, whose pattern is not NXQL', ({ edit }) =>
  edit(
    PAYERS_MODEL,
    '<coreQueryPageProvider name="member_claims">',
    '<genericPageProvider name="payers_claim_history" class="org.nuxeo.ecm.platform.audit.api.AuditPageProvider">\n' +
      '      <pattern>log.docUUID = ? AND log.eventDate IS NOT NULL</pattern>\n' +
      '      <pageSize>20</pageSize>\n' +
      '    </genericPageProvider>\n' +
      '    <coreQueryPageProvider name="member_claims">',
  ),
);
expectBuilt('BETWEEN with literal bounds, and a comparison written in CDATA', ({ edit }) =>
  edit(
    PAYERS_MODEL,
    "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:member = ?",
    "<![CDATA[SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND claim:member = ? AND claim:serviceDate <= NOW('P1D') AND dc:created BETWEEN DATE '2020-01-01' AND DATE '2030-01-01']]>",
  ),
);

// The moves kit's log (its README, step 3): the two misspellings that passed the pipeline before,
// a queue's column and a related list's, on the kit's own page providers and its own model.
{
  negative++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-moves-'));
  const directory = join(scratch, 'moves-demo');
  cpSync(join(REPO, 'business-apps', 'packages', 'moves-demo'), directory, {
    recursive: true,
    filter: (path) => basename(path) !== 'dist',
  });
  try {
    const edit = (file, from, to) => {
      const path = join(directory, file);
      const text = readFileSync(path, 'utf8');
      if (!text.includes(from)) throw new Error(`the moves control's edit does not apply: ${from}`);
      writeFileSync(path, text.replace(from, to));
    };
    edit(
      'bundle/agentic-ui-config/queues/open-claims.json',
      '"dmg:adjuster", "widget"',
      '"dmg:adjustor", "widget"',
    );
    edit(
      'bundle/agentic-ui-config/layouts/Move/view.layout.json',
      '"moveitem:room",',
      '"moveitem:rooms",',
    );
    const { status, output } = run(directory, join(scratch, 'out'));
    const expected = [
      'queues/open-claims.json: columns[6].field: "dmg:adjustor" is not a property of the type "DamageClaim", which the page provider "moves_open_claims"',
      'layouts/Move/view.layout.json: cards[4].related.columns[2]: "moveitem:rooms" is not a property of the type "MoveItem", which the page provider "moves_move_items"',
      'step 2 refused it',
    ];
    const missing = expected.filter((line) => !output.includes(line));
    if (status !== 1 || missing.length > 0)
      failures.push(
        `the moves kit's two misspellings: exit ${status}; no ${missing.join('; no ')}\n${output}`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// A `document-link`'s `show` names a property of the types it links to (layout-v2.md, section 12):
// the claim's move's customer, misspelt, is refused against the kit's own model, naming the type.
{
  negative++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-package-moves-show-'));
  const directory = join(scratch, 'moves-demo');
  cpSync(join(REPO, 'business-apps', 'packages', 'moves-demo'), directory, {
    recursive: true,
    filter: (path) => basename(path) !== 'dist',
  });
  try {
    const path = join(directory, 'bundle/agentic-ui-config/layouts/DamageClaim/view.layout.json');
    const text = readFileSync(path, 'utf8');
    const from = '"show": "move:customer"';
    if (!text.includes(from))
      throw new Error(`the moves show control's edit does not apply: ${from}`);
    writeFileSync(path, text.replace(from, '"show": "move:customr"'));
    const { status, output } = run(directory, join(scratch, 'out'));
    const expected = [
      'layouts/DamageClaim/view.layout.json: cards[0].fields[3].parameters.show: "move:customr" is not a property of the type "Move" or of its facets, one of the types the field links to [unknown]',
      'step 2 refused it',
    ];
    const missing = expected.filter((line) => !output.includes(line));
    if (status !== 1 || missing.length > 0)
      failures.push(
        `the moves kit's misspelt show: exit ${status}; no ${missing.join('; no ')}\n${output}`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// A label key is looked up in the package's labels, then in the platform's catalogue: one with a
// text in neither shows a heading's id made readable, or nothing, so it is refused, by its key.
expectRefused(
  'a label key with a text in neither the package nor the platform',
  ({ edit }) => edit(LAYOUT, '"labelKey": "payers.card.claim"', '"labelKey": "payers.card.claimz"'),
  2,
  `cards[0].labelKey: the label key "payers.card.claimz" has no text in labels/en.json, or in the platform's catalogue [unknown]`,
);
expectRefused(
  'a label key whose text labels/en.json no longer has',
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/labels/en.json',
      '"payers.card.claim": "Claim"',
      '"payers.card.claimOld": "Claim"',
    ),
  2,
  'layouts/Claim/view.layout.json: cards[0].labelKey: the label key "payers.card.claim" has no text',
);
expectBuilt("a label key the platform's catalogue gives a text, nested as it is", ({ edit }) =>
  edit(LAYOUT, '"labelKey": "payers.card.claim"', '"labelKey": "home.title"'),
);
expectBuilt(
  'a label key with no text beside a literal label, which wins and is shown',
  ({ edit }) =>
    edit(
      LAYOUT,
      '"labelKey": "payers.card.claim"',
      '"label": "Claim", "labelKey": "payers.card.claimz"',
    ),
);

// A language's labels, `labels/<locale>.json`, as Crowdin writes them beside `labels/en.json`
// (package-pipeline.md, section 2): a subset of English's keys is built, since each key left out
// falls back to English, and a key English lacks is refused, by its key. Each is named in the
// component, as the app-registry generator names it, so that only the rule under test decides.
const withLanguage =
  (locale, labels) =>
  ({ edit, write }) => {
    write(
      `bundle/agentic-ui-config/labels/${locale}.json`,
      JSON.stringify({ version: 2, labels }, null, 2),
    );
    edit(
      COMPONENT,
      '<file path="labels/en.json" />',
      `<file path="labels/en.json" />\n      <file path="labels/${locale}.json" />`,
    );
  };
expectBuilt(
  "a language's labels that are a subset of English's",
  withLanguage('es', { 'payers.card.claim': 'Reclamación' }),
);
expectBuilt("a language's labels that give no key at all", withLanguage('nb', {}));
expectRefused(
  "a language's labels with a key English lacks",
  withLanguage('fi', { 'payers.card.claim': 'Korvaushakemus', 'payers.card.claimz': 'Hakemus' }),
  2,
  `labels/fi.json: labels["payers.card.claimz"]: labels/en.json has no text for "payers.card.claimz": a language's labels give a text only to a key English has [unknown]`,
);
expectRefused(
  "a language's labels the component does not name, which the registry would not serve",
  ({ write }) =>
    write(
      'bundle/agentic-ui-config/labels/da.json',
      JSON.stringify({ version: 2, labels: { 'payers.card.claim': 'Krav' } }),
    ),
  2,
  'does not name labels/da.json in the app payers-claims',
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
  'an address part naming a subfield its property does not have, given the content model',
  ({ edit }) =>
    edit(
      'bundle/agentic-ui-config/layouts/Member/view.layout.json',
      '"postcode": "zip"',
      '"postcode": "postcode"',
    ),
  2,
  'cards[0].fields[2].parameters.parts.postcode: "member:address" has no subfield "postcode" [unknown]',
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

// With no --model, a package that ships a stand-in model is held to the content-model.json beside
// it, which describes that model: so CI and validate_package, which pass none, refuse a misspelt
// property too.
/** What the pipeline says when it holds a package to its own model. */
const OWN_MODEL_SAID =
  "The content model is the package's own content-model.json, since the package ships a stand-in model and no --model was given.";
expectRefused(
  "a field whose property the type does not have, with no --model: the package's own model refuses it",
  ({ edit }) => edit(LAYOUT, '"claim:number",', '"claim:numbr",'),
  2,
  'cards[0].fields[0]: "claim:numbr" is not a property of the type "Claim" or of its facets [unknown]',
);
expectRefused(
  "a widget that does not show its property, with no --model: the package's own model refuses it",
  BOOLEAN_RECEIVED,
  2,
  RECEIVED_REFUSED,
);
expectBuilt(
  'the demo package, held to its own content model with no --model, as CI runs it',
  unchanged,
  [],
  OWN_MODEL_SAID,
);
// The controls on the controls above: the same layout passes with no model at all, so it is the
// model that refuses it. A package with no content-model.json is held to none; nor is one whose
// content-model.json no stand-in model backs, which describes a server, perhaps changed since.
expectBuilt(
  'a widget that does not show its property, in a package with no content-model.json',
  ({ directory, edit }) => {
    BOOLEAN_RECEIVED({ edit });
    rmSync(join(directory, MODEL));
  },
  [],
  undefined,
  OWN_MODEL_SAID,
);
expectBuilt(
  'a widget that does not show its property, beside a content-model.json no stand-in model backs',
  ({ edit }) => {
    BOOLEAN_RECEIVED({ edit });
    // No component registers a document type any more: the package ships no model of its own.
    for (const component of ['payers-claims-demo-model.xml', 'payers-claims-demo-workflow.xml'])
      edit(`bundle/OSGI-INF/${component}`, 'point="doctype"', 'point="doctypes"');
  },
  [],
  undefined,
  OWN_MODEL_SAID,
);
// A type the package only adds to, `append="true"`, is the server's: no stand-in model of its own.
expectBuilt(
  'a widget that does not show its property, beside a content-model.json, in a package that only appends to types',
  ({ directory, edit }) => {
    BOOLEAN_RECEIVED({ edit });
    for (const component of ['payers-claims-demo-model.xml', 'payers-claims-demo-workflow.xml']) {
      const file = join(directory, 'bundle', 'OSGI-INF', component);
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replaceAll('<doctype name=', '<doctype append="true" name='),
      );
    }
  },
  [],
  undefined,
  OWN_MODEL_SAID,
);
// Given another model, that one is used, and the package's own is not read: here its own is broken.
expectBuilt(
  "a --model given, which the package's own, broken, does not replace",
  ({ directory, edit }) => {
    writeFileSync(
      join(dirname(directory), 'given-model.json'),
      readFileSync(join(directory, MODEL)),
    );
    edit(MODEL, '"Claim": {', '"Claims": {');
  },
  (scratch) => ['--model', join(scratch, 'given-model.json')],
  undefined,
  OWN_MODEL_SAID,
);
// The package's own model that cannot be read is the package's defect, refused at step 2 with no
// zip, not the command's, which a --model file that cannot be read is (exit 2, below).
expectRefused(
  "a package's own content-model.json that cannot be read",
  ({ edit }) => edit(MODEL, '},\n  "facets": [', '},\n  "facet": ['),
  2,
  "the package's own content-model.json, which describes its stand-in model, cannot be read as a content model",
);

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
  // An empty value, as an unset variable gives, is refused: taken as no option, it would skip the
  // check it asks for.
  [DEMO, '--model', ''],
  [DEMO, '--platform', ''],
]) {
  const { status } = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' });
  if (status !== 2) failures.push(`${JSON.stringify(argv)} exits ${status}, not 2`);
}
/** A password written in an address, which no message may repeat. */
const SECRET = randomBytes(9).toString('hex');
/** Made-up credentials, so that a refusal below is for the address, not for credentials missing. */
const madeUp = () => ({
  ...withoutCredentials(process.env),
  NUXEO_USER: randomBytes(6).toString('hex'),
  NUXEO_PASS: randomBytes(12).toString('hex'),
});

// The children that read no server are run without the credentials, however their names are
// written: Windows reads `nuxeo_pass` as NUXEO_PASS.
negative++;
{
  const kept = withoutCredentials({
    NUXEO_USER: 'a',
    nuxeo_pass: 'b',
    Nuxeo_User: 'c',
    NUXEO_PASSWORD: 'd',
    PATH: 'e',
  });
  if (JSON.stringify(kept) !== JSON.stringify({ NUXEO_PASSWORD: 'd', PATH: 'e' }))
    failures.push(`withoutCredentials kept ${JSON.stringify(Object.keys(kept))}`);
}
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
  // An address that does not parse is not echoed: it may still hold a password.
  [`https://someone:${SECRET}@nuxeo.invalid:port/nuxeo`, 'is not an address'],
]) {
  negative++;
  const { status, stderr } = spawnSync(process.execPath, [SCRIPT, DEMO, '--model-server', server], {
    encoding: 'utf8',
    env: madeUp(),
  });
  if (status !== 2 || !stderr.includes(`--model-server: `) || !stderr.includes(reason))
    failures.push(`--model-server ${server} exits ${status}, not 2 for "${reason}"\n${stderr}`);
  if (stderr.includes(SECRET)) failures.push(`--model-server ${server} printed the password in it`);
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
  let big = null;
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
    if (path === '/nuxeo/api/v1/config/types' && big !== null) {
      // Sent in pieces, so with no Content-Length: only counting as it arrives can stop it.
      response.writeHead(200, { 'content-type': 'application/json' });
      const body = Buffer.from(JSON.stringify({ doctypes: {}, padding: big }));
      for (let at = 0; at < body.length; at += 256) response.write(body.subarray(at, at + 256));
      response.end();
    } else if (path === '/nuxeo/api/v1/config/types') json({ doctypes: doctypes(), schemas: {} });
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
  // The run's own credentials, and no other spelling of them the machine already had.
  const env = {
    ...withoutCredentials(process.env),
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
  // With the package's build allow-list, as `run` gives it, so that only the model differs.
  const live = (directory, out, environment = env) =>
    command(
      [
        SCRIPT,
        directory,
        '--out',
        out,
        '--model-server',
        address,
        ...(existsSync(join(directory, BUILD_ALLOW_LIST))
          ? ['--allow-list', join(directory, BUILD_ALLOW_LIST)]
          : []),
      ],
      environment,
    );
  const bareEnv = () => withoutCredentials(process.env);
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

    // An answer over the cap is refused as it arrives, counted in bytes, not in characters: 2,000
    // euro signs are 2,000 characters and 6,000 bytes. Under a cap they fit, they are read.
    for (const [padding, maxBytes, refused] of [
      ['x'.repeat(8192), 4096, true],
      ['€'.repeat(2000), 4096, true],
      ['€'.repeat(1000), 4096, false],
    ]) {
      if (refused) negative++;
      else positive++;
      big = padding;
      let error = null;
      try {
        await readServerModel(address, credentials, { maxBytes });
      } catch (caught) {
        error = caught;
      }
      big = null;
      const said = error?.message ?? 'read';
      // Refused at the padded answer itself, as the demo's own schemas are over a kilobyte too;
      // or read with no error at all, not merely without this one.
      const held = refused
        ? said.includes(`/config/types answered more than ${maxBytes} bytes`)
        : error === null;
      if (!held)
        failures.push(
          `${padding.length} × "${padding[0]}" under a cap of ${maxBytes} bytes: ${said}`,
        );
    }

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
