/**
 * Phase 3 — browse, re-evidenced on the Satori browse page.
 *
 * The adf-hx POC route (`/#/browse-adf-hx`) and its hand-written and upstream components were
 * removed (NXSAT-635, NXSAT-637). `/#/browse-adf-hx` now redirects to `/#/browse`, so the
 * original steps could not run against current code. These steps re-capture the surfaces the
 * phase delivered — a server-backed document list, server-side sort, selection, breadcrumbs,
 * folder tabs, the column settings and the document tree — on the page that replaced them.
 *
 * **What this file does not prove:** that adf-hx is adopted. No adf-hx component is rendered
 * anywhere any more, and `dependency-tree` forbids one. A pass here is evidence about the
 * Satori browse page, not about the adoption the phase originally recorded.
 *
 * Prerequisites:
 *   npm run beta:backend
 *   npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run beta:evidence -- phase-3-adf-hx
 */

/** Column headers the browse page renders by default, in order. */
const EXPECTED_HEADERS = ['Title', 'Modified', 'Last Contributor'];

const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
  // sys_acl principal resolution: probes /group/ first for every principal, gets 404 for users
  /HTTP 404 \/nuxeo\/api\/v1\/group\//,
];

/** Where the versions fixture lives. Its own folder, so the list has one row to select. */
const FIXTURE_FOLDER_PATH = '/default-domain/workspaces/kd-versions-evidence';
const FIXTURE_DOC_NAME = 'versioned-file';
const FIXTURE_DOC_TITLE = 'KD Versions Evidence';
const FIXTURE_FILE_TEXT = 'phase-3 evidence: a versioned file used by the browse evidence';

/**
 * A document carrying exactly two Nuxeo versions, 0.1 and 0.2.
 *
 * Built through Nuxeo's REST API rather than through the UI: this is *setup*, and driving it
 * through the surface under test would make the fixture and the assertion the same claim.
 * `page.request` inherits the context's `httpCredentials`, which the runner sends with every
 * request, so these writes run as the configured administrator.
 *
 * The document is deleted and recreated on every run so the version labels are the same every
 * run. Only this folder is touched, and only the document this step created inside it.
 */
