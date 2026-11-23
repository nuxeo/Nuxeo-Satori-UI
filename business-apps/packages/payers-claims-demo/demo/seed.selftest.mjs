#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * from what Nuxeo's REST API is documented to do: documents by path and by id, batch upload, the
 * `Document.Untrash` operation, page providers, NXQL, and trash renaming a document to
 * `<name>._<time>_.trashed` (the document alone: its children are neither flagged nor moved, which
 * Nuxeo may do differently). So a pass proves the script's logic: preconditions, a second run that
 * adds nothing, a trashed record restored, a document of another type left alone, and checks that
 * fail when a page provider is wrong. It says nothing about whether a real server accepts the
 * stand-in model or answers as the stand-in does: only a run against one shows that.
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

const SEED = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const ROOT = '/default-domain/workspaces/payers-demo';
const PAGE_PROVIDERS = [
  'member_claims',
  'member_cases',
  'provider_claims',
  'payers_claim_documents',
  'payers_unassigned_claims',
];

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `renameOnTrash` is Nuxeo's default; `brokenProvider` makes one page
 * provider return nothing; `pageSize` caps what a page holds, so paging is exercised.
 */
function standIn({
  user,
  password,
  types = ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument'],
  brokenProvider = null,
  renameOnTrash = true,
  pageSize = 3,
  hangUpOnFirstWrite = false,
}) {
  const byPath = new Map();
  const byId = new Map();
  const batches = new Map();
  const blobs = new Map();
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
  /** Trashed as Nuxeo trashes: flagged, and renamed unless renaming is off. */
  const trash = (document) => {
    document.isTrashed = true;
    if (renameOnTrash)
      move(document, `${document.path}._${Date.now()}${Math.floor(Math.random() * 1000)}_.trashed`);
  };
  const untrash = (document) => {
    document.isTrashed = false;
    const original = /^(.*)\._\d+_\.trashed$/.exec(document.path);
    if (original) move(document, original[1]);
  };
  add('/default-domain', 'Domain');
  add('/default-domain/workspaces', 'WorkspaceRoot');

  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const view = (document) => {
    const properties = { ...document.properties };
    const blob = blobs.get(document.uid);
    if (blob) properties['file:content'] = { name: blob.name, length: String(blob.bytes.length) };
    return { ...document, properties };
  };
  const write = (document, properties) => {
    const reference = properties['file:content'];
    if (reference && reference['upload-batch']) {
      const uploaded = batches.get(reference['upload-batch'])?.[reference['upload-fileId']];
      if (!uploaded) throw new Error('no such batch');
      blobs.set(document.uid, uploaded);
      delete properties['file:content'];
    }
    Object.assign(document.properties, properties);
  };
  const live = () => [...byId.values()].filter((document) => !document.isTrashed);
  const providers = {
    member_claims: (id) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:member'] === id),
    member_cases: (id) =>
      live().filter((d) => d.type === 'Case' && d.properties['case:member'] === id),
    provider_claims: (id) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:provider'] === id),
    payers_claim_documents: (number) =>
      live().filter((d) => d.type === 'ClaimDocument' && d.properties['claimdoc:claim'] === number),
    payers_unassigned_claims: () =>
      live().filter(
        (d) =>
          d.type === 'Claim' &&
          d.properties['claim:adjuster'] == null &&
          ['submitted', 'inReview'].includes(d.properties['claim:status']),
      ),
  };
  /** The one NXQL query the seed makes: a parent's trashed children by a name pattern. */
  const TRASHED_QUERY =
    /^SELECT \* FROM Document WHERE ecm:parentId = '([^']+)' AND ecm:isTrashed = 1 AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:name LIKE '([^']+)'$/;
  const page = (entries, index) => ({
    entries: entries.slice(index * pageSize, (index + 1) * pageSize).map(view),
    isNextPageAvailable: (index + 1) * pageSize < entries.length,
  });

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (request.headers.authorization !== authorization)
      return send(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname).replace(/^\/nuxeo\/api\/v1/, '');
    const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
    const { method } = request;
    // A server that goes away once writing has started: the connection drops, with no answer.
    if (hangUpOnFirstWrite && method === 'POST' && path.startsWith('/path/'))
      return request.socket.destroy();
    try {
      if (method === 'GET' && path === '/me') return send(200, { id: user });
      if (method === 'GET' && path.startsWith('/config/types/'))
        return types.includes(path.slice('/config/types/'.length))
          ? send(200, {})
          : send(404, { message: 'no such type' });
      if (method === 'GET' && path.startsWith('/path/')) {
        const document = byPath.get(path.slice('/path'.length));
        return document ? send(200, view(document)) : send(404, { message: 'not found' });
      }
      if (method === 'POST' && path.startsWith('/path/')) {
        const parent = path.slice('/path'.length);
        if (!byPath.has(parent)) return send(404, { message: 'no parent' });
        const body = JSON.parse(raw);
        // Nuxeo would give the new document another name; the seed must never ask it to.
        if (byPath.has(`${parent}/${body.name}`)) return send(409, { message: 'name taken' });
        const document = add(`${parent}/${body.name}`, body.type);
        write(document, { ...body.properties });
        return send(201, view(document));
      }
      const blob = /^\/id\/([^/]+)\/@blob\/file:content$/.exec(path);
      if (method === 'GET' && blob) {
        response.writeHead(200);
        return response.end(blobs.get(blob[1])?.bytes);
      }
      if (path.startsWith('/id/')) {
        const document = byId.get(path.slice('/id/'.length));
        if (!document) return send(404, { message: 'not found' });
        if (method === 'GET') return send(200, view(document));
        if (method === 'PUT') {
          write(document, { ...JSON.parse(raw).properties });
          return send(200, view(document));
        }
      }
      if (method === 'POST' && path === '/upload/') {
        const batchId = randomUUID();
        batches.set(batchId, {});
        return send(201, { batchId });
      }
      const upload = /^\/upload\/([^/]+)\/(\d+)$/.exec(path);
      if (method === 'POST' && upload) {
        batches.get(upload[1])[upload[2]] = {
          bytes: raw,
          name: decodeURIComponent(request.headers['x-file-name']),
        };
        return send(201, { uploaded: 'true' });
      }
      if (method === 'POST' && path === '/automation/Document.Untrash') {
        const document = byId.get(JSON.parse(raw).input.replace(/^doc:/, ''));
        untrash(document);
        return send(200, view(document));
      }
      if (method === 'GET' && path === '/search/lang/NXQL/execute') {
        const query = TRASHED_QUERY.exec(url.searchParams.get('query') ?? '');
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
        return send(200, page(found, index));
      }
      const execute = /^\/search\/pp\/([^/]+)\/execute$/.exec(path);
      if (method === 'GET' && execute) {
        const provider = providers[execute[1]];
        if (!provider) return send(404, { message: 'no such page provider' });
        const found =
          brokenProvider === execute[1]
            ? []
            : provider(url.searchParams.get('queryParams') ?? undefined);
        return send(200, page(found, index));
      }
      return send(404, { message: `the stand-in does not answer ${method} ${path}` });
    } catch (error) {
      return send(500, { message: error.message });
    }
  });
  Object.assign(server, { byPath, add, trash });
  return server;
}

