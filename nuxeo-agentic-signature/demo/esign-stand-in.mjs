#!/usr/bin/env node
/**
 * A stand-in e-signature service, so that the e-signature step runs offline with no vendor chosen
 * (decision H). **It signs nothing:** a "signed" file is the file it was sent with a line of text
 * after the PDF's end, and its evidence is a JSON file saying what happened. Everything it holds is
 * fictional, and in memory only.
 *
 *   STANDIN_API_KEY=<key> STANDIN_CALLBACK_SECRET=<secret> \
 *     node nuxeo-agentic-signature/demo/esign-stand-in.mjs [--port 8092] [--host 127.0.0.1]
 *
 *   STANDIN_API_KEY=<key> node nuxeo-agentic-signature/demo/esign-stand-in.mjs sign <envelope>
 *   STANDIN_API_KEY=<key> node nuxeo-agentic-signature/demo/esign-stand-in.mjs decline <envelope> [reason]
 *
 * It speaks as the add-on's stand-in provider (`StandInProvider`) expects:
 *
 * - `POST /envelopes` takes a file and its signers, and answers `201 { id, status: "sent" }`;
 * - `GET /envelopes/<id>/result` answers a signed envelope's file and evidence, each in Base64,
 *   the file with its SHA-256; `409` until it is signed;
 * - `DELETE /envelopes/<id>` voids one;
 * - `POST /envelopes/<id>/sign` and `/decline` are the demo's signer: each marks the envelope and
 *   posts the callback to Nuxeo, `NUXEO_CALLBACK_URL`, signed as the provider checks it:
 *   `X-StandIn-Signature: t=<unix seconds>,v1=<hex of HMAC-SHA256(secret, "<t>.<body>")>`.
 *
 * - **The API key and the secret are required,** with no default: the Nuxeo server holds the same
 *   two, in its own settings. Make them up for the demo, `openssl rand -hex 32`, never a real one.
 *   Every request must carry `Authorization: Bearer <the key>`, compared in constant time, or it is
 *   answered 401. The secret is 32 characters at least, as the provider requires.
 * - It listens on 127.0.0.1 unless `--host` says otherwise. A Nuxeo in Docker Desktop reaches it at
 *   `http://host.docker.internal:<port>`, and it reaches Nuxeo at `NUXEO_CALLBACK_URL`, by default
 *   `http://localhost:8080/nuxeo/agentic-signature/callback/standin`.
 * - It logs each request's method, path and status, and each callback's id and Nuxeo's answer:
 *   never the key, the secret, a signature, a signer's address or a file.
 */
