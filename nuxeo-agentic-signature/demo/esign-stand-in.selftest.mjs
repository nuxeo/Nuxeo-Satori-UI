#!/usr/bin/env node
/**
 * Controls for the stand-in e-signature service, `esign-stand-in.mjs`: it starts the service on a
 * free port, with a fake Nuxeo to call back, and checks what the demo and the add-on's stand-in
 * provider rely on. Needs nothing but Node 24.
 *
 *   node nuxeo-agentic-signature/demo/esign-stand-in.selftest.mjs
 *
 * Its negative controls: starting with no key or a short secret, a request with no key or another,
 * an envelope whose digest is not its file's, a body past the bound, a result before signing, and
 * signing a voided envelope. One control holds the service's signing to the vector the add-on's
 * Java test holds the provider to, computed with OpenSSL, so the two implementations agree.
 */
import { createServer as createHttpServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer, sign, MAX_BODY } from './esign-stand-in.mjs';

const SCRIPT = join(import.meta.dirname, 'esign-stand-in.mjs');
const API_KEY = 'selftest-fictional-api-key-0123456789';
const SECRET = 'test-callback-secret-0123456789abcdef-0123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);

// 1, 2. It does not start without its key, or with a secret too short to be one.
const bare = spawnSync(process.execPath, [SCRIPT, '--port', '0'], {
  env: { ...process.env, STANDIN_API_KEY: '', STANDIN_CALLBACK_SECRET: SECRET },
  encoding: 'utf8',
  timeout: 5_000,
});
check(
  'refuses to start without STANDIN_API_KEY',
  bare.status === 2 && /STANDIN_API_KEY is required/.test(bare.stderr),
  `exit ${bare.status}`,
);
const short = spawnSync(process.execPath, [SCRIPT, '--port', '0'], {
  env: { ...process.env, STANDIN_API_KEY: API_KEY, STANDIN_CALLBACK_SECRET: 'too-short' },
  encoding: 'utf8',
  timeout: 5_000,
});
check(
  'refuses to start with a secret under 32 characters',
  short.status === 2 && /32 characters/.test(short.stderr),
  `exit ${short.status}`,
);

// 3. The signature is the add-on's: the vector its Java test holds StandInProvider to.
check(
  'signs as the add-on checks: the OpenSSL vector',
  sign(
    SECRET,
    '1790000000',
    Buffer.from('{"id":"evt_1","type":"envelope.signed","envelope":"env_1"}'),
  ) === '43027280a4fd060c6233a9b1f34dfa7a0871d6ec529236dbbb579579c829771c',
);

// A fake Nuxeo, which keeps each callback, and answers 503 to as many as `unavailable` says.
const callbacks = [];
let unavailable = 0;
const nuxeo = createHttpServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    callbacks.push({ headers: request.headers, body: Buffer.concat(chunks), path: request.url });
    const down = unavailable > 0;
    if (down) unavailable--;
    response.writeHead(down ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(down ? '{"error":"unavailable"}' : '{"status":"received"}');
  });
});
await new Promise((resolve) => nuxeo.listen(0, '127.0.0.1', resolve));
const callbackUrl = `http://127.0.0.1:${nuxeo.address().port}/nuxeo/agentic-signature/callback/standin`;

