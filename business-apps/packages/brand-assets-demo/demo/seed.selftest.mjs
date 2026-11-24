#!/usr/bin/env node
/**
 * Controls for the brand assets kit's seed, against a stand-in for the parts of Nuxeo's REST API it
 * calls, so that they need no server:
 *
 *   node business-apps/packages/brand-assets-demo/demo/seed.selftest.mjs
 *
 * It proves the script, not the server: the stand-in answers as the stand-in model's page
 * providers are written to (`brand-assets-demo-model.xml`), and makes a picture's views as soon as
 * it is asked for the picture, which Nuxeo does a moment later. What the server does is the seed's
 * own last step, `check`, run against a real one.
 *
 * Each control runs `seed.mjs` as a command, as a person would, and holds it to its exit code and
 * to what it wrote:
 *
 * - **refused before writing (exit 2):** no credentials; credentials refused; the package not
 *   installed; a document at one of its places that does not carry its marker; one of another type;
 *   an argument it does not take;
 * - **`--preview` (exit 0), with no kit type on the server:** the six pictures as `Picture`s under
 *   the workspace's `preview` folder, with Dublin Core's properties and its marker only;
 * - **seeded (exit 0):** twenty documents and six pictures on an empty server, all of them under
 *   the kit's workspace and marked, nothing else new, and every write of every run to the
 *   workspace or a document in it, beside a sibling workspace whose name begins as its; the second
 *   run creating and uploading nothing; a record trashed at its place restored, not created again;
 * - **with the rights add-on:** an original the kit's own rights policy refuses to read back, with
 *   403, uploaded again, and only those (exit 0); any other failure to read one back stops the run
 *   (exit 1);
 * - **a check that fails (exit 1):** each page provider answering wrong in its own way (a filled
 *   shot listed as missing, the products out of order, another product's asset, a library bucket
 *   counting short), and pictures whose views are never made;
 * - **the pictures and the data:** each PNG well formed, of its size, and the same bytes twice; the
 *   shot list consistent with the pictures; and one asset in each rights window the banners show.
 *
 * Exit codes: 0, every control held; 1, one did not.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { ASSETS, MARKER, PRODUCTS, SHOTS, WORKSPACE, shotName } from './data.mjs';
import { crc32, picturePng } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, 'seed.mjs');
const USER = 'selftest';
const SECRET = 'selftest-secret';
const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
const KIT_TYPES = ['AcmeAsset', 'AcmeProduct', 'AcmeShot', 'AcmeAssetSearch'];

const failures = [];
let held = 0;
function control(name, condition, detail = '') {
  if (condition) {
    held++;
    return;
  }
  failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

/**
 * A stand-in Nuxeo: its repository is `docs`, by path, and every call is recorded. `fault` makes
 * one page provider answer wrong, so that the check meant to see it is seen failing:
 * `missing-shots` lists a filled shot as missing, `products-order` lists the products in the wrong
 * order, `cross-product` lists another product's asset, and `short-bucket` counts a library bucket
 * one short. `originalStatus` answers a read of a document's original with that status instead of
 * its bytes, as `nuxeo-agentic-assets` refuses one with 403 under the kit's rights policy.
 */