import { createServer as createHttpServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SIGNATURE_HEADER = 'x-standin-signature';
export const MIN_SECRET = 32;
export const MAX_BODY = 16 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The hex HMAC-SHA256 of `<t>.<body>` under the secret: what a callback's signature is. */
export function sign(secret, time, body) {
  return createHmac('sha256', secret).update(`${time}.`).update(body).digest('hex');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Whether two texts are the same, in time that does not depend on where they differ. */
function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * The service, not started: `apiKey`, `secret`, `callbackUrl`, and for the selftest a `log`, a
 * clock `now` (milliseconds) and the `post` callbacks are sent with.
 */
export function createServer({
  apiKey,
  secret,
  callbackUrl,
  log = console.log,
  now = Date.now,
  post = postJson,
}) {
  if (!apiKey || !apiKey.trim()) throw new Error('STANDIN_API_KEY is required');
  if (!secret || secret.length < MIN_SECRET)
    throw new Error(`STANDIN_CALLBACK_SECRET is required, ${MIN_SECRET} characters at least`);
  const envelopes = new Map();

  async function callback(envelope, type, reason) {
    const event = {
      id: `evt_${randomBytes(9).toString('hex')}`,
      type,
      envelope: envelope.id,
      occurredAt: new Date(now()).toISOString(),
      ...(reason ? { reason } : {}),
    };
    const body = Buffer.from(JSON.stringify(event));
    const time = Math.floor(now() / 1000);
    const status = await post(callbackUrl, body, {
      'Content-Type': 'application/json',
      'X-StandIn-Signature': `t=${time},v1=${sign(secret, String(time), body)}`,
    });
    log(`callback ${event.id} (${type}) for ${envelope.id}: Nuxeo answered ${status}`);
    return { event: event.id, status };
  }

  function result(envelope) {
    const completedAt = new Date(envelope.completedAt).toISOString();
    const signed = Buffer.concat([
      envelope.content,
      Buffer.from(
        `\n% Signed by the stand-in e-signature service, envelope ${envelope.id}, ${completedAt}. Not a signature.\n`,
      ),
    ]);
    const evidence = Buffer.from(
      JSON.stringify(
        {
          service: 'Stand-in e-signature service: fictional, it signs nothing',
          envelope: envelope.id,
          reference: envelope.reference,
          subject: envelope.subject,
          completedAt,
          originalSha256: envelope.sha256,
          signedSha256: sha256(signed),
          signers: envelope.signers.map((signer) => ({ ...signer, signedAt: completedAt })),
        },
        null,
        2,
      ),
    );
    return {
      envelope: envelope.id,
      status: 'signed',
      document: {
        fileName: envelope.fileName,
        mimeType: envelope.mimeType,
        sha256: sha256(signed),
        content: signed.toString('base64'),
      },
      evidence: {
        fileName: `${envelope.id}-evidence.json`,
        mimeType: 'application/json',
        content: evidence.toString('base64'),
      },
    };
  }

  async function handle(request, response, body) {
    const { method } = request;
    const path = new URL(request.url, 'http://stand-in').pathname;
    const answer = (status, json) => {
      const text = json === undefined ? '' : JSON.stringify(json);
      response.writeHead(status, json === undefined ? {} : { 'Content-Type': 'application/json' });
      response.end(text);
      log(`${method} ${path} ${status}`);
    };
    if (!same(request.headers['authorization'] ?? '', `Bearer ${apiKey}`))
      return answer(401, { error: 'unauthorized' });
    if (body === null) return answer(413, { error: 'too large' });
    if (method === 'POST' && path === '/envelopes') {
      let sent;
      try {
        sent = JSON.parse(body.toString('utf8'));
      } catch {
        return answer(400, { error: 'not JSON' });
      }
      const document = sent?.document ?? {};
      const signers = Array.isArray(sent?.signers) ? sent.signers : [];
      const content =
        typeof document.content === 'string'
          ? Buffer.from(document.content, 'base64')
          : Buffer.alloc(0);
      if (
        content.length === 0 ||
        content.length > MAX_FILE ||
        document.sha256 !== sha256(content) ||
        signers.length < 1 ||
        signers.length > 10 ||
        !signers.every(
          (s) => typeof s?.name === 'string' && s.name.trim() && EMAIL.test(String(s?.email ?? '')),
        )
      )
        return answer(400, { error: 'not an envelope this service takes' });
      const id = `env_${randomBytes(9).toString('hex')}`;
      envelopes.set(id, {
        id,
        reference: String(sent.reference ?? ''),
        subject: String(sent.subject ?? ''),
        fileName: String(document.fileName ?? 'document.pdf'),
        mimeType: String(document.mimeType ?? 'application/pdf'),
        sha256: document.sha256,
        content,
        signers: signers.map(({ name, email }) => ({ name, email })),
        status: 'sent',
        completedAt: null,
      });
      log(`envelope ${id} created: ${signers.length} signer(s), ${content.length} bytes`);
      return answer(201, { id, status: 'sent' });
    }
    const match = /^\/envelopes\/([^/]+)(?:\/(result|sign|decline))?$/.exec(path);
    if (!match || !ID.test(match[1])) return answer(404, { error: 'not found' });
    const envelope = envelopes.get(match[1]);
    if (!envelope) return answer(404, { error: 'not found' });
    const action = match[2];
    if (method === 'GET' && action === undefined)
      return answer(200, { id: envelope.id, status: envelope.status, subject: envelope.subject });
    if (method === 'GET' && action === 'result')
      return envelope.status === 'signed'
        ? answer(200, result(envelope))
        : answer(409, { error: envelope.status });
    if (method === 'DELETE' && action === undefined) {
      if (envelope.status !== 'sent') return answer(409, { error: envelope.status });
      envelope.status = 'voided';
      return answer(204);
    }
    if (method === 'POST' && (action === 'sign' || action === 'decline')) {
      if (envelope.status !== 'sent') return answer(409, { error: envelope.status });
      let reason;
      if (action === 'decline') {
        try {
          reason = body.length ? JSON.parse(body.toString('utf8'))?.reason : undefined;
        } catch {
          reason = undefined;
        }
      }
      envelope.status = action === 'sign' ? 'signed' : 'declined';
      envelope.completedAt = now();
      const sent = await callback(
        envelope,
        `envelope.${envelope.status}`,
        typeof reason === 'string' ? reason : undefined,
      );
      return answer(200, { envelope: envelope.id, status: envelope.status, callback: sent });
    }
    return answer(405, { error: 'method not allowed' });
  }

  return createHttpServer((request, response) => {
    const chunks = [];
    let size = 0;
    let over = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) over = true;
      else chunks.push(chunk);
    });
    request.on('end', () => {
      handle(request, response, over ? null : Buffer.concat(chunks)).catch((error) => {
        log(`${request.method} failed: ${error?.name ?? 'error'}`);
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end('{"error":"failed"}');
      });
    });
  });
}

