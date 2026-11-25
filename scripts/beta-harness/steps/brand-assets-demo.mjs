/**
 * The brand assets kit's demo script (docs/business-apps/development-plan.md, phase 5, "Demo",
 * step 1 and what this kit adds to it), end to end, on the kit in
 * `business-apps/packages/brand-assets-demo`, for the fictional Acme Outdoor.
 *
 *   1. A rights-ending banner on a live asset, above its picture views.
 *   2. Rights that have ended: the other banner, and none on cleared rights.
 *   3. The asset library, narrowed by its Rights facet on the server.
 *   4. A product page, listing its shots and the shots it is still missing.
 *   5. The layout files behind the pages: configuration, no code.
 *
 * The plan's steps 2 and 3 (the print rendition refused by the server, share links) are not this
 * kit's yet: rights the server enforces and decision C are out of its scope, and said in a note.
 * Step 4, the review with pins, is `brand-assets-review.mjs`, which writes what it reviews.
 *
 * The records, titles and dates it expects are read from the kit's own files, `demo/data.mjs` and
 * `bundle/agentic-ui-config/`, and each asset's rights end date from the server, where the seed
 * wrote it relative to the day it ran: so a change to the records is a change to what the demo
 * asserts. The demo's own choices are written here: the assets it opens (`ENDING`, `ENDED`,
 * `CLEARED`), the product (`PRODUCT`) and the facet bucket it picks (`Ending`).
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, and seeded with `demo/seed.mjs`, recently enough that the
 *   ending asset's rights still end within 30 days and the ended one's have passed, as this
 *   machine's day reads them: run the seed again on the day of the demo.
 * - **No asset or shot the seed did not write:** the library's rows and buckets, and the product's
 *   lists, are counted exactly.
 * - The dev server with `npm run config:dev` serving the kit's files (the kit's README, "Seeing it
 *   under nx serve").
 * - `NUXEO_USER` and `NUXEO_PASS`: anyone who may read the kit's workspace. The kit has no demo
 *   people of its own: the seed creates no user.
 *
 *   npm run beta:evidence -- brand-assets-demo
 *
 * Load-bearing checks, by step: the warning banner, in its tone and with the kit's text, above the
 * picture, which is a view fetched from a blob URL while the original file is not downloaded; the
 * negative banner on the ended asset, and no banner on a cleared one; the library's rows in the
 * server's order, its Rights buckets counted as seeded, and narrowed on the server by one; the
 * product's missing shots and its shots, exactly; the served layouts the kit's own, and the asset
 * page drawn as its file says. Negative ones: the other banner absent on each asset, no original
 * download, whose positive control is the Annotations tab downloading it once, and no code in the
 * bundle.
 *
 * Not covered, and said in notes: the server's own install (the dev server reads the layouts from
 * `config:dev`, not from the package), the plan's demo steps 2 and 3, step 4, which is the review's
 * own steps file, and the views being made for a record of the kit's own type right after an
 * upload, which the seed checks, not the demo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'brand-assets-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { ASSETS, MARKER, PRODUCTS, SHOTS, WORKSPACE, shotName } = await import(
  join(KIT, 'demo', 'data.mjs')
);

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The kit has no
 * demo people of its own, so no user is named: the seed creates none.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [], who: "anyone who may read the kit's workspace" },
  signsInAs: [],
  needs: [
    'the kit installed, and seeded on the day of the demo, with no asset, shot or product the seed did not write',
    "the dev server with `npm run config:dev` serving the kit's files",
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
/** The assets the demo opens: one whose rights end soon, one whose have ended, one cleared. */
const ENDING = ASSETS.find((asset) => asset.id === 'ast-503');
const ENDED = ASSETS.find((asset) => asset.id === 'ast-505');
const CLEARED = ASSETS.find((asset) => asset.id === 'ast-501');
/** The product it opens: the one with a missing colourway shot. */
const PRODUCT = PRODUCTS.find((product) => product.style === 'AO-3101');

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, which the app's sign-in calls to drop
 * a stale cookie session; `AI.*` operations come from a marketplace package this server may lack;
 * and the shell's recently-viewed list asks for a thumbnail of every document in it, which a record
 * with no file does not have, so Nuxeo answers 404.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

