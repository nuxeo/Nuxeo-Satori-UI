#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * from what Nuxeo's REST API is documented to do: documents by path and by id, batch upload, the
 * `Document.Untrash` operation, page providers, `$currentUser` replaced by the person asking,
 * aggregates, users and groups, a document's ACLs, `Document.AddPermission` and
 * `Document.RemovePermission`, a search index that lags behind the repository, NXQL through
 * `Repository.Query`, a search endpoint whose index has not yet seen what was trashed, as
 * OpenSearch's can lag, and trash renaming a document to `<name>._<time>_.trashed` (the document
 * alone: its children are neither flagged nor moved, which Nuxeo may do differently). So a pass
 * proves the script's logic: preconditions, version 0.3.0 refused, each claim brought along the
 * claim lifecycle to its status, from a new claim's state and from 0.3.0's, a claim that cannot be
 * stopping the run, and a claim read back in another state failing it, a second run that adds and
 * moves nothing, a trashed record
 * restored, a document of another type left alone, a user or a group the seed did not create left
 * alone, the demo's people put back, and checks that fail when a page provider, its aggregates or
 * a user's rights are wrong. It says nothing about whether a real server accepts
 * the stand-in model or answers as the stand-in does: only a run against one shows that.
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

import { CLAIMS } from './data.mjs';
import { pathBetween, readLifecycle } from './lifecycle.mjs';

const LIFECYCLE = readLifecycle();
const SEED = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const ROOT = '/default-domain/workspaces/payers-demo';
const PAGE_PROVIDERS = [
  'member_claims',
  'member_cases',
  'provider_claims',
  'payers_claim_documents',
  'payers_unassigned_claims',
  'payers_my_claims',
  'payers_pending_claims',
];
/** `seed.mjs`'s marker on a user or a group it created. */
const MARKER = 'Payers kit demo (fictional)';

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `renameOnTrash` is Nuxeo's default; `brokenProvider` makes one page
 * provider return nothing; `pageSize` caps what a page holds, so paging is exercised;
 * `administrator: false` makes NUXEO_USER an ordinary user; `noAggregations` answers as a page
 * provider that queries the repository does, with none; `guestFor` answers that user's `/me` as
 * `Anonymous`, as a server that lets guests in does when a password is refused; `groupless` answers
 * that user's `/me` with none of their groups; `indexLag` answers the queue page providers, which
 * read the search index, with nothing for that many requests, as an index not yet caught up does;
 * `membersWrite` gives the platform's `members` group, which every user is in, ReadWrite
 * everywhere, as a server configured so would. A claim follows the stand-in model's `payersClaim`
 * lifecycle, read from its XML as the seed reads it, starting `submitted`, and keeps claim:status
 * in step with each transition, as the model's event handler does; `statusOnly` answers the claim
 * of that number, read back by its id, in `submitted` whatever its state, as a server whose state
 * and status had come apart would. `workflowModel: false` answers as version 0.3.0, which has no
 * claims review workflow.
 */
