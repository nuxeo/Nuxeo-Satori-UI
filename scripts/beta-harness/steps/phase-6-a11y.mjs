/**
 * Phase 6 — WCAG 2.1 AA for the Beta slice.
 *
 * The Beta quality bar includes WCAG 2.1 AA (`docs/adf-hx-beta-plan.md`, Phase 6) and nothing had
 * ever measured it. The first version of this file established the baseline; this version asserts
 * the bar is **met**.
 *
 * ## What changed on 2026-08-24, and why the ratchet is gone
 *
 * The baseline version scanned **three** surfaces and ratcheted **four** rule ids. Widening the
 * scan to fifteen cases showed that both numbers were understatements: there were **seven** rule
 * classes and 77 violating nodes, and three of the extra ones were on surfaces this file never
 * visited. A ratchet over an under-sampled scan reports "no new violations" while the violations it
 * cannot see accumulate — the same failure mode as a gate that has never been seen to go red.
 *
 * All of it is now fixed, so `KNOWN_VIOLATIONS` is **empty** and the verdict is unconditional:
 *
 * | Rule                          | Was | Now | Owner                                    |
 * | ----------------------------- | --- | --- | ---------------------------------------- |
 * | `button-name`                 | 21  |  0  | ours                                     |
 * | `label`                       | 42  |  0  | ours                                     |
 * | `role-img-alt`                | 12  |  0  | ours                                     |
 * | `nested-interactive`          | 40  |  0  | ours                                     |
 * | `color-contrast`              |  7  |  0  | ours                                     |
 * | `scrollable-region-focusable` |  2  |  0  | ours                                     |
 * | `aria-progressbar-name`       |  2  |  0  | ours                                     |
 * | `aria-required-children`      |  3  |  —  | **`@alfresco/adf-core@9.0.0`** — see below |
 *
 * ## No exclusions
 *
 * Every step scans with `KNOWN_VIOLATIONS`, which is empty. Until 2026-10-14 one step did not: the
 * adf-hx POC route excluded `aria-required-children`, upstream's defect in adf-core's
 * `DataTableComponent` (`role="row"` with non-cell children, finding **1.2** in
 * `docs/adf-hx-upstream-findings.md`). That step was removed with adf-core's wiring (NXSAT-636),
 * which is why the rule has no "Now" count: the only surface that carried it is no longer scanned.
 *
 * ## What this capture does and does not cover
 *
 * The landing page, browse, search, trash, tasks, collections, administration, knowledge discovery
 * and document detail, plus view-mode and column-panel states that a single visit per route does
 * not reach, a Picture document whose `.picture-cards` metadata strip is not reached by opening an
 * arbitrary File blob, and the replace-main-file tooltip. Three of the seven rule classes were only
 * visible in those extra states.
 *
 * The **login surface is still not covered**: this capture signs in before its first scan, and on a
 * guest-enabled Nuxeo an unsigned app does not show the login page either — it signs itself in as
 * `Anonymous`, which the identity guard rejects (NXSAT-643). The
 * first draft of this file labelled a step "Login surface" and actually scanned the dashboard — a
 * test defect, caught by the selector assertion failing rather than by the scan. `phase-0-no-backend`
 * is the only file that sees login, and only because authentication fails there.
 *
 * Also not covered: dialogs, the upload flow, and dark mode. Stated rather than implied, because
 * "WCAG 2.1 AA met" is a claim whose scope is the thing that makes it true or false.
 *
 * Prerequisites:
 *   npm install --no-save @playwright/test @axe-core/playwright
 *     ^ both in ONE command. `npm install --no-save X` prunes previously --no-save'd packages,
 *       so installing axe alone silently removes Playwright.
 *   npm run beta:backend
 *   npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run beta:evidence -- phase-6-a11y
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { requireStepCredentials } from '../helpers.mjs';
import { basicAuthorization } from '../nuxeo-credentials.mjs';

/**
 * Empty on purpose. Every rule this capture once tolerated is fixed; see the table above.
 *
 * Do not add an entry here to make a run pass. A rule id in this list applies to **every** step, so
 * one addition silences that rule across the whole application. If a specific surface has an
 * unavoidable upstream violation, scope it to that step's own call and cite the finding that owns
 * it.
 */
