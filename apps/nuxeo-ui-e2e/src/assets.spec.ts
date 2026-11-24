import { expect, newNuxeoApiContext, test } from './fixtures';

/**
 * Assets — the results page answers a type filter with rows and a hopeless full-text query with
 * its empty state. The negative half matters: a page that always shows rows is not searching.
 */
test.describe('assets', () => {
  test('lists documents of an asset type the repository holds', async ({ signedIn: page }) => {
    // The Assets facets cover media types only (Picture, Video, Audio), and which of them an
    // instance holds differs, so the type is discovered rather than named.
    const api = await newNuxeoApiContext();
    const response = await api.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
      params: {
        query:
          "SELECT * FROM Document WHERE ecm:primaryType IN ('Picture','Video','Audio') AND ecm:isTrashed = 0 AND ecm:isVersion = 0",
        pageSize: 1,
      },
    });
    const entry = (await response.json()).entries?.[0];
    await api.dispose();
    expect(
      entry?.type,
      'no Picture, Video or Audio exists, so Assets cannot be exercised',
    ).toBeTruthy();

    await page.goto(`/#/documents?asset-type=${entry.type}`, { waitUntil: 'networkidle' });
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
