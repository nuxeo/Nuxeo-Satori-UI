/**
 * Evidence steps for NXSAT-183
 * "Clipboard: Copy and Move options not available"
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-183 scripts/collect-evidence/NXSAT-183.mjs
 *
 * Optional env:
 *   NUXEO_DOC_UID — document UID for doc-detail "Add to Clipboard" flow
 */

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  await helpers.login();

  const openClipboardDrawer = async () => {
    const clipboardNav = page
      .locator('a[sat-platform-nav-menu-item]')
      .filter({ hasText: 'Clipboard' })
      .first();
    await clipboardNav.click();
    await page.waitForTimeout(1200);
  };

  // ── Empty clipboard state ─────────────────────────────────────────────────
  helpers.step('Open Clipboard drawer — empty state');
  await openClipboardDrawer();
  await helpers.screenshot('01-clipboard-empty');

  // ── Browse into a folderish container (not virtual Root) ────────────────
  helpers.step('Navigate to Browse and open a folder container');
  await page.goto(`${helpers.baseUrl}/#/browse`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const browsePaths = [
    '/#/browse/default-domain/workspaces',
    '/#/browse/default-domain/UserWorkspaces',
    '/#/browse/default-domain',
  ];

  let rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
  let insideFolder = false;

  for (const browsePath of browsePaths) {
    helpers.step(`Try folder path ${browsePath}`);
    await page.goto(`${helpers.baseUrl}${browsePath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const breadcrumb = await page.locator('sat-breadcrumbs').innerText().catch(() => '');
    insideFolder = breadcrumb.length > 0 && !/^Root\s*$/i.test(breadcrumb.trim());
    rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
    if (insideFolder && (await rowCheckboxes.count()) >= 1) break;
  }

  if (!insideFolder || (await rowCheckboxes.count()) < 1) {
    const folderRows = page.locator('.browse-table tbody tr.browse-row--folder');
    const folderCount = await folderRows.count();
    for (let depth = 0; depth < 3 && ((await rowCheckboxes.count()) < 1 || !insideFolder); depth++) {
      if (folderCount === 0) break;
      helpers.step(`Drill into folder at depth ${depth + 1}`);
      await folderRows.first().click();
      await page.waitForTimeout(2500);
      insideFolder = true;
      rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
    }
  }

  const fileRows = page.locator('.browse-table tbody tr:not(.browse-row--folder) .cell-checkbox mat-checkbox');
  const selectable = (await fileRows.count()) > 0 ? fileRows : rowCheckboxes;

  if ((await selectable.count()) < 1) {
    console.warn('\n⚠️  No browse rows found — open a folder with files and re-run.\n');
    await helpers.screenshot('02-insufficient-browse-rows');
    return;
  }

  await helpers.screenshot('02-browse-target-folder');

  helpers.step('Select file(s) and add to clipboard via selection topbar');
  await selectable.nth(0).click();
  await page.waitForTimeout(600);
  if ((await selectable.count()) >= 2) {
    await selectable.nth(1).click();
    await page.waitForTimeout(600);
  }

  const addClipboardBtn = page.locator('button[aria-label="Add to Clipboard"]').first();
  if (await addClipboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await addClipboardBtn.click();
    await page.waitForTimeout(800);
  } else {
    console.warn('\n⚠️  Add to Clipboard button not found in selection topbar.\n');
  }

  await helpers.screenshot('02-files-added-to-clipboard');

  // ── Clipboard drawer with items + Copy/Move footer ────────────────────────
  helpers.step('Open Clipboard drawer — items list and Copy/Move actions');
  await openClipboardDrawer();
  await page.waitForTimeout(1500);

  const clipboardPanel = page.locator('.clipboard-panel').first();
  const clipboardFooter = page.locator('.clipboard-footer').first();
  if (await clipboardFooter.isVisible({ timeout: 5000 }).catch(() => false)) {
    await helpers.screenshot('03-clipboard-copy-move-footer', clipboardFooter);
  } else {
    await helpers.screenshot('03-clipboard-copy-move-footer', clipboardPanel);
  }

  const copyBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Copy' }).first();
  const moveBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Move' }).first();
  const copyEnabled = await copyBtn.isEnabled().catch(() => false);
  const moveEnabled = await moveBtn.isEnabled().catch(() => false);
  helpers.step(
    `Copy/Move buttons state on folder browse target — Copy: ${copyEnabled ? 'enabled' : 'disabled'}, Move: ${moveEnabled ? 'enabled' : 'disabled'}`,
  );

  if (copyEnabled) {
    helpers.step('Click Copy — paste clipboard items into current folder');
    await copyBtn.click();
    await page.waitForTimeout(3000);
    await helpers.screenshot('04-after-copy-clipboard-cleared');

    const emptyState = page.locator('.clipboard-panel').filter({ hasText: 'Clipboard is empty' });
    if (await emptyState.isVisible({ timeout: 5000 }).catch(() => false)) {
      helpers.step('Clipboard cleared after successful copy');
      await helpers.screenshot('05-clipboard-empty-after-copy');
    }
  } else {
    helpers.step('Copy disabled — capture full clipboard panel for review');
    await helpers.screenshot('04-copy-move-disabled-on-target');
  }

  // ── Optional: document detail Add to Clipboard (parity with Web UI menu) ──
  const docUid = process.env['NUXEO_DOC_UID'];
  if (docUid) {
    helpers.step(`Document detail — Add to Clipboard via More menu (${docUid})`);
    await helpers.goToDoc(docUid);

    const moreBtn = page.locator('button[aria-label="More actions"]').first();
    if (await moreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await moreBtn.click();
      await page.waitForTimeout(600);
      const addMenuItem = page.locator('button, [role="menuitem"]').filter({ hasText: 'Add to Clipboard' }).first();
      if (await addMenuItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addMenuItem.click();
        await page.waitForTimeout(800);
      }
      await helpers.screenshot('06-doc-detail-add-to-clipboard');
      await page.keyboard.press('Escape');
    }

    helpers.step('Clipboard drawer from doc detail — Copy/Move should be disabled');
    await openClipboardDrawer();
    await helpers.screenshot('07-clipboard-from-doc-detail-no-paste-target');
  }

  helpers.step('Final: full clipboard panel overview');
  await helpers.screenshot('08-final-clipboard-panel', clipboardPanel);
}
