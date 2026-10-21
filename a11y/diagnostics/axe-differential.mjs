#!/usr/bin/env node
/**
 * Differential axe harness — settles "The open disagreement" in `docs/accessibility.md`.
 *
 * a11y-scout's first baseline reported 8 `color-contrast` and 2 `button-name` findings.
 * `scripts/beta-harness/steps/phase-6-a11y.mjs` records both rules as driven to zero, with an
 * empty `KNOWN_VIOLATIONS`. Both cannot be right, and under the ownership standard phase-6 owns
 * the axe verdict — so if phase-6 is the one that is wrong, the published conformance number is
 * wrong with it.
 *
 * ## Hypotheses already eliminated without a browser, so this script does not re-test them
 *
 *   1. **Different axe versions.** `npm ls axe-core --all` resolves ONE deduped `axe-core@4.13.0`
 *      for both `@axe-core/playwright@4.13.0` and `a11y-scout@0.3.0`. Identical engine.
 *   2. **a11y-scout's reflow check resizing the viewport.** In the package's own (upstream, not in
 *      this repo) `src/agents/scan-page.ts`
 *      axe runs at line 121, reflow at 271 and the keyboard walk at 279 — axe runs FIRST, before
 *      anything resizes, and `reflow.ts:113` restores the original viewport regardless.
 *
 * ## What is left, and what this script varies
 *
 * Exactly two things differ between the harnesses, and this script isolates the first:
 *
 *   - **Tag set.** phase-6 passes `wcag2a, wcag2aa, wcag21a, wcag21aa`. a11y-scout at AA adds
 *     `wcag22a, wcag22aa, best-practice`. Both variants run here, back to back **in the same page
 *     visit**, so page state is identical and the tag list is the only variable.
 *   - **When each was measured.** phase-6's zero is dated 2026-08-24; the a11y-scout baseline is
 *     from 2026-09-11 against a tree with substantial uncommitted change. A rule that reproduces
 *     here under phase-6's own tags means phase-6's claim has gone stale, not that it was wrong.
 *
 * This is a **diagnostic, not a gate**. It exits 0 when it measured every requested surface,
 * including when it finds violations — the whole point is to report a number, and a diagnostic
 * that fails the build is one people stop running.
 *
 * It exits 2 when **any** requested surface could not be measured, not only when all of them
 * failed. A comparison drawn from a partial population is not a smaller result, it is a
 * misleading one: the phase-6 verdicts printed at the end would be computed over whichever
 * surfaces happened to render. A scan that silently did not happen must never read as clean.
 *
 * Prerequisites (versions kept in sync with a11y/versions.mjs):
 *   npm install --no-save @playwright/test@1.63.0 @axe-core/playwright@4.13.0
 *     ^ both in ONE command. `npm install --no-save X` prunes previously --no-save'd packages.
 *   npm run beta:backend && npx nx serve nuxeo-ui
 *
 * Usage:
 *   node a11y/diagnostics/axe-differential.mjs
 *   node a11y/diagnostics/axe-differential.mjs --surface browse --surface tasks
 *   node a11y/diagnostics/axe-differential.mjs --json out.json
 *
 * Exit codes: 0 measured, 2 could not measure.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseCliOrExit } from '../cli.mjs';
import { resolveBaseUrl } from '../env.mjs';
import { injectedSession, SESSION_KEY, SIGNED_OUT_KEY } from '../session.mjs';
import { screenUnsettledReason, surfaceUnusableReason } from '../surface.mjs';
import { PINNED_INSTALL_ARGS } from '../versions.mjs';
import {
  credentialsOrExit,
  gotoOrExit,
  launchChromium,
  requireAdministrationAccess,
  requireBackend,
  requireSessionAdopted,
  watchNuxeoApiOrigins,
} from './preconditions.mjs';

/**
 * This file lives at `a11y/diagnostics/`, so the repository root is two levels up.
 *
 * It was one level when this script sat in `scripts/`, and the move did not update it. The
 * result was silent rather than loud: `resolveScoutReport()` looked under `a11y/a11y-reports`,
 * `existsSync` said no, and the differential compared against an empty baseline while still
 * printing a clean verdict — the exact vacuous pass this diagnostic exists to catch. Caught in
 * review on PR #225.
 */
