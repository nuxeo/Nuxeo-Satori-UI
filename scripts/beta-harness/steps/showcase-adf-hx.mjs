/**
 * Showcase capture — what adf-hx looks like inside the agentic UI.
 *
 * Not a phase gate. This produces presentation-quality screenshots for the RFC,
 * Confluence and stakeholder walkthroughs, paired with the production browse
 * screen so the two UI stacks can be compared side by side.
 *
 * Run:
 *   npm run beta:evidence -- showcase-adf-hx
 */

/**
 * The last two are the tolerant configuration load working as designed: under
 * `nx serve` nothing answers `agentic-ui-config/*` unless a developer has put a
 * file there, and the browser logs the 404 regardless of the application handling
 * it. `phase-1-config.mjs` asserts the
 * present and absent cases separately.
 */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/**
 * Click a tab in the adf-hx tab strip by visible label.
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function openTab(page, label) {
  const tab = page
    .locator('hxp-browse-tabs button')
    .filter({ hasText: new RegExp(label, 'i') })
    .first();
  if ((await tab.count()) === 0) return false;
  await tab.click();
  await page.waitForTimeout(2500);
  return true;
}

/**
 * Open a tab and assert its panel rendered.
 *
 * Both checks are recorded unconditionally. Guarding the panel assertion behind
 * the tab-opened result would let a missing tab record one failure where two
 * expectations went unmet, understating the damage.
 *
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 * @param {string} label tab label to click
 * @param {string} name human name used in check titles
 * @param {string} panel selector for the panel the tab should render
 */
async function openTabAndAssert(page, h, label, name, panel) {
  const opened = await openTab(page, label);
  h.check(`${name} tab opened`, opened);
  const rendered = await page
    .locator(panel)
    .first()
    .isVisible()
    .catch(() => false);
  h.check(`${name} panel rendered`, rendered, `${panel} was not visible`);
  if (rendered) {
    await h.screenshot(`adf-hx-${name}`);
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
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
  await h.step('Agentic UI — production browse, built on Satori and Angular Material');
  await h.login();
  await h.goTo('/#/browse/default-domain');
  await h.expectVisible('production browse rendered', 'lib-browse');
  await h.expectText('folder content listed', 'lib-browse', 'Workspaces');
  await h.screenshot('agentic-ui-production-browse');

  await h.step('adf-hx POC — the same folder through hxp components');
  await h.goTo('/#/browse-adf-hx?path=%2Fdefault-domain');
  await h.expectVisible('POC page rendered', 'lib-browse-adf-hx-poc');
  await h.expectText('same folder, different stack', 'hxp-document-list', 'Workspaces');
  await h.expectText('templates listed too', 'hxp-document-list', 'Templates');
  await h.screenshot('adf-hx-browse-list');

  await h.step('adf-hx card view');
  const cardToggle = page.locator('hxp-browse-toolbar button[aria-label="Card view"]');
  h.check('the card-view toggle is present in the toolbar', (await cardToggle.count()) === 1);
  // Selectors updated for the adf-hx adoption. The list is upstream's DataTable now, whose
  // rows are `adf-datatable-row` and whose header is one of them, and the card view moved out
  // of `hxp-document-list` into its own `hxp-document-cards`. This step previously asserted
  // the hand-written markup and went red the moment that component was deleted — a stale
  // assertion, not a regression.
  const dataRows = () =>
    page
      .locator('hxp-document-list adf-datatable-row')
      .count()
      .then((n) => Math.max(0, n - 1));
  const rowsBefore = await dataRows();
  await cardToggle.click();
  await page.waitForTimeout(2000);
  const listAfter = await page.locator('hxp-document-list').count();
  const cards = await page.locator('hxp-document-cards .hxp-doc-card').count();
  h.check(
    'the toggle really switches the list for a card grid',
    rowsBefore > 0 && listAfter === 0 && cards === rowsBefore,
    `${rowsBefore} table row(s) before, ${listAfter} list(s) after, ${cards} card(s) rendered`,
  );
  await h.expectText('the same folder content is still listed', 'hxp-document-cards', 'Workspaces');
  await h.screenshot('adf-hx-card-view');

  await h.step('adf-hx folder header and toolbar');
  await h.goTo('/#/browse-adf-hx?path=%2Fdefault-domain');
  await h.expectVisible('folder header', 'hxp-folder-header');
  await h.screenshot('adf-hx-folder-header', page.locator('hxp-folder-header'));
  const toolbar = page.locator('hxp-browse-toolbar');
  h.check('toolbar present', (await toolbar.count()) > 0);
  if (await toolbar.count()) {
    await h.screenshot('adf-hx-toolbar', toolbar);
  }

  await h.step('adf-hx navigation drawer and folder tree');
  await h.goTo('/#/browse');
  const navEntry = page
    .locator('a,button')
    .filter({ hasText: /adf-hx/i })
    .first();
  h.check('platform nav entry present', (await navEntry.count()) > 0);
  await navEntry.click();
  await page.waitForTimeout(3500);
  await h.expectVisible('nav drawer mounted', 'hxp-browse-nav-drawer');
  await h.screenshot('adf-hx-nav-drawer');

  await h.step('adf-hx tab strip — View, Permissions, History, Trash');
  await h.expectVisible('tab strip present', 'hxp-browse-tabs');
  await h.screenshot('adf-hx-tabs', page.locator('hxp-browse-tabs'));

  await h.step('Permissions tab reads real Nuxeo ACLs');
  // Upstream's own panel now, not the hand-written table this asserted before. Same stale-selector
  // situation as the card-view step above: the assertion named a component that no longer exists,
  // so it would have gone red for the deletion rather than for a regression.
  await openTabAndAssert(page, h, 'Permission', 'permissions', 'hxp-permissions-management-panel');

  await h.step('History tab reads the real Nuxeo audit log');
  await openTabAndAssert(page, h, 'History', 'history', 'hxp-browse-history');

  await h.step('Trash tab queries trashed children');
  await openTabAndAssert(page, h, 'Trash', 'trash', 'hxp-browse-trash');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
