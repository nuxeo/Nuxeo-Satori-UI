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

/**
 * A URL the repository tells a reader to visit. Dead means the reader is sent nowhere.
 *
 * Hand-maintained, and that is the gate's main limitation: it does not discover addresses by
 * scanning the repository, so a URL advertised in a document and absent from this list is not
 * checked. Do not read a pass as "every published link in the repository works".
 */
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

/**
 * `--ledger <path>` replaces both lists. Every way of getting it wrong is reported in this gate's
 * own voice and exits 1, rather than as a Node stack trace.
 *
 * It already failed safe — an unhandled throw is exit 1, which the runner classifies as FAIL — so
 * this is about diagnosability, not about a false pass. But a gate whose misuse surfaces as
 * `TypeError: path must be a string` reads as a defect in the gate rather than in the invocation,
 * and this file's other refusals (an empty ledger, an unanswered probe) all say what went wrong
 * and what to do. Raised in review on PR #544.
 */
const ledgerFlag = process.argv.indexOf('--ledger');

/** @returns {{ advertised: unknown[], knownDead: unknown[] }} */
function readLedger() {
  if (ledgerFlag === -1) return { advertised: ADVERTISED, knownDead: KNOWN_DEAD };

  const path = process.argv[ledgerFlag + 1];
  const refuse = (why) => {
    console.error(
      `published-links: --ledger ${why}\n` +
        '  Usage: node scripts/beta-harness/published-links.mjs [--ledger <path-to-json>]\n' +
        '  The JSON holds { "advertised": [...], "knownDead": [...] }; omit --ledger to use the\n' +
        "  gate's own two lists.",
    );
    process.exit(1);
  };

  if (path === undefined || path.startsWith('--')) {
    refuse(`needs a path, and was given ${path === undefined ? 'nothing' : `\`${path}\``}.`);
  }

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    refuse(`could not read \`${path}\` — ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    refuse(`file \`${path}\` is not valid JSON — ${error.message}`);
  }

  // A string or an array would otherwise reach `.advertised` as `undefined` and read as an empty
  // ledger, which is a different refusal with a misleading reason.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    refuse(
      `file \`${path}\` must hold a JSON object with "advertised" and "knownDead", not ` +
        `${Array.isArray(parsed) ? 'an array' : typeof parsed}.`,
    );
  }
  for (const key of ['advertised', 'knownDead']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      refuse(`file \`${path}\` has "${key}" as ${typeof parsed[key]}, not a list.`);
    }
  }

  /**
   * Every entry is validated before anything is probed.
   *
   * The list-shape check above stopped at "is it an array", which review on PR #554 showed is not
   * enough — and the two cases it named were only half of it. All four were driven against the
   * real gate before fixing:
   *
   * | ledger | was | wrong because |
   * | --- | --- | --- |
   * | `{"advertised":[{}]}` | exit 78, "gave no response" | a configuration error reported as a network gap |
   * | `{"advertised":[null]}` | `TypeError` stack trace | the shape this gate's own refusals exist to avoid |
   * | a `file:` URL | exit 78, "fetch failed" | not an address a reader could follow at all |
   * | the same URL in both lists | accepted | asserted alive **and** dead; whichever it is, one claim is false |
   *
   * The first is the worst of the four: NOT RUN is the verdict for "I could not find out", and
   * spending it on a malformed ledger means a real inspection gap and a typo look identical.
   */
  const seen = new Map();
  for (const [key, required] of [
    ['advertised', ['advertisedIn']],
    ['knownDead', ['why', 'owner', 'fix']],
  ]) {
    (parsed[key] ?? []).forEach((entry, index) => {
      const at = `"${key}"[${index}]`;
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        refuse(
          `file \`${path}\` has ${at} as ${entry === null ? 'null' : Array.isArray(entry) ? 'an array' : typeof entry}, ` +
            'not an object with a "url".',
        );
      }
      if (typeof entry.url !== 'string' || entry.url === '') {
        refuse(`file \`${path}\` has ${at} with no "url" string.`);
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(entry.url);
      } catch {
        refuse(`file \`${path}\` has ${at} whose "url" is not a URL: \`${entry.url}\`.`);
      }
      // Only a scheme a reader could follow. A `file:` or `data:` URL would reach `fetch` and come
      // back as "no response", which would read as an inspection gap rather than as a bad entry.
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        refuse(
          `file \`${path}\` has ${at} with the scheme \`${parsedUrl.protocol}\`; only http: and ` +
            'https: are addresses a reader can follow.',
        );
      }
      for (const field of required) {
        if (typeof entry[field] !== 'string' || entry[field] === '') {
          refuse(
            `file \`${path}\` has ${at} with no "${field}", so a finding about it could not say ` +
              `${key === 'advertised' ? 'where it is advertised' : 'who owns the fix'}.`,
          );
        }
      }
      const previous = seen.get(entry.url);
      if (previous) {
        refuse(
          `file \`${path}\` lists \`${entry.url}\` in both ${previous} and ${at}, so it is ` +
            'asserted to answer and to stay dead at once. Whichever it does, one claim is false.',
        );
      }
      seen.set(entry.url, at);
    });
  }
  return parsed;
}

