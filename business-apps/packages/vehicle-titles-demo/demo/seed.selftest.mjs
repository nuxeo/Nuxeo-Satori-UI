#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls, and
 * for the kit's data as the record pages and queues read it, which no check outside the kit
 * compares.
 *
 *   node business-apps/packages/vehicle-titles-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here, on
 * the model of the P&C claims kit's (`pc-claims-demo/demo/seed.selftest.mjs`): documents by path
 * and by id, `Document.Untrash`, NXQL through `Repository.Query`, trash renaming a document to
 * `<name>._<time>_.trashed`, and the kit's five page providers, answered as
 * `vehicle-titles-demo-model.xml` defines them, a title's deals given their parameter as
 * `queryParams`, and the titles awaiting lien release with their two aggregates and a search index
 * that can lag. So a pass proves the script's logic: each of its preconditions, a deal's titles
 * written as their ids, its checklist written whole, a second run that adds nothing, puts back what
 * was changed, a tick among it, and leaves a deal's attachments alone, a trashed record restored
 * and put back, a trashed sibling whose name only looks like it left alone, two trashed copies
 * refused, a document of another type left alone, a server that hangs up or pages forever stopping
 * the run, the credentials never printed, and a check that fails when a page provider leaves out a
 * record, holds one it should not, is out of order, lists one twice, ignores its parameter,
 * answers no facet, or whose index never catches up. It says nothing about whether a real server
 * accepts the stand-in model, runs its NXQL, or answers as the stand-in does: only a run against
 * one shows that, and none has run yet.
 *
 * It runs the real `seed.mjs` as a command, against a server on 127.0.0.1, with a user and a
 * password made up for the run. Node 24 and nothing else. CI does not run it.
 *
 * Exit 0 when every control behaves as required, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEALS,
  EXPECTED,
  FINANCE_DOCUMENTS,
  OPEN_TITLE,
  OVERDUE_AFTER_DAYS,
  REQUIRED_DOCUMENTS,
  SOLD,
  TITLES,
  checklistOf,
  dayFrom,
  documentsOf,
} from './data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, 'seed.mjs');
const KIT = join(HERE, '..');
const ROOT = '/default-domain/workspaces/vehicle-titles-demo';
const TITLES_AT = `${ROOT}/titles`;
const DEALS_AT = `${ROOT}/deals`;
const RECORDS = TITLES.length + DEALS.length;
const CONTAINERS = 3;
const DEAL_SCHEMAS = ['common', 'dublincore', 'files', 'vehicledeal', 'vehicledeal_docs'];

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `types` are the document types it has; `dealSchemas` the schemas it gives
 * `VehicleDeal`; `brokenProvider` makes one page provider return nothing; `widenedProvider` makes
 * one return every live record of its type; `reversedProvider` returns one's records in the
 * reverse order; `doubledProvider` lists one's first record twice; `endlessProvider` always says
 * there is another page; `ignoresParameter` makes a title's deals return every deal, whatever they
 * are given; `overdueFrom` is the number of days open from which the overdue titles list a title,
 * 31 as the page provider's `NOW('-P31D')` lists it; `indexLag` answers the titles awaiting lien
 * release with nothing for that many calls, as an index that has not caught up; `noAggregates`
 * answers them with no aggregate; `meStatus` answers `/me` with that status, and `meBody`, with
 * 200, with that text in place of the user; `noWorkspaces` leaves out /default-domain/workspaces;
 * `hangUpOnFirstWrite` drops the connection on the first create; `pageSize` caps what a page
 * holds, so paging is exercised.
 */