const KNOWN_VIOLATIONS = [];

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Precondition: a backend is reachable, so data-bearing screens can be scanned');
  const probe = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/me`, {
      failOnStatusCode: false,
      headers: nuxeoApiRequestHeaders(),
    })
    // A refused connection fails the precondition below, which reports it as "no response".
    .catch(() => null);
  h.requirePrecondition(
    'Nuxeo API answers through the dev proxy',
    probe?.status() === 200,
    `/nuxeo/api/v1/me returned ${probe?.status() ?? 'no response'} — an empty screen scans clean and proves nothing. ` +
      'Run `npm run beta:backend` first.',
  );

  // Signed in first. This step was titled "after authentication" but scanned the landing page
  // before `h.login()`, relying on `httpCredentials`, which a guest-enabled Nuxeo never
  // challenges for: the app found no session, asked `/me`, and signed itself in as `Anonymous`.
  // The identity guard rejects that, so the scan now runs as the user it claims (NXSAT-643).
  await h.login();

  await h.step('Landing surface after authentication');
  await page.goto(`${h.baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await h.expectVisible('app shell rendered', 'app-shell');
  await h.expectNoA11yViolations('landing: no WCAG 2.1 AA violations', {
    ignore: KNOWN_VIOLATIONS,
  });
  await h.screenshot('a11y-landing');
  h.note('the pre-auth login surface — this capture signs in before its first scan');

  await h.step('Production browse — the primary authenticated surface');
  await h.goTo('/#/browse');
  await h.expectVisible('browse page rendered', 'lib-browse');
  await h.expectVisible(
    'repository content listed',
    'lib-browse nxs-document-list .nxs-document-list__row',
  );
  await h.expectNoA11yViolations('browse: no WCAG 2.1 AA violations', { ignore: KNOWN_VIOLATIONS });
  await h.screenshot('a11y-browse');

  await h.step('Browse, card view — a state a single visit per route never reaches');
  // `.card-type` failed contrast at 3.54:1 and was invisible to the baseline scan, which only
  // ever saw the default table view. Two of the seven rule classes were found this way.
  await h.goTo('/#/browse');
  await clickIfPresent(page, 'button[aria-label="Card view"]');
  await h.expectNoA11yViolations('browse cards: no WCAG 2.1 AA violations', {
    ignore: KNOWN_VIOLATIONS,
  });
  await h.screenshot('a11y-browse-cards');

  await h.step('Browse, column picker open');
  await h.goTo('/#/browse');
  // Back to list view first: the view mode is held in a service and survives navigation, so after
  // the card-view step the column-picker button is not rendered at all. Without this the step
  // scanned card view again and passed — a step that silently measures the wrong thing, which is
  // the same defect the "Login surface" step shipped in the first draft of this file.
  await clickIfPresent(page, 'button[aria-label="List view"]');
  const columnPanel = await clickIfPresent(page, 'button[aria-label="Manage columns"]');
  h.check(
    'the column picker was actually opened',
    columnPanel,
    'button[aria-label="Manage columns"] was not present, so this step scanned a state it does not claim to',
  );
  await h.expectNoA11yViolations('browse column panel: no WCAG 2.1 AA violations', {
    ignore: KNOWN_VIOLATIONS,
  });
  await h.screenshot('a11y-browse-columns');

  await h.step('Search — the surface where the row markup was invalid');
  // 40 `nested-interactive` nodes: every row was a `<button>` wrapping a `mat-checkbox`. The rows
  // are now containers whose title is the control, with a stretched hit area for mouse users.
  await h.goTo('/#/search');
  await h.expectNoA11yViolations('search: no WCAG 2.1 AA violations', { ignore: KNOWN_VIOLATIONS });
  await h.screenshot('a11y-search');

  await h.step('Search, grid and list views');
  await h.goTo('/#/search');
  await clickIfPresent(page, 'button[aria-label="Grid view"]');
  await h.expectNoA11yViolations('search grid: no WCAG 2.1 AA violations', {
    ignore: KNOWN_VIOLATIONS,
  });
  await h.goTo('/#/search');
  await clickIfPresent(page, 'button[aria-label="List view"]');
  await h.expectNoA11yViolations('search list: no WCAG 2.1 AA violations', {
    ignore: KNOWN_VIOLATIONS,
  });
  await h.screenshot('a11y-search-views');

  await h.step('Trash, tasks, collections, administration, knowledge discovery');
  // None of these was scanned by the baseline version. `aria-progressbar-name` was found here:
  // 101 `mat-spinner` elements in the repository had no accessible name, and only knowledge
  // discovery happened to be rendering one at scan time.
  for (const [label, route] of [
    ['trash', '/#/trash'],
    ['tasks', '/#/tasks'],
    ['collections', '/#/collections'],
    ['administration', '/#/administration'],
    ['knowledge discovery', '/#/knowledge-discovery'],
  ]) {
    await h.goTo(route);
    await h.expectNoA11yViolations(`${label}: no WCAG 2.1 AA violations`, {
      ignore: KNOWN_VIOLATIONS,
    });
  }
  await h.screenshot('a11y-secondary-surfaces');

  await h.step(
    'Document detail — Picture metadata strip (NXENG-812 / NXSAT-493 / WCAG 1.4.3 on .info-label)',
  );
  const pictureUid = await findPictureWithPictureCardsUid(page, h.baseUrl);
  h.check(
    'a Picture with picture:info and picture:views exists',
    pictureUid !== null,
    'repository query returned no Picture whose metadata strip renders — .picture-cards was NOT scanned',
  );
  if (pictureUid) {
    await h.goToDoc(pictureUid);
    await h.expectVisible('document detail rendered', 'lib-document-detail');
    await h.expectVisible('document viewer rendered', 'lib-document-viewer');
    const stripLabelVisible = await h.expectVisible(
      'picture metadata .info-label on the light strip',
      'lib-document-viewer .picture-cards .info-label',
      30_000,
    );
    if (stripLabelVisible) {
      await h.expectNoA11yViolations(
        'document detail (picture metadata strip): no WCAG 2.1 AA violations',
        { ignore: KNOWN_VIOLATIONS },
      );
      await h.screenshot('a11y-document-detail-picture-metadata');
    }
  }

  await h.step(
    'Document detail — Replace main file with tooltip open (NXENG-771 / WCAG 2.5.3 label-in-name)',
  );
  const docUid = await findFileWithMainBlobUid(page, h.baseUrl);
  h.check(
    'a File with a persisted main blob exists',
    docUid !== null,
    'repository query returned no File whose @blob/file:content answers — replace-main-file cannot be scanned',
  );
  if (docUid) {
    await h.goToDoc(docUid);
    await h.expectVisible('document detail rendered', 'lib-document-detail');
    await h.expectVisible('document viewer rendered', 'lib-document-viewer');
    const replaceBtn = page.locator('lib-document-viewer button[aria-label="Replace main file"]');
    h.check(
      'replace main file control is rendered for a writable File with a blob',
      (await replaceBtn.count()) > 0,
      'lib-document-viewer footer has no Replace main file control — file:content or permissions',
    );
    if ((await replaceBtn.count()) > 0) {
      const btn = replaceBtn.first();
      await btn.hover();
      await btn.focus();
      await page.waitForTimeout(600);
      const accessibleName = (await btn.getAttribute('aria-label')) ?? '';
      const tooltipLocator = page
        .locator('.cdk-overlay-container')
        .getByText(accessibleName, { exact: true });
      const tooltipText = ((await tooltipLocator.textContent()) ?? '').trim();
      h.check(
        'Replace main file tooltip text matches accessible name (NXENG-771 label-in-name)',
        accessibleName.length > 0 && tooltipText === accessibleName,
        `aria-label=${JSON.stringify(accessibleName)} visible tooltip=${JSON.stringify(tooltipText)}`,
      );
    }
    await h.expectNoA11yViolations(
      'document detail (replace-main-file tooltip): no WCAG 2.1 AA violations',
      { ignore: KNOWN_VIOLATIONS },
    );
    await h.screenshot('a11y-document-detail-replace-main-file');
  }

  await h.step('Keyboard reachability of the primary navigation');
  // Distinct from an axe scan: axe checks markup, this checks that a keyboard user can actually
  // get to the nav. A focusable element behind a pointer-only handler passes every static rule.
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => {
    const el = document.activeElement;
    return el
      ? `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`
      : 'none';
  });
  h.check(
    'Tab moves focus into the page',
    firstFocus !== 'none' && firstFocus !== 'body',
    `focus landed on ${firstFocus}`,
  );
  await h.screenshot('a11y-keyboard-focus');

  await h.step('No catalogue blanks a key that upstream uses as an accessible name');
  // The regression test for the most widespread violation in the product: `sat-platform-nav` binds
  // ONE translated string to both `matTooltip` and `[attr.aria-label]`, and our catalogues set that
  // key to `''` on purpose, to suppress a duplicate tooltip. The side effect was `aria-label=""` —
  // a critical `button-name` violation on every surface. See docs/adf-hx-upstream-findings.md §4.6.
  //
  // ## Why this is asserted on the files and not on the DOM
  //
  // The first version of this step read `aria-label` off the live element. Re-introducing the
  // regression proved that check **unreliable**: all twelve axe assertions went red, and this one
  // still reported pass, because the value observed at this point in the run did not match the one
  // the earlier steps had scanned. A check that passes while the defect is present is worse than no
  // check, so it was replaced rather than tuned.
  //
  // The rendered outcome is already covered — and covered well — by the twelve axe scans above,
  // every one of which fails when the key is blanked. What was missing was a guard on the
  // *mechanism*, and the mechanism is three files. These are deterministic.
  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
  const emptySatKeys = (obj, prefix = '') => {
    const out = [];
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') {
        if (path.startsWith('sat.') && v.trim() === '') out.push(path);
      } else if (v && typeof v === 'object') {
        out.push(...emptySatKeys(v, path));
      }
    }
    return out;
  };

  const shipped = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/nuxeo-ui/public/i18n/en.json'), 'utf8'),
  );
  const shippedEmpty = emptySatKeys(shipped);
  h.check(
    'the shipped catalogue blanks no sat.* key',
    shippedEmpty.length === 0,
    `apps/nuxeo-ui/public/i18n/en.json blanks ${shippedEmpty.join(', ')} — upstream uses these as ` +
      'accessible names, so an empty value produces an unnamed control',
  );

  // The fallback is a separate file and was missed by the first pass at this fix: the catalogue was
  // corrected and `en-fallback.ts` still carried the empty strings, so a failed fetch would have
  // silently restored the defect. Found by the negative control, not by the scan.
  const fallback = readFileSync(
    resolve(repoRoot, 'apps/nuxeo-ui/src/app/i18n/en-fallback.ts'),
    'utf8',
  );
  const fallbackEmpty = [...fallback.matchAll(/'(sat\.[^']+)':\s*''/g)].map((m) => m[1]);
  h.check(
    'the compiled-in fallback blanks no sat.* key',
    fallbackEmpty.length === 0,
    `en-fallback.ts blanks ${fallbackEmpty.join(', ')} — a failed catalogue fetch would restore the ` +
      'empty accessible name',
  );

  // And the folder that supplies the real strings has to be both copied and reachable.
  const ng = JSON.parse(readFileSync(resolve(repoRoot, 'angular.json'), 'utf8'));
  const build = ng.projects['nuxeo-ui'].architect?.build ?? ng.projects['nuxeo-ui'].targets?.build;
  const assetArrays = [
    build.options?.assets,
    ...Object.values(build.configurations ?? {}).map((c) => c.assets),
  ].filter(Array.isArray);
  const withSatori = assetArrays.filter((a) =>
    a.some(
      (entry) =>
        typeof entry === 'object' && /@hylandsoftware\/satori-ui\/i18n/.test(entry.input ?? ''),
    ),
  );
  h.check(
    'every build asset array copies the satori-ui i18n folder',
    assetArrays.length > 0 && withSatori.length === assetArrays.length,
    `${withSatori.length} of ${assetArrays.length} asset array(s) copy ` +
      '@hylandsoftware/satori-ui/i18n. Angular REPLACES rather than merges this array per ' +
      'configuration, so adding it to one and not the others fixes only some builds',
  );

  const served = await page.request.get(`${h.baseUrl}/assets/satori-ui/i18n/en.json`, {
    failOnStatusCode: false,
  });
  let servedLabel = null;
  if (served.ok()) {
    try {
      servedLabel = (await served.json())?.sat?.['platform-nav']?.expand ?? null;
    } catch {
      servedLabel = null;
    }
  }
  h.check(
    'the served satori-ui catalogue supplies a non-empty nav label',
    typeof servedLabel === 'string' && servedLabel.trim().length > 0,
    `GET /assets/satori-ui/i18n/en.json -> ${served.status()}, sat.platform-nav.expand=${JSON.stringify(servedLabel)}`,
  );
  h.note(`served sat.platform-nav.expand = ${JSON.stringify(servedLabel)}`);

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    /automation\/AI\./,
    '/nuxeo/logout',
    '/agentic-ui-config/bootstrap.json',
    '/agentic-ui-config/manifest.json',
    // Added with the knowledge-discovery surface, and each verified against the server rather
    // than assumed — widening this list to get to green is how a health check stops meaning
    // anything.
    //
    // The KD operations ARE registered on this Nuxeo (6 of them, alongside 12 `AI.*`), so the
    // 500 is not the absent-marketplace-package case the `AI.*` pattern above covers. The body
    // says: "No authentication info for calling the Knowledge Discovery service" — the local
    // instance has no KD credentials configured. An environment condition, not a client defect.
    /automation\/HylandKnowledgeDiscovery\./,
    // `NuxeoPrincipalResolver.resolve()` deliberately tries `/group/{name}` first and falls back
    // to `/user/{name}` on failure, with a documented `catchError`. So a 404 for every principal
    // that turns out to be a user is designed behaviour, not a defect. Verified by reading
    // libs/shared/adf-hx-bridge/src/lib/services/nuxeo-principal-resolver.service.ts.
    /HTTP 404 .*\/api\/v1\/group\//,
  ]);
}

