#!/usr/bin/env node
/**
 * Controls for `mail-in.mjs` and `letters.mjs`, run against a stand-in for the parts of the Nuxeo
 * REST API the script calls:
 *
 *   node business-apps/packages/pc-claims-demo/demo/mail-in.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here:
 * `/me`, a type's definition, documents by path and by id, a batch upload, and an item whose
 * `capt:status` turns from received to what the test says after a number of reads, as the capture
 * add-on's background capture would. A pass proves the script's logic: each precondition, before
 * anything is written; the inbox created once, and another type's place left alone; each letter's
 * bytes uploaded as they are, and created with its file and nothing of `capt:`; the wait, and its
 * end; the credentials never printed; and the committed letters being what `letters.mjs` writes. It
 * says nothing of a real server, or of how the add-on classifies them: the add-on's own tests read
 * these letters with the stand-in provider and the kit's profile (`KitLetterTest`).
 *
 * Node 24 and nothing else. CI does not run it. Exit 0 when every control behaves as required.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'mail-in.mjs');
const ROOT = '/default-domain/workspaces/pc-claims-demo';
const LETTERS = ['claim-letter-pc-24003.pdf', 'claim-letter-unclear.pdf'];

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition) failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in. `types` it has; `seeded` whether the kit's workspace is there; `inboxType` the type
 * of a document already at the inbox's place, or none; `capturedAfter` how many reads an item stays
 * received, `Infinity` for one never captured; `meStatus` what `/me` answers.
 */
function standIn({
  user,
  password,
  types = ['PropertyClaimInbox', 'PropertyClaimMail'],
  seeded = true,
  inboxType = null,
  capturedAfter = 1,
  meStatus = 200,
}) {
  const byPath = new Map();
  const byId = new Map();
  const writes = [];
  const uploads = new Map();
  const asked = [];
  const add = (path, type, properties = {}) => {
    const doc = { 'entity-type': 'document', uid: randomUUID(), path, type, properties: { ...properties }, reads: 0 };
    byPath.set(path, doc);
    byId.set(doc.uid, doc);
    return doc;
  };
  add('/default-domain/workspaces', 'WorkspaceRoot');
  if (seeded) add(ROOT, 'Workspace');
  if (inboxType) add(`${ROOT}/inbox`, inboxType);
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const answer = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const strip = ({ reads, ...doc }) => doc;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      asked.push(`${req.method} ${req.url}`);
      if (req.headers.authorization !== expected) return answer(res, 401, { message: 'no' });
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname.replace(/^\/nuxeo\/api\/v1/, ''));
      if (req.method === 'GET' && path === '/me')
        return meStatus === 200 ? answer(res, 200, { id: user }) : answer(res, meStatus, {});
      if (req.method === 'GET' && path.startsWith('/config/types/'))
        return types.includes(path.slice('/config/types/'.length)) ? answer(res, 200, {}) : answer(res, 404, {});
      if (req.method === 'GET' && path.startsWith('/path/')) {
        const doc = byPath.get(path.slice('/path'.length));
        return doc ? answer(res, 200, strip(doc)) : answer(res, 404, {});
      }
      if (req.method === 'GET' && path.startsWith('/id/')) {
        const doc = byId.get(path.slice('/id/'.length));
        if (!doc) return answer(res, 404, {});
        if (doc.type === 'PropertyClaimMail') {
          doc.reads++;
          if (doc.reads > capturedAfter) {
            doc.properties['capt:status'] = 'filed';
            doc.properties['capt:outcome'] = 'automatic';
            doc.properties['capt:proposedClass'] = 'claimLetter';
            doc.properties['capt:confidence'] = 0.97;
            doc.properties['capt:record'] = 'claim-uid';
          }
        }
        return answer(res, 200, strip(doc));
      }
      if (req.method === 'POST' && path === '/upload/') {
        const batchId = `batch${uploads.size}`;
        uploads.set(batchId, null);
        return answer(res, 201, { batchId });
      }
      const upload = /^\/upload\/([A-Za-z0-9_-]+)\/0$/.exec(path);
      if (req.method === 'POST' && upload) {
        uploads.set(upload[1], { bytes: body, name: decodeURIComponent(req.headers['x-file-name']), type: req.headers['x-file-type'] });
        writes.push({ kind: 'upload', batch: upload[1] });
        return answer(res, 201, { uploaded: 'true' });
      }
      if (req.method === 'POST' && (path.startsWith('/path/') || path.startsWith('/id/'))) {
        const parent = path.startsWith('/path/') ? byPath.get(path.slice('/path'.length)) : byId.get(path.slice('/id/'.length));
        if (!parent) return answer(res, 404, {});
        const json = JSON.parse(body.toString('utf8'));
        let name = json.name;
        while (byPath.has(`${parent.path}/${name}`)) name = `${name}.1`;
        const properties = { ...json.properties };
        if (json.type === 'PropertyClaimMail') properties['capt:status'] = 'received';
        const doc = add(`${parent.path}/${name}`, json.type, properties);
        writes.push({ kind: 'create', type: json.type, parent: parent.path, properties: json.properties });
        return answer(res, 201, strip(doc));
      }
      return answer(res, 404, {});
    });
  });
  return { server, writes, uploads, asked };
}

