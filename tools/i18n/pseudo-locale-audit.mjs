#!/usr/bin/env node
/**
 * Walk the app under the `zz` pseudo-locale and report every visible English string.
 *
 * Under `zz` a catalogue-sourced string renders accented and wrapped in `⟦…⟧`. Text that is
 * still plain ASCII prose therefore came from somewhere a catalogue cannot reach — a hard-coded
 * template literal, a descriptor with no key, or a string built in TypeScript. This is the only
 * check in the set that can see what the extraction MISSED, because everything else inspects
 * strings that were already extracted.
 *
 * Server data is excluded by origin, not by spelling: document titles, usernames and
 * aggregation buckets are legitimately English and must never be translated. They are filtered
 * by the containers they render in rather than by a word list, so a genuine miss cannot hide by
 * resembling one.
 *
 * ## It selects `zz` itself, and proves it
 *
 * The packaged bootstrap ships `defaultLanguage: 'en'` and `zz` is deliberately absent from
 * `availableLanguages`, so nothing here made the running application use it. This audit used to
 * navigate and read — against an ENGLISH app, where every string is plain ASCII prose and so
 * every string looks like a miss. The number it printed could not substantiate anything.
 *
 * It now intercepts the Layer 0 config and serves `defaultLanguage: 'zz'`, then asserts the
 * SENTINEL `⟦` is actually on the page before believing a single finding. Without that assertion
 * a run where the pseudo-locale failed to load is indistinguishable from a run where it worked,
 * and the two produce opposite conclusions from identical output.
 */
import { chromium } from 'playwright';
import {
  looksLikeUiText,
  requireSentinel,
  routeReached,
  signIn,
  sentinelPresent,
  servePseudoLocale,
} from './pseudo-locale-page.mjs';
import { nuxeoCredentialsOrExit } from '../../scripts/beta-harness/nuxeo-credentials.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env['APP_URL'] ?? 'http://localhost:4200';
const OUT = process.env['OUT_DIR'] ?? '/tmp/zz-audit';
const ROUTES = [
  ['dashboard', '/#/dashboard'],
  ['browse', '/#/browse'],
  ['search', '/#/search'],
  ['documents', '/#/documents'],
  ['collections', '/#/collections'],
  ['tasks', '/#/tasks'],
  ['trash', '/#/trash'],
  ['administration', '/#/administration'],
  ['settings-themes', '/#/settings/themes'],
];

// Containers whose text is repository content or a user's own data.
const DATA_CONTAINERS = [
  '.doc-title',
  '.document-title',
  '.result-title',
  '.breadcrumb-doc',
  '.user-name',
  '.filter-count',
  '.agg-label',
  '.saved-search-name',
  'adf-datatable-row',
  '.mat-mdc-chip',
  '.cdk-column-name',
  '.doc-path',
  '.audit-entry',
  'code',
  'pre',
  '.avatar',
  '.user-avatar',
  '.user-menu',
  '.doc-subtitle',
  '.doc-type',
  'nav[aria-label] a',
  '.breadcrumb',
  '.mat-mdc-option',
  '.hxp-breadcrumb',
];

/**
 * Names the logged-in Nuxeo user and the seeded repository content carry on this instance.
 *
 * Listed explicitly rather than inferred, because there is no structural property that
 * separates "a document happens to be called Workspace" from "the word Workspace is hard-coded
 * in a template". Keeping the list short and visible means a genuine miss cannot hide behind it
 * — anything not named here is reported.
 */
const INSTANCE_DATA = new Set([
  'Anonymous',
  'Anonymous User',
  'Narasimha',
  'Workspace',
  'My Favorites',
]);

// Digits are allowed in the BODY. Requiring letters-only hid every string that carries a
// number — `Last 24h (0)`, `Between 1 MB and 10 MB`, `2 result(s)` — which is most of a filter
// panel. The audit reported 36 findings while a screenshot of the same page showed six more it
// had skipped. A leading digit is still rejected, because that is a count rendered from data.
/**
 * A date the Angular `DatePipe` produced, e.g. `Jul 3, 2026`.
 *
 * Angular has no locale data for `zz` and formats it as English, which is right — a synthetic
 * locale has no calendar. The date is not a hard-coded string and there is no key that could
 * translate it; whether dates localise is settled by `registerLocaleData`, which `fr` and `de`
 * already have and a real gate already checks.
 */
