#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/controlled-documents-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * on the model of the contracts kit's: documents by path and by id, and the kit's three page
 * providers, answered as `controlled-documents-demo-model.xml` defines them. It numbers and
 * supersedes as `nuxeo-agentic-documents` does, in miniature: a new document's next number in its
 * series, a revision's predecessor's number and next revision, the predecessor marked superseded,
 * and any change to a `docctl:` property refused. So a pass proves the script's logic: each of its
 * preconditions, a first run that creates the register through the server's numbering alone, a
 * second that adds nothing and writes no `docctl:` property, a missing revision created over the
 * one before it, a document of another type left alone, a chain whose last revision someone else
 * superseded left alone, the credentials never printed, and a check that fails when the server
 * numbers two chains alike or a page provider leaves out, or holds, what it should not. It says
 * nothing about whether a real server answers as the stand-in does: the add-on's own tests, on a
 * Nuxeo runtime, are what show its numbering, and no seed has run on a server yet.
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

import { CHAINS, revisionsOf } from './data.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const HOLDER = '/default-domain/workspaces/controlled-documents-demo/register';
const REVISIONS = CHAINS.reduce((count, chain) => count + chain.revisions.length, 0);
/** What the server gives: a creation may name a series or a predecessor, and nothing else of these. */
const SERVER_GIVEN = ['docctl:number', 'docctl:revision', 'docctl:status', 'docctl:supersededBy'];

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `types` are the document types it has; `meStatus` answers `/me` with that
 * status; `noWorkspaces` leaves out /default-domain/workspaces; `oneNumber` gives every new
 * document the same number, as a broken sequencer would; `brokenProvider` makes one page provider
 * return nothing; `widenedProvider` makes one return every engineering document.
 */
function standIn({
  user,
  password,
  types = ['Workspace', 'Folder', 'EngineeringDocument'],
  meStatus = 200,
  noWorkspaces = false,
  oneNumber = false,
  brokenProvider = null,
  widenedProvider = null,
}) {
  const byPath = new Map();
  const byId = new Map();
  const counters = { DWG: 0, SPEC: 0 };
  const writes = [];
  const add = (path, type, properties = {}) => {
    const document = {
      'entity-type': 'document',
      uid: randomUUID(),
      path,
      type,
      properties: { ...properties },
    };
    byPath.set(path, document);
    byId.set(document.uid, document);
    return document;
  };
  add('/default-domain', 'Domain');
  if (!noWorkspaces) add('/default-domain/workspaces', 'WorkspaceRoot');

  const letters = (revision) => String.fromCharCode(revision.charCodeAt(0) + 1);
  /** As the add-on does: number a first revision, or follow the one superseded. */
  const control = (properties) => {
    const supersedes = properties['docctl:supersedes'];
    if (!supersedes) {
      const series = properties['docctl:series'];
      if (!(series in counters))
        return { status: 400, message: 'Choose a registered number series' };
      counters[series]++;
      const value = oneNumber ? 1 : counters[series];
      return {
        properties: {
          'docctl:series': series,
          'docctl:number': `${series}-${String(value).padStart(series === 'DWG' ? 5 : 4, '0')}`,
          'docctl:revision': series === 'DWG' ? 'A' : '1',
          'docctl:status': 'current',
          'docctl:supersedes': null,
          'docctl:supersededBy': null,
        },
      };
    }
    const previous = byId.get(supersedes);
    if (!previous) return { status: 400, message: 'does not exist' };
    if (previous.properties['docctl:status'] !== 'current')
      return { status: 409, message: 'is not current' };
    const p = previous.properties;
    return {
      previous,
      properties: {
        'docctl:series': p['docctl:series'],
        'docctl:number': p['docctl:number'],
        'docctl:revision':
          p['docctl:series'] === 'DWG'
            ? letters(p['docctl:revision'])
            : String(Number(p['docctl:revision']) + 1),
        'docctl:status': 'current',
        'docctl:supersedes': previous.uid,
        'docctl:supersededBy': null,
      },
    };
  };

  const live = () => [...byId.values()].filter((d) => d.type === 'EngineeringDocument');
  const providers = {
    controlled_documents_current: () =>
      live().filter((d) => d.properties['docctl:status'] === 'current'),
    controlled_documents_superseded: () =>
      live().filter((d) => d.properties['docctl:status'] === 'superseded'),
    controlled_documents_revisions: (number) =>
      live().filter((d) => d.properties['docctl:number'] === number),
  };

  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const answer = (status, json) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(json === undefined ? '' : JSON.stringify(json));
    };
    if (request.headers.authorization !== authorization)
      return answer(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname.replace(/^\/nuxeo\/api\/v1/, ''));
    if (request.method === 'GET' && path === '/me') return answer(meStatus, { id: user });
    if (request.method === 'GET' && path.startsWith('/config/types/'))
      return types.includes(path.slice('/config/types/'.length))
        ? answer(200, {})
        : answer(404, {});
    if (path.startsWith('/path/')) {
      const at = path.slice('/path'.length);
      if (request.method === 'GET')
        return byPath.has(at) ? answer(200, byPath.get(at)) : answer(404, {});
      if (request.method === 'POST') {
        const { name, type, properties } = JSON.parse(body);
        if (!byPath.has(at)) return answer(404, {});
        if (!types.includes(type)) return answer(400, { message: `no type ${type}` });
        let own = properties ?? {};
        let previous = null;
        if (type === 'EngineeringDocument') {
          const given = control(own);
          if (given.status) return answer(given.status, { message: given.message });
          own = { ...own, ...given.properties };
          previous = given.previous ?? null;
        }
        const created = add(`${at}/${name}`, type, own);
        if (previous) {
          previous.properties['docctl:status'] = 'superseded';
          previous.properties['docctl:supersededBy'] = created.uid;
        }
        writes.push({ method: 'POST', path: created.path, sent: properties ?? {} });
        return answer(201, created);
      }
    }
    if (path.startsWith('/id/')) {
      const document = byId.get(path.slice('/id/'.length));
      if (!document) return answer(404, {});
      if (request.method === 'GET') return answer(200, document);
      if (request.method === 'PUT') {
        const { properties } = JSON.parse(body);
        const forged = Object.keys(properties ?? {}).filter(
          (key) => key.startsWith('docctl:') && properties[key] !== document.properties[key],
        );
        writes.push({ method: 'PUT', path: document.path, sent: properties ?? {} });
        if (forged.length > 0)
          return answer(400, { message: `${forged.join(', ')} are given by the server` });
        Object.assign(document.properties, properties);
        return answer(200, document);
      }
    }
    const provider = /^\/search\/pp\/([^/]+)\/execute$/.exec(path);
    if (request.method === 'GET' && provider && provider[1] in providers) {
      const name = provider[1];
      let entries = providers[name](...url.searchParams.getAll('queryParams'));
      if (name === brokenProvider) entries = [];
      if (name === widenedProvider) entries = live();
      return answer(200, { entries, isNextPageAvailable: false });
    }
    return answer(404, { message: `no ${request.method} ${path}` });
  });
  return { server, byPath, byId, writes, credentials: { user, password } };
}

