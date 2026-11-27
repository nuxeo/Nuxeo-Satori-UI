#!/usr/bin/env node
/**
 * A stand-in receiver for Nuxeo's outbound webhooks, so that the webhooks demo runs offline: it
 * takes each delivery at `POST /nuxeo-webhooks`, checks it as any receiver should, and logs what it
 * was about.
 *
 *   WEBHOOK_SECRET=<the webhook's secret> node nuxeo-agentic-connectors/demo/webhook-receiver.mjs \
 *     [--port 8092] [--host 127.0.0.1] [--webhook payers.claimUpdates] [--answer 204]
 *
 * - **The secret is required,** at least 32 characters, the one the server sets in
 *   `nuxeo.agentic.webhooks.<id>.secret`. There is no default. Make one up for the demo, such as
 *   `openssl rand -hex 32`, and never reuse a real one.
 * - **Each delivery is checked as `nuxeo-agentic-connectors/README.md` says a receiver checks it,**
 *   in the same scheme as the change events Nuxeo takes (`change-event.mjs`): `X-Nuxeo-Webhook` is
 *   the webhook's id; `X-Nuxeo-Connector-Timestamp` within 300 seconds of this clock;
 *   `X-Nuxeo-Connector-Nonce` not seen in that time; `X-Nuxeo-Connector-Signature`, `sha256=` and
 *   the HMAC-SHA256, keyed with the secret, of the id, the timestamp and the nonce, each followed
 *   by a line feed, then the body as sent, compared in constant time. Any of them wrong is 401, with
 *   no body; a body over 64 KiB is 413; a signed body that is not a delivery is 400.
 * - **A delivery seen before** (its `delivery` id) is answered 204 again, and not taken twice: a
 *   retry or a resend after an answer that did not reach Nuxeo.
 * - **`--answer <status>`** answers every delivery that passes its checks with that status instead,
 *   such as 503 to see Nuxeo retry and then keep a dead letter, without taking it.
 * - It listens on 127.0.0.1 unless `--host` says otherwise. A Nuxeo in Docker Desktop reaches it at
 *   `http://host.docker.internal:<port>`, a private address: the server must set the webhook's
 *   `private.allowed` and, for plain http, `http.allowed`.
 *
 * Each request is logged with its status and, for a delivery taken, its id, event, document and the
 * names of its fields: never their values, the secret, the signature or the nonce.
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import {
  MIN_SECRET_LENGTH,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signChangeEvent,
} from './change-event.mjs';

const WEBHOOK_HEADER = 'X-Nuxeo-Webhook';
const WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;
const PATH = '/nuxeo-webhooks';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};

const port = Number(option('--port', '8092'));
const host = option('--host', '127.0.0.1');
const webhook = option('--webhook', 'payers.claimUpdates');
const answerStatus = Number(option('--answer', '204'));
const secret = process.env['WEBHOOK_SECRET'] ?? '';

if (secret.length < MIN_SECRET_LENGTH) {
  console.error(
    `WEBHOOK_SECRET is required, at least ${MIN_SECRET_LENGTH} characters: the webhook's secret on the server.`,
  );
  process.exit(2);
}
if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(webhook)) {
  console.error("--webhook must be the webhook's id, as the server registers it");
  process.exit(2);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port ${option('--port', '')} is not a port`);
  process.exit(2);
}
if (!Number.isInteger(answerStatus) || answerStatus < 200 || answerStatus > 599) {
  console.error(`--answer ${option('--answer', '')} is not an HTTP status`);
  process.exit(2);
}

/** Each nonce seen, until its timestamp could no longer be taken. */
const nonces = new Map();
/** Each delivery taken. */
const taken = new Set();

const header = (request, name) => {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
};

/** Why a delivery is refused, or null when it is Nuxeo's, fresh and unseen. */
function refusal(request, body, nowSeconds) {
  if (header(request, WEBHOOK_HEADER) !== webhook) return 'not-this-webhook';
  const timestamp = header(request, TIMESTAMP_HEADER);
  if (!/^[0-9]{1,12}$/.test(timestamp)) return 'no-timestamp';
  if (Math.abs(nowSeconds - Number(timestamp)) > WINDOW_SECONDS) return 'stale';
  const nonce = header(request, NONCE_HEADER);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return 'no-nonce';
  const given = Buffer.from(header(request, SIGNATURE_HEADER), 'utf8');
  const expected = Buffer.from(signChangeEvent(secret, webhook, timestamp, nonce, body), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad-signature';
  for (const [seen, until] of nonces) {
    if (until < nowSeconds) nonces.delete(seen);
  }
  if (nonces.has(nonce)) return 'replayed';
  nonces.set(nonce, Number(timestamp) + WINDOW_SECONDS);
  return null;
}

/** The delivery a signed body is, or null. */
function delivery(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  const ok =
    payload &&
    typeof payload === 'object' &&
    /^[0-9a-f]{32}$/.test(payload.delivery ?? '') &&
    typeof payload.event === 'string' &&
    typeof payload.document?.id === 'string' &&
    typeof payload.document?.type === 'string' &&
    payload.fields &&
    typeof payload.fields === 'object' &&
    !Array.isArray(payload.fields);
  return ok ? payload : null;
}

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const done = (status, note = '') => {
    console.log(`${request.method} ${path} ${status}${note ? ` ${note}` : ''}`);
    response.writeHead(status, { 'Cache-Control': 'no-store' });
    response.end();
  };
  if (path !== PATH) return done(404);
  if (request.method !== 'POST') return done(405);
  const chunks = [];
  let size = 0;
  let refused = false;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      if (!refused) {
        // Answered at once; the rest is read and dropped, not kept.
        refused = true;
        chunks.length = 0;
        done(413);
      }
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (refused) return;
    const body = Buffer.concat(chunks);
    const why = refusal(request, body, Math.floor(Date.now() / 1000));
    if (why) return done(401, why);
    const payload = delivery(body);
    if (!payload) return done(400, 'not-a-delivery');
    const about = `${payload.event} of a ${payload.document.type} ${payload.document.id} [${Object.keys(payload.fields).join(',')}]`;
    if (answerStatus !== 204 && answerStatus !== 200) {
      return done(answerStatus, `answered ${payload.delivery} ${about}`);
    }
    if (taken.has(payload.delivery)) return done(204, `duplicate ${payload.delivery}`);
    taken.add(payload.delivery);
    return done(204, `accepted ${payload.delivery} ${about}`);
  });
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(
    `The stand-in receiver takes webhook ${webhook} on http://${address.address}:${address.port}${PATH}`,
  );
});