/**
 * The handlers of every wait, click and read whose failure a check after it reports, so that the
 * failure is deferred to the check, not lost. A read that fails gives `null`, which every check or
 * precondition that reads it refuses, with what it found.
 */
const deferred = () => undefined;
const unread = () => null;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;

/** A JSON value with its object keys sorted, so two parses compare as text. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** A served layout comes in the servlet's envelope, as `config:dev` writes it; the rest as is. */
function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

/** Counts of `items` by `key`, as a plain object with sorted keys. */
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return canonical(counts);
}

/**
 * How many days a stored day is after this machine's today, as the app reads it in the browser on
 * this machine: a stored day as written (AGENTS/08-bug-patterns.md, pattern 29).
 */
function daysFromToday(stored) {
  const [year, month, day] = String(stored).slice(0, 10).split('-').map(Number);
  const now = new Date();
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000,
  );
}

/** The banner the asset page should show for a rights end, as the kit's two rules decide. */
function bannerFor(stored) {
  const days = daysFromToday(stored);
  return days < 0 ? 'rights-ended' : days <= 30 ? 'rights-ending' : null;
}

/** The record page as drawn: its banners, and each card's id, heading, fields and rows. */
function readRecordPage(page) {
  return page.evaluate(() => ({
    banners: [...document.querySelectorAll('.record-page__banner')].map((banner) => ({
      id: banner.getAttribute('data-banner-id'),
      tone: banner.querySelector('.nxs-banner')?.getAttribute('data-tone') ?? null,
      text: banner.querySelector('.nxs-banner__message')?.textContent?.trim() ?? null,
    })),
    picture: (() => {
      const banners = document.querySelector('.record-page__banners');
      const views = document.querySelector('lib-record-picture-views');
      const card = document.querySelector('.record-page__card[data-card-id]');
      return {
        view: document.querySelector('.record-picture__figure')?.getAttribute('data-view') ?? null,
        src: document.querySelector('.record-picture__image')?.getAttribute('src') ?? null,
        first: Boolean(
          views && card && views.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        underBanners: Boolean(
          banners &&
          views &&
          banners.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      };
    })(),
    cards: [...document.querySelectorAll('.record-page__card[data-card-id]')].map((card) => ({
      id: card.getAttribute('data-card-id'),
      heading: card.querySelector('.record-page__heading')?.textContent?.trim() ?? null,
      fields: [...card.querySelectorAll('.record-page__field')].map((field) => ({
        key: field.getAttribute('data-field'),
        value: (field.querySelector('dd')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      })),
      rows: [...card.querySelectorAll('tbody tr')].map((row) =>
        (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
      ),
    })),
  }));
}

/** The record page has drawn the cards named, and the picture's view when it shows one. */
async function recordSettled(page, cards, { picture = false } = {}) {
  await page
    .waitForFunction(
      ({ ids, withPicture }) =>
        ids.every((id) => document.querySelector(`.record-page__card[data-card-id="${id}"]`)) &&
        [...document.querySelectorAll('.record-page__card lib-record-list')].every(
          (list) => list.querySelector('tbody tr, nxs-empty-state') !== null,
        ) &&
        (!withPicture ||
          document.querySelector('.record-picture__image')?.getAttribute('src') != null),
      { ids: cards, withPicture: picture },
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/** The seeded title each of a list's rows starts with, in the order drawn. */
function rowTitles(rows, titles) {
  return rows.map((row) => titles.find((title) => row.startsWith(title)) ?? row);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the kit installed and seeded, today, and its files served');
  const { username, password } = requireStepCredentials('read the seeded records');
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const types = [];
  for (const type of ['AcmeAsset', 'AcmeProduct', 'AcmeShot', 'AcmeAssetSearch']) {
    const answer = await page.request
      .get(`${h.baseUrl}/nuxeo/api/v1/config/types/${type}`)
      .catch(unread);
    if (answer?.status() !== 200) types.push(type);
  }
  h.requirePrecondition(
    "the kit's stand-in model is installed",
    types.length === 0,
    `the server has no ${types.join(', ')} type: install the package (the kit's README)`,
  );

  const read = async (path) =>
    page.request
      .get(`${h.baseUrl}/nuxeo/api/v1/path${path}`, { headers: { properties: '*' } })
      .then((r) => (r.ok() ? r.json() : null))
      .catch(unread);
  const seeded = new Map();
  const absent = [];
  for (const asset of ASSETS) {
    const doc = await read(`${ROOT}/assets/${asset.id}`);
    if (doc?.type === 'AcmeAsset' && doc.properties?.['dc:source'] === MARKER)
      seeded.set(asset.id, doc);
    else absent.push(asset.id);
  }
  const product = await read(`${ROOT}/products/${PRODUCT.style.toLowerCase()}`);
  if (!(product?.type === 'AcmeProduct' && product.properties?.['dc:source'] === MARKER))
    absent.push(PRODUCT.style);
  h.requirePrecondition(
    "the seeded assets and product are there, each carrying the seed's marker",
    absent.length === 0,
    `not found as seeded: ${absent.join(', ')}. Run demo/seed.mjs against this server`,
  );

  // The banners are decided by this machine's day, which the browser shares: the seed wrote each
  // date relative to the day it ran.
  const expired = (asset) => seeded.get(asset.id).properties['dc:expired'];
  h.requirePrecondition(
    `the seed's dates still hold today: ${ENDING.id}'s rights end within 30 days, ${ENDED.id}'s have ended, ${CLEARED.id}'s are clear`,
    bannerFor(expired(ENDING)) === 'rights-ending' &&
      bannerFor(expired(ENDED)) === 'rights-ended' &&
      bannerFor(expired(CLEARED)) === null,
    `their rights end on ${expired(ENDING)}, ${expired(ENDED)} and ${expired(CLEARED)}: run ` +
      'demo/seed.mjs again today',
  );

  // The library and the product's lists are counted exactly, so no record the seed did not write
  // may be in them. Asked of the repository, not the index, which can still hold a trashed one.
  const query = async (nxql) =>
    fetch(`${h.baseUrl}/nuxeo/api/v1/automation/Repository.Query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: basic,
        properties: 'dublincore',
      },
      body: JSON.stringify({ params: { query: nxql, pageSize: 1000 } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((answer) => (answer?.isNextPageAvailable === true ? null : (answer?.entries ?? null)))
      .catch(unread);
  // Each seeded record at its own place, carrying the seed's marker: anything else, even in the
  // kit's own folders, is someone else's.
  const places = {
    AcmeAsset: ASSETS.map((asset) => `${ROOT}/assets/${asset.id}`),
    AcmeShot: SHOTS.map((shot) => `${ROOT}/shots/${shotName(shot)}`),
    AcmeProduct: PRODUCTS.map((each) => `${ROOT}/products/${each.style.toLowerCase()}`),
  };
  const live = 'ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0';
  const others = [];
  let judged = true;
  for (const [type, expected] of Object.entries(places)) {
    const entries = await query(`SELECT * FROM ${type} WHERE ${live}`);
    if (entries === null) {
      judged = false;
      continue;
    }
    for (const entry of entries)
      if (!expected.includes(entry.path) || entry.properties?.['dc:source'] !== MARKER)
        others.push(`${entry.path} (${type})`);
  }
  h.requirePrecondition(
    'no asset, shot or product the seed did not write is on the server',
    judged && others.length === 0,
    judged
      ? `${others.length} record(s) not seeded would change the demo's lists: ` +
          `${others.slice(0, 3).join(', ')}. Run it on a server without them`
      : 'the repository query was not answered whole',
  );

  // What the dev server serves at /agentic-ui-config/ must be the kit's own files: they are what
  // the rest of this run asserts the page was drawn from.
  const served = [
    'labels/en.json',
    'navigation.json',
    'layouts/AcmeAsset/view.layout.json',
    'layouts/AcmeProduct/view.layout.json',
    'layouts/AcmeShot/view.layout.json',
    ...readdirSync(join(CONFIG, 'queues')).map((name) => `queues/${name}`),
  ];
  const differing = [];
  for (const path of served) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const { content, source } = unwrap(answer?.ok() ? await answer.json().catch(unread) : null);
    const fromKit = source === null || resolve(REPO, source) === join(CONFIG, path);
    if (!sameJson(content, kitFile(path)) || !fromKit)
      differing.push(`${path} (${answer?.status()}${source ? `, from ${source}` : ''})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's layouts, labels, menu and queues",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  // ── 1. A rights-ending banner ──────────────────────────────────────────────────────────────
  await h.step('1. A rights-ending banner on a live asset, above its picture views');
  await h.login();
  const asked = [];
  const listen = (request) => asked.push({ url: request.url(), type: request.resourceType() });
  page.on('request', listen);
  await h.goToDoc(seeded.get(ENDING.id).uid);
  const assetFile = kitFile('layouts/AcmeAsset/view.layout.json');
  const assetCards = assetFile.cards.map((card) => card.id);
  await recordSettled(page, assetCards, { picture: true });
  const ending = await readRecordPage(page);
  h.check(
    `${ENDING.title}: the warning banner alone, with the kit's text`,
    sameJson(ending.banners, [
      { id: 'rights-ending', tone: 'warning', text: labels['brand.asset.rightsEnding'] },
    ]),
    JSON.stringify(ending.banners),
  );
  h.check(
    'the picture comes first, under the banner: its Medium view, from a blob URL',
    ending.picture.first &&
      ending.picture.underBanners &&
      ending.picture.view === 'Medium' &&
      ending.picture.src?.startsWith('blob:'),
    JSON.stringify(ending.picture),
  );
  // The document page's original: `fetchBlob`, `@blob/file:content`, or its `blobholder:0` fallback.
  const original = /\/@blob\/(file:content|blobholder:0)(\?|$)/;
  const originals = asked.filter((request) => original.test(request.url));
  h.check(
    'the original file is not downloaded: the record page shows its views',
    originals.length === 0,
    JSON.stringify(originals.map((request) => request.url)),
  );
  h.check(
    'no Nuxeo address is loaded as an image',
    !asked.some((request) => request.type === 'image' && request.url.includes('/nuxeo/')),
  );
  const rights = ending.cards.find((card) => card.id === 'rights');
  h.check(
    "the rights card shows the asset's channels and regions, from the kit's schema",
    ENDING.channels.every((channel) =>
      rights?.fields.find((field) => field.key === 'acmeasset:channels')?.value.includes(channel),
    ) &&
      rights?.fields.find((field) => field.key === 'acmeasset:regions')?.value === ENDING.regions,
    JSON.stringify(rights),
  );
  await h.screenshot('rights-ending');
  // The positive control for the check above: the Annotations tab's viewer shows the original, so
  // opening it downloads it, and the listener and the address above do see that request.
  await page
    .locator('[role="tab"]', { hasText: /^\s*Annotations\s*$/ })
    .first()
    .click()
    .catch(deferred);
  // Its answer, then a quiet network, before counting: a retry or the `blobholder:0` fallback
  // after a failed first answer would be a second request, which "once" must see.
  await page
    .waitForResponse((response) => original.test(response.url()), { timeout: 15_000 })
    .catch(deferred);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(deferred);
  const annotated = asked.filter((request) => original.test(request.url));
  h.check(
    'opening the Annotations tab downloads the original, once: what the check above looks for',
    annotated.length === 1,
    JSON.stringify(annotated.map((request) => request.url)),
  );
  page.off('request', listen);
  // Back to the View tab, which the next record opens on if the page keeps its tab.
  await page
    .locator('[role="tab"]', { hasText: /^\s*View\s*$/ })
    .first()
    .click()
    .catch(deferred);

  // ── 2. Rights that have ended ──────────────────────────────────────────────────────────────
  await h.step('2. Rights that have ended, and none on cleared rights');
  await h.goToDoc(seeded.get(ENDED.id).uid);
  await recordSettled(page, assetCards, { picture: true });
  const ended = await readRecordPage(page);
  h.check(
    `${ENDED.title}: the negative banner alone, in the error tone, with the kit's text`,
    sameJson(ended.banners, [
      { id: 'rights-ended', tone: 'error', text: labels['brand.asset.rightsEnded'] },
    ]),
    JSON.stringify(ended.banners),
  );
  await h.screenshot('rights-ended');
  await h.goToDoc(seeded.get(CLEARED.id).uid);
  await recordSettled(page, assetCards, { picture: true });
  const cleared = await readRecordPage(page);
  h.check(
    `${CLEARED.title}: no banner, on rights that end in more than 30 days`,
    cleared.banners.length === 0 && cleared.cards.length === assetCards.length,
    JSON.stringify(cleared.banners),
  );

  // ── 3. The library ─────────────────────────────────────────────────────────────────────────
  await h.step('3. The asset library, narrowed by its Rights facet on the server');
  await h.goTo('/#/queues/library');
  await page
    .waitForFunction(
      () => document.querySelectorAll('.queue-page tbody tr').length > 0,
      undefined,
      {
        timeout: 30_000,
      },
    )
    .catch(deferred);
  const titles = ASSETS.map((asset) => asset.title);
  const readRows = () =>
    page
      .evaluate(() =>
        [...document.querySelectorAll('.queue-page tbody tr')].map((row) =>
          (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
        ),
      )
      .then((rows) => rowTitles(rows, titles))
      .catch(unread);
  const byRightsEnd = (assets) =>
    [...assets].sort((a, b) => expired(a).localeCompare(expired(b))).map((asset) => asset.title);
  const libraryRows = await readRows();
  h.check(
    'the library lists every seeded asset, the rights that end soonest first',
    JSON.stringify(libraryRows) === JSON.stringify(byRightsEnd(ASSETS)),
    `drawn ${JSON.stringify(libraryRows)}, expected ${JSON.stringify(byRightsEnd(ASSETS))}`,
  );
  const readFacet = (aggregate) =>
    page
      .evaluate(
        (selector) =>
          Object.fromEntries(
            [...document.querySelectorAll(selector)].map((bucket) => {
              const match = /^\s*(.+?)\s*\((\d+)\)\s*$/.exec(bucket.textContent ?? '');
              return match ? [match[1], Number(match[2])] : [bucket.textContent?.trim(), null];
            }),
          ),
        `fieldset.queue-facet[data-aggregate="${aggregate}"] .queue-facet__bucket`,
      )
      .catch(unread);
  const bucketOf = (asset) => {
    const banner = bannerFor(expired(asset));
    return banner === 'rights-ended' ? 'Ended' : banner === 'rights-ending' ? 'Ending' : 'Cleared';
  };
  const rightsFacet = await readFacet('acme_rights_agg');
  h.check(
    'the Rights facet counts the assets by rights end, from the date_range aggregate',
    sameJson(
      Object.fromEntries(Object.entries(rightsFacet ?? {}).filter(([, count]) => count > 0)),
      countBy(ASSETS, bucketOf),
    ),
    `drawn ${JSON.stringify(rightsFacet)}, expected ${JSON.stringify(countBy(ASSETS, bucketOf))}`,
  );
  const shotFacet = await readFacet('acme_shot_agg');
  h.check(
    'the Shot facet counts the assets by shot, from the terms aggregate',
    sameJson(
      shotFacet,
      countBy(ASSETS, (asset) => asset.shot),
    ),
    `drawn ${JSON.stringify(shotFacet)}`,
  );
  const narrowed = page
    .waitForRequest(
      (request) =>
        request.url().includes('/search/pp/acme_asset_library/execute') &&
        new URL(request.url()).searchParams.get('acme_rights_agg') === JSON.stringify(['Ending']),
      { timeout: 15_000 },
    )
    .catch(unread);
  await page
    .locator('fieldset.queue-facet[data-aggregate="acme_rights_agg"] .queue-facet__bucket', {
      hasText: /^\s*Ending\b/,
    })
    .locator('input')
    .click()
    .catch(deferred);
  const sent = await narrowed;
  const endingAssets = ASSETS.filter((asset) => bucketOf(asset) === 'Ending');
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      endingAssets.length,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const endingRows = await readRows();
  h.check('choosing "Ending" sends acme_rights_agg=["Ending"] to the page provider', sent !== null);
  h.check(
    'the server narrows the library to the assets whose rights end within 30 days',
    JSON.stringify(endingRows) === JSON.stringify(byRightsEnd(endingAssets)),
    `drawn ${JSON.stringify(endingRows)}, expected ${JSON.stringify(byRightsEnd(endingAssets))}`,
  );
  await h.screenshot('library-rights-ending');

  // ── 4. A product ───────────────────────────────────────────────────────────────────────────
  await h.step('4. A product page: its shots, and the shots it is still missing');
  await h.goToDoc(product.uid);
  const productFile = kitFile('layouts/AcmeProduct/view.layout.json');
  await recordSettled(
    page,
    productFile.cards.map((card) => card.id),
  );
  const productPage = await readRecordPage(page);
  const card = (id) => productPage.cards.find((each) => each.id === id);
  h.check(
    `the product card shows ${PRODUCT.title}'s style, season and colourways`,
    card('product')?.fields.find((field) => field.key === 'acmeproduct:style')?.value ===
      PRODUCT.style &&
      card('product')?.fields.find((field) => field.key === 'acmeproduct:season')?.value ===
        PRODUCT.season &&
      PRODUCT.colorways.every((colorway) =>
        card('product')
          ?.fields.find((field) => field.key === 'acmeproduct:colorways')
          ?.value.includes(colorway),
      ),
    JSON.stringify(card('product')),
  );
  const missing = SHOTS.filter((shot) => shot.product === PRODUCT.style && shot.asset === null);
  const missingRows = card('missing-shots')?.rows ?? [];
  h.check(
    `"Missing shots" lists the ${missing.length} shot(s) no asset fills, and only those`,
    missingRows.length === missing.length &&
      missing.every((shot) =>
        missingRows.some((row) => row.startsWith(`${shot.colorway} ${shot.shot}`)),
      ),
    `drawn ${JSON.stringify(missingRows)}, expected ${JSON.stringify(missing.map(shotName))}`,
  );
  const productAssets = ASSETS.filter((asset) => asset.product === PRODUCT.style)
    .map((asset) => asset.title)
    .sort((a, b) => a.localeCompare(b));
  const shotRows = rowTitles(card('shots')?.rows ?? [], titles);
  h.check(
    `"Shots" lists the product's ${productAssets.length} assets, by title`,
    JSON.stringify(shotRows) === JSON.stringify(productAssets),
    `drawn ${JSON.stringify(shotRows)}, expected ${JSON.stringify(productAssets)}`,
  );
  await h.screenshot('product-missing-shots');

  // ── 5. The layout files ────────────────────────────────────────────────────────────────────
  await h.step('5. The layout files behind the pages: configuration, no code');
  const fileCards = assetFile.cards.map((each) => ({
    id: each.id,
    heading: labels[each.labelKey],
  }));
  h.check(
    "the asset page is its file: its cards, in order, with their headings from the kit's labels",
    sameJson(
      ending.cards.map((each) => ({ id: each.id, heading: each.heading })),
      fileCards,
    ),
    `drawn ${JSON.stringify(ending.cards.map((each) => each.id))}`,
  );
  h.check(
    "the asset page's banners are its file's two, and every banner drawn is one of them",
    assetFile.banners.map((banner) => banner.id).join() === 'rights-ended,rights-ending' &&
      ending.banners.every((banner) =>
        assetFile.banners.some((declared) => declared.id === banner.id),
      ),
    JSON.stringify(assetFile.banners.map((banner) => banner.id)),
  );
  const code = [];
  (function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!['.json', '.xml', '.xsd', '.MF'].includes(extname(entry.name)))
        code.push(relative(KIT, path));
    }
  })(join(KIT, 'bundle'));
  h.check(
    "the kit's bundle holds no code: JSON, XML, XSD and its manifest only",
    code.length === 0,
    `code in the bundle: ${code.join(', ')}`,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "the server's own install is not what the app read: under the dev server the layouts come " +
      'from config:dev, as the menu, queues and labels do, which only the app registry will ' +
      'serve from a package',
  );
  h.note(
    "the plan's demo steps 2 and 3, the print rendition refused by the server and a share link, " +
      "are not this kit's yet: rights the server enforces and decision C are out of its scope",
  );
  h.note(
    "the plan's demo step 4, the review with pins, is not run here: brand-assets-review is its " +
      'steps file, which creates the asset it reviews rather than writing on a seeded one',
  );
}
