#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the brand assets kit's fictional records, so that its asset pages, its
 * product pages and its library have something to show: two products, six pictures and the
 * products' shot list, for the fictional Acme Outdoor, from `data.mjs`. The pictures are drawn by
 * `png.mjs`; nothing is downloaded.
 *
 *   node business-apps/packages/brand-assets-demo/demo/seed.mjs
 *
 * The package must be installed first: the records are of its stand-in model's types.
 *
 * **`--preview`, before the package is installed:** the six pictures only, as the platform's own
 * `Picture`, under the workspace's `preview` folder, with their titles, rights end dates and rights
 * holders, and none of the kit's own properties, which no type on the server has yet. It is for
 * looking at the asset page in dev mode, with the kit's asset layout served for `Picture`
 * (README, "Previewing the asset page before the package is installed"). It needs none of the kit's
 * types, and checks only that Nuxeo made each picture's views.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset. Any user
 *                            who may create a workspace under /default-domain/workspaces.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *   NUXEO_INDEX_WAIT_MS      how long the checks are asked again while Nuxeo makes the picture
 *                            views and the search index catches up, default 60000
 *
 * **It writes only in its own workspace,** /default-domain/workspaces/acme-brand-assets, and only
 * documents it created: every document it writes carries `data.mjs`'s `MARKER` as its `dc:source`.
 * Before anything is written, it reads every place it would write, and a document there that does
 * not carry the marker, or is not of the type the seed would write, stops the run with exit 2,
 * untouched. It creates no user and no group, and grants no permission.
 *
 * **Safe to run twice.** Each record has a fixed place, named by its id. A record already there has
 * `data.mjs`'s values written over its own, dates included, which `data.mjs` counts from the day
 * the seed runs; one in the trash at its place is restored. A picture already holding the same
 * bytes is not uploaded again. A record trashed and renamed by Nuxeo is no longer at its place, and
 * a new one is created there; the trashed one is left in the trash.
 *
 * **It checks what it seeded.** Last, as `check` says: Nuxeo has made each picture's views, and
 * the kit's four page providers return what it wrote, the library's aggregates counting it. Views
 * are made, and the library's index written, a moment after the repository, so the checks are
 * asked again, once a second, for up to NUXEO_INDEX_WAIT_MS.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, or
 * a check failed; 2, a precondition, found before anything is written: no credentials, no server,
 * credentials refused, the package not installed (without `--preview`), no
 * /default-domain/workspaces, or a document at one of the seed's places that it did not write. An
 * argument other than `--preview` is refused with exit 2 too.
 */
import {
  ASSETS,
  FOLDERS,
  MARKER,
  PRODUCTS,
  SHOTS,
  WORKSPACE,
  dayAfter,
  shotName,
  shotTitle,
} from './data.mjs';
import { picturePng } from './png.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const INDEX_WAIT_MS = Number(process.env['NUXEO_INDEX_WAIT_MS']) || 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;
/** The stand-in model's types: the three record types and the library's search document. */
const TYPES = ['AcmeAsset', 'AcmeProduct', 'AcmeShot', 'AcmeAssetSearch'];
const PAGE_PROVIDERS = [
  'acme_products',
  'acme_product_assets',
  'acme_product_missing_shots',
  'acme_asset_library',
];

/** A precondition the environment or the server does not meet: fix it, not the script. */
class Precondition extends Error {}