function standIn({
  user,
  password,
  types = ['Workspace', 'Folder', 'VehicleTitle', 'VehicleDeal'],
  dealSchemas = DEAL_SCHEMAS,
  brokenProvider = null,
  widenedProvider = null,
  reversedProvider = null,
  doubledProvider = null,
  endlessProvider = null,
  ignoresParameter = null,
  overdueFrom = OVERDUE_AFTER_DAYS + 1,
  indexLag = 0,
  noAggregates = false,
  meStatus = 200,
  meBody = null,
  noWorkspaces = false,
  hangUpOnFirstWrite = false,
  pageSize = 2,
}) {
  const byPath = new Map();
  const byId = new Map();
  const calls = [];
  const add = (path, type, properties = {}) => {
    const document = {
      'entity-type': 'document',
      uid: randomUUID(),
      path,
      type,
      isTrashed: false,
      properties: { ...properties },
    };
    byPath.set(path, document);
    byId.set(document.uid, document);
    return document;
  };
  const move = (document, path) => {
    byPath.delete(document.path);
    document.path = path;
    byPath.set(path, document);
  };
  const nameOf = (document) => document.path.slice(document.path.lastIndexOf('/') + 1);
  const parentOf = (document) => byPath.get(document.path.slice(0, document.path.lastIndexOf('/')));
  const trash = (document) => {
    document.isTrashed = true;
    move(document, `${document.path}._${Date.now()}${Math.floor(Math.random() * 1000)}_.trashed`);
  };
  const untrash = (document) => {
    document.isTrashed = false;
    const original = /^(.*)\._\d+_\.trashed$/.exec(document.path);
    if (original) move(document, original[1]);
  };
  add('/default-domain', 'Domain');
  if (!noWorkspaces) add('/default-domain/workspaces', 'WorkspaceRoot');

  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const live = (type) => [...byId.values()].filter((d) => !d.isTrashed && d.type === type);
  const prop = (d, name) => d.properties[name] ?? '';
  // Days are ISO text, which compares as text.
  const asc = (name) => (a, b) => String(prop(a, name)).localeCompare(String(prop(b, name)));
  const desc = (name) => (a, b) => asc(name)(b, a);
  // `vtitle:openedOn < NOW('-P31D')`: a day stored at midnight that is at least 31 days ago.
  const openedBefore = (d) => String(prop(d, 'vtitle:openedOn')) <= dayFrom(-overdueFrom);
  const providers = {
    vtitles_deals_missing_documents: {
      type: 'VehicleDeal',
      // `vdeal:status IN (...) AND vdocs:checklist/*/done = 0`: an entry of the list not done.
      answer: () =>
        live('VehicleDeal')
          .filter(
            (d) =>
              SOLD.includes(prop(d, 'vdeal:status')) &&
              (d.properties['vdocs:checklist'] ?? []).some((entry) => entry?.done === false),
          )
          .sort(asc('vdeal:soldOn')),
    },
    vtitles_overdue_titles: {
      type: 'VehicleTitle',
      answer: () =>
        live('VehicleTitle')
          .filter((d) => OPEN_TITLE.includes(prop(d, 'vtitle:status')) && openedBefore(d))
          .sort(asc('vtitle:openedOn')),
    },
    vtitles_awaiting_lien_release: {
      type: 'VehicleTitle',
      answer: () =>
        live('VehicleTitle')
          .filter((d) => prop(d, 'vtitle:status') === 'Awaiting lien release')
          .sort(asc('vtitle:payoffSentOn')),
    },
    vtitles_title_sales: {
      type: 'VehicleDeal',
      parameter: true,
      answer: (uid) =>
        live('VehicleDeal')
          .filter((d) => prop(d, 'vdeal:title') === uid)
          .sort(desc('vdeal:soldOn')),
    },
    vtitles_title_trade_ins: {
      type: 'VehicleDeal',
      parameter: true,
      answer: (uid) =>
        live('VehicleDeal')
          .filter((d) => prop(d, 'vdeal:tradeInTitle') === uid)
          .sort(desc('vdeal:soldOn')),
    },
  };
  let indexCalls = 0;
  const buckets = (found, property) => {
    const counts = new Map();
    for (const d of found) {
      const key = d.properties[property];
      if (key === null || key === undefined || key === '') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([key, docCount]) => ({ key, docCount }));
  };
  const TRASHED_QUERY =
    /^SELECT \* FROM Document WHERE ecm:parentId = '([^']+)' AND ecm:isTrashed = 1 AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:name LIKE '([^']+)'$/;
  const page = (entries, index) => ({
    entries: entries.slice(index * pageSize, (index + 1) * pageSize),
    isNextPageAvailable: (index + 1) * pageSize < entries.length,
  });

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (request.headers.authorization !== authorization)
      return send(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname).replace(/^\/nuxeo\/api\/v1/, '');
    const { method } = request;
    calls.push(`${method} ${path}`);
    try {
      if (method === 'GET' && path === '/me') {
        if (meStatus !== 200) return send(meStatus, { message: 'no' });
        if (meBody === null) return send(200, { 'entity-type': 'user', id: user });
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end(meBody);
      }
      // A server that goes away once writing has started: the connection drops, with no answer.
      if (hangUpOnFirstWrite && method === 'POST' && path.startsWith('/path/'))
        return request.socket.destroy();
      if (method === 'GET' && path.startsWith('/config/types/')) {
        const type = path.slice('/config/types/'.length);
        if (!types.includes(type)) return send(404, { message: 'no such type' });
        // As Nuxeo describes a type: its schemas, each with its name.
        const schemas = type === 'VehicleDeal' ? dealSchemas : ['common', 'dublincore'];
        return send(200, { parent: 'Document', schemas: schemas.map((name) => ({ name })) });
      }
      if (method === 'GET' && path.startsWith('/path/')) {
        const document = byPath.get(path.slice('/path'.length));
        return document ? send(200, document) : send(404, { message: 'not found' });
      }
      if (method === 'POST' && path.startsWith('/path/')) {
        const parent = path.slice('/path'.length);
        if (!byPath.has(parent)) return send(404, { message: 'no parent' });
        const body = JSON.parse(raw);
        if (!types.includes(body.type)) return send(400, { message: `no type ${body.type}` });
        // Nuxeo would give the new document another name; the seed must never ask it to.
        if (byPath.has(`${parent}/${body.name}`)) return send(409, { message: 'name taken' });
        return send(201, add(`${parent}/${body.name}`, body.type, body.properties));
      }
      if (path.startsWith('/id/')) {
        const document = byId.get(path.slice('/id/'.length));
        if (!document) return send(404, { message: 'not found' });
        if (method === 'PUT') {
          // Nuxeo writes the properties a PUT names and leaves the others as they are.
          Object.assign(document.properties, JSON.parse(raw).properties);
          return send(200, document);
        }
        if (method === 'GET') return send(200, document);
      }
      if (method === 'POST' && path === '/automation/Document.Untrash') {
        const document = byId.get(JSON.parse(raw).input.replace(/^doc:/, ''));
        untrash(document);
        return send(200, document);
      }
      if (method === 'POST' && path === '/automation/Repository.Query') {
        const body = JSON.parse(raw).params;
        const query = TRASHED_QUERY.exec(body.query ?? '');
        if (!query) return send(400, { message: 'a query the stand-in does not know' });
        const [, parent, like] = query;
        const pattern = new RegExp(
          `^${like
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.')}$`,
        );
        const found = [...byId.values()].filter(
          (d) => d.isTrashed && parentOf(d)?.uid === parent && pattern.test(nameOf(d)),
        );
        return send(200, page(found, Number(body.currentPageIndex ?? 0)));
      }
      const execute = /^\/search\/pp\/([^/]+)\/execute$/.exec(path);
      if (method === 'GET' && execute) {
        const name = execute[1];
        const provider = providers[name];
        if (!provider) return send(404, { message: 'no such page provider' });
        const parameter = url.searchParams.get('queryParams');
        // A page provider with a ? and none given: the local Nuxeo answered 400, "Illegal
        // character <?>", on 26 November 2026, as the moves kit's run read it.
        if (provider.parameter && !parameter) return send(400, { message: 'no parameter' });
        const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
        let found;
        if (brokenProvider === name) found = [];
        else if (widenedProvider === name || ignoresParameter === name) found = live(provider.type);
        else found = provider.answer(parameter);
        if (reversedProvider === name) found = [...found].reverse();
        if (doubledProvider === name && found.length > 0) found = [found[0], ...found];
        let aggregations;
        if (name === 'vtitles_awaiting_lien_release') {
          if (index === 0) indexCalls++;
          if (indexCalls <= indexLag) found = [];
          aggregations = noAggregates
            ? {}
            : {
                vtitle_lienHolder_agg: { buckets: buckets(found, 'vtitle:lienHolder') },
                vtitle_issuingState_agg: { buckets: buckets(found, 'vtitle:issuingState') },
              };
        }
        const answer = { ...page(found, index), ...(aggregations ? { aggregations } : {}) };
        return send(
          200,
          endlessProvider === name ? { ...answer, isNextPageAvailable: true } : answer,
        );
      }
      return send(404, { message: `the stand-in does not answer ${method} ${path}` });
    } catch (error) {
      return send(500, { message: error.message });
    }
  });
  Object.assign(server, { byPath, add, trash, calls, indexCalls: () => indexCalls });
  return server;
}

