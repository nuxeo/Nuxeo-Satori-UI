#!/usr/bin/env node
// @ts-check
/**
 * The spike's demo server: the host page, the sample plugin under several names, the policy and
 * the scenarios, on 127.0.0.1 only.
 *
 *   node tools/plugin-spike/dev/serve.mjs [--port 4410]
 *
 * Then open http://127.0.0.1:4410/. Spike code: no product build serves or bundles any of this.
 *
 * ## What it does on purpose
 *
 * - **Every route is in a fixed table.** Nothing maps a request path onto the filesystem, so no
 *   path can reach a file the table does not name.
 * - **The keys are made at start-up** (`buildDemo`) and die with the process.
 * - **The host page gets a strict Content-Security-Policy**: scripts, styles and requests from
 *   this origin only, no inline script, no string-to-code, no plugins, no `<base>`. The frame page
 *   gets a stricter one with the `sandbox` directive as well, so it is sandboxed even if opened on
 *   its own.
 * - **An HttpOnly, SameSite=Strict session cookie** comes with the host page, as a real sign-in
 *   would set one, so the demo can show a plugin using a session it cannot read.
 * - **`/api/whoami` records** whether each request carried that cookie or an `Authorization`
 *   header, and never sends CORS headers, so an opaque-origin frame cannot read its answer.
 * - **Each load of the host page starts a run,** so two browsers, or a reload, see the same
 *   scenarios: the request counts behind the swapped bundle and the request log start again.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemo } from './demo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The files the server may send, by request path. */
const STATIC = new Map([
  ['/', { file: 'host/index.html', type: 'text/html; charset=utf-8', page: 'host' }],
  ['/host/index.html', { file: 'host/index.html', type: 'text/html; charset=utf-8', page: 'host' }],
  ['/host/host.mjs', { file: 'host/host.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/host/host.css', { file: 'host/host.css', type: 'text/css; charset=utf-8' }],
  [
    '/host/sandbox.html',
    { file: 'host/sandbox.html', type: 'text/html; charset=utf-8', page: 'frame' },
  ],
  [
    '/host/sandbox.mjs',
    { file: 'host/sandbox.mjs', type: 'text/javascript; charset=utf-8', cors: true },
  ],
  [
    '/src/plugin-loader.mjs',
    // The frame's page imports the loader's executor too, from its opaque origin.
    { file: 'src/plugin-loader.mjs', type: 'text/javascript; charset=utf-8', cors: true },
  ],
]);

/**
 * The host page's policy. `'self'` is the whole allow-list for code, which is also its limit: the
 * plugin is served from this origin, so CSP lets it run and cannot tell it from the host's own
 * scripts. What CSP adds is that nothing else runs and nothing is sent anywhere else.
 */
export const HOST_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The frame page's policy, given the server's origin: only the frame's script, the loader it
 * imports and the plugin store may run, and the frame stays sandboxed even when opened directly.
 *
 * @param {string} origin
 * @returns {string}
 */
export function frameCsp(origin) {
  return [
    "default-src 'none'",
    `script-src ${origin}/host/sandbox.mjs ${origin}/src/plugin-loader.mjs ${origin}/plugins/`,
    `connect-src ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    `frame-ancestors ${origin}`,
    'sandbox allow-scripts',
  ].join('; ');
}

/** The session cookie a real sign-in would set: HttpOnly, so no script can read it. */
export const SESSION_COOKIE =
  'spike_httponly=FAKE-httponly-session; HttpOnly; SameSite=Strict; Path=/';

/**
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ origin: string, address: string, close: () => Promise<void> }>}
 *   `address` is the address the socket is bound to, as the operating system reports it.
 */
export async function startSpikeServer({ port = 4410 } = {}) {
  /** @type {Awaited<ReturnType<typeof buildDemo>> | null} */
  let demo = null;
  /** @type {Map<string, number>} */
  const served = new Map();
  /** @type {Array<{ caller: string, origin: string | null, cookie: boolean, authorization: boolean }>} */
  const whoamiLog = [];
  let origin = '';

  const server = createServer((request, response) => {
    /** @type {Record<string, string>} */
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    const send = (/** @type {number} */ status, /** @type {string | Uint8Array} */ body) => {
      response.writeHead(status, headers);
      response.end(body);
    };
    let url;
    try {
      url = new URL(request.url ?? '/', origin);
    } catch {
      // A request line no URL parser accepts gets an answer, not a crash.
      send(400, 'bad request');
      return;
    }
    const path = url.pathname;

    if (request.method !== 'GET' || demo === null) {
      send(405, 'GET only');
      return;
    }

    const file = STATIC.get(path);
    if (file) {
      headers['Content-Type'] = file.type;
      if (file.page === 'host') {
        headers['Content-Security-Policy'] = HOST_CSP;
        headers['Set-Cookie'] = SESSION_COOKIE;
        // A page load starts a run: the swapped bundle answers its first request with the good
        // bytes again, and the log shows this run's requests only.
        served.clear();
        whoamiLog.length = 0;
      }
      if (file.page === 'frame') headers['Content-Security-Policy'] = frameCsp(origin);
      if (file.cors) headers['Access-Control-Allow-Origin'] = '*';
      send(200, readFileSync(join(ROOT, file.file)));
      return;
    }

    const bundle = demo.bundles.get(path);
    if (bundle) {
      const count = served.get(path) ?? 0;
      served.set(path, count + 1);
      headers['Content-Type'] = 'text/javascript; charset=utf-8';
      if (bundle.cors) headers['Access-Control-Allow-Origin'] = '*';
      send(200, count === 0 ? bundle.first : bundle.later);
      return;
    }

    headers['Content-Type'] = 'application/json; charset=utf-8';
    if (path === '/spike/policy.json') {
      send(200, JSON.stringify(demo.policy));
    } else if (path === '/spike/scenarios.json') {
      send(200, JSON.stringify(demo.scenarios));
    } else if (path === '/api/whoami') {
      const entry = {
        caller: url.searchParams.get('caller') ?? 'unknown',
        origin: request.headers.origin ?? null,
        cookie: /(?:^|;\s*)spike_httponly=/.test(request.headers.cookie ?? ''),
        authorization: request.headers.authorization !== undefined,
      };
      whoamiLog.push(entry);
      send(200, JSON.stringify(entry));
    } else if (path === '/api/whoami-log') {
      send(200, JSON.stringify(whoamiLog));
    } else {
      send(404, JSON.stringify({ error: 'not found' }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  demo = await buildDemo(origin);

  return {
    origin,
    address: address.address,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = process.argv.indexOf('--port');
  const port = flag > 0 ? Number(process.argv[flag + 1]) : 4410;
  const { origin } = await startSpikeServer({ port });
  process.stdout.write(
    `Plugin spike demo at ${origin}/ (keys made for this run; Ctrl-C stops it)\n`,
  );
}