/** The server answered with an error status. */
class HttpError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path}: HTTP ${status}${detail ? `, ${detail}` : ''}`);
    this.status = status;
  }
}

const tally = { created: 0, updated: 0, restored: 0, uploaded: 0 };
/** Whether the run is still in its preflight, where no answer at all means no server. */
let preflighting = true;

const argv = process.argv.slice(2);
if (argv.some((argument) => argument !== '--preview')) {
  console.error('usage: node business-apps/packages/brand-assets-demo/demo/seed.mjs [--preview]');
  process.exit(EXIT_PRECONDITION);
}
const PREVIEW = argv.includes('--preview');

const username = process.env['NUXEO_USER'];
const password = process.env['NUXEO_PASS'];
if (!username || !password) {
  console.error(
    'NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export them first:\n' +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

try {
  await seed();
} catch (error) {
  if (error instanceof Precondition) {
    console.error(error.message);
    process.exit(EXIT_PRECONDITION);
  }
  console.error(error instanceof HttpError ? error.message : (error?.stack ?? String(error)));
  process.exit(1);
}

async function seed() {
  console.log(
    PREVIEW
      ? `Seeding ${SERVER} with the brand assets kit's pictures, as Pictures, for a preview.`
      : `Seeding ${SERVER} with the brand assets kit's fictional records.`,
  );
  const today = new Date();
  if (PREVIEW) {
    await seedPreview(today);
    return;
  }
  const plan = planned(today);
  await preflight(plan);
  preflighting = false;

  await ensure(plan.workspace);
  for (const folder of plan.folders) await ensure(folder);
  const products = new Map();
  for (const product of plan.products) products.set(product.key, await ensure(product));
  const assets = new Map();
  for (const asset of plan.assets) assets.set(asset.key, await ensure(asset));
  const shots = new Map();
  for (const shot of plan.shots) {
    const fills = shot.fills === null ? null : assets.get(shot.fills).uid;
    shots.set(
      shot.key,
      await ensure({ ...shot, properties: { ...shot.properties, 'acmeshot:asset': fills } }),
    );
  }

  await check({ products, assets, shots });

  const { created, updated, restored, uploaded } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash, ` +
      `${uploaded} picture(s) uploaded, under ${ROOT}. The page providers return what was seeded.`,
  );
  const ending = ASSETS.find((asset) => asset.rightsEndInDays >= 0 && asset.rightsEndInDays <= 30);
  const ended = ASSETS.find((asset) => asset.rightsEndInDays < 0);
  console.log(`An asset whose rights end soon: ${APP}/#/doc/${assets.get(ending.id).uid}`);
  console.log(`An asset whose rights have ended: ${APP}/#/doc/${assets.get(ended.id).uid}`);
  console.log(`A product with a missing shot: ${APP}/#/doc/${products.get(PRODUCTS[0].style).uid}`);
  console.log(`The library: ${APP}/#/queues/library`);
}

/**
 * `--preview`: the workspace, its `preview` folder, and each picture as a `Picture` there, with
 * only the properties a Picture has. Then only the views are checked.
 */