/** Every output of every run, and every credential a run was given, as typed and as a header. */
const outputs = [];
const secrets = new Set();
function given(user, password) {
  secrets.add(password);
  secrets.add(Buffer.from(`${user}:${password}`).toString('base64'));
}

/** A run of the real seed, as a command, with the environment given. */
function seed(env) {
  if (env.NUXEO_USER && env.NUXEO_PASS) given(env.NUXEO_USER, env.NUXEO_PASS);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], { env: { PATH: process.env.PATH, ...env } });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.on('close', (status) => {
      outputs.push(output);
      resolve({ status, output });
    });
  });
}

/** `body` given the stand-in and a way to run the seed against it. */
async function against(options, body) {
  const user = `selftest-${randomUUID().slice(0, 8)}`;
  const password = randomUUID();
  const server = standIn({ user, password, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (env = {}) =>
    seed({
      NUXEO_URL: url,
      NUXEO_USER: user,
      NUXEO_PASS: password,
      NUXEO_TIMEOUT_MS: '2000',
      NUXEO_INDEX_WAIT_MS: '4000',
      ...env,
    });
  try {
    await body({ server, run, user, password });
  } catch (error) {
    expect(false, `a control threw: ${error?.stack ?? error}`);
  } finally {
    server.close();
  }
}

const done = (output) => output.split('\n').find((line) => line.startsWith('Done')) ?? '';
const writes = (server) => server.calls.filter((call) => !call.startsWith('GET ')).length;
const titleAt = (server, number) => server.byPath.get(`${TITLES_AT}/${number.toLowerCase()}`);
const dealAt = (server, number) => server.byPath.get(`${DEALS_AT}/${number.toLowerCase()}`);
const entryOf = (deal, item) =>
  (deal?.properties['vdocs:checklist'] ?? []).find((entry) => entry.item === item);

// Preconditions: exit 2, before anything is written.
{
  const { status, output } = await seed({ NUXEO_USER: '', NUXEO_PASS: randomUUID() });
  expect(status === 2 && /must both be set/.test(output), 'an empty NUXEO_USER is exit 2', output);
}
{
  const { status, output } = await seed({
    NUXEO_URL: 'http://127.0.0.1:9',
    NUXEO_USER: 'selftest',
    NUXEO_PASS: randomUUID(),
  });
  expect(status === 2 && /did not answer/.test(output), 'no server is exit 2', output);
}
await against({}, async ({ server, run }) => {
  const { status, output } = await run({ NUXEO_PASS: randomUUID() });
  expect(
    status === 2 && /refused NUXEO_USER and NUXEO_PASS/.test(output) && writes(server) === 0,
    'refused credentials are exit 2, with nothing written',
    output,
  );
});
await against({ meStatus: 404 }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /answered GET \/me with HTTP 404/.test(output) && writes(server) === 0,
    'a server that does not answer /me as Nuxeo does is exit 2, with nothing written',
    output,
  );
});
await against({ meBody: '<html><body>Welcome</body></html>' }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /answered GET \/me with something that is not JSON/.test(output) &&
      writes(server) === 0,
    'a server that answers /me 200 with a page, not JSON, is exit 2, with nothing written',
    output,
  );
});
await against({ meBody: '{"status":"ok"}' }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /answered GET \/me with no user/.test(output) && writes(server) === 0,
    'a server that answers /me 200 with JSON that is no user is exit 2, with nothing written',
    output,
  );
});
await against({ types: ['Workspace', 'Folder', 'VehicleTitle'] }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no VehicleDeal type/.test(output) && writes(server) === 0,
    'a server without the package, its VehicleDeal type missing, is exit 2, with nothing written',
    output,
  );
});
await against(
  { dealSchemas: ['common', 'dublincore', 'files', 'vehicledeal'] },
  async ({ server, run }) => {
    const { status, output } = await run();
    expect(
      status === 2 &&
        /VehicleDeal type has no vehicledeal_docs schema/.test(output) &&
        writes(server) === 0,
      "a server whose VehicleDeal has no checklist schema, the package's checklist component missing, is exit 2, with nothing written",
      output,
    );
  },
);
await against({ noWorkspaces: true }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /has no \/default-domain\/workspaces/.test(output) && writes(server) === 0,
    'a server without /default-domain/workspaces is exit 2, with nothing written',
    output,
  );
});