function standIn({
  installed = true,
  viewsMade = true,
  fault = null,
  originalStatus = () => 200,
} = {}) {
  const docs = new Map();
  const batches = new Map();
  const calls = [];
  let next = 1;
  const add = (path, type, properties = {}) => {
    const doc = {
      'entity-type': 'document',
      uid: `uid-${next++}`,
      path,
      type,
      isTrashed: false,
      properties: { ...properties },
    };
    docs.set(path, doc);
    return doc;
  };
  add('/default-domain', 'Domain');
  add('/default-domain/workspaces', 'WorkspaceRoot');
  const byUid = (uid) => [...docs.values()].find((doc) => doc.uid === uid);
  /** The types with the `Picture` facet, which Nuxeo makes views for. */
  const pictures = ['AcmeAsset', 'Picture'];
  const view = (doc) => {
    const out = structuredClone(doc);
    if (pictures.includes(doc.type) && doc.blob && viewsMade)
      out.properties['picture:views'] = [{ title: 'Medium', width: 800, height: 1000 }];
    else if (pictures.includes(doc.type)) out.properties['picture:views'] = [];
    if (doc.blob)
      out.properties['file:content'] = {
        name: doc.blob.name,
        length: String(doc.blob.bytes.length),
      };
    return out;
  };
  const live = (type) =>
    [...docs.values()].filter((doc) => doc.type === type && doc.isTrashed !== true);

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://stand-in');
    const path = decodeURIComponent(url.pathname.replace(/^\/nuxeo\/api\/v1/, ''));
    const call = { method: req.method, path };
    calls.push(call);
    const send = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    const expected = `Basic ${Buffer.from(`${USER}:${SECRET}`).toString('base64')}`;
    if (req.headers.authorization !== expected) return send(401, { message: 'Unauthorized' });
    const json = () => JSON.parse(body.toString('utf8') || '{}');

    if (req.method === 'GET' && path === '/me') return send(200, { id: USER });
    if (req.method === 'GET' && path.startsWith('/config/types/')) {
      const type = path.slice('/config/types/'.length);
      return installed || !KIT_TYPES.includes(type) ? send(200, { name: type }) : send(404);
    }
    if (req.method === 'GET' && path.startsWith('/path/')) {
      const doc = docs.get(path.slice('/path'.length));
      return doc ? send(200, view(doc)) : send(404, { message: 'Not found' });
    }
    if (req.method === 'POST' && path.startsWith('/path/')) {
      const parent = path.slice('/path'.length);
      if (!docs.has(parent)) return send(404);
      const { name, type, properties } = json();
      call.created = name;
      const { 'file:content': file, ...rest } = properties;
      const doc = add(`${parent}/${name}`, type, rest);
      if (file) doc.blob = batches.get(file['upload-batch']);
      return send(201, view(doc));
    }
    if (req.method === 'PUT' && path.startsWith('/id/')) {
      const doc = byUid(path.slice('/id/'.length));
      if (!doc) return send(404);
      const { 'file:content': file, ...rest } = json().properties;
      Object.assign(doc.properties, rest);
      if (file) doc.blob = batches.get(file['upload-batch']);
      return send(200, view(doc));
    }
    if (req.method === 'GET' && /^\/id\/[^/]+$/.test(path)) {
      const doc = byUid(path.slice('/id/'.length));
      return doc ? send(200, view(doc)) : send(404);
    }
    if (req.method === 'GET' && path.endsWith('/@blob/file:content')) {
      const doc = byUid(path.split('/')[2]);
      const status = originalStatus(doc);
      if (status !== 200) return send(status, { message: 'refused by the stand-in' });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(doc.blob.bytes);
    }
    if (req.method === 'POST' && path === '/upload/') {
      const batchId = `batch-${next++}`;
      batches.set(batchId, null);
      return send(201, { batchId });
    }
    if (req.method === 'POST' && /^\/upload\/[^/]+\/0$/.test(path)) {
      const batchId = path.split('/')[2];
      batches.set(batchId, { name: decodeURIComponent(req.headers['x-file-name']), bytes: body });
      return send(201, { uploaded: 'true' });
    }
    if (req.method === 'POST' && path === '/automation/Document.Untrash') {
      call.input = json().input.slice('doc:'.length);
      const doc = byUid(call.input);
      doc.isTrashed = false;
      return send(200, view(doc));
    }
    if (req.method === 'GET' && path.startsWith('/search/pp/')) {
      const name = path.split('/')[3];
      const parameter = url.searchParams.get('queryParams');
      const page = (entries, aggregations) =>
        send(200, { entries: entries.map(view), isNextPageAvailable: false, aggregations });
      const prop = (doc, xpath) => doc.properties[xpath];
      if (name === 'acme_products') {
        const products = live('AcmeProduct').sort((a, b) =>
          prop(a, 'acmeproduct:launch').localeCompare(prop(b, 'acmeproduct:launch')),
        );
        return page(fault === 'products-order' ? products.reverse() : products);
      }
      if (name === 'acme_product_assets')
        return page(
          live('AcmeAsset')
            .filter(
              (doc) =>
                prop(doc, 'acmeasset:product') === parameter ||
                (fault === 'cross-product' && prop(doc, 'acmeasset:shot') === 'Campaign'),
            )
            .sort((a, b) => prop(a, 'dc:title').localeCompare(prop(b, 'dc:title'))),
        );
      if (name === 'acme_product_missing_shots')
        return page(
          live('AcmeShot').filter(
            (doc) =>
              prop(doc, 'acmeshot:product') === parameter &&
              (fault === 'missing-shots' || prop(doc, 'acmeshot:asset') == null),
          ),
        );
      if (name === 'acme_asset_library') {
        const assets = live('AcmeAsset');
        const today = new Date().toISOString().slice(0, 10);
        const days = (day) => Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
        const bucket = (doc) => {
          const left = days(prop(doc, 'dc:expired'));
          return left < 0 ? 'Ended' : left <= 30 ? 'Ending' : 'Cleared';
        };
        const terms = (key) => {
          const counts = new Map();
          for (const doc of assets) counts.set(key(doc), (counts.get(key(doc)) ?? 0) + 1);
          if (fault === 'short-bucket' && counts.has('Cleared'))
            counts.set('Cleared', counts.get('Cleared') - 1);
          return { buckets: [...counts].map(([k, docCount]) => ({ key: k, docCount })) };
        };
        return page(assets, {
          acme_rights_agg: terms(bucket),
          acme_shot_agg: terms((doc) => prop(doc, 'acmeasset:shot')),
          acme_product_agg: terms((doc) => prop(doc, 'acmeasset:product')),
        });
      }
      return send(404);
    }
    return send(404, { message: `stand-in: no ${req.method} ${path}` });
  });
  return { server, docs, calls, add };
}

