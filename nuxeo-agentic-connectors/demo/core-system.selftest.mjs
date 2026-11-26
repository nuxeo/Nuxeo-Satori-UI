#!/usr/bin/env node
/**
 * Controls for the stand-in core system, `core-system.mjs`: it starts it on a free port and checks
 * what the demo relies on. Needs nothing but Node 24.
 *
 *   node nuxeo-agentic-connectors/demo/core-system.selftest.mjs
 *
 * Eight of its sixteen controls are negative: starting with no token, a request with none, a wrong
 * token, a number it does not have, a method other than GET, and `notify` with no events secret,
 * with one too short, and with a key that is not one path segment. The change events' controls
 * hold `notify` to the vector `ChangeEventsTest.java` holds the add-on to, and check what it sends
 * against a signature computed here, apart from `change-event.mjs`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { signChangeEvent } from './change-event.mjs';

const STUB = join(import.meta.dirname, 'core-system.mjs');
const TOKEN = 'selftest-fictional-token';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
};

// 1. No token, no system.
const bare = spawnSync(process.execPath, [STUB, '--port', '0'], {
  env: { ...process.env, CORE_SYSTEM_TOKEN: '' },
  encoding: 'utf8',
  timeout: 5_000,
});
check(
  'refuses to start without CORE_SYSTEM_TOKEN',
  bare.status === 2 && /CORE_SYSTEM_TOKEN is required/.test(bare.stderr),
  `exit ${bare.status}`,
);

const child = spawn(process.execPath, [STUB, '--port', '0'], {
  env: { ...process.env, CORE_SYSTEM_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
const base = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('the stub did not start')), 5_000);
  child.stdout.on('data', (chunk) => {
    log += chunk;
    const match = /answers on (http:\/\/[^/]+)\/claims/.exec(log);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
});

const get = (path, init = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

try {
  const found = await get('/claims/CLAIM-000130');
  const body = await found.json();
  check('serves a seeded claim', found.status === 200 && body.payment?.status === 'Paid');
  check(
    'holds fields the demo connector does not allow',
    typeof body.adjusterNotes === 'string' && typeof body.bankAccount === 'object',
  );
  check('answers JSON', (found.headers.get('content-type') ?? '').startsWith('application/json'));
  check('a number it does not have is 404', (await get('/claims/CLAIM-999999')).status === 404);
  check(
    'CLAIM-000144 is 503, for the error state',
    (await get('/claims/CLAIM-000144')).status === 503,
  );
  check(
    'a request without the token is 401',
    (await fetch(`${base}/claims/CLAIM-000130`)).status === 401,
  );
  check(
    'a wrong token is 401',
    (await get('/claims/CLAIM-000130', { headers: { Authorization: 'Bearer wrong' } })).status ===
      401,
  );
  check('only GET', (await get('/claims/CLAIM-000130', { method: 'POST' })).status === 405);
  check('its log never holds the token', !log.includes(TOKEN));
} finally {
  child.kill();
}

// The change events. The vector: a secret derived from a phrase, signed with openssl, as in
// ChangeEventsTest.theSignatureIsTheDocumentedHmac.
const derived = createHash('sha256')
  .update('nuxeo-agentic-connectors change event test vector')
  .digest('hex');
check(
  "notify signs the vector as the add-on's tests do",
  signChangeEvent(
    derived,
    'payers.claimPayments',
    '1795680000',
    'Vector-nonce-0123456789',
    '{"key":"CLAIM-000130"}',
  ) === 'sha256=e85cd213d24f03096b43f9eb2cdc0dc631a2fcb89d1ef1d118ffe08d8f680056',
);

const notify = (env, ...rest) =>
  spawnSync(process.execPath, [STUB, 'notify', ...rest], {
    env: { ...process.env, CORE_SYSTEM_TOKEN: '', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
const EVENTS_SECRET = randomBytes(32).toString('hex');
const noSecret = notify({ CORE_SYSTEM_EVENTS_SECRET: '' }, 'CLAIM-000130', '--to', 'http://127.0.0.1:9/x');
check(
  'notify refuses to send without CORE_SYSTEM_EVENTS_SECRET',
  noSecret.status === 2 && /CORE_SYSTEM_EVENTS_SECRET is required/.test(noSecret.stderr),
  `exit ${noSecret.status}`,
);
const shortSecret = notify(
  { CORE_SYSTEM_EVENTS_SECRET: EVENTS_SECRET.slice(0, 31) },
  'CLAIM-000130',
  '--to',
  'http://127.0.0.1:9/nuxeo/agentic-connectors/events/payers.claimPayments',
);
check('notify refuses a secret shorter than 32 characters', shortSecret.status === 2, `exit ${shortSecret.status}`);
const badKey = notify(
  { CORE_SYSTEM_EVENTS_SECRET: EVENTS_SECRET },
  '../CLAIM-000130',
  '--to',
  'http://127.0.0.1:9/nuxeo/agentic-connectors/events/payers.claimPayments',
);
check('notify refuses a key that is not one path segment', badKey.status === 2, `exit ${badKey.status}`);

// What notify sends, received by a stand-in for Nuxeo's events address.
const received = [];
const nuxeo = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    received.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.writeHead(204);
    response.end();
  });
});
await new Promise((resolve) => nuxeo.listen(0, '127.0.0.1', resolve));
const events = `http://127.0.0.1:${nuxeo.address().port}/nuxeo/agentic-connectors/events/payers.claimPayments`;
const sending = spawn(process.execPath, [STUB, 'notify', 'CLAIM-000130', '--to', events], {
  env: { ...process.env, CORE_SYSTEM_TOKEN: '', CORE_SYSTEM_EVENTS_SECRET: EVENTS_SECRET },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let said = '';
sending.stdout.on('data', (chunk) => (said += chunk));
sending.stderr.on('data', (chunk) => (said += chunk));
const exit = await new Promise((resolve) => sending.on('close', resolve));
nuxeo.close();
const sent = received[0];
const expected = sent
  ? `sha256=${createHmac('sha256', Buffer.from(EVENTS_SECRET, 'utf8'))
      .update(
        `payers.claimPayments\n${sent.headers['x-nuxeo-connector-timestamp']}\n${sent.headers['x-nuxeo-connector-nonce']}\n${sent.body}`,
      )
      .digest('hex')}`
  : '';
check(
  'notify sends one signed POST that Nuxeo would accept, and exits 0 on 204',
  exit === 0 &&
    received.length === 1 &&
    sent.method === 'POST' &&
    sent.url === '/nuxeo/agentic-connectors/events/payers.claimPayments' &&
    JSON.parse(sent.body).key === 'CLAIM-000130' &&
    sent.headers['x-nuxeo-connector-signature'] === expected &&
    Math.abs(Number(sent.headers['x-nuxeo-connector-timestamp']) - Date.now() / 1000) < 10 &&
    /^[A-Za-z0-9_-]{16,128}$/.test(sent.headers['x-nuxeo-connector-nonce'] ?? ''),
  `exit ${exit}, ${received.length} received`,
);
check(
  'notify never prints the secret or the signature',
  !said.includes(EVENTS_SECRET) &&
    !(sent && said.includes(sent.headers['x-nuxeo-connector-signature'].slice(7))) &&
    !noSecret.stderr.includes(EVENTS_SECRET) &&
    !shortSecret.stderr.includes(EVENTS_SECRET.slice(0, 31)),
);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
