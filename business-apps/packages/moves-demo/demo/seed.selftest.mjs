#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/moves-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * on the model of the contracts kit's (`contracts-demo/demo/seed.selftest.mjs`): documents by path
 * and by id, `Document.Untrash`, NXQL through `Repository.Query`, trash renaming a document to
 * `<name>._<time>_.trashed`, and the kit's five page providers, answered as
 * `moves-demo-model.xml` defines them, with today's date, the related lists' given their
 * parameter as `queryParams`, and the open claims queue's with its two aggregates and a search
 * index that can lag. So a pass proves the script's logic: each of its preconditions, the links
 * written as ids in order, a second run that adds nothing, puts back what was changed and leaves a
 * claim's attachments alone, a trashed record restored and put back, a trashed sibling whose name
 * only looks like it left alone, two trashed copies refused, a document of another type left
 * alone, a server that hangs up or pages forever stopping the run, the credentials never printed,
 * and a check that fails when a page provider leaves out a record, holds one it should not, is out
 * of order, ignores its parameter, answers no facet, or whose index never catches up.
 * It says nothing about whether a real server accepts the stand-in model or answers as the
 * stand-in does: only a run against one shows that, and none has run yet.
 *
 * It runs the real `seed.mjs` as a command, against a server on 127.0.0.1, with a user and a
 * password made up for the run. Node 24 and nothing else. CI does not run it.
 *
 * Exit 0 when every control behaves as required, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAIMS, ITEMS, MOVES, dayFrom } from './data.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const ROOT = '/default-domain/workspaces/moves-demo';
const MOVES_AT = `${ROOT}/moves`;
const ITEMS_AT = `${ROOT}/inventory`;
const CLAIMS_AT = `${ROOT}/claims`;
const RECORDS = MOVES.length + ITEMS.length + CLAIMS.length;
const CONTAINERS = 4;

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `types` are the document types it has; `brokenProvider` makes one page
 * provider return nothing; `widenedProvider` makes one return every live record of its type;
 * `reversedProvider` returns one's records in the reverse order; `endlessProvider` always says
 * there is another page; `ignoresParameter` makes a related list's page provider return every
 * record of its type, whatever it is given; `indexLag` answers the open claims with nothing for
 * that many calls, as an index that has not caught up; `noAggregates` answers them with no
 * aggregate; `meStatus` answers `/me` with that status, and `meBody`, with 200, with that text in
 * place of the user; `noWorkspaces` leaves out /default-domain/workspaces; `hangUpOnFirstWrite`
 * drops the connection on the first create; `pageSize` caps what a page holds, so paging is
 * exercised.
 */