/** A run of the real seed, as a command, with the environment given. */
function seed(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], { env: { PATH: process.env.PATH, ...env } });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.on('close', (status) => resolve({ status, output }));
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
    seed({ NUXEO_URL: url, NUXEO_USER: user, NUXEO_PASS: password, ...env });
  try {
    await body({ server, run, user, password });
  } finally {
    server.close();
  }
}

const done = (output) => output.split('\n').find((line) => line.startsWith('Done')) ?? '';
const at = (server, place) => server.byPath.get(`${ROOT}/${place}`);
const ids = (server) => [...server.byPath.values()].map((document) => document.uid).sort();

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
await against({}, async ({ run, user }) => {
  const wrong = randomUUID();
  const { status, output } = await run({ NUXEO_PASS: wrong });
  expect(
    status === 2 && /HTTP 401/.test(output) && !output.includes(wrong) && !output.includes(user),
    'refused credentials are exit 2, and neither half is printed',
    output,
  );
});
await against({ types: ['Member'] }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no Claim, Case, Provider, ClaimDocument type/.test(output),
    'the package not installed is exit 2, naming the types it lacks',
    output,
  );
});

await against({ hangUpOnFirstWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /stopped part way; running it again is safe/.test(output),
    'a server that stops answering after writing starts is exit 1, not a precondition',
    output,
  );
});

