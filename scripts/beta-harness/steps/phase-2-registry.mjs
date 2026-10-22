/**
 * Phase 2 — Layer 1: extension registry.
 *
 * The claim: **a manifest edit changes the addressable surface with no rebuild,
 * and the shipped default is exactly the navigation the product intends to ship.**
 *
 * That second half used to read "reproduces today's behaviour exactly", meaning
 * the pre-Phase-2 `const`. It is no longer what the assertion establishes: the
 * packaged default now deliberately differs from that transcription by one
 * entry, so a run emitting the old wording would publish a false evidence claim
 * while passing. See `PACKAGED_NAV`.
 *
 * ## Which checks are load-bearing, and which are not
 *
 * Read the total as a mixture, not as thirty-odd equally meaningful facts.
 *
 * **Load-bearing** — these fail if the registry is not actually doing the work:
 *
 * - Step 1: the packaged nav entries, asserted by **exact id list in exact
 *   order** against the navigation the product ships. This is the "a customer
 *   who changes nothing sees what we intended" proof, and it is an equality
 *   assertion rather than a count, so a reorder or a dropped entry fails it. It
 *   is the fourteen **enabled** entries: `PACKAGED_NAV_ITEMS` holds fifteen, and
 *   the legacy `app.navbar.browse` ships `disabled` — see `PACKAGED_NAV`.
 * - Steps 4-8: hide, add, reorder, relabel and rule-gate, each asserted against
 *   the DOM after a real reload. The DOM assertions are the load-bearing part.
 *   The nine bundle digests alongside them are **not**: the dev server does not
 *   rebuild between reloads, so they pass whether or not configuration is doing
 *   anything. They rule out one specific alternative explanation — that a
 *   rebuild, not the manifest, produced the change — and nothing else. An
 *   earlier draft of this file claimed they would fail "if configuration were
 *   dead", which was untrue.
 * - Step 9: a manifest-added nav item resolves a `sidebar` component and renders
 *   real panel content. Before Phase 2 this branch could only render a
 *   placeholder, so this is the check that the nav array is no longer decorative.
 * - Step 11: the fail-open contract — an unknown rule id leaves the entry
 *   visible. The same manifest carries a second, independently observable
 *   override (Collections relabelled), so the *arrival* of the payload is proven by
 *   an effect the harness cannot fake. An earlier draft asserted the unknown
 *   rule id against the harness's own local variable, which proved only that the
 *   harness had constructed what it intended to send, and paired it with a check
 *   that Trash was visible — which is true in the packaged default. Both halves
 *   were self-confirming.
 * - Step 12: the bulk-action surface — the six packaged actions render in the
 *   markup's order, and a manifest hides one and adds another.
 *
 * **Negative / fallback** — worth keeping as regression guards, but they would
 * also pass if configuration loading were entirely inert:
 *
 * - Steps 2 and 3: production browse and the adf-hx POC route still render.
 * - Step 13: a malformed `extensions` block leaves a working application.
 * - Step 14: an absent configuration service leaves the packaged surface.
 * - Step 15: no unexpected console errors.
 *
 * That is 12 load-bearing steps and 4 negative ones. Read the check total as
 * that mixture, not as a count of equally meaningful facts.
 *
 * ## Two traps inherited from Phase 1, encoded here
 *
 * 1. `withHashLocation()` makes `page.goto('/#/x')` a same-document navigation,
 *    so `APP_INITIALIZER` does **not** re-run and swapped configuration is never
 *    fetched. Every configuration change below is followed by an explicit
 *    `reloadApp()`.
 * 2. The interception handler must be installed **before the first navigation**
 *    and answer `Cache-Control: no-store`, or the browser serves the cached
 *    response and the interception is never seen.
 *
 * ## And one Phase 1 mistake not repeated
 *
 * Phase 1 shipped a check titled "the JavaScript bundle is unchanged" that
 * compared script `src` *attributes* — in a dev build a single unhashed
 * `main.js`, so it compared `"main.js"` with `"main.js"` and would have passed
 * after a full rebuild. `bundleFingerprint()` below fetches and hashes the bytes.
 * Every "no rebuild" claim here is that digest, not a proxy for it.
 *
 * Prerequisites:
 *   docker start nuxeo          (container `nuxeo`, published on 8080)
 *   npx nx serve nuxeo-ui       (separate terminal)
 *
 * Run:
 *   npm run beta:evidence -- phase-2-registry
 */

