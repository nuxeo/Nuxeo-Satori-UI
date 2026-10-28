#!/usr/bin/env node
/**
 * Lays both themes of the component library out under one site and writes the landing page.
 *
 * `/satori` and `/material` are the same stories from the same library, built twice under the two
 * themes, so one host serves both and you can compare them by editing the path. That is the whole
 * point of the site: the public Storybook can only ever show one of the two.
 *
 * A shell `cp -R` with interpolated paths is how a blank site gets published: a renamed output
 * directory copies nothing, the deploy succeeds, and the site is an empty shell nobody notices
 * until they open it. So each Storybook is asserted to BE a Storybook — `index.html`,
 * `iframe.html`, and an `index.json` that lists at least one entry — before it is copied, and a
 * missing one fails the build.
 *
 * Usage:  node scripts/assemble-site.mjs --source <checkout> --out <dir> [--template <file>]
 * Exit 0 assembled, 1 an output is missing or not a Storybook, 2 bad usage.
 *
 * Reads SOURCE_REF, SOURCE_SHA and RUN_URL for the provenance line on the landing page; without
 * them it writes "unknown", so a hand-run site never claims a commit it was not built from.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The two halves of the site, in the order the workflow builds them.
 *
 * Only `/satori` carries Satori. `/material` is byte-for-byte the build that goes to the public
 * site — the workflow builds it with GitHub Packages moved out of `node_modules`, exactly as the
 * public workflow does, so it is the real comparison and not a lookalike built against packages
 * the public build never sees.
 */
const STORYBOOKS = [
  {
    path: 'satori',
    dist: 'dist/storybook/satori-components-satori-theme',
    target: 'satori-components:build-storybook:satori',
    title: 'Satori',
    blurb:
      'The <code>nxs-</code> component library under Satori’s theme. Cannot be published publicly: it carries Satori’s tokens and fonts.',
  },
  {
    path: 'material',
    dist: 'dist/storybook/satori-components',
    target: 'satori-components:build-storybook:ci',
    title: 'Material',
    blurb:
      'The same library and the same stories under Angular Material — identical to what the public Storybook serves.',
  },
];

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args.out) {
  console.error(
    'Usage: node scripts/assemble-site.mjs --source <checkout> --out <dir> [--template <file>]',
  );
  process.exit(2);
}

const sourceRoot = resolve(args.source);
const outRoot = resolve(args.out);
const templatePath = resolve(args.template ?? 'site/index.html');

// Everything is checked before anything is written. A failure half-way through used to leave an
// output directory holding the Storybooks but no landing page — harmless, because the job stops
// before uploading, but it made a local run look like it had half worked.
/** @type {string[]} */
const problems = [];
/** @type {{ book: (typeof STORYBOOKS)[number], dir: string, entries: number }[]} */
const ready = [];

for (const book of STORYBOOKS) {
  const dir = join(sourceRoot, book.dist);
  if (!existsSync(dir)) {
    problems.push(
      `${book.dist} does not exist. Did \`nx run ${book.target}\` run, and is its outputDir ` +
        'still this path?',
    );
    continue;
  }
  const missing = ['index.html', 'iframe.html'].filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) {
    problems.push(`${book.dist} is not a Storybook build (no ${missing.join(', ')}).`);
    continue;
  }
  const entries = countIndexEntries(join(dir, 'index.json'));
  if (entries === 0) {
    problems.push(
      `${book.dist} has no index.json listing a story or docs page, so it is not a Storybook ` +
        'anyone could read.',
    );
    continue;
  }
  ready.push({ book, dir, entries });
}

const sha = process.env.SOURCE_SHA ?? '';
const replacements = {
  __SOURCE_REF__: escapeHtml(process.env.SOURCE_REF ?? 'unknown'),
  __SOURCE_SHA__: escapeHtml(sha || 'unknown'),
  __SOURCE_SHA_SHORT__: escapeHtml(sha ? sha.slice(0, 8) : 'unknown'),
  __BUILT_AT__: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  __RUN_URL__: escapeHtml(process.env.RUN_URL ?? ''),
  __CARDS__: STORYBOOKS.map(card).join('\n'),
};

let html = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : undefined;
if (html === undefined) {
  problems.push(
    `${args.template ?? 'site/index.html'} does not exist, so there is no landing page.`,
  );
} else {
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  const leftover = html.match(/__[A-Z_]+__/g);
  if (leftover) {
    problems.push(
      `${templatePath} still has unsubstituted placeholder(s): ` +
        `${[...new Set(leftover)].join(', ')}. The landing page would show them to readers.`,
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`\n  [FAIL] ${problem}`);
  console.error('\nassemble-site: FAIL — refusing to publish an incomplete site. Nothing written.');
  process.exit(1);
}

mkdirSync(outRoot, { recursive: true });
for (const { book, dir, entries } of ready) {
  cpSync(dir, join(outRoot, book.path), { recursive: true });
  console.log(`  copied ${book.dist} -> /${book.path}/ (${entries} stories and docs pages)`);
}
writeFileSync(join(outRoot, 'index.html'), /** @type {string} */ (html));
console.log(`  wrote /index.html from ${templatePath}`);
console.log(
  `\nassemble-site: PASS — ${STORYBOOKS.length} Storybooks and a landing page in ${args.out}.`,
);

/** @param {(typeof STORYBOOKS)[number]} book */
function card(book) {
  return (
    `        <a class="card" href="./${book.path}/">\n` +
    `          <h2>${book.title}</h2>\n` +
    `          <p>${book.blurb}</p>\n` +
    `          <code>${book.target}</code>\n` +
    `        </a>`
  );
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = argv[i].match(/^--([a-z-]+)$/);
    if (match && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[match[1]] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

/** @param {string} path */
function countIndexEntries(path) {
  try {
    return Object.keys(JSON.parse(readFileSync(path, 'utf8')).entries ?? {}).length;
  } catch {
    return 0;
  }
}

/** @param {string} text */
function escapeHtml(text) {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}
