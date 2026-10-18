/**
 * Evidence steps for NXSAT-151
 * User/group chip autocomplete prefix concatenation + user list visibility
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-151 scripts/collect-evidence/NXSAT-151.mjs
 *
 * Env:
 *   NUXEO_USER / NUXEO_PASS — admin credentials, required: no default, and the runner refuses
 *                             without them
 *   NUXEO_GROUP_ID — group to edit for member autocomplete (optional, default administrators)
 */

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  await helpers.login();

  const groupId = process.env['NUXEO_GROUP_ID'] ?? 'administrators';

  // ── Users & Groups page ───────────────────────────────────────────────────
  helpers.step('Navigate to Users & Groups administration');
  await page.goto(`${helpers.baseUrl}/#/administration/users-groups`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2000);
  await helpers.screenshot('00-users-groups-page');

  // ── Fix 1: Create User — groups autocomplete ──────────────────────────────
  helpers.step('Fix 1: Open Create User dialog');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('menuitem', { name: 'New user' }).click();
  await page.waitForTimeout(800);

  const groupInput = page.locator('input[name="groupSearch"]');
  await groupInput.waitFor({ state: 'visible', timeout: 8000 });
  await helpers.screenshot('fix1-create-user-dialog');

  helpers.step('Fix 1: Type partial group prefix and pick suggestion');
  await groupInput.fill('power');
  await page.waitForTimeout(1200);

  const groupOption = page.locator('mat-option').filter({ hasText: /powerusers/i }).first();
  const groupOptionVisible = await groupOption.isVisible({ timeout: 5000 }).catch(() => false);
  if (groupOptionVisible) {
    await helpers.screenshot('fix1-groups-autocomplete-suggestions');
    await groupOption.click();
    await page.waitForTimeout(600);
    await helpers.screenshot('fix1-groups-chip-after-selection');

    const chipText = await page.locator('mat-chip-row').last().textContent();
    if (chipText && /powerpowerusers/i.test(chipText)) {
      console.warn('⚠️  Fix 1 FAILED: chip shows concatenated value:', chipText.trim());
    } else {
      helpers.step(`Fix 1 OK: chip shows "${(chipText ?? '').trim()}"`);
    }
  } else {
    console.warn('⚠️  No powerusers suggestion — skipping Fix 1 selection screenshot');
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const cancelBtn = page.getByRole('button', { name: 'Cancel' });
  if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelBtn.click();
    await page.waitForTimeout(500);
  }

  // ── Fix 2: Edit Group — member usernames autocomplete ─────────────────────
  helpers.step(`Fix 2: Open group details for ${groupId}`);
  await page.goto(`${helpers.baseUrl}/#/administration/users-groups/group/${groupId}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2000);
  await helpers.screenshot('fix2-group-details-page');

  const editBtn = page.getByRole('button', { name: /edit/i }).first();
  const editVisible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!editVisible) {
    console.warn('⚠️  Edit group button not found — skipping Fix 2');
    return;
  }

  helpers.step('Fix 2: Open Edit group dialog');
  await editBtn.click();
  await page.waitForTimeout(800);

  const memberInput = page.locator('input[name="memberUserSearch"]');
  await memberInput.waitFor({ state: 'visible', timeout: 8000 });
  await helpers.screenshot('fix2-edit-group-dialog');

  helpers.step('Fix 2: Type partial username and pick suggestion');
  await memberInput.fill('Admin');
  await page.waitForTimeout(1200);

  const userOption = page.locator('mat-option').first();
  const userOptionVisible = await userOption.isVisible({ timeout: 5000 }).catch(() => false);
  if (userOptionVisible) {
    const optionText = (await userOption.textContent()) ?? '';
    await helpers.screenshot('fix2-member-autocomplete-suggestions');
    await userOption.click();
    await page.waitForTimeout(600);
    await helpers.screenshot('fix2-member-chip-after-selection');

    const memberChip = page.locator('mat-chip-row').last();
    const chipText = ((await memberChip.textContent()) ?? '').trim();
    const typed = 'Admin';
    if (chipText.startsWith(typed) && chipText.length > typed.length + 2 && chipText.includes(typed + chipText.slice(typed.length).toLowerCase())) {
      // Heuristic: duplicated prefix like AdminAdministrator
      if (optionText.toLowerCase().includes(chipText.toLowerCase().replace(typed.toLowerCase(), ''))) {
        console.warn('⚠️  Fix 2 FAILED: chip may show concatenated value:', chipText);
      }
    }
    helpers.step(`Fix 2: selected member chip "${chipText}"`);
  } else {
    console.warn('⚠️  No user suggestions — skipping Fix 2 selection screenshot');
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const cancelGroup = page.getByRole('button', { name: 'Cancel' });
  if (await cancelGroup.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelGroup.click();
  }

  // ── Fix 3: Users list loads with wildcard search ──────────────────────────
  helpers.step('Fix 3: Users tab list loads (wildcard search)');
  await page.goto(`${helpers.baseUrl}/#/administration/users-groups`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(2000);
  await helpers.screenshot('fix3-users-list-loaded');
}
