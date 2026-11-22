import { expect, newNuxeoApiContext, nuxeoCredentials, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';

/**
 * Administration — gated by `adminGuard`. The spec reads who the test account is from `/me` and
 * asserts the matching behaviour: an administrator reaches the pages, anyone else is sent to the
 * dashboard. Hiding a page is not a security control, so this proves routing only.
 */
let api: APIRequestContext;
let isAdmin = false;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
  const me = await (await api.get('/nuxeo/api/v1/me')).json();
  const groups: string[] = me.extendedGroups?.map((g: { name: string }) => g.name) ?? [];
  isAdmin =
    me.properties?.isAdministrator === true ||
    me.isAdministrator === true ||
    groups.includes('administrators') ||
    groups.includes('powerusers');
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('administration', () => {
  test('is reachable exactly when the account has administration access', async ({
    signedIn: page,
  }) => {
    await page.goto('/#/administration/users-groups', { waitUntil: 'networkidle' });
    if (isAdmin) {
      await expect(page.locator('lib-administration-shell')).toBeVisible();
      await expect(page.locator('lib-admin-users-groups-page')).toBeVisible();
    } else {
      await expect(page).toHaveURL(/#\/dashboard/);
      await expect(page.locator('lib-administration-shell')).toHaveCount(0);
    }
  });

  for (const [route, host] of [
    ['analytics', 'lib-admin-analytics-page'],
    ['vocabularies', 'lib-admin-vocabularies-page'],
    ['audit', 'lib-admin-audit-page'],
    ['nxql-search', 'lib-admin-nxql-search-page'],
  ] as const) {
    test(`the ${route} page renders for an administrator`, async ({ signedIn: page }) => {
      expect(isAdmin, 'the E2E account must have administration access for this spec').toBe(true);
      await page.goto(`/#/administration/${route}`, { waitUntil: 'networkidle' });
      await expect(page.locator(host)).toBeVisible();
    });
  }

  test('the users list contains the signed-in account', async ({ signedIn: page }) => {
    expect(isAdmin, 'the E2E account must have administration access for this spec').toBe(true);
    await page.goto('/#/administration/users-groups', { waitUntil: 'networkidle' });
    await expect(page.locator('lib-admin-users-groups-page')).toContainText(
      nuxeoCredentials().username,
    );
  });
});
