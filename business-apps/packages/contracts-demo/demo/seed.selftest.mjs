#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/contracts-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * on the model of the Payers kit's (`payers-claims-demo/demo/seed.selftest.mjs`): documents by
 * path and by id, `Document.Untrash`, NXQL through `Repository.Query`, trash renaming a document to
 * `<name>._<time>_.trashed`, and the kit's three page providers, answered as
 * `contracts-demo-model.xml` defines them, with today's date. So a pass proves the script's logic:
 * each of its preconditions, a second run that adds nothing and puts back what was changed, a
 * trashed contract restored and put back, a trashed sibling whose name only looks like it left
 * alone, two trashed copies refused, a document of another type left alone, a server that hangs up
 * or pages forever stopping the run, the credentials never printed, and a check that fails when a
 * page provider leaves out a contract, holds one it should not, or is out of order, an ended
 * contract left out of the renewals among them. One control reads the kit's labels, not the
 * script: the queue's name says it holds ended contracts while the data expects one there.
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
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACTS, RENEWALS, dayFrom } from './data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, 'seed.mjs');
const LABELS = join(HERE, '..', 'bundle', 'agentic-ui-config', 'labels', 'en.json');
const HOLDER = '/default-domain/workspaces/contracts-demo/contracts';

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `types` are the document types it has; `brokenProvider` makes one page
 * provider return nothing; `widenedProvider` makes one return every live contract;
 * `reversedRenewals` returns the renewals newest end first; `unendedRenewals` returns only those
 * still to end, as a queue of contracts merely up for renewal would; `endlessProvider` always says
 * there is another page;
 * `meStatus` answers `/me` with that status; `noWorkspaces` leaves out /default-domain/workspaces;
 * `hangUpOnFirstWrite` drops the connection on the first create; `pageSize` caps what a page
 * holds, so paging is exercised.
 */
function standIn({
  user,
  password,
  types = ['Workspace', 'Folder', 'Contract'],
  brokenProvider = null,
  widenedProvider = null,
  reversedRenewals = false,
  unendedRenewals = false,
  endlessProvider = null,
  meStatus = 200,
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
  const live = () => [...byId.values()].filter((document) => !document.isTrashed);
  const contracts = (status) =>
    live().filter((d) => d.type === 'Contract' && d.properties['contract:status'] === status);
  const byEnd = (a, b) => a.properties['contract:end'].localeCompare(b.properties['contract:end']);
  const providers = {
    // NOW('P90D') as a day: ISO days compare as text.
    contracts_up_for_renewal: () => {
      const found = contracts('Active')
        .filter((d) => d.properties['contract:end'] <= dayFrom(90))
        .filter((d) => !unendedRenewals || d.properties['contract:end'] >= dayFrom(0))
        .sort(byEnd);
      return reversedRenewals ? found.reverse() : found;
    },
    contracts_active: () => contracts('Active').sort(byEnd),
    contracts_terminated: () => contracts('Terminated'),
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
      if (method === 'GET' && path === '/me')
        return meStatus === 200 ? send(200, { id: user }) : send(meStatus, { message: 'no' });
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
        const provider = providers[execute[1]];
        if (!provider) return send(404, { message: 'no such page provider' });
        const found =
          brokenProvider === execute[1]
            ? []
            : widenedProvider === execute[1]
              ? live().filter((d) => d.type === 'Contract')
              : provider();
        const answer = page(found, Number(url.searchParams.get('currentPageIndex') ?? 0));
        return send(
          200,
          endlessProvider === execute[1] ? { ...answer, isNextPageAvailable: true } : answer,
        );
      }
      return send(404, { message: `the stand-in does not answer ${method} ${path}` });
    } catch (error) {
      return send(500, { message: error.message });
    }
  });
  Object.assign(server, { byPath, add, trash, calls });
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
const at = (server, number) => server.byPath.get(`${HOLDER}/${number.toLowerCase()}`);

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
await against({ types: ['Workspace', 'Folder'] }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no Contract type/.test(output) && writes(server) === 0,
    'a server without the package is exit 2, with nothing written',
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

// A first run writes everything and checks it; a second adds nothing and puts back what changed.
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(
    first.status === 0 &&
      done(first.output).startsWith(`Done: ${CONTRACTS.length + 2} created, 0 updated`),
    'a first run creates the workspace, the folder and every contract, and exits 0',
    first.output,
  );
  const contract = at(server, 'CTR-1001');
  expect(
    contract?.properties['contract:end'] === dayFrom(30) &&
      contract?.properties['contract:status'] === 'Active',
    "a contract's end date is counted from today",
    JSON.stringify(contract?.properties ?? null),
  );
  expect(
    typeof at(server, 'CTR-1004')?.properties['contract:terminationReason'] === 'string',
    'the terminated contract has its termination reason, which the field rule requires',
  );

  // Changed on the server since: a status, and a termination reason the data does not have.
  const count = server.byPath.size;
  at(server, 'CTR-1001').properties['contract:status'] = 'Expired';
  at(server, 'CTR-1003').properties['contract:terminationReason'] = 'Not in data.mjs';
  const second = await run();
  expect(
    second.status === 0 &&
      done(second.output).startsWith(`Done: 0 created, ${CONTRACTS.length + 2} updated`) &&
      server.byPath.size === count,
    'a second run adds nothing, and exits 0',
    second.output,
  );
  expect(
    at(server, 'CTR-1001')?.properties['contract:status'] === 'Active' &&
      at(server, 'CTR-1003')?.properties['contract:terminationReason'] === null,
    "a second run puts each contract back to data.mjs's values, and clears a termination reason it does not have",
    JSON.stringify([at(server, 'CTR-1001')?.properties, at(server, 'CTR-1003')?.properties]),
  );

  // A trashed contract, changed before it was trashed, is restored and put back, not written again.
  at(server, 'CTR-1002').properties['contract:value'] = 1;
  server.trash(at(server, 'CTR-1002'));
  const third = await run();
  expect(
    third.status === 0 &&
      /restored .*ctr-1002/.test(third.output) &&
      at(server, 'CTR-1002')?.isTrashed === false &&
      at(server, 'CTR-1002')?.properties['contract:value'] === 120000 &&
      server.byPath.size === count,
    'a trashed contract is restored and put back, and nothing is added',
    third.output,
  );
});

