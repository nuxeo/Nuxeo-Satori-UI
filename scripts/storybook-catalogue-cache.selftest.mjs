#!/usr/bin/env node
/**
 * Controls for `storybook-catalogue-cache.mjs`: each negative control reintroduces one way the
 * published catalogue can be served stale to the bundle that reads it, and must fail on it; each
 * positive control must pass. Fixtures live under the OS temp directory.
 *
 * The first negative control is the defect itself — a bundle that asks for `i18n/en.json` with no
 * stamp, which is what `main` shipped on 2026-11-04 and what put raw
 * `satori-components.asset-facets-drawer.*` keys on the published docs pages.
 *
 * Usage:  node scripts/storybook-catalogue-cache.selftest.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

import { catalogueStamp } from './storybook-catalogue-cache.mjs';

const run = promisify(execFile);
const GATE = resolve(import.meta.dirname, 'storybook-catalogue-cache.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'storybook-catalogue-cache-selftest-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

const EN = JSON.stringify({ 'satori-components': { 'asset-facets-drawer': { filters: 'Filters' } } });
const FR = JSON.stringify({ 'satori-components': { 'asset-facets-drawer': { filters: 'Filtres' } } });

/** The stamp a clean fixture's catalogues hash to, computed by the gate's own exported function. */
function stampFor(catalogues) {
  const dir = mkdtempSync(join(workspace, 'stamp-'));
  for (const [name, body] of Object.entries(catalogues)) writeFileSync(join(dir, name), body);
  return catalogueStamp(dir);
}

const CLEAN_CATALOGUES = { 'en.json': EN, 'fr.json': FR };
const CLEAN_STAMP = stampFor(CLEAN_CATALOGUES);

const clean = () => ({
  'iframe.html': '<!doctype html><title>preview</title>',
  'i18n/en.json': EN,
  'i18n/fr.json': FR,
  // As webpack emits `preview.ts`'s template literal, with the stamp already inlined.
  'main.abc123.iframe.bundle.js': `const u=\`i18n/\${lang}.json?v=${CLEAN_STAMP}\`;fetch(u);`,
  'runtime.def456.iframe.bundle.js': 'console.log("runtime");',
});

