#!/usr/bin/env node
/**
 * The pseudo-locale audit, extended to surfaces a page load never reaches.
 *
 * `pseudo-locale-audit.mjs` visits nine routes and reads what is on screen. That misses every
 * dialog, menu, tooltip and empty state — which is where a large share of an application's
 * text lives, and where a missed string is least likely to be noticed by hand. This opens them.
 *
 * Each interaction is best-effort: a control that is absent on this instance is skipped rather
 * than failed, because the seeded repository decides which ones exist. The count is therefore
 * a floor, not a total, and it is reported as such.
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
const OUT = process.env['OUT_DIR'] ?? '/tmp/zz-deep';

/** `[route, [label, selector to click], …]` — each click opens a surface and is then dismissed. */
const SURFACES = [
  [
    '/#/browse',
    [
      ['create-import', 'button:has-text("Çŕëáţë"), button[class*="create"]'],
      [
        'row-menu',
        'button[aria-label*="ɱöŕë"], button[class*="row-menu"], td button[mat-icon-button]',
      ],
      ['column-picker', 'button[class*="column"], button[aria-label*="çöļüɱñ"]'],
    ],
  ],
  [
    '/#/search',
    [
      ['saved-search-menu', 'button[class*="saved"]'],
      ['view-toggle', 'button[class*="view-toggle"]'],
    ],
  ],
  ['/#/collections', [['create', 'button[class*="create"], button:has-text("Ñëŵ")']]],
  [
    '/#/administration/users-groups',
    [['create-user', 'button[class*="create"], button[class*="add"]']],
  ],
  ['/#/settings/profile', []],
  ['/#/settings/nuxeo-drive', []],
  ['/#/settings/authorized-applications', []],
  ['/#/settings/cloud-services', []],
  ['/#/administration/vocabularies', []],
  ['/#/administration/audit', []],
  ['/#/administration/nxql-search', []],
  ['/#/administration/analytics', []],
  ['/#/tasks', []],
];

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
  '.hxp-breadcrumb',
  '.ai-insight-body',
  '.insight-text',
  '.ai-kpi-card',
];
const INSTANCE_DATA = new Set([
  'Anonymous',
  'Anonymous User',
  'Narasimha',
  'Workspace',
  'My Favorites',
  'test 01',
  'default-domain',
  'UserWorkspaces',
  'Administrator',
  'File',
  'Folder',
]);
const FORMATTED_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

function collect(dataContainers) {
  const isData = (el) => dataContainers.some((s) => el.closest(s));
  const isIcon = (el) => el.closest('mat-icon, .material-icons, .mat-icon');
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim();
    if (!text || text.includes('\u27e6')) continue;
    const el = n.parentElement;
    if (!el || isData(el) || isIcon(el)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (!el.getClientRects().length) continue;
    out.push({ text, tag: el.tagName.toLowerCase() });
  }
  for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v && !v.includes('\u27e6') && !isData(el)) {
        out.push({ text: v, tag: `${el.tagName.toLowerCase()}[${attr}]` });
      }
    }
  }
  return out;
}

// Before anything is written or launched: the walk signs in, and NUXEO_USER / NUXEO_PASS have no
// default (NXSAT-649). Exits 2 — the environment, not the audit — when either is unset.
nuxeoCredentialsOrExit('run the pseudo-locale audit');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
// Without this the deep pass reads an ENGLISH application and every string looks untranslated.
await servePseudoLocale(page);
// Sign in BEFORE the walk, or `adminGuard` silently redirects the administration routes.
const auditUser = await signIn(page, BASE);
console.log(`signed in as ${auditUser}`);
let sentinelSeen = false;

const findings = new Map();
const record = (where, items) => {
  for (const item of items) {
    if (!looksLikeUiText(item.text)) continue;
    if (INSTANCE_DATA.has(item.text) || FORMATTED_DATE.test(item.text)) continue;
    const id = `${item.tag}\u0000${item.text}`;
    if (!findings.has(id)) findings.set(id, { ...item, where: [] });
    const entry = findings.get(id);
    if (!entry.where.includes(where)) entry.where.push(where);
  }
};

let opened = 0;
let skipped = 0;
let clickFailures = 0;
const redirected = [];

/**
 * Visible overlay panes, which is what "an overlay opened" actually means.
 *
 * The previous version counted `.cdk-overlay-container`. CDK creates that container once and leaves
 * it in the DOM after the first overlay closes, so from the second interaction onwards it was
 * always present — every failed click still incremented `opened` and was reported as covered. The
 * count could not go down and therefore could not fail.
 */
const visiblePanes = () => page.locator('.cdk-overlay-pane:visible').count();
for (const [route, interactions] of SURFACES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const name = route.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'root';

  // Same guard problem as the shallow pass, and worse here: most of these surfaces are behind a
  // guard, so a redirect means this pass repeatedly opens overlays on the page it was sent to while
  // reporting them against the route it asked for.
  const reached = routeReached(page, route);
  if (!reached.ok) {
    redirected.push({ route, landed: reached.landed });
    continue;
  }

  await page.screenshot({ path: join(OUT, `${name}.png`) });
  record(route, await page.evaluate(collect, DATA_CONTAINERS));
  if (!sentinelSeen) sentinelSeen = await sentinelPresent(page);

  for (const [label, selector] of interactions) {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0 || !(await target.isVisible().catch(() => false))) {
      skipped += 1;
      continue;
    }
    const before = await visiblePanes();
    // A swallowed click is a surface this audit did not read, so it is counted rather than hidden.
    const clicked = await target
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) clickFailures += 1;
    await page.waitForTimeout(1800);
    const after = await visiblePanes();
    if (clicked && after > before) {
      opened += 1;
      await page.screenshot({ path: join(OUT, `${name}--${label}.png`) });
      record(`${route} → ${label}`, await page.evaluate(collect, DATA_CONTAINERS));
      if (!sentinelSeen) sentinelSeen = await sentinelPresent(page);
    } else {
      skipped += 1;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
}

const rows = [...findings.values()].sort((a, b) => b.where.length - a.where.length);
writeFileSync(join(OUT, 'findings.json'), `${JSON.stringify(rows, null, 2)}\n`);
await browser.close();

requireSentinel(sentinelSeen, 'pseudo-locale-deep');

if (redirected.length > 0) {
  console.error(
    `${redirected.length} of ${SURFACES.length} route(s) redirected before they could be read, so ` +
      'their surfaces were NOT opened:',
  );
  for (const { route, landed } of redirected) {
    console.error(`  asked ${route}  landed ${landed}`);
  }
  console.error(
    '  Run as a user with access to those routes — `adminGuard` needs an administrator — or drop ' +
      'them from SURFACES and say so.',
  );
  process.exit(1);
}

console.log(
  `${SURFACES.length} routes, ${opened} overlay(s) opened, ${skipped} interaction(s) unavailable` +
    (clickFailures ? `, ${clickFailures} click(s) FAILED` : ''),
);
if (clickFailures) {
  // Not fatal — the seeded repository decides which controls exist — but it must be visible, since
  // a failed click is a surface this audit did not read and previously counted as covered.
  console.log(
    `  ${clickFailures} interaction(s) errored rather than being absent. Those surfaces were not ` +
      'read, so the count below excludes them.',
  );
}
console.log(`${rows.length} distinct untranslated string(s) — a FLOOR, not a total\n`);
for (const r of rows.slice(0, 60)) {
  console.log(
    `  ${String(r.where.length).padStart(2)}x  ${r.tag.padEnd(20)} ${JSON.stringify(r.text.slice(0, 60))}`,
  );
}
console.log(`\nscreenshots in ${OUT}`);
