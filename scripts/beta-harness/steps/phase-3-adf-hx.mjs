/**
 * Phase 3 — adf-hx component adoption, starting with `document-list`.
 *
 * This file is written **before** the swap and records the hand-written component's
 * behaviour, so the report shows a genuine before and after rather than a claim of
 * parity. `adopt-adf-hx-component` requires that capture because once the local
 * `hxp-document-list` is deleted its behaviour is unrecoverable.
 *
 * ## What "before" and "after" mean here
 *
 * The two components are **not** interchangeable, and pretending otherwise is the
 * trap. The hand-written one (384 lines) renders an error state with a retry button,
 * a card view, thumbnails and its own column picker. Upstream's
 * `HxpDocumentListComponent` renders a DataTable and nothing else: no error state,
 * no card view, no thumbnails, no picker. Those responsibilities belong to the host
 * page, which is arguably where they should have been.
 *
 * So the assertions below are split:
 *
 * - **Data parity** — the same Nuxeo children, in the same order, with the same
 *   column headers. This must hold across the swap.
 * - **Host responsibilities** — error, empty and card view. These must keep working
 *   after moving, and are asserted separately so a regression in one is not hidden
 *   by the other passing.
 *
 * Prerequisites:
 *   npm run beta:backend
 *   npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run beta:evidence -- phase-3-adf-hx
 */

/**
 * Column headers the hand-written list renders by default, transcribed from
 * `HXP_BROWSE_ALL_COLUMNS` in `hxp-browse-columns.utils.ts`. Asserted as an ordered
 * equality so a reorder or a relabel fails rather than passing a count.
 */
const EXPECTED_HEADERS = ['Title', 'Modified', 'Last Contributor'];

const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
  // sys_acl principal resolution: probes /group/ first for every principal, gets 404 for users
  /HTTP 404 \/nuxeo\/api\/v1\/group\//,
  // adf-core viewer / pdfjs-dist passive event listener warning
  /preventDefault inside passive event listener/,
];

/** Where the versions fixture lives. Its own folder, so the list has one row to select. */
const FIXTURE_FOLDER_PATH = '/default-domain/workspaces/kd-versions-evidence';
const FIXTURE_DOC_NAME = 'versioned-file';
const FIXTURE_DOC_TITLE = 'KD Versions Evidence';
/** The fixture's main file. The viewer check asserts this exact text is on screen. */
const FIXTURE_FILE_TEXT = 'phase-3 evidence: this text is rendered by the adf-hx document viewer';

