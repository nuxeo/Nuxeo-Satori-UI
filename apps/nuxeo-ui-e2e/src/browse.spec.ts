import { aRootChild, expect, expectRowWithData, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';

/**
 * Browse — the primary authenticated surface, and the one every other path starts from.
 *
 * Assertions are on **repository data**, not on the component being present. An
 * unauthenticated XHR renders `lib-browse` with no rows: visible, green under a
 * `toBeVisible` check, and proof of nothing.
 *
 * That distinction is the reason `expectRowWithData` exists rather than
 * `expectSurfaceWithData`, which is what stood here. On this surface, searching the whole
 * component is not enough: its empty state reads "Open Sections, Templates, or Workspaces,
 * then create content inside those folders", and those are exactly the titles the specs
 * expected to find — so the assertions matched the copy that says the folder is empty.
 * Scoping to a row fixes it, because a row is only rendered for a document. NXSAT-708 found
 * it by serving the app an empty repository and watching the old assertions stay green.
 */

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await newNuxeoApiContext();
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('browse', () => {
  test('lists repository content at the root', async ({ signedIn: page }) => {
    await page.goto('/#/browse', { waitUntil: 'networkidle' });

    const rootChild = await aRootChild(api);
    // Scoped to the listing's rows, not to `lib-browse` as a whole (NXSAT-708).
    //
    // `expectSurfaceWithData(page, 'lib-browse', rootChild.title)` stood here and was
    // vacuous: the surface's empty state reads "Open Sections, Templates, or Workspaces,
    // then create content inside those folders", `aRootChild` returns one of those three
    // titles in a stock repository, and the assertion matched the sentence. Measured with
    // the app served an empty repository: 0 rows, "0 results" on screen, assertion green,
    // under a failure message that says "should show repository data, not an empty state".
    //
    // A row cannot be rendered without a document, so this cannot pass on the empty state.
    await expectRowWithData(page, 'lib-browse', rootChild.title);
    // `Create / Import` is a toolbar action, and its presence is the healthy case: it needs
    // the loaded folder and the caller's AddChildren permission. The comment that stood
    // here called it "the empty-state copy the app shows for a folder with no children"
    // whose "presence at the root would mean the listing failed" — the opposite of what the
    // line asserts, and wrong about what the string is.
    await expect(page.locator('lib-browse')).toContainText('Create / Import');
  });

  test('offers navigation into the repository tree', async ({ signedIn: page }) => {
    await page.goto('/#/browse', { waitUntil: 'networkidle' });

    const rootChild = await aRootChild(api);
    await expectRowWithData(page, 'lib-browse', rootChild.title);

    // Navigate in, and assert the children arrive **as rows** (NXSAT-708).
    //
    // This used to be `expect(host).toContainText(/Sections|Templates|Workspaces/)` against
    // the whole surface, without navigating anywhere. That was vacuous twice over: those
    // three words are the empty-state sentence "Open Sections, Templates, or Workspaces,
    // then create content inside those folders", and they are never rows at the browse root
    // in any case — the root lists one row, the domain. So a spec named for navigation
    // asserted the instructions on the page it started from, and stayed green with the
    // repository empty.
    await page.locator('lib-browse table tbody tr').first().dblclick();
    await expect(page, 'opening the domain should navigate into it').toHaveURL(/#\/browse\/.+/);

    const rows = page.locator('lib-browse table tbody tr');
    await expect(
      rows.filter({ hasText: /Sections|Templates|Workspaces/ }).first(),
      'the domain’s children should be listed as rows after navigating into it',
    ).toBeVisible();
  });

  test('the shell renders its chrome on an authenticated route', async ({ signedIn: page }) => {
    await page.goto('/#/browse', { waitUntil: 'networkidle' });

    const shell = page.locator('app-shell');
    await expect(shell).toBeVisible();
    // The skip link is an accessibility affordance that must survive a refactor; Phase 6
    // step 3 raises the wider WCAG bar, and this keeps one landmark of it under test now.
    await expect(shell).toContainText('Skip to main content');
  });
});