const FILE_WITH_MAIN_BLOB_NXQL =
  "SELECT * FROM File WHERE ecm:mixinType <> 'HiddenInNavigation' " +
  'AND ecm:isVersion = 0 AND ecm:isTrashed = 0 AND file:content/name IS NOT NULL ' +
  'ORDER BY dc:created';

const PICTURE_WITH_METADATA_NXQL =
  "SELECT * FROM Picture WHERE ecm:mixinType <> 'HiddenInNavigation' " +
  'AND ecm:isVersion = 0 AND ecm:isTrashed = 0 AND picture:info/width > 0 ' +
  'AND picture:info/height > 0 ORDER BY dc:created';

/**
 * Explicit Basic auth for `page.request` calls to `/nuxeo/api/*`.
 *
 * The runner's `httpCredentials` now go out with every `page.request` call (`send: 'always'`,
 * NXSAT-643), so this header is the same user's, stated where the request is made — see
 * `phase-runner.mjs` and `apps/nuxeo-ui-e2e/src/fixtures.ts` (Nuxeo does not challenge
 * unauthenticated API calls, so a challenge-based credential is never sent).
 *
 * From the environment, with no default. Both halves defaulted to the local Docker administrator
 * pair here, which is the fallback NXSAT-649 named as its precondition: a working credential in
 * the repository, and an accessibility scan that would silently run as an administrator. The
 * runner already refuses this file without the pair; this throws a `PreconditionError` too, so
 * the function cannot be lifted somewhere that does not.
 *
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string>}
 */
function nuxeoApiRequestHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: basicAuthorization(requireStepCredentials('scan the phase-6-a11y surfaces')),
  };
}

/**
 * First Picture uid with hydrated `picture:info` and `picture:views`, paging NXQL until exhausted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<string | null>}
 */
async function findPictureWithPictureCardsUid(page, baseUrl) {
  for (let pageIndex = 0; ; pageIndex++) {
    const response = await page.request.get(`${baseUrl}/nuxeo/api/v1/search/lang/NXQL/execute`, {
      params: {
        query: PICTURE_WITH_METADATA_NXQL,
        pageSize: '20',
        currentPageIndex: String(pageIndex),
      },
      headers: nuxeoApiRequestHeaders({ 'X-NXproperties': '*' }),
    });
    if (!response.ok()) {
      return null;
    }
    const body = await response.json();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const isNextPageAvailable = body.isNextPageAvailable === true;
    if (entries.length === 0 && isNextPageAvailable) {
      return null;
    }
    for (const entry of entries) {
      const uid = entry?.uid;
      if (typeof uid !== 'string') {
        continue;
      }
      const doc = await page.request.get(`${baseUrl}/nuxeo/api/v1/id/${uid}`, {
        failOnStatusCode: false,
        headers: nuxeoApiRequestHeaders({ 'X-NXproperties': '*' }),
      });
      if (!doc.ok()) {
        continue;
      }
      const payload = await doc.json();
      const info = payload?.properties?.['picture:info'];
      const views = payload?.properties?.['picture:views'];
      const width = Number(info?.width ?? 0);
      const height = Number(info?.height ?? 0);
      if (width > 0 && height > 0 && Array.isArray(views) && views.length > 0) {
        return uid;
      }
    }
    if (!isNextPageAvailable) {
      return null;
    }
  }
}

