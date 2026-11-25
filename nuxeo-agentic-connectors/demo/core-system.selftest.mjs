#!/usr/bin/env node
/**
 * Controls for the stand-in core system, `core-system.mjs`: it starts it on a free port and checks
 * what the demo relies on. Needs nothing but Node 24.
 *
 *   node nuxeo-agentic-connectors/demo/core-system.selftest.mjs
 *
 * Five of its ten controls are negative: starting with no token, a request with none, a wrong
 * token, a number it does not have, and a method other than GET.
 */
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

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

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
