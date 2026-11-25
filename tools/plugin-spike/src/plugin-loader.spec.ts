/**
 * The loader's refusals, each for its own reason, and its one acceptance.
 *
 * Every key is generated in `beforeAll`, for this run only. The host is faked: `fetchBytes`
 * answers from a map, and `execute` records what it was asked to run, so a test can say not only
 * that a plugin was refused but that nothing was fetched or run on the way.
 *
 * Load-bearing: "refuses a tampered bundle" is the one the spike's claim rests on. It was seen
 * failing with the loader's hash comparison removed (the report, section 9).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateSpikeKey, signManifest, type SpikeSigningKey } from '../dev/sign.mjs';
import {
  browserLoaderHost,
  checkUrl,
  integrityOf,
  loadPlugin,
  SIGNED_FIELDS,
  signedText,
  type LoaderHost,
  type LoaderPolicy,
  type PluginManifest,
} from './plugin-loader.mjs';

const ORIGIN = 'https://plugins.test';
const URL_PATH = '/plugins/sample/sample-plugin.js';
const SAMPLE = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../sample/sample-plugin.js', import.meta.url))),
);

let trusted: SpikeSigningKey;
let attacker: SpikeSigningKey;
let integrity: string;
let policy: LoaderPolicy;
let good: PluginManifest;

const fields = () => ({
  id: 'spike.sample-plugin',
  version: '1.0.0',
  apiVersion: 1,
  element: 'spike-sample-plugin',
  url: URL_PATH,
  integrity,
});

/**
 * A host whose store answers `bytes` for every URL, and which records every fetch and run. The
 * element counts as defined once a bundle has run, if `defines`, or from the start, if
 * `definedBefore`.
 */
function fakeHost(bytes: Uint8Array = SAMPLE, defines = true, definedBefore = false) {
  const fetched: string[] = [];
  const executed: Array<{ url: string; integrity: string }> = [];
  const host: LoaderHost = {
    fetchBytes: async (url) => {
      fetched.push(url);
      return bytes;
    },
    execute: async (url, hash) => {
      executed.push({ url, integrity: hash });
    },
    isDefined: () => definedBefore || (defines && executed.length > 0),
  };
  return { host, fetched, executed };
}

/** One byte of `bytes` changed: the smallest tamper there is. */
function flipOneByte(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  const index = Math.floor(copy.length / 2);
  copy[index] = copy[index] ^ 0x01;
  return copy;
}

beforeAll(async () => {
  trusted = await generateSpikeKey('test-run-trusted');
  attacker = await generateSpikeKey('test-run-attacker');
  integrity = await integrityOf(SAMPLE);
  policy = {
    trustedKeys: [{ keyId: trusted.keyId, publicKey: trusted.publicJwk }],
    pins: [{ id: 'spike.sample-plugin', version: '1.0.0', integrity }],
    allowedUrlPrefixes: [`${ORIGIN}/plugins/`],
    supportedApiVersions: [1],
    baseUrl: `${ORIGIN}/`,
  };
  good = await signManifest(fields(), trusted);
});

describe('loadPlugin accepts', () => {
  it('a signed, pinned, intact bundle, and runs it with the signed integrity', async () => {
    const { host, fetched, executed } = fakeHost();
    const result = await loadPlugin(good, policy, host);
    expect(result).toEqual({
      ok: true,
      id: 'spike.sample-plugin',
      version: '1.0.0',
      element: 'spike-sample-plugin',
      url: `${ORIGIN}${URL_PATH}`,
    });
    expect(fetched).toEqual([`${ORIGIN}${URL_PATH}`]);
    // The executor gets the signed hash, so a browser checks the bytes it actually runs.
    expect(executed).toEqual([{ url: `${ORIGIN}${URL_PATH}`, integrity }]);
  });
});