function standIn({
  user,
  password,
  administrator = true,
  workflowModel = true,
  statusOnly = null,
  noAggregations = false,
  guestFor = null,
  groupless = null,
  indexLag = 0,
  membersWrite = false,
  types = ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument', 'PayersClaimSearch'],
  brokenProvider = null,
  renameOnTrash = true,
  pageSize = 3,
  hangUpOnFirstWrite = false,
  stallBodyOn = null,
  endlessProvider = null,
}) {
  const byPath = new Map();
  const byId = new Map();
  const batches = new Map();
  const blobs = new Map();
  /** Users by id, each with its properties and its password, and groups by name. */
  const users = new Map();
  const groups = new Map();
  /** Each document's local ACL, by its id. */
  const acls = new Map();
  const calls = [];
  const add = (path, type, properties = {}) => {
    const document = {
      'entity-type': 'document',
      uid: randomUUID(),
      path,
      type,
      state: type === 'Claim' ? LIFECYCLE.initial : 'project',
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

  const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  const authorization = basic(user, password);
  /** Who a request runs as: NUXEO_USER, a user the seed created, or no one. */
  const principal = (header) => {
    if (header === authorization) return user;
    for (const [id, entry] of users) if (header === basic(id, entry.password)) return id;
    return null;
  };
  /**
   * What `asking` may do on a document, as the `permissions` enricher lists it: read, and change
   * when an ACE on the document or above it gives one of their groups ReadWrite.
   */
  const rights = (document, asking) => {
    const write = ['WriteProperties', 'WriteLifeCycle', 'ReadWrite'];
    if (asking === user) return ['Read', ...write];
    const theirs = [...(users.get(asking)?.properties.groups ?? []), 'members'];
    const segments = document.path.split('/').filter(Boolean);
    const above = segments.map((_, i) => byPath.get(`/${segments.slice(0, i + 1).join('/')}`));
    const writes =
      membersWrite ||
      above.some((place) =>
        (acls.get(place?.uid) ?? []).some(
          (ace) => theirs.includes(ace.username) && ace.permission === 'ReadWrite',
        ),
      );
    return ['Read', ...(writes ? write : [])];
  };
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
          (d.properties['claim:adjuster'] ?? null) === null &&
          ['submitted', 'inReview'].includes(d.properties['claim:status']),
      ),
    // Given the adjuster's name: the seed passes $currentUser, which the server replaces.
    payers_my_claims: (adjuster) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:adjuster'] === adjuster),
    payers_pending_claims: () =>
      live().filter(
        (d) => d.type === 'Claim' && ['inReview', 'pended'].includes(d.properties['claim:status']),
      ),
  };
  /** A terms aggregate over the records found, as the search index answers it. */
  const terms = (found, property) => {
    const counts = new Map();
    for (const d of found) {
      const key = d.properties[property];
      if (key !== null && key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { buckets: [...counts].map(([key, docCount]) => ({ key, docCount })) };
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
    const asking = principal(request.headers.authorization);
    if (asking === null) return send(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname).replace(/^\/nuxeo\/api\/v1/, '');
    const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
    const { method } = request;
    calls.push(`${method} ${path}`);
    // A server that goes away once writing has started: the connection drops, with no answer.
    if (hangUpOnFirstWrite && method === 'POST' && path.startsWith('/path/'))
      return request.socket.destroy();
    // A server that sends its headers, then never the rest of its body.
    if (stallBodyOn === path) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.write('{');
    }
    try {
      if (method === 'GET' && path === '/me') {
        if (asking === user) return send(200, { id: user, isAdministrator: administrator });
        if (asking === guestFor) return send(200, { id: 'Anonymous', isAdministrator: false });
        const member = asking === groupless ? [] : (users.get(asking).properties.groups ?? []);
        return send(200, {
          id: asking,
          isAdministrator: false,
          properties: { groups: member },
          extendedGroups: [...member, 'members'].map((name) => ({ name })),
        });
      }
      // Users and groups: only an administrator may write them, as on a server.
      const writing = method !== 'GET';
      if (
        (path === '/user' ||
          path.startsWith('/user/') ||
          path === '/group' ||
          path.startsWith('/group/')) &&
        writing &&
        !(asking === user && administrator)
      )
        return send(403, { message: 'not an administrator' });
      if (path.startsWith('/user/')) {
        const id = path.slice('/user/'.length);
        const entry = users.get(id);
        if (!entry) return send(404, { message: 'no such user' });
        if (method === 'GET') return send(200, { id, properties: { ...entry.properties } });
        if (method === 'PUT') {
          const { password: secret, ...properties } = JSON.parse(raw).properties;
          Object.assign(entry.properties, properties);
          if (secret) entry.password = secret;
          return send(200, { id, properties: { ...entry.properties } });
        }
      }
      if (method === 'POST' && path === '/user') {
        const { id, properties } = JSON.parse(raw);
        if (users.has(id)) return send(409, { message: 'user exists' });
        const { password: secret, ...rest } = properties;
        const unknown = (rest.groups ?? []).filter((name) => !groups.has(name));
        if (unknown.length > 0) return send(400, { message: `no group ${unknown.join(', ')}` });
        users.set(id, { properties: rest, password: secret });
        return send(201, { id, properties: { ...rest } });
      }
      if (path.startsWith('/group/') && method === 'GET') {
        const group = groups.get(path.slice('/group/'.length));
        return group ? send(200, group) : send(404, { message: 'no such group' });
      }
      if (method === 'POST' && path === '/group') {
        const body = JSON.parse(raw);
        if (groups.has(body.groupname)) return send(409, { message: 'group exists' });
        groups.set(body.groupname, { groupname: body.groupname, properties: body.properties });
        return send(201, groups.get(body.groupname));
      }
      if (method === 'POST' && path === '/automation/Document.AddPermission') {
        const body = JSON.parse(raw);
        const uid = body.input.replace(/^doc:/, '');
        const aces = acls.get(uid) ?? [];
        for (const name of body.params.users)
          aces.push({
            id: `${name}:${body.params.permission}:true:${user}::`,
            username: name,
            permission: body.params.permission,
            granted: true,
            status: 'effective',
          });
        acls.set(uid, aces);
        return send(200, view(byId.get(uid)));
      }
      if (method === 'POST' && path === '/automation/Document.RemovePermission') {
        const body = JSON.parse(raw);
        const uid = body.input.replace(/^doc:/, '');
        acls.set(
          uid,
          (acls.get(uid) ?? []).filter((ace) => ace.id !== body.params.id),
        );
        return send(200, view(byId.get(uid)));
      }
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
        // The one claim `statusOnly` names, read back by id after the seed wrote it, in submitted.
        const drifted =
          statusOnly !== null && document.properties['claim:number'] === statusOnly
            ? { state: LIFECYCLE.initial }
            : {};
        if (method === 'GET')
          return send(200, {
            ...view(document),
            ...drifted,
            ...(request.headers['enrichers-document'] === 'acls'
              ? {
                  contextParameters: {
                    acls: [{ name: 'local', aces: acls.get(document.uid) ?? [] }],
                  },
                }
              : {}),
            ...(request.headers['enrichers-document'] === 'permissions'
              ? { contextParameters: { permissions: rights(document, asking) } }
              : {}),
          });
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
      // A lifecycle transition, refused as Nuxeo refuses one the document's state does not allow.
      if (method === 'POST' && path === '/automation/Document.FollowLifecycleTransition') {
        const body = JSON.parse(raw);
        const document = byId.get(body.input.replace(/^doc:/, ''));
        const transition = body.params?.value;
        const allowed =
          document?.type === 'Claim' &&
          (LIFECYCLE.states.get(document.state) ?? []).includes(transition);
        if (!allowed)
          return send(500, {
            message: `Not allowed to follow transition <${transition}> from state <${document?.state}>`,
          });
        document.state = LIFECYCLE.transitions.get(transition);
        document.properties['claim:status'] = document.state;
        return send(200, view(document));
      }
      if (method === 'GET' && path.startsWith('/workflowModel/'))
        return workflowModel && path === '/workflowModel/PayersClaimReview'
          ? send(200, { 'entity-type': 'workflow', name: 'PayersClaimReview' })
          : send(404, { message: 'no such workflow model' });
      if (method === 'POST' && path === '/automation/Document.Untrash') {
        const document = byId.get(JSON.parse(raw).input.replace(/^doc:/, ''));
        untrash(document);
        return send(200, view(document));
      }
      // The repository: what is trashed is trashed.
      const repository = method === 'POST' && path === '/automation/Repository.Query';
      // The search index, a moment behind: it has not seen anything trashed yet, so it finds none.
      const searchIndex = method === 'GET' && path === '/search/lang/NXQL/execute';
      if (repository || searchIndex) {
        const body = repository ? JSON.parse(raw).params : null;
        const query = TRASHED_QUERY.exec(
          repository ? (body.query ?? '') : (url.searchParams.get('query') ?? ''),
        );
        if (!query) return send(400, { message: 'a query the stand-in does not know' });
        const [, parent, like] = query;
        const pattern = new RegExp(
          `^${like
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.')}$`,
        );
        const found = searchIndex
          ? []
          : [...byId.values()].filter(
              (d) => d.isTrashed && parentOf(d)?.uid === parent && pattern.test(nameOf(d)),
            );
        return send(200, page(found, repository ? Number(body.currentPageIndex ?? 0) : index));
      }
      const execute = /^\/search\/pp\/([^/]+)\/execute$/.exec(path);
      if (method === 'GET' && execute) {
        const provider = providers[execute[1]];
        if (!provider) return send(404, { message: 'no such page provider' });
        const given = url.searchParams.get('queryParams') ?? undefined;
        const lagging =
          execute[1].startsWith('payers_') &&
          execute[1] !== 'payers_claim_documents' &&
          indexLag-- > 0;
        const found =
          brokenProvider === execute[1] || lagging
            ? []
            : provider(given === '$currentUser' ? asking : given);
        // A provider that always says there is another page.
        if (endlessProvider === execute[1])
          return send(200, { ...page(found, index), isNextPageAvailable: true });
        // The three queue page providers answer their aggregates, as the search index does.
        const queues = {
          payers_unassigned_claims: ['claim_status_agg'],
          payers_my_claims: ['claim_status_agg'],
          payers_pending_claims: ['claim_status_agg', 'claim_adjuster_agg'],
        };
        const property = { claim_status_agg: 'claim:status', claim_adjuster_agg: 'claim:adjuster' };
        const aggregations = Object.fromEntries(
          noAggregations === execute[1] || noAggregations === true
            ? []
            : (queues[execute[1]] ?? []).map((id) => [id, terms(found, property[id])]),
        );
        return send(200, { ...page(found, index), aggregations });
      }
      return send(404, { message: `the stand-in does not answer ${method} ${path}` });
    } catch (error) {
      return send(500, { message: error.message });
    }
  });
  Object.assign(server, { byPath, add, trash, users, groups, acls, calls, basic });
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
  const demoPassword = `demo-${randomUUID()}`;
  const server = standIn({ user, password, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (env = {}) =>
    seed({
      NUXEO_URL: url,
      NUXEO_USER: user,
      NUXEO_PASS: password,
      PAYERS_DEMO_PASSWORD: demoPassword,
      NUXEO_TIMEOUT_MS: '2000',
      NUXEO_INDEX_WAIT_MS: '1500',
      ...env,
    });
  try {
    await body({ server, run, user, password, demoPassword });
  } catch (error) {
    // A control that throws, because the seed left the server in a state it did not expect, is a
    // failed control, not a crash that hides the others.
    expect(false, `a control threw: ${error?.stack ?? error}`);
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
    PAYERS_DEMO_PASSWORD: randomUUID(),
  });
  expect(status === 2 && /did not answer/.test(output), 'no server is exit 2', output);
}
await against({}, async ({ server, run }) => {
  const { status, output } = await run({ PAYERS_DEMO_PASSWORD: '' });
  expect(
    status === 2 && /PAYERS_DEMO_PASSWORD must be set/.test(output) && server.calls.length === 0,
    'no demo password is exit 2, before the server is asked anything',
    output,
  );
});
await against({ administrator: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /is not an administrator/.test(output) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'NUXEO_USER who is not an administrator is exit 2, with nothing written',
    output,
  );
});
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
    status === 2 && /no Claim, Case, Provider, ClaimDocument, PayersClaimSearch type/.test(output),
    'the package not installed is exit 2, naming the types it lacks',
    output,
  );
});
await against(
  { types: ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument'] },
  async ({ server, run }) => {
    const { status, output } = await run();
    expect(
      status === 2 &&
        /version 0.2.0 or older .* upgrade it to 0.4.0/.test(output) &&
        server.calls.every((call) => call.startsWith('GET ')),
      'version 0.2.0 of the package, with no queue search type, is exit 2, with nothing written',
      output,
    );
  },
);

await against({ hangUpOnFirstWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /stopped part way; running it again is safe/.test(output),
    'a server that stops answering after writing starts is exit 1, not a precondition',
    output,
  );
});