// Twice, both with Nuxeo's trash renaming and without it.
for (const renameOnTrash of [true, false]) {
  const how = renameOnTrash ? 'renamed on trash' : 'not renamed on trash';
  await against({ renameOnTrash }, async ({ server, run }) => {
    const first = await run();
    expect(first.status === 0, `${how}: a first run exits 0`, first.output);
    expect(
      /28 created, 0 updated, 0 restored from the trash, 4 file\(s\) uploaded/.test(first.output),
      `${how}: a first run creates 28 documents and uploads 4 files`,
      first.output,
    );
    const before = ids(server);
    const second = await run();
    expect(
      second.status === 0 &&
        /0 created, 28 updated, 0 restored from the trash, 0 file\(s\) uploaded/.test(
          second.output,
        ),
      `${how}: a second run creates and uploads nothing (${done(second.output)})`,
      second.output,
    );
    expect(
      JSON.stringify(ids(server)) === JSON.stringify(before),
      `${how}: the same documents with the same ids after two runs`,
    );

    // Edited and trashed by hand: put back and restored, with nothing created in its place.
    const member = at(server, 'members/member-100048');
    member.properties['member:status'] = 'terminated';
    server.trash(member);
    const claim = at(server, 'claims/claim-000140');
    claim.properties['claim:adjuster'] = 'someone';
    const third = await run();
    expect(
      third.status === 0 &&
        /0 created, 28 updated, 1 restored from the trash/.test(third.output) &&
        member.isTrashed === false &&
        member.path === `${ROOT}/members/member-100048` &&
        member.properties['member:status'] === 'active',
      `${how}: a trashed, edited member is restored to its place and put back, with none created`,
      third.output,
    );
    expect(
      JSON.stringify(ids(server)) === JSON.stringify(before),
      `${how}: still the same documents after the restore`,
    );
    expect(
      claim.properties['claim:adjuster'] === null,
      `${how}: an adjuster set by hand is cleared, so the claim is back in the queue`,
    );

    // The whole workspace trashed, and renamed: it comes back to its place.
    server.trash(server.byPath.get(ROOT));
    const fourth = await run();
    expect(
      fourth.status === 0 &&
        /0 created/.test(fourth.output) &&
        server.byPath.get(ROOT)?.isTrashed === false,
      `${how}: a trashed workspace is restored, with nothing created`,
      fourth.output,
    );

    const c131 = at(server, 'claims/claim-000131');
    expect(c131.properties['claim:member'] === member.uid, 'claim:member holds the member id');
    expect(
      at(server, 'cases/case-2041').properties['case:claim'] ===
        at(server, 'claims/claim-000144').uid,
      'case:claim holds the claim id',
    );
    expect(
      at(server, 'cases/case-2030').properties['case:claim'] === null,
      'a case with no claim has none',
    );
  });
}

// Two trashed copies of one record: the seed restores only one, so it stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  const first = at(server, 'providers/prv-201');
  server.trash(first);
  server.add(`${ROOT}/providers/prv-201`, 'Provider');
  server.trash(at(server, 'providers/prv-201'));
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named prv-201/.test(output),
    'two trashed copies of one record stop the run',
    output,
  );
});

// A place holding another type is left alone.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(`${ROOT}/members`, 'Folder');
  server.add(`${ROOT}/members/member-100048`, 'File', { 'dc:title': 'not the seed’s' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a Member/.test(output) &&
      at(server, 'members/member-100048').properties['dc:title'] === 'not the seed’s',
    'a File at a member’s place stops the run, untouched',
    output,
  );
});

// The checks are live, page after page.
for (const broken of PAGE_PROVIDERS) {
  await against({ brokenProvider: broken }, async ({ run }) => {
    const { status, output } = await run();
    expect(
      status === 1 && output.includes('The page providers disagree') && output.includes(broken),
      `${broken} returning nothing fails the run`,
      output,
    );
  });
}
await against({ pageSize: 1 }, async ({ run }) => {
  const { status, output } = await run();
  expect(status === 0, 'every page is read: one record a page still checks out', output);
});

if (failures.length > 0) {
  console.error(`seed selftest: ${failures.length} of ${controls} controls failed\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`seed selftest: all ${controls} controls behaved as required.`);