import { createHash } from 'node:crypto';

import { configResponse } from '../config-response.mjs';

/** See `phase-1-config.mjs` — the same environmental noise, same reasons. */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

const MANIFEST_ROUTE = '**/agentic-ui-config/manifest.json';

/**
 * The navigation exactly as `PLATFORM_NAV_ITEMS` had it before Phase 2,
 * transcribed from `git show 4aae518:apps/nuxeo-ui/src/app/platform-nav-items.ts`
 * and paired with the ids Phase 2 assigned.
 *
 * Asserted as an ordered equality, which is what makes "the packaged default is
 * what we meant to ship" falsifiable rather than a count that a reorder would pass.
 *
 * **It diverges from that transcription by one entry, deliberately.** The product
 * now ships a single browse surface: `app.navbar.browse` carries `disabled: true`
 * and the adf-hx entry reads "Browse". So this list is the fourteen entries the
 * registry renders, out of fifteen registered, and the equality below proves "the
 * packaged default is what we intended to ship" rather than "nothing has changed
 * since Phase 2". Restoring the legacy entry means restoring its row here too.
 */
const PACKAGED_NAV = [
  ['app.navbar.knowledgeDiscovery', 'Knowledge Discovery'],
  ['app.navbar.dashboard', 'Dashboard'],
  ['app.navbar.browseAdfHx', 'Browse'],
  ['app.navbar.recentlyViewed', 'Recently viewed'],
  ['app.navbar.search', 'Search filters'],
  ['app.navbar.expiredQueue', 'Expired Queue'],
  ['app.navbar.assets', 'Assets'],
  ['app.navbar.tasks', 'Tasks'],
  ['app.navbar.favorites', 'Favorites'],
  ['app.navbar.collections', 'Collections'],
  ['app.navbar.personalSpace', 'Personal Space'],
  ['app.navbar.clipboard', 'Clipboard'],
  ['app.navbar.trash', 'Trash'],
  ['app.navbar.administration', 'Administration'],
];

/**
 * SHA-256 over the bytes of every script referenced by a `<script src>` tag,
 * plus their URLs. `page.request` bypasses page routes, so this reads the real
 * bundle.
 *
 * **Not** every script the page loaded: lazy chunks pulled in by a dynamic
 * `import()` never appear as a `<script src>` element, so a change confined to
 * one would not move this digest. It covers the entry bundle and the eagerly
 * referenced chunks, which is what the "no rebuild" claim needs, but the
 * stronger reading is wrong.
 *
 * @param {import('@playwright/test').Page} page
 */
async function bundleFingerprint(page) {
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')]
      .map((s) => new URL(s.getAttribute('src') ?? '', document.baseURI).href)
      .sort(),
  );
  const digest = createHash('sha256');
  let bytes = 0;
  for (const src of sources) {
    const response = await page.request.get(src, { headers: { 'cache-control': 'no-cache' } });
    const body = await response.body();
    bytes += body.length;
    digest.update(src);
    digest.update(body);
  }
  return { count: sources.length, bytes, digest: digest.digest('hex') };
}

/**
 * The rendered navigation, read from the live DOM by the id the descriptor
 * carries rather than by position, so a reorder is observable.
 *
 * @param {import('@playwright/test').Page} page
 */
function readNav(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('sat-platform-nav-list-item[data-nav-id]')].map((el) => [
      el.getAttribute('data-nav-id'),
      (el.textContent ?? '').trim(),
    ]),
  );
}

