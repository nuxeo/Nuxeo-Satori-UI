/**
 * The embedded panel's demo, for development only: a fictional CRM page that shows a claim's panel,
 * and a stand-in for the Nuxeo server it talks to. Nothing here is built, packaged or served by
 * the application; `npm run` names no script for it, and the panel's build copies none of it.
 * **Everything here is fictional:** the CRM, its user, the claim, the payment and the policy.
 *
 *   npx nx build nuxeo-embedded-panels
 *   node apps/nuxeo-embedded-panels/demo/demo.mjs [--nuxeo-port 8093] [--crm-port 8094]
 *
 * then open http://localhost:8094/ (the CRM, an origin the stand-in's host names) and
 * http://127.0.0.1:8094/ (the same page on an origin it does not name, which the panel refuses).
 *
 * Two servers, on the loopback interface only:
 *
 * - **The stand-in Nuxeo**, on `http://127.0.0.1:<nuxeo-port>`: the panel's script and files, as
 *   nuxeo-agentic-ui-package serves them at `/nuxeo/agentic-ui/embedded/v1/`; the host's origins and
 *   the token exchange, as nuxeo-agentic-embedded's servlet answers them; a claim, its type and its
 *   layout, and `Connector.Read`, as the REST API and the configuration servlet answer them. It
 *   mirrors the add-on's rules where the panel meets them: CORS for the host's origins only, the
 *   token in a header and never a URL, the host's origins, reads only. **It is not the add-on**:
 *   the add-on's Java tests are what prove the exchange and the guard; this lets the panel run.
 * - **The CRM**, on `http://localhost:<crm-port>` and, as an origin the host does not name,
 *   `http://127.0.0.1:<crm-port>`: its page, which writes `<nuxeo-record-panel>` and answers the
 *   panel's handshake; and its own server's endpoint, `POST /crm/nuxeo-token`, which signs an
 *   assertion of the CRM's signed-in user and exchanges it, server to server, with the host's client
 *   secret. The page never sees the secret or the assertion, only the token.
 *
 * The client secret, the assertion key and the stand-in's signing key are made up at each start,
 * held in memory, and never printed. Each request is logged, its method, path and status, never a
 * token.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const PANEL_DIST = join(ROOT, 'dist', 'nuxeo-embedded-panels', 'browser');

export const HOST_ID = 'crm';
export const CLAIM_ID = '5f1c0e2a-0000-4000-8000-000000000130';
export const CRM_USER = 'crm-user-17';
export const NUXEO_USER = 'jsmith';
const FORMAT = 'nuxeo-agentic-ui-config/1';
const TOKEN_LIFETIME = 300;
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const JWT_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const base64url = (value) => Buffer.from(value).toString('base64url');

function signJwt(header, claims, key, algorithm) {
  const head = base64url(JSON.stringify(header));
  const body = base64url(JSON.stringify(claims));
  const signature = createHmac(algorithm, key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

/** The claims of a JWT signed with `key`, or `null`: its signature compared in constant time. */
function verifyJwt(token, key, algorithm, alg) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== alg) return null;
    const expected = createHmac(algorithm, key).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const sameText = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

async function body(request, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response, status, payload, headers = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(text);
}

/** A file below `folder`, or `null` for a path that leaves it or names nothing. */
async function fileBelow(folder, relative) {
  const path = resolve(folder, `.${sep}${relative}`);
  if (!path.startsWith(folder + sep) || !existsSync(path)) return null;
  return { path, content: await readFile(path) };
}

/** Listens on both loopback addresses, so that `localhost` reaches it however it resolves. */
async function listen(handler, port) {
  const servers = [];
  for (const address of ['127.0.0.1', '::1']) {
    const server = createServer(handler);
    try {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, address, ok);
      });
      servers.push(server);
    } catch (error) {
      if (address === '127.0.0.1') throw error;
    }
  }
  return servers;
}

/**
 * Starts the two servers. `options.firstTokenExpired` makes the stand-in issue its next token
 * already expired, so that the panel's first read is refused and it asks for another.
 */
