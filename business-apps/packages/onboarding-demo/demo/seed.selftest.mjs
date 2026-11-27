#!/usr/bin/env node
/**
 * The onboarding kit seed's controls, against a stand-in for the parts of Nuxeo's REST API it
 * calls, on the loopback interface. No Nuxeo, no install, no credential of anyone's.
 *
 *   node business-apps/packages/onboarding-demo/demo/seed.selftest.mjs
 *
 * Each control runs the seed as a command and checks what it asked the stand-in and what it said.
 * The seed must create no user and no group, and send nothing for signature: no signature request,
 * no sigreq: or sgn: property.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASES,
  DISPUTES,
  GRANTS,
  OPEN_CASE_STATUSES,
  OPEN_DISPUTE_STATUSES,
  agreementName,
} from './data.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const PASSWORD = 'not-a-real-password-for-the-stand-in';
let failures = 0;
let controls = 0;

function check(name, ok, detail = '') {
  controls++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures++;
}

const TYPES = [
  'OnboardingCase',
  'ESignatureRequest',
  'OnboardingRegister',
  'DisputeRegister',
  'DisputeCase',
  // The records add-on's, which the preflight looks for.
  'DispositionRequest',
];

/**
 * A stand-in Nuxeo: documents by path, ACLs, uploads, the two page providers, and every request
 * kept. `hide` leaves a record's number out of its page provider, as an index that never caught up.
 */
function standIn({
  administrator = true,
  types = TYPES,
  facets = ['Signable', 'Record'],
  hide = null,
  me = undefined,
} = {}) {
  const docs = new Map();
  const requests = [];
  const uploads = new Map();
  let next = 1;
  const add = (path, type, properties = {}) => {
    const doc = {
      'entity-type': 'document',
      uid: `uid-${next++}`,
      path,
      type,
      properties: { ...properties },
      acl: [],
      isTrashed: false,
    };
    docs.set(path, doc);
    return doc;
  };
  add('/default-domain/workspaces', 'WorkspaceRoot');
  const byUid = (uid) => [...docs.values()].find((doc) => doc.uid === uid);
  const view = (doc) => ({ ...doc, acl: undefined });
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://stand-in');
      const isJson = (request.headers['content-type'] ?? '').startsWith('application/json');
      const json = isJson && raw.length ? JSON.parse(raw.toString('utf8')) : null;
      requests.push({
        method: request.method,
        path: url.pathname,
        json,
        headers: request.headers,
        bytes: isJson ? null : raw,
      });
      const send = (status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(value === undefined ? '' : JSON.stringify(value));
      };
      const api = url.pathname.replace(/^\/nuxeo\/api\/v1/, '');
      if (
        request.headers.authorization !==
        `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}`
      )
        return send(401, { message: 'no' });
      if (api === '/me')
        return send(
          200,
          me ?? { 'entity-type': 'user', id: 'admin', isAdministrator: administrator },
        );
      if (api.startsWith('/config/types/'))
        return types.includes(api.slice(14)) ? send(200, { name: api.slice(14) }) : send(404, {});
      if (api.startsWith('/config/facets/'))
        return facets.includes(api.slice(15)) ? send(200, { name: api.slice(15) }) : send(404, {});
      if (api.startsWith('/path')) {
        const path = decodeURIComponent(api.slice(5));
        if (request.method === 'GET')
          return docs.has(path) ? send(200, view(docs.get(path))) : send(404, {});
        if (!docs.has(path)) return send(404, {});
        return send(
          201,
          view(add(`${path === '/' ? '' : path}/${json.name}`, json.type, json.properties)),
        );
      }
      if (api === '/upload/new/default' && request.method === 'POST') {
        const batchId = `batch${next++}`;
        uploads.set(batchId, null);
        return send(201, { batchId });
      }
      const upload = /^\/upload\/([^/]+)\/0$/.exec(api);
      if (upload && request.method === 'POST') {
        uploads.set(upload[1], {
          name: decodeURIComponent(request.headers['x-file-name']),
          type: request.headers['x-file-type'],
          bytes: raw,
        });
        return send(201, { uploaded: 'true' });
      }
      const acl = /^\/id\/([^/]+)\/@acl$/.exec(api);
      if (acl) return send(200, { acl: [{ name: 'local', aces: byUid(acl[1]).acl }] });
      const id = /^\/id\/([^/]+)$/.exec(api);
      if (id) {
        const doc = byUid(id[1]);
        if (!doc) return send(404, {});
        if (request.method === 'PUT') {
          const properties = { ...json.properties };
          if (Array.isArray(properties['files:files']))
            properties['files:files'] = properties['files:files'].map((entry) => {
              const file = uploads.get(entry.file?.['upload-batch']);
              return {
                file: { name: file?.name, 'mime-type': file?.type, length: file?.bytes.length },
              };
            });
          Object.assign(doc.properties, properties);
        }
        return send(200, view(doc));
      }
      const pp = /^\/search\/pp\/([^/]+)\/execute$/.exec(api);
      if (pp) {
        const [type, prefix, open] =
          pp[1] === 'onboarding_open_cases'
            ? ['OnboardingCase', 'onb', OPEN_CASE_STATUSES]
            : pp[1] === 'onboarding_open_disputes'
              ? ['DisputeCase', 'dsp', OPEN_DISPUTE_STATUSES]
              : [null];
        if (!type) return send(404, {});
        const entries = [...docs.values()].filter(
          (doc) =>
            doc.type === type &&
            open.includes(doc.properties[`${prefix}:status`]) &&
            doc.properties[`${prefix}:number`] !== hide,
        );
        return send(200, { entries: entries.map(view), resultsCount: entries.length });
      }
      const operation = /^\/automation\/(.+)$/.exec(api)?.[1];
      const input = byUid(String(json?.input ?? '').replace(/^doc:/, ''));
      if (operation === 'Document.AddPermission') {
        for (const user of json.params.users)
          input.acl.push({ username: user, permission: json.params.permission, granted: true });
        return send(200, view(input));
      }
      if (operation === 'Document.Untrash') {
        input.isTrashed = false;
        return send(200, view(input));
      }
      return send(404, { message: `the stand-in has no ${api}` });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        docs,
        requests,
        uploads,
        url: `http://127.0.0.1:${server.address().port}`,
      }),
    ),
  );
}