/** @param {import('@playwright/test').Page} page */
async function reloadApp(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

/** The configuration servlet's manifest response, with one customer package contributing `extensions`. */
function manifestDocument(extensions) {
  return configResponse('manifest', { customer: [{ version: 1, extensions }] });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  /** `null` answers 404, as a server with no configuration service does. */
  let manifestBody = null;

  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: manifestBody === null ? 404 : 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body:
        manifestBody === null
          ? 'Not Found'
          : typeof manifestBody === 'string'
            ? manifestBody
            : JSON.stringify(manifestBody),
    }),
  );

  /**
   * Apply a Layer 1 config, force a real reload, and assert the bundle bytes did
   * not change. Returns the rendered navigation.
   */
  const applyManifest = async (extensions, label, baseline) => {
    manifestBody = extensions === null ? null : manifestDocument(extensions);
    await reloadApp(page);
    const bundle = await bundleFingerprint(page);
    h.check(
      `${label}: the referenced bundle bytes are unchanged, ruling out a rebuild`,
      bundle.count > 0 && bundle.digest === baseline.digest,
      `bundle content hash differed:\n` +
        `  before ${baseline.digest} (${baseline.count} scripts, ${baseline.bytes} bytes)\n` +
        `  after  ${bundle.digest} (${bundle.count} scripts, ${bundle.bytes} bytes)`,
    );
    return readNav(page);
  };

  // ---------------------------------------------------------------------------
  // LOAD-BEARING: the shipped default is exactly the navigation we mean to ship.
  // ---------------------------------------------------------------------------
  await h.step('The packaged default renders exactly the navigation the product ships');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');

  const baselineBundle = await bundleFingerprint(page);
  h.check(
    'the running bundle could be fingerprinted',
    baselineBundle.count > 0 && baselineBundle.bytes > 0,
    `${baselineBundle.count} scripts, ${baselineBundle.bytes} bytes`,
  );

  const defaultNav = await readNav(page);
  h.check(
    'every nav entry carries an addressable extension id',
    defaultNav.length === PACKAGED_NAV.length,
    `rendered ${defaultNav.length} addressable entries, expected ${PACKAGED_NAV.length}`,
  );
  h.check(
    'the ids and labels match the packaged enabled set, in the same order',
    JSON.stringify(defaultNav) === JSON.stringify(PACKAGED_NAV),
    `rendered:\n  ${JSON.stringify(defaultNav)}\nexpected:\n  ${JSON.stringify(PACKAGED_NAV)}`,
  );
  await h.screenshot('default-manifest-navigation');

  // ---------------------------------------------------------------------------
  // NEGATIVE / FALLBACK: nothing that worked before is broken.
  // ---------------------------------------------------------------------------
  await h.step('Production browse is unaffected by the registry');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.expectText('repository content listed', 'lib-browse', 'Default domain');
  await h.screenshot('default-manifest-production-browse');

  await h.step('The adf-hx POC route is unaffected by the registry');
  await h.goTo('/#/browse-adf-hx');
  await h.expectVisible('POC page rendered', 'lib-browse-adf-hx-poc');
  await h.expectText('Nuxeo children listed', 'hxp-document-list', 'Default domain');
  await h.screenshot('default-manifest-adf-hx-browse');

  // ---------------------------------------------------------------------------
  // LOAD-BEARING: one capability per step, each with the bundle hash pinned.
  // ---------------------------------------------------------------------------
  await h.step('A manifest hides a navigation entry, with no rebuild');
  const hidden = await applyManifest(
    { overrides: { 'app.navbar.trash': { visible: false } } },
    'hide',
    baselineBundle,
  );
  h.check(
    'the hidden entry is gone from the DOM',
    !hidden.some(([id]) => id === 'app.navbar.trash'),
    `Trash still rendered: ${JSON.stringify(hidden)}`,
  );
  h.check(
    'exactly one entry was removed and the rest are untouched',
    JSON.stringify(hidden) ===
      JSON.stringify(PACKAGED_NAV.filter(([id]) => id !== 'app.navbar.trash')),
    `rendered: ${JSON.stringify(hidden)}`,
  );
  await h.screenshot('manifest-hides-nav-entry');

  await h.step('A manifest adds a navigation entry, with no rebuild');
  const added = await applyManifest(
    {
      slots: {
        navbar: [
          {
            id: 'acme.navbar.contracts',
            label: 'Contracts',
            path: '/browse/default-domain',
            icon: 'folder',
            order: 35,
          },
        ],
      },
    },
    'add',
    baselineBundle,
  );
  h.check(
    'the added entry is rendered with its configured label',
    added.some(([id, label]) => id === 'acme.navbar.contracts' && label === 'Contracts'),
    `rendered: ${JSON.stringify(added)}`,
  );
  h.check(
    // `order: 35` used to land between the legacy Browse entry (30) and the
    // adf-hx one (40). With Browse disabled its left-hand neighbour is Dashboard,
    // which is the point of spaced orders: the slot between 20 and 40 is still there.
    //
    // Both neighbours are asserted. The version this replaced named two entries and
    // checked only the left one, so an entry that landed after Dashboard but in the
    // wrong place further down would have passed a check claiming it was between them.
    'the configured order places it between Dashboard and Browse',
    added.findIndex(([id]) => id === 'acme.navbar.contracts') ===
      added.findIndex(([id]) => id === 'app.navbar.dashboard') + 1 &&
      added.findIndex(([id]) => id === 'app.navbar.browseAdfHx') ===
        added.findIndex(([id]) => id === 'acme.navbar.contracts') + 1,
    `rendered: ${JSON.stringify(added.map(([id]) => id))}`,
  );
  h.check(
    'nothing packaged was displaced to make room',
    added.length === PACKAGED_NAV.length + 1,
    `rendered ${added.length} entries, expected ${PACKAGED_NAV.length + 1}`,
  );
  await h.screenshot('manifest-adds-nav-entry');

  await h.step('A manifest reorders the navigation, with no rebuild');
  const reordered = await applyManifest(
    { overrides: { 'app.navbar.administration': { order: 1 } } },
    'reorder',
    baselineBundle,
  );
  h.check(
    'the reordered entry is now first',
    reordered[0]?.[0] === 'app.navbar.administration',
    `first entry was ${reordered[0]?.[0]}`,
  );
  h.check(
    'the remaining entries keep their packaged relative order',
    JSON.stringify(reordered.slice(1).map(([id]) => id)) ===
      JSON.stringify(
        PACKAGED_NAV.filter(([id]) => id !== 'app.navbar.administration').map(([id]) => id),
      ),
    `rendered: ${JSON.stringify(reordered.map(([id]) => id))}`,
  );
  await h.screenshot('manifest-reorders-nav');

  await h.step('A manifest relabels a navigation entry, with no rebuild');
  // Collections rather than Browse: the legacy Browse entry ships `disabled`, so an
  // override on it has nothing to relabel and this step would assert against an
  // entry that is not in the DOM at all.
  const relabelled = await applyManifest(
    { overrides: { 'app.navbar.collections': { label: 'Repository' } } },
    'relabel',
    baselineBundle,
  );
  h.check(
    'the relabelled entry shows the configured text',
    relabelled.some(([id, label]) => id === 'app.navbar.collections' && label === 'Repository'),
    `rendered: ${JSON.stringify(relabelled)}`,
  );
  // An ordered equality against the packaged list with the one override applied,
  // which is what the label claims. The version this replaced asserted only that
  // no entry still read "Collections" and that the count was unchanged — so a
  // manifest that relabelled Collections *and* silently rewrote Trash would have
  // passed a check titled "no other label changed".
  h.check(
    'no other label changed',
    JSON.stringify(relabelled) ===
      JSON.stringify(
        PACKAGED_NAV.map(([id, label]) =>
          id === 'app.navbar.collections' ? [id, 'Repository'] : [id, label],
        ),
      ),
    `rendered:\n  ${JSON.stringify(relabelled)}\nexpected only Collections to change from:\n  ${JSON.stringify(
      PACKAGED_NAV,
    )}`,
  );
  await h.screenshot('manifest-relabels-nav');

  await h.step('A manifest gates an entry behind a registered rule, with no rebuild');
  const gatedOff = await applyManifest(
    { overrides: { 'app.navbar.browseAdfHx': { rule: 'core.false' } } },
    'rule denies',
    baselineBundle,
  );
  h.check(
    'a rule that denies removes the entry',
    !gatedOff.some(([id]) => id === 'app.navbar.browseAdfHx'),
    `rendered: ${JSON.stringify(gatedOff.map(([id]) => id))}`,
  );

  const gatedOn = await applyManifest(
    { overrides: { 'app.navbar.browseAdfHx': { rule: 'app.rules.isAdministrator' } } },
    'rule permits',
    baselineBundle,
  );
  h.check(
    'a rule that permits keeps the entry, so the gate is the rule and not the override',
    gatedOn.some(([id]) => id === 'app.navbar.browseAdfHx'),
    `rendered: ${JSON.stringify(gatedOn.map(([id]) => id))}`,
  );
  await h.screenshot('manifest-rule-gates-nav');

  // ---------------------------------------------------------------------------
  // LOAD-BEARING: the nav array is no longer decorative.
  // ---------------------------------------------------------------------------
  await h.step('A manifest-added entry gets real drawer content from the sidebar slot');
  await applyManifest(
    {
      slots: {
        navbar: [
          {
            // The convention `app.navbar.<name>` -> `app.sidebar.<name>` resolves
            // this to the registered `app.sidebar.searchFilters` component. The id
            // is new, so it falls through every packaged drawer branch — which is
            // exactly the path that could previously only render a placeholder.
            id: 'app.navbar.searchFilters',
            label: 'Saved filters',
            path: '/search',
            icon: 'search',
            order: 65,
            hasDrawer: true,
          },
        ],
      },
    },
    'sidebar slot',
    baselineBundle,
  );
  await page.locator('sat-platform-nav-list-item[data-nav-id="app.navbar.searchFilters"]').click();
  await page.waitForTimeout(1500);
  await h.expectVisible(
    'the shared extension outlet rendered in the drawer',
    'lib-extension-outlet',
  );
  await h.expectVisible(
    'the registered lazy sidebar component was resolved and mounted',
    'lib-search-filters-drawer',
  );
  const drawerText = await page.locator('lib-extension-outlet').first().innerText();
  h.check(
    'the placeholder branch was not taken',
    !drawerText.includes('will appear here'),
    `drawer rendered the placeholder: "${drawerText.slice(0, 120)}"`,
  );
  await h.screenshot('manifest-nav-entry-with-sidebar-content');

  // ---------------------------------------------------------------------------
  // LOAD-BEARING: $references layering.
  // ---------------------------------------------------------------------------
  await h.step('A customer layer wins over ours through $references');
  const layered = await applyManifest(
    {
      $references: ['baseline', 'acme'],
      $layers: {
        baseline: {
          overrides: {
            'app.navbar.collections': { label: 'Baseline label' },
            'app.navbar.trash': { visible: false },
          },
        },
        acme: { overrides: { 'app.navbar.collections': { label: 'Acme wins' } } },
      },
    },
    '$references',
    baselineBundle,
  );
  h.check(
    'the later layer overrides the earlier one on the same key',
    layered.some(([id, label]) => id === 'app.navbar.collections' && label === 'Acme wins'),
    `rendered: ${JSON.stringify(layered)}`,
  );
  h.check(
    'a key only the earlier layer set still applies, so layers merge rather than replace',
    !layered.some(([id]) => id === 'app.navbar.trash'),
    `Trash still rendered, so the baseline layer was discarded: ${JSON.stringify(layered)}`,
  );
  await h.screenshot('manifest-references-layering');

  // ---------------------------------------------------------------------------
  // LOAD-BEARING: the documented fail-open contract.
  // ---------------------------------------------------------------------------
  await h.step('An unknown rule id leaves the entry visible, as documented');
  // Two things have to be true for this to mean anything, and neither can be
  // asserted from the harness's own variables.
  //
  // 1. The payload actually reached the app. The manifest therefore carries a
  //    **second** override — Collections relabelled — whose effect is visible in the
  //    DOM. The same fetch carries both, so seeing the relabel proves the app
  //    received the unknown rule id too. Asserting the rule id against
  //    `manifestBody` instead, as an earlier draft did, would only prove the
  //    harness built what it meant to build.
  // 2. A rule in this position *can* remove the entry — step 8 showed
  //    `core.false` doing exactly that. Without it, Trash surviving here would
  //    be indistinguishable from rules being ignored entirely, and Trash is
  //    visible in the packaged default anyway.
  const failedOpen = await applyManifest(
    {
      overrides: {
        'app.navbar.trash': { rule: 'acme.rules.notInThisBuild' },
        'app.navbar.collections': { label: 'Delivery receipt' },
      },
    },
    'unknown rule',
    baselineBundle,
  );
  h.check(
    'the manifest carrying the unknown rule id demonstrably reached the app',
    failedOpen.some(
      ([id, label]) => id === 'app.navbar.collections' && label === 'Delivery receipt',
    ),
    `Collections was not relabelled, so this manifest was never applied: ${JSON.stringify(
      failedOpen,
    )}`,
  );
  h.check(
    'the entry is still rendered, so a typo cannot strip working navigation',
    failedOpen.some(([id]) => id === 'app.navbar.trash'),
    `rendered: ${JSON.stringify(failedOpen.map(([id]) => id))}`,
  );
  await h.screenshot('unknown-rule-fails-open');

  await h.step('A user without administration access is not offered Administration');
  // Phase 2 ran every check as Administrator, so the one user-visible
  // regression it could cause — Administration exposed to everyone — had no
  // coverage anywhere.
  //
  // **What this proves and what it does not.** The harness injects the session
  // object `AuthService` writes, so this is a genuine non-administrator *client
  // session*: `hasAdministrationAccess()` is false and the rule on the
  // descriptor is what removes the entry. It is not a second Nuxeo account —
  // the stored session keeps the configured user's `basic`, which the app's
  // interceptor still sends, so XHRs are unchanged. It therefore tests the Layer 1 gate, which is the thing
  // Phase 2 changed, and says nothing about server-side authorisation, which
  // Phase 2 did not touch and which Nuxeo enforces regardless.
  // Two things force administrator back on and both have to be defeated:
  // `AuthService` re-hydrates from `/nuxeo/api/v1/me` on every load, and it
  // treats the built-in `Administrator` username as administrator even when the
  // API omits the flag. So the session is injected under a different username
  // and `/me` is intercepted to answer as an ordinary member.
  manifestBody = null;
  // Save the genuine session before overwriting it with the synthetic one.
  const genuineSession = await page.evaluate(() =>
    sessionStorage.getItem('agentic_ui_nuxeo_session'),
  );
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        'entity-type': 'user',
        id: 'jdoe',
        properties: { username: 'jdoe', groups: ['members'] },
        isAdministrator: false,
        extendedGroups: [{ name: 'members', label: 'Members' }],
      }),
    }),
  );
  await page.evaluate(() => {
    const key = 'agentic_ui_nuxeo_session';
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        ...JSON.parse(raw),
        username: 'jdoe',
        isAdministrator: false,
        groups: ['members'],
      }),
    );
  });
  await reloadApp(page);
  const asMember = await readNav(page);
  h.check(
    'the running application really believes it is a non-administrator',
    await page.evaluate(() => {
      const session = JSON.parse(sessionStorage.getItem('agentic_ui_nuxeo_session') ?? '{}');
      return session.isAdministrator === false && session.username === 'jdoe';
    }),
    'the session was re-hydrated back to an administrator',
  );
  h.check(
    'Administration is absent for a user without access',
    !asMember.some(([id]) => id === 'app.navbar.administration'),
    `rendered: ${JSON.stringify(asMember.map(([id]) => id))}`,
  );
  h.check(
    'and nothing else was removed with it',
    JSON.stringify(asMember) ===
      JSON.stringify(PACKAGED_NAV.filter(([id]) => id !== 'app.navbar.administration')),
    `rendered: ${JSON.stringify(asMember)}`,
  );
  await h.screenshot('non-admin-has-no-administration-entry');

  // Back to the configured user for the remaining steps. Restore the genuine session that was
  // saved before the synthetic block, so h.login()'s pre-restoration verification sees it.
  await page.unroute('**/api/v1/me');
  await page.evaluate((saved) => {
    if (saved) sessionStorage.setItem('agentic_ui_nuxeo_session', saved);
    else sessionStorage.removeItem('agentic_ui_nuxeo_session');
  }, genuineSession);
  await h.login();
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------------------
  // NEGATIVE / FALLBACK.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // LOAD-BEARING: the bulk-action surface is registry-driven.
  // ---------------------------------------------------------------------------
  await h.step('The bulk-action bar is resolved from the registry, and a manifest changes it');

  /** Select the first two rows in production browse, which raises the topbar. */
  const selectTwoRows = async () => {
    await h.goTo('/#/browse');
    await page.waitForSelector('lib-browse');
    await page.waitForTimeout(1500);
    const checkboxes = page.locator('lib-browse mat-checkbox input[type="checkbox"]');
    const total = await checkboxes.count();
    for (let index = 1; index < Math.min(total, 3); index += 1) {
      await checkboxes.nth(index).click({ force: true });
    }
    await page.waitForTimeout(800);
    return page.evaluate(() =>
      [...document.querySelectorAll('lib-selection-topbar button[data-action-id]')].map((el) =>
        el.getAttribute('data-action-id'),
      ),
    );
  };

  manifestBody = null;
  await reloadApp(page);
  const packagedBulk = await selectTwoRows();
  h.check(
    'every bulk control carries an addressable extension id, in the order the fixed markup had',
    JSON.stringify(packagedBulk) ===
      JSON.stringify([
        'app.bulkActions.downloadZip',
        'app.bulkActions.addToCollection',
        'app.bulkActions.compare',
        'app.bulkActions.addToClipboard',
        'app.bulkActions.publish',
        'app.bulkActions.delete',
      ]),
    `rendered: ${JSON.stringify(packagedBulk)}`,
  );
  await h.screenshot('packaged-bulk-actions');

  manifestBody = manifestDocument({
    overrides: { 'app.bulkActions.publish': { visible: false } },
    slots: {
      'bulk-actions': [
        { id: 'acme.bulkActions.archive', label: 'Archive', icon: 'inventory_2', order: 15 },
      ],
    },
  });
  await reloadApp(page);
  const customisedBulk = await selectTwoRows();
  h.check(
    'a manifest hid a packaged bulk action and added its own, with no rebuild',
    JSON.stringify(customisedBulk) ===
      JSON.stringify([
        'app.bulkActions.downloadZip',
        'acme.bulkActions.archive',
        'app.bulkActions.addToCollection',
        'app.bulkActions.compare',
        'app.bulkActions.addToClipboard',
        'app.bulkActions.delete',
      ]),
    `rendered: ${JSON.stringify(customisedBulk)}`,
  );
  await h.screenshot('manifest-customised-bulk-actions');

  await h.step('A malformed extensions block leaves a working application');
  // A valid envelope, so the response is applied and only the extensions reader is under test.
  manifestBody = manifestDocument({
    $references: 'not a list',
    $ignoreReferenceList: 1,
    $layers: [],
    slots: 'not an object',
    overrides: { 'app.navbar.trash': 'not an object' },
  });
  await reloadApp(page);
  const afterMalformed = await readNav(page);
  h.check(
    'the packaged navigation is restored rather than left half-applied',
    JSON.stringify(afterMalformed) === JSON.stringify(PACKAGED_NAV),
    `rendered: ${JSON.stringify(afterMalformed)}`,
  );
  await h.goTo('/#/browse');
  await h.expectVisible('browse page still renders', 'lib-browse');
  await h.expectText('repository content still listed', 'lib-browse', 'Default domain');
  await h.screenshot('malformed-extensions-falls-back');

  await h.step('An absent configuration service leaves the packaged surface intact');
  manifestBody = null;
  await reloadApp(page);
  const unconfigured = await readNav(page);
  h.check(
    'a fresh install shows exactly the packaged navigation',
    JSON.stringify(unconfigured) === JSON.stringify(PACKAGED_NAV),
    `rendered: ${JSON.stringify(unconfigured)}`,
  );
  await h.screenshot('absent-config-packaged-surface');

  await h.step('Registry health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
