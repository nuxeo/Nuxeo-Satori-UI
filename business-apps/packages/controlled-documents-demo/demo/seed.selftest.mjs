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
 * Since the kit's version 0.2.0 it stands in for the people, the permissions, the transmittals and
 * the review cycles too, as `nuxeo-agentic-documents` 0.2.0 answers them, in miniature: users and
 * groups the seed creates, signed in with the demo password; a transmittal numbered in TR, its
 * documents named by number resolved to their current revision, a receipt beside it per recipient,
 * answered by its recipient alone; a review cycle opened by its opener, a comment in it by a
 * reviewer alone, an open thread resolved by the opener alone; and their page providers. So a pass
 * proves, besides, that the seed creates its people only where none of theirs is someone else's,
 * that each person acts as themselves, that it writes none of the server's properties, that a
 * second run answers, writes and resolves nothing again, and that its check fails when a receipt,
 * a queue or a thread is missing.
 *
 * Since 0.3.0 it stands in for the export-control marks too, as `nuxeo-agentic-documents` 0.3.0
 * answers them, in miniature: a first revision's mark taken from its creator, the administrator
 * here, with who marked it written by the server; a new revision given its predecessor's mark,
 * whatever it was sent; a change of a mark by anyone but the administrator refused; and who marked it
 * and when refused when written. So a pass proves, besides, that the seed marks the chains
 * `data.mjs` marks, every revision of them, that it writes neither of the server's two, that a second
 * run changes no mark, and that its check fails when the server does not carry one.
 *
 * It runs the real `seed.mjs` as a command, against a server on 127.0.0.1, with a user, a password
 * and a demo password made up for the run. Node 24 and nothing else. CI does not run it.
 *
 * Exit 0 when every control behaves as required, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHAINS,
  ENGINEER,
  FOLDER,
  GROUPS,
  RECIPIENT,
  REVIEW,
  REVIEWS,
  TRANSMITTAL,
  TRANSMITTALS,
  USERS,
  WORKSPACE,
  revisionsOf,
} from './data.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
const HOLDER = `${ROOT}/${FOLDER.name}`;
const SENT = `${ROOT}/${TRANSMITTALS.name}`;
const REVIEWED = `${ROOT}/${REVIEWS.name}`;
const REVISIONS = CHAINS.reduce((count, chain) => count + chain.revisions.length, 0);
/** What the server gives: a creation may name a series or a predecessor, and nothing else of these. */
const SERVER_GIVEN = ['docctl:number', 'docctl:revision', 'docctl:status', 'docctl:supersededBy'];
/** What the server gives a transmittal and a review cycle: the seed names none of it. */
const SERVER_GIVEN_TOO = [
  'docmark:markedBy',
  'docmark:markedAt',
  'trm:number',
  'trm:items',
  'trm:issuedBy',
  'trm:issuedAt',
  'rvw:number',
  'rvw:revision',
  'rvw:status',
  'rvw:openedBy',
  'rvw:openedAt',
];
const ALL_TYPES = [
  'Workspace',
  'Folder',
  'EngineeringDocument',
  'Transmittal',
  'TransmittalReceipt',
  'ReviewCycle',
  'TransmittalRegister',
];

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
 * return nothing; `widenedProvider` makes one return every engineering document; `noReceiptFor`
 * leaves that recipient without a receipt, as a broken listener would; `demoPassword` is the
 * password the users the seed creates sign in with; `foreignUser` is a user of the demo's names
 * that the seed did not create; `noMarks` leaves out the 0.3.0 add-on's `export_mark` schema;
 * `noCarry` gives a new revision no mark, as a broken listener would.
 */
