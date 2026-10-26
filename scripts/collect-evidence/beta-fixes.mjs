/**
 * Combined evidence for fix/beta-fixes:
 *
 * 1. NXSAT-199 — Domain creation at repository root
 * 1b. Picture create — @emptyWithDefault blob create (Picture create failed fix)
 * 2. Clipboard copy/move — browse folder refreshes without page reload
 * 3. NXSAT-151 — Enter on group/member autocomplete selects suggestion (not typed prefix)
 *
 * Local (default):
 *   npm run evidence:collect -- beta-fixes scripts/collect-evidence/beta-fixes.mjs
 *
 * Beta deployed UI + beta APIs:
 *   $env:APP_URL="https://satori-ui.beta.nuxeocloud.com/nuxeo/agentic-ui"
 *   $env:NUXEO_USER="<beta-user>"; $env:NUXEO_PASS="<beta-pass>"
 *   npm run evidence:collect -- beta-fixes-beta scripts/collect-evidence/beta-fixes.mjs
 *
 * Local UI (fix/beta-fixes) + beta Nuxeo APIs:
 *   npx ng serve nuxeo-ui --proxy-config apps/nuxeo-ui/proxy.conf.beta.json
 *   $env:NUXEO_USER="<beta-user>"; $env:NUXEO_PASS="<beta-pass>"
 *   npm run evidence:collect -- beta-fixes-local-beta-api scripts/collect-evidence/beta-fixes.mjs
 */

const BETA_API_HOST = 'satori-ui.beta.nuxeocloud.com';

