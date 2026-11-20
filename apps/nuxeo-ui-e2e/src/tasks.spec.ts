import { expect, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';

/**
 * Tasks — the list agrees with the repository about how many tasks the user has. Both branches
 * assert against the API's count, so neither a populated nor an empty instance can pass on the
 * other's behaviour.
 */
let api: APIRequestContext;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('tasks', () => {
  test('lists the pending tasks the repository reports', async ({ signedIn: page }) => {
    const response = await api.get('/nuxeo/api/v1/task');
    expect(response.status(), 'the task endpoint should answer').toBe(200);
    const tasks: unknown[] = await response.json();

    await page.goto('/#/tasks', { waitUntil: 'networkidle' });
    const host = page.locator('lib-task-list');
    await expect(host).toContainText('My Tasks');
    await expect(host.locator('.task-error')).toHaveCount(0);

    if (tasks.length === 0) {
      await expect(host.locator('.task-empty')).toBeVisible();
      await expect(host.locator('.task-card')).toHaveCount(0);
    } else {
      await expect(host.locator('.task-card')).toHaveCount(tasks.length);
    }
  });
});
