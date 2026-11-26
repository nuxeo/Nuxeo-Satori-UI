/**
 * The brand assets acceptance test, D (docs/business-apps/acceptance-tests.md, section 6), judged
 * on the participant's package, never on the brand assets kit: the asset and product pages a
 * presales engineer rebuilt from nothing (phase 5), and the library a brand team reaches them from.
 *
 * The target is the protocol's target sheet, items D1 to D9. Each check names its item. The
 * records it opens and the values it expects are the brand assets seed's, read from the reference
 * kit's `demo/data.mjs`, which prepared the server, and each asset's rights end from the server,
 * where the seed wrote it relative to the day it ran; nothing else of the reference kit is read but
 * its layouts, to refuse a copy of them. What the participant chose, their card ids, headings and
 * label keys, is read from their package.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - `ACCEPTANCE_PACKAGE`, the participant's package folder, and not the reference kit's;
 *   `ACCEPTANCE_BASE`, the commit the session started from; `ACCEPTANCE_QUEUE` when the package
 *   has more than one queue.
 * - The reference kit back in the checkout, for its seed data:
 *   `git checkout -- business-apps/packages/brand-assets-demo`.
 * - The brand assets kit installed on the server, and seeded with its `demo/seed.mjs` recently
 *   enough that one asset's rights still end within 30 days and one's have passed, with no asset,
 *   shot or product the seed did not write.
 * - The dev server with `npm run config:dev` serving the participant's files, not the kit's.
 * - `NUXEO_USER` and `NUXEO_PASS`: anyone who may read the kit's workspace. The kit has no demo
 *   people: its seed creates none.
 *
 *   ACCEPTANCE_PACKAGE=business-apps/packages/<package> ACCEPTANCE_BASE=<commit> \
 *   NUXEO_USER=<user> NUXEO_PASS=<password> npm run beta:evidence -- acceptance-brand-assets
 *
 * Load-bearing checks: every target item, each against the seed's values or the server's answers;
 * each page drawn as the participant's file says; the library narrowed on the server. Negative
 * ones: the other banner absent on each asset, no banner on cleared rights, no original downloaded
 * by the three asset pages, whose positive control is the Annotations tab downloading the cleared
 * asset's once; each layout not the reference kit's; no code in the bundle; no file outside the
 * package changed since the session's commit; no stand-in model in the package.
 *
 * Not covered, and said in notes: the pipeline, which the protocol runs as a command; the rights the
 * server enforces, which are the add-on's and the kit's, not the participant's package; placing a
 * pin in the review, which `brand-assets-review.mjs` does on an asset of its own; and whether a
 * prospect would accept the result.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';
import {
  ENVIRONMENTAL_ERRORS,
  alwaysShown,
  changedOutside,
  checkQueueNarrows,
  codeInPackage,
  deferred,
  differsFromFile,
  fieldsOf,
  listsOf,
  notServedFromPackage,
  participantPackage,
  participantQueue,
  readAppMenu,
  readJson,
  readRecordPage,
  recordSettled,
  repositoryQuery,
  sameJson,
  sessionBase,
  unheldFileErrors,
  unread,
  withoutSchema,
} from './acceptance/participant.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The reference kit, by one path: its seed prepared the server, and its layouts are the answer. */
const REFERENCE = join(REPO, 'business-apps/packages/brand-assets-demo');
const REFERENCE_LAYOUTS = join(REFERENCE, 'bundle', 'agentic-ui-config', 'layouts');
const SEED_DATA = join(REFERENCE, 'demo', 'data.mjs');

/** The records the target names: the protocol's target sheet. */
const ENDING_ID = 'ast-503';
const ENDED_ID = 'ast-505';
const CLEARED_ID = 'ast-501';
const PRODUCT_STYLE = 'AO-3101';

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

/** Which banner the target asks for on a rights end: ended, ending within 30 days, or none. */
function bannerFor(stored) {
  const days = daysFromToday(stored);
  return days < 0 ? 'ended' : days <= 30 ? 'ending' : null;
}