await against({ stallBodyOn: '/me' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /did not answer GET \/me/.test(output),
    'a server whose first answer stalls after its headers is exit 2: no answer is no server',
    output,
  );
});
await against({ endlessProvider: 'member_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /member_claims still reports another page after 100 pages/.test(output),
    'a page provider that never stops reporting another page fails the run, counted in pages',
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
    expect(
      /People: 9 created, 0 updated, 5 permission\(s\) granted, 0 removed, for 6 users in 3 groups/.test(
        first.output,
      ),
      `${how}: a first run creates 6 users and 3 groups, and grants 5 permissions`,
      first.output,
    );
    // Each claim brought from submitted to its status, along the fewest transitions, and kept so.
    const wanted = CLAIMS.reduce(
      (count, claim) => count + pathBetween(LIFECYCLE, LIFECYCLE.initial, claim.status).length,
      0,
    );
    const transitions = (from) =>
      server.calls
        .slice(from)
        .filter((call) => call.endsWith('/Document.FollowLifecycleTransition')).length;
    const settled = () =>
      CLAIMS.every((claim) => {
        const document = at(server, `claims/${claim.number.toLowerCase()}`);
        return (
          document?.state === claim.status && document.properties['claim:status'] === claim.status
        );
      });
    expect(
      settled() &&
        transitions(0) === wanted &&
        new RegExp(`${wanted} lifecycle transition`).test(first.output),
      `${how}: a first run brings every claim to the state its status names, in ${wanted} transitions`,
      first.output,
    );
    const before = ids(server);
    const callsBefore = server.calls.length;
    const second = await run();
    expect(
      settled() && transitions(callsBefore) === 0,
      `${how}: a second run follows no transition`,
      second.output,
    );
    expect(
      /People: 0 created, 6 updated, 0 permission\(s\) granted, 0 removed/.test(second.output),
      `${how}: a second run creates no user, group or permission`,
      second.output,
    );
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

// The claims' lifecycle.
await against({ workflowModel: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.3.0 or older .* no PayersClaimReview workflow .* upgrade it to 0.4.0/.test(
        output,
      ) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.3.0 of the package, with no claims review workflow, is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the lifecycle, exits 0', first.output);
  // As version 0.3.0 left them: in the default lifecycle's first state, now this one's legacy.
  for (const claim of CLAIMS) at(server, `claims/${claim.number.toLowerCase()}`).state = 'project';
  const upgraded = await run();
  expect(
    upgraded.status === 0 &&
      CLAIMS.every((claim) => {
        const document = at(server, `claims/${claim.number.toLowerCase()}`);
        return (
          document.state === claim.status && document.properties['claim:status'] === claim.status
        );
      }) &&
      /moved {4}CLAIM-000130 from project to paid: submit, review, approve, pay/.test(
        upgraded.output,
      ),
    'a claim created before 0.4.0, in project, is brought through submit to its status',
    upgraded.output,
  );
  // Reviewed since, though data.mjs has it submitted: no transition leads back.
  const reviewed = at(server, 'claims/claim-000140');
  reviewed.state = 'inReview';
  const stuck = await run();
  expect(
    stuck.status === 1 &&
      /CLAIM-000140 is inReview, and the claim lifecycle has no way from there to submitted/.test(
        stuck.output,
      ) &&
      reviewed.state === 'inReview',
    'a claim no transition can bring to its status stops the run with exit 1, naming it, its state as it was',
    stuck.output,
  );
});
await against({ statusOnly: 'CLAIM-000131' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /The claims are not in their statuses' states/.test(output) &&
      /CLAIM-000131 is submitted with status inReview, not inReview/.test(output),
    "a claim read back in another state than its status fails the seed's check",
    output,
  );
});

// The demo's people: in their groups, with the demo password, and put back when changed by hand.
await against({}, async ({ server, run, demoPassword }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the people, exits 0', first.output);
  expect(!first.output.includes(demoPassword), 'the demo password is never printed', first.output);
  const dana = server.users.get('dana.lee');
  const morgan = server.users.get('morgan.chen');
  expect(
    dana?.password === demoPassword &&
      JSON.stringify(dana?.properties.groups) === '["claims-adjusters"]' &&
      JSON.stringify(morgan?.properties.groups) === '["claims-adjusters","claims-supervisors"]' &&
      server.users.get('riley.brooks')?.properties.groups.includes('member-services') &&
      dana?.properties.company === MARKER,
    'each user has the demo password, their groups and the marker',
  );
  const aclOf = (place) =>
    (server.acls.get(server.byPath.get(place).uid) ?? [])
      .map((a) => `${a.username}:${a.permission}`)
      .sort();
  expect(
    JSON.stringify(aclOf(ROOT)) ===
      JSON.stringify([
        'claims-adjusters:Read',
        'claims-supervisors:Read',
        'member-services:Read',
      ]) &&
      JSON.stringify(aclOf(`${ROOT}/claims`)) ===
        JSON.stringify(['claims-adjusters:ReadWrite', 'claims-supervisors:ReadWrite']) &&
      aclOf(`${ROOT}/members`).length === 0,
    'the workspace and the claims folder give each group the permissions data.mjs names, once',
    JSON.stringify({ workspace: aclOf(ROOT), claims: aclOf(`${ROOT}/claims`) }),
  );
  // A permission of a demo group that data.mjs does not name is removed; anyone else's stays.
  const ace = (username, permission) => ({
    id: `${username}:${permission}:true:x::`,
    username,
    permission,
    granted: true,
    status: 'effective',
  });
  server.acls.set(server.byPath.get(`${ROOT}/members`).uid, [
    ace('claims-adjusters', 'Everything'),
    ace('someone', 'Write'),
  ]);
  dana.password = 'changed by hand';
  dana.properties.groups = ['member-services'];
  const second = await run();
  expect(
    second.status === 0 &&
      dana.password === demoPassword &&
      JSON.stringify(dana.properties.groups) === '["claims-adjusters"]',
    'a password and groups changed by hand are put back',
    second.output,
  );
  expect(
    /1 removed/.test(second.output) &&
      JSON.stringify(aclOf(`${ROOT}/members`)) === JSON.stringify(['someone:Write']),
    "a demo group's permission data.mjs does not name is removed, and someone else's is kept",
    second.output,
  );
});

// A user or a group of the demo's names that the seed did not create is left alone, and found
// before anything is written.
await against({}, async ({ server, run }) => {
  server.groups.set('member-services', { groupname: 'member-services', properties: {} });
  const { status, output } = await run();
  expect(
    status === 2 &&
      /a group member-services that the seed did not create/.test(output) &&
      server.groups.get('member-services').properties.description === undefined &&
      server.calls.every((call) => call.startsWith('GET ')),
    'a member-services group the seed did not create is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run, before a user is replaced, exits 0');
  server.users.set('sam.patel', {
    properties: { username: 'sam.patel', company: 'Someone else', groups: [] },
    password: 'theirs',
  });
  const { status, output } = await run();
  const sam = server.users.get('sam.patel');
  expect(
    status === 2 &&
      /a user sam.patel that the seed did not create/.test(output) &&
      sam.password === 'theirs' &&
      sam.properties.groups.length === 0,
    'a sam.patel the seed did not create is exit 2, untouched',
    output,
  );
});

// What each user may do is checked as them, wherever the permission comes from.
await against({ membersWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /riley.brooks may change a member/.test(output) &&
      /riley.brooks holds WriteProperties on a claim/.test(output),
    'a server that lets every member change records fails the run: member services may not',
    output,
  );
});