const repoRoot = resolve(import.meta.dirname, '..', '..');

/** Where the suites write their consolidated reports. Mirrors `REPORT_DIR` in `../fixtures.ts`. */
const REPORTS_DIR = resolve(repoRoot, 'a11y', 'reports');
const cli = parseCliOrExit('axe-differential', {
  json: { type: 'string' },
  surface: { type: 'string', multiple: true },
});
if (cli.json !== undefined && cli.json.trim() === '') {
  console.error('axe-differential: --json needs a file path; an empty one would write nothing. Nothing was run.');
  process.exit(2);
}
const jsonAt = cli.json ?? null;
/** @type {string[]} */
const only = cli.surface ?? [];

const baseUrl = resolveBaseUrl();
// Required, never defaulted - see ../env.mjs for why a default is worse than an error here.
const { username: user, password: pass } = credentialsOrExit('axe-differential');

/** The surfaces a11y-scout scanned, with the host each one must render before it is scanned. */
const ALL_SURFACES = [
  ['browse', '/#/browse', 'lib-browse'],
  ['search', '/#/search', 'lib-search'],
  ['trash', '/#/trash', 'lib-trash'],
  ['tasks', '/#/tasks', 'lib-tasks-page'],
  ['administration', '/#/administration', 'lib-administration-shell'],
  ['knowledge-discovery', '/#/knowledge-discovery', 'lib-knowledge-discovery'],
];

/** Narrowed by `--surface`. Its length is the requested count the exit code is checked against. */
const SURFACES = ALL_SURFACES.filter(([label]) => only.length === 0 || only.includes(label));

// Fail before launching anything if ANY `--surface` value is unknown, not only when all are.
//
// Checking just `SURFACES.length === 0` caught `--surface typo` but not
// `--surface browse --surface typo`: the typo was dropped, `SURFACES` held one entry, and the
// completeness check compared against that one — so a request for two surfaces measured one
// and exited 0 as complete. The requested population is what the caller typed, not what
// happened to match. Flagged in review on PR #225.
const known = new Set(ALL_SURFACES.map(([label]) => label));
const unknown = only.filter((label) => !known.has(label));
if (unknown.length > 0 || (only.length > 0 && SURFACES.length === 0)) {
  console.error(
    `\naxe-differential: --surface ${unknown.map((u) => `"${u}"`).join(', ') || '(empty)'} ` +
      'is not a known surface, so the requested comparison cannot be complete.\n' +
      `  Known surfaces: ${[...known].join(', ')}\n`,
  );
  process.exit(2);
}

/** The two tag sets, verbatim from each harness. */
const VARIANTS = {
  'phase-6': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  'a11y-scout': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'],
};

/** phase-6 fails only on these impacts; lower ones are recorded but do not block. */
const BLOCKING_IMPACTS = ['serious', 'critical'];

let chromium, AxeBuilder;
try {
  ({ chromium } = await import('@playwright/test'));
  ({ default: AxeBuilder } = await import('@axe-core/playwright'));
} catch (err) {
  console.error(
    `axe-differential: cannot measure — ${err instanceof Error ? err.message : err}\n` +
      `  npm install --no-save ${PINNED_INSTALL_ARGS}`,
  );
  process.exit(2);
}

/**
 * Resolve the a11y-scout report to compare against.
 *
 * Deliberately NOT `a11y-reports/latest/`. That directory is a rolling pointer that every
 * a11y-scout run overwrites, including `a11y:scan -- states`, whose findings come from dialogs and
 * overlays on a single route. Comparing this script's per-route axe pass against those would
 * report every interaction-state finding as "did not reproduce" and every route finding as
 * missing — a diff that looks alarming and means nothing. Pinning to the newest *surfaces*
 * report keeps both sides of the comparison the same population.
 */
function resolveScoutReport() {
  const override = process.env['A11Y_SCOUT_REPORT'];
  if (override) return resolve(repoRoot, override);

  if (!existsSync(REPORTS_DIR)) return null;
  const surfaceRuns = readdirSync(REPORTS_DIR)
    .filter((d) => d.startsWith('nuxeo-satori-surfaces-'))
    .sort();
  const newest = surfaceRuns.at(-1);
  return newest ? resolve(REPORTS_DIR, newest, 'report.json') : null;
}

