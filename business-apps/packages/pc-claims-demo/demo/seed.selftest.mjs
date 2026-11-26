#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls, and
 * for the kit's connector files, which no check outside the kit compares.
 *
 *   node business-apps/packages/pc-claims-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * on the model of the moves kit's (`moves-demo/demo/seed.selftest.mjs`): documents by path and by
 * id, `Document.Untrash`, NXQL through `Repository.Query`, trash renaming a document to
 * `<name>._<time>_.trashed`, and the kit's three page providers, answered as
 * `pc-claims-demo-model.xml` defines them, the policy's claims given their parameter as
 * `queryParams`, and the open claims queue's with its three aggregates and a search index that can
 * lag. So a pass proves the script's logic: each of its preconditions, a claim's policy written as
 * its id, a second run that adds nothing, puts back what was changed and leaves a claim's
 * attachments alone, a trashed record restored and put back, a trashed sibling whose name only
 * looks like it left alone, two trashed copies refused, a document of another type left alone, a
 * server that hangs up or pages forever stopping the run, the credentials never printed, and a
 * check that fails when a page provider leaves out a record, holds one it should not, is out of
 * order, ignores its parameter, answers no facet, or whose index never catches up. It says nothing
 * about whether a real server accepts the stand-in model or answers as the stand-in does: only a
 * run against one shows that, and none has run yet.
 *
 * **The connector files.** The pipeline reads a connector's fields from a `--registered` file only,
 * never from a kit's contribution, so three files must agree by hand: the contribution
 * (`pc-claims-connectors-config.xml`), `registered.json`, and the claim page's `external` card.
 * The last controls hold them to each other and to the content model.
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
import { fileURLToPath } from 'node:url';

import { CLAIMS, POLICIES, RESERVE_THRESHOLD, dayFrom } from './data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, 'seed.mjs');
const KIT = join(HERE, '..');
const ROOT = '/default-domain/workspaces/pc-claims-demo';
const POLICIES_AT = `${ROOT}/policies`;
const CLAIMS_AT = `${ROOT}/claims`;
const RECORDS = POLICIES.length + CLAIMS.length;
const CONTAINERS = 3;
const OPEN = ['Reported', 'Investigating', 'Approved'];

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
 * there is another page; `ignoresParameter` makes the policy's claims return every claim, whatever
 * they are given; `indexLag` answers the open claims with nothing for that many calls, as an index
 * that has not caught up; `noAggregates` answers them with no aggregate; `meStatus` answers `/me`
 * with that status, and `meBody`, with 200, with that text in place of the user; `noWorkspaces`
 * leaves out /default-domain/workspaces; `hangUpOnFirstWrite` drops the connection on the first
 * create; `pageSize` caps what a page holds, so paging is exercised.
 */