// A first run writes everything, links it by id, and checks it; a second adds nothing, puts back
// what changed, a tick among it, and leaves a deal's attachments alone.
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(
    first.status === 0 &&
      done(first.output).startsWith(`Done: ${RECORDS + CONTAINERS} created, 0 updated`),
    'a first run creates the workspace, the two folders and every record, and exits 0',
    first.output,
  );
  const deal = dealAt(server, 'VD-5002');
  expect(
    deal?.properties['vdeal:title'] === titleAt(server, 'TTL-6002')?.uid &&
      deal?.properties['vdeal:tradeInTitle'] === titleAt(server, 'TTL-6003')?.uid &&
      dealAt(server, 'VD-5007')?.properties['vdeal:title'] === titleAt(server, 'TTL-6002')?.uid &&
      dealAt(server, 'VD-5006')?.properties['vdeal:title'] === null &&
      dealAt(server, 'VD-5001')?.properties['vdeal:tradeInTitle'] === null,
    "a deal names its title and its trade-in's title by their ids, as document-link reads them, and none where it has none",
    JSON.stringify(deal?.properties ?? null),
  );
  expect(
    titleAt(server, 'TTL-6008')?.properties['vtitle:openedOn'] === dayFrom(-31) &&
      titleAt(server, 'TTL-6007')?.properties['vtitle:openedOn'] === dayFrom(-30) &&
      titleAt(server, 'TTL-6004')?.properties['vtitle:payoffSentOn'] === dayFrom(-12) &&
      dealAt(server, 'VD-5004')?.properties['vdeal:soldOn'] === dayFrom(-14),
    'dates are counted from today: a title open 31 days, one open 30, a payoff sent 12 days ago, a deal sold 14 days ago',
    JSON.stringify([
      titleAt(server, 'TTL-6008')?.properties,
      dealAt(server, 'VD-5004')?.properties,
    ]),
  );
  const odometer = entryOf(deal, 'odometer');
  const license = entryOf(deal, 'driversLicense');
  expect(
    (deal?.properties['vdocs:checklist'] ?? []).map((e) => e.item).join() ===
      REQUIRED_DOCUMENTS.join() &&
      (dealAt(server, 'VD-5004')?.properties['vdocs:checklist'] ?? []).map((e) => e.item).join() ===
        [...REQUIRED_DOCUMENTS, ...FINANCE_DOCUMENTS].join() &&
      odometer?.done === false &&
      odometer.doneBy === null &&
      odometer.doneOn === null &&
      license?.done === true &&
      license.doneBy === 'amara.oyelaran' &&
      license.doneOn === dayFrom(-19),
    "a deal's checklist has an entry for each of its documents, a cash deal's six and a financed deal's nine, done with who and when, or not done with neither",
    JSON.stringify(deal?.properties['vdocs:checklist'] ?? null),
  );
  expect(
    deal?.properties['vdeal:tradeIn'] === true &&
      dealAt(server, 'VD-5001')?.properties['vdeal:tradeIn'] === false &&
      deal?.properties['vdeal:price'] === 24900 &&
      deal?.properties['vdeal:year'] === 2022 &&
      dealAt(server, 'VD-5002')?.properties['vdeal:lender'] === null,
    'a trade-in is a boolean, a price a number, a year a number, and a cash deal has no lender',
  );
  expect(
    Object.keys(deal?.properties ?? {}).every((key) => !key.startsWith('files:')),
    "a first run writes no deal's attachments",
    JSON.stringify(deal?.properties ?? null),
  );

  // Changed on the server since: a status, a note the data does not have, a tick, and a photo
  // filed on a deal, which is not the seed's.
  const count = server.byPath.size;
  const photo = [{ file: { name: 'odometer-reading.jpg', 'mime-type': 'image/jpeg' } }];
  dealAt(server, 'VD-5001').properties['vdeal:status'] = 'Cancelled';
  dealAt(server, 'VD-5005').properties['vdeal:notes'] = 'Not in data.mjs';
  Object.assign(entryOf(dealAt(server, 'VD-5002'), 'odometer'), {
    done: true,
    doneBy: 'someone.else',
    doneOn: dayFrom(0),
  });
  dealAt(server, 'VD-5002').properties['files:files'] = photo;
  const second = await run();
  expect(
    second.status === 0 &&
      done(second.output).startsWith(`Done: 0 created, ${RECORDS + CONTAINERS} updated`) &&
      server.byPath.size === count,
    'a second run adds nothing, and exits 0',
    second.output,
  );
  expect(
    dealAt(server, 'VD-5001')?.properties['vdeal:status'] === 'Delivered' &&
      dealAt(server, 'VD-5005')?.properties['vdeal:notes'] === null &&
      entryOf(dealAt(server, 'VD-5002'), 'odometer')?.done === false &&
      entryOf(dealAt(server, 'VD-5002'), 'odometer')?.doneBy === null,
    "a second run puts each deal back to data.mjs's values, empties a note it does not have, and undoes a tick, so the demo can be given again",
    JSON.stringify([dealAt(server, 'VD-5001')?.properties, dealAt(server, 'VD-5002')?.properties]),
  );
  expect(
    JSON.stringify(dealAt(server, 'VD-5002')?.properties['files:files']) === JSON.stringify(photo),
    "a second run leaves a deal's attachments, files:files, as they are",
    JSON.stringify(dealAt(server, 'VD-5002')?.properties ?? null),
  );

  // A trashed title, changed before it was trashed, is restored and put back, not written again.
  titleAt(server, 'TTL-6005').properties['vtitle:status'] = 'In hand';
  server.trash(titleAt(server, 'TTL-6005'));
  const third = await run();
  expect(
    third.status === 0 &&
      /restored .*ttl-6005/.test(third.output) &&
      titleAt(server, 'TTL-6005')?.isTrashed === false &&
      titleAt(server, 'TTL-6005')?.properties['vtitle:status'] === 'Issued' &&
      server.byPath.size === count,
    'a trashed title is restored and put back, and nothing is added',
    third.output,
  );
});