async function seedPreview(today) {
  const plan = previewPlanned(today);
  await preflight(plan, { types: [] });
  preflighting = false;
  await ensure(plan.workspace);
  for (const folder of plan.folders) await ensure(folder);
  const pictures = new Map();
  for (const picture of plan.assets) pictures.set(picture.key, await ensure(picture));
  const deadline = Date.now() + INDEX_WAIT_MS;
  for (;;) {
    const problems = await viewsNotMade(pictures);
    if (problems.length === 0) break;
    if (Date.now() >= deadline)
      throw new Error(`Nuxeo has not made every picture's views:\n  ${problems.join('\n  ')}`);
    console.log(`  waiting  ${problems.length} picture(s) without their views yet, asking again`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const { created, updated, restored, uploaded } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash, ` +
      `${uploaded} picture(s) uploaded, under ${ROOT}/preview. Nuxeo made each one's views.`,
  );
  for (const asset of ASSETS)
    console.log(`  ${asset.title}: ${APP}/#/doc/${pictures.get(asset.id).uid}`);
}

/** The preview's places: the workspace, its `preview` folder, and a `Picture` per asset. */
function previewPlanned(today) {
  const full = planned(today);
  const parent = `${ROOT}/preview`;
  return {
    workspace: full.workspace,
    folders: [
      {
        ...full.folders[0],
        path: parent,
        name: 'preview',
        key: 'preview',
        properties: { 'dc:source': MARKER, 'dc:title': 'Preview, as Pictures' },
      },
    ],
    products: [],
    assets: full.assets.map((asset) => ({
      ...asset,
      parent,
      path: `${parent}/${asset.name}`,
      type: 'Picture',
      properties: Object.fromEntries(
        Object.entries(asset.properties).filter(([xpath]) => xpath.startsWith('dc:')),
      ),
    })),
    shots: [],
  };
}

/** The pictures Nuxeo has made no views for yet. */
async function viewsNotMade(pictures) {
  const problems = [];
  for (const [key, document] of pictures) {
    const read = await call('GET', `/id/${document.uid}`);
    const views = read?.properties?.['picture:views'];
    if (!Array.isArray(views) || views.length === 0)
      problems.push(`${key}: Nuxeo has made no picture views yet`);
  }
  return problems;
}

/**
 * Every document the seed writes, at its place, with its type and its properties, `MARKER` among
 * them: the workspace, its folders, the products, the pictures and the shot list. Dates are counted
 * from `today`.
 */
function planned(today) {
  const marked = (properties) => ({ 'dc:source': MARKER, ...properties });
  const at = (parent, name, type, key, properties, file) => ({
    path: `${parent}/${name}`,
    parent,
    name,
    type,
    key,
    properties: marked(properties),
    file,
  });
  return {
    workspace: at(WORKSPACES, WORKSPACE.name, 'Workspace', 'workspace', {
      'dc:title': WORKSPACE.title,
      'dc:description': WORKSPACE.description,
    }),
    folders: Object.entries(FOLDERS).map(([name, title]) =>
      at(ROOT, name, 'Folder', name, { 'dc:title': title }),
    ),
    products: PRODUCTS.map((product) =>
      at(`${ROOT}/products`, product.style.toLowerCase(), 'AcmeProduct', product.style, {
        'dc:title': product.title,
        'acmeproduct:style': product.style,
        'acmeproduct:season': product.season,
        'acmeproduct:colorways': product.colorways,
        'acmeproduct:channels': product.channels,
        'acmeproduct:launch': product.launch,
      }),
    ),
    assets: ASSETS.map((asset) =>
      at(
        `${ROOT}/assets`,
        asset.id,
        'AcmeAsset',
        asset.id,
        {
          'dc:title': asset.title,
          'dc:expired': dayAfter(today, asset.rightsEndInDays),
          'dc:rights': asset.rights,
          'acmeasset:product': asset.product,
          'acmeasset:colorway': asset.colorway,
          'acmeasset:shot': asset.shot,
          'acmeasset:campaign': asset.campaign ?? null,
          'acmeasset:credit': asset.credit,
          'acmeasset:channels': asset.channels,
          'acmeasset:regions': asset.regions,
        },
        { fileName: `${asset.id}.png`, bytes: picturePng(asset.picture) },
      ),
    ),
    shots: SHOTS.map((shot) => ({
      ...at(`${ROOT}/shots`, shotName(shot), 'AcmeShot', shotName(shot), {
        'dc:title': shotTitle(shot),
        'acmeshot:product': shot.product,
        'acmeshot:colorway': shot.colorway,
        'acmeshot:shot': shot.shot,
        'acmeshot:due': dayAfter(today, shot.dueInDays),
      }),
      fills: shot.asset,
    })),
  };
}

/** Every place in `plan`, in the order the seed writes them. */
function everyPlace(plan) {
  return [plan.workspace, ...plan.folders, ...plan.products, ...plan.assets, ...plan.shots];
}

/**
 * The server answers, the credentials are accepted, the package's types are installed, and every
 * place the seed would write is free or holds a document it wrote before, of the same type. All of
 * it read, nothing written.
 */
async function preflight(plan, { types = TYPES } = {}) {
  try {
    await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    throw error;
  }
  const missing = [];
  for (const type of types) {
    if ((await find(`/config/types/${type}`)) === null) missing.push(type);
  }
  if (missing.length > 0)
    throw new Precondition(
      `${SERVER} has no ${missing.join(', ')} type: install the brand-assets-demo package first ` +
        '(business-apps/packages/brand-assets-demo/README.md, "Installing it"), then run this again.',
    );
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the kit's workspace goes.`);
  const foreign = [];
  for (const place of everyPlace(plan)) {
    const existing = await find(`/path${pathOf(place.path)}`);
    if (existing === null) continue;
    if (existing.type !== place.type)
      foreign.push(`${place.path} is a ${existing.type}, not a ${place.type}`);
    else if (existing.properties?.['dc:source'] !== MARKER)
      foreign.push(`${place.path} does not carry the seed's marker as its dc:source`);
  }
  if (foreign.length > 0)
    throw new Precondition(
      `The seed writes only documents it created, and these are not its own, so nothing was ` +
        `written:\n  ${foreign.join('\n  ')}\nMove them, or seed another server.`,
    );
}

/**
 * The document at its place, created or updated to its properties. With a file, its
 * `file:content` holds those bytes, uploaded only when the document does not already hold them.
 * The preflight found any document there to be the seed's.
 */
async function ensure({ parent, name, path, type, properties, file }) {
  const existing = await find(`/path${pathOf(path)}`);
  if (existing === null) {
    const content = file ? { 'file:content': await upload(file) } : {};
    const created = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties: { ...properties, ...content } },
    });
    tally.created++;
    console.log(`  created  ${path}`);
    return created;
  }
  // Read again, as the preflight read it: a run that stopped part way may have left it.
  if (existing.type !== type || existing.properties?.['dc:source'] !== MARKER)
    throw new Error(`${path} is no longer the seed's own document, so it is left alone.`);
  if (existing.isTrashed === true) {
    await call('POST', '/automation/Document.Untrash', {
      json: { input: `doc:${existing.uid}`, params: {} },
    });
    tally.restored++;
    console.log(`  restored ${path}`);
  }
  const content =
    file && !(await holds(existing, file)) ? { 'file:content': await upload(file) } : {};
  const updated = await call('PUT', `/id/${existing.uid}`, {
    json: { 'entity-type': 'document', properties: { ...properties, ...content } },
  });
  tally.updated++;
  console.log(`  updated  ${path}`);
  return updated;
}

