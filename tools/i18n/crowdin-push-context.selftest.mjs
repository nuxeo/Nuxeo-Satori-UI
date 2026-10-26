#!/usr/bin/env node
/**
 * Controls for the pure half of `crowdin-push-context.mjs`.
 *
 * A standalone selftest rather than a `.spec.mjs`, because Vitest only runs the projects Nx
 * declares a `test` target for, each with its own Vite config, and `tools/` is not one. This repository already verifies its
 * scripts this way — `review-guardrails.selftest.mjs`, `sanitizer-audit.selftest.mjs` — so
 * this follows that rather than adding a build target for four functions.
 *
 * The network half cannot be tested until a Crowdin project exists. What is covered is the
 * part that decides WHAT gets sent, where a quiet mistake costs the most: context attached to
 * the wrong string is worse for a translator than no context, because it is believed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  crowdinSourcePath,
  discoverContextFiles,
  flattenKeys,
  isMetadataKey,
  usableContext,
} from './crowdin-push-context.mjs';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

// ── flattenKeys: must produce the identifiers Crowdin stores, same as the loader ──
check('nests to dotted keys', flattenKeys({ a: { b: 'B', c: 'C' }, d: 'D' }), ['a.b', 'a.c', 'd']);
check('descends arbitrarily', flattenKeys({ a: { b: { c: { d: 'D' } } } }), ['a.b.c.d']);
// An array leaf is not something ngx-translate resolves either, so it is not a string to send.
check('ignores an array leaf', flattenKeys({ a: ['x'], b: 'B' }), ['b']);
// One bad leaf must not abort a whole sync.
check('ignores null without throwing', flattenKeys({ a: null, b: 'B' }), ['b']);

// ── isMetadataKey ──
check('recognises file metadata', isMetadataKey('$schema-note'), true);
check('leaves a real key alone', isMetadataKey('browse.title'), false);

// ── usableContext: what actually goes over the wire ──
check('sends real context', usableContext({ 'a.b': 'A noun naming the panel.' }), [
  ['a.b', 'A noun naming the panel.'],
]);
check(
  'never sends file metadata to a translator',
  usableContext({ '$schema-note': 'about this file', 'a.b': 'real' }),
  [['a.b', 'real']],
);
// `checkTranslationContext` rejects blanks in the repository, but this must not depend on
// that: a PATCH carrying an empty string would ERASE context already in Crowdin.
check(
  'skips blank context rather than erasing what is there',
  usableContext({ 'a.b': '', 'c.d': '   ', 'e.f': 'kept' }),
  [['e.f', 'kept']],
);
check(
  'skips a non-string rather than sending "[object Object]"',
  usableContext({ 'a.b': { nested: 'no' }, 'c.d': null, 'e.f': 'kept' }),
  [['e.f', 'kept']],
);

// ── discoverContextFiles: the app catalogue must not be the only thing that travels ──

/** A throwaway tree, so nothing outside `os.tmpdir()` is read or written. */
function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'crowdin-context-'));
  try {
    for (const [relative, body] of Object.entries(files)) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The founding defect: a library catalogue's context was uploaded by nothing, because the only
// source this script knew was `apps/nuxeo-ui/public/i18n/en.context.json`, spelled out in full.
withTree(
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{}\n',
    'libs/platform/nuxeo-client/src/i18n/en.json': '{}\n',
    'libs/platform/nuxeo-client/src/i18n/en.context.json': '{}\n',
  },
  (root) =>
    check('finds a library context file, not just the app one', discoverContextFiles(root), [
      'apps/nuxeo-ui/public/i18n/en.context.json',
      'libs/platform/nuxeo-client/src/i18n/en.context.json',
    ]),
);

// `node_modules` holds 48 upstream catalogues at the same relative shape. Uploading them would
// bill the translation crew for another team's strings — the trap `crowdin-conf.yml` documents.
withTree(
  {
    'apps/nuxeo-ui/public/i18n/en.context.json': '{}\n',
    'apps/nuxeo-ui/node_modules/@alfresco/adf-core/i18n/en.context.json': '{}\n',
  },
  (root) =>
    check('never walks into node_modules', discoverContextFiles(root), [
      'apps/nuxeo-ui/public/i18n/en.context.json',
    ]),
);

// A context file must be a sibling of the catalogue, in an `i18n/` directory. Anything else is
// not a Crowdin source and has no string to attach to.
withTree({ 'apps/nuxeo-ui/docs/en.context.json': '{}\n' }, (root) =>
  check('ignores a context file outside an i18n directory', discoverContextFiles(root), []),
);

withTree({ 'apps/nuxeo-ui/src/main.ts': 'export {};\n' }, (root) =>
  check('a tree with no context file discovers nothing', discoverContextFiles(root), []),
);

// ── crowdinSourcePath: `preserve_hierarchy: true` and `base_path: '.'` ──
check(
  'maps a context file to its sibling catalogue with a leading slash',
  crowdinSourcePath('apps/nuxeo-ui/public/i18n/en.context.json'),
  '/apps/nuxeo-ui/public/i18n/en.json',
);
check(
  'maps a library context file the same way',
  crowdinSourcePath('libs/platform/nuxeo-client/src/i18n/en.context.json'),
  '/libs/platform/nuxeo-client/src/i18n/en.json',
);

console.log(`crowdin-push-context selftest: ${passed + failures.length} controls.`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