// A trashed sibling whose name only matches the LIKE pattern is not the seed's to restore.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(DEALS_AT, 'Folder');
  const sibling = server.add(`${DEALS_AT}/vd-5001.old._1_.trashed`, 'VehicleDeal', {
    'vdeal:number': 'VD-5001-OLD',
  });
  sibling.isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 0 &&
      !/^ +restored /m.test(output) &&
      sibling.isTrashed === true &&
      dealAt(server, 'VD-5001')?.uid !== sibling.uid,
    'a trashed sibling named like a deal is left in the trash, and the deal is created',
    output,
  );
});

// Two trashed copies of one deal: the seed restores neither, and stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  server.trash(dealAt(server, 'VD-5006'));
  server.add(`${DEALS_AT}/vd-5006._2_.trashed`, 'VehicleDeal').isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named vd-5006/.test(output),
    'two trashed copies of one deal stop the run with exit 1',
    output,
  );
});

// A place that holds another type is left alone, and the run stops.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(TITLES_AT, 'Folder');
  const intruder = server.add(`${TITLES_AT}/ttl-6003`, 'File', { 'dc:title': 'Not the seed' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a VehicleTitle/.test(output) &&
      intruder.properties['dc:title'] === 'Not the seed',
    'a place holding another type stops the run with exit 1, and is left alone',
    output,
  );
});