// A trashed sibling whose name only matches the LIKE pattern is not the seed's to restore.
await against({}, async ({ server, run }) => {
  server.add('/default-domain/workspaces/contracts-demo', 'Workspace');
  server.add(HOLDER, 'Folder');
  const sibling = server.add(`${HOLDER}/ctr-1001.old._1_.trashed`, 'Contract', {
    'contract:number': 'CTR-1001-OLD',
  });
  sibling.isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 0 &&
      !/^ +restored /m.test(output) &&
      sibling.isTrashed === true &&
      at(server, 'CTR-1001')?.uid !== sibling.uid,
    'a trashed sibling named like a contract is left in the trash, and the contract is created',
    output,
  );
});

// Two trashed copies of one contract: the seed restores neither, and stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  server.trash(at(server, 'CTR-1005'));
  server.add(`${HOLDER}/ctr-1005._2_.trashed`, 'Contract').isTrashed = true;
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named ctr-1005/.test(output),
    'two trashed copies of one contract stop the run with exit 1',
    output,
  );
});

// A place that holds another type is left alone, and the run stops.
await against({}, async ({ server, run }) => {
  server.add('/default-domain/workspaces/contracts-demo', 'Workspace');
  server.add(HOLDER, 'Folder');
  const intruder = server.add(`${HOLDER}/ctr-1003`, 'File', { 'dc:title': 'Not the seed' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a Contract/.test(output) &&
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
await against({ endlessProvider: 'contracts_active' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /contracts_active still reports another page after 100 pages/.test(output),
    'a page provider that always reports another page stops the run with exit 1',
    output,
  );
});

// The checks: a page provider that leaves out, adds or misorders a seeded contract fails the run.
await against({ brokenProvider: 'contracts_up_for_renewal' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /contracts_up_for_renewal does not return CTR-1001/.test(output),
    'a renewals page provider that returns nothing fails the run, naming what is missing',
    output,
  );
});
await against({ brokenProvider: 'contracts_terminated' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /contracts_terminated does not return CTR-1004/.test(output),
    'a terminated page provider that returns nothing fails the run',
    output,
  );
});
await against({ widenedProvider: 'contracts_terminated' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /contracts_terminated returns CTR-1001\b/.test(output) &&
      !/contracts_terminated does not return/.test(output),
    'a terminated page provider that returns a contract that does not belong fails the run, naming it',
    output,
  );
});
await against({ reversedRenewals: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /contracts_up_for_renewal returns CTR-1002, CTR-1001, CTR-1007, not CTR-1007, CTR-1001, CTR-1002/.test(
        output,
      ),
    'renewals out of end-date order fail the run',
    output,
  );
});
await against({ unendedRenewals: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    RENEWALS.overdue.length > 0 &&
      status === 1 &&
      new RegExp(`contracts_up_for_renewal does not return ${RENEWALS.overdue[0]}\\b`).test(
        output,
      ) &&
      !RENEWALS.due.some((number) => output.includes(`does not return ${number}`)),
    'a renewals page provider that leaves out the contracts already ended fails the run, naming the overdue one alone',
    output,
  );
});

// The kit's labels, not the script: the queue and the home's figure for it are named for the
// ended contracts the data expects in the renewals. Under "Up for renewal" alone a browser
// walkthrough found CTR-1007, ended ten days before, and flagged it.
{
  const { labels } = JSON.parse(readFileSync(LABELS, 'utf8'));
  const names = ['contracts.queue.up-for-renewal', 'contracts.home.renewals'].map((key) => [
    key,
    labels[key],
  ]);
  const unnamed = names.filter(([, text]) => !/\boverdue\b/i.test(text ?? ''));
  expect(
    RENEWALS.overdue.length > 0 && unnamed.length === 0,
    `the renewals queue's name and its home figure's say "overdue" while the data expects ${RENEWALS.overdue.join(', ') || 'no ended contract'} there`,
    unnamed.map(([key, text]) => `${key}: ${JSON.stringify(text)}`).join('\n'),
  );
}

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