function run(url, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], {
      env: {
        PATH: process.env.PATH,
        NUXEO_URL: url,
        NUXEO_USER: 'admin',
        NUXEO_PASS: PASSWORD,
        NUXEO_TIMEOUT_MS: '5000',
        NUXEO_INDEX_WAIT_MS: '1000',
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolve({ status, output }));
  });
}

const writes = (requests) => requests.filter((each) => each.method !== 'GET');
const byType = (stub, type) => [...stub.docs.values()].filter((doc) => doc.type === type);
const caseAt = (stub, number) =>
  stub.docs.get(`/default-domain/workspaces/onboarding-demo/onboarding/${number.toLowerCase()}`);

// 1. No credentials: refused before anything is asked.
{
  const stub = await standIn();
  const result = await run(stub.url, { env: { NUXEO_USER: '', NUXEO_PASS: '' } });
  check(
    'no credentials: exit 2, and nothing asked',
    result.status === 2 && stub.requests.length === 0,
    result.output,
  );
  stub.server.close();
}

// 2. Not an administrator: refused before any write.
{
  const stub = await standIn({ administrator: false });
  const result = await run(stub.url);
  check(
    'not an administrator: exit 2, and nothing written',
    result.status === 2 && writes(stub.requests).length === 0,
    result.output,
  );
  stub.server.close();
}

// 3. /me answering something that is not a user: a precondition.
{
  const stub = await standIn({ me: { isAdministrator: true } });
  const result = await run(stub.url);
  check(
    'a /me that is not a user: exit 2, and nothing written',
    result.status === 2 && writes(stub.requests).length === 0,
    result.output,
  );
  stub.server.close();
}