/**
 * Run the seed against a stand-in, a new one with `options` or `stand` as it is left by an earlier
 * run, its credentials the stand-in's own unless `password` gives the seed another: its exit code
 * and its output.
 */
async function run({ stand: given, password: sent, ...options } = {}) {
  const stand = given ?? standIn({ user: 'seed-selftest', password: randomUUID(), ...options });
  const { user, password } = stand.credentials;
  if (!stand.server.listening)
    await new Promise((done) => stand.server.listen(0, '127.0.0.1', done));
  const { port } = stand.server.address();
  const child = spawn(process.execPath, [SEED], {
    env: {
      PATH: process.env.PATH,
      NUXEO_URL: `http://127.0.0.1:${port}`,
      NUXEO_USER: user,
      NUXEO_PASS: sent ?? password,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise((done) => child.on('close', done));
  return { code, output, stand, password };
}

const close = (stand) => new Promise((done) => stand.server.close(done));

// 1. No credentials: a precondition, before anything is asked.
{
  const child = spawn(process.execPath, [SEED], {
    env: { PATH: process.env.PATH, NUXEO_USER: '', NUXEO_PASS: '' },
  });
  let output = '';
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise((done) => child.on('close', done));
  expect(
    code === 2 && output.includes('NUXEO_USER and NUXEO_PASS'),
    'no credentials exits 2',
    output,
  );
}

// 2 to 4. The server's refusals before any write: credentials, the package, the workspaces.
{
  const refused = await run({ password: 'wrong' });
  expect(
    refused.code === 2 && refused.output.includes('HTTP 401'),
    'refused credentials exit 2',
    refused.output,
  );
  expect(refused.stand.writes.length === 0, 'nothing written with refused credentials');
  await close(refused.stand);
  const missing = await run({ types: ['Workspace', 'Folder'] });
  expect(
    missing.code === 2 && missing.output.includes('no EngineeringDocument type'),
    'no type exits 2',
    missing.output,
  );
  expect(missing.stand.writes.length === 0, 'nothing written without the package');
  await close(missing.stand);
  const nowhere = await run({ noWorkspaces: true });
  expect(
    nowhere.code === 2 && nowhere.output.includes('/default-domain/workspaces'),
    'no workspaces exits 2',
    nowhere.output,
  );
  await close(nowhere.stand);
}

// 5 to 12. A first run creates the register through the server's numbering, and checks it; a
// second adds nothing and writes no docctl: property; the password is never printed.
{
  const first = await run();
  const { stand, password } = first;
  expect(first.code === 0, 'the first run seeds and checks', first.output);
  const created = stand.writes.filter(
    (write) => write.method === 'POST' && write.path.startsWith(`${HOLDER}/`),
  );
  expect(
    created.length === REVISIONS,
    `the first run creates ${REVISIONS} revisions`,
    first.output,
  );
  const named = created.filter((write) =>
    Object.keys(write.sent).some((key) => SERVER_GIVEN.includes(key)),
  );
  expect(named.length === 0, 'the seed itself names no number', JSON.stringify(named));
  const current = [...stand.byId.values()].filter(
    (d) => d.properties['docctl:status'] === 'current',
  );
  expect(current.length === CHAINS.length, 'one current revision per chain');
  const numbers = new Set(current.map((d) => d.properties['docctl:number']));
  expect(numbers.size === CHAINS.length, 'each chain its own number', [...numbers].join(', '));
  stand.writes.length = 0;
  const second = await run({ stand });
  expect(second.code === 0, 'a second run passes', second.output);
  expect(
    !stand.writes.some((write) => write.method === 'POST'),
    'a second run creates nothing',
    second.output,
  );
  expect(
    !stand.writes.some((write) => Object.keys(write.sent).some((key) => key.startsWith('docctl:'))),
    'a second run writes no docctl: property',
  );
  expect(
    !first.output.includes(password) && !second.output.includes(password),
    'the password is never printed',
  );

  // 13. A missing last revision is created over the one before it, which is current again only
  // in this stand-in's history: delete the last of a chain and put the one before back to current.
  const chain = CHAINS[0];
  const [, middle, last] = revisionsOf(chain).map((revision) =>
    stand.byPath.get(`${HOLDER}/${revision.name}`),
  );
  stand.byPath.delete(last.path);
  stand.byId.delete(last.uid);
  middle.properties['docctl:status'] = 'current';
  middle.properties['docctl:supersededBy'] = null;
  const mended = await run({ stand });
  const again = stand.byPath.get(last.path);
  expect(
    mended.code === 0 &&
      again?.properties['docctl:supersedes'] === middle.uid &&
      again.properties['docctl:revision'] === 'C',
    'a missing revision is created over the one before it',
    mended.output,
  );

  // 14. A chain whose last revision someone else superseded is left alone, and stops the run.
  stand.byPath.delete(last.path);
  if (again) stand.byId.delete(again.uid);
  middle.properties['docctl:status'] = 'superseded';
  middle.properties['docctl:supersededBy'] = randomUUID();
  const stopped = await run({ stand });
  expect(
    stopped.code === 1 && stopped.output.includes('is no longer current'),
    "someone else's supersession stops the run",
    stopped.output,
  );
  expect(!stand.byPath.has(last.path), 'and creates nothing over it');
  await close(stand);
}

// 15. A place of another type is left alone, and stops the run.
{
  const stand = standIn({ user: 'seed-selftest', password: 'p' });
  stand.byPath.set('/default-domain/workspaces/controlled-documents-demo', {
    uid: randomUUID(),
    path: '/default-domain/workspaces/controlled-documents-demo',
    type: 'Note',
    properties: {},
  });
  const other = await run({ stand });
  expect(
    other.code === 1 && other.output.includes('is a Note'),
    'another type at a place stops the run',
    other.output,
  );
  await close(stand);
}

// 16 to 18. The check fails when the server numbers two chains alike, or a page provider leaves
// out, or holds, what it should not.
for (const [options, what, says] of [
  [{ oneNumber: true }, 'two chains numbered alike', 'share the number'],
  [
    { brokenProvider: 'controlled_documents_current' },
    'the current queue leaving revisions out',
    'does not return',
  ],
  [
    { widenedProvider: 'controlled_documents_current' },
    'the current queue holding superseded ones',
    'controlled_documents_current returns',
  ],
]) {
  const broken = await run(options);
  expect(
    broken.code === 1 && broken.output.includes(says),
    `the check fails on ${what}`,
    broken.output,
  );
  await close(broken.stand);
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${controls} controls failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${controls} of ${controls} controls passed.`);
