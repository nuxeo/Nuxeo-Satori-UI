#!/usr/bin/env node
/**
 * Lays the two Storybook builds out as the published site: Material at the root, Satori under
 * `/satori/`.
 *
 * The root keeps serving what it always has, so every existing link to
 * https://nuxeo.github.io/agentic-ui-poc/ still lands on the Material Storybook. `/satori/` is new
 * and carries Satori's tokens and fonts, which the Satori package owners approved publishing.
 *
 * A shell `cp -R` with interpolated paths is how a blank site gets published: a renamed output
 * directory copies nothing, the deploy succeeds, and the site is an empty shell nobody notices
 * until they open it. So each build is asserted to BE a Storybook — `index.html`, `iframe.html`,
 * and an `index.json` listing at least one entry — and every check runs before the first byte is
 * copied, so a failure leaves nothing half-written.
 *
 * This does NOT decide what may be published. `storybook-publication-gate.mjs` does, and the
 * workflow runs it on the Material build before calling this, while that build is still a tree of
 * its own. Pointing the gate at the assembled site would fail by design, because `/satori/` is
 * supposed to carry Satori.
 *
 * Usage:  node scripts/storybook-assemble-site.mjs --material <dir> --satori <dir> --out <dir>
 * Exit 0 assembled, 1 a build is missing or not a Storybook, 2 bad usage.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where Satori goes, relative to the site root. Also the one path Material may not itself contain. */
const SATORI_PATH = 'satori';

const args = parseArgs(process.argv.slice(2));
if (!args.material || !args.satori || !args.out) {
  console.error(
    'Usage: node scripts/storybook-assemble-site.mjs --material <dir> --satori <dir> --out <dir>',
  );
  process.exit(2);
}

const builds = [
  { flag: 'material', dir: resolve(args.material), to: '', label: 'Material' },
  { flag: 'satori', dir: resolve(args.satori), to: SATORI_PATH, label: 'Satori' },
];
const outRoot = resolve(args.out);

/** @type {string[]} */
const problems = [];
/** @type {{ build: (typeof builds)[number], entries: number }[]} */
const ready = [];

for (const build of builds) {
  const given = args[build.flag];
  if (!existsSync(build.dir)) {
    problems.push(
      `--${build.flag} ${given} does not exist. Did its build run, and is its outputDir still that path?`,
    );
    continue;
  }
  const missing = ['index.html', 'iframe.html'].filter((f) => !existsSync(join(build.dir, f)));
  if (missing.length > 0) {
    problems.push(`--${build.flag} ${given} is not a Storybook build (no ${missing.join(', ')}).`);
    continue;
  }
  const entries = countIndexEntries(join(build.dir, 'index.json'));
  if (entries === 0) {
    problems.push(
      `--${build.flag} ${given} has no index.json listing a story or docs page, so it is not a ` +
        'Storybook anyone could read.',
    );
    continue;
  }
  ready.push({ build, entries });
}

// Material is copied to the root, so a `satori` entry of its own would be overwritten by the
// Satori build and the site would silently lose it. Nothing creates one today; this is here so
// that if something ever does, the deploy stops instead of eating it.
const material = builds[0];
if (existsSync(material.dir) && readdirSync(material.dir).includes(SATORI_PATH)) {
  problems.push(
    `the Material build already contains a "${SATORI_PATH}" entry, which copying the Satori ` +
      'build over the root would overwrite. Rename one of them.',
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`\n  [FAIL] ${problem}`);
  console.error(
    '\nstorybook-assemble-site: FAIL — refusing to publish an incomplete site. Nothing written.',
  );
  process.exit(1);
}

mkdirSync(outRoot, { recursive: true });
for (const { build, entries } of ready) {
  const destination = build.to ? join(outRoot, build.to) : outRoot;
  cpSync(build.dir, destination, { recursive: true });
  console.log(
    `  copied ${build.label} -> /${build.to}${build.to ? '/' : ''} (${entries} stories and docs pages)`,
  );
}

// What was asked for is not what landed unless both entry points are really there.
const landed = ['index.html', join(SATORI_PATH, 'index.html')].filter(
  (f) => !existsSync(join(outRoot, f)),
);
if (landed.length > 0) {
  console.error(
    `\nstorybook-assemble-site: FAIL — after copying, ${landed.join(' and ')} is missing from ` +
      `${args.out}. The site would not serve what it claims to.`,
  );
  process.exit(1);
}

console.log(
  `\nstorybook-assemble-site: PASS — Material at /, Satori at /${SATORI_PATH}/, in ${args.out}.`,
);

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
