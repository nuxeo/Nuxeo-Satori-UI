/**
 * The plan's phase 5 demo step 2 (docs/business-apps/development-plan.md, "Files as records: brand
 * assets"): **the print rendition is refused, then refused again when the REST API is called
 * directly: the server enforces it.** On the brand assets kit, for the fictional Acme Outdoor, with
 * the assets module's server add-on, `nuxeo-agentic-assets`, enforcing the kit's rights policy
 * (`bundle/OSGI-INF/brand-assets-demo-rights.xml`).
 *
 *   1. In the app: an asset whose rights hold no Print channel, its print view chosen. The server
 *      refuses it, and the page says the server's own reason; no view is hidden or disabled.
 *   2. The REST API called directly, outside the app, with the same user: the print view, the
 *      print rendition, the same file through `/nxfile/`, and the original, each refused; an asset
 *      whose rights have ended refused even its web view; the server's explanation, read alone.
 *   3. What the rights cover is still served: a cleared asset's print rendition and original, the
 *      web view of the asset with no Print channel, and an ended asset's preview; and in the app,
 *      the cleared asset's print view shown.
 *
 * **What "called directly" covers:** the REST API's download endpoints, `@blob`, `@rendition` and
 * `/nxfile/`, where the add-on refuses. Automation operations that return a blob are not refused
 * by this version, and this run does not call them; the add-on's README says so, under "What it
 * does not cover", and its security review decides them.
 *
 * The kit's print rendition is the picture view `OriginalJpeg`, the picture at its own size,
 * which its policy covers by the Print channel, as the original is; the web view is `FullHD`,
 * covered by E-commerce; `Thumbnail`, `Small` and `Medium` are previews, served whatever the
 * rights. The assets it opens are the seed's (`demo/data.mjs`): `NO_PRINT`, `ENDED` and `CLEARED`.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - `nuxeo-agentic-assets` and the kit, version 0.2.0 or later, installed on the Nuxeo the app
 *   talks to, and the kit seeded with `demo/seed.mjs` recently enough that the asset with no Print
 *   channel's rights have not ended and the ended one's have, as the server's own day, in UTC,
 *   reads them: run the seed again on the day of the demo.
 * - Each of the three assets with its `Medium`, `FullHD` and `OriginalJpeg` views made.
 * - The dev server serving the kit's asset layout through `npm run config:dev` (the kit's README,
 *   "Seeing it under nx serve").
 * - `NUXEO_USER` and `NUXEO_PASS`: anyone who may read the kit's workspace. An administrator is
 *   refused as anyone else is, and the run says when it ran as one. `NUXEO_URL`, default
 *   `http://localhost:8080`, is where the REST API is called directly.
 *
 *   npm run beta:evidence -- brand-assets-rights
 *
 * Load-bearing checks: each 403 the server answers, in the app and called directly, on the use the
 * rights do not cover; the page's reason, the code the server's enricher gives for that view after
 * the 403, and its words; the refused view's button still offered and pressed. Negative ones, each
 * a use the rights cover served with its bytes: a cleared asset's print view, print rendition and
 * original; the web view and a preview of the asset with no Print channel; an ended asset's
 * preview; and, in the app, the cleared asset's print view shown from a blob URL with no refusal.
 *
 * Not covered, and said in notes: the server's paths beyond the download endpoints this calls,
 * which the add-on's security review settles (nuxeo-agentic-assets/README.md, "What it does not
 * cover"); the layouts come from `config:dev`, not the package.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'brand-assets-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { ASSETS, MARKER, WORKSPACE } = await import(join(KIT, 'demo', 'data.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The kit has no
 * demo people of its own, so no user is named.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [],
    who: "anyone who may read the kit's workspace; an administrator is refused as anyone else is",
  },
  signsInAs: [],
  needs: [
    'nuxeo-agentic-assets and the kit 0.2.0 or later installed, and the kit seeded on the day of the demo',
    "each of the three assets' Medium, FullHD and OriginalJpeg views made",
    "the dev server with `npm run config:dev` serving the kit's asset layout",
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
/** The assets the demo opens: one with no Print channel, one whose rights have ended, one cleared. */
const NO_PRINT = ASSETS.find((asset) => asset.id === 'ast-503');
const ENDED = ASSETS.find((asset) => asset.id === 'ast-505');
const CLEARED = ASSETS.find((asset) => asset.id === 'ast-501');