function standIn({
  user,
  password,
  types = ['Workspace', 'Folder', 'Move', 'MoveItem', 'DamageClaim'],
  brokenProvider = null,
  widenedProvider = null,
  reversedProvider = null,
  endlessProvider = null,
  ignoresParameter = null,
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
  const asc = (name) => (a, b) => String(prop(a, name)).localeCompare(String(prop(b, name)));
  const desc = (name) => (a, b) => asc(name)(b, a);
  // NOW('-P1D') to NOW('P7D') as days: ISO days compare as text.
  const thisWeek = (day) => typeof day === 'string' && day >= dayFrom(0) && day <= dayFrom(7);
  const open = () =>
    live('DamageClaim')
      .filter((d) => ['Filed', 'In review'].includes(prop(d, 'dmg:state')))
      .sort(asc('dmg:filedOn'));
  const providers = {
    moves_this_week: {
      type: 'Move',
      answer: () =>
        live('Move')
          .filter(
            (d) =>
              prop(d, 'move:state') !== 'Cancelled' &&
              (thisWeek(d.properties['move:loadDate']) ||
                thisWeek(d.properties['move:deliveryDate'])),
          )
          .sort(asc('move:loadDate')),
    },
    moves_move_items: {
      type: 'MoveItem',
      parameter: true,
      answer: (uid) =>
        live('MoveItem')
          .filter((d) => prop(d, 'moveitem:move') === uid)
          .sort(asc('moveitem:tag')),
    },
    moves_move_claims: {
      type: 'DamageClaim',
      parameter: true,
      answer: (uid) =>
        live('DamageClaim')
          .filter((d) => prop(d, 'dmg:move') === uid)
          .sort(desc('dmg:filedOn')),
    },
    moves_item_claims: {
      type: 'DamageClaim',
      parameter: true,
      answer: (uid) =>
        live('DamageClaim')
          .filter((d) => (d.properties['dmg:items'] ?? []).includes(uid))
          .sort(desc('dmg:filedOn')),
    },
    moves_open_claims: { type: 'DamageClaim', answer: open },
  };
  let openCalls = 0;
  const buckets = (found, property) => {
    const counts = new Map();
    for (const d of found) counts.set(prop(d, property), (counts.get(prop(d, property)) ?? 0) + 1);
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
      if (method === 'GET' && path.startsWith('/config/types/'))
        return types.includes(path.slice('/config/types/'.length))
          ? send(200, {})
          : send(404, { message: 'no such type' });
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
        // character <?>", on 26 November 2026.
        if (provider.parameter && !parameter) return send(400, { message: 'no parameter' });
        const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
        let found;
        if (brokenProvider === name) found = [];
        else if (widenedProvider === name || ignoresParameter === name) found = live(provider.type);
        else found = provider.answer(parameter);
        if (reversedProvider === name) found = [...found].reverse();
        let aggregations;
        if (name === 'moves_open_claims') {
          if (index === 0) openCalls++;
          if (openCalls <= indexLag) found = [];
          aggregations = noAggregates
            ? {}
            : {
                dmg_state_agg: { buckets: buckets(found, 'dmg:state') },
                dmg_move_agg: { buckets: buckets(found, 'dmg:move') },
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
  Object.assign(server, { byPath, add, trash, calls, openCalls: () => openCalls });
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
const moveAt = (server, number) => server.byPath.get(`${MOVES_AT}/${number.toLowerCase()}`);
const itemAt = (server, move, tag) =>
  server.byPath.get(`${ITEMS_AT}/${`${move}-${tag}`.toLowerCase()}`);
const claimAt = (server, number) => server.byPath.get(`${CLAIMS_AT}/${number.toLowerCase()}`);

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
await against({ types: ['Workspace', 'Folder', 'Move', 'MoveItem'] }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no DamageClaim type/.test(output) && writes(server) === 0,
    'a server without the package, its DamageClaim type missing, is exit 2, with nothing written',
    output,
  );
});
await against({ noWorkspaces: true }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /has no \/default-domain\/workspaces/.test(output) && writes(server) === 0,
    'a server without /default-domain/workspaces is exit 2, with nothing written',
    output,
  );
});

// A first run writes everything, links it by id, and checks it; a second adds nothing, puts back
// what changed, and leaves a claim's attachments alone.
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(
    first.status === 0 &&
      done(first.output).startsWith(`Done: ${RECORDS + CONTAINERS} created, 0 updated`),
    'a first run creates the workspace, the three folders and every record, and exits 0',
    first.output,
  );
  const mv2001 = moveAt(server, 'MV-2001');
  const claim = claimAt(server, 'DC-3001');
  expect(
    claim?.properties['dmg:move'] === mv2001?.uid &&
      claim?.properties['dmg:moveNumber'] === 'MV-2001' &&
      JSON.stringify(claim?.properties['dmg:items']) ===
        JSON.stringify([
          itemAt(server, 'MV-2001', 'A01')?.uid,
          itemAt(server, 'MV-2001', 'A02')?.uid,
        ]) &&
      itemAt(server, 'MV-2001', 'A01')?.properties['moveitem:move'] === mv2001?.uid &&
      typeof mv2001?.uid === 'string',
    "a claim names its move and its items by their ids, and an item its move's, as document-link reads them",
    JSON.stringify(claim?.properties ?? null),
  );
  expect(
    moveAt(server, 'MV-2004')?.properties['move:loadDate'] === dayFrom(4) &&
      moveAt(server, 'MV-2003')?.properties['move:deliveredOn'] === null &&
      claimAt(server, 'DC-3003')?.properties['dmg:deliveredOn'] === dayFrom(-45) &&
      claimAt(server, 'DC-3003')?.properties['dmg:filedOn'] === dayFrom(-2),
    "dates are counted from today, a claim carries its move's delivery day, and one not delivered has none",
    JSON.stringify([moveAt(server, 'MV-2004')?.properties, claimAt(server, 'DC-3003')?.properties]),
  );
  expect(
    typeof claimAt(server, 'DC-3004')?.properties['dmg:denialReason'] === 'string' &&
      typeof claimAt(server, 'DC-3004')?.properties['dmg:decidedOn'] === 'string' &&
      claimAt(server, 'DC-3005')?.properties['dmg:amountApproved'] === 600,
    'the denied claim has its reason and decision day, which the Edit form requires, and the paid one its approved amount',
  );

  // Changed on the server since: a state, a denial reason the data does not have, and a photo
  // filed on a claim, which is not the seed's.
  const count = server.byPath.size;
  const photo = [{ file: { name: 'driver-photo.jpg', 'mime-type': 'image/jpeg' } }];
  claimAt(server, 'DC-3001').properties['dmg:state'] = 'Approved';
  claimAt(server, 'DC-3002').properties['dmg:denialReason'] = 'Not in data.mjs';
  claimAt(server, 'DC-3003').properties['files:files'] = photo;
  const second = await run();
  expect(
    second.status === 0 &&
      done(second.output).startsWith(`Done: 0 created, ${RECORDS + CONTAINERS} updated`) &&
      server.byPath.size === count,
    'a second run adds nothing, and exits 0',
    second.output,
  );
  expect(
    claimAt(server, 'DC-3001')?.properties['dmg:state'] === 'In review' &&
      claimAt(server, 'DC-3002')?.properties['dmg:denialReason'] === null,
    "a second run puts each claim back to data.mjs's values, and empties a denial reason it does not have",
    JSON.stringify([
      claimAt(server, 'DC-3001')?.properties,
      claimAt(server, 'DC-3002')?.properties,
    ]),
  );
  expect(
    JSON.stringify(claimAt(server, 'DC-3003')?.properties['files:files']) === JSON.stringify(photo),
    "a second run leaves a claim's attachments, files:files, as they are",
    JSON.stringify(claimAt(server, 'DC-3003')?.properties ?? null),
  );

  // A trashed item, changed before it was trashed, is restored and put back, not written again.
  itemAt(server, 'MV-2007', 'G03').properties['moveitem:condition'] = 'Good';
  server.trash(itemAt(server, 'MV-2007', 'G03'));
  const third = await run();
  expect(
    third.status === 0 &&
      /restored .*mv-2007-g03/.test(third.output) &&
      itemAt(server, 'MV-2007', 'G03')?.isTrashed === false &&
      itemAt(server, 'MV-2007', 'G03')?.properties['moveitem:condition'] === 'Scratched' &&
      server.byPath.size === count,
    'a trashed item is restored and put back, and nothing is added',
    third.output,
  );
});

