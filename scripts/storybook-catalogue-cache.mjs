#!/usr/bin/env node
/**
 * Refuses a Storybook build whose translation catalogue could be served to it stale.
 *
 * ## The defect this exists for
 *
 * Every file a built Storybook serves has a content hash in its name — except the catalogues,
 * which `main.ts` copies in through `staticDirs` and which keep their own names. GitHub Pages
 * serves them `cache-control: max-age=600`. So for ten minutes after a deploy, a browser or a CDN
 * POP holding the *previous* `i18n/en.json` answers the *new* bundle with it, and every key that
 * deploy added renders as the raw key.
 *
 * That shipped. NXSAT-331 added `nxs-storyboard`, `nxs-asset-grid` and `nxs-asset-facets-drawer`
 * on 2026-11-04, and their published docs pages showed `satori-components.asset-facets-drawer.*`
 * where their chrome should have been — while text passed as story args rendered normally,
 * because only the catalogue was behind. Nothing was wrong with the build, the catalogue or the
 * loader; the two were simply from different deploys.
 *
 * The fix is for `preview.ts` to fetch the catalogue at a URL stamped with a hash of the
 * catalogues the build shipped, so the stamp is part of the cache key and a build can only ever
 * read the catalogue it was built against. This asserts that is still true of the output.
 *
 * ## What it checks, in the build's own bytes
 *
 * 1. The preview bundles request the catalogue from a URL carrying `?v=<stamp>`, and no bundle
 *    requests it without one. A single un-stamped request is enough to reintroduce the defect.
 * 2. Every stamp found is the same one.
 * 3. That stamp equals a hash of the `i18n/*.json` the build actually shipped.
 * 4. No bundle builds a catalogue path the gate cannot read in full. (1) can only judge a path
 *    written as one string literal; a concatenated one is invisible to it, and because (1) is
 *    build-wide, a single recognisable stamped request elsewhere was enough to report such a
 *    build "all stamped". Found in review on #563.
 *
 * (3) is the load-bearing check. (1) alone passes a hard-coded stamp that never changes, which
 * would cache the *first* catalogue ever published forever — strictly worse than the defect.
 * Reading the shipped bytes rather than `main.ts` is deliberate: what is published is what can
 * go stale, and a check that reads the config would agree with a build that shipped something
 * else. The controls are in `storybook-catalogue-cache.selftest.mjs`.
 *
 * Usage:  node scripts/storybook-catalogue-cache.mjs <storybook-dir>
 * Exit 0 the catalogue cannot be served stale, 1 it can, 2 nothing to inspect.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/** Where `main.ts` copies the catalogues to, relative to the build root. */
export const CATALOGUE_DIR = 'i18n';

/**
 * A request for a catalogue, stamped or not: `i18n/en.json`, `i18n/${lang}.json?v=abc123`.
 *
 * Anchored to the start of a string or a path segment, because a bundle may also *mention* a
 * catalogue path in prose — `getting-started.mdx` is compiled into this build and documents how
 * the library is wired. "the catalogue lives at i18n/<lang>.json" is not a request and failing on
 * it would make the gate something to work around rather than satisfy.
 */