// 4, 5. The add-on, or the kit, not installed: refused before any write, naming what to install.
{
  const stub = await standIn({ facets: [] });
  const result = await run(stub.url);
  check(
    'the e-signature add-on missing: exit 2, nothing written, and it is named',
    result.status === 2 &&
      writes(stub.requests).length === 0 &&
      /nuxeo-agentic-signature/.test(result.output),
    result.output,
  );
  stub.server.close();
}
{
  const stub = await standIn({ facets: ['Signable'] });
  const result = await run(stub.url);
  check(
    'the retention module missing: exit 2, nothing written, and it is named',
    result.status === 2 &&
      writes(stub.requests).length === 0 &&
      /nuxeo-retention/.test(result.output),
    result.output,
  );
  stub.server.close();
}
{
  const stub = await standIn({ types: TYPES.filter((type) => type !== 'DispositionRequest') });
  const result = await run(stub.url);
  check(
    'the records add-on missing: exit 2, nothing written, and it is named',
    result.status === 2 &&
      writes(stub.requests).length === 0 &&
      /nuxeo-agentic-records/.test(result.output),
    result.output,
  );
  stub.server.close();
}
{
  const stub = await standIn({ types: TYPES.filter((type) => type !== 'ESignatureRequest') });
  const result = await run(stub.url);
  check(
    'the kit missing: exit 2, and nothing written',
    result.status === 2 && writes(stub.requests).length === 0,
    result.output,
  );
  stub.server.close();
}
{
  const stub = await standIn({ types: TYPES.filter((type) => type !== 'DisputeCase') });
  const result = await run(stub.url);
  check(
    'the dispute type missing: exit 2, before anything is written',
    result.status === 2 && writes(stub.requests).length === 0,
    result.output,
  );
  stub.server.close();
}

