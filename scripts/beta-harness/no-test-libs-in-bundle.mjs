#!/usr/bin/env node
/**
 * Assert that no test-only library, and no `eval()`, reaches the production bundle.
 *
 * Phase 3's spike measured what happens when `@alfresco/adf-core` and
 * `@alfresco/adf-hx-content-services` are installed as published: adf-hx imports
 * `ng-mocks` — a test-mocking library — from its **shipped** `/ui` runtime bundle, so
 * ng-mocks' implementation landed in a 1.6 MB customer-facing chunk carrying two
 * `eval()` calls. For an on-premises enterprise product that fails CSP and every SAST
 * review. `tools/stubs/ng-mocks/` replaces it, permanently — upstream will not be
 * changing this — and this is the check that the replacement is actually working.
 *
 * Because the stub is indefinite, this gate is too. A future adf-hx release could import
 * a different test helper, which shows up here as a new fingerprint going red rather
 * than as a silent regression.
 *
 * It reads the built bytes rather than `package.json`, because the question is not
 * what we declared, it is what a customer receives. A stub that stops working, an
 * `npm install` that quietly restores the real library, or a new upstream version
 * that imports a different test helper all show up here and nowhere else.
 *
 * `eval` is matched as a call — `eval(` — rather than as a word, so the string "eval"
 * inside an unrelated identifier or a sourcemap comment does not fail the gate.
 *
 * Usage:
 *   node scripts/beta-harness/no-test-libs-in-bundle.mjs [dist-dir]
 *
 * Exit 1 if a banned symbol is present, or if there is no build to inspect — a check
 * that inspected nothing is not a pass.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist/nuxeo-ui/browser');

/**
 * Each pattern is a substring rather than a regex where a substring suffices: these
 * run over multi-megabyte bundles and a careless regex is measurably slow.
 */
const BANNED = [
  {
    id: 'ng-mocks',
    // Implementation fingerprints, **not** the package name. Matching `ngMocks` or
    // `ng-mocks` fails on our own stub, which legitimately names the library it
    // replaces in its error messages — the first version of this gate did exactly
    // that and reported the remedy as the disease. These three strings appear only
    // in the real library's compiled output.
    needles: ['extendClassicClass', '_ng_mocks_universe__', 'MockMiddleware'],
    why:
      'ng-mocks is a test-mocking library. adf-hx imports it from its shipped /ui bundle; ' +
      'tools/stubs/ng-mocks/ is meant to keep it out of the build.',
    fix: 'Check that package.json still has "ng-mocks": "file:tools/stubs/ng-mocks" and re-run npm ci.',
  },
  {
    id: 'eval',
    needles: ['eval('],
    why:
      'eval() in shipped code breaks a restrictive CSP and is flagged by SAST. The known ' +
      "source is ng-mocks' extendClassicClass, pulled in through adf-hx.",
    fix: 'Find which dependency contributed it before relaxing this check.',
  },
];

if (!existsSync(distDir)) {
  console.error(
    `no-test-libs-in-bundle: no build at ${relative(repoRoot, distDir) || distDir}.\n` +
      'Build first — `npx nx build nuxeo-ui` — because this gate reads the built bytes.\n' +
      'Refusing to report a pass on a bundle that was never inspected.',
  );
  process.exit(1);
}

/**
 * Strings that appear only in the **upstream** packages, used to tell "adf-hx is in
 * this bundle" from "it is not".
 *
 * Deliberately not the `hxp-document-list` selector: the POC hand-wrote a component
 * with that exact selector, so matching it reported adf-hx as present in a bundle
 * that contained none — the first version of this check did, and silently turned the
 * vacuity warning off. `adf-datatable` comes from adf-core's DataTable and
 * `adf-enterprise-adf-hx` from the published providers file; neither occurs anywhere
 * in this repo's own source.
 */
const UPSTREAM_MARKERS = ['adf-datatable', 'adf-enterprise-adf-hx'];

/**
 * Files that must be **present** in the build, not merely absent from it.
 *
 * Upstream assets fetched at runtime are copied in by asset globs in `angular.json`, and a
 * missing one renders raw keys or broken images — visible to a user, invisible to a compiler,
 * and easy to lose to a stray edit of a glob.
 *
 * Asserted here because this gate already reads the built output, and because the built
 * output is what a customer receives. A local dev server can disagree with it — one
 * started before the glob was added keeps 404ing the file — and the build is the
 * authority.
 */
/**
 * Each entry carries a `key` or `contains`, because **existence was the wrong assertion**.
 *
 * This list was checked with `existsSync` alone until 2026-08-24 — while the comment below
 * describes the failure mode as the loader "catches the 404 and returns `{}`". An empty
 * catalogue is therefore precisely the silent failure the check exists to prevent, and an
 * empty catalogue passed. So did a truncated one, and so did a 0-byte file.
 *
 * `key` is a dotted path that must resolve to a non-empty string. Each one is a key the
 * application actually renders, not the first key in the file. The list began with adf-hx's
 * `MANAGE_VERSIONS.DIALOG.TITLE`, a heading that once shipped raw; adf-hx has since been removed.
 */