/**
 * Whether a URL a11y-scout recorded is the page reached from `route`.
 *
 * a11y-scout records the URL after any redirect, and `/#/administration` lands on
 * `/#/administration/analytics`, so `endsWith(route)` never matched it and a complete baseline
 * still exited 2 naming administration as unscanned. A child path or a query string counts; a
 * sibling that merely shares the prefix, as the retired `/#/browse-adf-hx` did `/#/browse`,
 * does not.
 *
 * @param {unknown} url
 * @param {string} route
 */
function reachedFrom(url, route) {
  let hash;
  try {
    hash = new URL(String(url)).hash;
  } catch {
    return false;
  }
  const want = route.slice(route.indexOf('#'));
  return hash === want || hash.startsWith(`${want}/`) || hash.startsWith(`${want}?`);
}

// What a11y-scout claimed, so the reproduction can be judged against it rather than against memory.
/** @type {Map<string, number>} `${surface}::${ruleId}` -> node count */
const claimed = new Map();
const reportPath = resolveScoutReport();
if (reportPath && existsSync(reportPath)) {
  console.log(`axe-differential: comparing against ${relative(repoRoot, reportPath)}\n`);
  // Only the fields read below, each `unknown` and narrowed where it is used: this is a file
  // on disk from an earlier run, not a shape anything guarantees.
  /** @type {{ meta?: { pagesScanned?: unknown } | null, findings?: unknown } | null} */
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    console.error(`axe-differential: ${reportPath} unreadable, so there is nothing to compare.`);
    process.exit(2);
  }

  // The baseline must have scanned every surface being compared, or its silence about a
  // surface is absence, not a claim of zero.
  //
  // A surfaces run that fails or times out still writes this report, and a timeout restarts
  // the worker and discards everything it had accumulated — the run that hit the old 600s
  // limit wrote a "surfaces" report covering ONE of seven routes. Accepted as-is, every
  // missing surface read as "a11y-scout claimed 0", and a comparison against nothing exited 0.
  // That happened here: the only baseline on disk covered /#/browse-adf-hx alone, and a
  // `--surface browse` run reported a clean comparison. Flagged in review on PR #225.
  const scanned = Array.isArray(report?.meta?.pagesScanned) ? report.meta.pagesScanned : [];
  const uncovered = SURFACES.filter(([, route]) => !scanned.some((u) => reachedFrom(u, route)));
  if (uncovered.length > 0) {
    console.error(
      `axe-differential: the baseline did not scan ${uncovered.length} of the ${SURFACES.length} ` +
        `requested surface(s): ${uncovered.map(([label]) => label).join(', ')}.\n` +
        '  Its silence about those is absence, not a claim of zero, so there is nothing to\n' +
        `  compare them against. It scanned ${scanned.length} page(s).\n\n` +
        '    npm run a11y:scan -- surfaces      # a complete baseline\n' +
        '    --surface <label>                  # or compare only what it covers\n',
    );
    process.exit(2);
  }

  // A missing or non-array `findings` is a malformed report, not a claim of zero findings — the
  // same absence-read-as-zero as the coverage check above. Read as `[]`, every axe finding
  // measured below would report as "not claimed by a11y-scout" and the run could exit 0.
  // Flagged in review on PR #225. An axe entry without a string `pageUrl` and `ruleId` is
  // refused for the same reason: it would be dropped or counted under no rule.
  if (!Array.isArray(report?.findings)) {
    console.error(
      `axe-differential: ${reportPath} has no \`findings\` array, so it is not a baseline — ` +
        'a report that lists no findings still carries an empty one. Re-run the surfaces suite.',
    );
    process.exit(2);
  }
  /** @type {unknown[]} */
  const findings = report.findings;
  for (const [i, entry] of findings.entries()) {
    const f =
      entry !== null && typeof entry === 'object'
        ? /** @type {{ source?: unknown, pageUrl?: unknown, ruleId?: unknown }} */ (entry)
        : null;
    if (f === null || (f.source === 'axe' && (typeof f.pageUrl !== 'string' || typeof f.ruleId !== 'string'))) {
      console.error(
        `axe-differential: finding ${i} in ${reportPath} is malformed (${JSON.stringify(entry)?.slice(0, 200)}), ` +
          'so the baseline cannot be trusted to say what a11y-scout claimed. Re-run the surfaces suite.',
      );
      process.exit(2);
    }
    if (f.source !== 'axe') continue;
    const surface = SURFACES.find(([, route]) => reachedFrom(f.pageUrl, route))?.[0];
    if (!surface) continue;
    const key = `${surface}::${f.ruleId}`;
    claimed.set(key, (claimed.get(key) ?? 0) + 1);
  }
} else {
  // Exit 2 — "precondition not met" — rather than warning and continuing. The whole output of
  // this script is a comparison, and with an empty baseline every measured finding reports as
  // "not claimed by a11y-scout" while the run still looks successful. That is how a broken
  // path went unnoticed through a directory move; the check now cannot pass without a subject.
  console.error(
    'axe-differential: no nuxeo-satori-surfaces-* report under a11y/reports, so there is\n' +
      '  nothing to compare against. A differential with an empty baseline is not a clean\n' +
      '  result, it is an unmeasured one.\n\n' +
      '    npm run a11y:scan -- surfaces\n\n' +
      '  or point A11Y_SCOUT_REPORT at a report.json.\n',
  );
  process.exit(2);
}