/** A banner's tone as drawn: `nxs-banner` draws layout version 2's `negative` as `error`. */
const TONES = { ending: 'warning', ended: 'error' };

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step("Preconditions: the participant's package, the seeded server, the files served");
  const pkg = participantPackage(REPO, REFERENCE);
  h.requirePrecondition(
    "the participant's package is named, and is not the reference kit",
    !pkg.problem,
    pkg.problem,
  );
  const base = sessionBase(REPO);
  h.requirePrecondition(
    'the commit the session started from is named',
    !base.problem,
    base.problem,
  );
  h.requirePrecondition(
    "the reference kit's seed data is back in the checkout",
    existsSync(SEED_DATA),
    'restore it: git checkout -- business-apps/packages/brand-assets-demo',
  );
  const {
    ASSETS,
    MARKER,
    PRODUCTS,
    SHOTS,
    VIDEOS = [],
    WORKSPACE,
    shotName,
  } = await import(pathToFileURL(SEED_DATA).href);
  const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
  const ENDING = ASSETS.find((asset) => asset.id === ENDING_ID);
  const ENDED = ASSETS.find((asset) => asset.id === ENDED_ID);
  const CLEARED = ASSETS.find((asset) => asset.id === CLEARED_ID);
  const PRODUCT = PRODUCTS.find((product) => product.style === PRODUCT_STYLE);
  const reader = requireStepCredentials('read the seeded records');

  const types = [];
  for (const type of ['AcmeAsset', 'AcmeProduct', 'AcmeShot']) {
    const answer = await page.request
      .get(`${h.baseUrl}/nuxeo/api/v1/config/types/${type}`)
      .catch(unread);
    if (answer?.status() !== 200) types.push(type);
  }
  h.requirePrecondition(
    "the brand assets kit's stand-in model is on the server",
    types.length === 0,
    `the server has no ${types.join(', ')} type: install the kit (its README)`,
  );
  const read = (path) =>
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
    `not found as seeded: ${absent.join(', ')}. Run the kit's demo/seed.mjs against this server`,
  );
  const expired = (asset) => seeded.get(asset.id).properties['dc:expired'];
  h.requirePrecondition(
    `the seed's dates hold today: ${ENDING.id}'s rights end within 30 days, ${ENDED.id}'s have ended, ${CLEARED.id}'s are clear`,
    bannerFor(expired(ENDING)) === 'ending' &&
      bannerFor(expired(ENDED)) === 'ended' &&
      bannerFor(expired(CLEARED)) === null,
    `their rights end on ${expired(ENDING)}, ${expired(ENDED)} and ${expired(CLEARED)}: run the seed again today`,
  );
  const places = {
    AcmeAsset: ASSETS.map((asset) => `${ROOT}/assets/${asset.id}`),
    AcmeShot: SHOTS.map((shot) => `${ROOT}/shots/${shotName(shot)}`),
    AcmeProduct: PRODUCTS.map((each) => `${ROOT}/products/${each.style.toLowerCase()}`),
  };
  const live = 'ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0';
  const others = [];
  let judged = true;
  for (const [type, expected] of Object.entries(places)) {
    const entries = await repositoryQuery(
      h.baseUrl,
      reader,
      `SELECT * FROM ${type} WHERE ${live}`,
      'dublincore',
    );
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
      ? `${others.length} record(s) not seeded: ${others.slice(0, 3).join(', ')}. Run it on a server without them`
      : 'a repository query was not answered whole',
  );

  const { config } = pkg;
  // A package with no queue fails D9; one with several needs the facilitator to say which.
  const queue = participantQueue(config);
  h.requirePrecondition(
    "the package's library queue is known, when it has more than one",
    queue.id !== undefined || queue.none,
    queue.problem,
  );
  const needed = [
    'labels/en.json',
    'navigation.json',
    'layouts/AcmeAsset/view.layout.json',
    'layouts/AcmeProduct/view.layout.json',
    ...(queue.id ? [`queues/${queue.id}.json`] : []),
  ];
  // A file the target needs and the package lacks is the participant's to write: it fails the
  // items it serves, below, and is named here. What the package holds must be what is served.
  const lacking = needed.filter((path) => !existsSync(join(config, path)));
  h.check(
    "the package holds every file its target's pages need, a queue among them",
    lacking.length === 0 && queue.id !== undefined,
    `missing: ${[...lacking, ...(queue.id ? [] : ['queues/<a queue>.json'])].join(', ')}`,
  );
  const differing = await notServedFromPackage(
    page,
    h.baseUrl,
    REPO,
    config,
    needed.filter((path) => !lacking.includes(path)),
  );
  h.requirePrecondition(
    "the dev server serves the participant's own files, as the package holds them",
    differing.length === 0,
    `not the package's: ${differing.join(', ')}. Run config:dev on the package's files, from ` +
      "the participant's checkout, whose dev server APP_URL names",
  );
  const labels = readJson(join(config, 'labels', 'en.json'))?.labels ?? {};
  const layout = (type) => readJson(join(config, 'layouts', type, 'view.layout.json'));
  const texts = new Set(Object.values(labels));

  // ── 1. The asset page, rights ending ──────────────────────────────────────────────────────
  await h.step(`1. The asset page, on ${ENDING.title}: items D1 to D5`);
  await h.login();
  const asked = [];
  const listen = (request) => asked.push({ url: request.url(), type: request.resourceType() });
  page.on('request', listen);
  const assetFile = layout('AcmeAsset');
  const assetCards = alwaysShown(assetFile);
  const openAsset = async (asset) => {
    await h.goToDoc(seeded.get(asset.id).uid);
    await recordSettled(page, assetCards);
    await page
      .waitForFunction(
        () => document.querySelector('.record-picture__image')?.getAttribute('src') != null,
        undefined,
        { timeout: 30_000 },
      )
      .catch(deferred);
    return readRecordPage(page);
  };
  const ending = await openAsset(ENDING);
  h.check(
    "D1. the asset page is the participant's file: its cards in order, each headed from the package",
    differsFromFile(ending, assetFile, labels) === null,
    differsFromFile(ending, assetFile, labels) ?? '',
  );
  h.check(
    'D1. the picture comes first, under the banners: a view of it, from a blob URL',
    ending.picture.shown &&
      ending.picture.first &&
      ending.picture.underBanners &&
      typeof ending.picture.view === 'string' &&
      ending.picture.src?.startsWith('blob:'),
    JSON.stringify(ending.picture),
  );
  const original = /\/@blob\/(file:content|blobholder:0)(\?|$)/;
  h.check(
    'D1. the original file is not downloaded: the page shows a view',
    !asked.some((request) => original.test(request.url)),
    JSON.stringify(asked.filter((request) => original.test(request.url)).map((r) => r.url)),
  );
  h.check(
    `D2. ${ENDING.title}: a warning banner alone, its text from the package's labels`,
    ending.banners.length === 1 &&
      ending.banners[0].tone === TONES.ending &&
      texts.has(ending.banners[0].text),
    JSON.stringify(ending.banners),
  );
  const values = fieldsOf(ending);
  const has = (text) => values.some((field) => field.value.includes(text));
  h.check(
    `D3. fields show the asset's title, product, colourway, shot and credit`,
    [ENDING.title, ENDING.product, ENDING.colorway, ENDING.shot, ENDING.credit].every(has),
    JSON.stringify(values.map((field) => [field.key, field.value])),
  );
  h.check(
    'D4. fields show its rights: the end date, the channels as chips, the regions and the rights holder',
    (values.find((field) => field.key === 'dc:expired')?.value ?? '') !== '' &&
      values.some((field) => ENDING.channels.every((channel) => field.chips.includes(channel))) &&
      has(ENDING.regions) &&
      has(ENDING.rights),
    JSON.stringify(values.map((field) => [field.key, field.value, field.chips])),
  );
  h.check(
    'D5. the asset page has its history, and the review on the picture',
    ending.cards.some((card) => card.timeline) && ending.picture.review,
    JSON.stringify({
      timeline: ending.cards.map((card) => card.timeline),
      review: ending.picture.review,
    }),
  );
  const copied = ['AcmeAsset', 'AcmeProduct'].filter((type) => {
    const theirs = withoutSchema(layout(type));
    const reference = withoutSchema(readJson(join(REFERENCE_LAYOUTS, type, 'view.layout.json')));
    return theirs !== null && reference !== null && sameJson(theirs, reference);
  });
  h.check(
    "the participant's layouts are their own: neither is the reference kit's",
    copied.length === 0,
    `the same as the reference's: ${copied.join(', ')}`,
  );
  await h.screenshot('asset-rights-ending');

  // ── 2. Rights ended, and cleared ───────────────────────────────────────────────────────────
  await h.step('2. Rights that have ended, and cleared rights: item D2');
  const ended = await openAsset(ENDED);
  h.check(
    `D2. ${ENDED.title}: a negative banner alone, its text from the package's labels`,
    ended.banners.length === 1 &&
      ended.banners[0].tone === TONES.ended &&
      texts.has(ended.banners[0].text),
    JSON.stringify(ended.banners),
  );
  await h.screenshot('asset-rights-ended');
  const cleared = await openAsset(CLEARED);
  h.check(
    `D2. ${CLEARED.title}: no banner, on rights that end in more than 30 days`,
    cleared.banners.length === 0 && differsFromFile(cleared, assetFile, labels) === null,
    JSON.stringify(cleared.banners),
  );
  h.check(
    'D1. none of the three asset pages asked for its original',
    !asked.some((request) => original.test(request.url)),
    JSON.stringify(asked.filter((request) => original.test(request.url)).map((r) => r.url)),
  );
  // The positive control for those checks: the Annotations tab's viewer shows the original, so
  // opening it downloads it, and the listener and the address above see that request. On the
  // cleared asset, whose rights cover its original.
  await page
    .locator('[role="tab"]', { hasText: /^\s*Annotations\s*$/ })
    .first()
    .click()
    .catch(deferred);
  await page
    .waitForResponse((response) => original.test(response.url()), { timeout: 15_000 })
    .catch(deferred);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(deferred);
  const annotated = asked.filter((request) => original.test(request.url));
  h.check(
    `opening the Annotations tab on ${CLEARED.title} downloads its original, once: what the checks above look for`,
    annotated.length === 1 && annotated[0].url.includes(`/id/${seeded.get(CLEARED.id).uid}/`),
    JSON.stringify(annotated.map((request) => request.url)),
  );
  page.off('request', listen);
  await page
    .locator('[role="tab"]', { hasText: /^\s*View\s*$/ })
    .first()
    .click()
    .catch(deferred);

  // ── 3. The product page ────────────────────────────────────────────────────────────────────
  await h.step(`3. The product page, on ${PRODUCT.title}: items D6 to D8`);
  await h.goToDoc(product.uid);
  const productFile = layout('AcmeProduct');
  await recordSettled(page, alwaysShown(productFile));
  const productPage = await readRecordPage(page);
  h.check(
    "D6. the product page is the participant's file: its cards in order, each headed from the package",
    differsFromFile(productPage, productFile, labels) === null,
    differsFromFile(productPage, productFile, labels) ?? '',
  );
  const productValues = fieldsOf(productPage);
  h.check(
    `D6. fields show the product's style, season, colourways and channels as chips, and launch date`,
    productValues.some((field) => field.value === PRODUCT.style) &&
      productValues.some((field) => field.value === PRODUCT.season) &&
      productValues.some((field) =>
        PRODUCT.colorways.every((each) => field.chips.includes(each)),
      ) &&
      productValues.some((field) => PRODUCT.channels.every((each) => field.chips.includes(each))) &&
      (productValues.find((field) => field.key === 'acmeproduct:launch')?.value ?? '') !== '',
    JSON.stringify(productValues.map((field) => [field.key, field.value, field.chips])),
  );
  const missingShots = SHOTS.filter(
    (shot) => shot.product === PRODUCT.style && shot.asset === null,
  );
  const productAssets = ASSETS.filter((asset) => asset.product === PRODUCT.style);
  const titles = productAssets.map((asset) => asset.title);
  const lists = listsOf(productPage);
  const assetList = lists.find((card) =>
    card.rows.some((row) => titles.some((t) => row.includes(t))),
  );
  const missingList = lists.find((card) => card !== assetList);
  h.check(
    `D7. a list shows the ${missingShots.length} shot(s) the product still misses, and only those`,
    missingList !== undefined &&
      missingList.rows.length === missingShots.length &&
      missingShots.every((shot) =>
        missingList.rows.some((row) => row.includes(shot.colorway) && row.includes(shot.shot)),
      ),
    JSON.stringify(missingList?.rows ?? []),
  );
  h.check(
    `D8. a list shows the product's ${productAssets.length} assets, and only those`,
    assetList !== undefined &&
      assetList.rows.length === productAssets.length &&
      titles.every((title) => assetList.rows.some((row) => row.includes(title))),
    JSON.stringify(assetList?.rows ?? []),
  );
  await h.screenshot('product');

  // ── 4. The library ─────────────────────────────────────────────────────────────────────────
  await h.step(`4. The library, ${queue.id ?? '(none)'}, narrowed on the server: item D9`);
  h.check('D9. the package has a queue', queue.id !== undefined, queue.problem ?? '');
  if (queue.id !== undefined) {
    const queueFile = readJson(join(config, 'queues', `${queue.id}.json`));
    await h.goTo('/#/home');
    const menu = (await readAppMenu(page)) ?? [];
    const entries = readJson(join(config, 'navigation.json'))?.entries ?? [];
    h.check(
      `D9. the menu has the package's entry for the library ${queue.id}`,
      entries.some((entry) => entry.queue === queue.id && menu.includes(`appMenu.${entry.id}`)),
      `drawn ${JSON.stringify(menu)}`,
    );
    await checkQueueNarrows(page, h, { id: queue.id, queue: queueFile, labels, item: 'D9' });
    // From 0.2.2 the seed writes two videos, which the reference kit's library lists too: a row
    // may show a video's title.
    const libraryTitles = [...ASSETS, ...VIDEOS].map((asset) => asset.title);
    const rows =
      (await page
        .evaluate(() =>
          [...document.querySelectorAll('.queue-page tbody tr')].map((row) => row.innerText ?? ''),
        )
        .catch(unread)) ?? [];
    h.check(
      'D9. the library lists assets: each row shows a seeded asset title',
      rows.length > 0 && rows.every((row) => libraryTitles.some((title) => row.includes(title))),
      JSON.stringify(rows),
    );
  }
  await h.screenshot('library-narrowed');

  // ── 5. The package ─────────────────────────────────────────────────────────────────────────
  await h.step('5. The package: configuration only, and nothing else changed');
  const code = codeInPackage(pkg.dir);
  h.check(
    "the package's bundle holds no code: JSON, XML, XSD and its manifest only",
    code.length === 0,
    `code in the bundle: ${code.join(', ')}`,
  );
  const outside = changedOutside(REPO, pkg.dir, base.commit);
  h.check(
    `nothing outside ${pkg.shown} differs from the session's commit: no Angular code, no change to the platform`,
    Array.isArray(outside) && outside.length === 0,
    outside === null ? 'git did not answer' : `changed: ${outside.slice(0, 10).join(', ')}`,
  );
  const schemas = join(pkg.dir, 'bundle', 'schemas');
  const model = existsSync(schemas)
    ? readdirSync(schemas).filter((name) => name.endsWith('.xsd'))
    : [];
  h.check(
    "the package ships no stand-in model: it is built on the server's",
    model.length === 0 && !existsSync(join(pkg.dir, 'content-model.json')),
    `schemas: ${model.join(', ')}`,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    ...ENVIRONMENTAL_ERRORS,
    ...unheldFileErrors(config),
  ]);
  h.note(
    "the pipeline is not run here: the protocol runs it as a command, with the server's model",
  );
  h.note(
    "the rights the server enforces are the kit's and the add-on's, not the participant's " +
      'package: brand-assets-rights checks them',
  );
  h.note(
    'a pin is not placed in the review: brand-assets-review does that, on an asset it creates',
  );
}