function resolveEvidenceEnvTag(baseUrl) {
  if (process.env['EVIDENCE_ENV']) {
    return process.env['EVIDENCE_ENV'];
  }
  try {
    return new URL(baseUrl).hostname === BETA_API_HOST ? 'beta-ui' : 'local';
  } catch {
    return 'local';
  }
}

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, outDir) {
  const envTag = resolveEvidenceEnvTag(helpers.baseUrl);

  const apiCalls = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/nuxeo/api/v1/')) return;
    if (
      url.includes('@emptyWithDefault') ||
      url.includes('/upload') ||
      url.includes('/automation/Document.Copy') ||
      url.includes('/automation/Document.Move') ||
      (url.includes('/path/') && response.request().method() === 'POST')
    ) {
      apiCalls.push({
        status: response.status(),
        method: response.request().method(),
        url: url.replace(/.*\/nuxeo/, '/nuxeo').slice(0, 120),
      });
    }
  });

  const snap = (name, locator) => helpers.screenshot(`${envTag}-${name}`, locator);

  await helpers.login();
  helpers.step(`Environment: ${envTag} @ ${helpers.baseUrl}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Fix 1: NXSAT-199 — Domain creation at repository root
  // ═══════════════════════════════════════════════════════════════════════════
  const domainTitle = `Beta Domain ${Date.now()}`;

  helpers.step('Fix 1 (NXSAT-199): Dashboard Create / Import → Domain');
  await page.goto(`${helpers.baseUrl}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await snap('fix1-00-dashboard');

  const createFab = page.getByRole('button', { name: 'Create or import' });
  if (!(await createFab.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.warn('\n⚠️  Fix 1: Dashboard Create or import button not found.\n');
  } else {
    await createFab.click();
    await page.waitForTimeout(1000);
    const dialog = page.locator('lib-create-import-dialog');
    await snap('fix1-01-create-dialog', dialog);

    const locationValue = await dialog.locator('.location-input').inputValue().catch(() => '');
    helpers.step(`Fix 1: location = "${locationValue}"`);

    const domainTypeBtn = dialog.locator('.doctype-tile').filter({ hasText: 'Domain' });
    if (await domainTypeBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await domainTypeBtn.first().click();
      await page.waitForTimeout(1200);
      await snap('fix1-02-domain-form', dialog);

      await dialog.locator('mat-form-field').filter({ hasText: 'Title' }).locator('input').fill(domainTitle);
      await page.waitForTimeout(500);

      const createBtn = dialog.getByRole('button', { name: 'Create' });
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('lib-create-import-dialog button[color="primary"]');
          return btn instanceof HTMLButtonElement && !btn.disabled;
        },
        { timeout: 10000 },
      );
      const apiBefore = apiCalls.length;
      await createBtn.click();
      await page.waitForTimeout(4000);

      const emptyWithDefault = apiCalls
        .slice(apiBefore)
        .some((c) => c.url.includes('@emptyWithDefault'));
      helpers.step(`Fix 1 API: @emptyWithDefault called = ${emptyWithDefault}`);

      const errorBanner = dialog.locator('.error-text');
      if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
        const errorText = (await errorBanner.textContent())?.trim() ?? '';
        console.warn(`\n⚠️  Fix 1 FAILED: ${errorText}\n`);
        await snap('fix1-03-create-error', dialog);
      } else if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
        await snap('fix1-03-dialog-still-open', dialog);
      } else {
        await snap('fix1-03-create-success');
        helpers.step(`Fix 1 OK: domain "${domainTitle}" created`);
      }
    } else {
      console.warn('\n⚠️  Fix 1: Domain type not listed at repository root.\n');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fix 1b: Picture create — blob @emptyWithDefault (Picture create failed)
  // ═══════════════════════════════════════════════════════════════════════════
  helpers.step('Fix 1b (Picture): Create Picture with attachment in workspace folder');

  const picturePaths = [
    '/#/browse/default-domain/workspaces/Sample%20Workspace',
    '/#/browse/default-domain/workspaces/Narasimha',
    '/#/browse/domain-7/workspaces/workspace-7/folder-7',
    '/#/browse/default-domain/workspaces',
  ];

  let pictureDone = false;
  for (const browsePath of picturePaths) {
    await page.goto(`${helpers.baseUrl}${browsePath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const createImport = page.getByRole('button', { name: /Create\s*\/\s*Import/i });
    if (!(await createImport.isVisible({ timeout: 8000 }).catch(() => false))) {
      continue;
    }

    await createImport.click();
    await page.waitForTimeout(2000);
    const dialog = page.locator('lib-create-import-dialog');
    await dialog.getByRole('tab', { name: 'Create' }).click().catch(() => {});
    await page.waitForFunction(
      () => {
        const tiles = document.querySelectorAll('lib-create-import-dialog .doctype-tile');
        const loading = document.querySelector('lib-create-import-dialog .state-row--compact');
        return tiles.length > 0 || !!loading?.textContent?.includes('No document types');
      },
      { timeout: 15000 },
    );
    await snap('fix1b-00-create-dialog', dialog);

    const tileLabels = await dialog.locator('.doctype-label').allTextContents();
    helpers.step(`Fix 1b types: ${tileLabels.map((t) => t.trim()).join(', ') || '(none)'}`);

    const pictureBtn = dialog.locator('.doctype-grid button.doctype-tile').filter({ hasText: 'Picture' });
    const pictureCount = await pictureBtn.count();
    if (pictureCount === 0) {
      await page.keyboard.press('Escape');
      continue;
    }

    await pictureBtn.first().scrollIntoViewIfNeeded();
    await pictureBtn.first().click();
    await page.waitForTimeout(2000);
    await snap('fix1b-01-picture-form', dialog);

    const pictureTitle = `Beta Picture ${Date.now()}`;
    const titleInput = dialog.getByLabel(/^Title$/i);
    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill(pictureTitle);
    }

    const fileInput = dialog.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'beta-evidence.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.waitForTimeout(6000);
    await snap('fix1b-02-file-staged', dialog);

    const apiBefore = apiCalls.length;
    const createBtn = dialog.getByRole('button', { name: /^Create$/i });
    await createBtn.click();
    await page.waitForTimeout(20000);

    const recentApis = apiCalls.slice(apiBefore);
    const usedEmptyWithDefault = recentApis.some((c) => c.url.includes('@emptyWithDefault'));
    const createPost = recentApis.find((c) => c.method === 'POST' && c.url.includes('/path/'));
    helpers.step(
      `Fix 1b API: emptyWithDefault=${usedEmptyWithDefault}, create POST=${createPost?.status ?? 'missing'}`,
    );
    console.log('Fix 1b API tail:', recentApis.slice(-8));

    const errorText = await dialog.locator('.error-text').textContent().catch(() => '');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const fail =
      /not attached|Create failed|Internal Server Error/i.test(errorText ?? '') ||
      /not attached|Create failed|Internal Server Error/i.test(bodyText);

    if (fail) {
      console.warn(`\n⚠️  Fix 1b FAILED: ${(errorText || bodyText).slice(0, 120)}\n`);
      await snap('fix1b-03-create-failed', dialog);
    } else if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
      await snap('fix1b-03-dialog-still-open', dialog);
    } else {
      await snap('fix1b-03-create-success');
      helpers.step(`Fix 1b OK: Picture "${pictureTitle}" created`);
    }

    pictureDone = true;
    break;
  }

  if (!pictureDone) {
    console.warn('\n⚠️  Fix 1b: Could not run Picture create (no folder or Picture type).\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fix 2: Clipboard copy/move — browse listing refreshes in place
  // ═══════════════════════════════════════════════════════════════════════════
  helpers.step('Fix 2 (clipboard): Copy into browse folder without refresh');

  const browsePaths = [
    '/#/browse/default-domain/workspaces/Sample%20Workspace',
    '/#/browse/default-domain/workspaces/Narasimha',
    '/#/browse/domain-7/workspaces/workspace-7/folder-7',
    '/#/browse/default-domain/workspaces',
    '/#/browse/default-domain/UserWorkspaces',
  ];

  let rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
  for (const browsePath of browsePaths) {
    await page.goto(`${helpers.baseUrl}${browsePath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
    if ((await rowCheckboxes.count()) >= 1) break;

    const folderRows = page.locator('.browse-table tbody tr.browse-row--folder');
    for (let depth = 0; depth < 3 && (await rowCheckboxes.count()) < 1; depth++) {
      if ((await folderRows.count()) === 0) break;
      await folderRows.first().click();
      await page.waitForTimeout(2500);
      rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
    }
    if ((await rowCheckboxes.count()) >= 1) break;
  }

  const resultCountBefore = await page.locator('.result-count').textContent().catch(() => '');
  await snap('fix2-00-browse-before-copy');

  if ((await rowCheckboxes.count()) >= 1) {
    await rowCheckboxes.nth(0).click();
    await page.waitForTimeout(600);

    const addClipboardBtn = page.locator('button[aria-label="Add to Clipboard"]').first();
    if (await addClipboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addClipboardBtn.click();
      await page.waitForTimeout(800);
      await snap('fix2-01-added-to-clipboard');
    }

    await page.locator('a[sat-platform-nav-menu-item]').filter({ hasText: 'Clipboard' }).first().click();
    await page.waitForTimeout(1200);
    await snap('fix2-02-clipboard-drawer');

    const copyBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Copy' }).first();
    const moveBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Move' }).first();

    if (await copyBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
      const apiBefore = apiCalls.length;
      await copyBtn.click();
      await page.waitForTimeout(4000);

      const copyApi = apiCalls.slice(apiBefore).find((c) => c.url.includes('Document.Copy'));
      helpers.step(`Fix 2 Copy API: ${copyApi ? `${copyApi.status} Document.Copy` : 'not observed'}`);

      const resultCountAfter = await page.locator('.result-count').textContent().catch(() => '');
      await snap('fix2-03-after-copy-no-refresh');

      const beforeNum = parseInt((resultCountBefore ?? '').replace(/\D/g, ''), 10);
      const afterNum = parseInt((resultCountAfter ?? '').replace(/\D/g, ''), 10);
      if (Number.isFinite(beforeNum) && Number.isFinite(afterNum) && afterNum > beforeNum) {
        helpers.step(`Fix 2 OK: result count ${beforeNum} → ${afterNum} without page refresh`);
      } else {
        console.warn(
          `\n⚠️  Fix 2 Copy: count unchanged (${resultCountBefore} → ${resultCountAfter}). Deploy may lack refresh fix.\n`,
        );
      }
    } else {
      console.warn('\n⚠️  Fix 2: Copy disabled — not in a folderish paste target.\n');
    }

    if (await moveBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
      helpers.step('Fix 2: Move button enabled on paste target (smoke)');
    }
  } else {
    console.warn('\n⚠️  Fix 2: No browse rows to select.\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fix 3: NXSAT-151 — Enter selects autocomplete (en → group01, not both)
  // ═══════════════════════════════════════════════════════════════════════════
  const groupPrefix = process.env['NUXEO_GROUP_PREFIX'] ?? 'group0';

  helpers.step(`Fix 3 (NXSAT-151): Edit User — Enter picks suggestion for "${groupPrefix}"`);

  await page.goto(`${helpers.baseUrl}/#/administration/users-groups`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('menuitem', { name: 'New user' }).click();
  await page.waitForTimeout(800);

  const groupInput = page.locator('input[name="groupSearch"]');
  if (await groupInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await groupInput.fill(groupPrefix);
    await page.waitForTimeout(1500);
    await snap('fix3-00-group-suggestions');

    const options = await page.locator('mat-option').allTextContents();
    helpers.step(`Fix 3 options for "${groupPrefix}": ${options.map((t) => t.trim()).join(', ') || '(none)'}`);

    if ((await page.locator('mat-option').count()) > 0) {
      await groupInput.press('Enter');
      await page.waitForTimeout(800);
      await snap('fix3-01-after-enter');

      const chips = (await page.locator('mat-chip-row .mat-mdc-chip-action-label').allTextContents())
        .map((t) => t.trim())
        .filter(Boolean);
      const hasTypedPrefix = chips.some((c) => new RegExp(`^${groupPrefix}$`, 'i').test(c));
      const hasSuggestion = chips.some(
        (c) => !new RegExp(`^${groupPrefix}$`, 'i').test(c) && options.some((o) => o.trim() === c),
      );
      const dualBug = hasTypedPrefix && hasSuggestion;

      if (dualBug) {
        console.warn(`\n⚠️  Fix 3 FAILED: typed prefix and suggestion chips: ${chips.join(', ')}\n`);
      } else if (hasSuggestion && !hasTypedPrefix) {
        helpers.step(`Fix 3 OK: autocomplete chip only — ${chips.join(', ')}`);
      } else {
        console.warn(`\n⚠️  Fix 3: unexpected chips: ${chips.join(', ')}\n`);
      }
    }

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
  }

  helpers.step(`Evidence complete (${envTag})`);
  await snap('fix-final-overview');
  if (apiCalls.length > 0) {
    console.log('\nAPI summary (last 15):');
    for (const call of apiCalls.slice(-15)) {
      console.log(`  ${call.status} ${call.method} ${call.url}`);
    }
  }
}