/**
 * A document carrying exactly two Nuxeo versions, 0.1 and 0.2.
 *
 * Built through Nuxeo's REST API rather than through the UI: this is *setup*, and driving it
 * through the surface under test would make the fixture and the assertion the same claim.
 * `page.request` inherits the context's `httpCredentials`, which the runner sends with every
 * request (`send: 'always'`); until NXSAT-643 they were sent only on a challenge that a
 * guest-enabled Nuxeo never issues, and these writes ran as `Anonymous`.
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

  // A real main file, so the viewer check has content to render. A File with no blob is what let
  // that check pass while every preview showed "Couldn't load preview".
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
      'the viewer has nothing to render, and an empty viewer proves nothing.',
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
      'panel has nothing real to render, and an empty panel proves nothing.',
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

  // Counted through the same operation the `QUERY` port uses, so the fixture's own count and
  // the UI's are read from one source. Deliberately **not** the NXQL search: that path is
  // OpenSearch-backed here and lags a check-in by seconds, which would make this flaky.
  const listed = await post(`/id/${uid}/@op/Document.GetVersions`, { params: {}, context: {} });
  const versionCount = ((await listed.json())?.entries ?? []).length;
  return { uid, versionCount };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── sys_acl principal lookup monitoring (global for the whole run) ──
  const principalLookups = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/nuxeo\/api\/v1\/(group|user)\/[^/?]+$/.test(url)) principalLookups.push(url);
  });

  await h.step("Precondition: the dev server serves adf-core's translation catalogue");
  // adf-hx components fetch `assets/adf-core/i18n/<lang>.json` at runtime, copied in by an
  // asset glob in `angular.json`. Without it one accessibility label renders as a raw key and
  // the console fills with 404s — asserted as a precondition so the run says so instead of
  // reporting failures that look like broken components. The shipped case is gated separately
  // by `bundle`, which asserts the file is present in `dist/`.
  //
  // This first failed for a reason worth recording: Angular's `development` configuration
  // **replaces** the `assets` array rather than merging with it, and only the top-level
  // `options` array had the adf-core glob. Every dev server ever started on this branch
  // 404ed the catalogue, and this precondition's first message blamed a stale server and
  // told the reader to restart it — which could never have helped.
  const catalogue = await page.request
    .get(`${h.baseUrl}/assets/adf-core/i18n/en.json`, { failOnStatusCode: false })
    .catch(() => null);
  h.requirePrecondition(
    "adf-core's catalogue is served",
    catalogue?.status() === 200,
    `/assets/adf-core/i18n/en.json returned ${catalogue?.status() ?? 'no response'} — the dev ` +
      "server is not serving adf-core's assets. Check that the `development` configuration in " +
      'angular.json still lists the adf-core glob (it replaces the array, it does not merge), ' +
      'then restart: npx nx serve nuxeo-ui',
  );
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

  await h.step('The POC route renders a document list over real Nuxeo children');
  await h.login();
  await h.goTo('/#/browse-adf-hx');
  await page.waitForTimeout(1500);
  await h.expectVisible('POC page rendered', 'lib-browse-adf-hx-poc');
  await h.expectVisible('a document list is present', 'hxp-document-list');

  // No synthetic identifier on the landing screen. The folder header renders
  // `sys_typeLabel ?? sys_primaryType`, and with the synthetic root unlabelled this read
  // "Repository / SysRoot". Asserted on the header alone so a `SysRoot` elsewhere in the page
  // cannot mask it.
  const folderHeaderText = await page
    .locator('hxp-folder-header')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    'the folder header shows no internal Sys* identifier',
    folderHeaderText.length > 0 && !/\bSys[A-Z]/.test(folderHeaderText),
    `folder header read ${JSON.stringify(folderHeaderText.slice(0, 120))}`,
  );

  // Scoped to the list's own table so the surrounding chrome cannot contribute a
  // string. Header cells holding a control are excluded: the settings cell's
  // textContent is a Material icon ligature, which an earlier capture in this repo
  // duly asserted as a column called "tune".
  // Two selectors because this file spans the swap. The hand-written list rendered a
  // plain `<table>`; upstream's renders adf-core's DataTable, whose header cells are
  // `.adf-datatable-cell-header-content` divs. Asserting both keeps the before and after
  // comparable on the thing that matters — the column set — rather than on markup that
  // was always going to change.
  const headers = () =>
    page.$$eval(
      'hxp-document-list table thead th, hxp-document-list .adf-datatable-cell-header-content',
      (cells) =>
        cells
          .filter((c) => !c.querySelector('button, mat-icon, .mat-icon, input'))
          .map((c) => (c.textContent ?? '').trim())
          // An untranslated key appears here if adf-core's catalogue has not loaded; it is
          // not a column, and filtering it keeps this assertion about columns.
          .filter((t) => t.length > 0 && !t.startsWith('ADF-DATATABLE.')),
    );

  const rendered = await headers();
  h.check(
    'column headers match the packaged set, in order',
    JSON.stringify(rendered) === JSON.stringify(EXPECTED_HEADERS),
    `expected ${JSON.stringify(EXPECTED_HEADERS)}, rendered ${JSON.stringify(rendered)}`,
  );

  const rowTitles = await page.$$eval(
    // adf-core marks the header with `adf-datatable-row` too, so it has to be excluded
    // or the header counts as a data row — the first run of this assertion reported one
    // row whose text was the select-all accessibility label.
    'hxp-document-list tbody tr, hxp-document-list adf-datatable-row:not(.adf-datatable-header *):not(.adf-datatable-header)',
    (rows) => rows.map((r) => (r.textContent ?? '').trim().slice(0, 40)).filter(Boolean),
  );
  h.check(
    'real Nuxeo children are listed',
    rowTitles.some((t) => t.includes('Default domain')),
    `rendered ${rowTitles.length} row(s): ${JSON.stringify(rowTitles.slice(0, 4))}`,
  );
  await h.screenshot('document-list');

  await h.step('Fixed: the column sort reaches the server, and the list pages');
  // Two of the five recorded bridge defects, both previously reported as closed and neither of
  // which was. `(sortingClicked)` went nowhere, so clicking a header reordered only the loaded
  // rows — measured at 37 before and after with no refetch — and the fetch took a hardcoded
  // `limit: 50` with no pager.
  const listRowTitles = () =>
    page.$$eval('hxp-document-list adf-datatable-row:not(.adf-datatable-header)', (rows) =>
      rows.map((r) => (r.textContent ?? '').trim().slice(0, 24)).filter(Boolean),
    );

  // Every `@children` request this step causes, so the sort can be proved at the wire rather than
  // inferred from what the rows look like.
  const childrenRequests = [];
  const recordChildren = (request) => {
    if (!request.url().includes('/@children')) return;
    // URL *and* headers: Nuxeo takes the sort as query params and the enrichers as a header, so a
    // check that looks only at the URL cannot see the enricher. The first version of this step did
    // exactly that and reported the enricher missing while it was being sent.
    childrenRequests.push({ url: request.url(), headers: request.headers() });
  };
  page.on('request', recordChildren);

  await h.goTo(`/#/browse-adf-hx?path=${encodeURIComponent('/default-domain/workspaces')}`);
  await page.waitForTimeout(2500);

  const pagerRange = () =>
    page
      .locator('hxp-browse-pager .hxp-pager__range')
      .first()
      .innerText()
      .catch(() => '');

  h.check('a pager is present', (await page.locator('hxp-browse-pager').count()) > 0);
  const firstPage = await listRowTitles();
  const firstRange = await pagerRange();
  h.check(
    'the pager reports a range, and no total Nuxeo did not give',
    /^\d+–\d+$/.test(firstRange.trim()) || /^\d+–\d+ of \d+$/.test(firstRange.trim()),
    `pager read ${JSON.stringify(firstRange)} — "1–50 of 50" would mean the page length is being ` +
      'reported as the total, which is the defect',
  );

  // Sorting: ask for descending title and require the *server* to have reordered, which shows up
  // as a different first row than the ascending default.
  const titleHeader = page.locator('hxp-document-list .adf-datatable-cell-header-content').first();
  await titleHeader.click();
  await page.waitForTimeout(2500);
  const sortedPage = await listRowTitles();
  h.check(
    'clicking a column header reorders the list',
    sortedPage.length > 0 && JSON.stringify(sortedPage) !== JSON.stringify(firstPage),
    `before ${JSON.stringify(firstPage.slice(0, 3))} after ${JSON.stringify(sortedPage.slice(0, 3))}`,
  );
  // The load-bearing half, and asserted at the wire. adf-core's DataTable *also* sorts the loaded
  // page client-side, so a reordered list on its own does not prove the server was asked — that is
  // exactly what made this defect look fixed. A `sortBy` in a `@children` URL does prove it.
  page.off('request', recordChildren);
  // The permissions enricher, asserted at the wire for the same reason as the sort: the mapped
  // `sys_effectivePermissions` is invisible in the DOM, and without the enricher every row's
  // permission list is `undefined`, which upstream reads as no permission at all.
  h.check(
    'the children request asks Nuxeo for real permissions',
    childrenRequests.some((r) => (r.headers['enrichers.document'] ?? '').includes('permissions')),
    `${childrenRequests.length} @children request(s); last enrichers.document header: ` +
      JSON.stringify(childrenRequests.at(-1)?.headers['enrichers.document'] ?? null),
  );

  const sortedRequests = childrenRequests.filter((r) => r.url.includes('sortBy='));
  h.check(
    'a @children request carried sortBy, so the server did the ordering',
    sortedRequests.length > 0,
    `${childrenRequests.length} @children request(s), none with sortBy: ` +
      JSON.stringify(childrenRequests.slice(-2).map((r) => r.url)),
  );
  h.check(
    'the sort field is a Nuxeo property, not an HxPR key',
    sortedRequests.some((r) => /sortBy=dc(%3A|:)/.test(r.url)),
    `sorted request URLs: ${JSON.stringify(sortedRequests.slice(-2).map((r) => r.url))}`,
  );
  h.check(
    'the sorted list is not empty — an unmappable sortBy makes Nuxeo answer 200 with no entries',
    (await page.locator('hxp-document-list adf-datatable-row').count()) > 1,
  );
  await h.screenshot('sorted-list');

  await h.step('Upstream capability: rows are selectable');
  // What the swap *gains*. The hand-written list had its own checkbox column; upstream's
  // DataTable provides multiselect natively, which is why `[multiselect]="true"` is set.
  const rowCheckboxes = page.locator('hxp-document-list adf-datatable-row mat-checkbox');
  const checkboxCount = await rowCheckboxes.count();
  h.check('every row offers a selection checkbox', checkboxCount >= 2, `found ${checkboxCount}`);
  // Actually select one, and assert the checkbox reports itself checked. The first version of
  // this step screenshotted the untouched list, so `row-selection.png` was byte-identical to
  // `document-list.png` — the screenshot audit caught it. A picture of an unselected list is
  // not evidence that selection works.
  await rowCheckboxes
    .nth(1)
    .click()
    .catch(() => {}); // a click that cannot land fails the checked-count assertion below
  await page.waitForTimeout(500);
  const selectedCount = await page
    .locator('hxp-document-list adf-datatable-row mat-checkbox.mat-mdc-checkbox-checked')
    .count();
  h.check(
    'clicking a row checkbox selects that row',
    selectedCount === 1,
    `${selectedCount} checked`,
  );
  await h.screenshot('row-selection');
  // Cleared again, so the steps below start from a known empty selection rather than
  // inheriting this one.
  await rowCheckboxes
    .nth(1)
    .click()
    .catch(() => {}); // best-effort reset; the later steps select their own rows
  await page.waitForTimeout(300);

  await h.step('adf-core strings are translated, not raw keys');
  // adf-core ships its own catalogue and this app has to serve it. Without the asset glob
  // the DataTable renders `ADF-DATATABLE.ACCESSIBILITY.SELECT_ALL` to screen readers.
  const rawKeys = await page.$$eval('hxp-document-list', (roots) =>
    roots.flatMap((r) => (r.textContent ?? '').match(/ADF-[A-Z-]+\.[A-Z_.]+/g) ?? []),
  );
  h.check(
    'no untranslated adf-core keys are rendered',
    rawKeys.length === 0,
    `found ${rawKeys.length}: ${JSON.stringify(rawKeys.slice(0, 3))}`,
  );

  await h.step('Upstream breadcrumb renders, and its links point at OUR routes');
  // The interesting part is not that it renders. adf-hx's own `DocumentRouterService` builds
  // `/{repository}/documents/{id}`, which this app has no route for, and the breadcrumb feeds
  // that straight into `[routerLink]`. `NuxeoDocumentRouterService` is bound against it, so
  // the assertion is on the hrefs the crumbs actually carry.
  // Since 2026-09-23 the page feeds upstream's inner `hxp-ui-breadcrumb` the ancestors **plus the
  // folder itself**, as production browse shows: `hxp-breadcrumb` alone never rendered the current
  // folder and left its parent unlinked. `/default-domain/workspaces` therefore gives
  // Home › Domain › Workspaces, with the first two linked and the last marked as the location.
  await h.goTo('/#/browse-adf-hx?path=%2Fdefault-domain%2Fworkspaces');
  await page.waitForTimeout(2000);
  await h.expectVisible('upstream breadcrumb rendered', 'hxp-ui-breadcrumb');
  const crumbHrefs = await page.$$eval('hxp-ui-breadcrumb a[href]', (as) =>
    as.map((a) => a.getAttribute('href') ?? ''),
  );
  // This check used to accept any href containing `browse-adf-hx`, and so passed while every
  // crumb but Home pointed at `browse-adf-hx%3Fpath%3D…` — a route that does not exist, because a
  // string bound to `[routerLink]` has its `?` escaped. It now requires the query to survive.
  h.check(
    'every breadcrumb link carries the path as a real query parameter',
    crumbHrefs.length === 2 &&
      crumbHrefs.every((href) => href.includes('browse-adf-hx') && !/%3F/i.test(href)) &&
      crumbHrefs.some((href) => href.includes('?path=')),
    `hrefs were ${JSON.stringify(crumbHrefs)}`,
  );
  const lastCrumb = await page
    .locator('hxp-ui-breadcrumb a[aria-current="location"]')
    .first()
    .evaluate((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href') }))
    .catch(() => null); // no current-location crumb fails the check below, with this in its detail
  h.check(
    'the folder on screen is the last crumb, marked as the location and not linked',
    lastCrumb !== null && /workspaces/i.test(lastCrumb.text) && !lastCrumb.href,
    `last crumb was ${JSON.stringify(lastCrumb)}`,
  );
  h.check(
    "no link points at upstream's /{repository}/documents/ shape",
    !crumbHrefs.some((href) => href.includes('/documents/')),
    `hrefs were ${JSON.stringify(crumbHrefs.slice(0, 4))}`,
  );
  await h.screenshot('upstream-breadcrumb');

  await h.step('Rehomed: the column picker is back, and driven by Layer 1');
  // Upstream's DataTable has no picker. Losing it would have been a silent regression, so
  // it moved to the host. Asserting it here is what makes "rehomed" a fact.
  const columnsBtn = page.locator('button[aria-label="Manage columns"]').first();
  h.check('a column-settings control exists', (await columnsBtn.count()) > 0);
  await columnsBtn.click().catch(() => {});
  await page.waitForTimeout(600);
  const pickerText = await page
    .locator('hxp-column-picker [aria-label="Column Settings"]')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    'the picker offers a column that ships hidden',
    pickerText.includes('Version'),
    `picker text was ${JSON.stringify(pickerText.slice(0, 140))}`,
  );
  h.check(
    'the picker lists every packaged column, not just the visible ones',
    pickerText.includes('Coverage') && pickerText.includes('Subjects'),
    `picker text was ${JSON.stringify(pickerText.slice(0, 200))}`,
  );
  await h.screenshot('column-picker');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await h.step('Rehomed: the card view renders with thumbnails');
  // By accessible name. The toggle is icon-only, so filtering on text finds nothing —
  // the first draft of this step did exactly that and reported zero cards.
  const cardToggle = page.locator('button[aria-label="Card view"]').first();
  h.check('a card-view toggle exists', (await cardToggle.count()) > 0);
  await cardToggle.click().catch(() => {});
  await page.waitForTimeout(1500);
  const cards = page.locator('hxp-document-cards .hxp-doc-card');
  const cardCount = await cards.count();
  h.check('card view renders a card per document', cardCount >= 1, `found ${cardCount}`);
  await h.screenshot('card-view');

  await h.step('Upstream document tree mounts in the shell nav drawer');
  // The tree lives in the **app shell's** nav drawer, not the POC page, and only mounts when
  // the route is entered through the platform nav item — the shell owns the drawer state, so
  // a direct `goTo` renders the page without one. Section 3 records that.
  await h.goTo('/#/browse');
  await page.waitForTimeout(1200);
  const navEntry = page
    .locator('a,button')
    .filter({ hasText: /adf-hx/i })
    .first();
  h.check('platform nav offers the adf-hx entry', (await navEntry.count()) > 0);
  await navEntry.click().catch(() => {});
  await page.waitForTimeout(3000);
  await h.expectVisible('nav drawer mounted', 'hxp-browse-nav-drawer');
  await h.expectVisible('upstream document tree rendered', 'hxp-document-tree');

  // A tree that renders no nodes is the failure this replaces a working component with, so
  // the node count is the load-bearing assertion rather than the element's presence.
  const treeNodes = await page.$$eval(
    'hxp-browse-nav-drawer hxp-document-tree [role="treeitem"], hxp-browse-nav-drawer hxp-document-tree mat-tree-node',
    (nodes) => nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean),
  );
  h.check(
    'the tree renders real Nuxeo folders',
    treeNodes.length > 0,
    `found ${treeNodes.length}: ${JSON.stringify(treeNodes.slice(0, 4))}`,
  );
  await h.screenshot('upstream-document-tree');

  await h.step('Fixture: a document with two known Nuxeo versions');
  // Built by the step rather than assumed to exist, so the version *labels* below are
  // deterministic. A fixture left over from a previous run would have grown to 0.3, 0.4 …
  // and an assertion loose enough to tolerate that would no longer be asserting the
  // major/minor composition — the one part of the mapping Nuxeo does not answer directly.
  const fixture = await createVersionedFixture(page, h);
  h.check(
    'fixture document has two versions in Nuxeo',
    fixture.versionCount === 2,
    `Document.GetVersions reported ${fixture.versionCount} version(s) for ${fixture.uid}`,
  );

  await h.step('Folder tabs match production browse');
  await h.goTo(`/#/browse-adf-hx?path=${encodeURIComponent(FIXTURE_FOLDER_PATH)}`);
  await page.waitForTimeout(2000);

  // Properties and Versions were tabs here until 2026-09-23, hosting upstream's properties and
  // versions panels. Both belong to one document, and production browse keeps them on the
  // document page, so the folder tab strip is asserted as an ordered equality against its four.
  //
  // Labels are read and compared rather than matched by an anchored regex: Playwright tests a
  // regex against the raw `textContent`, and the template puts each label on its own line.
  const tabLabels = await page.$$eval('hxp-browse-tabs [role="tab"]', (els) =>
    els.map((el) => (el.textContent ?? '').trim()),
  );
  const EXPECTED_TABS = ['View', 'Permissions', 'History', 'Trash'];
  h.check(
    "the tab strip is exactly production browse's four folder tabs",
    JSON.stringify(tabLabels) === JSON.stringify(EXPECTED_TABS),
    `tab strip rendered ${JSON.stringify(tabLabels)}`,
  );
  // Negative, so conjoined with a non-empty strip: an unrendered strip has no Versions tab either.
  h.check(
    'no per-document panel is rendered on the folder page',
    tabLabels.length > 0 &&
      (await page.locator('hxp-manage-versions-sidebar, hxp-properties-sidebar').count()) === 0,
  );
  await h.screenshot('folder-tabs');

  // The viewer step below acts on a selected document, so select the fixture row here.
  const fixtureRow = page
    .locator('hxp-document-list adf-datatable-row')
    .filter({ hasText: FIXTURE_DOC_TITLE })
    .first();
  h.check('the fixture document is listed', (await fixtureRow.count()) > 0, FIXTURE_DOC_TITLE);
  await fixtureRow.locator('mat-checkbox').first().click();
  await page.waitForTimeout(600);

  await h.step('Adopted: upstream document viewer');
  // Load-bearing: the fixture's own text on screen. Opening the overlay and finding the component
  // were the only checks here once, and both passed while the viewer said "Couldn't load preview"
  // for every file, because nothing mapped the main file to `sysfile_blob`.
  const previewBtn = page.locator('.hxp-browse-page__preview-btn');
  h.check('a Preview button appears for the selected document', (await previewBtn.count()) > 0);

  if ((await previewBtn.count()) > 0) {
    await previewBtn.click();
    await page.waitForTimeout(4000);

    const viewerOverlay = page.locator('mat-dialog-container .hxp-viewer-overlay');
    h.check(
      'clicking Preview opens the viewer in a dialog',
      (await viewerOverlay.isVisible()) === true,
    );

    const renderedText = await viewerOverlay.innerText().catch(() => '');
    h.check(
      "the viewer renders the fixture file's own text",
      renderedText.includes(FIXTURE_FILE_TEXT),
      `viewer read ${JSON.stringify(renderedText.replace(/\s+/g, ' ').slice(0, 160))}`,
    );
    h.check(
      'the viewer does not report an unsupported file',
      (await viewerOverlay.locator('adf-viewer-unknown-format').count()) === 0,
    );

    // The shell's selection bar is on screen, because previewing needs a ticked row. The viewer
    // must be above it, or the bar covers the viewer's close button.
    const closeButton = viewerOverlay.getByRole('button', { name: 'Close', exact: true });
    const closeOnTop = await closeButton
      .evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.width > 0 && button.contains(hit);
      })
      .catch(() => false);
    h.check("the viewer's close button is visible and not covered", closeOnTop);

    await h.screenshot('document-viewer');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    h.check('pressing Escape closes the viewer', (await viewerOverlay.count()) === 0);

    await previewBtn.click();
    await page.waitForTimeout(3000);
    await closeButton.click();
    await page.waitForTimeout(1500);
    h.check("the viewer's close button closes it", (await viewerOverlay.count()) === 0);
  }

  await h.step('Health');
  // sys_acl assertions - principal lookups are async and complete after the folder reads above
  h.check(
    'the bridge probes the directory to classify ACL principals',
    principalLookups.some((url) => /\/group\//.test(url)),
    `${principalLookups.length} principal lookup(s): ${JSON.stringify(principalLookups.slice(0, 4))}`,
  );
  const distinctPrincipals = new Set(principalLookups);
  // Informational: the test loads multiple documents, and each probe tries /group/ then /user/, so
  // 2× the distinct count is expected minimum. The exact ratio depends on how many documents are
  // loaded and whether they share principals.
  h.note(
    `${principalLookups.length} principal lookup(s) for ${distinctPrincipals.size} distinct principal(s) — ` +
      `ratio ${(principalLookups.length / distinctPrincipals.size).toFixed(1)}:1 ` +
      `(2.0:1 means perfect caching with group-then-user probes)`,
  );
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    'card view, thumbnails and the error/retry state — rendered by the hand-written ' +
      'component today and not covered here; they must be asserted before it is deleted',
  );
}
