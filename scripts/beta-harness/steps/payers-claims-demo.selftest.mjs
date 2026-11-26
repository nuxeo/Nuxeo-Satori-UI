#!/usr/bin/env node
/**
 * Controls for the Payers demo's "the kit's bundle holds no code" check
 * (`payers-claims-demo/bundle-data.mjs`), with no server: the kit's own bundle passes, and a copy
 * of it broken in one way each is refused, naming what is code.
 *
 *   node scripts/beta-harness/steps/payers-claims-demo.selftest.mjs
 *
 * Node 24, and the system's `unzip`, which lists the route model's zip as a reader with no part in
 * this check. Exit 0 when every control behaves as required, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeIn, zipEntryNames } from './payers-claims-demo/bundle-data.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const { MODELS, ZIP_PATH, ZIP, ZIP_PATHS, archiveEntries, sourceOf, storedZip, zipOf, zipPathOf } =
  await import(join(KIT, 'workflow', 'route-model.mjs'));
/** Since 0.7.0, the appeal review's zip, the bundle's second route model. */
const APPEAL = MODELS[1];

const failures = [];
let controls = 0;
const expect = (condition, what, detail = '') => {
  controls++;
  if (!condition) failures.push(`${what}${detail ? `: ${detail}` : ''}`);
};

/** A copy of the kit's bundle, `change`d; what the check finds in it. */
function codeAfter(change) {
  const scratch = mkdtempSync(join(tmpdir(), 'payers-bundle-'));
  const bundle = join(scratch, 'bundle');
  try {
    cpSync(join(KIT, 'bundle'), bundle, { recursive: true });
    const write = (path, data) => {
      mkdirSync(dirname(join(bundle, path)), { recursive: true });
      writeFileSync(join(bundle, path), data);
    };
    change({ bundle, write });
    return codeIn(bundle, ZIP_PATHS);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A route model's zip, with `extra` entries added, as the kit's builder writes one. */
const routeModelWith = (...extra) =>
  storedZip([...archiveEntries(), ...extra.map((name) => ({ name, data: Buffer.from('x') }))]);
const appealModelWith = (...extra) =>
  storedZip([
    ...archiveEntries(sourceOf(APPEAL)),
    ...extra.map((name) => ({ name, data: Buffer.from('x') })),
  ]);

// The reader: each route model's zip, listed as unzip lists it.
for (const zip of [ZIP, zipOf(APPEAL)]) {
  const listed = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
  expect(
    listed.status === 0 &&
      JSON.stringify(zipEntryNames(readFileSync(zip))) ===
        JSON.stringify(listed.stdout.split('\n').filter(Boolean)),
    `${zip.slice(zip.lastIndexOf('/') + 1)}'s entries are read as unzip lists them`,
    listed.stderr,
  );
}

// The kit as it is: data only.
const own = codeIn(join(KIT, 'bundle'), ZIP_PATHS);
expect(own.length === 0, "the kit's own bundle holds no code", JSON.stringify(own));

// Each refused, naming what is code.
const refused = (what, change, named) => {
  const found = codeAfter(change);
  expect(found.includes(named), what, `found ${JSON.stringify(found)}, expected ${named}`);
};
refused(
  'a JavaScript file in the bundle',
  ({ write }) => write('agentic-ui-config/widget.js', 'alert(1)'),
  'agentic-ui-config/widget.js',
);
refused(
  'a Groovy script in the bundle',
  ({ write }) => write('data/hook.groovy', 'println 1'),
  'data/hook.groovy',
);
refused(
  'a route model zip holding a JavaScript file',
  ({ write }) => write(ZIP_PATH, routeModelWith('PayersClaimReview/run.js')),
  `${ZIP_PATH}!PayersClaimReview/run.js`,
);
refused(
  'a route model zip holding a class',
  ({ write }) => write(ZIP_PATH, routeModelWith('PayersClaimReview/Run.class')),
  `${ZIP_PATH}!PayersClaimReview/Run.class`,
);
refused(
  'a route model zip holding a jar',
  ({ write }) => write(ZIP_PATH, routeModelWith('lib/tool.jar')),
  `${ZIP_PATH}!lib/tool.jar`,
);
refused(
  'a route model zip holding an MVEL script',
  ({ write }) => write(ZIP_PATH, routeModelWith('PayersClaimReview/rule.mvel')),
  `${ZIP_PATH}!PayersClaimReview/rule.mvel`,
);
refused(
  'a route model zip holding another zip',
  ({ write }) => write(ZIP_PATH, routeModelWith('PayersClaimReview/inner.zip')),
  `${ZIP_PATH}!PayersClaimReview/inner.zip`,
);
refused(
  "the appeal review's route model zip holding a JavaScript file",
  ({ write }) => write(zipPathOf(APPEAL), appealModelWith(`${APPEAL}/run.js`)),
  `${zipPathOf(APPEAL)}!${APPEAL}/run.js`,
);
refused(
  'a zip of XML documents anywhere but the route models',
  ({ write }) => write('data/Other.zip', readFileSync(ZIP)),
  'data/Other.zip',
);
refused(
  'a route model zip that cannot be read',
  ({ write }) => write(ZIP_PATH, Buffer.from('not a zip')),
  `${ZIP_PATH} (not a zip this reads)`,
);
refused(
  "a CSV file outside the vocabularies' folder",
  ({ write }) => write('agentic-ui-config/rows.csv', '"id","label"\n'),
  'agentic-ui-config/rows.csv',
);
refused(
  'a file named as a manifest outside META-INF',
  ({ write }) => write('agentic-ui-config/MANIFEST.MF', 'Main-Class: x\n'),
  'agentic-ui-config/MANIFEST.MF',
);

if (failures.length > 0) {
  console.error(`payers-claims-demo selftest: ${failures.length} of ${controls} controls failed\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`payers-claims-demo selftest: all ${controls} controls behaved as required.`);
