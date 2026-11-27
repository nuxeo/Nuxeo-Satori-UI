#!/usr/bin/env node
/**
 * Demo step 3's intake: puts the kit's fictional letters into the claims mail inbox, as a scanner
 * or a mail gateway would, through the REST API, and says what the capture add-on made of each.
 *
 *   export NUXEO_USER=<a user who may add to the inbox> NUXEO_PASS=<password>
 *   node business-apps/packages/pc-claims-demo/demo/mail-in.mjs [letter.pdf ...]
 *
 * With no file named, the two letters beside this script (`letters.mjs` writes them). Each is
 * uploaded to a batch, then created in `/default-domain/workspaces/pc-claims-demo/inbox` as a
 * `PropertyClaimMail` with its file, and nothing else: no `capt:` property, which the server and
 * then a person set. The inbox is created, a `PropertyClaimInbox`, when it is not there. Then each
 * item is read again until the server has captured it, up to `NUXEO_CAPTURE_WAIT_MS` (30 seconds
 * by default), and its status, its reason, its class and its confidence are printed, with the claim
 * it was filed on or the item to confirm.
 *
 * It needs the kit 0.2.0 and `nuxeo-agentic-capture` installed, the kit seeded (`seed.mjs`), and a
 * provider configured on the server (the add-on's README): with none, every letter waits for a
 * person, which this script says. Node 24 and nothing else. `NUXEO_USER` and `NUXEO_PASS` have no
 * default, and are never printed. `NUXEO_URL` defaults to `http://localhost:8080`, `APP_URL` to
 * `http://localhost:4200`.
 *
 * Exit 0 when every letter was captured, filed or waiting; 1 when one was not captured in time or
 * the server refused a write; 2 when a precondition is not met, before anything is written.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACE } from './data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const CAPTURE_WAIT_MS = Number(process.env['NUXEO_CAPTURE_WAIT_MS']) || 30_000;
const POLL_MS = Math.min(1_000, CAPTURE_WAIT_MS);
const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
const INBOX = { name: 'inbox', title: 'Claims mail inbox', type: 'PropertyClaimInbox' };
const ITEM_TYPE = 'PropertyClaimMail';
const LETTERS = ['claim-letter-pc-24003.pdf', 'claim-letter-unclear.pdf'];

class Precondition extends Error {}
class HttpError extends Error {
  constructor(method, path, status) {
    super(`${method} ${path} answered HTTP ${status}`);
    this.status = status;
  }
}

const username = process.env['NUXEO_USER'];
const password = process.env['NUXEO_PASS'];
if (!username || !password) {
  console.error('NUXEO_USER and NUXEO_PASS are required: a user who may add to the inbox.');
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : LETTERS.map((f) => join(HERE, f));

try {
  process.exit(await mailIn());
} catch (error) {
  if (error instanceof Precondition) {
    console.error(error.message);
    process.exit(EXIT_PRECONDITION);
  }
  console.error(error instanceof HttpError ? error.message : String(error?.message ?? error));
  process.exit(1);
}

async function mailIn() {
  const letters = files.map((path) => {
    try {
      return { path, name: basename(path), bytes: readFileSync(path) };
    } catch {
      throw new Precondition(`${path} cannot be read.`);
    }
  });
  await preflight();
  const inbox = await ensureInbox();
  let late = 0;
  for (const letter of letters) {
    const item = await put(inbox, letter);
    const captured = await captureOf(item.uid);
    if (captured === null) {
      late++;
      console.log(`  ${letter.name}: not captured within ${CAPTURE_WAIT_MS} ms; it is in the inbox, received.`);
      continue;
    }
    report(letter.name, captured);
  }
  console.log(`\nMail to confirm: ${APP}/#/queues/mail-to-confirm`);
  return late === 0 ? 0 : 1;
}

/** The server answers, the user is signed in, the kit and the add-on are installed, the kit seeded. */
async function preflight() {
  let me;
  try {
    me = await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError)
      throw new Precondition(
        error.status === 401
          ? `${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`
          : `${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`,
      );
    throw new Precondition(`${SERVER} could not be reached: is NUXEO_URL a Nuxeo server's address?`);
  }
  if (typeof me?.id !== 'string' || me.id === '')
    throw new Precondition(`${SERVER} answered GET /me with no user.`);
  for (const type of [INBOX.type, ITEM_TYPE])
    if ((await find(`/config/types/${type}`)) === null)
      throw new Precondition(
        `${SERVER} has no ${type} type: install nuxeo-agentic-capture 0.1.0 and pc-claims-demo 0.2.0 first.`,
      );
  if ((await find(`/path${ROOT}`)) === null)
    throw new Precondition(`${SERVER} has no ${ROOT}: seed the kit first (demo/seed.mjs).`);
}

/** The inbox: created when it is not there; a place of its name holding another type is left alone. */
async function ensureInbox() {
  const path = `${ROOT}/${INBOX.name}`;
  const existing = await find(`/path${path}`);
  if (existing === null) {
    const created = await call('POST', `/path${ROOT}`, {
      json: { 'entity-type': 'document', name: INBOX.name, type: INBOX.type, properties: { 'dc:title': INBOX.title } },
    });
    console.log(`  created  ${path}`);
    return created;
  }
  if (existing.type !== INBOX.type)
    throw new Error(`${path} is a ${existing.type}, not a ${INBOX.type}: it is left alone.`);
  return existing;
}

/** One letter: uploaded, then created in the inbox with its file, and nothing of capt:. */
async function put(inbox, letter) {
  const batch = await call('POST', '/upload/');
  if (typeof batch?.batchId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(batch.batchId))
    throw new Error('The server answered the upload with no batch.');
  await call('POST', `/upload/${batch.batchId}/0`, {
    body: letter.bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(letter.name),
      'X-File-Type': 'application/pdf',
    },
  });
  const title = letter.name.replace(/\.pdf$/i, '');
  const item = await call('POST', `/id/${inbox.uid}`, {
    json: {
      'entity-type': 'document',
      name: title,
      type: ITEM_TYPE,
      properties: {
        'dc:title': title,
        'file:content': { 'upload-batch': batch.batchId, 'upload-fileId': '0' },
      },
    },
  });
  console.log(`  mailed   ${letter.name}`);
  return item;
}

/** The item once the server has captured it, or `null` when it is still received at the deadline. */
async function captureOf(uid) {
  const deadline = Date.now() + CAPTURE_WAIT_MS;
  for (;;) {
    const item = await call('GET', `/id/${uid}`, { headers: { properties: '*' } });
    const status = item?.properties?.['capt:status'];
    if (status && status !== 'received') return item;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function report(name, item) {
  const p = item.properties;
  const confidence =
    typeof p['capt:confidence'] === 'number' ? `${Math.round(p['capt:confidence'] * 100)}%` : 'none';
  const what = p['capt:proposedClass'] ?? 'no class';
  if (p['capt:status'] === 'filed')
    console.log(
      `  ${name}: filed ${p['capt:outcome']}, as ${what}, ${confidence}, on ${APP}/#/doc/${p['capt:record']}`,
    );
  else
    console.log(
      `  ${name}: ${p['capt:status']}, ${p['capt:reason'] ?? 'no reason'}, as ${what}, ${confidence}; ` +
        `to confirm: ${APP}/#/doc/${item.uid}`,
    );
}

async function find(path) {
  try {
    return await call('GET', path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function call(method, path, { json, body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: AUTHORIZATION,
      Accept: 'application/json',
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(method, path, response.status);
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}