/** The kit's print rendition, its web view and a preview, by the titles Nuxeo gives the views. */
const PRINT = 'OriginalJpeg';
const WEB = 'FullHD';
const PREVIEW = 'Medium';

/** Where the REST API is called directly: Nuxeo itself, not the app or its dev server. */
const NUXEO = (process.env['NUXEO_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, `AI.*` operations come from a package
 * this server may lack, and the recently-viewed list asks for thumbnails a record with no file has
 * not got. The refused view's own 403 is added once its address is known: it is the point.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const deferred = () => undefined;
const unread = () => null;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));

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

/** The decision the server's `assetRights` explanation gives for `kind` `name`, or `otherwise`. */
function decisionFor(rights, kind, name) {
  if (!rights) return null;
  const listed = rights.uses?.find((use) => use.use === kind && use.name === name);
  return listed ?? rights.otherwise ?? null;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the add-on and the kit installed, seeded, and the layout served');
  const { username, password } = requireStepCredentials(
    'read the seeded assets and call the REST API',
  );
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  /** A GET of Nuxeo itself, as any client of the REST API sends one: its status, type and size. */
  const direct = async (path, headers = {}) => {
    try {
      const response = await fetch(`${NUXEO}/nuxeo${path}`, {
        headers: { Authorization: basic, ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        length: bytes.length,
        bytes,
      };
    } catch {
      return null;
    }
  };
  const json = (answer) => {
    try {
      return answer?.status === 200 ? JSON.parse(answer.bytes.toString('utf8')) : null;
    } catch {
      return null;
    }
  };

  const type = await direct('/api/v1/config/types/AcmeAsset');
  h.requirePrecondition(
    "the kit's stand-in model is installed",
    type?.status === 200,
    `GET /api/v1/config/types/AcmeAsset answered ${type?.status ?? 'nothing'}: install the kit (its README)`,
  );

  /** A seeded asset, read with every property and the add-on's explanation of its rights. */
  const readAsset = async (asset) =>
    json(
      await direct(`/api/v1/path${ROOT}/assets/${asset.id}`, {
        properties: '*',
        'enrichers.document': 'assetRights',
      }),
    );
  const seeded = new Map();
  for (const asset of [NO_PRINT, ENDED, CLEARED]) {
    const doc = await readAsset(asset);
    if (doc?.type === 'AcmeAsset' && doc.properties?.['dc:source'] === MARKER)
      seeded.set(asset.id, doc);
  }
  h.requirePrecondition(
    "the seeded assets are there, each carrying the seed's marker",
    seeded.size === 3,
    `found ${[...seeded.keys()].join(', ') || 'none'} of ${NO_PRINT.id}, ${ENDED.id} and ${CLEARED.id}: run demo/seed.mjs`,
  );
  const rightsOf = (asset) => seeded.get(asset.id).contextParameters?.assetRights ?? null;
  h.requirePrecondition(
    "nuxeo-agentic-assets is installed and the kit's rights policy is in force",
    [NO_PRINT, ENDED, CLEARED].every((asset) => rightsOf(asset)?.type === 'AcmeAsset'),
    'the assetRights enricher answered nothing for an AcmeAsset: install nuxeo-agentic-assets and ' +
      'the kit at 0.2.0 or later (their READMEs)',
  );
  h.requirePrecondition(
    `the seed's rights still hold on the server's day: ${NO_PRINT.id} running with no Print channel, ${ENDED.id} ended, ${CLEARED.id} running with Print`,
    rightsOf(NO_PRINT).ended === false &&
      Array.isArray(rightsOf(NO_PRINT).channels) &&
      !rightsOf(NO_PRINT).channels.includes('Print') &&
      rightsOf(ENDED).ended === true &&
      rightsOf(CLEARED).ended === false &&
      rightsOf(CLEARED).channels?.includes('Print') === true,
    `the server reads ${JSON.stringify([NO_PRINT, ENDED, CLEARED].map((asset) => ({ id: asset.id, ended: rightsOf(asset).ended, channels: rightsOf(asset).channels })))}: run demo/seed.mjs again today`,
  );

  /** Each asset's views, by title, at their places in `picture:views`. */
  const placeOf = (asset, title) => {
    const views = seeded.get(asset.id).properties?.['picture:views'];
    const index = Array.isArray(views) ? views.findIndex((view) => view?.title === title) : -1;
    return index >= 0 && views[index]?.content ? index : null;
  };
  const missing = [];
  for (const asset of [NO_PRINT, ENDED, CLEARED])
    for (const title of [PREVIEW, WEB, PRINT])
      if (placeOf(asset, title) === null) missing.push(`${asset.id} ${title}`);
  h.requirePrecondition(
    `each asset has its ${PREVIEW}, ${WEB} and ${PRINT} views`,
    missing.length === 0,
    `not made yet: ${missing.join(', ')}. Wait for Nuxeo to make the views, or seed again`,
  );

  const layoutPath = 'layouts/AcmeAsset/view.layout.json';
  const servedLayout = await page.request
    .get(`${h.baseUrl}/agentic-ui-config/${layoutPath}`)
    .catch(unread);
  const { content, source } = unwrap(
    servedLayout?.ok() ? await servedLayout.json().catch(unread) : null,
  );
  h.requirePrecondition(
    "the dev server serves the kit's asset layout",
    sameJson(content, kitFile(layoutPath)) &&
      (source === null || resolve(REPO, source) === join(CONFIG, layoutPath)),
    `not the kit's (${servedLayout?.status()}): run the kit README's config:dev command, then restart the dev server`,
  );

  const me = json(await direct('/api/v1/me'));
  const viewPath = (asset, title) =>
    `/api/v1/id/${seeded.get(asset.id).uid}/@blob/picture:views/${placeOf(asset, title)}/content`;
  // The one 403 the app is meant to meet: the print view of the asset with no Print channel.
  const refusedInApp = `HTTP 403 /nuxeo${viewPath(NO_PRINT, PRINT)}`;

  /** The record page's picture, as drawn: the view shown, its image, and the refusal if any. */
  const readPicture = () =>
    page
      .evaluate(() => {
        const refusal = document.querySelector('lib-record-picture-views nxs-banner[data-refusal]');
        return {
          view:
            document.querySelector('.record-picture__figure')?.getAttribute('data-view') ?? null,
          src: document.querySelector('.record-picture__image')?.getAttribute('src') ?? null,
          refusal: refusal?.getAttribute('data-refusal') ?? null,
          text: refusal?.querySelector('.nxs-banner__message')?.textContent?.trim() ?? null,
          // Each view is an `nxs-button`: its title on the element, its state on the native button.
          buttons: [...document.querySelectorAll('.record-picture__view')].map((view) => {
            const button = view.querySelector('button');
            return {
              title: view.getAttribute('data-view'),
              disabled: button
                ? button.disabled || button.getAttribute('aria-disabled') === 'true'
                : null,
              pressed: button?.getAttribute('aria-pressed') === 'true',
            };
          }),
        };
      })
      .catch(unread);

  /** Open an asset's page, wait for its first view, choose `title`, and wait for the server's answer. */
  const choose = async (asset, title) => {
    await h.goToDoc(seeded.get(asset.id).uid);
    await page
      .waitForFunction(
        () => document.querySelector('.record-picture__image')?.getAttribute('src') != null,
        undefined,
        { timeout: 30_000 },
      )
      .catch(deferred);
    const answered = page
      .waitForResponse((response) => response.url().includes(viewPath(asset, title)), {
        timeout: 30_000,
      })
      .catch(unread);
    await page
      .locator(`.record-picture__view[data-view="${title}"]`)
      .first()
      .click()
      .catch(deferred);
    return answered;
  };

  // ── 1. In the app: the print view refused, with the server's reason ────────────────────────
  await h.step(`1. In the app: ${NO_PRINT.title}'s print view, refused by the server`);
  await h.login();
  const explained = page
    .waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/id/${seeded.get(NO_PRINT.id).uid}`) &&
        response.request().headers()['enrichers.document'] === 'assetRights',
      { timeout: 30_000 },
    )
    .catch(unread);
  const printAnswer = await choose(NO_PRINT, PRINT);
  h.check(
    `the server answers the print view, ${PRINT}, with 403`,
    printAnswer?.status() === 403,
    `answered ${printAnswer?.status() ?? 'nothing'}`,
  );
  await page
    .waitForSelector('lib-record-picture-views nxs-banner[data-refusal]', { timeout: 30_000 })
    .catch(deferred);
  const explanation = await explained;
  const said = decisionFor(
    (await explanation?.json().catch(unread))?.contextParameters?.assetRights,
    'view',
    PRINT,
  );
  const refused = await readPicture();
  h.check(
    "the page says the reason the server's explanation gives, asked after the 403",
    said?.allowed === false &&
      said?.reason === 'channel-not-covered' &&
      said?.channel === 'Print' &&
      refused?.refusal === said?.reason,
    `server: ${JSON.stringify(said)}, page: ${refused?.refusal}`,
  );
  h.check(
    "in the platform's words: the channel that covers the view and the ones the rights cover",
    refused?.text ===
      `The server refused this view: it is covered by the Print channel, and this asset's rights cover ${new Intl.ListFormat('en', { type: 'conjunction' }).format(rightsOf(NO_PRINT).channels)} only.`,
    refused?.text,
  );
  const printButton = refused?.buttons.find((button) => button.title === PRINT);
  h.check(
    'the print view is not hidden or disabled: it stays offered and pressed, and no image is shown',
    printButton?.disabled === false &&
      printButton?.pressed === true &&
      refused?.view === PRINT &&
      refused?.src === null,
    JSON.stringify(refused),
  );
  await h.screenshot('print-refused-in-app');

  // ── 2. The REST API, called directly ───────────────────────────────────────────────────────
  await h.step('2. The REST API, called directly: refused again, by the server');
  const noPrintUid = seeded.get(NO_PRINT.id).uid;
  const refusals = [
    ['the print view through @blob', viewPath(NO_PRINT, PRINT)],
    [
      `the print rendition through @rendition/${PRINT}`,
      `/api/v1/id/${noPrintUid}/@rendition/${PRINT}`,
    ],
    [
      'the same file through /nxfile/',
      `/nxfile/default/${noPrintUid}/picture:views/${placeOf(NO_PRINT, PRINT)}/content`,
    ],
    ['the original through @blob/file:content', `/api/v1/id/${noPrintUid}/@blob/file:content`],
    ['the original as the mainBlob rendition', `/api/v1/id/${noPrintUid}/@rendition/mainBlob`],
  ];
  for (const [what, path] of refusals) {
    const answer = await direct(path);
    h.check(
      `${NO_PRINT.id}, ${what}: 403`,
      answer?.status === 403,
      `GET ${path}: ${answer?.status ?? 'no answer'}`,
    );
  }
  const endedUid = seeded.get(ENDED.id).uid;
  for (const [what, path] of [
    [`the web view, ${WEB}, through @blob`, viewPath(ENDED, WEB)],
    [`the web rendition through @rendition/${WEB}`, `/api/v1/id/${endedUid}/@rendition/${WEB}`],
  ]) {
    const answer = await direct(path);
    h.check(
      `${ENDED.id}, whose rights have ended, ${what}: 403`,
      answer?.status === 403,
      `GET ${path}: ${answer?.status ?? 'no answer'}`,
    );
  }
  const fresh = await readAsset(NO_PRINT);
  const endedFresh = await readAsset(ENDED);
  h.check(
    "the server's explanation, read alone: the print view refused for its channel, the ended asset's web view for its end day",
    sameJson(decisionFor(fresh?.contextParameters?.assetRights, 'view', PRINT), {
      use: 'view',
      name: PRINT,
      allowed: false,
      reason: 'channel-not-covered',
      channel: 'Print',
    }) &&
      decisionFor(endedFresh?.contextParameters?.assetRights, 'view', WEB)?.reason ===
        'rights-ended',
    JSON.stringify([
      decisionFor(fresh?.contextParameters?.assetRights, 'view', PRINT),
      decisionFor(endedFresh?.contextParameters?.assetRights, 'view', WEB),
    ]),
  );
  h.note(
    me?.isAdministrator === true
      ? `run as ${me.id}, an administrator: the refusals above held for an administrator`
      : `run as ${me?.id ?? username}, who is not an administrator; the add-on reads no user, so an administrator is refused alike, which a run as one shows`,
  );

  // ── 3. What the rights cover is still served ───────────────────────────────────────────────
  await h.step('3. What the rights cover is still served');
  const clearedUid = seeded.get(CLEARED.id).uid;
  const served = [
    [
      `${CLEARED.id}, cleared on every channel, its print view`,
      viewPath(CLEARED, PRINT),
      'image/jpeg',
    ],
    [
      `${CLEARED.id}, its print rendition through @rendition/${PRINT}`,
      `/api/v1/id/${clearedUid}/@rendition/${PRINT}`,
      'image/jpeg',
    ],
    [`${CLEARED.id}, its original`, `/api/v1/id/${clearedUid}/@blob/file:content`, 'image/'],
    [`${NO_PRINT.id}, its web view, covered by E-commerce`, viewPath(NO_PRINT, WEB), 'image/jpeg'],
    [`${NO_PRINT.id}, its preview, ${PREVIEW}`, viewPath(NO_PRINT, PREVIEW), 'image/jpeg'],
    [
      `${ENDED.id}, whose rights have ended, its preview, ${PREVIEW}`,
      viewPath(ENDED, PREVIEW),
      'image/jpeg',
    ],
  ];
  for (const [what, path, kind] of served) {
    const answer = await direct(path);
    h.check(
      `${what}: served, with its bytes`,
      answer?.status === 200 && answer.type.startsWith(kind) && answer.length > 0,
      `GET ${path}: ${answer?.status ?? 'no answer'}, ${answer?.type}, ${answer?.length} bytes`,
    );
  }
  const clearedAnswer = await choose(CLEARED, PRINT);
  await page
    .waitForFunction(
      (title) =>
        document.querySelector('.record-picture__figure')?.getAttribute('data-view') === title &&
        document.querySelector('.record-picture__image')?.getAttribute('src')?.startsWith('blob:'),
      PRINT,
      { timeout: 30_000 },
    )
    .catch(deferred);
  const shown = await readPicture();
  h.check(
    `in the app, ${CLEARED.title}'s print view is shown, from a blob URL, with no refusal`,
    clearedAnswer?.status() === 200 &&
      shown?.view === PRINT &&
      shown?.src?.startsWith('blob:') === true &&
      shown?.refusal === null,
    JSON.stringify({ status: clearedAnswer?.status(), ...shown }),
  );
  await h.screenshot('print-served-when-cleared');

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    ...ENVIRONMENTAL_ERRORS,
    refusedInApp,
  ]);
  h.note(
    'the add-on refuses at the platform download endpoints this run calls; the server paths it does ' +
      'not cover yet are listed in nuxeo-agentic-assets/README.md and are for its security review',
  );
  h.note(
    'the asset layout comes from config:dev under the dev server, not from the package: the app ' +
      'registry serves it from a package',
  );
}