function standIn({
  user,
  password,
  types = ['Workspace', 'Folder', 'PropertyPolicy', 'PropertyClaim'],
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
  // Days are ISO text, which compares as text; the reserve is a number.
  const asc = (name) => (a, b) => String(prop(a, name)).localeCompare(String(prop(b, name)));
  const desc = (name) => (a, b) => asc(name)(b, a);
  const byNumberDesc = (name) => (a, b) => Number(prop(b, name)) - Number(prop(a, name));
  const isOpen = (d) => OPEN.includes(prop(d, 'pclaim:status'));
  const providers = {
    pc_open_claims: {
      type: 'PropertyClaim',
      answer: () => live('PropertyClaim').filter(isOpen).sort(asc('pclaim:reportedOn')),
    },
    pc_high_reserve_claims: {
      type: 'PropertyClaim',
      answer: () =>
        live('PropertyClaim')
          .filter((d) => isOpen(d) && Number(prop(d, 'pclaim:reserve')) > 50000)
          .sort(byNumberDesc('pclaim:reserve')),
    },
    pc_policy_claims: {
      type: 'PropertyClaim',
      parameter: true,
      answer: (uid) =>
        live('PropertyClaim')
          .filter((d) => prop(d, 'pclaim:policy') === uid)
          .sort(desc('pclaim:lossDate')),
    },
  };
  let openCalls = 0;
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
        // character <?>", on 26 November 2026, as the moves kit's run read it.
        if (provider.parameter && !parameter) return send(400, { message: 'no parameter' });
        const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
        let found;
        if (brokenProvider === name) found = [];
        else if (widenedProvider === name || ignoresParameter === name) found = live(provider.type);
        else found = provider.answer(parameter);
        if (reversedProvider === name) found = [...found].reverse();
        let aggregations;
        if (name === 'pc_open_claims') {
          if (index === 0) openCalls++;
          if (openCalls <= indexLag) found = [];
          aggregations = noAggregates
            ? {}
            : {
                pclaim_status_agg: { buckets: buckets(found, 'pclaim:status') },
                pclaim_cause_agg: { buckets: buckets(found, 'pclaim:cause') },
                pclaim_adjuster_agg: { buckets: buckets(found, 'pclaim:adjuster') },
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
const policyAt = (server, number) => server.byPath.get(`${POLICIES_AT}/${number.toLowerCase()}`);
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
await against({ types: ['Workspace', 'Folder', 'PropertyPolicy'] }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no PropertyClaim type/.test(output) && writes(server) === 0,
    'a server without the package, its PropertyClaim type missing, is exit 2, with nothing written',
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
    'a first run creates the workspace, the two folders and every record, and exits 0',
    first.output,
  );
  const policy = policyAt(server, 'POL-PC-1001');
  const claim = claimAt(server, 'PC-24001');
  expect(
    typeof policy?.uid === 'string' &&
      claim?.properties['pclaim:policy'] === policy.uid &&
      claimAt(server, 'PC-24002')?.properties['pclaim:policy'] === policy.uid &&
      claimAt(server, 'PC-24003')?.properties['pclaim:policy'] ===
        policyAt(server, 'POL-PC-1002')?.uid,
    "a claim names its policy by the policy's id, as document-link reads it",
    JSON.stringify(claim?.properties ?? null),
  );
  expect(
    claimAt(server, 'PC-24003')?.properties['pclaim:lossDate'] === dayFrom(-50) &&
      claimAt(server, 'PC-24003')?.properties['pclaim:reportedOn'] === dayFrom(-12) &&
      policyAt(server, 'POL-PC-1003')?.properties['ppolicy:expiry'] === dayFrom(25),
    'dates are counted from today: the late claim reported 38 days after its loss, a policy ending in 25 days',
    JSON.stringify([claimAt(server, 'PC-24003')?.properties, policyAt(server, 'POL-PC-1003')]),
  );
  expect(
    typeof claimAt(server, 'PC-24005')?.properties['pclaim:denialReason'] === 'string' &&
      claimAt(server, 'PC-24005')?.properties['pclaim:status'] === 'Denied' &&
      claimAt(server, 'PC-24002')?.properties['pclaim:adjuster'] === null &&
      claimAt(server, 'PC-24008')?.properties['pclaim:reserve'] === 52000,
    'the denied claim has its reason, which the Edit form requires; an unassigned claim has no adjuster; a reserve is a number',
  );
  expect(
    Object.keys(claim?.properties ?? {}).every((key) => !key.startsWith('files:')),
    "a first run writes no claim's attachments",
    JSON.stringify(claim?.properties ?? null),
  );

  // Changed on the server since: a status, a denial reason the data does not have, and a photo
  // filed on a claim, which is not the seed's.
  const count = server.byPath.size;
  const photo = [{ file: { name: 'kitchen-after-the-fire.jpg', 'mime-type': 'image/jpeg' } }];
  claimAt(server, 'PC-24001').properties['pclaim:status'] = 'Closed';
  claimAt(server, 'PC-24002').properties['pclaim:denialReason'] = 'Not in data.mjs';
  claimAt(server, 'PC-24003').properties['files:files'] = photo;
  const second = await run();
  expect(
    second.status === 0 &&
      done(second.output).startsWith(`Done: 0 created, ${RECORDS + CONTAINERS} updated`) &&
      server.byPath.size === count,
    'a second run adds nothing, and exits 0',
    second.output,
  );
  expect(
    claimAt(server, 'PC-24001')?.properties['pclaim:status'] === 'Investigating' &&
      claimAt(server, 'PC-24002')?.properties['pclaim:denialReason'] === null,
    "a second run puts each claim back to data.mjs's values, and empties a denial reason it does not have",
    JSON.stringify([
      claimAt(server, 'PC-24001')?.properties,
      claimAt(server, 'PC-24002')?.properties,
    ]),
  );
  expect(
    JSON.stringify(claimAt(server, 'PC-24003')?.properties['files:files']) ===
      JSON.stringify(photo),
    "a second run leaves a claim's attachments, files:files, as they are",
    JSON.stringify(claimAt(server, 'PC-24003')?.properties ?? null),
  );

  // A trashed policy, changed before it was trashed, is restored and put back, not written again.
  policyAt(server, 'POL-PC-1004').properties['ppolicy:status'] = 'In force';
  server.trash(policyAt(server, 'POL-PC-1004'));
  const third = await run();
  expect(
    third.status === 0 &&
      /restored .*pol-pc-1004/.test(third.output) &&
      policyAt(server, 'POL-PC-1004')?.isTrashed === false &&
      policyAt(server, 'POL-PC-1004')?.properties['ppolicy:status'] === 'Lapsed' &&
      server.byPath.size === count,
    'a trashed policy is restored and put back, and nothing is added',
    third.output,
  );
});

// A trashed sibling whose name only matches the LIKE pattern is not the seed's to restore.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(CLAIMS_AT, 'Folder');
  const sibling = server.add(`${CLAIMS_AT}/pc-24001.old._1_.trashed`, 'PropertyClaim', {
    'pclaim:number': 'PC-24001-OLD',
  });
  sibling.isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 0 &&
      !/^ +restored /m.test(output) &&
      sibling.isTrashed === true &&
      claimAt(server, 'PC-24001')?.uid !== sibling.uid,
    'a trashed sibling named like a claim is left in the trash, and the claim is created',
    output,
  );
});

