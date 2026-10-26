#!/usr/bin/env node
/**
 * Controls for `storybook-publication-gate.mjs`: each negative control adds one Satori fingerprint
 * to a clean fixture and must fail on that rule; each positive control must pass. Fixtures live
 * under the OS temp directory.
 *
 * Usage:  node scripts/storybook-publication-gate.selftest.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const GATE = resolve(import.meta.dirname, 'storybook-publication-gate.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'storybook-publication-gate-selftest-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

// Interpolated, so the supply-chain gate does not read these fixtures as imports.
const SCOPE = '@hylandsoftware';
const NM = 'node_modules';
const SATORI_MODULE = `${NM}/${SCOPE}/satori-ui/fesm2022/hylandsoftware-satori-ui-avatar.mjs`;
const GETTING_STARTED = 'getting-started-mdx.0123abcd.iframe.bundle.js';

const gettingStarted = (omit = '') =>
  [
    `const npmrc="${SCOPE}:registry=https://npm.pkg.github.com";`,
    `const providers="import { provideSatori } from '${SCOPE}/satori-ui/providers';`,
    `import { t } from '${SCOPE}/satori-ui/translations';";`,
    `jsx("code",{children:"${SCOPE}/satori-ui"});`,
    `jsx("code",{children:"${SCOPE}"});`,
    `jsx(Source,{code:"npm install ${SCOPE}/satori-ui"});`,
  ]
    .filter((line) => !omit || !line.includes(omit))
    .join('\n');

const sourceMap = (sources) =>
  JSON.stringify({
    version: 3,
    file: 'x.js',
    mappings: 'AAAA',
    names: [],
    sources: sources.map(([path]) => `webpack://agentic-ui/./${path}`),
    sourcesContent: sources.map(([, content]) => content),
  });

const CLEAN = {
  'index.html': '<!doctype html><title>manager</title>',
  'iframe.html': '<!doctype html><title>preview</title>',
  'index.json': JSON.stringify({
    v: 5,
    entries: { 'primitives-avatar--default': { type: 'story' } },
  }),
  'main.abc123.iframe.bundle.js': 'console.log("material");',
  'main.abc123.css': 'html { font: 14px Roboto, sans-serif; }',
  [GETTING_STARTED]: gettingStarted(),
  '9644.deadbeef.iframe.bundle.js.map': sourceMap([
    [
      'libs/shared/satori-components/src/lib/provide-nxs-components.ts',
      `// only with access to ${SCOPE}/satori-ui`,
    ],
    [`${NM}/@angular/core/fesm2022/core.mjs`, 'export const x = 1;'],
  ]),
  'nunito-sans-regular.woff2': 'wOF2',
  'sb-common-assets/nunito-sans-bold.woff2': 'wOF2',
};

let fixtures = 0;
function fixture(overrides = {}) {
  const dir = join(workspace, String(++fixtures));
  for (const [rel, content] of Object.entries({ ...CLEAN, ...overrides })) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

async function gate(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [GATE, ...args]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    return { code: error.code, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

const NEGATIVE = [
  [
    'a --sat- token in CSS',
    { 'main.abc123.css': ':root { --sat-color-primary: #123; }' },
    'satori-token',
  ],
  [
    'Figtree named in an @font-face',
    { 'main.abc123.css': '@font-face { font-family: Figtree; }' },
    'font',
  ],
  ['a Figtree font file', { 'media/Figtree.woff2': 'wOF2' }, 'satori-path'],
  ['a font file not on the list, whatever its name', { 'NotoSans.woff2': 'wOF2' }, 'font'],
  [
    'a compiled module path in a chunk',
    { '232.js': `/***/ "./${SATORI_MODULE}":` },
    'satori-module',
  ],
  [
    'a source map whose source is a Satori module',
    { '232.js.map': sourceMap([[SATORI_MODULE, 'export {};']]) },
    'satori-module',
  ],
  [
    'a Satori package with no fesm path, named by a map source',
    { '232.js.map': sourceMap([[`${NM}/${SCOPE}/satori-icons/index.mjs`, 'export {};']]) },
    'satori-module',
  ],
  ['a Satori asset path', { [`i18n/${SCOPE}/satori-ui/en.json`]: '{}' }, 'satori-path'],
  [
    'a mention in an ordinary chunk',
    { '1.js': `const p = "${SCOPE}/satori-tokens";` },
    'satori-mention',
  ],
  [
    'an unlisted mention inside the allowed chunk',
    { [GETTING_STARTED]: `${gettingStarted()}\nconst p = "${SCOPE}/satori-tokens";` },
    'satori-mention',
  ],
  [
    'an allowed string in a chunk the allowance does not name',
    { '1.js': `code:"npm install ${SCOPE}/satori-ui"` },
    'satori-mention',
  ],
  [
    'an allowed string the build no longer contains',
    { [GETTING_STARTED]: gettingStarted('translations') },
    'stale-allowance',
  ],
  ['no Getting started chunk', { [GETTING_STARTED]: null }, 'stale-allowance'],
  [
    'no Storybook font',
    { 'nunito-sans-regular.woff2': null, 'sb-common-assets/nunito-sans-bold.woff2': null },
    'stale-allowance',
  ],
  [
    'no workspace source that names the scope',
    { '9644.deadbeef.iframe.bundle.js.map': sourceMap([['libs/x/a.ts', 'export {};']]) },
    'stale-allowance',
  ],
  [
    'a token in a workspace source, where only mentions are allowed',
    { '9.js.map': sourceMap([['libs/x/theme.scss', ':root { --sat-space: 4px; }']]) },
    'satori-token',
  ],
  [
    'a mention in a source map copy of a file outside the workspace',
    { '9.js.map': sourceMap([[`${NM}/some-lib/index.js`, `// see ${SCOPE}/satori-ui`]]) },
    'satori-mention',
  ],
  [
    'a .map that is not a source map',
    { '9.js.map': `not json ${SCOPE}/satori-ui` },
    'satori-mention',
  ],
];