// A trashed sibling whose name only matches the LIKE pattern is not the seed's to restore.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(MOVES_AT, 'Folder');
  const sibling = server.add(`${MOVES_AT}/mv-2001.old._1_.trashed`, 'Move', {
    'move:number': 'MV-2001-OLD',
  });
  sibling.isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 0 &&
      !/^ +restored /m.test(output) &&
      sibling.isTrashed === true &&
      moveAt(server, 'MV-2001')?.uid !== sibling.uid,
    'a trashed sibling named like a move is left in the trash, and the move is created',
    output,
  );
});

// Two trashed copies of one claim: the seed restores neither, and stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  server.trash(claimAt(server, 'DC-3005'));
  server.add(`${CLAIMS_AT}/dc-3005._2_.trashed`, 'DamageClaim').isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named dc-3005/.test(output),
    'two trashed copies of one claim stop the run with exit 1',
    output,
  );
});

// A place that holds another type is left alone, and the run stops.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(CLAIMS_AT, 'Folder');
  const intruder = server.add(`${CLAIMS_AT}/dc-3003`, 'File', { 'dc:title': 'Not the seed' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a DamageClaim/.test(output) &&
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
await against({ endlessProvider: 'moves_this_week' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /moves_this_week still reports another page after 100 pages/.test(output),
    'a page provider that always reports another page stops the run with exit 1',
    output,
  );
});

// The checks: a page provider that leaves out, adds or misorders a seeded record fails the run.
await against({ brokenProvider: 'moves_this_week' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /moves_this_week does not return MV-2003/.test(output),
    'a moves-this-week page provider that returns nothing fails the run, naming what is missing',
    output,
  );
});
await against({ widenedProvider: 'moves_this_week' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /moves_this_week returns MV-2006\b/.test(output) &&
      !/moves_this_week does not return/.test(output),
    'a moves-this-week page provider that returns a cancelled move fails the run, naming it',
    output,
  );
});
await against({ reversedProvider: 'moves_this_week' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /moves_this_week returns MV-2004, MV-2003, not MV-2003, MV-2004/.test(output),
    'moves this week out of load-date order fail the run',
    output,
  );
});
await against({ ignoresParameter: 'moves_move_items' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /moves_move_items for MV-2001 returns B01\b/.test(output),
    "an inventory page provider that ignores its move fails the run, naming another move's item",
    output,
  );
});
await against({ brokenProvider: 'moves_item_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /moves_item_claims for A01 does not return DC-3001/.test(output),
    "an item's claims page provider that returns nothing fails the run",
    output,
  );
});
await against({ reversedProvider: 'moves_move_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /moves_move_claims for MV-2001 returns DC-3001, DC-3002, not DC-3002, DC-3001/.test(output),
    "a move's claims out of filing order, newest first, fail the run",
    output,
  );
});

// The open claims, from the search index: a lag is waited for, a lag that never ends is not.
await against({ indexLag: 2 }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 0 && server.openCalls() >= 3,
    'open claims the index lists only on the third read are waited for, and the run passes',
    `${output}\nopen claims read ${server.openCalls()} times`,
  );
});
await against({ brokenProvider: 'moves_open_claims' }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /moves_open_claims does not return DC-3001/.test(output) &&
      /dmg_state_agg counts nothing in Filed/.test(output),
    'open claims the index never lists fail the run once the wait is over, naming them and their buckets',
    output,
  );
});
await against({ noAggregates: true }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /answers no aggregate dmg_state_agg/.test(output) &&
      /answers no aggregate dmg_move_agg/.test(output),
    "open claims answered with no aggregate fail the run: the queue's facets would not show",
    output,
  );
});

// Last, over every run above, the refused ones included: no credential, as typed or as a header.
{
  const leaked = outputs.filter((output) => [...secrets].some((secret) => output.includes(secret)));
  expect(
    outputs.length > 10 && leaked.length === 0,
    `no credential is printed in any of the ${outputs.length} runs, as typed or as its Basic header`,
    leaked.join('\n---\n'),
  );
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${controls} controls failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${controls} of ${controls} controls passed.`);