async function run(options, { env = {}, args = [] } = {}) {
  const user = 'mailroom';
  const password = `pw-${randomUUID()}`;
  const stub = standIn({ user, password, ...options });
  await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  const { port } = stub.server.address();
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    env: {
      PATH: process.env['PATH'],
      NUXEO_URL: `http://127.0.0.1:${port}`,
      NUXEO_USER: user,
      NUXEO_PASS: password,
      NUXEO_CAPTURE_WAIT_MS: '1500',
      ...env,
    },
  });
  let output = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (output += c));
  const code = await new Promise((resolve) => child.on('close', resolve));
  stub.server.close();
  const basic = Buffer.from(`${user}:${password}`).toString('base64');
  return { code, output, ...stub, password, basic };
}

// 1. No credentials: exit 2, nothing asked.
{
  const r = await run({}, { env: { NUXEO_USER: '' } });
  expect(r.code === 2, 'no credentials: exit 2', r.output);
  expect(r.asked.length === 0, 'no credentials: nothing asked of the server', r.asked.join('\n'));
}
// 2. Credentials refused.
{
  const r = await run({ meStatus: 401 });
  expect(r.code === 2 && /401/.test(r.output), 'credentials refused: exit 2, said so', r.output);
}
// 3. The add-on or the kit not installed.
for (const missing of ['PropertyClaimInbox', 'PropertyClaimMail']) {
  const r = await run({ types: ['PropertyClaimInbox', 'PropertyClaimMail'].filter((t) => t !== missing) });
  expect(r.code === 2 && r.output.includes(missing), `no ${missing} type: exit 2, said so`, r.output);
  expect(r.writes.length === 0, `no ${missing} type: nothing written`);
}
// 4. Not seeded.
{
  const r = await run({ seeded: false });
  expect(r.code === 2 && /seed/.test(r.output), 'not seeded: exit 2, said so', r.output);
  expect(r.writes.length === 0, 'not seeded: nothing written');
}
// 5. The inbox created, then each letter uploaded as it is and created with its file only.
{
  const r = await run({});
  expect(r.code === 0, 'a run: exit 0', r.output);
  const creates = r.writes.filter((w) => w.kind === 'create');
  expect(creates[0]?.type === 'PropertyClaimInbox' && creates[0]?.parent === ROOT, 'the inbox created in the workspace', r.output);
  const items = creates.filter((w) => w.type === 'PropertyClaimMail');
  expect(items.length === 2 && items.every((w) => w.parent === `${ROOT}/inbox`), 'both letters created in the inbox', JSON.stringify(creates));
  expect(
    items.every((w) => Object.keys(w.properties).sort().join() === 'dc:title,file:content'),
    'a letter is created with its title and file, and nothing of capt:',
    JSON.stringify(items),
  );
  const uploaded = [...r.uploads.values()];
  expect(
    LETTERS.every((name, i) => uploaded[i]?.name === name && uploaded[i]?.type === 'application/pdf'
      && uploaded[i]?.bytes.equals(readFileSync(join(HERE, name)))),
    'each letter uploaded byte for byte, as a PDF',
  );
  expect(/filed automatic, as claimLetter, 97%/.test(r.output), 'what the capture made of it, printed', r.output);
  expect(!r.output.includes(r.password) && !r.output.includes(r.basic), 'a run prints neither the password nor its header');
}
// 6. An inbox already there is used; another type's place is left alone.
{
  const r = await run({ inboxType: 'PropertyClaimInbox' });
  expect(r.code === 0 && !r.writes.some((w) => w.type === 'PropertyClaimInbox'), 'an inbox there is used, not created again', r.output);
  const other = await run({ inboxType: 'Folder' });
  expect(other.code === 1 && /left alone/.test(other.output), 'another type at the inbox: exit 1, said so', other.output);
  expect(!other.writes.some((w) => w.kind === 'create'), 'another type at the inbox: nothing created');
}
// 7. An item never captured: the wait ends, exit 1, said so.
{
  const r = await run({ capturedAfter: Infinity });
  expect(r.code === 1 && /not captured within 1500 ms/.test(r.output), 'never captured: exit 1, said so', r.output);
}
// 8. The committed letters are what letters.mjs writes.
{
  const child = spawn(process.execPath, [join(HERE, 'letters.mjs'), '--check']);
  let output = '';
  child.stderr.on('data', (c) => (output += c));
  const code = await new Promise((resolve) => child.on('close', resolve));
  expect(code === 0, 'the committed letters are what letters.mjs writes', output);
  for (const name of LETTERS) {
    const text = readFileSync(join(HERE, name), 'latin1');
    expect(text.startsWith('%PDF-1.4\n') && text.endsWith('%%EOF\n'), `${name} is a PDF`);
    expect(text.includes('A fictional letter'), `${name} says it is fictional`);
  }
}

console.log(`${controls - failures.length} of ${controls} controls passed.`);
for (const failure of failures) console.log(`FAILED: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
