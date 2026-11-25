#!/usr/bin/env node
/**
 * A stand-in core claims system, so that the connectors demo runs offline: one record per claim
 * of the Payers kit's seed, by its number, at `GET /claims/<number>`. **Everything here is
 * fictional:** the payments, the references, the policies and the bank accounts.
 *
 *   CORE_SYSTEM_TOKEN=<any text> node nuxeo-agentic-connectors/demo/core-system.mjs [--port 8091] [--host 127.0.0.1]
 *
 * - **A token is required.** `CORE_SYSTEM_TOKEN` must be set, and every request must carry
 *   `Authorization: Bearer <it>`, or it is answered 401. There is no default, so the demo shows the
 *   connector's credential coming from the server's own configuration. Make one up for the demo,
 *   such as `openssl rand -hex 16`, and never reuse a real one.
 * - **Each record has more than the connector may return:** `adjusterNotes` and `bankAccount` are
 *   not on the demo connector's allow-list, so the record page never shows them.
 * - **Three numbers answer otherwise,** to show the card's other states: `CLAIM-000143` answers after
 *   8 seconds, past the connector's 5-second timeout; `CLAIM-000144` answers 503; any number not
 *   below answers 404, so the card says nothing was found.
 * - It listens on 127.0.0.1 unless `--host` says otherwise. A Nuxeo in Docker Desktop reaches it at
 *   `http://host.docker.internal:<port>`; on Linux, start the container with
 *   `--add-host=host.docker.internal:host-gateway` and this with `--host 0.0.0.0`.
 *
 * Each request is logged with its method, path and status, never its token.
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const port = Number(option('--port', '8091'));
const host = option('--host', '127.0.0.1');
const token = process.env['CORE_SYSTEM_TOKEN'] ?? '';
if (!token.trim()) {
  console.error(
    'CORE_SYSTEM_TOKEN is required: the token the connector must send. Make one up for the demo.',
  );
  process.exit(2);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port ${option('--port', '')} is not a port`);
  process.exit(2);
}

/** A claim's payment and policy, as a core claims system might answer. */
const record = (number, payment, policy) => ({
  claimNumber: number,
  payment,
  policy,
  adjusterNotes: 'Internal note, not on the allow-list: the record page never shows it.',
  bankAccount: { holder: 'Fictional Provider LLC', iban: 'FICTIONAL-ACCOUNT-0001' },
});

const RECORDS = new Map(
  [
    record(
      'CLAIM-000130',
      { status: 'Paid', amount: 412.5, paidOn: '2026-10-02', reference: 'EFT-FICT-55120' },
      { number: 'POL-FICT-0048', status: 'In force', deductibleMet: true },
    ),
    record(
      'CLAIM-000131',
      { status: 'Pending', amount: 0, paidOn: null, reference: null },
      { number: 'POL-FICT-0048', status: 'In force', deductibleMet: true },
    ),
    record(
      'CLAIM-000132',
      { status: 'Paid', amount: 86.2, paidOn: '2026-11-14', reference: 'EFT-FICT-55871' },
      { number: 'POL-FICT-0049', status: 'In force', deductibleMet: false },
    ),
    record(
      'CLAIM-000140',
      { status: 'Denied', amount: 0, paidOn: null, reference: null },
      { number: 'POL-FICT-0051', status: 'Lapsed', deductibleMet: false },
    ),
    record(
      'CLAIM-000141',
      { status: 'Partially paid', amount: 1200, paidOn: '2026-11-20', reference: 'CHK-FICT-30412' },
      { number: 'POL-FICT-0052', status: 'In force', deductibleMet: true },
    ),
    record(
      'CLAIM-000142',
      { status: 'Scheduled', amount: 640, paidOn: '2026-12-01', reference: 'EFT-FICT-56002' },
      { number: 'POL-FICT-0052', status: 'In force', deductibleMet: true },
    ),
  ].map((each) => [each.claimNumber, each]),
);
const SLOW = 'CLAIM-000143';
const FAILING = 'CLAIM-000144';

const authorised = (header) => {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(typeof header === 'string' ? header : '');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const server = createServer((request, response) => {
  const answer = (status, body) => {
    console.log(`${request.method} ${path} ${status}`);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const path = (request.url ?? '/').split('?')[0];
  if (request.method !== 'GET') return answer(405, { error: 'GET only' });
  if (!authorised(request.headers['authorization'])) return answer(401, { error: 'unauthorised' });
  const match = /^\/claims\/([A-Za-z0-9._-]{1,128})$/.exec(path);
  if (!match) return answer(404, { error: 'no such resource' });
  const number = match[1];
  if (number === FAILING) return answer(503, { error: 'the core system is down for this demo' });
  if (number === SLOW) {
    setTimeout(() => answer(200, record(SLOW, { status: 'Paid' }, {})), 8_000);
    return;
  }
  const found = RECORDS.get(number);
  return found ? answer(200, found) : answer(404, { error: 'no such claim' });
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(
    `The stand-in core system answers on http://${address.address}:${address.port}/claims/<number>`,
  );
});