const logged = [];
const service = createServer({
  apiKey: API_KEY,
  secret: SECRET,
  callbackUrl,
  log: (line) => logged.push(line),
  retryDelays: [20, 20],
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${service.address().port}`;
const call = async (method, path, { key = API_KEY, json, raw } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: raw ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
};
const envelope = (content = PDF, digest = sha256(content)) => ({
  reference: 'ref-1',
  subject: 'Account agreement',
  message: 'Please sign.',
  signers: [{ name: 'Rowan Vale', email: 'rowan.vale@example.com' }],
  document: {
    fileName: 'agreement.pdf',
    mimeType: 'application/pdf',
    sha256: digest,
    content: content.toString('base64'),
  },
});

try {
  // 4, 5. The key, compared: none, or another, is 401.
  check(
    'refuses a request with no key',
    (await call('POST', '/envelopes', { key: '', json: envelope() })).status === 401,
  );
  check(
    'refuses a request with another key',
    (await call('POST', '/envelopes', { key: `${API_KEY}x`, json: envelope() })).status === 401,
  );

  // 6. An envelope whose digest is not its file's.
  check(
    "refuses an envelope whose SHA-256 is not its file's",
    (await call('POST', '/envelopes', { json: envelope(PDF, sha256(Buffer.from('x'))) })).status ===
      400,
  );

  // 7. Past the bound, unread.
  const huge = (await call('POST', '/envelopes', { raw: Buffer.alloc(MAX_BODY + 1, 32) })).status;
  check('refuses a body past 16 MiB', huge === 413, `HTTP ${huge}`);

  // 8. Sent.
  const sent = await call('POST', '/envelopes', { json: envelope() });
  const id = sent.json?.id;
  check(
    'takes an envelope: 201, and an id the provider takes',
    sent.status === 201 && /^env_[0-9a-f]{18}$/.test(id ?? ''),
    JSON.stringify(sent),
  );

  // 9. No result before it is signed.
  check(
    'answers 409 for a result before it is signed',
    (await call('GET', `/envelopes/${id}/result`)).status === 409,
  );

  // 10. Signed: the callback, signed as the provider checks it.
  const before = Math.floor(Date.now() / 1000);
  const signing = await call('POST', `/envelopes/${id}/sign`);
  const callback = callbacks.at(-1);
  const header = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(callback?.headers['x-standin-signature'] ?? '');
  const event = callback ? JSON.parse(callback.body.toString('utf8')) : {};
  check(
    'signing posts a callback signed with the secret over its time and body',
    signing.status === 200 &&
      header !== null &&
      header[2] ===
        createHmac('sha256', SECRET).update(`${header[1]}.`).update(callback.body).digest('hex') &&
      Number(header[1]) >= before &&
      Number(header[1]) <= before + 5 &&
      event.type === 'envelope.signed' &&
      event.envelope === id &&
      /^evt_[0-9a-f]{18}$/.test(event.id) &&
      callback.path === '/nuxeo/agentic-signature/callback/standin',
    JSON.stringify({ signing, event }),
  );

  // 11. The result: the file, longer than the one sent and starting with it, its digest, and the evidence.
  const result = await call('GET', `/envelopes/${id}/result`);
  const signed = Buffer.from(result.json?.document?.content ?? '', 'base64');
  const evidence = JSON.parse(
    Buffer.from(result.json?.evidence?.content ?? '', 'base64').toString('utf8') || '{}',
  );
  check(
    'gives the signed file with its SHA-256, and evidence naming both files',
    result.status === 200 &&
      result.json.status === 'signed' &&
      result.json.envelope === id &&
      signed.length > PDF.length &&
      signed.subarray(0, PDF.length).equals(PDF) &&
      result.json.document.sha256 === sha256(signed) &&
      evidence.originalSha256 === sha256(PDF) &&
      evidence.signedSha256 === sha256(signed) &&
      evidence.signers?.[0]?.name === 'Rowan Vale',
    JSON.stringify(result.json?.document?.sha256),
  );

  // 12. Declined, with the reason.
  const other = (await call('POST', '/envelopes', { json: envelope() })).json.id;
  await call('POST', `/envelopes/${other}/decline`, { json: { reason: 'The address is wrong' } });
  const declined = JSON.parse(callbacks.at(-1).body.toString('utf8'));
  check(
    'declining posts a declined callback with the reason',
    declined.type === 'envelope.declined' &&
      declined.envelope === other &&
      declined.reason === 'The address is wrong',
  );

  // 13. Voided, then not signable.
  const third = (await call('POST', '/envelopes', { json: envelope() })).json.id;
  const voided = (await call('DELETE', `/envelopes/${third}`)).status;
  const late = (await call('POST', `/envelopes/${third}/sign`)).status;
  check(
    'voids an envelope, which is not signed after',
    voided === 204 && late === 409,
    `${voided}, ${late}`,
  );

  // 14. Retried: Nuxeo unavailable at first, the same event posted again until it answers 2xx.
  const fourth = (await call('POST', '/envelopes', { json: envelope() })).json.id;
  unavailable = 1;
  const before14 = callbacks.length;
  await call('POST', `/envelopes/${fourth}/sign`);
  for (let i = 0; i < 50 && callbacks.length < before14 + 2; i++)
    await new Promise((r) => setTimeout(r, 20));
  const attempts = callbacks.slice(before14).map((c) => JSON.parse(c.body.toString('utf8')));
  check(
    'retries a callback Nuxeo did not take, the same event',
    attempts.length === 2 && attempts[0].id === attempts[1].id && attempts[0].envelope === fourth,
    JSON.stringify(attempts),
  );

  // 15. Resent: the same event, signed anew with the secret; forged: one the secret does not sign.
  const before15 = callbacks.length;
  await call('POST', `/envelopes/${fourth}/resend`);
  await call('POST', `/envelopes/${fourth}/forge`);
  const [resent, forged] = callbacks.slice(before15);
  const verifies = (c) => {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(c?.headers['x-standin-signature'] ?? '');
    return (
      m !== null &&
      m[2] === createHmac('sha256', SECRET).update(`${m[1]}.`).update(c.body).digest('hex')
    );
  };
  check(
    'resend posts the same event signed with the secret; forge posts it signed otherwise',
    resent !== undefined &&
      forged !== undefined &&
      JSON.parse(resent.body.toString('utf8')).id === attempts[0].id &&
      verifies(resent) &&
      !verifies(forged) &&
      forged.body.equals(resent.body),
  );

  // 16. Nothing logged holds the key, the secret, a signature, an address or a file.
  const signatures = callbacks.map((c) => c.headers['x-standin-signature']);
  const leaks = logged.filter((line) =>
    [API_KEY, SECRET, 'rowan.vale@example.com', '%PDF', ...signatures].some((secret) =>
      line.includes(secret),
    ),
  );
  check(
    'logs no key, secret, signature, address or file',
    logged.length > 5 && leaks.length === 0,
    leaks.join(' | '),
  );
} finally {
  service.close();
  nuxeo.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