// A server that goes away part way, and a page provider that pages forever, stop the run.
await against({ hangUpOnFirstWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /did not answer POST .* The run stopped part way/.test(output),
    'a server that hangs up on the first write stops the run with exit 1, not 2',
    output,
  );
});
await against({ endlessProvider: 'vtitles_overdue_titles' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_overdue_titles still reports another page after 100 pages/.test(output),
    'a page provider that always reports another page stops the run with exit 1',
    output,
  );
});

// The checks: a page provider that leaves out, adds, misorders or doubles a seeded record fails.
await against({ brokenProvider: 'vtitles_deals_missing_documents' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_deals_missing_documents does not return VD-5002/.test(output) &&
      /vtitles_deals_missing_documents does not return VD-5008/.test(output),
    'a missing-documents page provider that returns nothing fails the run, naming what is missing',
    output,
  );
});
await against({ widenedProvider: 'vtitles_deals_missing_documents' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_deals_missing_documents returns VD-5001\b/.test(output) &&
      /vtitles_deals_missing_documents returns VD-5006\b/.test(output) &&
      /vtitles_deals_missing_documents returns VD-5007\b/.test(output) &&
      !/vtitles_deals_missing_documents does not return/.test(output),
    'a missing-documents page provider that returns a complete deal, a deal still worked and a cancelled one fails the run, naming them',
    output,
  );
});
await against({ reversedProvider: 'vtitles_deals_missing_documents' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_deals_missing_documents returns VD-5008, VD-5004, VD-5002, not VD-5002, VD-5004, VD-5008/.test(
        output,
      ),
    'deals missing documents out of sale order, oldest first, fail the run',
    output,
  );
});
await against({ doubledProvider: 'vtitles_deals_missing_documents' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_deals_missing_documents returns VD-5002, VD-5002, VD-5004, VD-5008, not/.test(
        output,
      ),
    'a deal listed twice, as a query over a list could list one, fails the run',
    output,
  );
});
await against({ overdueFrom: OVERDUE_AFTER_DAYS }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_overdue_titles returns TTL-6007\b/.test(output) &&
      !/vtitles_overdue_titles does not return/.test(output),
    'overdue titles that count a title open 30 days, one day early, fail the run, naming it',
    output,
  );
});
await against({ overdueFrom: OVERDUE_AFTER_DAYS + 2 }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /vtitles_overdue_titles does not return TTL-6008\b/.test(output),
    'overdue titles that leave out a title open 31 days, one day late, fail the run, naming it',
    output,
  );
});
await against({ widenedProvider: 'vtitles_overdue_titles' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /vtitles_overdue_titles returns TTL-6005\b/.test(output),
    'overdue titles that list an issued title fail the run, naming it',
    output,
  );
});
await against({ ignoresParameter: 'vtitles_title_sales' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /vtitles_title_sales for TTL-6001 returns VD-5002\b/.test(output),
    "a title's deals page provider that ignores its title fails the run, naming another title's deal",
    output,
  );
});
await against({ reversedProvider: 'vtitles_title_sales' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /vtitles_title_sales for TTL-6002 returns VD-5007, VD-5002, not VD-5002, VD-5007/.test(
        output,
      ),
    "a title's deals out of sale order, latest first, fail the run",
    output,
  );
});
await against({ ignoresParameter: 'vtitles_title_trade_ins' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /vtitles_title_trade_ins for TTL-6001 returns VD-5001\b/.test(output),
    "a title's trade-ins page provider that ignores its title fails the run",
    output,
  );
});

