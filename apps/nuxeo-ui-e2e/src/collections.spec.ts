import { expect, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { removeDoc, uniqueTitle } from './e2e-data';

/**
 * Collections — the detail page reads a real collection. The collection is created by the spec
 * through `Collection.Create`, the operation the app itself uses, and deleted afterwards.
 */
let api: APIRequestContext;
let uid: string | null = null;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
});

test.afterEach(async () => {
  if (uid) await removeDoc(api, uid);
  uid = null;
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('collections', () => {
  test('shows the collection it was opened for', async ({ signedIn: page }) => {
    const name = uniqueTitle('e2e-collection');
    const created = await api.post('/nuxeo/api/v1/automation/Collection.Create', {
      data: { params: { name, description: 'created by the E2E suite' }, context: {} },
    });
    expect(created.status(), 'Collection.Create should succeed for the test account').toBe(200);
    uid = (await created.json()).uid;
    expect(uid).toBeTruthy();

    await page.goto(`/#/collections/${uid}`, { waitUntil: 'networkidle' });
    await expect(page.locator('lib-collection-detail')).toContainText(name);
  });

  test('an unknown collection id does not render a collection', async ({ signedIn: page }) => {
    await page.goto(`/#/collections/${randomUUID()}`, { waitUntil: 'networkidle' });
    await expect(page.locator('app-shell')).toBeVisible();
    await expect(page.locator('lib-collection-detail .unavailable-title')).toHaveText(
      'Collection not found',
    );
  });
});
