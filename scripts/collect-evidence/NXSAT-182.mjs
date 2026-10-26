/**
 * Evidence steps for NXSAT-182
 * "Personal Space Page Displays Blank Screen"
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-182 scripts/collect-evidence/NXSAT-182.mjs
 */

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  await helpers.login();

  // ── Personal Space nav + drawer ───────────────────────────────────────────
  helpers.step('Open Personal Space from platform nav');
  const personalSpaceNav = page
    .locator('a[sat-platform-nav-menu-item]')
    .filter({ hasText: 'Personal Space' })
    .first();
  await personalSpaceNav.click();
  await page.waitForTimeout(2500);
  await helpers.screenshot('01-personal-space-drawer');

  // ── Main content: workspace browse view ───────────────────────────────────
  helpers.step('Verify main area shows workspace browse content (not blank)');
  const browseHeader = page.locator('.browse-header, sat-breadcrumbs').first();
  await browseHeader.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await helpers.screenshot('02-personal-space-browse-content');

  // ── Breadcrumb: all ancestors clickable with separators ─────────────────────
  helpers.step('Verify breadcrumb separators and ancestor links');
  const breadcrumbs = page.locator('sat-breadcrumbs').first();
  if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
    await helpers.screenshot('03-breadcrumb-ancestors', breadcrumbs);
  } else {
    await helpers.screenshot('03-breadcrumb-ancestors');
  }

  // ── Drawer folder tree ────────────────────────────────────────────────────
  helpers.step('Verify personal workspace folder tree in drawer');
  const drawerTree = page.locator('.folder-tree, .tree-list').first();
  if (await drawerTree.isVisible({ timeout: 5000 }).catch(() => false)) {
    await helpers.screenshot('04-drawer-workspace-tree', drawerTree);
  } else {
    await helpers.screenshot('04-drawer-workspace-tree');
  }

  helpers.step('Final: full page overview');
  await helpers.screenshot('05-final-personal-space');
}