// The titles awaiting lien release, from the search index: a lag is waited for, one that never
// ends is not.
await against({ indexLag: 2 }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 0 && server.indexCalls() >= 3,
    'titles the index lists only on the third read are waited for, and the run passes',
    `${output}\nread ${server.indexCalls()} times`,
  );
});
await against({ brokenProvider: 'vtitles_awaiting_lien_release' }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /vtitles_awaiting_lien_release does not return TTL-6004/.test(output) &&
      /vtitle_lienHolder_agg counts nothing in Larkspur Credit Union/.test(output) &&
      /vtitle_issuingState_agg counts nothing in Washington/.test(output),
    'titles the index never lists fail the run once the wait is over, naming them and their buckets',
    output,
  );
});
await against({ reversedProvider: 'vtitles_awaiting_lien_release' }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /vtitles_awaiting_lien_release returns TTL-6004, TTL-6003, not TTL-6003, TTL-6004/.test(
        output,
      ),
    'titles awaiting release out of payoff order, oldest first, fail the run',
    output,
  );
});
await against({ noAggregates: true }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /answers no aggregate vtitle_lienHolder_agg/.test(output) &&
      /answers no aggregate vtitle_issuingState_agg/.test(output),
    "titles answered with no aggregate fail the run: the queue's facets would not show",
    output,
  );
});

// Over every run above, the refused ones included: no credential, as typed or as a header.
{
  const leaked = outputs.filter((output) => [...secrets].some((secret) => output.includes(secret)));
  expect(
    outputs.length > 10 && leaked.length === 0,
    `no credential is printed in any of the ${outputs.length} runs, as typed or as its Basic header`,
    leaked.join('\n---\n'),
  );
}

// The data, as the pages and queues read it, and as the README describes it.
const layout = (type) =>
  JSON.parse(
    readFileSync(join(KIT, `bundle/agentic-ui-config/layouts/${type}/view.layout.json`), 'utf8'),
  );
const dealPage = layout('VehicleDeal');
const titlePage = layout('VehicleTitle');
const model = readFileSync(join(KIT, 'bundle/OSGI-INF/vehicle-titles-demo-model.xml'), 'utf8');
/** A page provider's query, as the model component writes it, its `<` and `>` escaped. */
const queryOf = (name) =>
  new RegExp(`<coreQueryPageProvider name="${name}">[\\s\\S]*?</pattern>`).exec(model)?.[0];
