/**
 * Pilot — browse document-list columns become Layer 1 addressable.
 *
 * The `documentList` slot and `ExtensionColumnDescriptor` both existed while
 * **nothing registered or read them**. `AGENTS/11-beta-program.md` section 3 says
 * "a slot id existing does not mean anything reads it… Do not describe a reserved
 * id as an extension point." This proves it is now one, against a real browser and
 * a real manifest response rather than a unit test's `TestBed`.
 *
 * What each step asserts is the **rendered `<th>` text of the browse table**, in
 * order. That is the thing a customer sees. Asserting the component's `columns()`
 * signal would pass even if the template ignored it, which is precisely the class
 * of gap that let Phase 1 ship a dead feature.
 *
 * Prerequisites:
 *   npm run beta:backend
 *   npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run beta:evidence -- pilot-documentlist-columns
 */

import { configResponse } from '../config-response.mjs';

const MANIFEST_ROUTE = '**/agentic-ui-config/manifest.json';

/**
 * The columns browse rendered by default before this change, transcribed from
 * `ALL_COLUMNS` in `column-settings-dialog.ts`: the four with `visible: true`.
 *
 * An ordered equality, not a count — a reorder or a relabel must fail this.
 */
const PACKAGED_VISIBLE = ['Title', 'Modified', 'Last Contributor'];

const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/** The configuration servlet's manifest response, with one customer package contributing `extensions`. */
function manifestDocument(extensions) {
  return configResponse('manifest', { customer: [{ version: 1, extensions }] });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Precondition: a backend is reachable, so browse renders real rows');
  const probe = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/me`, { failOnStatusCode: false })
    .catch(() => null);
  h.requirePrecondition(
    'Nuxeo API answers through the dev proxy',
    probe?.status() === 200,
    `/nuxeo/api/v1/me returned ${probe?.status() ?? 'no response'} — an empty table has no column headers ` +
      'to assert. Run `npm run beta:backend` first.',
  );

  /** `null` answers 404, as a server with no configuration service does. */
  let manifestBody = null;
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: manifestBody === null ? 404 : 200,
      contentType: 'application/json',
      // Without `no-store` the browser answers the second load from cache and
      // the interception is never seen — section 3 records this trap.
      headers: { 'cache-control': 'no-store' },
      body: manifestBody ?? 'Not Found',
    }),
  );

  /**
   * The rendered column headers of the browse table, in document order.
   *
   * Scoped to the table header so the surrounding chrome — filter labels, the
   * breadcrumb, the details panel — cannot contribute a string and make an
   * assertion pass for the wrong reason.
   *
   * Header cells containing a control are excluded. The last `<th>` holds the
   * column-settings button, and its `textContent` is the Material icon ligature
   * `tune`, which the first run of this file duly asserted as a column called
   * "tune". A cell that holds a button is a control, not a column.
   */
  const renderedHeaders = () =>
    page.$$eval('lib-browse table thead th', (cells) =>
      cells
        .filter((c) => !c.querySelector('button, mat-icon, .mat-icon'))
        .map((c) => (c.textContent ?? '').trim())
        .filter((t) => t.length > 0),
    );

  /** Apply a Layer 1 config and force a real reload so `APP_INITIALIZER` re-runs. */
  const applyManifest = async (extensions) => {
    manifestBody = extensions === null ? null : manifestDocument(extensions);
    // A real reload, not `goto('/#/...')`: `withHashLocation()` makes that
    // same-document, so the config would never be re-read.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  };

  await h.step('Default: the packaged columns render exactly as before Layer 1');
  await h.login();
  // A user preference would mask the packaged defaults, and a previous capture on
  // this origin may have left one behind.
  await page.evaluate(() => localStorage.removeItem('browse_column_settings'));
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  await h.expectVisible('browse table rendered', 'lib-browse table thead th');
  const packaged = await renderedHeaders();
  h.check(
    'rendered headers reproduce the pre-Layer-1 set, in order',
    JSON.stringify(packaged) === JSON.stringify(PACKAGED_VISIBLE),
    `expected ${JSON.stringify(PACKAGED_VISIBLE)}, rendered ${JSON.stringify(packaged)}`,
  );
  await h.screenshot('columns-packaged-default');

  await h.step('A manifest relabels a column, with no rebuild');
  await applyManifest({
    overrides: { 'app.documentList.lastContributor': { label: 'Last edited by' } },
  });
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const relabelled = await renderedHeaders();
  h.check(
    'the relabelled header text is rendered',
    relabelled.includes('Last edited by'),
    `rendered ${JSON.stringify(relabelled)}`,
  );
  h.check(
    'the original label is gone',
    !relabelled.includes('Last Contributor'),
    `rendered ${JSON.stringify(relabelled)}`,
  );
  await h.screenshot('columns-manifest-relabelled');

  await h.step('A manifest hides a column');
  await applyManifest({ overrides: { 'app.documentList.modified': { visible: false } } });
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const hidden = await renderedHeaders();
  h.check(
    'the hidden column is not rendered',
    !hidden.includes('Modified'),
    `rendered ${JSON.stringify(hidden)}`,
  );
  h.check(
    'the remaining columns keep their order',
    JSON.stringify(hidden) === JSON.stringify(['Title', 'Last Contributor']),
    `expected ["Title","Last Contributor"], rendered ${JSON.stringify(hidden)}`,
  );
  await h.screenshot('columns-manifest-hidden');

  await h.step('A manifest reorders columns');
  await applyManifest({ overrides: { 'app.documentList.lastContributor': { order: 5 } } });
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const reordered = await renderedHeaders();
  h.check(
    'Last Contributor is now first',
    JSON.stringify(reordered) === JSON.stringify(['Last Contributor', 'Title', 'Modified']),
    `expected ["Last Contributor","Title","Modified"], rendered ${JSON.stringify(reordered)}`,
  );
  await h.screenshot('columns-manifest-reordered');

  await h.step('A manifest switches on a column that ships hidden');
  await applyManifest({
    slots: { documentList: [{ id: 'app.documentList.version', hiddenByDefault: false }] },
  });
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const switchedOn = await renderedHeaders();
  h.check(
    'the previously hidden Version column is rendered',
    switchedOn.includes('Version'),
    `rendered ${JSON.stringify(switchedOn)}`,
  );
  await h.screenshot('columns-manifest-switched-on');

  await h.step('An absent manifest falls back to the packaged columns');
  await applyManifest(null);
  await h.goTo('/#/browse');
  await page.waitForTimeout(1500);
  const fallback = await renderedHeaders();
  h.check(
    'the packaged set is restored, in order',
    JSON.stringify(fallback) === JSON.stringify(PACKAGED_VISIBLE),
    `expected ${JSON.stringify(PACKAGED_VISIBLE)}, rendered ${JSON.stringify(fallback)}`,
  );
  h.note(
    'this screenshot is expected to be identical to the default one — the fallback ' +
      'should look like the default, so the DOM check above carries the claim, not the image',
  );
  await h.screenshot('columns-fallback-after-absent-manifest');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
