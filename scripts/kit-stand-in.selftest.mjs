#!/usr/bin/env node
/**
 * Controls for the kit stand-in, `scripts/kit-stand-in.mjs` (`npm run kit:stand-in`).
 *
 * A fake upstream Nuxeo, an HTTP server in this process on the loopback interface, answers what
 * the stand-in forwards and records every request it is sent. The stand-in is put in front of it
 * over the vehicle titles kit, and over the P&C claims kit for a page provider it cannot answer.
 * Each control asks the stand-in what the app asks, and holds both what came back and what the
 * upstream saw. Load-bearing, each named below as it runs:
 *
 * - **answered from the kit:** the kit's types merged into the upstream's, a type and a schema of
 *   the kit's, a record by id and by path, as the seed writes it, its folder's children, the
 *   NXQL search by id, and the page providers from `EXPECTED`, in its order, sorted, paged, by a
 *   record given, and with their facets counted as `data.mjs` counts them;
 * - **negative:** a write naming a stand-in record refused, by its address and by its body, and
 *   the upstream sent nothing; an operation that reads one not run; a record's permissions with
 *   no Write; a page provider `EXPECTED` does not list answered 501, and not asked of the
 *   upstream; a search of another shape naming a stand-in record answered 501; an address naming
 *   one never forwarded; a kit it does not read refused;
 * - **forwarded:** an id that is not a stand-in's, a search naming none, a page provider of the
 *   platform's, a write naming none with its body byte for byte, a mixed search with only the
 *   other ids, and a sign-in form's body, not read;
 * - **credentials untouched:** `Authorization` and `Cookie` arrive at the upstream as sent, the
 *   upstream's `Set-Cookie` comes back as written, on a forwarded answer and on a merged one, and
 *   no value of theirs is in anything the stand-in logged;
 * - **each kit's mapping held to its seed and its model:** the properties `kits.mjs` writes are
 *   those `seed.mjs` writes, by name, for every kit it reads, and every one is a property of its
 *   type in `content-model.json` (`loadKit` refuses one that is not).
 *
 * The credential values are made at random on each run: none is written in this file.
 *
 * Usage: node scripts/kit-stand-in.selftest.mjs
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  Precondition,
  READ_ONLY_PERMISSIONS,
  createStandIn,
  loadKit,
  standInId,
} from './kit-stand-in.mjs';
import { KITS } from './kit-stand-in/kits.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES = join(ROOT, 'business-apps', 'packages');
const VEHICLES = join(PACKAGES, 'vehicle-titles-demo');
const CLAIMS = join(PACKAGES, 'pc-claims-demo');
const TODAY = new Date('2026-11-27T12:00:00Z');

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const listen = (server) =>
  new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));

// ------------------------------------------------------------------------------------------
// The fake upstream: records every request, answers as a Nuxeo would for what the controls ask.

const seen = [];
const UPSTREAM_COOKIE = `JSESSIONID=${randomBytes(12).toString('hex')}; Path=/nuxeo; HttpOnly`;
const OTHER_ID = '0b7c1a2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
const upstream = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const url = new URL(req.url, 'http://upstream');
    const json = (status, value, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/nuxeo/api/v1/me')
      return json(200, { 'entity-type': 'user', id: 'someone' }, { 'set-cookie': UPSTREAM_COOKIE });
    if (url.pathname === '/nuxeo/api/v1/config/types')
      return json(
        200,
        {
          doctypes: { File: { parent: 'Document', facets: [], schemas: ['dublincore'] } },
          schemas: { dublincore: { '@prefix': 'dc', title: 'string', fromUpstream: 'string' } },
        },
        { 'set-cookie': UPSTREAM_COOKIE },
      );
    if (url.pathname === '/nuxeo/api/v1/config/schemas')
      return json(200, [
        { name: 'dublincore', '@prefix': 'dc', fields: { fromUpstream: 'string' } },
      ]);
    if (url.pathname.startsWith('/nuxeo/api/v1/config/'))
      return json(404, { 'entity-type': 'exception', status: 404 });
    if (url.pathname === `/nuxeo/api/v1/id/${OTHER_ID}`)
      return json(200, { 'entity-type': 'document', uid: OTHER_ID, title: 'From the upstream' });
    if (url.pathname === '/nuxeo/api/v1/search/lang/NXQL/execute')
      return json(200, {
        'entity-type': 'documents',
        entries: url.searchParams
          .getAll('queryParams')
          .map((uid) => ({ 'entity-type': 'document', uid, title: 'From the upstream' })),
      });
    if (url.pathname.startsWith('/nuxeo/api/v1/search/pp/'))
      return json(200, { 'entity-type': 'documents', entries: [], fromUpstream: true });
    if (url.pathname === '/nuxeo/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/nuxeo/landed` });
      return res.end();
    }
    if (req.method !== 'GET') return json(200, { 'entity-type': 'ok', forwarded: true });
    return json(404, { 'entity-type': 'exception', status: 404 });
  });
});
const upstreamPort = await listen(upstream);
const UPSTREAM = `http://127.0.0.1:${upstreamPort}`;

const logged = [];
const vehicles = await loadKit(VEHICLES, { today: TODAY });
const vehicleStandIn = createStandIn(vehicles, {
  upstream: UPSTREAM,
  verbose: true,
  log: (line) => logged.push(line),
});
const vehiclePort = await listen(vehicleStandIn);
const claims = await loadKit(CLAIMS, { today: TODAY });
const claimStandIn = createStandIn(claims, {
  upstream: UPSTREAM,
  log: (line) => logged.push(line),
});
const claimPort = await listen(claimStandIn);

/** One request to a stand-in, read whole. */
function call(port, method, path, { headers = {}, body = null } = {}) {
  return new Promise((done, failed) => {
    const outgoing = request(
      { host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // not JSON
          }
          done({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    outgoing.on('error', failed);
    outgoing.end(body ?? undefined);
  });
}
const get = (path, options) => call(vehiclePort, 'GET', path, options);
/** The requests the upstream saw during `run`. */
async function upstreamSaw(run) {
  const from = seen.length;
  const result = await run();
  return { result, requests: seen.slice(from) };
}

const deal = vehicles.byKey.get('VD-5002');
const title = vehicles.byKey.get('TTL-6002');
const vehicleData = await import(pathToFileURL(join(VEHICLES, 'demo', 'data.mjs')).href);
const claimData = await import(pathToFileURL(join(CLAIMS, 'demo', 'data.mjs')).href);
const numbers = (json) => (json?.entries ?? []).map((entry) => vehicles.byId.get(entry.uid)?.key);

console.log('Answered from the kit');
{
  const { result, requests } = await upstreamSaw(() => get('/nuxeo/api/v1/config/types'));
  const json = result.json;
  check(
    "the kit's types are merged into the upstream's /config/types",
    json?.doctypes?.VehicleDeal?.schemas?.includes('vehicledeal_docs') && json?.doctypes?.File,
  );
  check(
    "the kit's own schemas are added, flat, and the upstream's kept",
    json?.schemas?.vehicledeal?.['@prefix'] === 'vdeal' &&
      json?.schemas?.dublincore?.fromUpstream === 'string',
  );
  check('the merged answer asked the upstream once, as it was asked', requests.length === 1);
}
{
  const { result, requests } = await upstreamSaw(() =>
    get('/nuxeo/api/v1/config/types/VehicleDeal'),
  );
  check(
    "/config/types/VehicleDeal answers the kit's model, schemas and fields",
    result.status === 200 &&
      result.json?.schemas?.find((schema) => schema.name === 'vehicledeal_docs')?.fields?.checklist
        ?.type === 'complex[]',
  );
  check('(negative) a type of the kit is not asked of the upstream', requests.length === 0);
}
{
  const result = await get('/nuxeo/api/v1/config/schemas/vehicletitle');
  check(
    "/config/schemas/<the kit's> answers the model where the upstream has none",
    result.status === 200 && result.json?.fields?.openedOn === 'date',
  );
}
{
  const result = await get(`/nuxeo/api/v1/id/${deal.id}`, {
    headers: { properties: '*', 'enrichers.document': 'permissions,breadcrumb' },
  });
  const properties = result.json?.properties ?? {};
  check(
    'a record by id, as the seed writes it: number, link to its title by id, dates from today',
    result.status === 200 &&
      properties['vdeal:number'] === 'VD-5002' &&
      properties['vdeal:title'] === title.id &&
      properties['vdeal:soldOn'] === '2026-11-07' &&
      properties['dc:title'] === 'Tobiah Rennick, 2022 Harlow Brisk',
  );
  check(
    "a record's checklist as data.mjs's checklistOf writes it",
    JSON.stringify(properties['vdocs:checklist']) ===
      JSON.stringify(vehicleData.checklistOf(vehicleData.DEALS[1], TODAY)),
  );
  const permissions = result.json?.contextParameters?.permissions ?? [];
  check(
    "(negative) a record's permissions are Read's, with no Write",
    permissions.includes('Read') &&
      !permissions.some((each) => /Write|Everything|Remove|AddChildren/.test(each)) &&
      JSON.stringify(permissions) === JSON.stringify(READ_ONLY_PERMISSIONS),
    JSON.stringify(permissions),
  );
  check(
    'the breadcrumb runs workspace, folder, record',
    JSON.stringify(result.json?.contextParameters?.breadcrumb?.entries?.map((e) => e.type)) ===
      JSON.stringify(['Workspace', 'Folder', 'VehicleDeal']),
  );
}
{
  const result = await get(`/nuxeo/api/v1/id/${deal.id}`, {
    headers: { properties: 'vehicletitle' },
  });
  check(
    'the properties header names the schemas written, and no other',
    result.json && !('vdeal:number' in result.json.properties),
  );
}
{
  const byPath = await get(`/nuxeo/api/v1/path${encodeURI(deal.path)}`);
  const children = await get(
    `/nuxeo/api/v1/path${encodeURI(deal.path.replace(/\/[^/]+$/, ''))}/@children`,
  );
  check('a record by its path, as the seed places it', byPath.json?.uid === deal.id);
  check(
    "a folder's children are its records",
    children.json?.resultsCount === vehicleData.DEALS.length,
    String(children.json?.resultsCount),
  );
}
{
  const audit = await get(`/nuxeo/api/v1/id/${deal.id}/@audit?pageSize=10`);
  const blob = await get(`/nuxeo/api/v1/id/${deal.id}/@blob/file:content`);
  check(
    "a record's audit is an empty list",
    audit.json?.['entity-type'] === 'logEntries' && audit.json.entries.length === 0,
  );
  check('a record has no file: 404', blob.status === 404);
}
{
  const ids = [title.id, vehicles.byKey.get('TTL-6003').id];
  const query = 'SELECT * FROM Document WHERE ecm:uuid IN (?, ?)';
  const path =
    `/nuxeo/api/v1/search/lang/NXQL/execute?query=${encodeURIComponent(query)}&pageSize=2` +
    ids.map((id) => `&queryParams=${id}`).join('');
  const { result, requests } = await upstreamSaw(() => get(path));
  check(
    'the NXQL search by id answers stand-in records',
    result.json?.entries?.map((entry) => entry.uid).join() === ids.join(),
  );
  check(
    '(negative) a search of stand-in ids only is not asked of the upstream',
    requests.length === 0,
  );
}
{
  const expected = vehicleData.EXPECTED.vtitles_deals_missing_documents;
  const plain = await get(
    '/nuxeo/api/v1/search/pp/vtitles_deals_missing_documents/execute?pageSize=50',
  );
  const sorted = await get(
    '/nuxeo/api/v1/search/pp/vtitles_deals_missing_documents/execute?pageSize=50&sortBy=vdeal:soldOn&sortOrder=desc',
  );
  const paged = await get(
    '/nuxeo/api/v1/search/pp/vtitles_deals_missing_documents/execute?pageSize=2&currentPageIndex=1',
  );
  check(
    'a page provider answered from EXPECTED, in its order',
    numbers(plain.json).join() === expected.join() && plain.json.resultsCount === expected.length,
    numbers(plain.json).join(),
  );
  check(
    "a page provider sorted by the request's sortBy",
    numbers(sorted.json).join() === [...expected].reverse().join(),
    numbers(sorted.json).join(),
  );
  check(
    'a page provider paged as Nuxeo pages',
    numbers(paged.json).join() === expected.slice(2, 4).join() &&
      paged.json.currentPageIndex === 1 &&
      paged.json.isPreviousPageAvailable === true,
  );
  const parameter = await get(
    `/nuxeo/api/v1/search/pp/vtitles_title_sales/execute?pageSize=10&queryParams=${title.id}`,
  );
  check(
    'a page provider with a parameter answered by the record given',
    numbers(parameter.json).join() === vehicleData.EXPECTED.vtitles_title_sales['TTL-6002'].join(),
    numbers(parameter.json).join(),
  );
  const lien = await get(
    '/nuxeo/api/v1/search/pp/vtitles_awaiting_lien_release/execute?pageSize=50',
  );
  const counted = Object.fromEntries(
    Object.entries(lien.json?.aggregations ?? {}).map(([id, aggregate]) => [
      id,
      Object.fromEntries(aggregate.buckets.map((bucket) => [bucket.key, bucket.docCount])),
    ]),
  );
  check(
    "a page provider's facets counted as data.mjs's LIEN_BUCKETS counts them",
    JSON.stringify(counted.vtitle_lienHolder_agg) ===
      JSON.stringify(
        sortKeys(vehicleData.LIEN_BUCKETS.vtitle_lienHolder_agg, counted.vtitle_lienHolder_agg),
      ) &&
      JSON.stringify(counted.vtitle_issuingState_agg) ===
        JSON.stringify(
          sortKeys(
            vehicleData.LIEN_BUCKETS.vtitle_issuingState_agg,
            counted.vtitle_issuingState_agg,
          ),
        ),
    JSON.stringify(counted),
  );
  const chosen = await get(
    `/nuxeo/api/v1/search/pp/vtitles_awaiting_lien_release/execute?pageSize=50&vtitle_lienHolder_agg=${encodeURIComponent('["Harrow Valley Bank"]')}`,
  );
  check(
    'a bucket chosen keeps its records only, and its own facet keeps every bucket',
    numbers(chosen.json).join() === 'TTL-6003' &&
      chosen.json.aggregations.vtitle_lienHolder_agg.buckets.length === 2,
  );
  const open = await call(
    claimPort,
    'GET',
    '/nuxeo/api/v1/search/pp/pc_open_claims/execute?pageSize=50',
  );
  const policyBuckets = Object.fromEntries(
    (open.json?.aggregations?.pclaim_policy_agg?.buckets ?? []).map((bucket) => [
      claims.byId.get(bucket.key)?.key ?? bucket.key,
      bucket.docCount,
    ]),
  );
  check(
    "the P&C kit's policy facet, by id, counts as data.mjs's OPEN_BUCKETS, by number",
    JSON.stringify(sortKeys(policyBuckets)) ===
      JSON.stringify(sortKeys(claimData.OPEN_BUCKETS.pclaim_policy_agg)),
    JSON.stringify(policyBuckets),
  );
}

console.log('Refused, and not answered');
{
  const { result, requests } = await upstreamSaw(() =>
    call(vehiclePort, 'PUT', `/nuxeo/api/v1/id/${deal.id}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'entity-type': 'document', properties: { 'vdeal:notes': 'x' } }),
    }),
  );
  check(
    '(negative) a write to a stand-in record by its address is refused, 403, saying why',
    result.status === 403 && /read-only/.test(result.json?.message ?? ''),
    `${result.status} ${result.text.slice(0, 120)}`,
  );
  check('(negative) the refused write was not sent to the upstream', requests.length === 0);
}
{
  const { result, requests } = await upstreamSaw(() =>
    call(vehiclePort, 'POST', '/nuxeo/api/v1/automation/Document.Update', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: deal.id, params: { properties: 'dc:title=x' } }),
    }),
  );
  check(
    '(negative) a write naming a stand-in record in its body is refused, 403',
    result.status === 403,
    String(result.status),
  );
  check('(negative) the refused operation was not sent to the upstream', requests.length === 0);
}
{
  const { result, requests } = await upstreamSaw(() =>
    call(vehiclePort, 'POST', '/nuxeo/api/v1/automation/Connector.Read', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { document: deal.id } }),
    }),
  );
  check(
    '(negative) an operation that reads a stand-in record is not run: 501, and not sent on',
    result.status === 501 && requests.length === 0,
    String(result.status),
  );
}
{
  const { result, requests } = await upstreamSaw(() =>
    call(claimPort, 'GET', '/nuxeo/api/v1/search/pp/pc_capture_review/execute?pageSize=50'),
  );
  check(
    '(negative) a page provider EXPECTED does not list is answered 501, saying so',
    result.status === 501 && /EXPECTED does not say/.test(result.json?.message ?? ''),
    `${result.status} ${result.text.slice(0, 120)}`,
  );
  check('(negative) ... and is not asked of the upstream', requests.length === 0);
}
{
  const query = `SELECT * FROM Document WHERE ecm:parentId = '${deal.id}'`;
  const { result, requests } = await upstreamSaw(() =>
    get(`/nuxeo/api/v1/search/lang/NXQL/execute?query=${encodeURIComponent(query)}`),
  );
  check(
    '(negative) another search naming a stand-in record is answered 501, and not sent on',
    result.status === 501 && requests.length === 0,
    String(result.status),
  );
}
{
  const { result, requests } = await upstreamSaw(() =>
    get(`/nuxeo/api/v1/id/${deal.id}/@rendition/thumbnail`),
  );
  const inPath = await upstreamSaw(() =>
    get(`/nuxeo/nxfile/default/${deal.id}/file:content/x.pdf`),
  );
  check(
    "(negative) an address naming a stand-in record is never forwarded: it is not the server's",
    result.status === 404 &&
      requests.length === 0 &&
      inPath.result.status === 404 &&
      inPath.requests.length === 0,
  );
}
{
  let refused = null;
  try {
    await loadKit(join(PACKAGES, 'records-demo'));
  } catch (error) {
    refused = error;
  }
  check(
    '(negative) a kit whose data.mjs it does not read is refused, naming the kits it reads',
    refused instanceof Precondition && /vehicle-titles-demo/.test(refused.message),
  );
}

console.log('Forwarded');
{
  const { result, requests } = await upstreamSaw(() => get(`/nuxeo/api/v1/id/${OTHER_ID}?x=1`));
  check(
    'a record that is not a stand-in is forwarded, its address as it came',
    result.json?.title === 'From the upstream' &&
      requests.length === 1 &&
      requests[0].url === `/nuxeo/api/v1/id/${OTHER_ID}?x=1`,
  );
}
{
  const query = 'SELECT * FROM Document WHERE ecm:uuid IN (?, ?)';
  const path =
    `/nuxeo/api/v1/search/lang/NXQL/execute?query=${encodeURIComponent(query)}&pageSize=2` +
    `&queryParams=${deal.id}&queryParams=${OTHER_ID}`;
  const { result, requests } = await upstreamSaw(() => get(path));
  const asked = requests[0] ? new URL(requests[0].url, 'http://x').searchParams : null;
  check(
    'a mixed search by id asks the upstream for the other ids only, and answers both',
    result.json?.entries?.map((entry) => entry.uid).join() === [deal.id, OTHER_ID].join() &&
      requests.length === 1 &&
      asked.getAll('queryParams').join() === OTHER_ID,
  );
  const none = 'SELECT * FROM Document WHERE ecm:primaryType = ?';
  const plain = await upstreamSaw(() =>
    get(
      `/nuxeo/api/v1/search/lang/NXQL/execute?query=${encodeURIComponent(none)}&queryParams=File`,
    ),
  );
  check(
    'a search naming no stand-in record is forwarded unchanged',
    plain.requests.length === 1 &&
      plain.requests[0].url ===
        `/nuxeo/api/v1/search/lang/NXQL/execute?query=${encodeURIComponent(none)}&queryParams=File`,
  );
}
{
  const { result, requests } = await upstreamSaw(() =>
    get('/nuxeo/api/v1/search/pp/default_search/execute?pageSize=1'),
  );
  check(
    "a page provider of the platform's is forwarded",
    result.json?.fromUpstream === true && requests.length === 1,
  );
}
{
  const body = Buffer.from(JSON.stringify({ input: OTHER_ID, params: { note: 'é, unchanged' } }));
  const { result, requests } = await upstreamSaw(() =>
    call(vehiclePort, 'POST', '/nuxeo/api/v1/automation/Document.Update', {
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  check(
    'a write naming no stand-in record is forwarded, its body byte for byte',
    result.json?.forwarded === true && requests.length === 1 && requests[0].body.equals(body),
  );
}
{
  const body = Buffer.from(`user_name=someone&note=${deal.id}`);
  const { requests } = await upstreamSaw(() =>
    call(vehiclePort, 'POST', '/nuxeo/startup', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
  check(
    "(negative) a sign-in form's body is not read: forwarded whatever it holds",
    requests.length === 1 && requests[0].body.equals(body),
  );
}
{
  const { result, requests } = await upstreamSaw(() =>
    get('/nuxeo/redirect', { headers: { origin: `http://localhost:${vehiclePort}` } }),
  );
  check(
    "a redirect to the upstream comes back to the stand-in, as the dev server's proxy expects",
    result.status === 302 &&
      result.headers.location === `http://localhost:${vehiclePort}/nuxeo/landed`,
    result.headers.location,
  );
  check(
    'the upstream is asked with its own Host and Origin, as the dev server asks it',
    requests[0]?.headers.host === `127.0.0.1:${upstreamPort}` &&
      requests[0]?.headers.origin === UPSTREAM,
    `${requests[0]?.headers.host} ${requests[0]?.headers.origin}`,
  );
}

console.log('Credentials untouched');
{
  const secret = randomBytes(16).toString('hex');
  const authorization = `Basic ${Buffer.from(`someone:${secret}`).toString('base64')}`;
  const cookie = `JSESSIONID=${randomBytes(12).toString('hex')}; other=${randomBytes(4).toString('hex')}`;
  const headers = { authorization, cookie };
  const forwarded = await upstreamSaw(() => get('/nuxeo/api/v1/me', { headers }));
  check(
    'Authorization and Cookie reach the upstream as they were sent',
    forwarded.requests.length === 1 &&
      forwarded.requests[0].headers.authorization === authorization &&
      forwarded.requests[0].headers.cookie === cookie,
  );
  check(
    "the upstream's Set-Cookie comes back as it was written",
    [forwarded.result.headers['set-cookie']].flat()[0] === UPSTREAM_COOKIE,
  );
  const merged = await upstreamSaw(() => get('/nuxeo/api/v1/config/types', { headers }));
  check(
    'a merged answer asks with the same credentials, and keeps the Set-Cookie',
    merged.requests[0]?.headers.authorization === authorization &&
      merged.requests[0]?.headers.cookie === cookie &&
      [merged.result.headers['set-cookie']].flat()[0] === UPSTREAM_COOKIE,
  );
  await get(`/nuxeo/api/v1/id/${deal.id}`, { headers });
  await call(vehiclePort, 'PUT', `/nuxeo/api/v1/id/${deal.id}`, { headers, body: '{}' });
  const everything = logged.join('\n');
  check(
    '(negative) no credential, cookie or query is in what the stand-in logged',
    logged.length > 0 &&
      !everything.includes(secret) &&
      !everything.includes(authorization) &&
      !everything.includes(cookie.slice(11, 35)) &&
      !everything.includes(UPSTREAM_COOKIE.slice(11, 35)) &&
      !everything.includes('?'),
  );
}

console.log("Each kit's mapping, held to its seed and its model");
for (const name of Object.keys(KITS)) {
  const directory = join(PACKAGES, name);
  const kit = await loadKit(directory, { today: TODAY });
  const data = await import(pathToFileURL(join(directory, 'demo', 'data.mjs')).href);
  const rows = KITS[name].records(data, {
    id: (key) => key,
    day: (days) => days ?? null,
    today: TODAY,
  });
  const mapped = new Set(rows.flatMap((row) => Object.keys(row.properties)));
  const seed = readFileSync(join(directory, 'demo', 'seed.mjs'), 'utf8');
  const seeded = new Set(
    [...seed.matchAll(/'([a-z][a-z0-9_-]*:[A-Za-z][\w-]*)'\s*:/g)].map((m) => m[1]),
  );
  // The workspace's description is the seed's, on no record.
  seeded.delete('dc:description');
  const onlyMapped = [...mapped].filter((property) => !seeded.has(property));
  const onlySeeded = [...seeded].filter((property) => !mapped.has(property));
  check(
    `${name}: kits.mjs writes the properties its seed writes, no more, no fewer`,
    onlyMapped.length === 0 && onlySeeded.length === 0,
    `kits.mjs only: ${onlyMapped.join(', ') || 'none'}; seed only: ${onlySeeded.join(', ') || 'none'}`,
  );
  const providers = [...kit.providers.keys()];
  const answered = kit.answered.length;
  check(
    `${name}: ${kit.byKey.size} records, held to content-model.json; ${answered} of ${providers.length} page providers answered from EXPECTED`,
    kit.byKey.size === rows.length &&
      answered === Object.keys(data.EXPECTED).filter((p) => providers.includes(p)).length,
  );
}
check(
  'ids are stable: the same kit and record give the same id, another kit another',
  standInId('vehicle-titles-demo/record/VD-5002') === deal.id &&
    (await loadKit(VEHICLES)).byKey.get('VD-5002').id === deal.id &&
    standInId('pc-claims-demo/record/VD-5002') !== deal.id,
);

function sortKeys(object, order = null) {
  const keys = order ? Object.keys(order) : Object.keys(object ?? {}).sort();
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(object ?? {}, key)).map((key) => [key, object[key]]),
  );
}

vehicleStandIn.close();
claimStandIn.close();
upstream.close();
console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log(`Failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