const quoted = (values) => values.map((value) => `'${value}'`).join(', ');
{
  // The overdue banner's rule and the overdue queue's NXQL say the same: more than 30 days open,
  // and a status other than Issued. The banner's days are counted by the platform's own day count,
  // `daysBetween` in libs/shared/extensions, which `app.rules.dateAfter` compares with `>` its
  // number of days (`document-rules.ts`); the rule's evaluator itself imports the platform's client
  // by an alias Node alone does not resolve, so the comparison is written here as it is there.
  await import(
    pathToFileURL(join(KIT, '../../../libs/shared/app-definition/src/typescript-hook.mjs')).href
  );
  const { TODAY, daysBetween } = await import(
    pathToFileURL(join(KIT, '../../../libs/shared/extensions/src/lib/date-rules.ts')).href
  );
  const banner = titlePage.banners.find((b) => b.id === 'overdue').visibleWhen;
  const dateAfter = banner.parameters.find((r) => r.type === 'app.rules.dateAfter');
  const open = banner.parameters.find((r) => r.type === 'app.rules.fieldIn');
  const query = queryOf('vtitles_overdue_titles');
  const today = new Date();
  const bannerShows = (t) =>
    open.parameters.slice(1).includes(t.status) &&
    daysBetween(TODAY, dayFrom(t.openedOn, today), today, 'UTC') > dateAfter.parameters[2];
  expect(
    banner.type === 'core.every' &&
      banner.parameters.length === 2 &&
      dateAfter.parameters[0] === 'today' &&
      dateAfter.parameters[1].field === 'vtitle:openedOn' &&
      dateAfter.parameters[2] === OVERDUE_AFTER_DAYS &&
      open.parameters[0].field === 'vtitle:status' &&
      open.parameters.slice(1).join() === OPEN_TITLE.join() &&
      query?.includes(`vtitle:status IN (${quoted(OPEN_TITLE)})`) &&
      query?.includes(`vtitle:openedOn &lt; NOW('-P${OVERDUE_AFTER_DAYS + 1}D')`) &&
      TITLES.filter(bannerShows)
        .map((t) => t.number)
        .sort()
        .join() === [...EXPECTED.vtitles_overdue_titles].sort().join(),
    "the title page's overdue banner, dateAfter today, opened on and 30 over the open statuses, and the overdue queue's NOW('-P31D') over the same statuses pick the same titles, the banner's days counted by the platform's daysBetween",
    JSON.stringify({ banner, query }),
  );
  const days = (t) => -t.openedOn;
  expect(
    EXPECTED.vtitles_overdue_titles.join() === 'TTL-6002,TTL-6008' &&
      TITLES.some((t) => t.number === 'TTL-6007' && days(t) === 30 && t.status !== 'Issued') &&
      TITLES.some((t) => t.number === 'TTL-6008' && days(t) === 31),
    'the data has two titles overdue, the longest open first, one open 31 days, and one open 30 days that is not',
    JSON.stringify(EXPECTED.vtitles_overdue_titles),
  );
}
{
  // The missing-documents queue's query lists sold deals with an entry not done, as the stand-in
  // answers it and EXPECTED is worked out: the statuses and the checklist's subfield, read from
  // the model component.
  const query = queryOf('vtitles_deals_missing_documents');
  expect(
    query?.includes(`vdeal:status IN (${quoted(SOLD)}) AND vdocs:checklist/*/done = 0`) &&
      query.includes("ecm:primaryType = 'VehicleDeal'"),
    "the missing-documents queue's query lists the sold statuses and a checklist entry whose done is false, as the stand-in and EXPECTED read it",
    query ?? 'no such page provider',
  );
}
{
  // The deal page's two checklist cards list the documents the seed writes entries for.
  const card = (id) => dealPage.cards.find((c) => c.id === id);
  const ids = (id) =>
    card(id)
      .checklist.items.map((item) => item.id)
      .join();
  const finance = card('finance-documents').visibleWhen;
  expect(
    ids('documents') === REQUIRED_DOCUMENTS.join() &&
      ids('finance-documents') === FINANCE_DOCUMENTS.join() &&
      card('documents').checklist.field === 'vdocs:checklist' &&
      card('finance-documents').checklist.field === 'vdocs:checklist' &&
      card('documents').checklist.tickable === true &&
      card('finance-documents').checklist.tickable === true &&
      finance.type === 'app.rules.fieldIn' &&
      finance.parameters[0].field === 'vdeal:financeType' &&
      finance.parameters.slice(1).join() === 'Loan,Lease' &&
      DEALS.every(
        (d) =>
          documentsOf(d).length ===
          (['Loan', 'Lease'].includes(d.financeType) ? 9 : REQUIRED_DOCUMENTS.length),
      ),
    "the deal page's two tickable checklist cards, the finance one for a loan or a lease, list exactly the documents each deal has an entry for",
    JSON.stringify(dealPage.cards.filter((c) => c.checklist)),
  );
  expect(
    EXPECTED.vtitles_deals_missing_documents.join() === 'VD-5002,VD-5004,VD-5008' &&
      DEALS.filter((d) => !SOLD.includes(d.status)).every((d) =>
        checklistOf(d).some((e) => !e.done),
      ) &&
      DEALS.every((d) => d.received.every((r) => documentsOf(d).includes(r.item))),
    'the data has three sold deals missing documents, and a deal worked and a cancelled one missing some that no queue lists; no deal receives a document its cards do not list',
  );
}
{
  // Banners, links and numbers the README names.
  const notFunded = (d) =>
    d.status === 'Contracted' && ['Loan', 'Lease'].includes(d.financeType) && 0 - d.soldOn > 10;
  const byNumber = new Map(TITLES.map((t) => [t.number, t]));
  expect(
    DEALS.filter(notFunded)
      .map((d) => d.number)
      .join() === 'VD-5004' &&
      DEALS.every((d) => d.title === undefined || byNumber.get(d.title)?.vin === d.vin) &&
      DEALS.every(
        (d) =>
          (d.tradeIn === true) === (d.tradeInTitle !== undefined) &&
          (d.tradeInTitle === undefined || byNumber.get(d.tradeInTitle)?.vin === d.tradeInVin),
      ) &&
      EXPECTED.vtitles_title_sales['TTL-6002'].join() === 'VD-5002,VD-5007' &&
      EXPECTED.vtitles_awaiting_lien_release.join() === 'TTL-6003,TTL-6004',
    "the not-funded banner flags VD-5004 only; each deal's title and trade-in title are its vehicles', by VIN; TTL-6002 lists two deals; two titles await release, the older payoff first",
  );
  expect(
    dealPage.capture?.property === 'files:files' &&
      dealPage.capture.findBy.join() === 'vdeal:number,vdeal:vin' &&
      dealPage.capture.keepLocation === undefined &&
      [...DEALS, ...TITLES].every((r) => /^1VTDM0000[A-Z]A5\d{5}$/.test(r.vin)) &&
      DEALS.filter((d) => d.tradeInVin).every((d) => /^1VTDM0000[A-Z]A5\d{5}$/.test(d.tradeInVin)),
    "the deal's capture files photos on files:files, found by the deal's number or VIN, and keeps no location; every VIN is the kit's own made-up series",
  );
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${controls} controls failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${controls} of ${controls} controls passed.`);