// Both catalogues `AppTranslateLoader` fetches at runtime. Each fails silently when missing: the
// satori-ui fetch is caught to `{}` and the app's falls back to the English map, so a lost glob
// shows only as raw `sat.*` keys or English in every other language.
const REQUIRED_FILES = [
  {
    path: 'i18n/en.json',
    key: 'shell.search.placeholder',
    why: "The app's English catalogue, fetched as i18n/<lang>.json; the header search label reads this key.",
    fix: 'Check the asset glob for apps/nuxeo-ui/public in angular.json.',
  },
  {
    path: 'assets/satori-ui/i18n/en.json',
    key: 'sat.platform-nav.expand',
    why: "satori-ui's catalogue (UPSTREAM_FOLDERS in app-translate-loader.ts); the platform nav's expand button reads this key.",
    fix: 'Check the asset glob for node_modules/@hylandsoftware/satori-ui/i18n in angular.json.',
  },
];

/** @type {{ pattern: string, file: string, count: number, why: string, fix: string }[]} */
const hits = [];
let filesScanned = 0;
let bytesScanned = 0;
/** Whether adf-hx code is present at all — see the vacuity note in the report. */
let sawAdfHx = false;

for await (const file of walk(distDir)) {
  // `.js` only: a `.map` legitimately contains the original identifiers of anything
  // that was tree-shaken, so scanning sourcemaps produces false positives.
  if (!file.endsWith('.js')) continue;
  filesScanned += 1;
  const body = await readFile(file, 'utf8');
  bytesScanned += body.length;
  if (!sawAdfHx && UPSTREAM_MARKERS.some((m) => body.includes(m))) sawAdfHx = true;
  for (const banned of BANNED) {
    for (const needle of banned.needles) {
      const count = countOccurrences(body, needle);
      if (count > 0) {
        hits.push({
          pattern: needle,
          file: relative(distDir, file),
          count,
          why: banned.why,
          fix: banned.fix,
        });
      }
    }
  }
}

/** @type {{ required: (typeof REQUIRED_FILES)[number], reason: string }[]} */
const missingFiles = [];
for (const required of REQUIRED_FILES) {
  const full = resolve(distDir, required.path);
  if (!existsSync(full)) {
    missingFiles.push({ required, reason: 'absent' });
    continue;
  }
  // Content, not existence. See the note on REQUIRED_FILES: the documented failure mode is
  // a catalogue that resolves to `{}`, which existence cannot distinguish from a good one.
  const text = readFileSync(full, 'utf8');
  if (required.contains && !text.includes(required.contains)) {
    missingFiles.push({
      required,
      reason: `present (${text.length} bytes) but does not contain \`${required.contains}\``,
    });
    continue;
  }
  if (required.key) {
    let value;
    try {
      value = required.key.split('.').reduce((o, part) => o?.[part], JSON.parse(text));
    } catch (error) {
      missingFiles.push({ required, reason: `present but is not valid JSON (${error.message})` });
      continue;
    }
    if (typeof value !== 'string' || value === '') {
      missingFiles.push({
        required,
        reason:
          `present (${text.length} bytes) but \`${required.key}\` is ` +
          `${value === undefined ? 'absent' : JSON.stringify(value)}, so the catalogue is ` +
          'empty or truncated and the UI renders raw keys',
      });
    }
  }
}

if (filesScanned === 0) {
  console.error(`no-test-libs-in-bundle: ${distDir} contains no .js files. Nothing was checked.`);
  process.exit(1);
}

console.log(
  `\nno-test-libs-in-bundle: scanned ${filesScanned} bundle file(s), ` +
    `${(bytesScanned / 1048576).toFixed(2)} MB\n`,
);

// Each one by name. This loop used to match `missingFiles` entries against bare paths while
// they held "path — reason" strings, so a failure printed only the count.
for (const { required, reason } of missingFiles) {
  console.log(`  [FAIL] ${required.path}: ${reason}`);
  console.log(`         ${required.why}`);
  console.log(`         ${required.fix}`);
}

if (hits.length === 0 && missingFiles.length === 0) {
  console.log(
    `no-test-libs-in-bundle: pass — none of ${BANNED.map((b) => b.id).join(', ')} reached the bundle.`,
  );
  console.log(
    `  ${REQUIRED_FILES.length} required asset(s) present AND non-empty ` +
      `(${REQUIRED_FILES.filter((r) => r.key).length} catalogues checked by key, ` +
      `${REQUIRED_FILES.filter((r) => r.contains).length} by markup).`,
  );
  // A green here means nothing unless adf-hx is actually in the bundle: the banned
  // symbols arrived *through* it. With adf-hx removed this passes trivially, and
  // saying so is the difference between a gate and a decoration.
  if (!sawAdfHx) {
    console.log(
      '\n  VACUOUS: no adf-hx code was found in this bundle, so nothing could have\n' +
        '  carried a banned symbol into it. This run does not demonstrate that the\n' +
        '  ng-mocks stub works — it demonstrates that adf-hx is not in the bundle.\n' +
        '  It becomes load-bearing again only if a component imports @alfresco/adf-hx-content-services.',
    );
  }
  process.exit(0);
}

for (const hit of hits) {
  console.log(`  [FAIL] "${hit.pattern}" x${hit.count} in ${hit.file}`);
  console.log(`         ${hit.why}`);
  console.log(`         ${hit.fix}`);
}
console.log(
  `\nno-test-libs-in-bundle: FAIL — ${hits.length} banned symbol occurrence group(s) and ` +
    `${missingFiles.length} missing required file(s).`,
);
process.exit(1);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if ((await stat(full)).isFile()) yield full;
  }
}

/** @param {string} haystack @param {string} needle */
function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