const ledger = readLedger();
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
/**
 * Probes that produced no HTTP response at all, and are therefore evidence of nothing.
 *
 * A timeout, a DNS failure or a refused connection yields `status: null`. The first version read
 * that as "not 2xx" and so, for a `KNOWN_DEAD` entry, as **confirmation that the link is still
 * dead** — the gate could report pass having established neither claim. Review caught it
 * (PR #544), and it is the standard this repository already applies elsewhere, stated in this
 * file's own header and broken here: *reading nothing must not pass as finding nothing.*
 *
 * It is not a FAIL either, in either direction. A laptop on a plane, or a DNS blip, is not a dead
 * published address, and a gate that goes red for the network gets bypassed and then ignored —
 * which is the reasoning `supply-chain` records for gating on the production audit only.
 *
 * So an unanswered probe is an **inspection gap**, and the gate reports NOT RUN. `published-links`
 * already declares `mayNotRun: true`, so the runner records it as NOT RUN rather than green and
 * the whole run becomes `pass-incomplete`. A definite finding still wins: FAIL outranks a gap,
 * because one unreachable address must not mask a genuinely dead one.
 */
const gaps = [];

for (const entry of advertised) {
  const { status, finalUrl, error } = await probe(entry.url);
  const moved = finalUrl !== entry.url ? ` (via ${finalUrl})` : '';
  if (status === null) {
    gaps.push(
      `${entry.url} (advertised in ${entry.advertisedIn}) gave no response — ${error}.\n` +
        '  That is not evidence it is dead, and not evidence it is alive.',
    );
    continue;
  }
  if (status >= 200 && status < 300) {
    notes.push(`  alive  ${status}  ${entry.url}${moved}`);
    continue;
  }
  failures.push(
    `${entry.url} is advertised in ${entry.advertisedIn} and answers ${status}.\n` +
      '  A reader following it is sent nowhere. Fix the destination or stop advertising it.',
  );
}

for (const entry of knownDead) {
  const { status, finalUrl, error } = await probe(entry.url);
  if (status === null) {
    gaps.push(
      `${entry.url} (recorded as dead) gave no response — ${error}.\n` +
        '  An unanswered probe does not confirm the record. Re-run with the network reachable.',
    );
    continue;
  }
  if (!(status >= 200 && status < 300)) {
    notes.push(`  dead   ${status}  ${entry.url} — ${entry.owner} owns the fix`);
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
  for (const gap of gaps) console.error(`- UNANSWERED: ${gap}\n`);
  process.exit(1);
}

if (gaps.length) {
  console.log(
    `\npublished-links: NOT RUN — ${gaps.length} of ${advertised.length + knownDead.length} ` +
      'address(es) gave no response, so this run establishes nothing about them.\n',
  );
  for (const gap of gaps) console.log(`- ${gap}\n`);
  process.exit(NOT_RUN_EXIT_CODE);
}

console.log(
  `\npublished-links: pass — ${advertised.length} advertised URL(s) answer, ` +
    `${knownDead.length} recorded as dead still do not. Both directions are load-bearing.`,
);
