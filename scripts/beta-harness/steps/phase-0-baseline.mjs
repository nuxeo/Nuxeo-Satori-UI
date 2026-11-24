/**
 * Phase 0 — authenticated baseline against a live Nuxeo instance.
 *
 * Captures the state of the application before any Beta work begins, so later
 * phases have something to be compared against. Everything asserted here is
 * expected to pass on the current branch; if it does not, Phase 0 has found a
 * real regression and the plan should not proceed past it.
 *
 * The browse surfaces are the Satori browse page. The adf-hx POC route and its
 * components were removed (NXSAT-635, NXSAT-637), and `/#/browse-adf-hx` now
 * redirects to `/#/browse`, so the original checks against `hxp-*` elements could
 * not run.
 *
 * Two things learned while first running this, both encoded below:
 *
 * 1. The nav drawer and folder tree mount only when the route is entered through
 *    the platform nav item, because the shell owns the drawer state. Navigating
 *    straight to the URL renders the page without a drawer, so the tree is
 *    asserted after entering through the nav.
 * 2. This Nuxeo instance does not provide the `AI.Insights` automation operation,
 *    and the app probes `/nuxeo/logout` on boot. Both surface as console errors
 *    unrelated to browse, so they are ignored explicitly and still counted.
 *
 * Prerequisites:
 *   docker start nuxeo          (container `nuxeo`, published on 8080)
 *   npx nx serve nuxeo-ui       (separate terminal)
 *
 * Run:
 *   npm run beta:evidence -- phase-0-baseline
 */

/**
 * Errors this environment always produces, unrelated to the browse surfaces.
 * `AI.*` operations come from a marketplace package that is not installed on a
 * plain local Nuxeo, and the app probes `/nuxeo/logout` on boot.
 *
 * The configuration fetches are also listed. With no file under
 * `agentic-ui-config/`, the app falls back to the packaged default by design, and
 * `phase-1-config` asserts that fallback directly. Suppressing these is safe here
 * because the nav checks below are fed by the packaged default, so a default that
 * had not loaded would fail them rather than pass quietly.
 */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Application loads and authenticates against live Nuxeo');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');
  // Who the run signed in as is checked by the identity guard at the next boundary (NXSAT-643).
  await h.screenshot('app-shell');

  await h.step('Browse renders real repository content');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await page.waitForSelector('nxs-document-list tr.nxs-document-list__row', { timeout: 120000 });
  await h.expectText('repository content listed', 'lib-browse', 'Domain');
  await h.screenshot('browse-root');

  await h.step('A folder lists its children with real contributors');
  await h.goTo('/#/browse/default-domain/workspaces');
  await h.expectVisible('document list rendered', 'nxs-document-list');
  // Whether the folder is empty comes from Nuxeo, not from the page. Rows that never render are
  // then a failure to list, not a missing precondition.
  const children = await page.request.get(`${h.baseUrl}/nuxeo/api/v1/path/default-domain/workspaces/@children?pageSize=1`, { failOnStatusCode: false });
  // A failed request is a failure, not an empty folder: only a successful answer of zero is a precondition.
  h.check('the server answers the children request', children.ok(), `HTTP ${children.status()}`);
  const serverCount = children.ok() ? (await children.json()).resultsCount : -1;
  h.requirePrecondition(
    'the Workspaces folder has children on the server',
    serverCount !== 0,
    'the server reports no children, so there is nothing to list and the contributor check cannot run',
  );
  const folderRows = await page
    .waitForSelector('nxs-document-list tr.nxs-document-list__row', { timeout: 120000 })
    .then(() => true, () => false);
  h.check('the folder lists the children Nuxeo reports', folderRows, `server reports ${serverCount} child(ren)`);  const headers = await page.$$eval('nxs-document-list thead th', (cells) =>
    cells.map((c) => (c.textContent ?? '').trim()).filter(Boolean),
  );
  h.check(
    'the Last Contributor column is present',
    headers.includes('Last Contributor'),
    `headers were ${JSON.stringify(headers)}`,
  );
  await h.expectText('Last Contributor column populated', 'nxs-document-list', 'Administrator');
  await h.screenshot('folder-children');

  await h.step('Folder tabs render');
  const tabLabels = await page.$$eval('[role="tab"]', (els) =>
    els.map((el) => (el.textContent ?? '').trim()).filter(Boolean),
  );
  h.check(
    'the folder tab strip is the four folder tabs',
    JSON.stringify(tabLabels) === JSON.stringify(['View', 'Permissions', 'History', 'Trash']),
    `tab strip rendered ${JSON.stringify(tabLabels)}`,
  );
  await h.screenshot('folder-tabs');

  await h.step('Nav drawer and folder tree mount when entered via platform nav');
  // Clicking the Browse entry while already on /browse collapses the drawer, so enter from another
  // page the way a user does.
  await h.goTo('/#/search');
  await page.waitForTimeout(1500);
  const navEntry = page.locator('sat-platform-nav a').filter({ hasText: 'Browse' }).first();
  h.check('platform nav offers the Browse entry', (await navEntry.count()) > 0);
  await navEntry.click();
  // The tree fills after its own request, so wait for its first node rather than for a fixed time.
  await page.waitForFunction(
    () => document.querySelectorAll('nxs-document-tree [role="treeitem"], nxs-document-tree mat-tree-node').length > 0,
    null,
    { timeout: 120000 },
  ).catch(() => {});
  // Visibility of a node, not the width of the drawer: a closed Material sidenav keeps its width.
  const firstNode = page.locator('nxs-document-tree [role="treeitem"], nxs-document-tree mat-tree-node').first();
  h.check('the nav drawer is open: its first tree node is visible', await firstNode.isVisible().catch(() => false));
  const treeNodes = await page.$$eval(
    'nxs-document-tree [role="treeitem"], nxs-document-tree mat-tree-node',
    (nodes) => nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean),
  );
  h.check(
    'the folder tree renders real Nuxeo folders',
    treeNodes.length > 0,
    `found ${treeNodes.length}: ${JSON.stringify(treeNodes.slice(0, 4))}`,
  );
  await h.screenshot('nav-drawer-tree');

  await h.step('Baseline health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