async function createVersionedFixture(page, h) {
  const api = `${h.baseUrl}/nuxeo/api/v1`;
  const json = { 'Content-Type': 'application/json' };
  const post = (path, body) =>
    page.request.post(`${api}${path}`, { headers: json, data: body, failOnStatusCode: false });

  // The folder, created if absent. A 409 means it already exists, which is the normal case.
  await post('/path/default-domain/workspaces', {
    'entity-type': 'document',
    name: 'kd-versions-evidence',
    type: 'Folder',
    properties: { 'dc:title': 'KD Versions Evidence' },
  });

  // A clean document each run: a leftover would already be at 0.3 or beyond.
  await page.request.delete(`${api}/path${FIXTURE_FOLDER_PATH}/${FIXTURE_DOC_NAME}`, {
    failOnStatusCode: false,
  });

  // A real main file, so the document has content behind it.
  const batch = await page.request.post(`${api}/upload/`, { failOnStatusCode: false });
  const batchId = (await batch.json().catch(() => null))?.batchId;
  const uploaded = batchId
    ? await page.request.post(`${api}/upload/${batchId}/0`, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'evidence.txt',
          'X-File-Type': 'text/plain',
        },
        data: FIXTURE_FILE_TEXT,
        failOnStatusCode: false,
      })
    : null;
  h.requirePrecondition(
    'the fixture file could be uploaded to Nuxeo',
    Boolean(uploaded?.ok()),
    `batch ${batch.status()}, upload ${uploaded?.status() ?? 'not attempted'} — without a file ` +
      'the fixture has no content.',
  );

  const created = await post(`/path${FIXTURE_FOLDER_PATH}`, {
    'entity-type': 'document',
    name: FIXTURE_DOC_NAME,
    type: 'File',
    properties: {
      'dc:title': FIXTURE_DOC_TITLE,
      'dc:description': 'created by phase-3 evidence',
      'file:content': { 'upload-batch': batchId, 'upload-fileId': '0' },
    },
  });
  const uid = (await created.json())?.uid;
  h.requirePrecondition(
    'the versions fixture could be created in Nuxeo',
    Boolean(uid),
    `POST ${FIXTURE_FOLDER_PATH} returned ${created.status()} — without a fixture the versions ` +
      'panel has nothing real to render.',
  );

  // Two check-ins, each preceded by an edit so Nuxeo has a change to snapshot.
  for (const comment of ['first evidence version', 'second evidence version']) {
    await post(`/id/${uid}/@op/Document.CheckIn`, {
      params: { version: 'minor', comment },
      context: {},
    });
    await page.request.put(`${api}/id/${uid}`, {
      headers: json,
      data: { 'entity-type': 'document', properties: { 'dc:description': comment } },
      failOnStatusCode: false,
    });
  }

  // Counted through the same operation the versions port uses. Deliberately **not** the NXQL
  // search: that path is OpenSearch-backed and lags a check-in by seconds.
  const listed = await post(`/id/${uid}/@op/Document.GetVersions`, { params: {}, context: {} });
  const versionCount = ((await listed.json())?.entries ?? []).length;
  return { uid, versionCount };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // Every `@children` request the page makes, for the server-side sort assertion.
  const childrenRequests = [];
  const recordChildren = (request) => {
    if (request.url().includes('/@children')) childrenRequests.push(request.url());
  };
  page.on('request', recordChildren);

  await h.step('Precondition: a backend is reachable, so the list has real rows');
  const probe = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/me`, { failOnStatusCode: false })
    .catch(() => null);
  h.requirePrecondition(
    'Nuxeo API answers through the dev proxy',
    probe?.status() === 200,
    `/nuxeo/api/v1/me returned ${probe?.status() ?? 'no response'} — an empty list proves nothing ` +
      'about a document list. Run `npm run beta:backend` first.',
  );

  await h.step('Browse renders a document list over real Nuxeo children');
  await h.login();
  await h.goTo('/#/browse/default-domain/workspaces');
  await h.expectVisible('document list rendered', 'nxs-document-list');
  await page.waitForFunction(
    () => document.querySelectorAll('nxs-document-list tr.nxs-document-list__row').length > 0,
    null,
    { timeout: 120000 },
  );

  // The folder header names the folder and shows no internal Sys* identifier.
  const folderHeaderText = await page
    .locator('nxs-folder-header')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    'the folder header shows no internal Sys* identifier',
    folderHeaderText.length > 0 && !/\bSys[A-Z]/.test(folderHeaderText),
    `folder header read ${JSON.stringify(folderHeaderText.slice(0, 120))}`,
  );

  // Header cells that carry a control, and the visually hidden selection label, are excluded:
  // the column set is what this asserts.
  const rendered = await page.$$eval('nxs-document-list thead th', (cells) =>
    cells
      .filter((c) => !c.classList.contains('nxs-document-list__select'))
      .filter((c) => !c.classList.contains('nxs-document-list__actions'))
      .map((c) => (c.textContent ?? '').trim())
      .filter((t) => t.length > 0),
  );
  h.check(
    'column headers match the packaged set, in order',
    JSON.stringify(rendered) === JSON.stringify(EXPECTED_HEADERS),
    `expected ${JSON.stringify(EXPECTED_HEADERS)}, rendered ${JSON.stringify(rendered)}`,
  );

  const rowTitles = await page.$$eval('nxs-document-list tr.nxs-document-list__row', (rows) =>
    rows.map((r) => (r.textContent ?? '').trim().slice(0, 40)).filter(Boolean),
  );
  h.check(
    'real Nuxeo children are listed',
    rowTitles.length > 0,
    `rendered ${rowTitles.length} row(s): ${JSON.stringify(rowTitles.slice(0, 4))}`,
  );
  await h.screenshot('document-list');

  await h.step('Column sort reaches the server, and the list pages');
  const listRowTitles = () =>
    page.$$eval('nxs-document-list tr.nxs-document-list__row', (rows) =>
      rows.map((r) => (r.textContent ?? '').trim().slice(0, 24)).filter(Boolean),
    );

  const pagerRange = () =>
    page
      .locator('nxs-pager')
      .first()
      .innerText()
      .catch(() => '');

  h.check('a pager is present', (await page.locator('nxs-pager').count()) > 0);
  const firstPage = await listRowTitles();
  const firstRange = (await pagerRange()).replace(/\s+/g, ' ').trim();
  h.note(`pager read ${JSON.stringify(firstRange)} on the first page`);

  const titleHeader = page.locator('nxs-document-list th[mat-sort-header]').first();
  const requestsBeforeSort = childrenRequests.length;
  await titleHeader.click();
  await page.waitForFunction(() => document.querySelectorAll('nxs-document-list tr.nxs-document-list__row').length > 0, null, { timeout: 120000 });
  const sortedPage = await listRowTitles();
  // The list was already in title order before the click, so "differs from before" cannot be the
  // test. The result must be in title order, in one direction or the other; the wire check below
  // is the one that proves the server did the ordering.
  const ascending = [...sortedPage].sort((x, y) => x.localeCompare(y));
  const descending = [...ascending].reverse();
  h.check(
    'clicking a column header leaves the list in title order',
    sortedPage.length > 1 &&
      (JSON.stringify(sortedPage) === JSON.stringify(ascending) ||
        JSON.stringify(sortedPage) === JSON.stringify(descending)),
    `before ${JSON.stringify(firstPage.slice(0, 3))} after ${JSON.stringify(sortedPage.slice(0, 3))}`,
  );
  // A reordered list alone does not prove the server was asked — adf-core-style tables also sort
  // the loaded page. A `sortBy` in a `@children` request does.
  const sortedRequests = childrenRequests.slice(requestsBeforeSort).filter((u) => u.includes('sortBy='));
  h.check(
    'a @children request carried sortBy, so the server did the ordering',
    sortedRequests.length > 0,
    `${childrenRequests.length - requestsBeforeSort} @children request(s) after the click, none with sortBy`,
  );
  h.check(
    'the sort field is a Nuxeo property, not a client key',
    sortedRequests.some((u) => /sortBy=dc(%3A|:)/.test(u)),
    `sorted request URLs: ${JSON.stringify(sortedRequests.slice(-2))}`,
  );
  await h.screenshot('sorted-list');

  await h.step('Rows are selectable');
  const rowCheckboxes = page.locator('nxs-document-list tr.nxs-document-list__row mat-checkbox');
  const checkboxCount = await rowCheckboxes.count();
  h.check('every row offers a selection checkbox', checkboxCount >= 2, `found ${checkboxCount}`);
  // Select one, and assert it reports itself checked. A screenshot of an untouched list is not
  // evidence that selection works.
  await rowCheckboxes.nth(1).click().catch(() => {});
  await page.waitForTimeout(500);
  const selectedCount = await page
    .locator('nxs-document-list tr.nxs-document-list__row mat-checkbox.mat-mdc-checkbox-checked')
    .count();
  h.check('clicking a row checkbox selects that row', selectedCount === 1, `${selectedCount} checked`);
  await h.screenshot('row-selection');
  await rowCheckboxes.nth(1).click().catch(() => {});
  await page.waitForTimeout(300);

  await h.step('Breadcrumb links point at this app, and the current folder is the location');
  await h.goTo('/#/browse/default-domain/workspaces');
  await page.waitForTimeout(2000);
  const crumbHrefs = await page.$$eval('nxs-satori-breadcrumbs a[href]', (as) =>
    as.map((a) => a.getAttribute('href') ?? ''),
  );
  h.check(
    'the breadcrumb carries at least one link to a folder',
    crumbHrefs.length >= 1 && crumbHrefs.every((href) => href.includes('/browse')),
    `hrefs were ${JSON.stringify(crumbHrefs)}`,
  );
  h.check(
    "no link points at upstream's /{repository}/documents/ shape",
    !crumbHrefs.some((href) => href.includes('/documents/')),
    `hrefs were ${JSON.stringify(crumbHrefs.slice(0, 4))}`,
  );
  await h.screenshot('breadcrumb');

  await h.step('Column settings open and offer the packaged columns');
  const columnsBtn = page.locator('button[aria-label="Manage columns"]').first();
  h.check('a column-settings control exists', (await columnsBtn.count()) > 0);
  await columnsBtn.click().catch(() => {});
  await page.waitForTimeout(800);
  const dialogText = await page
    .locator('nxs-column-picker')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    'the column settings dialog opens',
    dialogText.length > 0,
    `dialog text was ${JSON.stringify(dialogText.slice(0, 140))}`,
  );
  h.check(
    'the dialog lists the Version and Coverage columns',
    dialogText.includes('Version') && dialogText.includes('Coverage'),
    `dialog text was ${JSON.stringify(dialogText.slice(0, 200))}`,
  );
  await h.screenshot('column-settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await h.step('Card view renders with the list toggled');
  const cardToggle = page.locator('button[aria-label="Card view"]').first();
  h.check('a card-view toggle exists', (await cardToggle.count()) > 0);
  await cardToggle.click().catch(() => {});
  await page.waitForTimeout(1500);
  // The card grid replaces the list (the list sits under `@if (viewMode() === 'list')`), so the
  // grid must exist and the table must not.
  const cardGrid = await page.locator('.card-grid').count();
  const listWhileCards = await page.locator('nxs-document-list').count();
  h.check(
    'card view renders a grid and replaces the list',
    cardGrid >= 1 && listWhileCards === 0,
    `card grids ${cardGrid}, lists ${listWhileCards}`,
  );
  await h.screenshot('card-view');
  await page.locator('button[aria-label="List view"]').first().click().catch(() => {});
  await page.waitForTimeout(800);

  await h.step('Document tree renders real Nuxeo folders in the navigation');
  await h.goTo('/#/browse/default-domain/workspaces');
  await page.waitForTimeout(3000);
  const treeNodes = await page.$$eval(
    'nxs-document-tree [role="treeitem"], nxs-document-tree mat-tree-node',
    (nodes) => nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean),
  );
  h.check(
    'the tree renders real Nuxeo folders',
    treeNodes.length > 0,
    `found ${treeNodes.length}: ${JSON.stringify(treeNodes.slice(0, 4))}`,
  );
  await h.screenshot('document-tree');

  await h.step('Fixture: a document with two known Nuxeo versions');
  // Built by the step rather than assumed to exist, so the version labels below are
  // deterministic. A fixture left over from a previous run would have grown past 0.2.
  const fixture = await createVersionedFixture(page, h);
  h.check(
    'fixture document has two versions in Nuxeo',
    fixture.versionCount === 2,
    `Document.GetVersions reported ${fixture.versionCount} version(s) for ${fixture.uid}`,
  );

  await h.step('Folder tabs are the four folder tabs');
  await h.goTo(`/#/browse${FIXTURE_FOLDER_PATH}`);
  await page.waitForTimeout(2000);
  const tabLabels = await page.$$eval('[role="tab"]', (els) =>
    els.map((el) => (el.textContent ?? '').trim()).filter(Boolean),
  );
  const EXPECTED_TABS = ['View', 'Permissions', 'History', 'Trash'];
  h.check(
    'the folder tab strip is exactly the four folder tabs',
    JSON.stringify(tabLabels) === JSON.stringify(EXPECTED_TABS),
    `tab strip rendered ${JSON.stringify(tabLabels)}`,
  );
  await h.screenshot('folder-tabs');

  await h.step('The fixture is listed in its own folder');
  await page.waitForFunction(
    () => document.querySelectorAll('nxs-document-list tr.nxs-document-list__row').length > 0,
    null,
    { timeout: 120000 },
  );
  const fixtureRow = page
    .locator('nxs-document-list tr.nxs-document-list__row')
    .filter({ hasText: FIXTURE_DOC_TITLE })
    .first();
  h.check('the fixture document is listed', (await fixtureRow.count()) > 0, FIXTURE_DOC_TITLE);
  await h.screenshot('fixture-listed');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  page.off('request', recordChildren);
  h.note(
    'Not covered on the browse page: the document viewer (it lives on the document detail page, ' +
      'which this file does not visit), the upstream adf-hx components this phase originally ' +
      'adopted (none is rendered any more), and the per-document versions and properties panels ' +
      '(they moved to the document page).',
  );
}