/** `seed.mjs` run as a command against `stand`, with `args`, and `env` over the controls' own. */
async function runSeed(stand, env = {}, args = []) {
  await new Promise((resolve) => stand.server.listen(0, '127.0.0.1', resolve));
  const { port } = stand.server.address();
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [SEED, ...args], {
        env: {
          PATH: process.env['PATH'],
          NUXEO_URL: `http://127.0.0.1:${port}`,
          NUXEO_USER: USER,
          NUXEO_PASS: SECRET,
          NUXEO_INDEX_WAIT_MS: '1500',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      child.on('close', (code) => resolve({ code, output }));
    });
  } finally {
    await new Promise((resolve) => stand.server.close(resolve));
  }
}

const writes = (stand) => stand.calls.filter((call) => call.method !== 'GET');
/** Inside the kit's workspace, the workspace included: not a sibling whose name begins as its. */
const inside = (path) => path === ROOT || path.startsWith(`${ROOT}/`);
const ours = (stand) => [...stand.docs.values()].filter((doc) => inside(doc.path));
/**
 * Every write a run made was to the kit's workspace or a document in it: a create under it, or the
 * one create of the workspace itself, by its name; an update, an untrash and an upload's batch
 * only. `before` is the set of uids the stand-in held before the run that are not the kit's.
 */
function wroteOnlyItsOwn(stand, before) {
  const byUid = new Map([...stand.docs.values()].map((doc) => [doc.uid, doc]));
  return writes(stand).every((call) => {
    if (call.path === '/upload/' || /^\/upload\/[^/]+\/0$/.test(call.path)) return true;
    if (call.method === 'POST' && call.path.startsWith('/path/')) {
      const parent = call.path.slice('/path'.length);
      return (
        inside(parent) ||
        (parent === '/default-domain/workspaces' && call.created === WORKSPACE.name)
      );
    }
    const uid = call.method === 'PUT' ? call.path.slice('/id/'.length) : call.input;
    const doc = byUid.get(uid);
    return Boolean(doc) && inside(doc.path) && !before.has(uid);
  });
}
const othersOf = (stand) =>
  new Set([...stand.docs.values()].filter((doc) => !inside(doc.path)).map((doc) => doc.uid));

