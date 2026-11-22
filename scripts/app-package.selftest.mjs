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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'app-package.mjs');
const DEMO = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const ZIP = 'payers-claims-demo-0.1.0.zip';

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
  change({ directory, edit, write: (file, text) => writeFileSync(join(directory, file), text) });
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

/** Refused with exit 1 at `step`, saying `reason`, and no zip written. */
function expectRefused(what, change, step, reason, args = []) {
  negative++;
  const { scratch, directory, out } = packageWith(change);
  try {
    const { status, output } = run(directory, out, argsFor(args, scratch));
    const problems = [];
    if (status !== 1) problems.push(`exit ${status}, not 1`);
    if (!output.includes(`step ${step} refused it`)) problems.push(`not refused at step ${step}`);
    if (!output.includes(reason)) problems.push(`no "${reason}"`);
    if (existsSync(join(out, ZIP))) problems.push('a zip was written');
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
      '"packageVersion": "0.1.0"',
      '"packageVersion": "0.1.1"',
    ),
  3,
  "app.json's packageVersion is 0.1.1, and package.xml's version is 0.1.0",
);
expectRefused(
  'a tag for another version',
  unchanged,
  3,
  'the tag app-package/payers-claims-demo/0.2.0 is not app-package/payers-claims-demo/0.1.0',
  ['--tag', 'app-package/payers-claims-demo/0.2.0'],
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

expectBuilt('the demo package', unchanged);
expectBuilt('the demo package, for its own tag', unchanged, [
  '--tag',
  'app-package/payers-claims-demo/0.1.0',
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
