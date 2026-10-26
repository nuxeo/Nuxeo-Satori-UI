/**
 * Evidence steps for NXSAT-186
 * Browse secondary nav tree sync with main view (Web UI patterns).
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-186 scripts/collect-evidence/NXSAT-186.mjs
 */

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  await helpers.login();

  helpers.step('Open Browse with secondary nav drawer');
  await page.goto(`${helpers.baseUrl}/#/browse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  async function openBrowseDrawer() {
    const browseByIcon = page
      .locator('a[sat-platform-nav-menu-item]')
      .filter({ has: page.locator('mat-icon', { hasText: 'folder' }) })
      .first();
    const browseByIndex = page.locator('sat-platform-nav a[sat-platform-nav-menu-item]').nth(2);
    const browseNav = (await browseByIcon.count()) > 0 ? browseByIcon : browseByIndex;

    await browseNav.click({ timeout: 10000 });
    await page.waitForTimeout(1500);

    const drawer = page.locator('mat-sidenav.nav-drawer-sidenav.mat-drawer-opened');
    if (!(await drawer.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.warn('⚠️  Browse secondary drawer did not open.');
    }
  }

  await openBrowseDrawer();
  await helpers.screenshot('01-browse-root-all-domains');

  const expandedAtRoot = page.locator('.nav-drawer-sidenav .tree-arrow--expanded');
  const expandedCount = await expandedAtRoot.count();
  if (expandedCount > 1) {
    console.warn(`⚠️  Expected only Root expanded at browse root, found ${expandedCount} expanded nodes.`);
  }

  helpers.step('Navigate to domain-5 in main view — scoped tree');
  await page.goto(`${helpers.baseUrl}/#/browse/domain-5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await openBrowseDrawer();
  await helpers.screenshot('02-scoped-domain-only');

  const rootBack = page.locator('.nav-drawer-sidenav .tree-back');
  if (!(await rootBack.isVisible({ timeout: 3000 }).catch(() => false))) {
    console.warn('⚠️  "< Root" back link not visible inside a domain.');
  }

  const domainLabels = page.locator('.nav-drawer-sidenav .tree-label');
  const labelCount = await domainLabels.count();
  if (labelCount > 4) {
    console.warn(`⚠️  Expected scoped tree (few labels), found ${labelCount} tree labels.`);
  }

  helpers.step('Navigate to domain-5/workspaces — tree expands Workspaces');
  await page.goto(`${helpers.baseUrl}/#/browse/domain-5/workspaces`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await openBrowseDrawer();
  await helpers.screenshot('03-workspaces-expanded');

  const workspacesRow = page
    .locator('.nav-drawer-sidenav .tree-node')
    .filter({ has: page.locator('.tree-label', { hasText: /^workspaces$/i }) })
    .first();
  if (await workspacesRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    const chevron = workspacesRow.locator('.tree-arrow');
    if (!(await chevron.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.warn('⚠️  Workspaces row missing chevron.');
    }
    const expanded = workspacesRow.locator('.tree-arrow--expanded');
    if (!(await expanded.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.warn('⚠️  Workspaces not expanded while viewing workspaces folder.');
    }
  }

  helpers.step('Navigate back to domain-5 — nested folders collapse');
  await page.goto(`${helpers.baseUrl}/#/browse/domain-5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await openBrowseDrawer();
  await helpers.screenshot('04-domain-collapsed-children');

  if (await workspacesRow.isVisible({ timeout: 2000 }).catch(() => false)) {
    const expandedAfterBack = workspacesRow.locator('.tree-arrow--expanded');
    if (await expandedAfterBack.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.warn('⚠️  Workspaces still expanded after navigating back to domain.');
    }
    const chevronAfterBack = workspacesRow.locator('.tree-arrow');
    if (!(await chevronAfterBack.isVisible({ timeout: 1000 }).catch(() => false))) {
      console.warn('⚠️  Workspaces chevron missing after collapse.');
    }
  }

  helpers.step('Return to repository root — all domains visible');
  await page.locator('.nav-drawer-sidenav .tree-back').click({ timeout: 5000 }).catch(() => {
    return page.goto(`${helpers.baseUrl}/#/browse`, { waitUntil: 'networkidle' });
  });
  await page.waitForTimeout(2000);
  await openBrowseDrawer();
  await helpers.screenshot('05-back-to-root-all-domains');
}
