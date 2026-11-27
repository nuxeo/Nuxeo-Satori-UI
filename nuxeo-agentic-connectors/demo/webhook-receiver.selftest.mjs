#!/usr/bin/env node
/**
 * Controls for the stand-in webhook receiver, `webhook-receiver.mjs`: it starts it on a free port
 * and sends it deliveries signed here, with `createHmac`, apart from the receiver's own signer, as
 * the add-on's `WebhookComponent.signed` signs them. Needs nothing but Node 24.
 *
 *   node nuxeo-agentic-connectors/demo/webhook-receiver.selftest.mjs
 *
 * Eleven of its fifteen controls are negative: starting with no secret, with one too short, a
 * wrong signature, a signature for another webhook, a stale timestamp, a replayed nonce, a signed
 * body that is not a delivery, a body too large, a method other than POST, another path, and a log
 * that holds the secret, a signature or a field's value. `WebhookReceiverInteropTest.java` sends it
 * deliveries signed by the add-on itself.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const RECEIVER = join(import.meta.dirname, 'webhook-receiver.mjs');
const WEBHOOK = 'payers.claimUpdates';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
};

const SECRET = randomBytes(32).toString('hex');

const bare = spawnSync(process.execPath, [RECEIVER, '--port', '0'], {
  env: { ...process.env, WEBHOOK_SECRET: '' },
  encoding: 'utf8',
  timeout: 5_000,
});
check(
  'refuses to start without WEBHOOK_SECRET',
  bare.status === 2 && /WEBHOOK_SECRET is required/.test(bare.stderr),
  `exit ${bare.status}`,
);
const short = spawnSync(process.execPath, [RECEIVER, '--port', '0'], {
  env: { ...process.env, WEBHOOK_SECRET: SECRET.slice(0, 31) },
  encoding: 'utf8',
  timeout: 5_000,
});
check('refuses a secret shorter than 32 characters', short.status === 2, `exit ${short.status}`);

/** Starts the receiver, and answers its address and a function that reads its log so far. */
async function start(...extra) {
  const child = spawn(process.execPath, [RECEIVER, '--port', '0', ...extra], {
    env: { ...process.env, WEBHOOK_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the receiver did not start')), 5_000);
    const look = () => {
      const match = /on (http:\/\/[^ ]+\/nuxeo-webhooks)/.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      } else {
        setTimeout(look, 20);
      }
    };
    look();
  });
  return { child, base, log: () => log };
}

const sign = (secret, id, timestamp, nonce, body) =>
  `sha256=${createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${id}\n${timestamp}\n${nonce}\n`, 'utf8')
    .update(body, 'utf8')
    .digest('hex')}`;

const payload = (delivery = randomBytes(16).toString('hex')) =>
  JSON.stringify({
    delivery,
    event: 'modified',
    document: { id: '1f0b7a52-0000-4000-8000-000000000130', type: 'Claim' },
    fields: { claimNumber: 'CLAIM-000130', title: 'Fictional water damage', state: 'approved' },
  });

/** A delivery as Nuxeo sends it, with whatever a control changes. */
async function send(
  base,
  {
    body = payload(),
    id = WEBHOOK,
    secret = SECRET,
    timestamp,
    nonce,
    signature,
    method = 'POST',
    url,
  } = {},
) {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const n = nonce ?? randomBytes(16).toString('hex');
  const headers = {
    'Content-Type': 'application/json',
    'X-Nuxeo-Webhook': WEBHOOK,
    'X-Nuxeo-Connector-Timestamp': ts,
    'X-Nuxeo-Connector-Nonce': n,
    'X-Nuxeo-Connector-Signature': signature ?? sign(secret, id, ts, n, body),
  };
  const response = await fetch(url ?? base, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  });
  return { status: response.status, headers, body };
}

const receiver = await start();
const signatures = [];
try {
  const first = await send(receiver.base);
  signatures.push(first.headers['X-Nuxeo-Connector-Signature']);
  check("takes a delivery signed in the change events' scheme, 204", first.status === 204);
  const again = await send(receiver.base, { body: first.body });
  signatures.push(again.headers['X-Nuxeo-Connector-Signature']);
  check(
    'takes a delivery seen before once only: 204, and logged as a duplicate',
    again.status === 204 && /204 duplicate [0-9a-f]{32}/.test(receiver.log()),
  );
  const replay = await fetch(receiver.base, {
    method: 'POST',
    headers: first.headers,
    body: first.body,
  });
  check('refuses a replayed nonce, 401', replay.status === 401);
  check(
    'refuses a wrong signature, 401',
    (await send(receiver.base, { secret: randomBytes(32).toString('hex') })).status === 401,
  );
  check(
    'refuses a signature for another webhook, 401',
    (await send(receiver.base, { id: 'payers.other' })).status === 401,
  );
  check(
    'refuses a timestamp more than 300 seconds old, 401',
    (await send(receiver.base, { timestamp: String(Math.floor(Date.now() / 1000) - 301) }))
      .status === 401,
  );
  check(
    'refuses a signed body that is not a delivery, 400',
    (await send(receiver.base, { body: '{"key":"CLAIM-000130"}' })).status === 400,
  );
  check(
    'refuses a body over 64 KiB, 413',
    (await send(receiver.base, { body: `{"pad":"${'x'.repeat(70_000)}"}` })).status === 413,
  );
  check('takes POST only, 405', (await send(receiver.base, { method: 'GET' })).status === 405);
  check(
    'answers no other path, 404',
    (await send(receiver.base, { url: receiver.base.replace('/nuxeo-webhooks', '/other') }))
      .status === 404,
  );
  check(
    'logs what a delivery was about: its id, event, document and the names of its fields',
    /POST \/nuxeo-webhooks 204 accepted [0-9a-f]{32} modified of a Claim 1f0b7a52-\S+ \[claimNumber,title,state\]/.test(
      receiver.log(),
    ),
  );
  const log = receiver.log();
  check(
    "its log never holds the secret, a signature or a field's value",
    !log.includes(SECRET) &&
      signatures.every((signature) => !log.includes(signature.slice(7))) &&
      !log.includes('CLAIM-000130') &&
      !log.includes('Fictional water damage'),
  );
} finally {
  receiver.child.kill();
}

const failing = await start('--answer', '503');
try {
  const answered = await send(failing.base);
  check(
    '--answer 503 checks the delivery, then answers 503 without taking it',
    answered.status === 503 && /503 answered [0-9a-f]{32}/.test(failing.log()),
  );
} finally {
  failing.child.kill();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