const browser = await launchChromium(chromium, 'axe-differential');
// Mirrors `scripts/beta-harness/phase-runner.mjs` exactly: same viewport, and Basic auth on the
// app origin. Both auth mechanisms are required — httpCredentials for XHRs, the sessionStorage
// session for the route guard — and `a11y/playwright.config.ts` documents what breaks when only
// one is present.
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // `send: 'always'`: a guest-enabled Nuxeo never challenges, so without it
  // `page.request` ran as Anonymous (NXSAT-643).
  httpCredentials: { username: user, password: pass, origin: baseUrl, send: 'always' },
});
const page = await context.newPage();

/** @type {{surface:string, rule:string, impact:string, variant:string, nodes:number, targets:string[]}[]} */
const rows = [];
let measured = 0;

try {
  const me = await requireBackend(page, baseUrl, 'axe-differential');
  // Only when administration is among the requested surfaces: `--surface browse` must not be
  // refused for an identity that can measure browse perfectly well.
  if (SURFACES.some(([label]) => label === 'administration')) {
    requireAdministrationAccess(me, user, 'axe-differential');
  }
  // `networkidle` rather than a fixed pause, so the app's own session hydration has very
  // likely finished before the session below is written. The reload after it is what makes
  // the written session the one the app starts from.
  const foreignApiOrigins = watchNuxeoApiOrigins(page, baseUrl);
  await gotoOrExit(page, baseUrl, 'axe-differential', { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ key, value, signedOutKey }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(signedOutKey);
    },
    {
      key: SESSION_KEY,
      signedOutKey: SIGNED_OUT_KEY,
      value: injectedSession(user, pass),
    },
  );
  // The first navigation booted the app with no session, which on a guest-enabled Nuxeo adopts
  // `Anonymous` and can leave a guest cookie that outranks the Basic header (NXSAT-643).
  await context.clearCookies();
  // The boot above ran signed out; the session's requests start at this reload.
  foreignApiOrigins.restartAtNextLoad();
  await page.reload({ waitUntil: 'networkidle' });
  await requireSessionAdopted(page, user, 'axe-differential', { baseUrl, foreignApiOrigins });

  for (const [surface, route, host] of SURFACES) {
    process.stdout.write(`scanning ${surface} `);
    // A navigation failure here is one unmeasured surface, not a crash. Uncaught, it escaped
    // the loop and exited 1 — reporting "the comparison failed" for a surface nothing measured,
    // and discarding every surface already compared. Recorded as a skip instead, so the
    // completeness check below returns 2. Flagged in review on PR #225.
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    } catch (err) {
      const why = `navigation failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`;
      console.log(`- SKIPPED, ${why} (nothing to compare, NOT a pass)`);
      rows.push({ surface, rule: '(not measurable)', impact: '-', variant: '-', nodes: 0, targets: [why] });
      continue;
    }

    // Settled before anything is read, and by the same definition the specs use. This was a
    // fixed 1.2s pause, and the hash routes make it worse than it looks: `goto` to another
    // `/#/…` is a same-document navigation, so `networkidle` resolves at once and the pause
    // was the only wait there was. A drawer tree still loading lends its toggles accessible
    // names they do not have, so a differential taken mid-load compares two snapshots of a
    // page that never existed in either. Flagged in review on PR #225.
    const unsettled = await screenUnsettledReason(page, { host, treeRequired: route === '/#/browse' });
    if (unsettled) {
      console.log(`- SKIPPED, ${unsettled} (nothing to compare, NOT a pass)`);
      rows.push({ surface, rule: '(not measurable)', impact: '-', variant: '-', nodes: 0, targets: [unsettled] });
      continue;
    }

    // The surface assertion is the difference between a scan and a clean-looking blank. phase-6
    // omits it on five of its routes, which is how it has been scanning `/#/collections` — a path
    // with no matching route — and counting the empty result as a pass.
    //
    // Host visibility alone is not the assertion, and the `/me` preflight does not cover the gap
    // either: it proves the backend answers, not that THIS route's data request did. A route whose
    // data failed renders the same host with an error panel inside it, and both tag sets would then
    // be compared against that error DOM while the route is recorded as measured — so any rule that
    // only fires on real content reads as "did not reproduce". Flagged in review on PR #225.
    const unusable = await surfaceUnusableReason(page, host, surface);
    if (unusable) {
      console.log(`- SKIPPED, ${unusable} (nothing to compare, NOT a pass)`);
      rows.push({ surface, rule: '(not measurable)', impact: '-', variant: '-', nodes: 0, targets: [unusable] });
      continue;
    }

    // Both variants go into a buffer and are committed together. An `analyze()` rejection used
    // to escape the loop and exit 1 — "the comparison failed" for a surface nothing had
    // measured — and had it been caught per variant instead, the rows from the variant that
    // did finish would have been kept, leaving a one-sided surface that reads as "only one tag
    // set sees this". A surface is compared under both tag sets or not at all. Flagged in
    // review on PR #225.
    /** @type {typeof rows} */
    const surfaceRows = [];
    try {
      for (const [variant, tags] of Object.entries(VARIANTS)) {
        const results = await new AxeBuilder({ page }).withTags(tags).analyze();
        for (const v of results.violations) {
          surfaceRows.push({
            surface,
            rule: v.id,
            // axe types `impact` as nullable. The printing paths below happen to survive a
            // null today (`?? '?'` in the table; the blocking list only ever holds
            // serious/critical), but the row type says `string` and the next reader will
            // trust it. Normalised here, once, rather than guarded wherever it is read.
            impact: v.impact ?? 'unknown',
            variant,
            nodes: v.nodes.length,
            targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
          });
        }
        process.stdout.write(`[${variant}: ${results.violations.length}] `);
      }
    } catch (err) {
      const why = `axe analysis failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`;
      console.log(`- SKIPPED, ${why} (partial results discarded, NOT a pass)`);
      rows.push({ surface, rule: '(not measurable)', impact: '-', variant: '-', nodes: 0, targets: [why] });
      continue;
    }
    rows.push(...surfaceRows);
    measured += 1;
    console.log('');
  }
} finally {
  await context.close();
  await browser.close();
}

