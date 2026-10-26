/**
 * Evidence steps for NXSAT-200
 * Profile permissions parity with Classic Web UI + auth refresh stability.
 *
 * Run with:
 *   npm run evidence:collect -- NXSAT-200 scripts/collect-evidence/NXSAT-200.mjs
 *
 * Required env (no default — the runner refuses without them):
 *   NUXEO_USER=<username> NUXEO_PASS=<password> npm run evidence:collect -- …
 */

import { requireStepCredentials } from '../beta-harness/helpers.mjs';

/** @param {import('@playwright/test').Page} page */
export default async function collectEvidence(page, helpers, _outDir) {
  // The heading asserted below is the signed-in user's name, so it has to be the identity the
  // run actually used. This defaulted to `Administrator`, which matched only when the login did
  // too (NXSAT-649).
  const { username: user } = requireStepCredentials('collect NXSAT-200 evidence');

  await helpers.login();

  helpers.step('Navigate to Profile settings');
  await page.goto(`${helpers.baseUrl}/#/settings/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  helpers.step('Profile header shows logged-in user');
  await page.getByRole('heading', { name: user, level: 2 }).waitFor({ timeout: 15_000 });
  await helpers.screenshot('01-profile-header');

  helpers.step('Groups table loaded');
  await page.getByRole('heading', { name: 'Groups', level: 3 }).waitFor({ timeout: 10_000 });
  await page
    .locator('.profile-card__table tbody tr')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => page.getByText('No groups found.').waitFor({ timeout: 5000 }));
  await page.waitForTimeout(1000);
  await helpers.screenshot('02-groups-table');

  helpers.step('Local Permissions section (Web UI filtered — local ACL only)');
  const localSection = page.locator('.profile-card').filter({ hasText: 'Local Permissions' }).first();
  await localSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await helpers.screenshot('03-local-permissions', localSection);

  helpers.step('Verify no extra Administrator Permissions section (Web UI parity)');
  const adminSection = page.getByRole('heading', {
    name: 'Administrator Permissions',
    level: 3,
  });
  const hasAdminSection = await adminSection.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasAdminSection) {
    throw new Error('Unexpected Administrator Permissions section — Web UI profile does not have it');
  }
  await helpers.screenshot('04-no-admin-permissions-section');

  helpers.step('Scroll to first group permissions card (lazy-loaded)');
  const groupPermHeading = page
    .locator('.profile-card__section-title')
    .filter({ hasText: / permissions$/ })
    .first();
  await groupPermHeading.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
  if (await groupPermHeading.isVisible().catch(() => false)) {
    await groupPermHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await helpers.screenshot('05-group-permissions-card', groupPermHeading.locator('..'));
  } else {
    helpers.step('No group permissions cards (user may have no groups)');
    await helpers.screenshot('05-no-group-permissions');
  }

  helpers.step('Refresh page — user must stay authenticated');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  if (page.url().includes('#/login')) {
    throw new Error('Refresh redirected to login — auth hydration regression');
  }
  await page.getByRole('heading', { name: user, level: 2 }).waitFor({ timeout: 15_000 });
  await helpers.screenshot('06-after-refresh-still-authenticated');

  helpers.step('Local permissions still visible after refresh');
  await localSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await helpers.screenshot('07-local-permissions-after-refresh', localSection);
}