const CATALOGUE_REQUEST = /(?<=["'`/])i18n\/[^"'`\s]{0,40}?\.json(\?v=([0-9a-f]+))?/g;

/**
 * A catalogue path that *begins* a string literal, whether or not a whole request follows it.
 *
 * `CATALOGUE_REQUEST` can only see a path that is one literal end to end. A path built by
 * concatenation is invisible to it — `fetch('i18n/' + lang + '.json')` compiles to
 * `"i18n/"+l+".json"`, and the `"` after the slash ends the character class before `.json` is
 * reached, as does the `"` in `"i18n/".concat(l, ".json")`. Recognising those would mean parsing
 * the expression, so this fails closed instead: any literal that starts a catalogue path and is
 * not the start of a request the gate could read in full is reported, because a path the gate
 * cannot resolve is a path it cannot certify as stamped.
 *
 * That matters because the `!stamped && !unstamped` guard below is build-wide: one recognisable
 * stamped request anywhere was enough to report a build "all stamped" while another bundle still
 * fetched an unversioned catalogue. The selftest's `one bundle stamped and another not` control
 * did not catch it — its unstamped request is a literal, which the gate can see.
 *
 * Only a quote opens a literal here, deliberately not the `/` that `CATALOGUE_REQUEST` also
 * accepts: `"assets/i18n/en.json"` is read in full by that pattern and is not a loose end, and
 * the prose in `getting-started.mdx` — "the catalogue lives at i18n/<lang>.json" — follows a
 * space, so it is not a string start and stays exempt.
 */
const CATALOGUE_LITERAL_START = /(?<=["'`])i18n\//g;

/**
 * The stamp a build's catalogues should carry — the same hash `main.ts` computes, over the files
 * as shipped. Exported so the selftest cannot drift from it by restating the algorithm.
 */
export function catalogueStamp(catalogueDir) {
  return createHash('sha256')
    .update(
      readdirSync(catalogueDir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => `${file}:${readFileSync(join(catalogueDir, file), 'utf8')}`)
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 16);
}

/** Every `.js` file in the build, which is where the preview's catalogue request is compiled to. */
function scripts(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) scripts(path, found);
    else if (extname(path) === '.js') found.push(path);
  }
  return found;
}

/**
 * @returns {{ problems: string[], stamped: number, expected: string }}
 */
export function checkCatalogueCache(dir) {
  const problems = [];
  const catalogues = join(dir, CATALOGUE_DIR);
  if (!existsSync(catalogues) || !readdirSync(catalogues).some((f) => f.endsWith('.json'))) {
    return {
      problems: [
        `${CATALOGUE_DIR}/ has no catalogue in it, so the build serves none. Did staticDirs change?`,
      ],
      stamped: 0,
      expected: '',
    };
  }
  const expected = catalogueStamp(catalogues);
  const stamps = new Set();
  let stamped = 0;
  let unstamped = 0;
  let unresolved = 0;
  for (const script of scripts(dir)) {
    const source = readFileSync(script, 'utf8');
    // Where a request the gate could read end to end begins, so a literal starting at the same
    // offset is accounted for rather than reported as a loose end.
    const resolved = new Set();
    for (const match of source.matchAll(CATALOGUE_REQUEST)) {
      const [request, , stamp] = match;
      resolved.add(match.index);
      if (!stamp) {
        unstamped += 1;
        if (unstamped <= 3) {
          problems.push(
            `${script.slice(dir.length + 1)} requests the catalogue as \`${request}\`, with no ` +
              '`?v=` stamp, so a cached copy of a previous deploy answers it.',
          );
        }
        continue;
      }
      stamped += 1;
      stamps.add(stamp);
    }
    for (const match of source.matchAll(CATALOGUE_LITERAL_START)) {
      if (resolved.has(match.index)) continue;
      unresolved += 1;
      if (unresolved <= 3) {
        problems.push(
          `${script.slice(dir.length + 1)} builds a catalogue path this gate cannot read in full ` +
            `(near \`${source.slice(match.index, match.index + 32).split('\n')[0]}\`), so it ` +
            'cannot certify the path as stamped. Request the catalogue from one string literal ' +
            'including its `?v=` stamp.',
        );
      }
    }
  }
  if (!stamped && !unstamped && !unresolved) {
    problems.push(
      'no script in the build requests a catalogue at all. Either `preview.ts` stopped fetching ' +
        'one, or the URL it builds is no longer recognisable here — this check would then pass ' +
        'an unstamped request it could not see.',
    );
  }
  if (stamps.size > 1) {
    problems.push(`the build carries ${stamps.size} different stamps: ${[...stamps].join(', ')}.`);
  }
  for (const stamp of stamps) {
    if (stamp !== expected) {
      problems.push(
        `the catalogue is requested with \`?v=${stamp}\` but the ${CATALOGUE_DIR}/ this build ` +
          `shipped hashes to ${expected}. The bundle and the catalogue are from different builds.`,
      );
    }
  }
  return { problems, stamped, expected };
}

/** `true` when run as a script rather than imported by the selftest. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const given = process.argv[2];
  if (!given) {
    console.error('Usage: node scripts/storybook-catalogue-cache.mjs <storybook-dir>');
    process.exit(2);
  }
  const dir = resolve(given);
  if (!existsSync(join(dir, 'iframe.html'))) {
    console.error(
      `storybook-catalogue-cache: ${given} is not a Storybook build (no iframe.html). Build it ` +
        'first: npx nx run satori-components:build-storybook',
    );
    process.exit(2);
  }
  const { problems, stamped, expected } = checkCatalogueCache(dir);
  for (const problem of problems) console.error(`storybook-catalogue-cache: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(
    `storybook-catalogue-cache: ${stamped} catalogue request(s), all stamped ?v=${expected}, ` +
      `which is the hash of the ${CATALOGUE_DIR}/ this build shipped. It cannot be served a ` +
      'catalogue from another deploy.',
  );
}