// Each user must sign in as themself, in their groups: the demo signs in as them.
await against({ guestFor: 'dana.lee' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /dana.lee signs in as Anonymous/.test(output),
    'a user the server answers as Anonymous fails the run',
    output,
  );
});
await against({ groupless: 'riley.brooks' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /riley.brooks signs in as riley.brooks, in members, not in member-services/.test(output),
    'a user who is not in their groups fails the run',
    output,
  );
});

// The search index a moment behind: the checks are asked again until it has caught up.
await against({ indexLag: 3 }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 0 && /waiting {2}\d+ disagreement\(s\)/.test(output),
    'a search index that lags is waited for, and the run then passes',
    output,
  );
});

// The aggregates the queues' facets and the home's KPIs read must be answered, by each queue.
for (const pageProvider of [
  'payers_unassigned_claims',
  'payers_my_claims',
  'payers_pending_claims',
]) {
  await against({ noAggregations: pageProvider }, async ({ run }) => {
    const { status, output } = await run();
    expect(
      status === 1 &&
        new RegExp(`${pageProvider}( as \\S+)? answered no claim_status_agg`).test(output),
      `${pageProvider} answering no aggregates fails the run`,
      output,
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

// The same, on a server whose pages hold one entry: the second copy is on the next page.
await against({ pageSize: 1 }, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run, one entry a page, exits 0');
  server.trash(at(server, 'providers/prv-201'));
  server.add(`${ROOT}/providers/prv-201`, 'Provider');
  server.trash(at(server, 'providers/prv-201'));
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named prv-201/.test(output),
    'two trashed copies stop the run when the second is on the next page',
    output,
  );
});

// A trashed sibling whose name only starts with the record's is not the record: LIKE's `_` and
// `%` match it, the exact name does not.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(`${ROOT}/members`, 'Folder');
  const backup = server.add(`${ROOT}/members/member-100048.backup`, 'Member', {
    'dc:title': 'a backup, not the seed’s',
  });
  server.trash(backup);
  const { status, output } = await run();
  expect(
    status === 0 &&
      /0 restored from the trash/.test(output) &&
      backup.isTrashed === true &&
      backup.properties['dc:title'] === 'a backup, not the seed’s' &&
      at(server, 'members/member-100048')?.uid !== backup.uid,
    'a trashed member-100048.backup is left in the trash, untouched, and the member created',
    output,
  );
  const member = at(server, 'members/member-100048');
  server.trash(member);
  const again = await run();
  expect(
    again.status === 0 &&
      /1 restored from the trash/.test(again.output) &&
      member.isTrashed === false &&
      backup.isTrashed === true,
    'with both trashed, the member is restored and the backup is not',
    again.output,
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
