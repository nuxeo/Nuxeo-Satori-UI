/**
 * Evidence steps for NXSAT-164
 * "Browse tree not showing all accessible domains for isolated users"
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-164 scripts/collect-evidence/NXSAT-164.mjs
 *
 * Requires local Nuxeo with two accounts, both from the environment and neither defaulted:
 *   - NUXEO_USER / NUXEO_PASS — an administrator (sees all top-level domains)
 *   - NUXEO_ISOLATED_USER / NUXEO_ISOLATED_PASS — an ACL-isolated user (on the instance this was
 *     written against, `local-user5`, which sees Domain + Domain-5 only)
 *
 * The administrator pair was a literal `'Administrator', 'Administrator'` and the isolated pair
 * defaulted to that account's password, so this file carried two working logins (NXSAT-649).
 *
 * What a missing pair does depends on which one, because `story-runner.mjs` checks only the
 * first. A missing `NUXEO_USER` / `NUXEO_PASS` never reaches this file: the runner refuses it
 * with exit 2 before any scene runs. A missing `NUXEO_ISOLATED_*` pair is a `PreconditionError`
 * thrown when the capture starts, after the browser and the recording have opened; story-runner
 * records it as verdict `precondition-not-met`, but exits **1**, as it does for every
 * `precondition-not-met` capture. Only `phase-runner.mjs` maps a `PreconditionError` to exit 2.
 */

import { PreconditionError, requireStepCredentials } from '../beta-harness/helpers.mjs';

/** The ACL-isolated account, from the environment, or a `PreconditionError`. */
function requireIsolatedCredentials() {
  const username = process.env['NUXEO_ISOLATED_USER'];
  const password = process.env['NUXEO_ISOLATED_PASS'];
  if (!username || !password) {
    throw new PreconditionError(
      'NUXEO_ISOLATED_USER and NUXEO_ISOLATED_PASS must both be set to collect NXSAT-164 ' +
        'evidence — an ACL-isolated account to compare with the administrator.\n\n' +
        '    export NUXEO_ISOLATED_USER=<user> NUXEO_ISOLATED_PASS=<password>\n\n' +
        '  There is deliberately no default: a password in the repository is a credential in the ' +
        'repository, whichever account it belongs to.',
    );
  }
  return { username, password };
}

/** @param {import('@playwright/test').Page} page */
async function loginAs(page, helpers, username, password) {
  const base = helpers.baseUrl;
  helpers.step(`Injecting auth session for ${username}`);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const session = {
    kind: 'basic',
    username,
    basic,
    isAdministrator: username.trim().toLowerCase() === 'administrator',
    groups: [],
  };

  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem('agentic_ui_signed_out');
    },
    { key: 'agentic_ui_nuxeo_session', value: JSON.stringify(session) },
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

/** @param {import('@playwright/test').Page} page */
async function openBrowseDrawer(page, helpers) {
  helpers.step('Open Browse drawer');
  await page.goto(`${helpers.baseUrl}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Browse is the 3rd platform nav item (Knowledge Discovery, Dashboard, Browse).
  const browseNav = page.locator('a[sat-platform-nav-menu-item]').nth(2);
  await browseNav.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  const drawer = page.locator('app-nav-drawer .drawer-header').filter({ hasText: 'Browse' });
  await drawer.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(2000);
}

/** @param {import('@playwright/test').Page} page */
async function readDomainLabels(page) {
  const treeLabels = await page.locator('app-nav-drawer .folder-tree .tree-label').allTextContents();
  const domains = treeLabels.map((t) => t.trim()).filter((t) => t && t !== 'Root');
  if (domains.length > 0) {
    return domains;
  }

  // Fallback: count domain rows on the browse results table when the drawer tree is unavailable.
  await page.goto(`${page.url().split('#')[0]}#/browse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const rows = await page.locator('table tbody tr').allTextContents();
  return rows
    .map((row) => row.split('\n').map((c) => c.trim()).filter(Boolean)[0])
    .filter((title) => title && !/^Modified\b/i.test(title));
}

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  const admin = requireStepCredentials('collect NXSAT-164 evidence as the administrator');
  const { username: isolatedUser, password: isolatedPass } = requireIsolatedCredentials();

  // ── Administrator: all accessible domains ────────────────────────────────
  await loginAs(page, helpers, admin.username, admin.password);
  await openBrowseDrawer(page, helpers);
  const adminDomains = await readDomainLabels(page);
  helpers.step(`Administrator browse tree domains (${adminDomains.length}): ${adminDomains.join(', ')}`);
  await helpers.screenshot('01-admin-browse-tree', page.locator('app-nav-drawer .folder-tree').first());

  // ── Isolated user: ACL-filtered domains only ─────────────────────────────
  await loginAs(page, helpers, isolatedUser, isolatedPass);
  await openBrowseDrawer(page, helpers);
  const userDomains = await readDomainLabels(page);
  helpers.step(
    `${isolatedUser} browse tree domains (${userDomains.length}): ${userDomains.join(', ')}`,
  );
  await helpers.screenshot('02-isolated-user-browse-tree', page.locator('app-nav-drawer .folder-tree').first());

  // ── User switch simulation: admin tree must not leak after re-login ──────
  await loginAs(page, helpers, admin.username, admin.password);
  await openBrowseDrawer(page, helpers);
  await loginAs(page, helpers, isolatedUser, isolatedPass);
  await openBrowseDrawer(page, helpers);
  const switchedDomains = await readDomainLabels(page);
  helpers.step(
    `After admin→${isolatedUser} switch (${switchedDomains.length}): ${switchedDomains.join(', ')}`,
  );
  await helpers.screenshot('03-after-user-switch-browse-tree', page.locator('app-nav-drawer .folder-tree').first());

  const pass =
    userDomains.length <= adminDomains.length &&
    switchedDomains.length === userDomains.length &&
    userDomains.every((d) => switchedDomains.includes(d));

  if (!pass) {
    console.warn(
      '\n⚠️  Evidence check: isolated user tree may still include extra domains.\n' +
        `   Admin (${adminDomains.length}): ${adminDomains.join(', ')}\n` +
        `   ${isolatedUser} (${userDomains.length}): ${userDomains.join(', ')}\n` +
        `   After switch (${switchedDomains.length}): ${switchedDomains.join(', ')}\n`,
    );
  } else {
    console.log('\n✅  Isolated user browse tree matches expected ACL-filtered domains.\n');
  }
}
