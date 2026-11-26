#!/usr/bin/env node
/**
 * The records kit seed's controls, against a stand-in for the parts of Nuxeo's REST API it calls,
 * on the loopback interface. No Nuxeo, no install, no credential of anyone's.
 *
 *   node business-apps/packages/records-demo/demo/seed.selftest.mjs
 *
 * Each control runs the seed as a command and checks what it asked the stand-in and what it said.
 * The seed must never file a disposition request, nor a custody request: starting and approving a
 * run, and moving, checking out or returning a physical record, are the demo's people's, never a
 * script's.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUSTODY_GRANTS, GRANTS, LOCATIONS, PHYSICAL, RECORDS, RULE } from './data.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const PASSWORD = 'not-a-real-password-for-the-stand-in';
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures++;
}

/** A stand-in Nuxeo: documents by path, ACLs, the operations the seed runs, and every request kept. */
const TYPES = ['RetentionRule', 'DispositionRuns', 'CustodyDesk', 'PhysicalLocation', 'PhysicalRecord', 'RecordsFile'];

function standIn({ administrator = true, types = TYPES } = {}) {
  const docs = new Map();
  const requests = [];
  let next = 1;
  const add = (path, type, properties = {}) => {
    const doc = { 'entity-type': 'document', uid: `uid-${next++}`, path, type, properties, isRecord: false, hasLegalHold: false, acl: [] };
    docs.set(path, doc);
    return doc;
  };
  add('/', 'Root');
  add('/default-domain/workspaces', 'WorkspaceRoot');
  add('/RetentionRules', 'RetentionRules');
  const byUid = (uid) => [...docs.values()].find((doc) => doc.uid === uid);
  const view = (doc) => ({ ...doc, acl: undefined });
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const url = new URL(request.url, 'http://stand-in');
      const json = body ? JSON.parse(body) : null;
      requests.push({ method: request.method, path: url.pathname, query: url.searchParams.get('query'), json, authorization: request.headers.authorization });
      const send = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(value === undefined ? '' : JSON.stringify(value));
      };
      const api = url.pathname.replace(/^\/nuxeo\/api\/v1/, '');
      if (request.headers.authorization !== `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}`) return send(401, { message: 'no' });
      if (api === '/me') return send(200, { id: 'admin', isAdministrator: administrator });
      if (api.startsWith('/config/types/')) return types.includes(api.slice(14)) ? send(200, { name: api.slice(14) }) : send(404, {});
      if (api.startsWith('/path')) {
        const path = decodeURIComponent(api.slice(5));
        if (request.method === 'GET') return docs.has(path) ? send(200, view(docs.get(path))) : send(404, {});
        const created = add(`${path === '/' ? '' : path}/${json.name}`, json.type, json.properties);
        return send(201, view(created));
      }
      if (api === '/search/lang/NXQL/execute') {
        const type = /FROM (\w+)/.exec(url.searchParams.get('query') ?? '')?.[1];
        return send(200, { entries: [...docs.values()].filter((doc) => doc.type === type).map(view) });
      }
      const acl = /^\/id\/([^/]+)\/@acl$/.exec(api);
      if (acl) return send(200, { acl: [{ name: 'local', aces: byUid(acl[1]).acl }] });
      const id = /^\/id\/([^/]+)$/.exec(api);
      if (id && request.method === 'PUT') {
        const doc = byUid(id[1]);
        if (!doc) return send(404, {});
        Object.assign(doc.properties, json.properties);
        return send(200, view(doc));
      }
      if (id) return byUid(id[1]) ? send(200, view(byUid(id[1]))) : send(404, {});
      const operation = /^\/automation\/(.+)$/.exec(api)?.[1];
      const input = byUid(String(json?.input ?? '').replace(/^doc:/, ''));
      if (operation === 'Retention.AttachRule') {
        input.isRecord = true;
        return send(200, view(input));
      }
      if (operation === 'Document.Hold') {
        input.hasLegalHold = true;
        return send(200, view(input));
      }
      if (operation === 'Document.AddPermission') {
        for (const user of json.params.users) input.acl.push({ username: user, permission: json.params.permission, granted: true });
        if (json.params.blockInheritance) input.acl.push({ username: 'Everyone', permission: 'Everything', granted: false });
        return send(200, view(input));
      }
      if (operation === 'Event.Fire') return send(204);
      return send(404, { message: `the stand-in has no ${api}` });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, docs, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(url, { env = {}, args = [] } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED, ...args], {
      env: { PATH: process.env.PATH, NUXEO_URL: url, NUXEO_USER: 'admin', NUXEO_PASS: PASSWORD, NUXEO_TIMEOUT_MS: '5000', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolve({ status, output }));
  });
}

const writes = (requests) => requests.filter((each) => each.method !== 'GET');
const filedRequests = (requests) => requests.filter((each) => each.json?.type === 'DispositionRequest' || /DispositionRequest/.test(JSON.stringify(each.json ?? '')));
const custodyRequests = (requests) => requests.filter((each) => /CustodyRequest/.test(JSON.stringify(each.json ?? '')));

