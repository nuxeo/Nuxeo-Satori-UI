#!/usr/bin/env node
/**
 * Refuses a Storybook build that carries Satori. We may consume `@hylandsoftware/*` but not
 * redistribute it, and this repository is public, so its modules, tokens and fonts must never be
 * published from it. Runs on the directory `storybook-pages.yml` publishes and on the Material
 * Storybook `ci.yml` builds; controls in `storybook-publication-gate.selftest.mjs`.
 *
 * Usage:  node scripts/storybook-publication-gate.mjs <storybook-dir>
 * Exit 0 nothing found, 1 Satori content or a stale allowance, 2 nothing to inspect.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

// Interpolated, so the supply-chain gate does not read these strings as imports of the package.
const SCOPE = '@hylandsoftware';

const FONT_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);
const BINARY_EXTENSIONS = new Set([
  ...FONT_EXTENSIONS,
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.avif',
]);

const SATORI_NAME = /hylandsoftware|satori-(?:ui|fonts|tokens|icons)|figtree/i;
const TOKEN = /--sat-/g;
const FONT_NAME = /figtree|satori-fonts/gi;
const COMPILED_MODULE = new RegExp(`${SCOPE}/[\\w.-]+/f?esm20\\d\\d`, 'gi');
const MENTION = /hylandsoftware/gi;
// A source map's `sourcesContent` for one of our own files repeats text already public here.
const WORKSPACE_SOURCE = /^webpack:\/\/[^/]+\/\.\/(?:libs|apps)\//;

// Storybook's own interface font, which its manager serves.
const ALLOWED_FONT =
  /^(?:sb-common-assets\/)?nunito-sans-(?:regular|italic|bold|bold-italic)\.woff2$/;

const ALLOWANCES = [
  {
    id: 'getting-started',
    file: /^getting-started-mdx\.[0-9a-f]+\.iframe\.bundle\.js$/,
    why: '.storybook/getting-started.mdx tells a reader how to install the optional Satori entry point',
    strings: [
      `${SCOPE}:registry=https://npm.pkg.github.com`,
      `from '${SCOPE}/satori-ui/providers'`,
      `from '${SCOPE}/satori-ui/translations'`,
      `npm install ${SCOPE}/satori-ui`,
      `"${SCOPE}/satori-ui"`,
      `"${SCOPE}"`,
    ],
  },
];

const RULES = {
  'satori-token': 'Satori design token (--sat-*)',
  font: 'font file not on the allowed list, or a Satori font named in content',
  'satori-module': 'compiled @hylandsoftware module',
  'satori-path': 'file path names a Satori package or font',
  'satori-mention': 'hylandsoftware outside the allowed strings',
  'stale-allowance': 'an allowance matches nothing in this build',
};

const dirArg = process.argv[2];
if (!dirArg) {
  console.error('Usage: node scripts/storybook-publication-gate.mjs <storybook-dir>');
  process.exit(2);
}
const root = resolve(dirArg);
const missing = ['index.html', 'iframe.html'].filter((f) => !existsSync(join(root, f)));
if (missing.length > 0) {
  console.error(
    `storybook-publication-gate: ${dirArg} is not a Storybook build (no ${missing.join(', ')}). ` +
      'Nothing was inspected, so this is not a pass.',
  );
  process.exit(2);
}
const indexEntries = countIndexEntries(join(root, 'index.json'));
if (indexEntries === 0) {
  console.error(
    `storybook-publication-gate: ${dirArg} has no index.json listing a story or docs page, so ` +
      'it is not a Storybook anyone could read. Nothing was inspected, so this is not a pass.',
  );
  process.exit(2);
}

/** @type {Map<string, { rule: string, file: string, detail: string, count: number }>} */
const findings = new Map();
const report = (rule, file, detail, count = 1) => {
  if (count === 0) return;
  const key = `${rule}\0${file}\0${detail}`;
  const existing = findings.get(key);
  if (existing) existing.count += count;
  else findings.set(key, { rule, file, detail, count });
};

const stats = { files: 0, text: 0, maps: 0, sources: 0, fonts: 0, binary: 0 };
const allowed = { strings: 0, workspaceMentions: 0, fonts: 0 };
const usedStrings = new Map(ALLOWANCES.map((a) => [a.id, new Set()]));
const allowanceFiles = new Map(ALLOWANCES.map((a) => [a.id, 0]));

const files = readdirSync(root, { recursive: true })
  .map((f) => String(f).split('\\').join('/'))
  .filter((f) => statSync(join(root, f)).isFile())
  .sort();

for (const rel of files) {
  stats.files += 1;
  if (SATORI_NAME.test(rel)) report('satori-path', rel, rel);
  const ext = extname(rel).toLowerCase();
  if (FONT_EXTENSIONS.has(ext)) {
    stats.fonts += 1;
    if (ALLOWED_FONT.test(rel)) allowed.fonts += 1;
    else report('font', rel, 'unlisted font file');
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    if (!FONT_EXTENSIONS.has(ext)) stats.binary += 1;
    continue;
  }
  const text = readFileSync(join(root, rel), 'utf8');
  const map = ext === '.map' ? parseSourceMap(text) : undefined;
  if (map) scanSourceMap(rel, map);
  else {
    stats.text += 1;
    scanText(
      rel,
      text,
      ALLOWANCES.find((a) => a.file.test(rel)),
    );
  }
}