const FORMATTED_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;


// Before anything is written or launched: the walk signs in, and NUXEO_USER / NUXEO_PASS have no
// default (NXSAT-649). Exits 2 — the environment, not the audit — when either is unset.
nuxeoCredentialsOrExit('run the pseudo-locale audit');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await servePseudoLocale(page);
// Sign in BEFORE the walk, or `adminGuard` silently redirects the administration routes.
const auditUser = await signIn(page, BASE);
console.log(`signed in as ${auditUser}`);

const findings = [];
const redirected = [];
let sentinelSeen = false;
for (const [name, route] of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // A guard can send us somewhere else without saying so. `adminGuard` redirects a non-admin to
  // `/dashboard`, and this audit runs as whatever user the proxy supplies — measured as `Anonymous`
  // — so `/#/administration` lands on the dashboard and its findings get attributed to the route we
  // asked for rather than the one we read. The sentinel cannot catch it: the page we were sent to
  // renders the pseudo-locale too.
  const reached = routeReached(page, route);
  if (!reached.ok) {
    redirected.push({ route, landed: reached.landed });
    continue;
  }
  // The pseudo-locale is either active or this audit means nothing. `⟦` can only come from
  // `zz.json`, so seeing it once proves the catalogue loaded and the override took effect.
  if (!sentinelSeen) sentinelSeen = await sentinelPresent(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });

  const english = await page.evaluate((selectors) => {
    const isData = (el) => selectors.some((s) => el.closest(s));
    // A `<mat-icon>`'s text is a ligature NAME — `settings` renders as a gear, not as the word.
    // Translating it would replace the icon with a missing glyph. It reads as English prose and
    // is not; without this the audit reported 60-odd phantom misses and buried the real ones.
    const isIconLigature = (el) => el.closest('mat-icon, .material-icons, .mat-icon');
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (!text || text.includes('⟦')) continue;
      const el = n.parentElement;
      if (!el || isData(el) || isIconLigature(el)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (!el.getClientRects().length) continue;
      out.push({ text, tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 60) });
    }
    // aria-labels and titles are invisible to a text walker and are exactly what a screen
    // reader announces, so a missed one is an accessibility defect as well as an i18n one.
    for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(attr);
        if (v && !v.includes('⟦') && !isData(el)) {
          out.push({ text: v, tag: `${el.tagName.toLowerCase()}[${attr}]`, cls: '' });
        }
      }
    }
    return out;
  }, DATA_CONTAINERS);

  const real = english.filter(
    (e) => looksLikeUiText(e.text) && !INSTANCE_DATA.has(e.text) && !FORMATTED_DATE.test(e.text),
  );
  findings.push({ route: name, count: real.length, items: real.slice(0, 40) });
  console.log(`${real.length === 0 ? 'clean' : `${real.length} English`}  ${name}`);
}

writeFileSync(join(OUT, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);
await browser.close();

const total = findings.reduce((n, f) => n + f.count, 0);

requireSentinel(sentinelSeen, 'pseudo-locale-audit');

// A route we never reached is not a route we audited, and counting it as clean is the failure this
// reports rather than hides.
if (redirected.length > 0) {
  console.error(
    `${redirected.length} of ${ROUTES.length} route(s) redirected before they could be read, so ` +
      'they were NOT audited:',
  );
  for (const { route, landed } of redirected) {
    console.error(`  asked ${route}  landed ${landed}`);
  }
  console.error(
    '  A guard sent the browser elsewhere. Run as a user with access to those routes — ' +
      '`adminGuard` needs an administrator — or drop them from ROUTES and say so.',
  );
  process.exit(1);
}

console.log(`\n${total} untranslated visible string(s) across ${ROUTES.length} routes`);
console.log(
  'A FLOOR, not a total: this reads nine routes as they first render. Dialogs, menus, tooltips ' +
    'and empty states are not opened here — `pseudo-locale-deep.mjs` does that, and `i18n:audit` ' +
    'runs it next.',
);
console.log(`screenshots and findings.json in ${OUT}`);