// 1. No credentials: refused before anything is asked.
{
  const stub = await standIn();
  const result = await run(stub.url, { env: { NUXEO_USER: '', NUXEO_PASS: '' } });
  check('no credentials: exit 2', result.status === 2, result.output);
  check('no credentials: nothing asked of the server', stub.requests.length === 0);
  stub.server.close();
}

// 2. Not an administrator: refused before any write.
{
  const stub = await standIn({ administrator: false });
  const result = await run(stub.url);
  check('not an administrator: exit 2', result.status === 2, result.output);
  check('not an administrator: nothing written', writes(stub.requests).length === 0);
  stub.server.close();
}

// 3. The records add-on not installed: refused, naming it.
{
  const stub = await standIn({ types: TYPES.filter((type) => !['DispositionRuns', 'CustodyDesk', 'PhysicalLocation', 'PhysicalRecord'].includes(type)) });
  const result = await run(stub.url);
  check('no records add-on: exit 2, naming it', result.status === 2 && result.output.includes('nuxeo-agentic-records'), result.output);
  check('no records add-on: nothing written', writes(stub.requests).length === 0);
  stub.server.close();
}

// 4. A server with the three packages: everything seeded, and no run started.
{
  const stub = await standIn();
  const result = await run(stub.url);
  check('seeded: exit 0', result.status === 0, result.output);
  const records = [...stub.docs.values()].filter((doc) => doc.type === 'RecordsFile');
  check('seeded: every record of data.mjs', records.length === RECORDS.length);
  check('seeded: every record a record of the rule', records.every((doc) => doc.isRecord));
  const held = records.filter((doc) => doc.hasLegalHold).map((doc) => doc.properties['rfile:reference']);
  check('seeded: the record data.mjs marks, and it alone, held', JSON.stringify(held) === JSON.stringify(RECORDS.filter((each) => each.hold).map((each) => each.reference)), held.join(', '));
  const rule = stub.docs.get(`/RetentionRules/${RULE.name}`);
  check('seeded: the rule, with no end action', rule && Array.isArray(rule.properties['retention_def:endActions']) && rule.properties['retention_def:endActions'].length === 0);
  const folder = stub.docs.get('/disposition-runs');
  check('seeded: the disposition runs folder, at the root', folder?.type === 'DispositionRuns');
  for (const { group, permission } of GRANTS)
    check(`seeded: ${permission} for ${group}`, folder.acl.some((ace) => ace.username === group && ace.permission === permission && ace.granted));
  check('seeded: the folder blocks what it would inherit', folder.acl.some((ace) => ace.username === 'Everyone' && ace.permission === 'Everything' && !ace.granted));
  check('seeded: no disposition request filed', filedRequests(stub.requests).length === 0);
  check('seeded: the rule takes physical records too', RULE.docTypes.every((type) => rule.properties['retention_rule:docTypes'].includes(type)));

  // Physical records: the locations, each inside the one before it; the records at their positions.
  const locations = [...stub.docs.values()].filter((doc) => doc.type === 'PhysicalLocation');
  check('seeded: every location of data.mjs', locations.length === LOCATIONS.length);
  const byName = new Map(locations.map((doc) => [doc.path.split('/').pop(), doc]));
  check(
    'seeded: each location inside the one data.mjs puts it in, with its kind',
    LOCATIONS.every((each) => {
      const doc = byName.get(each.name);
      const parent = each.in === null ? '/records-centre' : `/${each.in}`;
      return doc && doc.path.endsWith(`${parent}/${each.name}`) && doc.properties['ploc:kind'] === each.kind;
    }),
  );
  const physical = [...stub.docs.values()].filter((doc) => doc.type === 'PhysicalRecord');
  check('seeded: every physical record of data.mjs', physical.length === PHYSICAL.length);
  check(
    'seeded: each kept at its position, with its kind and what a run is to do with it',
    PHYSICAL.every((each) => {
      const doc = physical.find((candidate) => candidate.path.endsWith(`/${each.name}`));
      return (
        doc &&
        doc.properties['phys:location'] === byName.get(each.at).uid &&
        doc.properties['phys:kind'] === each.kind &&
        doc.properties['phys:dispositionAction'] === each.disposition &&
        (doc.properties['phys:transferTo'] ?? null) === (each.transferTo ?? null)
      );
    }),
  );
  check('seeded: every physical record a record of the rule', physical.every((doc) => doc.isRecord));
  check(
    'seeded: the physical record data.mjs marks, and it alone, held',
    JSON.stringify(physical.filter((doc) => doc.hasLegalHold).map((doc) => doc.path.split('/').pop())) ===
      JSON.stringify(PHYSICAL.filter((each) => each.hold).map((each) => each.name)),
  );
  const desk = stub.docs.get('/custody-desk');
  check('seeded: the custody desk, at the root', desk?.type === 'CustodyDesk');
  for (const { group, permission } of CUSTODY_GRANTS)
    check(`seeded: ${permission} for ${group} on the desk`, desk.acl.some((ace) => ace.username === group && ace.permission === permission && ace.granted));
  check('seeded: the desk blocks what it would inherit', desk.acl.some((ace) => ace.username === 'Everyone' && ace.permission === 'Everything' && !ace.granted));
  check('seeded: no custody request filed', custodyRequests(stub.requests).length === 0);
  check('seeded: no check fired without --end-retention-now', !stub.requests.some((each) => each.path.endsWith('/Event.Fire')));
  check('seeded: every request to the server named, and only it', stub.requests.every((each) => each.authorization?.startsWith('Basic ')));
  check('seeded: the password never printed', !result.output.includes(PASSWORD));

  // 5. Run again: nothing added, nothing attached, held or granted twice.
  const before = writes(stub.requests).length;
  const again = await run(stub.url);
  check('again: exit 0', again.status === 0, again.output);
  check('again: nothing written', writes(stub.requests).length === before, `${writes(stub.requests).length - before} write(s)`);
  stub.server.close();
}