// ---------------------------------------------------------------------------------------------

const at = (surface, rule, variant) =>
  rows.find((r) => r.surface === surface && r.rule === rule && r.variant === variant)?.nodes ?? 0;

console.log(`\nSurfaces measured : ${measured} of ${SURFACES.length}`);
console.log(`App               : ${baseUrl}`);
console.log(`axe tag sets      : phase-6 ${VARIANTS['phase-6'].length} tags, a11y-scout ${VARIANTS['a11y-scout'].length} tags\n`);

const ruleKeys = [...new Set(rows.filter((r) => r.variant !== '-').map((r) => `${r.surface}::${r.rule}`))].sort();

console.log('--- every violation, by surface and rule ---');
console.log(`${'surface'.padEnd(21)}${'rule'.padEnd(32)}${'impact'.padEnd(10)}${'ph-6'.padStart(5)}${'scout'.padStart(7)}${'claimed'.padStart(9)}`);
for (const key of ruleKeys) {
  const [surface, rule] = key.split('::');
  const impact = rows.find((r) => r.surface === surface && r.rule === rule)?.impact ?? '?';
  const p6 = at(surface, rule, 'phase-6');
  const sc = at(surface, rule, 'a11y-scout');
  const cl = claimed.get(key) ?? 0;
  const flag = p6 === 0 && sc > 0 ? '  <- tag-set only' : cl > 0 && p6 > 0 ? '  <- reproduces under phase-6 tags' : '';
  console.log(
    `${surface.padEnd(21)}${rule.padEnd(32)}${impact.padEnd(10)}${String(p6).padStart(5)}${String(sc).padStart(7)}${String(cl).padStart(9)}${flag}`,
  );
}