/** POST a body, answer the status, or 0 when nothing answered. Never follows a redirect. */
async function postJson(url, body, headers) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------ the command line

async function main(args) {
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
  };
  const port = Number(option('--port', '8092'));
  const host = option('--host', '127.0.0.1');
  const apiKey = process.env['STANDIN_API_KEY'] ?? '';
  if (!apiKey.trim()) {
    console.error(
      'STANDIN_API_KEY is required: the key the Nuxeo server sends. Make one up for the demo.',
    );
    process.exit(2);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port ${option('--port', '')} is not a port`);
    process.exit(2);
  }
  if (args[0] === 'sign' || args[0] === 'decline') {
    const envelope = args[1];
    if (!envelope || !ID.test(envelope)) {
      console.error(`Name the envelope: ${args[0]} <envelope id>, such as env_0123abcd`);
      process.exit(2);
    }
    const url = `http://${host}:${port}/envelopes/${envelope}/${args[0]}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        args[0] === 'decline' && args[2] ? { reason: args.slice(2).join(' ') } : {},
      ),
      redirect: 'manual',
    }).catch(() => null);
    if (!response) {
      console.error(`The stand-in service does not answer on ${host}:${port}: start it first.`);
      process.exit(1);
    }
    const text = await response.text();
    console.log(`${args[0]} ${envelope}: HTTP ${response.status} ${text}`);
    process.exit(response.ok ? 0 : 1);
  }
  const secret = process.env['STANDIN_CALLBACK_SECRET'] ?? '';
  if (secret.length < MIN_SECRET) {
    console.error(
      `STANDIN_CALLBACK_SECRET is required, ${MIN_SECRET} characters at least: the secret the Nuxeo server checks callbacks with.`,
    );
    process.exit(2);
  }
  const callbackUrl =
    process.env['NUXEO_CALLBACK_URL'] ||
    'http://localhost:8080/nuxeo/agentic-signature/callback/standin';
  const server = createServer({ apiKey, secret, callbackUrl });
  server.listen(port, host, () => {
    const { port: bound } = server.address();
    console.log(
      `The stand-in e-signature service answers on http://${host}:${bound}/envelopes, and calls back ${callbackUrl}`,
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