describe('loadPlugin refuses a tampered bundle', () => {
  it('with one byte changed, and never runs it', async () => {
    const { host, executed } = fakeHost(flipOneByte(SAMPLE));
    const result = await loadPlugin(good, policy, host);
    expect(result).toMatchObject({ ok: false, reason: 'integrity-mismatch' });
    expect(executed).toEqual([]);
  });

  it('with code appended, and never runs it', async () => {
    const appended = new Uint8Array([...SAMPLE, ...new TextEncoder().encode('\nwindow.x = 1;\n')]);
    const { host, executed } = fakeHost(appended);
    const result = await loadPlugin(good, policy, host);
    expect(result).toMatchObject({ ok: false, reason: 'integrity-mismatch' });
    expect(executed).toEqual([]);
  });

  it('whose manifest hash was updated to match without a new signature, before fetching it', async () => {
    const tamperedIntegrity = await integrityOf(flipOneByte(SAMPLE));
    const { host, fetched, executed } = fakeHost(flipOneByte(SAMPLE));
    const result = await loadPlugin({ ...good, integrity: tamperedIntegrity }, policy, host);
    expect(result).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(fetched).toEqual([]);
    expect(executed).toEqual([]);
  });

  it('when the executor refuses, as a browser does for bytes swapped after the check', async () => {
    const { host } = fakeHost();
    host.execute = async () => {
      throw new Error('integrity check failed at load');
    };
    const result = await loadPlugin(good, policy, host);
    expect(result).toMatchObject({ ok: false, reason: 'execute-failed' });
  });
});

