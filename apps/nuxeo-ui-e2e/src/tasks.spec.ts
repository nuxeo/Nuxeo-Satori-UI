import { expect, newNuxeoApiContext, nuxeoCredentials, test } from './fixtures';
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
    // The same query the app makes (`TaskService.getUserTasks`): scoped to the user, page of 50.
    // The unscoped `/task` returns tasks the drawer deliberately does not list.
    const response = await api.get('/nuxeo/api/v1/task', {
      params: { userId: nuxeoCredentials().username, pageSize: 50 },
    });
    expect(response.status(), 'the task endpoint should answer').toBe(200);
    const body = await response.json();
    const tasks: unknown[] = Array.isArray(body) ? body : (body.entries ?? []);

    await page.goto('/#/tasks', { waitUntil: 'networkidle' });
    await expect(page.locator('lib-tasks-page')).toBeVisible();
    // The list lives in the navigation drawer's tasks panel, not in the page itself.
    const panel = page.locator('.tasks-panel-wrap');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.error')).toHaveCount(0);

    if (tasks.length === 0) {
      await expect(panel).toContainText('No pending tasks');
      await expect(panel.locator('.task-item')).toHaveCount(0);
    } else {
      await expect(panel.locator('.task-item')).toHaveCount(tasks.length);
    }
  });
});