// ── Refused before writing ────────────────────────────────────────────────────────────────────
{
  const stand = standIn();
  const run = await runSeed(stand, { NUXEO_USER: '', NUXEO_PASS: '' });
  control('no credentials: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control('no credentials: nothing asked of the server', stand.calls.length === 0);
}
{
  const stand = standIn();
  const run = await runSeed(stand, { NUXEO_PASS: 'wrong' });
  control('credentials refused: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control('credentials refused: nothing written', writes(stand).length === 0);
}
{
  const stand = standIn({ installed: false });
  const run = await runSeed(stand);
  control('package not installed: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control(
    'package not installed: says to install it',
    run.output.includes('install the brand-assets-demo package'),
    run.output,
  );
  control('package not installed: nothing written', writes(stand).length === 0);
}
{
  const stand = standIn();
  stand.add(ROOT, 'Workspace', { 'dc:source': MARKER });
  stand.add(`${ROOT}/assets`, 'Folder', { 'dc:source': MARKER });
  stand.add(`${ROOT}/assets/${ASSETS[2].id}`, 'AcmeAsset', { 'dc:title': 'Someone else’s' });
  const run = await runSeed(stand);
  control('an unmarked document at a place: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control('an unmarked document: named', run.output.includes(ASSETS[2].id), run.output);
  control('an unmarked document: nothing written', writes(stand).length === 0);
}
{
  const stand = standIn();
  stand.add(ROOT, 'Folder', { 'dc:source': MARKER });
  const run = await runSeed(stand);
  control('another type at a place: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control('another type at a place: nothing written', writes(stand).length === 0);
}

// ── Seeded, twice ─────────────────────────────────────────────────────────────────────────────
{
  const stand = standIn();
  // A sibling whose name begins as the workspace's: the seed must not count it, or write to it.
  const sibling = stand.add(`${ROOT}-archive`, 'Workspace', { 'dc:title': 'Someone else’s' });
  const before = othersOf(stand);
  const first = await runSeed(stand);
  control('an empty server: exit 0', first.code === 0, `${first.code}: ${first.output}`);
  if (first.code !== 0) {
    console.error(`seed selftest: the seed did not seed the stand-in:\n${first.output}`);
    process.exit(1);
  }
  const expected = 1 + 3 + PRODUCTS.length + ASSETS.length + SHOTS.length;
  control(
    `an empty server: ${expected} documents created, ${ASSETS.length} pictures uploaded`,
    first.output.includes(
      `Done: ${expected} created, 0 updated, 0 restored from the trash, ${ASSETS.length} picture(s) uploaded`,
    ),
    first.output.split('\n').find((line) => line.startsWith('Done')),
  );
  control(
    'every document it wrote is in its workspace and carries its marker, and nothing else is new',
    ours(stand).length === expected &&
      ours(stand).every((doc) => doc.properties['dc:source'] === MARKER) &&
      stand.docs.size === before.size + expected,
    `${ours(stand).length} in the workspace, ${stand.docs.size} in all`,
  );
  control(
    'every write of the first run was to its workspace or a document in it',
    wroteOnlyItsOwn(stand, before) && sibling.properties['dc:source'] === undefined,
    JSON.stringify(writes(stand).slice(0, 5)),
  );
  const shotAt = (shot) => stand.docs.get(`${ROOT}/shots/${shotName(shot)}`);
  const assetAt = (id) => stand.docs.get(`${ROOT}/assets/${id}`);
  control(
    "each shot names the asset that fills it by the asset's id, and a missing one none",
    SHOTS.every((shot) =>
      shot.asset === null
        ? shotAt(shot).properties['acmeshot:asset'] === null
        : shotAt(shot).properties['acmeshot:asset'] === assetAt(shot.asset).uid,
    ),
  );
  stand.calls.length = 0;
  const second = await runSeed(stand);
  control('a second run: exit 0', second.code === 0, `${second.code}: ${second.output}`);
  control(
    'every write of the second run was to a document in its workspace',
    writes(stand).length > 0 && wroteOnlyItsOwn(stand, before),
    JSON.stringify(writes(stand).slice(0, 5)),
  );
  control(
    'a second run: nothing created and no picture uploaded again',
    second.output.includes(
      `Done: 0 created, ${expected} updated, 0 restored from the trash, 0 picture(s) uploaded`,
    ),
    second.output.split('\n').find((line) => line.startsWith('Done')),
  );
  control('a second run: still that many documents', ours(stand).length === expected);

  // Trashed at its place: restored, not created again.
  assetAt(ASSETS[0].id).isTrashed = true;
  stand.calls.length = 0;
  const third = await runSeed(stand);
  control(
    'a trashed record at its place: restored, and nothing created',
    third.code === 0 &&
      third.output.includes(
        `Done: 0 created, ${expected} updated, 1 restored from the trash, 0 picture(s) uploaded`,
      ) &&
      assetAt(ASSETS[0].id).isTrashed === false &&
      ours(stand).length === expected,
    third.output.split('\n').find((line) => line.startsWith('Done')),
  );
  control(
    'every write of the third run was to a document in its workspace, its untrash included',
    writes(stand).some((call) => call.path === '/automation/Document.Untrash') &&
      wroteOnlyItsOwn(stand, before),
    JSON.stringify(writes(stand).slice(0, 5)),
  );
}

// ── With the rights add-on: the originals the kit's own policy refuses ───────────────────────────
{
  // The kit's policy refuses an asset's original, to every user, when its channels hold no Print
  // or its rights have ended (bundle/OSGI-INF/brand-assets-demo-rights.xml).
  const refused = ASSETS.filter(
    (asset) => !asset.channels.includes('Print') || asset.rightsEndInDays < 0,
  ).map((asset) => asset.id);
  const idOf = (doc) => doc.path.slice(doc.path.lastIndexOf('/') + 1);
  const stand = standIn({ originalStatus: (doc) => (refused.includes(idOf(doc)) ? 403 : 200) });
  const first = await runSeed(stand);
  const second = await runSeed(stand);
  const expected = 1 + 3 + PRODUCTS.length + ASSETS.length + SHOTS.length;
  control(
    'refused originals: the data has some, and some it serves',
    refused.length > 0 && refused.length < ASSETS.length,
    refused.join(', '),
  );
  control(
    'refused originals: both runs exit 0',
    first.code === 0 && second.code === 0,
    `${first.code}, ${second.code}: ${second.output}`,
  );
  control(
    'refused originals: the second run uploads again exactly the pictures it could not read back',
    second.output.includes(
      `Done: 0 created, ${expected} updated, 0 restored from the trash, ${refused.length} picture(s) uploaded`,
    ) &&
      refused.every((id) =>
        second.output.includes(`assets/${id}: its original cannot be read back`),
      ),
    second.output,
  );
}
{
  // Anything but a refusal is not taken for one: a server failure on the read stops the run.
  let failing = false;
  const stand = standIn({ originalStatus: () => (failing ? 500 : 200) });
  await runSeed(stand);
  failing = true;
  const run = await runSeed(stand);
  control(
    'a failing read of an original: the run stops, exit 1',
    run.code === 1,
    `${run.code}: ${run.output}`,
  );
}

// ── The preview, before the package is installed ──────────────────────────────────────────────
{
  const stand = standIn({ installed: false });
  const run = await runSeed(stand, {}, ['--preview']);
  control('--preview with no kit type: exit 0', run.code === 0, `${run.code}: ${run.output}`);
  const preview = [...stand.docs.values()].filter((doc) => doc.path.startsWith(`${ROOT}/preview/`));
  control(
    `--preview: ${ASSETS.length} Pictures under the workspace's preview folder, and nothing else`,
    preview.length === ASSETS.length &&
      preview.every((doc) => doc.type === 'Picture') &&
      ours(stand).length === 2 + ASSETS.length,
  );
  control(
    "--preview: each with its title, rights end and marker, and none of the kit's own properties",
    preview.every(
      (doc) =>
        doc.properties['dc:source'] === MARKER &&
        typeof doc.properties['dc:title'] === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(doc.properties['dc:expired']) &&
        Object.keys(doc.properties).every((xpath) => xpath.startsWith('dc:')),
    ),
  );
}
{
  const stand = standIn();
  const run = await runSeed(stand, {}, ['--everything']);
  control('an argument it does not take: exit 2', run.code === 2, `${run.code}: ${run.output}`);
  control('an argument it does not take: nothing asked', stand.calls.length === 0);
}

// ── Checks that fail ──────────────────────────────────────────────────────────────────────────
for (const [fault, name, said] of [
  ['missing-shots', 'a filled shot listed as missing', 'returns a shot an asset fills'],
  ['products-order', 'the products out of their launch order', 'acme_products: ['],
  [
    'cross-product',
    "another product's asset in a product's shots",
    "returns another product's asset",
  ],
  [
    'short-bucket',
    'a library bucket counting fewer than seeded',
    'acme_rights_agg: Cleared counts',
  ],
]) {
  const stand = standIn({ fault });
  const run = await runSeed(stand);
  control(`${name}: exit 1`, run.code === 1, `${run.code}: ${run.output}`);
  control(`${name}: said`, run.output.includes(said), run.output);
}
{
  const stand = standIn({ viewsMade: false });
  const run = await runSeed(stand);
  control('no picture views: exit 1', run.code === 1, `${run.code}: ${run.output}`);
  control('no picture views: said', run.output.includes('no picture views yet'), run.output);
}

// ── The pictures and the data ─────────────────────────────────────────────────────────────────
for (const asset of ASSETS) {
  const png = picturePng(asset.picture);
  const [width, height] = asset.picture.size;
  control(
    `${asset.id}: a PNG signature`,
    png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  );
  control(
    `${asset.id}: IHDR of its size`,
    png.readUInt32BE(16) === width && png.readUInt32BE(20) === height,
  );
  // Every chunk's CRC, and the image data inflating to one filter byte and three per pixel a row.
  let at = 8;
  let crcs = true;
  const idat = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('ascii');
    const data = png.subarray(at + 8, at + 8 + length);
    if (crc32(png.subarray(at + 4, at + 8 + length)) !== png.readUInt32BE(at + 8 + length))
      crcs = false;
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  control(`${asset.id}: every chunk's CRC`, crcs);
  control(
    `${asset.id}: the image data inflates to its rows`,
    inflateSync(Buffer.concat(idat)).length === (width * 3 + 1) * height,
  );
  control(`${asset.id}: the same bytes twice`, png.equals(picturePng(asset.picture)));
  control(`${asset.id}: large enough for Nuxeo's Medium view`, Math.max(width, height) > 1000);
}
const assetOf = (id) => ASSETS.find((asset) => asset.id === id);
control(
  'each filled shot names an asset of its product, colourway and shot',
  SHOTS.filter((shot) => shot.asset !== null).every((shot) => {
    const asset = assetOf(shot.asset);
    return (
      asset &&
      asset.product === shot.product &&
      asset.colorway === shot.colorway &&
      asset.shot === shot.shot
    );
  }),
);
control(
  'each asset fills one shot',
  ASSETS.every((asset) => SHOTS.filter((shot) => shot.asset === asset.id).length === 1),
);
control(
  'each product has a missing shot, for its product page to list',
  PRODUCTS.every((product) =>
    SHOTS.some((shot) => shot.product === product.style && shot.asset === null),
  ),
);
control(
  "one asset's rights end within 30 days and one's have ended, ten days or more from each bound",
  ASSETS.some((asset) => asset.rightsEndInDays >= 10 && asset.rightsEndInDays <= 20) &&
    ASSETS.some((asset) => asset.rightsEndInDays <= -10) &&
    ASSETS.every(
      (asset) =>
        asset.rightsEndInDays <= -10 ||
        (asset.rightsEndInDays >= 10 && asset.rightsEndInDays <= 20) ||
        asset.rightsEndInDays >= 41,
    ),
);

if (failures.length > 0) {
  console.error(
    `seed selftest: ${failures.length} control(s) did not hold:\n  ${failures.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`seed selftest: ${held} controls held.`);