// Two trashed copies of one claim: the seed restores neither, and stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  server.trash(claimAt(server, 'PC-24006'));
  server.add(`${CLAIMS_AT}/pc-24006._2_.trashed`, 'PropertyClaim').isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named pc-24006/.test(output),
    'two trashed copies of one claim stop the run with exit 1',
    output,
  );
});

// A place that holds another type is left alone, and the run stops.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(POLICIES_AT, 'Folder');
  const intruder = server.add(`${POLICIES_AT}/pol-pc-1003`, 'File', { 'dc:title': 'Not the seed' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a PropertyPolicy/.test(output) &&
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
await against({ endlessProvider: 'pc_high_reserve_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /pc_high_reserve_claims still reports another page after 100 pages/.test(output),
    'a page provider that always reports another page stops the run with exit 1',
    output,
  );
});

// The checks: a page provider that leaves out, adds or misorders a seeded record fails the run.
await against({ brokenProvider: 'pc_high_reserve_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /pc_high_reserve_claims does not return PC-24003/.test(output),
    'a high-reserve page provider that returns nothing fails the run, naming what is missing',
    output,
  );
});
await against({ widenedProvider: 'pc_high_reserve_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /pc_high_reserve_claims returns PC-24002\b/.test(output) &&
      /pc_high_reserve_claims returns PC-24006\b/.test(output) &&
      !/pc_high_reserve_claims does not return/.test(output),
    'a high-reserve page provider that returns a claim under the threshold and a closed one fails the run, naming them',
    output,
  );
});
await against({ reversedProvider: 'pc_high_reserve_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /pc_high_reserve_claims returns PC-24008, PC-24001, PC-24003, not PC-24003, PC-24001, PC-24008/.test(
        output,
      ),
    'claims over the threshold out of reserve order, largest first, fail the run',
    output,
  );
});
await against({ ignoresParameter: 'pc_policy_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /pc_policy_claims for POL-PC-1001 returns PC-24003\b/.test(output),
    "a policy's claims page provider that ignores its policy fails the run, naming another policy's claim",
    output,
  );
});
await against({ reversedProvider: 'pc_policy_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /pc_policy_claims for POL-PC-1001 returns PC-24001, PC-24002, not PC-24002, PC-24001/.test(
        output,
      ),
    "a policy's claims out of loss-date order, latest first, fail the run",
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
await against({ brokenProvider: 'pc_open_claims' }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /pc_open_claims does not return PC-24001/.test(output) &&
      /pclaim_status_agg counts nothing in Reported/.test(output) &&
      /pclaim_adjuster_agg counts nothing in noor\.halvorsen/.test(output),
    'open claims the index never lists fail the run once the wait is over, naming them and their buckets',
    output,
  );
});
await against({ reversedProvider: 'pc_open_claims' }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 && /pc_open_claims returns PC-24007, .* not PC-24008, /.test(output),
    'open claims out of report order, oldest first, fail the run',
    output,
  );
});
await against({ noAggregates: true }, async ({ run }) => {
  const { status, output } = await run({ NUXEO_INDEX_WAIT_MS: '1500' });
  expect(
    status === 1 &&
      /answers no aggregate pclaim_status_agg/.test(output) &&
      /answers no aggregate pclaim_cause_agg/.test(output) &&
      /answers no aggregate pclaim_adjuster_agg/.test(output),
    "open claims answered with no aggregate fail the run: the queue's facets would not show",
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

// The data, as the README describes it: which claims the late-report banner flags, and which not.
{
  const daysToReport = (c) => c.reportedOn - c.lossDate;
  const late = CLAIMS.filter((c) => daysToReport(c) > 30).map((c) => c.number);
  const onTheThirtieth = CLAIMS.filter((c) => daysToReport(c) === 30).map((c) => c.number);
  expect(
    late.join() === 'PC-24003,PC-24006' && onTheThirtieth.join() === 'PC-24005',
    'the data has two claims reported more than 30 days after the loss, PC-24003 and PC-24006, and one on the 30th day, PC-24005, which the banner leaves out',
    JSON.stringify({ late, onTheThirtieth }),
  );
  expect(
    CLAIMS.every((c) => c.reportedOn >= c.lossDate) &&
      CLAIMS.filter((c) => c.status === 'Denied').every((c) => Boolean(c.denialReason)) &&
      CLAIMS.every((c) => POLICIES.some((p) => p.number === c.policy)) &&
      RESERVE_THRESHOLD === 50000,
    "the data passes the Edit form's rules: no loss after its report, a reason on every denial, every claim's policy seeded; the threshold is the queue's",
  );
}

// The connector's three files agree: the contribution, registered.json and the claim page's card.
{
  const xml = readFileSync(join(HERE, 'pc-claims-connectors-config.xml'), 'utf8');
  const registered = JSON.parse(readFileSync(join(HERE, 'registered.json'), 'utf8'));
  const layout = JSON.parse(
    readFileSync(
      join(KIT, 'bundle/agentic-ui-config/layouts/PropertyClaim/view.layout.json'),
      'utf8',
    ),
  );
  const model = JSON.parse(readFileSync(join(KIT, 'content-model.json'), 'utf8'));
  const id = /<connector id="([^"]+)"/.exec(xml)?.[1];
  const contributed = [...xml.matchAll(/<field name="([^"]+)"/g)].map((m) => m[1]);
  const card = layout.cards.find((c) => c.external)?.external;
  const shown = (card?.fields ?? []).map((f) => (typeof f === 'string' ? f : f.name));
  const keyXpath = /<key xpath="([^"]+)"/.exec(xml)?.[1];
  const type = /<type>([^<]+)<\/type>/.exec(xml)?.[1];
  const schema = model.schemas.find((s) => (s.prefix ?? s['@prefix']) === keyXpath?.split(':')[0]);
  expect(
    id === 'pcclaims.policyPayments' &&
      card?.connector === id &&
      Object.keys(registered.connectors ?? {}).join() === id &&
      JSON.stringify(registered.connectors[id]) === JSON.stringify(contributed) &&
      shown.length > 0 &&
      shown.every((name) => contributed.includes(name)),
    "the claim page's card names the contributed connector, and only fields it returns; registered.json lists exactly the contribution's fields",
    JSON.stringify({ id, card: card?.connector, contributed, registered, shown }),
  );
  expect(
    type === 'PropertyClaim' &&
      keyXpath === 'pclaim:number' &&
      model.doctypes[type]?.schemas.includes(schema?.name) &&
      Object.prototype.hasOwnProperty.call(schema?.fields ?? {}, 'number'),
    'the connector reads PropertyClaim records, keyed on a property the model gives the type, pclaim:number',
    JSON.stringify({ type, keyXpath, schema: schema?.name }),
  );
  expect(
    !/https?:|\/\/|:\d{2,5}\b/.test(xml.replace(/<!--[\s\S]*?-->/g, '')) &&
      /<address property="nuxeo\.agentic\.connectors\.pcclaims\.policyPayments\.address"/.test(
        xml,
      ) &&
      /property="nuxeo\.agentic\.connectors\.pcclaims\.policyPayments\.token"/.test(xml) &&
      /env="NUXEO_CONNECTOR_PCCLAIMS_POLICYPAYMENTS_TOKEN"/.test(xml),
    "the contribution holds no address and no credential, only the server settings' names, under the connector's own prefix",
  );
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${controls} controls failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${controls} of ${controls} controls passed.`);