/**
 * Whether the document's file is already `file`: its name, its length and its bytes, read back and
 * compared whole. Not the server's digest, which is MD5 by default: a weak hash is no way to say
 * two files are the same, and the pictures are small.
 */
async function holds(document, file) {
  const current = document.properties?.['file:content'];
  if (!current || current.name !== file.fileName || Number(current.length) !== file.bytes.length)
    return false;
  const { bytes } = await request('GET', `/id/${document.uid}/@blob/file:content`);
  return bytes.equals(file.bytes);
}

/** A picture uploaded to a new batch, as the value a document's `file:content` takes. */
async function upload({ fileName, bytes }) {
  const { batchId } = await call('POST', '/upload/');
  await call('POST', `/upload/${batchId}/0`, {
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName),
      'X-File-Type': 'image/png',
      'X-File-Size': String(bytes.length),
    },
  });
  tally.uploaded++;
  return { 'upload-batch': batchId, 'upload-fileId': '0' };
}

/**
 * What the seed checks, last, asked again once a second until INDEX_WAIT_MS has passed:
 *
 * - Nuxeo has made each picture's views, which it makes for a record with the `Picture` facet a
 *   moment after it is written, so the type really is a Picture;
 * - `acme_products` returns every product seeded, the next launch first;
 * - `acme_product_assets`, for each product, every asset seeded for it, by title, and none
 *   seeded for the other;
 * - `acme_product_missing_shots`, for each product, its seeded shots that no asset fills, and
 *   none that one does;
 * - `acme_asset_library` every asset seeded, and its aggregates count at least the seeded assets
 *   in each bucket: each shot, each product, and each rights bucket as the server's day puts them.
 *
 * Another document on the server may carry the same product or shot: the seed checks its own.
 */