describe('loadPlugin refuses a signature it cannot trust', () => {
  it('from a key the trust root does not hold', async () => {
    const forged = await signManifest(fields(), attacker);
    const { host, fetched } = fakeHost();
    expect(await loadPlugin(forged, policy, host)).toMatchObject({
      ok: false,
      reason: 'untrusted-key',
    });
    expect(fetched).toEqual([]);
  });

  it("from another key claiming the trusted key's id", async () => {
    const forged = await signManifest(fields(), attacker, trusted.keyId);
    const { host, fetched } = fakeHost();
    expect(await loadPlugin(forged, policy, host)).toMatchObject({
      ok: false,
      reason: 'bad-signature',
    });
    expect(fetched).toEqual([]);
  });

  it.each(SIGNED_FIELDS.filter((field) => field !== 'keyId' && field !== 'integrity'))(
    'when the signed field %s is changed after signing',
    async (field) => {
      const changed: Record<string, unknown> = { ...good };
      changed[field] =
        field === 'apiVersion'
          ? 2
          : field === 'version'
            ? '1.0.1'
            : `${(good as unknown as Record<string, string>)[field]}-changed`;
      const widened: LoaderPolicy = {
        ...policy,
        supportedApiVersions: [1, 2],
        pins: [
          ...policy.pins,
          { id: `${good.id}-changed`, version: '1.0.0', integrity },
          { id: good.id, version: '1.0.1', integrity },
        ],
      };
      const { host } = fakeHost();
      expect(await loadPlugin(changed, widened, host)).toMatchObject({
        ok: false,
        reason: 'bad-signature',
      });
    },
  );

  it('with a signature of the wrong length', async () => {
    const { host } = fakeHost();
    expect(await loadPlugin({ ...good, signature: 'AAAA' }, policy, host)).toMatchObject({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('when the trust root holds a private key, which a host never should', async () => {
    const leaky: LoaderPolicy = {
      ...policy,
      trustedKeys: [{ keyId: trusted.keyId, publicKey: { ...trusted.publicJwk, d: 'AAAA' } }],
    };
    const { host } = fakeHost();
    expect(await loadPlugin(good, leaky, host)).toMatchObject({
      ok: false,
      reason: 'trust-root-invalid',
    });
  });

  it('when the trust root holds a key of another kind', async () => {
    const wrong: LoaderPolicy = {
      ...policy,
      trustedKeys: [{ keyId: trusted.keyId, publicKey: { kty: 'RSA', n: 'AQAB', e: 'AQAB' } }],
    };
    const { host } = fakeHost();
    expect(await loadPlugin(good, wrong, host)).toMatchObject({
      ok: false,
      reason: 'trust-root-invalid',
    });
  });
});

describe('loadPlugin refuses what the deployment did not choose', () => {
  it('an older version, validly signed: a rollback', async () => {
    const older = await signManifest({ ...fields(), version: '0.9.0' }, trusted);
    const { host, fetched } = fakeHost();
    expect(await loadPlugin(older, policy, host)).toMatchObject({
      ok: false,
      reason: 'not-pinned',
    });
    expect(fetched).toEqual([]);
  });

  it('the pinned version with other bytes, validly signed', async () => {
    const other = await integrityOf(flipOneByte(SAMPLE));
    const resigned = await signManifest({ ...fields(), integrity: other }, trusted);
    const { host } = fakeHost(flipOneByte(SAMPLE));
    expect(await loadPlugin(resigned, policy, host)).toMatchObject({
      ok: false,
      reason: 'not-pinned',
    });
  });

  it('a plugin the deployment pins at all', async () => {
    const stranger = await signManifest({ ...fields(), id: 'spike.other-plugin' }, trusted);
    const { host } = fakeHost();
    expect(await loadPlugin(stranger, policy, host)).toMatchObject({
      ok: false,
      reason: 'not-pinned',
    });
  });

  it('a plugin API version this host does not serve', async () => {
    const future = await signManifest({ ...fields(), apiVersion: 2 }, trusted);
    const { host } = fakeHost();
    expect(await loadPlugin(future, policy, host)).toMatchObject({
      ok: false,
      reason: 'incompatible-api',
    });
  });
});

/** What each URL rule says when it refuses. */
const URL_RULES = {
  prefix: 'not under an allowed prefix',
  encoded: 'encoded separator or dot',
  credentials: 'carries credentials',
  query: 'query or a fragment',
  scheme: 'not an https or http URL',
  characters: 'never needs',
};

describe('loadPlugin refuses a bundle from anywhere but the plugin store', () => {
  // Each case names the rule that must refuse it, so a case another rule happens to catch does
  // not keep a removed rule's test green.
  it.each([
    ['another origin', 'https://elsewhere.test/plugins/sample/sample-plugin.js', 'prefix'],
    ['another path', '/static/sample-plugin.js', 'prefix'],
    ['a dot-dot escape', '/plugins/../static/sample-plugin.js', 'prefix'],
    ['an encoded dot-dot escape', '/plugins/%2e%2e/static/sample-plugin.js', 'prefix'],
    ['a protocol-relative URL', '//elsewhere.test/plugins/sample/sample-plugin.js', 'prefix'],
    ['an encoded slash', '/plugins/..%2fstatic/sample-plugin.js', 'encoded'],
    ['an encoded backslash', '/plugins/..%5Cstatic/sample-plugin.js', 'encoded'],
    ['an encoded dot inside a name', '/plugins/sample/sample-plugin%2ejs', 'encoded'],
    ['a double-encoded slash', '/plugins/..%252fstatic/sample-plugin.js', 'encoded'],
    [
      'a user name on the allowed origin',
      'https://spike@plugins.test/plugins/sample/sample-plugin.js',
      'credentials',
    ],
    ['a query string', '/plugins/sample/sample-plugin.js?v=2', 'query'],
    ['an empty query', '/plugins/sample/sample-plugin.js?', 'query'],
    ['an empty fragment', '/plugins/sample/sample-plugin.js#', 'query'],
    ['a javascript: scheme', 'javascript:alert(1)', 'scheme'],
    ['a blob: scheme', 'blob:https://plugins.test/0b1c', 'scheme'],
    ['a quote', "/plugins/sample/sample'plugin.js", 'characters'],
    ['an angle bracket', '/plugins/sample/<sample>.js', 'characters'],
    ['a space', '/plugins/sample/sample plugin.js', 'characters'],
    ['a raw backslash', '/plugins\\..\\static/sample-plugin.js', 'characters'],
    ['a control character', '/plugins/sample/sample\u0001plugin.js', 'characters'],
  ])('%s', async (_label, url, rule) => {
    const moved = await signManifest({ ...fields(), url }, trusted);
    const { host, fetched } = fakeHost();
    const why = URL_RULES[rule as keyof typeof URL_RULES];
    expect(await loadPlugin(moved, policy, host)).toMatchObject({
      ok: false,
      reason: 'url-not-allowed',
      detail: expect.stringContaining(why),
    });
    expect(fetched).toEqual([]);
  });

  it('allows nothing when a prefix does not end in a slash', () => {
    const loose = { ...policy, allowedUrlPrefixes: [`${ORIGIN}/plugins`] };
    expect(checkUrl('/plugins-evil/x.js', loose)).toEqual({
      why: 'it is not under an allowed prefix',
    });
    expect(checkUrl('/plugins/x.js', loose)).toEqual({ why: 'it is not under an allowed prefix' });
  });
});

describe('loadPlugin refuses a malformed manifest before anything else', () => {
  it.each([
    ['not an object', 'manifest'],
    ['null', null],
    ['an object with none of the fields', { extra: true }],
  ])('%s', async (_label, value) => {
    const { host } = fakeHost();
    expect(await loadPlugin(value, policy, host)).toMatchObject({
      ok: false,
      reason: 'malformed-manifest',
    });
  });

  it('with an extra field beside valid ones', async () => {
    const { host } = fakeHost();
    expect(await loadPlugin({ ...good, entry: 'x.js' }, policy, host)).toMatchObject({
      ok: false,
      reason: 'malformed-manifest',
    });
  });

  it('with a field missing', async () => {
    const { element: _dropped, ...rest } = good;
    const { host } = fakeHost();
    expect(await loadPlugin(rest, policy, host)).toMatchObject({
      ok: false,
      reason: 'malformed-manifest',
    });
  });

  it('whose field holds a line break, which could forge the next signed line', async () => {
    // Signed text for version "1.0.0\nintegrity=…" would read like another manifest's.
    const { host } = fakeHost();
    const forged = { ...good, version: `1.0.0\nintegrity=${integrity}` };
    // Refused by the line-break rule itself, not only by the version pattern after it.
    expect(await loadPlugin(forged, policy, host)).toMatchObject({
      ok: false,
      reason: 'malformed-manifest',
      detail: 'version holds a line break',
    });
  });

  it.each([
    ['a sha256 hash', async () => `sha256-${(await integrityOf(SAMPLE)).slice(7, 51)}`],
    ['two hashes', async () => `${integrity} ${await integrityOf(SAMPLE, 'sha512')}`],
    ['a short digest', async () => 'sha384-AAAA'],
  ])('with %s for integrity', async (_label, make) => {
    const { host } = fakeHost();
    expect(await loadPlugin({ ...good, integrity: await make() }, policy, host)).toMatchObject({
      ok: false,
      reason: 'malformed-manifest',
    });
  });
});

describe('loadPlugin reports what the environment did', () => {
  it('a fetch that failed', async () => {
    const { host } = fakeHost();
    host.fetchBytes = async () => {
      throw new Error('HTTP 404');
    };
    expect(await loadPlugin(good, policy, host)).toMatchObject({
      ok: false,
      reason: 'fetch-failed',
      detail: 'HTTP 404',
    });
  });

  it('an element something else already defined, before fetching anything', async () => {
    const { host, fetched } = fakeHost(SAMPLE, true, true);
    expect(await loadPlugin(good, policy, host)).toMatchObject({
      ok: false,
      reason: 'element-already-defined',
    });
    expect(fetched).toEqual([]);
  });

  it('a bundle that ran and did not define its element', async () => {
    const { host } = fakeHost(SAMPLE, false);
    expect(await loadPlugin(good, policy, host)).toMatchObject({
      ok: false,
      reason: 'element-not-defined',
    });
  });
});

describe('loadPlugin reads the manifest once', () => {
  it('so a field that answers differently on a second read cannot change what runs', async () => {
    const other = await integrityOf(flipOneByte(SAMPLE));
    let reads = 0;
    const shifty = { ...good };
    Object.defineProperty(shifty, 'integrity', {
      enumerable: true,
      get: () => (reads++ === 0 ? integrity : other),
    });
    const { host, executed } = fakeHost();
    expect(await loadPlugin(shifty, policy, host)).toMatchObject({ ok: true });
    expect(executed).toEqual([{ url: `${ORIGIN}${URL_PATH}`, integrity }]);
  });
});

describe('browserLoaderHost runs a bundle only through a script the browser checks', () => {
  /** The members of a script element the executor sets, and its two events. */
  class FakeScript extends EventTarget {
    type = '';
    integrity = '';
    crossOrigin: string | null = null;
    referrerPolicy = '';
    src = '';
  }

  function fakeDocument() {
    const appended: FakeScript[] = [];
    const document = {
      createElement: () => new FakeScript(),
      head: { append: (node: FakeScript) => appended.push(node) },
    };
    return { document, appended };
  }

  it('a module script carrying the signed integrity, in CORS mode, and resolves on load', async () => {
    const { document, appended } = fakeDocument();
    const host = browserLoaderHost(document, { get: () => undefined }, policy);
    const running = host.execute(`${ORIGIN}${URL_PATH}`, integrity);
    expect(appended).toHaveLength(1);
    const [script] = appended;
    expect({
      type: script.type,
      integrity: script.integrity,
      crossOrigin: script.crossOrigin,
      src: script.src,
    }).toEqual({
      type: 'module',
      integrity,
      crossOrigin: 'anonymous',
      src: `${ORIGIN}${URL_PATH}`,
    });
    script.dispatchEvent(new Event('load'));
    await expect(running).resolves.toBeUndefined();
  });

  it('and rejects when the browser refuses the bytes', async () => {
    const { document, appended } = fakeDocument();
    const running = browserLoaderHost(document, { get: () => undefined }, policy).execute(
      `${ORIGIN}${URL_PATH}`,
      integrity,
    );
    appended[0].dispatchEvent(new Event('error'));
    await expect(running).rejects.toThrow(/refused to run/);
  });

  // The executor checks a URL itself, so one that never went through `loadPlugin` is refused
  // before any script exists, and nothing reaches `src` but a parsed, allowed https URL.
  it.each([
    ['a javascript: URL', 'javascript:alert(document.domain)'],
    ['a javascript: URL with a leading space', ' javascript:alert(1)'],
    ['a data: URL', 'data:text/javascript,alert(1)'],
    ['a URL outside the prefix', 'https://elsewhere.test/plugins/sample/sample-plugin.js'],
    ['a value carrying markup', '/plugins/sample/"><script>alert(1)</script>.js'],
    ['a value carrying an event handler', "/plugins/sample/x.js' onerror='alert(1)"],
  ])('and refuses %s without making a script', async (_label, url) => {
    const { document, appended } = fakeDocument();
    const host = browserLoaderHost(document, { get: () => undefined }, policy);
    await expect(host.execute(url, integrity)).rejects.toThrow(/refused to run/);
    expect(appended).toEqual([]);
  });

  it('and refuses an integrity that is not one strong hash, without making a script', async () => {
    const { document, appended } = fakeDocument();
    const host = browserLoaderHost(document, { get: () => undefined }, policy);
    await expect(host.execute(`${ORIGIN}${URL_PATH}`, 'sha256-AAAA')).rejects.toThrow(
      /refused to run/,
    );
    expect(appended).toEqual([]);
  });
});

describe('loadPlugin refuses a script URL or markup before fetching anything', () => {
  it.each([
    ['a javascript: URL', { url: 'javascript:alert(document.domain)' }, 'url-not-allowed'],
    ['a URL outside the prefix', { url: 'https://elsewhere.test/x.js' }, 'url-not-allowed'],
    [
      'markup in the URL',
      { url: '/plugins/sample/"><img src=x onerror=alert(1)>.js' },
      'url-not-allowed',
    ],
    ['markup for the element', { element: '<img src=x onerror=alert(1)>' }, 'malformed-manifest'],
    ['markup for the id', { id: '<script>alert(1)</script>' }, 'malformed-manifest'],
  ])('%s', async (_label, change, reason) => {
    const signed = await signManifest({ ...fields(), ...change }, trusted);
    const { host, fetched, executed } = fakeHost();
    expect(await loadPlugin(signed, policy, host)).toMatchObject({ ok: false, reason });
    expect(fetched).toEqual([]);
    expect(executed).toEqual([]);
  });
});

describe('signedText', () => {
  it('starts with the context line and covers every signed field, url excepted', () => {
    const text = signedText(good);
    const lines = text.split('\n');
    expect(lines[0]).toBe('nuxeo-satori-plugin-manifest/1');
    expect(lines.slice(1, -1).map((line) => line.split('=', 1)[0])).toEqual([...SIGNED_FIELDS]);
    expect(text).not.toContain(URL_PATH);
  });
});