/**
 * First File uid whose main blob responds on `@blob/file:content`, paging NXQL until exhausted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<string | null>}
 */
async function findFileWithMainBlobUid(page, baseUrl) {
  for (let pageIndex = 0; ; pageIndex++) {
    const response = await page.request.get(`${baseUrl}/nuxeo/api/v1/search/lang/NXQL/execute`, {
      params: {
        query: FILE_WITH_MAIN_BLOB_NXQL,
        pageSize: '20',
        currentPageIndex: String(pageIndex),
      },
      headers: nuxeoApiRequestHeaders(),
    });
    if (!response.ok()) {
      return null;
    }
    const body = await response.json();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const isNextPageAvailable = body.isNextPageAvailable === true;
    if (entries.length === 0 && isNextPageAvailable) {
      return null;
    }
    for (const entry of entries) {
      const uid = entry?.uid;
      if (typeof uid !== 'string') {
        continue;
      }
      const head = await page.request.head(`${baseUrl}/nuxeo/api/v1/id/${uid}/@blob/file:content`, {
        failOnStatusCode: false,
        headers: nuxeoApiRequestHeaders(),
      });
      if (head.ok()) {
        return uid;
      }
    }
    if (!isNextPageAvailable) {
      return null;
    }
  }
}

/**
 * Click a control if it is on the page, and say so if it is not.
 *
 * A silent no-op would let a step labelled "card view" scan the table view and pass — which is
 * precisely the defect the first draft of this file shipped.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function clickIfPresent(page, selector) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) {
    console.warn(`  phase-6-a11y: ${selector} not present; the state it opens was NOT scanned`);
    return false;
  }
  await el.click();
  await page.waitForTimeout(1600);
  return true;
}