let made = 0;
function fixture(overrides = {}) {
  const dir = join(workspace, `build-${made++}`);
  for (const [path, body] of Object.entries({ ...clean(), ...overrides })) {
    if (body === null) continue;
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return dir;
}

async function gate(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [GATE, ...args]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    return { code: error.code ?? 1, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

const NEGATIVE = [
  [
    'the shipped defect: the catalogue requested with no stamp',
    { 'main.abc123.iframe.bundle.js': 'fetch(`i18n/${lang}.json`);' },
    /with no `\?v=` stamp/,
  ],
  [
    'one bundle stamped and another not',
    { 'runtime.def456.iframe.bundle.js': "fetch('i18n/en.json');" },
    /with no `\?v=` stamp/,
  ],
  [
    'a stamp that is not the shipped catalogues — the bundle is from another build',
    { 'main.abc123.iframe.bundle.js': 'const u=`i18n/${lang}.json?v=0123456789abcdef`;' },
    /different builds/,
  ],
  [
    'a catalogue changed after the build, so the stamp no longer describes it',
    { 'i18n/en.json': JSON.stringify({ 'satori-components': { x: { y: 'changed' } } }) },
    /different builds/,
  ],
  [
    'a catalogue added after the build',
    { 'i18n/de.json': JSON.stringify({ a: 1 }) },
    /different builds/,
  ],
  [
    'two bundles carrying different stamps',
    { 'runtime.def456.iframe.bundle.js': 'fetch(`i18n/en.json?v=0123456789abcdef`);' },
    /different stamps/,
  ],
  [
    'no bundle requesting a catalogue at all, so there is nothing to judge',
    { 'main.abc123.iframe.bundle.js': 'console.log("no catalogue here");' },
    /no script in the build requests a catalogue/,
  ],
  // The four below are the #563 review's case: a path built by concatenation, which
  // `CATALOGUE_REQUEST` cannot see. `one bundle stamped and another not` above already covers a
  // mixed build, but its unstamped request is a literal the gate can read.
  //
  // The first three keep the clean fixture's correctly stamped bundle, so `stamped` is 1 and the
  // build-wide `no script ... requests a catalogue` guard stays quiet. Those three exited **0
  // with "all stamped"** before `CATALOGUE_LITERAL_START`, and they are what makes this a defect.
  //
  // The fourth is weaker on purpose and should not be read as a missed build: with no stamped
  // request anywhere, the old guard already refused it — just as "requests a catalogue at all",
  // which does not say that a path was built and not read. It pins the diagnosis, not the
  // refusal. Reverting the gate turns all four red, but only three of them from a pass.
  [
    'a concatenated catalogue path, alongside a correctly stamped one',
    { 'runtime.def456.iframe.bundle.js': 'fetch("i18n/"+lang+".json");' },
    /cannot read in full/,
  ],
  [
    'a concatenated catalogue path built with .concat, as a downlevelled template literal is',
    { 'runtime.def456.iframe.bundle.js': 'fetch("i18n/".concat(lang, ".json"));' },
    /cannot read in full/,
  ],
  [
    'a concatenated path that carries a stamp but cannot be read as one request',
    {
      'runtime.def456.iframe.bundle.js': `fetch("i18n/"+lang+".json?v=${CLEAN_STAMP}");`,
    },
    /cannot read in full/,
  ],
  [
    'a concatenated path as the only catalogue request in the build',
    {
      'main.abc123.iframe.bundle.js': 'fetch("i18n/"+lang+".json");',
      'runtime.def456.iframe.bundle.js': 'console.log("runtime");',
    },
    /cannot read in full/,
  ],
  [
    'staticDirs stopped copying the catalogues in',
    { 'i18n/en.json': null, 'i18n/fr.json': null },
    /has no catalogue in it/,
  ],
];

for (const [name, overrides, expected] of NEGATIVE) {
  test(`negative: ${name} fails`, async () => {
    const { code, output } = await gate(fixture(overrides));
    assert.equal(code, 1, output);
    assert.match(output, expected);
  });
}

const POSITIVE = [
  ['a build whose stamp matches the catalogues it shipped', {}],
  [
    'the same stamp requested from several bundles',
    { 'runtime.def456.iframe.bundle.js': `fetch(\`i18n/en.json?v=${CLEAN_STAMP}\`);` },
  ],
  [
    'a catalogue named in prose, which is not a request',
    { 'extra.0a0a0a.iframe.bundle.js': 'const doc="the catalogue lives at i18n/<lang>.json";' },
  ],
  // These three keep `CATALOGUE_LITERAL_START` from being something to work around rather than
  // satisfy. The prose control above is the one that matters most: its `i18n/` follows a space,
  // not a quote, so a mention mid-sentence is not read as a path the gate failed to resolve.
  [
    'a request written relative, so the path follows a slash rather than opening the literal',
    { 'runtime.def456.iframe.bundle.js': `fetch("./i18n/en.json?v=${CLEAN_STAMP}");` },
  ],
  [
    'two stamped requests in one bundle, so every resolved offset is accounted for, not just the first',
    {
      'runtime.def456.iframe.bundle.js':
        `fetch("i18n/en.json?v=${CLEAN_STAMP}");fetch("i18n/fr.json?v=${CLEAN_STAMP}");`,
    },
  ],
  [
    'concatenation that builds something other than a catalogue path',
    { 'extra.0a0a0a.iframe.bundle.js': 'fetch("assets/"+name+".png");' },
  ],
];

for (const [name, overrides] of POSITIVE) {
  test(`positive: ${name} passes`, async () => {
    const { code, output } = await gate(fixture(overrides));
    assert.equal(code, 0, output);
    assert.match(output, /all stamped/);
  });
}

const NOTHING_TO_INSPECT = [
  ['no argument', []],
  ['a directory that does not exist', [join(workspace, 'missing')]],
  ['a directory with no iframe.html', [fixture({ 'iframe.html': null })]],
];

for (const [name, args] of NOTHING_TO_INSPECT) {
  test(`gap: ${name} exits 2, not 0`, async () => {
    const { code, output } = await gate(...args);
    assert.equal(code, 2, output);
  });
}

after(() =>
  console.log(
    `storybook-catalogue-cache controls: ${NEGATIVE.length} negative (must fail on their rule), ` +
      `${POSITIVE.length} positive (must pass), ${NOTHING_TO_INSPECT.length} gap (must exit 2)`,
  ),
);
