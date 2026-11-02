#!/usr/bin/env node
/**
 * The published URLs this repository advertises, and the ones it records as dead.
 *
 * ## Why this exists
 *
 * The repository was renamed from `agentic-ui-poc` to `Nuxeo-Satori-UI` on 30 October 2026.
 * GitHub redirects a renamed repository's *repository* URL and **not** its *Pages* site, so
 * `https://nuxeo.github.io/agentic-ui-poc/` has been 404 with no `Location` header ever since.
 * In-repo links were fixed in `9953ee175`; links in Confluence, in Jira and in anybody's
 * bookmarks were not, including any a reviewer followed.
 *
 * Separately, the public Storybook was stale for five days, 23–28 October, because its deploy
 * workflow was gated on a deleted branch. That one was found because a human opened the page.
 * Nothing in this repository was watching either address.
 *
 * ## The two directions, and why both are load-bearing
 *
 * A liveness check on its own rots in the direction nobody looks. So:
 *
 * - **`ADVERTISED`** — a URL this repository tells a reader to visit. Must answer 2xx, or 3xx to
 *   something that answers 2xx. A dead one fails the gate.
 * - **`KNOWN_DEAD`** — a URL recorded as dead, with who can fix it and what the fix is. Must
 *   *stay* dead. One that starts answering also fails the gate, with the instruction to promote
 *   it and delete the ledger entry. Without this half, `docs/pages-redirect/README.md` would
 *   still describe a 404 years after somebody quietly fixed it, and this file would be the
 *   evidence for that stale claim.
 *
 * ## Usage
 *
 *   node scripts/beta-harness/published-links.mjs
 *   BETA_SKIP_PUBLISHED_LINKS=1 node scripts/beta-harness/published-links.mjs   # NOT RUN
 *   node scripts/beta-harness/published-links.mjs --ledger <path-to-json>
 *
 * Needs the network. Skipped, it exits with the runner's not-run code, which is never counted
 * green: the run is `pass-incomplete`, not `pass`.
 *
 * `--ledger` replaces both lists, and exists for the controls in `published-links.selftest.mjs`:
 * they point it at a local HTTP server, so all four outcomes — advertised alive, advertised dead,
 * known-dead dead, known-dead alive — are exercised without the network and without waiting for
 * the real web to break.
 */

import { readFileSync } from 'node:fs';

import { NOT_RUN_EXIT_CODE } from './gate-summary.mjs';

/** A URL the repository tells a reader to visit. Dead means the reader is sent nowhere. */
export const ADVERTISED = [
  {
    url: 'https://nuxeo.github.io/Nuxeo-Satori-UI/',
    advertisedIn: 'AGENTS/00-architecture.md, and the component library Overview pages',
  },
  {
    url: 'https://github.com/nuxeo/Nuxeo-Satori-UI',
    advertisedIn: 'README.md',
  },
];

/**
 * A URL recorded as dead. Each entry names who can act and what the action is, because an
 * unowned record of a broken thing is a record that nothing will ever close.
 */
export const KNOWN_DEAD = [
  {
    url: 'https://nuxeo.github.io/agentic-ui-poc/',
    why: 'The Pages site of the pre-rename repository name. GitHub does not redirect Pages.',
    owner: 'A `nuxeo` organisation admin',
    fix: 'docs/pages-redirect/README.md — publish the stub, then move this entry to ADVERTISED.',
  },
];

const ledgerFlag = process.argv.indexOf('--ledger');
const ledger =
  ledgerFlag === -1
    ? { advertised: ADVERTISED, knownDead: KNOWN_DEAD }
    : JSON.parse(readFileSync(process.argv[ledgerFlag + 1], 'utf8'));
const advertised = ledger.advertised ?? [];
const knownDead = ledger.knownDead ?? [];

if (advertised.length === 0 && knownDead.length === 0) {
  console.error(
    'published-links: both lists are empty, so this run checked nothing. That is not a pass.',
  );
  process.exit(1);
}

if (process.env['BETA_SKIP_PUBLISHED_LINKS'] === '1') {
  console.log(
    'published-links: NOT RUN — BETA_SKIP_PUBLISHED_LINKS=1.\n' +
      `  ${advertised.length} advertised and ${knownDead.length} known-dead URL(s) were not checked.`,
  );
  process.exit(NOT_RUN_EXIT_CODE);
}

/**
 * The final status after following redirects, and the chain taken to get there.
 *
 * `redirect: 'follow'` on purpose: a 301 to a live page is a working link, and the old
 * repository URL is exactly that. What matters is where a reader ends up.
 *
 * @param {string} url
 * @returns {Promise<{ status: number | null, finalUrl: string, error?: string }>}
 */
async function probe(url) {
  try {
    // GET, not HEAD: GitHub Pages answers HEAD on a missing path inconsistently, and a 200 to a
    // HEAD with a 404 body would read as alive.
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, finalUrl: response.url };
  } catch (error) {
    return { status: null, finalUrl: url, error: error.message };
  }
}

const failures = [];
const notes = [];

for (const entry of advertised) {
  const { status, finalUrl, error } = await probe(entry.url);
  const alive = status !== null && status >= 200 && status < 300;
  const moved = finalUrl !== entry.url ? ` (via ${finalUrl})` : '';
  if (alive) {
    notes.push(`  alive  ${status}  ${entry.url}${moved}`);
    continue;
  }
  failures.push(
    `${entry.url} is advertised in ${entry.advertisedIn} and answers ` +
      `${status === null ? `no response — ${error}` : status}.\n` +
      '  A reader following it is sent nowhere. Fix the destination or stop advertising it.',
  );
}

for (const entry of knownDead) {
  const { status, finalUrl } = await probe(entry.url);
  const alive = status !== null && status >= 200 && status < 300;
  if (!alive) {
    notes.push(`  dead   ${status ?? 'no response'}  ${entry.url} — ${entry.owner} owns the fix`);
    continue;
  }
  failures.push(
    `${entry.url} is recorded as dead and now answers ${status}${
      finalUrl !== entry.url ? ` (via ${finalUrl})` : ''
    }.\n` +
      '  Good news, and still a failure: the record outlived its subject. Move it to ADVERTISED\n' +
      `  and delete what it says in ${entry.fix}`,
  );
}

for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\npublished-links: FAIL — ${failures.length} problem(s)\n`);
  for (const message of failures) console.error(`- ${message}\n`);
  process.exit(1);
}

console.log(
  `\npublished-links: pass — ${advertised.length} advertised URL(s) answer, ` +
    `${knownDead.length} recorded as dead still do not. Both directions are load-bearing.`,
);