function standIn({
  user,
  password,
  demoPassword = randomUUID(),
  types = ALL_TYPES,
  meStatus = 200,
  noWorkspaces = false,
  oneNumber = false,
  brokenProvider = null,
  widenedProvider = null,
  segmentMax = Infinity,
  noReceiptFor = null,
  foreignUser = null,
  noMarks = false,
  noCarry = false,
}) {
  const byPath = new Map();
  const byId = new Map();
  const counters = { DWG: 0, SPEC: 0, TR: 0 };
  const writes = [];
  /** Each mark the stand-in changed, after the creation that set it: the document's path. */
  const markChanges = [];
  /** Users and groups, by name: a user signs in with their password. */
  const users = new Map();
  const groups = new Map();
  if (foreignUser)
    users.set(foreignUser, { properties: { username: foreignUser, company: 'Elsewhere' } });
  const acls = new Map();
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
  /** As the add-on does since 0.3.0: a creator's mark taken, with who marked it, or none. */
  const markBy = (properties, who) =>
    properties['docmark:classification']
      ? {
          'docmark:classification': properties['docmark:classification'],
          'docmark:groups': [...(properties['docmark:groups'] ?? [])],
          'docmark:markedBy': who,
          'docmark:markedAt': new Date().toISOString(),
        }
      : {
          'docmark:classification': null,
          'docmark:groups': null,
          'docmark:markedBy': null,
          'docmark:markedAt': null,
        };
  const MARK_KEYS = [
    'docmark:classification',
    'docmark:groups',
    'docmark:markedBy',
    'docmark:markedAt',
  ];
  /** As the add-on does: number a first revision, or follow the one superseded. */
  const control = (properties, who) => {
    const supersedes = properties['docctl:supersedes'];
    if (!supersedes) {
      const series = properties['docctl:series'];
      if (!(series in counters))
        return { status: 400, message: 'Choose a registered number series' };
      if (properties['docmark:classification'] && who !== user)
        return { status: 403, message: 'it needs the ChangeExportMark permission on its folder' };
      const missing = (properties['docmark:groups'] ?? []).find((group) => !groups.has(group));
      if (properties['docmark:classification'] && missing)
        return { status: 400, message: `No group is named ${missing}` };
      counters[series]++;
      const value = oneNumber ? 1 : counters[series];
      return {
        properties: {
          ...markBy(properties, who),
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
    // A new revision's mark is the one it supersedes, whatever it was sent.
    const carried = noCarry
      ? markBy({}, null)
      : Object.fromEntries(MARK_KEYS.map((key) => [key, p[key] ?? null]));
    return {
      previous,
      properties: {
        ...carried,
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
  const ofType = (type) => [...byId.values()].filter((d) => d.type === type);
  const providers = {
    controlled_documents_current: () =>
      live().filter((d) => d.properties['docctl:status'] === 'current'),
    controlled_documents_superseded: () =>
      live().filter((d) => d.properties['docctl:status'] === 'superseded'),
    controlled_documents_revisions: (number) =>
      live().filter((d) => d.properties['docctl:number'] === number),
    controlled_documents_transmittal_receipts: (id) =>
      ofType('TransmittalReceipt').filter((d) => d.properties['trr:transmittal'] === id),
    controlled_documents_awaiting_me: (who) =>
      ofType('TransmittalReceipt').filter(
        (d) => d.properties['trr:recipient'] === who && d.properties['trr:status'] === 'awaiting',
      ),
    controlled_documents_transmittals: () => ofType('Transmittal'),
    controlled_documents_review_cycles: (id) =>
      ofType('ReviewCycle').filter((d) => d.properties['rvw:document'] === id),
    controlled_documents_cycle_threads: (id) =>
      ofType('Comment').filter(
        (d) => d.properties['rvwc:cycle'] === id && d.properties['rvwc:status'] != null,
      ),
  };

  /** As the add-on issues a transmittal: numbered, its documents resolved, receipts beside it. */
  const issue = (at, own, by) => {
    const ids = [];
    const items = [];
    for (const number of own['trm:documents'] ?? []) {
      const revision = live().find(
        (d) =>
          d.properties['docctl:number'] === number && d.properties['docctl:status'] === 'current',
      );
      if (!revision) return { status: 400, message: `No current revision of ${number}` };
      ids.push(revision.uid);
      items.push({
        document: revision.uid,
        number,
        revision: revision.properties['docctl:revision'],
        title: revision.properties['dc:title'],
      });
    }
    counters.TR++;
    return {
      properties: {
        ...own,
        'trm:number': `TR-${String(counters.TR).padStart(5, '0')}`,
        'trm:documents': ids,
        'trm:items': items,
        'trm:issuedBy': by,
        'trm:issuedAt': new Date().toISOString(),
      },
    };
  };
  const receipts = (transmittal, at) =>
    (transmittal.properties['trm:recipients'] ?? []).forEach((recipient, index) => {
      if (recipient === noReceiptFor) return;
      const p = transmittal.properties;
      add(`${at}/${p['trm:number'].toLowerCase()}-${index + 1}`, 'TransmittalReceipt', {
        'dc:title': `${p['trm:number']} ${p['dc:title']}`,
        'trr:transmittal': transmittal.uid,
        'trr:number': p['trm:number'],
        'trr:recipient': recipient,
        'trr:purpose': p['trm:purpose'],
        'trr:dueDate': p['trm:dueDate'],
        'trr:issuedBy': p['trm:issuedBy'],
        'trr:status': 'awaiting',
      });
    });

  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  /** Who signs a request: the administrator, a user the seed created, or nobody. */
  const signer = (header) => {
    if (header === authorization) return user;
    for (const [name, entry] of users)
      if (
        entry.password !== undefined &&
        header === `Basic ${Buffer.from(`${name}:${entry.password}`).toString('base64')}`
      )
        return name;
    return null;
  };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const answer = (status, json) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(json === undefined ? '' : JSON.stringify(json));
    };
    const who = signer(request.headers.authorization);
    if (who === null) return answer(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname.replace(/^\/nuxeo\/api\/v1/, ''));
    if (request.method === 'GET' && path === '/me') return answer(meStatus, { id: who });
    if (request.method === 'GET' && path.startsWith('/config/types/'))
      return types.includes(path.slice('/config/types/'.length))
        ? answer(200, {})
        : answer(404, {});
    if (request.method === 'GET' && path === '/config/schemas/export_mark')
      return noMarks ? answer(404, {}) : answer(200, { name: 'export_mark', prefix: 'docmark' });
    // The people: users and groups, which only the administrator writes.
    const person = /^\/(user|group)(?:\/([^/]+))?$/.exec(path);
    if (person) {
      const [, kind, name] = person;
      const store = kind === 'user' ? users : groups;
      if (request.method === 'GET')
        return name && store.has(name)
          ? answer(200, { id: name, properties: store.get(name).properties })
          : answer(404, {});
      if (who !== user) return answer(403, { message: 'administrators only' });
      const sent = JSON.parse(body);
      const id = kind === 'user' ? sent.id : sent.groupname;
      store.set(id, { properties: sent.properties, password: sent.properties?.password });
      writes.push({ method: request.method, path, sent: sent.properties ?? {}, as: who });
      return answer(request.method === 'POST' ? 201 : 200, { id, properties: sent.properties });
    }
    if (request.method === 'POST' && path === '/automation/Document.AddPermission') {
      const { input, params } = JSON.parse(body);
      const uid = String(input).replace(/^doc:/, '');
      const list = acls.get(uid) ?? [];
      for (const group of params.users)
        list.push({ username: group, permission: params.permission, granted: true });
      acls.set(uid, list);
      writes.push({ method: 'POST', path, sent: params, as: who });
      return answer(200, {});
    }
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
          const given = control(own, who);
          if (given.status) return answer(given.status, { message: given.message });
          own = { ...own, ...given.properties };
          previous = given.previous ?? null;
        }
        if (type === 'Transmittal') {
          const given = issue(at, own, who);
          if (given.status) return answer(given.status, { message: given.message });
          own = given.properties;
        }
        if (type === 'TransmittalReceipt')
          return answer(403, { message: "A transmittal's receipt is written by the server" });
        if (type === 'ReviewCycle') {
          const revision = byId.get(own['rvw:document']);
          if (!revision || revision.properties['docctl:status'] !== 'current')
            return answer(409, { message: 'a review cycle reviews a current revision' });
          own = {
            ...own,
            'rvw:number': revision.properties['docctl:number'],
            'rvw:revision': revision.properties['docctl:revision'],
            'rvw:status': 'open',
            'rvw:openedBy': who,
          };
        }
        // Nuxeo cuts a name to nuxeo.path.segment.maxsize, 24 by default, without a word.
        const created = add(`${at}/${String(name).slice(0, segmentMax)}`, type, own);
        if (previous) {
          previous.properties['docctl:status'] = 'superseded';
          previous.properties['docctl:supersededBy'] = created.uid;
        }
        if (type === 'Transmittal') receipts(created, at);
        writes.push({ method: 'POST', path: created.path, sent: properties ?? {}, as: who });
        return answer(201, created);
      }
    }
    const comment = /^\/id\/([^/]+)\/@comment$/.exec(path);
    if (comment && request.method === 'POST') {
      // As the add-on takes a comment in a review cycle: the cycle open, by a reviewer or its opener.
      const cycle = byId.get(comment[1]);
      if (!cycle) return answer(404, {});
      const { text } = JSON.parse(body);
      const p = cycle.properties;
      if (p['rvw:status'] !== 'open') return answer(409, { message: 'the cycle is closed' });
      if (who !== p['rvw:openedBy'] && !(p['rvw:reviewers'] ?? []).includes(who))
        return answer(403, { message: "Only the review cycle's reviewers comment in it" });
      const created = add(`${cycle.path}/Comments/${randomUUID()}`, 'Comment', {
        'comment:author': who,
        'comment:text': text,
        'comment:parentId': cycle.uid,
        'rvwc:cycle': cycle.uid,
        'rvwc:status': 'open',
      });
      writes.push({ method: 'POST', path, sent: { text }, as: who });
      return answer(201, { 'entity-type': 'comment', id: created.uid, text, author: who });
    }
    if (path.startsWith('/id/')) {
      const document = byId.get(path.slice('/id/'.length));
      if (!document) return answer(404, {});
      if (request.method === 'GET') {
        if (request.headers['enrichers-document'] === 'acls')
          return answer(200, {
            ...document,
            contextParameters: { acls: [{ name: 'local', aces: acls.get(document.uid) ?? [] }] },
          });
        return answer(200, document);
      }
      if (request.method === 'PUT') {
        const { properties } = JSON.parse(body);
        const given = Object.keys(properties ?? {}).filter(
          (key) =>
            (key.startsWith('docctl:') || SERVER_GIVEN_TOO.includes(key)) &&
            properties[key] !== document.properties[key],
        );
        writes.push({ method: 'PUT', path: document.path, sent: properties ?? {}, as: who });
        if (given.length > 0)
          return answer(400, { message: `${given.join(', ')} are given by the server` });
        // As the add-on since 0.3.0: a mark changed by a holder of ChangeExportMark alone, the
        // administrator here, and who marked it written by the server.
        const sentMark = ['docmark:classification', 'docmark:groups'].filter(
          (key) =>
            key in (properties ?? {}) &&
            JSON.stringify(properties[key] ?? null) !==
              JSON.stringify(document.properties[key] ?? null),
        );
        if (sentMark.length > 0) {
          if (who !== user)
            return answer(403, { message: 'it needs the ChangeExportMark permission' });
          const missing = (properties['docmark:groups'] ?? []).find((group) => !groups.has(group));
          if (properties['docmark:classification'] && missing)
            return answer(400, { message: `No group is named ${missing}` });
          Object.assign(properties, markBy({ ...document.properties, ...properties }, who));
          markChanges.push(document.path);
        }
        // As the add-on: a receipt answered once, by its recipient; a thread resolved by the opener.
        if (document.type === 'TransmittalReceipt' && 'trr:status' in (properties ?? {})) {
          if (who !== document.properties['trr:recipient'])
            return answer(403, { message: 'Only the recipient answers it' });
          if (document.properties['trr:status'] !== 'awaiting')
            return answer(409, { message: 'This receipt has been answered' });
        }
        if (document.type === 'Comment' && 'rvwc:status' in (properties ?? {})) {
          const cycle = byId.get(document.properties['rvwc:cycle']);
          if (who !== cycle?.properties['rvw:openedBy'])
            return answer(403, { message: 'Only whoever opened this review cycle resolves' });
          properties['rvwc:resolvedBy'] = who;
        }
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
  return {
    server,
    byPath,
    byId,
    writes,
    users,
    markChanges,
    credentials: { user, password, demoPassword },
  };
}

/**
 * Run the seed against a stand-in, a new one with `options` or `stand` as it is left by an earlier
 * run, its credentials the stand-in's own unless `password` gives the seed another: its exit code
 * and its output.
 */
async function run({ stand: given, password: sent, noDemoPassword = false, ...options } = {}) {
  const stand = given ?? standIn({ user: 'seed-selftest', password: randomUUID(), ...options });
  const { user, password, demoPassword } = stand.credentials;
  if (!stand.server.listening)
    await new Promise((done) => stand.server.listen(0, '127.0.0.1', done));
  const { port } = stand.server.address();
  const child = spawn(process.execPath, [SEED], {
    env: {
      PATH: process.env.PATH,
      NUXEO_URL: `http://127.0.0.1:${port}`,
      NUXEO_USER: user,
      NUXEO_PASS: sent ?? password,
      ...(noDemoPassword ? {} : { CONTROLLED_DOCUMENTS_DEMO_PASSWORD: demoPassword }),
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise((done) => child.on('close', done));
  return { code, output, stand, password, demoPassword };
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
  stand.byPath.set(ROOT, {
    uid: randomUUID(),
    path: ROOT,
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

// 19. A server that cuts names, as Nuxeo does past nuxeo.path.segment.maxsize: the seed stops at
// the first document stored under another name, saying so, rather than looking for it where it is
// not. Ten characters cuts the workspace's own name, and with it every place below.
{
  const cut = await run({ segmentMax: 10 });
  expect(
    cut.code === 1 && cut.output.includes('the server named it otherwise'),
    'a name the server cuts stops the run, and says so',
    cut.output,
  );
  expect(
    !cut.stand.writes.some((write) => write.path.startsWith(`${HOLDER}/`)),
    'and nothing is written where the seed thought its folder was',
  );
  await close(cut.stand);
}

// 20 to 22. Since 0.2.0, preconditions before anything is written: the demo password, the kit's
// 0.2.0 types, and a user of the demo's names someone else made.
{
  const unset = await run({ noDemoPassword: true });
  expect(
    unset.code === 2 && unset.output.includes('CONTROLLED_DOCUMENTS_DEMO_PASSWORD must be set'),
    'no demo password exits 2',
    unset.output,
  );
  expect(unset.stand.writes.length === 0, 'nothing written without a demo password');
  await close(unset.stand);
  const older = await run({ types: ['Workspace', 'Folder', 'EngineeringDocument'] });
  expect(
    older.code === 2 && older.output.includes('version 0.1.0'),
    'the kit 0.1.0 exits 2, asking for 0.2.0',
    older.output,
  );
  expect(older.stand.writes.length === 0, 'nothing written on the kit 0.1.0');
  await close(older.stand);
  const foreign = await run({ foreignUser: RECIPIENT });
  expect(
    foreign.code === 2 &&
      foreign.output.includes(`a user ${RECIPIENT} that the seed did not create`),
    "a user of the demo's names someone else made exits 2",
    foreign.output,
  );
  expect(foreign.stand.writes.length === 0, "and nothing is written, that user's included");
  await close(foreign.stand);
}

// 23 to 33. A first run creates the people and their permissions, issues the transmittal as its
// issuer, answers as its recipient, opens the review as its opener, writes each thread as its
// reviewer and resolves as the opener, naming none of the server's properties; a second run
// writes, answers and resolves nothing again; the demo password is never printed.
{
  const first = await run();
  const { stand, demoPassword } = first;
  expect(first.code === 0, 'the first run seeds the transmittal and the review', first.output);
  const posts = (prefix) =>
    stand.writes.filter((write) => write.method === 'POST' && write.path.startsWith(prefix));
  expect(
    USERS.every((person) => stand.users.has(person.username)) &&
      posts('/group').length === GROUPS.length,
    "the demo's people and groups are created",
    first.output,
  );
  const grants = posts('/automation/Document.AddPermission').map((write) => write.sent);
  expect(
    grants.length === 3 &&
      ['engineers', 'document-controllers'].every((group) =>
        grants.some((g) => g.permission === 'ReadWrite' && g.users.includes(group)),
      ) &&
      grants.some(
        (g) =>
          g.permission === 'ChangeExportMark' &&
          JSON.stringify(g.users) === '["document-controllers"]',
      ),
    'both groups are given ReadWrite on the workspace, and document controllers ChangeExportMark',
    JSON.stringify(grants),
  );
  const issued = posts(`${SENT}/`);
  expect(
    issued.length === 1 && issued[0].as === TRANSMITTAL.issuer,
    `the transmittal is issued by ${TRANSMITTAL.issuer}, as themselves`,
    JSON.stringify(issued),
  );
  const opened = posts(`${REVIEWED}/`);
  expect(
    opened.length === 1 && opened[0].as === REVIEW.opener,
    `the review cycle is opened by ${REVIEW.opener}, as themselves`,
    JSON.stringify(opened),
  );
  const named = [...issued, ...opened].filter((write) =>
    Object.keys(write.sent).some((key) => SERVER_GIVEN_TOO.includes(key)),
  );
  expect(
    named.length === 0,
    "the seed names none of the server's properties",
    JSON.stringify(named),
  );
  const comments = stand.writes.filter((write) => write.path.endsWith('/@comment'));
  expect(
    comments.length === REVIEW.threads.length &&
      REVIEW.threads.every((thread) => comments.some((write) => write.as === thread.by)),
    'each thread is written by its reviewer, as themselves',
    JSON.stringify(comments),
  );
  const answers = stand.writes.filter(
    (write) => write.method === 'PUT' && 'trr:status' in write.sent,
  );
  expect(
    answers.length === TRANSMITTAL.acknowledgedBy.length &&
      answers.every((write) => TRANSMITTAL.acknowledgedBy.includes(write.as)),
    'each acknowledgement is its recipient’s own',
    JSON.stringify(answers),
  );
  const resolutions = stand.writes.filter(
    (write) => write.method === 'PUT' && 'rvwc:status' in write.sent,
  );
  expect(
    resolutions.length === REVIEW.threads.filter((thread) => thread.resolution).length &&
      resolutions.every((write) => write.as === REVIEW.opener),
    'each resolution is the opener’s own',
    JSON.stringify(resolutions),
  );
  const awaiting = [...stand.byId.values()].filter(
    (d) => d.type === 'TransmittalReceipt' && d.properties['trr:status'] === 'awaiting',
  );
  expect(
    awaiting.length === TRANSMITTAL.recipients.length - TRANSMITTAL.acknowledgedBy.length &&
      !awaiting.some((d) => d.properties['trr:recipient'] === RECIPIENT),
    `${RECIPIENT} acknowledged, and the other recipient still awaits`,
  );

  stand.writes.length = 0;
  const second = await run({ stand });
  expect(second.code === 0, 'a second run passes', second.output);
  expect(
    !stand.writes.some(
      (write) =>
        write.method === 'POST' ||
        'trr:status' in (write.sent ?? {}) ||
        'rvwc:status' in (write.sent ?? {}),
    ),
    'a second run issues, opens, comments, answers and resolves nothing',
    JSON.stringify(
      stand.writes.filter((write) => write.method !== 'PUT' || write.path.startsWith('/user')),
    ),
  );
  expect(
    !first.output.includes(demoPassword) && !second.output.includes(demoPassword),
    'the demo password is never printed',
  );
  expect(
    ENGINEER === TRANSMITTAL.issuer && TRANSMITTAL.recipients.includes(RECIPIENT),
    "data.mjs's engineer issues the seeded transmittal, and its recipient receives it",
  );
  await close(stand);
}

// 34 to 36. The check fails when a recipient has no receipt, when the awaiting queue leaves an
// awaiting receipt out, or when the threads' page provider leaves a thread out.
for (const [options, what, says] of [
  [{ noReceiptFor: 'mlind' }, 'a recipient with no receipt', 'has receipts for'],
  [
    { brokenProvider: 'controlled_documents_awaiting_me' },
    'the awaiting queue leaving a receipt out',
    'controlled_documents_awaiting_me does not return',
  ],
  [
    { brokenProvider: 'controlled_documents_cycle_threads' },
    'the threads leaving one out',
    'has no thread by',
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

// Since 0.3.0. A first run marks the chains data.mjs marks, every revision of them, through the
// server's carrying from the first, and writes neither of the server's two; a second run changes
// no mark; the marks' groups are created, with their members.
{
  const first = await run();
  const { stand } = first;
  expect(first.code === 0, 'the first run seeds the marks', first.output);
  const marked = CHAINS.filter((chain) => chain.mark);
  expect(
    marked.length === 2,
    'data.mjs marks two chains',
    marked.map((chain) => chain.key).join(', '),
  );
  for (const chain of CHAINS) {
    const docs = revisionsOf(chain).map((revision) =>
      stand.byPath.get(`${HOLDER}/${revision.name}`),
    );
    const wrong = docs.filter((doc) =>
      chain.mark
        ? doc?.properties['docmark:classification'] !== chain.mark.classification ||
          JSON.stringify(doc?.properties['docmark:groups']) !== JSON.stringify(chain.mark.groups) ||
          !doc?.properties['docmark:markedBy']
        : Boolean(doc?.properties['docmark:classification']),
    );
    expect(
      wrong.length === 0,
      `${chain.key} ${chain.mark ? `carries ${chain.mark.classification} on every revision` : 'is not marked'}`,
      JSON.stringify(wrong.map((doc) => doc?.properties)),
    );
  }
  expect(
    stand.markChanges.length === 0,
    'a first run marks each chain when it creates it, and changes none',
  );
  const named = stand.writes.filter((write) =>
    ['docmark:markedBy', 'docmark:markedAt'].some((key) => key in write.sent),
  );
  expect(
    named.length === 0,
    'the seed writes neither who marked a revision nor when',
    JSON.stringify(named),
  );
  for (const chain of marked)
    for (const group of chain.mark.groups) {
      const members = USERS.filter((person) => person.groups.includes(group)).map(
        (person) => person.username,
      );
      expect(
        members.length > 0 &&
          members.every((name) => stand.users.get(name)?.properties.groups.includes(group)),
        `${group} is created with its members, ${members.join(', ')}`,
      );
    }
  stand.writes.length = 0;
  const second = await run({ stand });
  expect(
    second.code === 0 && stand.markChanges.length === 0,
    'a second run changes no mark',
    second.output + JSON.stringify(stand.markChanges),
  );
  // A revision seeded before 0.3.0, with no mark, is given its chain's by an update.
  const old = stand.byPath.get(`${HOLDER}/${revisionsOf(marked[0])[0].name}`);
  for (const key of [
    'docmark:classification',
    'docmark:groups',
    'docmark:markedBy',
    'docmark:markedAt',
  ])
    old.properties[key] = null;
  const third = await run({ stand });
  expect(
    third.code === 0 &&
      stand.markChanges.includes(old.path) &&
      old.properties['docmark:classification'],
    'a revision seeded before 0.3.0 is given its mark',
    third.output,
  );
  await close(stand);

  const older = await run({ noMarks: true });
  expect(
    older.code === 2 && older.output.includes('older than 0.3.0'),
    'the add-on before 0.3.0 exits 2, asking for 0.3.0',
    older.output,
  );
  expect(older.stand.writes.length === 0, 'nothing written on the add-on before 0.3.0');
  await close(older.stand);

  expect(
    marked.some((chain) => chain.revisions.length > 1),
    'a marked chain has more than one revision, so that the seed shows its mark carried',
  );
  const uncarried = await run({ noCarry: true });
  expect(
    uncarried.code === 1 && uncarried.output.includes('marked nothing, not'),
    'the check fails when the server does not carry a mark',
    uncarried.output,
  );
  await close(uncarried.stand);
}

// And every name data.mjs gives is short enough for Nuxeo's default.
{
  const names = [
    WORKSPACE.name,
    FOLDER.name,
    TRANSMITTALS.name,
    REVIEWS.name,
    TRANSMITTAL.name,
    REVIEW.name,
    ...CHAINS.flatMap((chain) => revisionsOf(chain).map((revision) => revision.name)),
  ];
  const long = names.filter((name) => name.length > 24);
  expect(long.length === 0, 'every name in data.mjs is 24 characters or fewer', long.join(', '));
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${controls} controls failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`${controls} of ${controls} controls passed.`);