for (const [name, overrides, rule] of NEGATIVE) {
  test(`negative: ${name} fails on ${rule}`, async () => {
    const { code, output } = await gate(fixture(overrides));
    assert.equal(code, 1, output);
    assert.match(output, new RegExp(`\\[FAIL\\] ${rule}:`), output);
  });
}

const POSITIVE = [
  ['the clean fixture', {}],
  [
    "Angular's own fesm2022 paths",
    { '2.js': `/***/ "./${NM}/@angular/material/fesm2022/button.mjs":` },
  ],
  [
    'words that start with sat',
    { 'main.abc123.css': '.x { filter: saturate(2); --saturation: 1; }' },
  ],
  ['an allowed string twice', { [GETTING_STARTED]: `${gettingStarted()}\n${gettingStarted()}` }],
];

for (const [name, overrides] of POSITIVE) {
  test(`positive: ${name} passes`, async () => {
    const { code, output } = await gate(fixture(overrides));
    assert.equal(code, 0, output);
    assert.match(output, /PASS/);
  });
}

const NOTHING_TO_INSPECT = [
  ['no argument', []],
  ['a directory that does not exist', [join(workspace, 'missing')]],
  ['a directory with no iframe.html', [fixture({ 'iframe.html': null })]],
  ['a directory with no index.json', [fixture({ 'index.json': null })]],
  ['an index.json listing nothing', [fixture({ 'index.json': '{"v":5,"entries":{}}' })]],
];

for (const [name, args] of NOTHING_TO_INSPECT) {
  test(`gap: ${name} exits 2, not 0`, async () => {
    const { code, output } = await gate(...args);
    assert.equal(code, 2, output);
  });
}

after(() =>
  console.log(
    `storybook-publication-gate controls: ${NEGATIVE.length} negative (must fail on their rule), ` +
      `${POSITIVE.length} positive (must pass), ${NOTHING_TO_INSPECT.length} gap (must exit 2)`,
  ),
);