// 5b. A rule the seed made before physical records: given their type, once, and nothing else changed.
{
  const stub = await standIn();
  stub.docs.set(`/RetentionRules/${RULE.name}`, { uid: 'uid-rule', path: `/RetentionRules/${RULE.name}`, type: 'RetentionRule', properties: { 'retention_def:endActions': [], 'retention_rule:docTypes': ['RecordsFile'] }, acl: [] });
  const result = await run(stub.url);
  const puts = stub.requests.filter((each) => each.method === 'PUT');
  check('an older rule: exit 0', result.status === 0, result.output);
  check('an older rule: given PhysicalRecord, once', puts.length === 1 && JSON.stringify(puts[0].json.properties['retention_rule:docTypes']) === JSON.stringify(['RecordsFile', 'PhysicalRecord']));
  check('an older rule: nothing of it but its types written', Object.keys(puts[0]?.json?.properties ?? {}).join() === 'retention_rule:docTypes');
  stub.server.close();
}

// 5c. A records add-on before physical records: refused, naming its version.
{
  const stub = await standIn({ types: TYPES.filter((type) => type !== 'CustodyDesk') });
  const result = await run(stub.url);
  check('an add-on without physical records: exit 2, naming 0.3.0', result.status === 2 && result.output.includes('0.3.0'), result.output);
  check('an add-on without physical records: nothing written', writes(stub.requests).length === 0);
  stub.server.close();
}

// 5d. A custody desk elsewhere: the seed makes no second one.
{
  const stub = await standIn();
  stub.docs.set('/other-desk', { uid: 'uid-desk', path: '/other-desk', type: 'CustodyDesk', properties: {}, acl: [] });
  const result = await run(stub.url);
  check('a desk elsewhere: exit 1, naming it', result.status === 1 && result.output.includes('/other-desk'), result.output);
  check('a desk elsewhere: no second one', [...stub.docs.values()].filter((doc) => doc.type === 'CustodyDesk').length === 1);
  stub.server.close();
}

// 6. A disposition runs folder elsewhere: the seed makes no second one.
{
  const stub = await standIn();
  stub.docs.set('/elsewhere', { uid: 'uid-elsewhere', path: '/elsewhere', type: 'DispositionRuns', properties: {}, acl: [] });
  const result = await run(stub.url);
  check('a folder elsewhere: exit 1, naming it', result.status === 1 && result.output.includes('/elsewhere'), result.output);
  check('a folder elsewhere: no second one', [...stub.docs.values()].filter((doc) => doc.type === 'DispositionRuns').length === 1);
  stub.server.close();
}

// 7. A rule of the seed's name with an end action: stopped before any record is attached to it.
{
  const stub = await standIn();
  stub.docs.set(`/RetentionRules/${RULE.name}`, { uid: 'uid-rule', path: `/RetentionRules/${RULE.name}`, type: 'RetentionRule', properties: { 'retention_def:endActions': ['Document.Delete'] }, acl: [] });
  const result = await run(stub.url);
  check('a rule that deletes its records: exit 1', result.status === 1 && result.output.includes('end action'), result.output);
  check('a rule that deletes its records: nothing attached to it', !stub.requests.some((each) => each.path.endsWith('/Retention.AttachRule')));
  stub.server.close();
}

// 8. --end-retention-now: the platform's own check, fired once the minute has passed.
{
  const stub = await standIn();
  const result = await run(stub.url, { args: ['--end-retention-now'], env: { RECORDS_DEMO_WAIT_MS: '0' } });
  const fired = stub.requests.filter((each) => each.path.endsWith('/Event.Fire'));
  check('--end-retention-now: exit 0', result.status === 0, result.output);
  check('--end-retention-now: findRetentionExpired fired once', fired.length === 1 && fired[0].json?.params?.name === 'findRetentionExpired');
  stub.server.close();
}

console.log(failures === 0 ? '\nEvery control passed.' : `\n${failures} control(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