export async function startDemo({ nuxeoPort = 8093, crmPort = 8094 } = {}) {
  if (!existsSync(join(PANEL_DIST, 'main.js'))) {
    throw new Error(
      `The panel is not built: run \`npx nx build nuxeo-embedded-panels\` first (${PANEL_DIST})`,
    );
  }
  const layout = JSON.parse(await readFile(join(HERE, 'Claim.view.layout.json'), 'utf8'));
  const nuxeoOrigin = `http://127.0.0.1:${nuxeoPort}`;
  const crmOrigin = `http://localhost:${crmPort}`;
  const otherOrigin = `http://127.0.0.1:${crmPort}`;
  const allowedOrigins = new Set([crmOrigin]);
  const audience = `${nuxeoOrigin}/nuxeo`;

  // Made up at each start, for the demo only; never printed.
  const clientSecret = randomBytes(32).toString('base64url');
  const assertionKey = randomBytes(32).toString('base64url');
  const signingKey = randomBytes(32);

  const log = [];
  const usedAssertions = new Set();
  const state = { exchanges: 0, expireNext: false };

  const record = (server, request, status) => {
    const authorization = request.headers['authorization'] ?? '';
    log.push({
      server,
      method: request.method,
      path: (request.url ?? '').split('?')[0],
      query: (request.url ?? '').includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '',
      status,
      bearer: authorization.startsWith('Bearer ') ? authorization.slice(7) : null,
      basic: authorization.startsWith('Basic '),
      cookie: Boolean(request.headers['cookie']),
      origin: request.headers['origin'] ?? null,
    });
  };

  // ---------------------------------------------------------------- the stand-in Nuxeo

  const cors = (request) => {
    const origin = request.headers['origin'];
    return origin && allowedOrigins.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : { Vary: 'Origin' };
  };

  /** The panel's token's claims, held to the add-on's rules, or the status that refuses it. */
  const checkToken = (request, method, rest) => {
    const authorization = request.headers['authorization'] ?? '';
    if (/(^|&)access_token=/.test(request.url?.split('?')[1] ?? '')) return { status: 401 };
    if (!authorization.startsWith('Bearer ')) return { status: 401 };
    const claims = verifyJwt(authorization.slice(7).trim(), signingKey, 'sha512', 'HS512');
    const now = Math.floor(Date.now() / 1000);
    if (!claims || claims.nxe_host !== HOST_ID || !(claims.exp > now)) return { status: 401 };
    const origin = request.headers['origin'];
    if (origin && !allowedOrigins.has(origin)) return { status: 403 };
    const read = (method === 'GET' || method === 'HEAD') && /^(id|config)\//.test(rest);
    const connector = method === 'POST' && rest === 'automation/Connector.Read';
    if (!read && !connector) return { status: 403 };
    return { claims };
  };

  const exchange = async (request, response) => {
    if (request.url.includes('?')) return send(response, 400, { error: 'invalid_request' });
    const [id, secret] = Buffer.from((request.headers['authorization'] ?? '').replace(/^Basic /, ''), 'base64')
      .toString('utf8')
      .split(':');
    if (id !== HOST_ID || !sameText(secret ?? '', clientSecret)) {
      return send(response, 401, { error: 'invalid_client' }, { 'WWW-Authenticate': 'Basic realm="agentic-embedded"' });
    }
    const form = new URLSearchParams(await body(request));
    if (form.get('grant_type') !== GRANT_TYPE) return send(response, 400, { error: 'unsupported_grant_type' });
    if (form.get('subject_token_type') !== JWT_TYPE) return send(response, 400, { error: 'invalid_request' });
    const claims = verifyJwt(form.get('subject_token'), assertionKey, 'sha256', 'HS256');
    const now = Math.floor(Date.now() / 1000);
    const valid =
      claims &&
      claims.iss === crmOrigin &&
      [].concat(claims.aud).includes(audience) &&
      typeof claims.jti === 'string' &&
      claims.exp + 30 > now &&
      claims.exp - claims.iat <= 300;
    if (!valid) return send(response, 400, { error: 'invalid_grant' });
    if (usedAssertions.has(claims.jti)) return send(response, 400, { error: 'invalid_grant' });
    usedAssertions.add(claims.jti);
    if (claims.sub !== CRM_USER) return send(response, 400, { error: 'invalid_grant' });
    state.exchanges += 1;
    const expired = state.expireNext;
    state.expireNext = false;
    const token = signJwt(
      { alg: 'HS512', typ: 'JWT' },
      {
        iss: 'nuxeo',
        sub: NUXEO_USER,
        aud: 'site/api/v1',
        iat: now,
        exp: expired ? now - 1 : now + TOKEN_LIFETIME,
        jti: randomUUID(),
        nxe_host: HOST_ID,
        scope: 'read',
      },
      signingKey,
      'sha512',
    );
    return send(response, 200, {
      access_token: token,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: 'Bearer',
      expires_in: TOKEN_LIFETIME,
      scope: 'read',
    });
  };

  const claim = {
    'entity-type': 'document',
    uid: CLAIM_ID,
    type: 'Claim',
    title: 'CLAIM-000130',
    state: 'submitted',
    lastModified: '2026-11-20T10:00:00.000Z',
    isVersion: false,
    isTrashed: false,
    facets: [],
    schemas: [
      { name: 'dublincore', prefix: 'dc' },
      { name: 'claim', prefix: 'claim' },
    ],
    properties: {
      'dc:title': 'CLAIM-000130',
      'dc:description': 'Water damage to the kitchen floor, reported by the member.',
      'claim:number': 'CLAIM-000130',
      'claim:billedAmount': 412.5,
      'claim:received': '2026-09-28T00:00:00.000Z',
    },
    contextParameters: { permissions: ['Read', 'ReadProperties'] },
  };

  const claimType = {
    name: 'Claim',
    schemas: [
      { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string', description: 'string' } },
      {
        name: 'claim',
        '@prefix': 'claim',
        fields: { number: 'string', billedAmount: 'double', received: 'date' },
      },
    ],
  };

  const nuxeo = async (request, response) => {
    const url = new URL(request.url, nuxeoOrigin);
    const path = url.pathname;
    const method = request.method;
    const reply = (status, payload, headers = {}) => {
      record('nuxeo', request, status);
      send(response, status, payload, { ...cors(request), ...headers });
    };
    try {
      if (method === 'OPTIONS') {
        const origin = request.headers['origin'];
        if (!origin || !allowedOrigins.has(origin)) return reply(403, { error: 'origin' });
        record('nuxeo', request, 204);
        response.writeHead(204, {
          ...cors(request),
          'Access-Control-Allow-Methods': 'GET, POST, HEAD',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, properties, enrichers.document, fetch-document, fetch-schema',
          'Access-Control-Max-Age': '600',
        });
        return response.end();
      }
      if (path.startsWith('/nuxeo/agentic-ui/embedded/v1/')) {
        // The panel's files hold no data and need no sign-in, so any page may load them: the panel
        // itself refuses a page its host does not name (the integration guide, "CORS").
        const file = await fileBelow(PANEL_DIST, decodeURIComponent(path.slice('/nuxeo/agentic-ui/embedded/v1/'.length)));
        if (!file) return reply(404, { error: 'not_found' });
        record('nuxeo', request, 200);
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': TYPES[extname(file.path)] ?? 'application/octet-stream',
        });
        return response.end(file.content);
      }
      if (path === `/nuxeo/agentic-embedded/v1/hosts/${HOST_ID}` && method === 'GET') {
        // As the add-on's servlet: the origins to the host's pages only; to any other, a 404 it may
        // read, and nothing else.
        const origin = request.headers['origin'];
        const readable = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
        if (!origin || !allowedOrigins.has(origin)) return reply(404, { error: 'not_found' }, readable);
        return reply(200, { host: HOST_ID, origins: [...allowedOrigins] });
      }
      if (path === '/nuxeo/agentic-embedded/v1/token' && method === 'POST') {
        // Server to server: no CORS header, so no page can read the answer.
        record('nuxeo', request, 'exchange');
        return exchange(request, response);
      }
      if (path === '/nuxeo/agentic-ui-config/layouts.json') {
        return reply(200, {
          format: FORMAT,
          layer: 'layouts',
          layouts: [{ type: 'Claim', mode: 'view', component: 'nuxeo.config.embedded-demo' }],
          diagnostics: [],
        });
      }
      if (path === '/nuxeo/agentic-ui-config/layouts/Claim/view.layout.json') {
        return reply(200, { format: FORMAT, layer: 'layout', type: 'Claim', mode: 'view', content: layout });
      }
      if (path.startsWith('/nuxeo/api/v1/')) {
        const rest = path.slice('/nuxeo/api/v1/'.length);
        const checked = checkToken(request, method, rest);
        if (checked.status) return reply(checked.status, { status: checked.status, message: 'refused' });
        if (rest === `id/${CLAIM_ID}` && method === 'GET') return reply(200, claim);
        if (rest.startsWith('id/')) return reply(404, { status: 404, message: 'not found' });
        if (rest === 'config/types/Claim') return reply(200, claimType);
        if (rest === 'automation/Connector.Read') {
          const input = JSON.parse((await body(request)) || '{}');
          if (input.input !== `doc:${CLAIM_ID}`) return reply(404, { status: 404 });
          return reply(200, {
            connector: 'payers.claimPayments',
            status: 'found',
            fields: {
              paymentStatus: 'Paid',
              paidAmount: 412.5,
              policyNumber: 'POL-FICT-0048',
              policyStatus: 'In force',
            },
          });
        }
        return reply(404, { status: 404 });
      }
      return reply(404, { error: 'not_found' });
    } catch (error) {
      return reply(500, { error: String(error?.message ?? error) });
    }
  };

  // ---------------------------------------------------------------- the CRM

  /** The CRM's server: an assertion of its signed-in user, exchanged with its own client secret. */
  const tokenForTheCrmUser = async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(
      { alg: 'HS256', typ: 'JWT' },
      { iss: crmOrigin, sub: CRM_USER, aud: audience, iat: now, exp: now + 60, jti: randomUUID() },
      assertionKey,
      'sha256',
    );
    const answer = await fetch(`${nuxeoOrigin}/nuxeo/agentic-embedded/v1/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${HOST_ID}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        subject_token: assertion,
        subject_token_type: JWT_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
      }).toString(),
    });
    if (!answer.ok) return null;
    const { access_token: token, expires_in: expiresIn } = await answer.json();
    return { token, expiresIn };
  };

  const crm = async (request, response) => {
    const url = new URL(request.url, crmOrigin);
    const origin = `http://${request.headers['host']}`;
    try {
      if (url.pathname === '/crm/nuxeo-token' && request.method === 'POST') {
        // The CRM's own session decides who its user is; in this demo, always the same one. A page
        // of an origin the CRM does not serve its users on gets nothing.
        if (request.headers['origin'] !== crmOrigin) {
          record('crm', request, 403);
          return send(response, 403, { error: 'origin' });
        }
        const exchanged = await tokenForTheCrmUser();
        record('crm', request, exchanged ? 200 : 502);
        return exchanged ? send(response, 200, exchanged) : send(response, 502, { error: 'exchange' });
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = await fileBelow(join(HERE, 'crm'), name);
      if (!file) {
        record('crm', request, 404);
        return send(response, 404, 'Not found');
      }
      record('crm', request, 200);
      // The page's placeholders, `{{ NAME }}`, as the formatter leaves them.
      const values = {
        NUXEO: nuxeoOrigin,
        CLAIM: CLAIM_ID,
        OTHER_ORIGIN: origin === crmOrigin ? otherOrigin : crmOrigin,
      };
      const text = file.content
        .toString('utf8')
        .replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name) => values[name] ?? whole);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file.path)] ?? 'text/plain' });
      return response.end(text);
    } catch (error) {
      record('crm', request, 500);
      return send(response, 500, String(error?.message ?? error));
    }
  };

  const servers = [...(await listen(nuxeo, nuxeoPort)), ...(await listen(crm, crmPort))];
  return {
    nuxeoOrigin,
    crmOrigin,
    otherOrigin,
    claimId: CLAIM_ID,
    log,
    exchanges: () => state.exchanges,
    expireNextToken: () => {
      state.expireNext = true;
    },
    close: () => Promise.all(servers.map((server) => new Promise((ok) => server.close(ok)))),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] !== undefined ? Number(args[at + 1]) : fallback;
  };
  const demo = await startDemo({ nuxeoPort: option('--nuxeo-port', 8093), crmPort: option('--crm-port', 8094) });
  process.stdout.write(
    `The stand-in Nuxeo: ${demo.nuxeoOrigin}\n` +
      `The CRM, an origin the host names:        ${demo.crmOrigin}/\n` +
      `The same page, an origin it does not name: ${demo.otherOrigin}/\n` +
      'Ctrl-C to stop.\n',
  );
}
