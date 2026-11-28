import { expect, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';

import {
  aWorkspacePath,
  createFile,
  isTrashed,
  removeDoc,
  trashDoc,
  uniqueTitle,
  type MadeDoc,
} from './e2e-data';
import { SMOKE } from './smoke';

/**
 * Trash — a document trashed through the API appears in the app's trash, and restoring it in the
 * app restores it in the repository. The document is created by the spec, so the result does not
 * depend on what an instance happens to hold, and the final assertion reads the repository, not
 * the screen.
 */
let api: APIRequestContext;
let made: MadeDoc | null = null;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
});

test.afterEach(async () => {
  if (made) await removeDoc(api, made.uid);
  made = null;
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('trash', () => {
  test('lists a trashed document as a row and restores it', SMOKE, async ({ signedIn: page }) => {
    const title = uniqueTitle('e2e-trash');
    made = await createFile(api, await aWorkspacePath(api), title);
    expect(made, 'the fixture document should be created').not.toBeNull();
    await trashDoc(api, made!.uid);
    expect(
      await isTrashed(api, made!.uid),
      'the fixture should be trashed before the UI runs',
    ).toBe(true);

    await page.goto('/#/trash', { waitUntil: 'networkidle' });
    const row = page.locator('lib-trash tbody tr').filter({ hasText: title });
    await expect(row, 'the trashed document should be listed as a row').toBeVisible();

    await row.getByRole('checkbox').check();
    const untrash = page.waitForResponse((r) => r.url().includes('Document.Untrash'));
    await page.locator('.nxs-trash-list__restore-selected').click();
    const answer = await untrash;
    expect(
      answer.status(),
      `the app's restore request answered ${answer.status()}: ${(await answer.text()).slice(0, 300)}`,
    ).toBe(200);

    // The claim is about the repository: poll it, since the UI answer arrives before the write
    // is visible to a second read on a clustered instance.
    await expect
      .poll(() => isTrashed(api, made!.uid), {
        message: 'the document should no longer be trashed',
      })
      .toBe(false);
    await expect(row, 'a restored document leaves the trash listing').toHaveCount(0);
  });

  test('does not list a live document', async ({ signedIn: page }) => {
    const title = uniqueTitle('e2e-live');
    made = await createFile(api, await aWorkspacePath(api), title);
    expect(made).not.toBeNull();

    await page.goto('/#/trash', { waitUntil: 'networkidle' });
    await expect(page.locator('lib-trash')).toBeVisible();
    await expect(page.locator('lib-trash tbody tr').filter({ hasText: title })).toHaveCount(0);
  });
});
