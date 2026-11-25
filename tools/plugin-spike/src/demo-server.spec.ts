/**
 * The demo server, over real HTTP on 127.0.0.1: every scenario the host page runs is run here
 * through the same loader, against the same server, and must give the outcome it advertises.
 *
 * The one thing Node cannot do is the browser's own integrity check at execution, so the executor
 * here re-fetches the URL and compares hashes, which is what the browser's check amounts to for a
 * single-file bundle. The swapped-bytes scenario is refused by that executor, as the browser
 * refuses it (seen in Chromium; the report, section 9).
 */
import { connect } from 'node:net';

import { startSpikeServer, HOST_CSP, SESSION_COOKIE } from '../dev/serve.mjs';
import { integrityOf, loadPlugin, type LoaderHost } from './plugin-loader.mjs';

let server: Awaited<ReturnType<typeof startSpikeServer>>;

beforeAll(async () => {
  server = await startSpikeServer({ port: 0 });
});

afterAll(async () => {
  await server.close();
});

async function bytesOf(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A Node stand-in for the browser: fetch, then run only bytes whose hash is the signed one. Elements
 * a run defines go into `registry`, shared by every scenario in one page as `customElements` is,
 * so an order of scenarios the page could not run fails here too.
 */
function nodeHost(registry: Set<string>): LoaderHost {
  let ran = false;
  return {
    fetchBytes: bytesOf,
    execute: async (url, integrity) => {
      const algorithm = integrity.startsWith('sha512-') ? 'sha512' : 'sha384';
      if ((await integrityOf(await bytesOf(url), algorithm)) !== integrity) {
        throw new Error('the bytes at execution do not match the signed integrity');
      }
      ran = true;
    },
    isDefined: (element) => {
      if (ran) registry.add(element);
      return registry.has(element);
    },
  };
}

describe('the demo server', () => {
  it('is bound to 127.0.0.1 only, as the socket reports it', () => {
    expect(server.address).toBe('127.0.0.1');
  });

  it('answers a request line no URL parser accepts with 400, and keeps serving', async () => {
    const { port } = new URL(server.origin);
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), '127.0.0.1', () =>
        socket.write('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'),
      );
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    expect(answer.split('\r\n', 1)[0]).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(`${server.origin}/`)).status).toBe(200);
  });

  it('serves the host page with its CSP and an HttpOnly session cookie', async () => {
    const response = await fetch(`${server.origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(HOST_CSP);
    expect(HOST_CSP).toContain("script-src 'self'");
    expect(HOST_CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(response.headers.get('set-cookie')).toBe(SESSION_COOKIE);
    expect(SESSION_COOKIE).toMatch(/HttpOnly/);
  });

  it('sandboxes the frame page by its own CSP too', async () => {
    const response = await fetch(`${server.origin}/host/sandbox.html`);
    expect(response.headers.get('content-security-policy')).toMatch(/sandbox allow-scripts$/);
    expect(response.headers.get('content-security-policy')).not.toMatch(/allow-same-origin/);
  });

  it('answers 404 for files outside its route table', async () => {
    for (const path of [
      '/package.json',
      '/dev/serve.mjs',
      '/src/../dev/sign.mjs',
      '/project.json',
    ]) {
      expect((await fetch(`${server.origin}${path}`)).status, path).toBe(404);
    }
  });

  it('publishes only public keys in its policy', async () => {
    const policy = await (await fetch(`${server.origin}/spike/policy.json`)).json();
    expect(policy.trustedKeys).toHaveLength(1);
    for (const { publicKey } of policy.trustedKeys)
      expect(Object.keys(publicKey).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });
});

describe('every scenario the host page runs', () => {
  it('gives the outcome it advertises, through the real loader and the real server', async () => {
    const policy = await (await fetch(`${server.origin}/spike/policy.json`)).json();
    const scenarios: Array<{
      name: string;
      expected: string;
      frame?: boolean;
      manifest: unknown;
    }> = await (await fetch(`${server.origin}/spike/scenarios.json`)).json();

    const page = new Set<string>();
    const outcomes = [];
    for (const scenario of scenarios) {
      // The page's registry, or a fresh one for a frame, which is a document of its own.
      const registry = scenario.frame ? new Set<string>() : page;
      const result = await loadPlugin(scenario.manifest, policy, nodeHost(registry));
      outcomes.push({ name: scenario.name, outcome: result.ok ? 'loaded' : result.reason });
    }
    expect(outcomes).toEqual(scenarios.map(({ name, expected }) => ({ name, outcome: expected })));
    // Not a vacuous list: one acceptance in the page, one in the frame, and seven refusals.
    expect(outcomes.filter(({ outcome }) => outcome === 'loaded')).toHaveLength(2);
    expect(new Set(outcomes.map(({ outcome }) => outcome)).size).toBeGreaterThanOrEqual(7);
  });
});
