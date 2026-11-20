import { expect, test } from './fixtures';

/**
 * Assets — the results page answers a type filter with rows and a hopeless full-text query with
 * its empty state. The negative half matters: a page that always shows rows is not searching.
 */
test.describe('assets', () => {
  test('lists File documents for the File type filter', async ({ signedIn: page }) => {
    await page.goto('/#/documents?asset-type=File', { waitUntil: 'networkidle' });
    const host = page.locator('lib-asset-search-results');
    await expect(host.locator('.row-name-text').first()).toBeVisible();
    await expect(host).not.toContainText('No Documents match the search criteria.');
  });

  test('shows the empty state for a query nothing matches', async ({ signedIn: page }) => {
    const nonsense = `zz${Date.now()}qqnomatch`;
    await page.goto(`/#/documents?ecm_fulltext=${nonsense}`, { waitUntil: 'networkidle' });
    const host = page.locator('lib-asset-search-results');
    await expect(host).toContainText('No Documents match the search criteria.');
    await expect(host.locator('.row-name-text')).toHaveCount(0);
  });
});