// The verdict phase-6 itself would reach today: serious/critical only, under its own tag set.
const p6Blocking = rows.filter((r) => r.variant === 'phase-6' && BLOCKING_IMPACTS.includes(r.impact));
console.log(`\n--- what phase-6's own verdict would be against the app right now ---`);
if (p6Blocking.length === 0) {
  console.log("  0 serious/critical violations under phase-6's tags — its recorded zero still holds.");
} else {
  console.log(`  ${p6Blocking.length} serious/critical violation(s) under phase-6's OWN tag set:`);
  for (const r of p6Blocking) {
    console.log(`    ${r.surface.padEnd(21)}${r.rule.padEnd(30)}${r.impact.padEnd(10)}${r.nodes} node(s)`);
    for (const t of r.targets) console.log(`        ${t}`);
  }
  console.log(
    '\n  phase-6 records KNOWN_VIOLATIONS as empty and its verdict as unconditional. If this list is\n' +
      '  non-empty, that claim is stale and docs/accessibility.md gap 1 resolves against phase-6.',
  );
}

const disputed = ['color-contrast', 'button-name'];
console.log('\n--- the two disputed rules ---');
for (const rule of disputed) {
  const p6 = rows.filter((r) => r.variant === 'phase-6' && r.rule === rule).reduce((a, r) => a + r.nodes, 0);
  const sc = rows.filter((r) => r.variant === 'a11y-scout' && r.rule === rule).reduce((a, r) => a + r.nodes, 0);
  const cl = [...claimed].filter(([k]) => k.endsWith(`::${rule}`)).reduce((a, [, n]) => a + n, 0);
  console.log(`  ${rule.padEnd(18)} phase-6 tags: ${String(p6).padStart(3)}   scout tags: ${String(sc).padStart(3)}   scout claimed: ${String(cl).padStart(3)}`);
}

if (jsonAt) {
  writeFileSync(resolve(repoRoot, jsonAt), `${JSON.stringify({ baseUrl, measured, rows, claimed: Object.fromEntries(claimed) }, null, 2)}\n`);
  console.log(`\nWrote ${jsonAt}`);
}

// Every requested surface must have been measured, not merely one of them.
//
// This used to be `measured === 0`, so a run where six of seven surfaces were skipped still
// exited 0 and then printed phase-6 verdicts drawn from that one surface — a comparison
// presented as complete while most of its population was missing. The skipped surfaces are
// recorded as "NOT a pass" three lines away, which made the exit code the only part of the
// output disagreeing with the rest of it. Flagged in review on PR #225; the surface checks
// added in 4c288808d made partial runs more likely, which is how it surfaced.
//
// `SURFACES` is already narrowed by `--surface` where it is declared, so its length is the
// requested count. The case it cannot catch — a filter that matched nothing, where this reads
// as `0 < 0` — is guarded at the point of declaration instead, before a browser is launched.
if (measured < SURFACES.length) {
  console.error(
    `\naxe-differential: measured ${measured} of ${SURFACES.length} requested surface(s), so the\n` +
      '  comparison above is drawn from an incomplete population and the phase-6 verdicts in it\n' +
      '  cannot be trusted. See the SKIPPED lines for why each one was not measurable.\n',
  );
  process.exit(2);
}