if (allowed.fonts === 0) report('stale-allowance', '(fonts)', `no file matches ${ALLOWED_FONT}`);
if (allowed.workspaceMentions === 0) {
  report(
    'stale-allowance',
    '(workspace sources)',
    'no source map copy of a libs/ or apps/ file names the scope',
  );
}
for (const allowance of ALLOWANCES) {
  if (allowanceFiles.get(allowance.id) === 0) {
    report('stale-allowance', `(${allowance.id})`, `no file matches ${allowance.file}`);
    continue;
  }
  for (const s of allowance.strings) {
    if (!usedStrings.get(allowance.id).has(s)) {
      report('stale-allowance', `(${allowance.id})`, `${JSON.stringify(s)} occurs nowhere`);
    }
  }
}

printReport();

/** @param {string} text */
function parseSourceMap(text) {
  try {
    const map = JSON.parse(text);
    return Array.isArray(map?.sources) ? map : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} file
 * @param {string} text
 * @param {(typeof ALLOWANCES)[number]} [allowance]
 * @param {{ mentionsAllowed?: boolean }} [options]
 */
function scanText(file, text, allowance, { mentionsAllowed = false } = {}) {
  report('satori-token', file, '--sat-', count(text, TOKEN));
  for (const m of text.matchAll(FONT_NAME)) report('font', file, m[0].toLowerCase());
  for (const m of text.matchAll(COMPILED_MODULE)) report('satori-module', file, m[0]);
  let rest = text.replace(COMPILED_MODULE, ' ');
  if (allowance) {
    allowanceFiles.set(allowance.id, allowanceFiles.get(allowance.id) + 1);
    for (const s of allowance.strings) {
      const n = rest.split(s).length - 1;
      if (n === 0) continue;
      usedStrings.get(allowance.id).add(s);
      allowed.strings += n;
      rest = rest.split(s).join(' ');
    }
  }
  const mentions = count(rest, MENTION);
  if (mentionsAllowed) allowed.workspaceMentions += mentions;
  else report('satori-mention', file, 'hylandsoftware', mentions);
}

/** @param {string} path */
function countIndexEntries(path) {
  try {
    return Object.keys(JSON.parse(readFileSync(path, 'utf8')).entries ?? {}).length;
  } catch {
    return 0;
  }
}

/** @param {string} file @param {{ sources: unknown[], sourcesContent?: unknown[] }} map */
function scanSourceMap(file, map) {
  stats.maps += 1;
  const { sources, sourcesContent = [], ...rest } = map;
  scanText(file, JSON.stringify(rest));
  sources.forEach((source, i) => {
    stats.sources += 1;
    const path = String(source);
    const shortPath = path.replace(/^webpack:\/\/[^/]+\/\.\//, '');
    if (SATORI_NAME.test(path)) report('satori-module', file, `source ${shortPath}`);
    const content = sourcesContent[i];
    if (typeof content === 'string') {
      scanText(`${file} -> ${shortPath}`, content, undefined, {
        mentionsAllowed: WORKSPACE_SOURCE.test(path),
      });
    }
  });
}

/** @param {string} text @param {RegExp} re */
function count(text, re) {
  return text.match(re)?.length ?? 0;
}

function printReport() {
  console.log(`storybook-publication-gate: ${dirArg}`);
  console.log(
    `  scanned ${stats.files} files of a Storybook indexing ${indexEntries} stories and docs pages: ` +
      `${stats.text} read as text, ${stats.maps} source maps (${stats.sources} sources), ` +
      `${stats.fonts} fonts, ${stats.binary} other binary`,
  );
  for (const a of ALLOWANCES) {
    console.log(
      `  allowed: ${a.id} — ${usedStrings.get(a.id).size} of ${a.strings.length} strings in ` +
        `${allowanceFiles.get(a.id)} file(s), because ${a.why}`,
    );
  }
  console.log(
    `  allowed: ${allowed.strings} listed string occurrence(s), ` +
      `${allowed.workspaceMentions} mention(s) in source-map copies of libs/ and apps/ files, ` +
      `${allowed.fonts} Storybook font file(s)`,
  );

  if (findings.size === 0) {
    console.log(
      'storybook-publication-gate: PASS — no Satori token, font, module, path or unlisted mention.',
    );
    process.exit(0);
  }

  const byRule = new Map();
  for (const f of findings.values()) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  const limit = 15;
  for (const [rule, list] of byRule) {
    const total = list.reduce((sum, f) => sum + f.count, 0);
    console.log(`\n  [FAIL] ${rule}: ${RULES[rule]} — ${total} in ${list.length} place(s)`);
    for (const f of list.slice(0, limit)) {
      const times = f.count > 1 ? ` x${f.count}` : '';
      console.log(`         ${f.file}: ${f.detail}${times}`);
    }
    if (list.length > limit) console.log(`         … and ${list.length - limit} more`);
  }
  console.log(
    `\nstorybook-publication-gate: FAIL — ${[...byRule.keys()].join(', ')}. Publish only ` +
      '`satori-components:build-storybook:ci`; the Satori Storybooks may not be distributed.',
  );
  process.exit(1);
}