// 6 to 13. A first run, then a second.
{
  const stub = await standIn();
  const first = await run(stub.url);
  check('a first run exits 0', first.status === 0, first.output);
  check(
    'it writes the workspace, two registers, every case and every dispute',
    byType(stub, 'Workspace').length === 1 &&
      byType(stub, 'OnboardingRegister').length === 1 &&
      byType(stub, 'DisputeRegister').length === 1 &&
      byType(stub, 'OnboardingCase').length === CASES.length &&
      byType(stub, 'DisputeCase').length === DISPUTES.length,
  );
  const register = (name) => stub.docs.get(`/default-domain/workspaces/onboarding-demo/${name}`);
  check(
    "it grants each of the kit's groups its permission on its register",
    GRANTS.every(({ register: name, group, permission }) =>
      register(name).acl.some((ace) => ace.username === group && ace.permission === permission),
    ),
  );
  const disputeAt = (number) =>
    stub.docs.get(`/default-domain/workspaces/onboarding-demo/disputes/${number.toLowerCase()}`);
  check(
    'it gives a dispute raised on a case that case by its id, and the others none',
    DISPUTES.every((dispute) =>
      dispute.case
        ? disputeAt(dispute.number).properties['dsp:case'] === caseAt(stub, dispute.case).uid
        : disputeAt(dispute.number).properties['dsp:case'] === null,
    ) && DISPUTES.some((dispute) => dispute.case),
  );
  const agreements = CASES.map((kase) => caseAt(stub, kase.number).properties['files:files'] ?? []);
  const uploaded = [...stub.uploads.values()].filter(Boolean);
  check(
    "it attaches each case's agreement, a PDF of its name",
    agreements.every(
      (files, i) => files.length === 1 && files[0].file.name === agreementName(CASES[i].number),
    ) &&
      uploaded.length === CASES.length &&
      uploaded.every(
        (file) =>
          file.bytes.subarray(0, 5).toString('latin1') === '%PDF-' &&
          file.type === 'application/pdf',
      ),
  );
  check(
    "it writes each case's checklist as data.mjs has it, a day for each tick",
    CASES.every((kase) => {
      const written = caseAt(stub, kase.number).properties['kyc:checklist'];
      return (
        written.length === kase.checklist.length &&
        written.every(
          (entry, i) =>
            entry.item === kase.checklist[i].item &&
            entry.done === true &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.doneOn),
        )
      );
    }),
  );
  const everything = JSON.stringify(writes(stub.requests).map((each) => [each.path, each.json]));
  check(
    'it creates no user and no group, and sends nothing for signature',
    !stub.requests.some((each) => /\/(user|group)(\/|$)/.test(each.path)) &&
      !/sigreq:|sgn:|ESignatureRequest/.test(everything) &&
      byType(stub, 'ESignatureRequest').length === 0,
  );
  check(
    'it never prints the Basic header or the password',
    !first.output.includes('Basic ') && !first.output.includes(PASSWORD),
  );

  // People tick the checklist; the second run must keep their ticks and the attachments.
  const ticked = [{ item: 'identity', done: true, doneBy: 'someone.else', doneOn: '2026-11-26' }];
  caseAt(stub, 'ONB-1002').properties['kyc:checklist'] = ticked;
  caseAt(stub, 'ONB-1002').properties['onb:status'] = 'Approved';
  const before = stub.requests.length;
  const second = await run(stub.url);
  const again = stub.requests.slice(before);
  check(
    'a second run creates nothing, uploads nothing, and grants nothing again',
    second.status === 0 &&
      !again.some(
        (each) =>
          each.method === 'POST' &&
          (each.path.includes('/path') ||
            each.path.includes('/upload') ||
            each.path.includes('AddPermission')),
      ),
    second.output,
  );
  check(
    "a second run keeps the people's ticks, and writes the data's values over the rest",
    JSON.stringify(caseAt(stub, 'ONB-1002').properties['kyc:checklist']) ===
      JSON.stringify(ticked) &&
      caseAt(stub, 'ONB-1002').properties['onb:status'] === 'Open' &&
      !again.some(
        (each) => each.method === 'PUT' && each.json?.properties?.['kyc:checklist'] !== undefined,
      ),
  );
  stub.server.close();
}

// 14. A case with attachments of its own, none the agreement: left as it is.
{
  const stub = await standIn();
  await run(stub.url);
  const kase = caseAt(stub, 'ONB-1001');
  kase.properties['files:files'] = [{ file: { name: 'passport-scan.pdf' } }];
  const second = await run(stub.url);
  check(
    "a case's own attachments are never written over",
    second.status === 0 &&
      kase.properties['files:files'].length === 1 &&
      kase.properties['files:files'][0].file.name === 'passport-scan.pdf' &&
      /left\s+ONB-1001's attachments/.test(second.output),
    second.output,
  );
  stub.server.close();
}

// 15. A place holding a document of another type: left alone, and the run stops.
{
  const stub = await standIn();
  const workspace = '/default-domain/workspaces/onboarding-demo';
  stub.docs.set(workspace, {
    'entity-type': 'document',
    uid: 'uid-other',
    path: workspace,
    type: 'Folder',
    properties: {},
    acl: [],
  });
  const result = await run(stub.url);
  check(
    'a place of another type stops the run, with nothing written in it',
    result.status === 1 &&
      /is a Folder, not a Workspace/.test(result.output) &&
      byType(stub, 'OnboardingCase').length === 0,
    result.output,
  );
  stub.server.close();
}

// 16. The index never lists a seeded open case: the check fails, naming it.
{
  const stub = await standIn({ hide: 'ONB-1004' });
  const result = await run(stub.url);
  check(
    'a seeded open case the queue never lists fails the run, by its number',
    result.status === 1 &&
      /onboarding_open_cases does not list what was seeded: missing ONB-1004/.test(result.output),
    result.output,
  );
  stub.server.close();
}

console.log(`\n${controls - failures} of ${controls} passed`);
process.exit(failures === 0 ? 0 : 1);