async function check(seeded) {
  const deadline = Date.now() + INDEX_WAIT_MS;
  for (;;) {
    const problems = await disagreements(seeded);
    if (problems.length === 0) {
      console.log(`  checked  the picture views, and ${PAGE_PROVIDERS.join(', ')}`);
      return;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `What the server answers disagrees with the seed:\n  ${problems.join('\n  ')}`,
      );
    console.log(
      `  waiting  ${problems.length} disagreement(s): the views or the search index may be ` +
        'catching up, asking again',
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function disagreements({ products, assets, shots }) {
  const problems = await viewsNotMade(assets);
  const uid = (map, key) => map.get(key).uid;

  const listed = await results('acme_products');
  const seededProducts = [...PRODUCTS]
    .sort((a, b) => a.launch.localeCompare(b.launch))
    .map((product) => uid(products, product.style));
  const order = listed.filter((id) => seededProducts.includes(id));
  if (JSON.stringify(order) !== JSON.stringify(seededProducts))
    problems.push(`acme_products: ${JSON.stringify(order)}, not ${JSON.stringify(seededProducts)}`);

  for (const product of PRODUCTS) {
    const mine = ASSETS.filter((asset) => asset.product === product.style)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((asset) => uid(assets, asset.id));
    const others = ASSETS.filter((asset) => asset.product !== product.style).map((asset) =>
      uid(assets, asset.id),
    );
    const found = await results('acme_product_assets', product.style);
    const seen = found.filter((id) => mine.includes(id));
    if (JSON.stringify(seen) !== JSON.stringify(mine))
      problems.push(
        `acme_product_assets(${product.style}): ${JSON.stringify(seen)}, not ${JSON.stringify(mine)}`,
      );
    if (found.some((id) => others.includes(id)))
      problems.push(`acme_product_assets(${product.style}) returns another product's asset`);

    const missing = SHOTS.filter(
      (shot) => shot.product === product.style && shot.asset === null,
    ).map((shot) => uid(shots, shotName(shot)));
    const filled = SHOTS.filter(
      (shot) => shot.product === product.style && shot.asset !== null,
    ).map((shot) => uid(shots, shotName(shot)));
    const gaps = await results('acme_product_missing_shots', product.style);
    if (!missing.every((id) => gaps.includes(id)))
      problems.push(`acme_product_missing_shots(${product.style}) leaves out a missing shot`);
    if (gaps.some((id) => filled.includes(id)))
      problems.push(`acme_product_missing_shots(${product.style}) returns a shot an asset fills`);
  }

  const library = await execute('acme_asset_library');
  const inLibrary = library.entries.map((entry) => entry.uid);
  const absent = ASSETS.filter((asset) => !inLibrary.includes(uid(assets, asset.id)));
  if (absent.length > 0)
    problems.push(`acme_asset_library leaves out ${absent.map((asset) => asset.id).join(', ')}`);
  // The bucket the server's day puts each asset in. Its day is the seed's, near enough: every
  // seeded end date is at least ten days from a bound.
  const rightsBucket = (asset) => {
    const days = asset.rightsEndInDays;
    return days < 0 ? 'Ended' : days <= 30 ? 'Ending' : 'Cleared';
  };
  const wanted = {
    acme_rights_agg: countBy(ASSETS, rightsBucket),
    acme_shot_agg: countBy(ASSETS, (asset) => asset.shot),
    acme_product_agg: countBy(ASSETS, (asset) => asset.product),
  };
  for (const [aggregate, counts] of Object.entries(wanted)) {
    const buckets = library.aggregations?.[aggregate]?.buckets;
    if (!Array.isArray(buckets)) {
      problems.push(`acme_asset_library returns no aggregate ${aggregate}`);
      continue;
    }
    for (const [key, count] of Object.entries(counts)) {
      const bucket = buckets.find((each) => String(each.key) === key);
      const docCount = Number(bucket?.docCount ?? bucket?.doc_count ?? 0);
      if (docCount < count)
        problems.push(`${aggregate}: ${key} counts ${docCount}, fewer than the ${count} seeded`);
    }
  }
  return problems;
}

/** How many of `items` are in each bucket `key` puts them in. */
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

/** Every id a page provider returns, given one parameter or none, page after page. */
async function results(pageProvider, parameter) {
  const parameters = parameter === undefined ? {} : { queryParams: parameter };
  const entries = await everyPage(pageProvider, (index) =>
    call(
      'GET',
      `/search/pp/${pageProvider}/execute?${new URLSearchParams({
        ...parameters,
        pageSize: `${PAGE_SIZE}`,
        currentPageIndex: `${index}`,
      })}`,
    ),
  );
  return entries.map((entry) => entry.uid);
}

/** A page provider's first page, with its aggregates, given no parameter. */
async function execute(pageProvider) {
  const page = await call(
    'GET',
    `/search/pp/${pageProvider}/execute?${new URLSearchParams({ pageSize: `${PAGE_SIZE}` })}`,
  );
  if (page?.isNextPageAvailable === true)
    throw new Error(
      `${pageProvider} holds more than ${PAGE_SIZE} records, which the seed does not read`,
    );
  return { entries: page?.entries ?? [], aggregations: page?.aggregations ?? {} };
}

/**
 * Every entry of a paged search, page after page. A server may cap a page below the size asked
 * for, so one page is never taken for all of them.
 */
async function everyPage(what, pageAt) {
  const entries = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await pageAt(index);
    entries.push(...(page?.entries ?? []));
    if (page?.isNextPageAvailable !== true) return entries;
  }
  throw new Error(
    `${what} still reports another page after ${MAX_PAGES} pages (${entries.length} records ` +
      'read), past which the seed does not read, so it cannot say what the server holds.',
  );
}

/** A repository path as a URL path, each segment encoded. */
function pathOf(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** The answer to a GET, or `null` for a 404. */
async function find(path) {
  try {
    return await call('GET', path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/** A JSON call: the parsed answer, or `null` for an empty one. */
async function call(method, path, options = {}) {
  const text = (await request(method, path, options)).bytes.toString('utf8');
  return text ? JSON.parse(text) : null;
}

/** An answer read whole, its body's bytes included, within the one timeout. */
async function request(method, path, { json, body, headers = {} } = {}) {
  let response;
  let bytes;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: AUTHORIZATION,
        Accept: 'application/json',
        // Every schema of a document, so that its marker and its file can be compared.
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? body : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Read here, under the same timeout and the same verdict: a server that sends its headers and
    // then stalls has not answered either.
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const unanswered =
      `${SERVER} did not answer ${method} ${path}: ` +
      `${error?.cause?.code ?? error?.message ?? error}.`;
    // Before anything is written, no answer means no server. After, the run stopped part way.
    if (preflighting)
      throw new Precondition(`${unanswered} Is Nuxeo running, and is NUXEO_URL its address?`);
    throw new Error(`${unanswered} The run stopped part way; running it again is safe.`);
  }
  if (!response.ok) {
    const text = bytes.toString('utf8');
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = text.slice(0, 200);
    }
    throw new HttpError(response.status, method, path, detail);
  }
  return { status: response.status, bytes };
}
