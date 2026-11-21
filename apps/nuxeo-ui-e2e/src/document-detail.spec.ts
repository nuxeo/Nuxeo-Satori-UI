import { expect, expectSurfaceWithData, newNuxeoApiContext, test } from './fixtures';
import { type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Document detail — metadata, permissions and the tab surfaces.
 *
 * The document is **discovered** through the app's own proxy rather than hardcoded. A
 * pinned UID makes the spec pass on one machine and fail on every other, and the failure
 * reads as a product defect rather than a fixture problem. Discovery also exercises the
 * proxy and Basic auth before the UI is involved, so an auth failure is attributed to the
 * right place.
 */
let api: APIRequestContext;

test.beforeAll(async () => {
  // `newNuxeoApiContext()` rather than a context of its own. The hand-rolled one here passed
  // `httpCredentials`, which Playwright only sends in answer to a `401` challenge — and this
  // endpoint never issues one, so the credentials were never sent and `aDocument()` discovered
  // its fixture as `Anonymous`. Not as an empty result that would have been noticed: measured
  // on a populated instance, this exact `File` query returns `resultsCount: 1` anonymously
  // against `1154` authenticated, so the spec found a document, asserted a title and went
  // green against the wrong identity. The shared helper sets the header explicitly and proves
  // the identity before returning.
  api = await newNuxeoApiContext();
});

test.afterAll(async () => {
  await api?.dispose();
});

async function aDocument(): Promise<{ uid: string; title: string; path: string }> {
  const response = await api.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
    params: {
      query: "SELECT * FROM Document WHERE ecm:primaryType = 'File' AND ecm:isTrashed = 0",
      pageSize: 1,
    },
    headers: { 'X-NXproperties': '*' },
  });
  // Status only — it says the proxy answered, and nothing about who as. `200` is exactly what
  // an anonymous query returns here, so the authentication claim this message used to make
  // belongs where it can be checked: `newNuxeoApiContext()` asserts the identity on creation.
  expect(response.status(), 'the proxy should answer the NXQL query').toBe(200);

  const body = await response.json();
  const entry = body.entries?.[0];
  // A failure here is a fixture problem, not a product one, and the message says so.
  expect(
    entry?.uid,
    'no File document exists in this Nuxeo, so document-detail cannot be exercised — ' +
      'import one, or this spec asserts nothing',
  ).toBeTruthy();
  return { uid: entry.uid, title: entry.title, path: entry.path };
}

/** The first segment of a repository path: `/default-domain/workspaces/x` -> `default-domain`. */
function domainOf(path: string): string {
  const segment = path.split('/').filter(Boolean)[0];
  expect(segment, `the document has no usable repository path (${path})`).toBeTruthy();
  return segment;
}

test.describe('document detail', () => {
  test('opens a document and shows its metadata', async ({ signedIn: page }) => {
    const doc = await aDocument();
    await page.goto(`/#/doc/${doc.uid}`, { waitUntil: 'networkidle' });

    // The document's own title, so this cannot pass on a shell that rendered without data.
    await expectSurfaceWithData(page, 'lib-document-detail', doc.title);
    // The repository path, which only the detail fetch supplies. Its first segment is read from
    // the document itself: a local stack roots content under `default-domain`, a hosted one may
    // not, and a literal made this spec pass on one instance and fail on the other.
    await expect(page.locator('lib-document-detail')).toContainText(domainOf(doc.path));
  });

  test('exposes the tab surfaces the Beta scope covers', async ({ signedIn: page }) => {
    const doc = await aDocument();
    await page.goto(`/#/doc/${doc.uid}`, { waitUntil: 'networkidle' });

    const host = page.locator('lib-document-detail');
    await expect(host).toBeVisible();
    // Named individually: Permissions, History and Publishing are all in the Beta slice,
    // and a tab quietly disappearing is exactly the regression this suite exists to catch.
    for (const tab of ['Permissions', 'History', 'Publishing']) {
      await expect(host, `the ${tab} tab should be present`).toContainText(tab);
    }
  });

  test('an unknown document id does not render a document', async ({ signedIn: page }) => {
    // The negative path. A detail page that renders something for any id is not fetching.
    const domain = domainOf((await aDocument()).path);
    // A fresh random id, not the all-zero one: a hosted (DBS) Nuxeo gives its repository Root
    // exactly that id, so the literal resolved to a real document there and the app, correctly,
    // showed it. Random v4 ids cannot collide with a stored document.
    await page.goto(`/#/doc/${randomUUID()}`, { waitUntil: 'networkidle' });

    await expect(page.locator('app-shell')).toBeVisible();
    // Assert what the app does for a missing document — an error state — rather than only the
    // absence of one document's text, which also passes on a blank page.
    const detail = page.locator('lib-document-detail');
    await expect(detail.locator('nxs-error-state')).toBeVisible();
    await expect(detail).not.toContainText(domain);
  });
});
