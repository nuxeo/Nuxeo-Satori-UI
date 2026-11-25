// @ts-check
/**
 * The host half of the decision 5 spike: load a plugin bundle at run time only when a key the
 * deployment trusts signed it, the deployment pinned that exact version, and the bytes match the
 * signed hash.
 *
 * **Spike code.** Nothing in `apps/`, `libs/` or any published package may import this file, and
 * nothing builds it: `checkPluginSpikeIsolated` in `scripts/review-guardrails.mjs` and the
 * `type:spike` probes in `scripts/beta-harness/module-boundaries.mjs` fail if anything does. It
 * informs decision 5 (docs/business-apps/decisions.md); the report is
 * docs/business-apps/spikes/plugins-decision-5.md.
 *
 * ## The checks, in the order they run
 *
 * The manifest is copied once, before anything reads it, so every check and the fetch see the
 * same values. Every check that needs only the manifest runs before a byte of the bundle is
 * fetched, so a refused manifest never makes a request.
 *
 * 1. `malformed-manifest`: exactly the expected fields, each of the expected shape. No field may
 *    hold a newline, which is what makes the signed text below unambiguous.
 * 2. `untrusted-key`: the manifest names a key the deployment's trust root does not hold.
 * 3. `trust-root-invalid`: the trusted key is not a P-256 public key, or carries a private half.
 * 4. `bad-signature`: the signature does not verify over the signed text (`signedText`).
 * 5. `not-pinned`: the deployment did not pin this plugin at this version and this hash. A
 *    signature alone would accept every version the publisher ever signed, an old vulnerable one
 *    included; the pin is what refuses a rollback.
 * 6. `incompatible-api`: the plugin targets a plugin API version this host does not serve.
 * 7. `url-not-allowed`: the bundle's URL, once resolved, is not under an allowed prefix, or
 *    carries credentials, a query, a fragment, or an encoded separator, dot or percent sign.
 * 8. `element-already-defined`: something already defined the element the plugin declares, so
 *    step 12 could not tell whether the bundle defined it. Two loads declaring the same element at
 *    once would both pass this step; a product loader would take one load per element at a time.
 * 9. `fetch-failed`: the bundle could not be fetched.
 * 10. `integrity-mismatch`: the fetched bytes do not hash to the signed integrity.
 * 11. `execute-failed`: the executor refused or failed. In a browser the executor is a module
 *     `<script>` carrying the same `integrity`, so the browser checks the bytes it actually runs,
 *     and bytes swapped between step 10 and execution are refused there.
 * 12. `element-not-defined`: the bundle ran and did not define the element it declared.
 *
 * ## What a pass does not mean
 *
 * That the plugin is harmless. A loaded plugin runs in the host's page, with the host's origin,
 * and can reach whatever the host's own scripts can. The checks decide **which bytes run**; they
 * do not constrain what those bytes do. See the report's section on what a plugin can reach.
 */

/** The text every signature covers starts with this line, so a signature over anything else never verifies here. */
export const SIGNATURE_CONTEXT = 'nuxeo-satori-plugin-manifest/1';

/** Exactly these fields, no more and no fewer. */
export const MANIFEST_FIELDS = Object.freeze([
  'id',
  'version',
  'apiVersion',
  'element',
  'url',
  'integrity',
  'keyId',
  'signature',
]);

/** The fields the signature covers, in the order they are written. `url` is not one: it is where the bytes are, not what they are. */
export const SIGNED_FIELDS = Object.freeze([
  'id',
  'version',
  'apiVersion',
  'element',
  'integrity',
  'keyId',
]);

/** Accepted hash algorithms: SRI's two strong ones. `sha256` is refused, to keep one strength across hosts. */
const INTEGRITY = /^(sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;
const DIGEST_BYTES = { sha384: 48, sha512: 64 };
const DIGEST_NAMES = { sha384: 'SHA-384', sha512: 'SHA-512' };

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ELEMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * @typedef {object} PluginManifest
 * @property {string} id            Reverse-DNS-like plugin id, such as `acme.sample-plugin`.
 * @property {string} version       Exact semantic version, no range.
 * @property {number} apiVersion    The plugin API major version the plugin targets.
 * @property {string} element       The custom element name the bundle defines.
 * @property {string} url           Where the bundle is, relative to the host's base URL or absolute.
 * @property {string} integrity     One SRI hash, `sha384-…` or `sha512-…`.
 * @property {string} keyId         Which trusted key signed it.
 * @property {string} signature     ECDSA P-256 / SHA-256 over `signedText`, IEEE P1363, base64url.
 */

/**
 * @typedef {object} TrustedKey
 * @property {string} keyId
 * @property {JsonWebKey} publicKey  An EC P-256 public JWK. A JWK with a private half (`d`) is refused.
 */

/**
 * @typedef {object} PluginPin
 * @property {string} id
 * @property {string} version
 * @property {string} integrity
 */

/**
 * @typedef {object} LoaderPolicy  Everything the deployment decides. None of it comes from the manifest.
 * @property {readonly TrustedKey[]} trustedKeys
 * @property {readonly PluginPin[]} pins
 * @property {readonly string[]} allowedUrlPrefixes  Absolute URL prefixes, each ending in `/`.
 * @property {readonly number[]} supportedApiVersions
 * @property {string} baseUrl  What a relative `url` resolves against.
 */

/**
 * @typedef {object} LoaderHost  What the loader needs from its environment, injected so Node can test it.
 * @property {(url: string) => Promise<Uint8Array>} fetchBytes
 * @property {(url: string, integrity: string) => Promise<void>} execute
 * @property {(element: string) => boolean} isDefined
 */

/**
 * @typedef {'malformed-manifest' | 'untrusted-key' | 'trust-root-invalid' | 'bad-signature'
 *   | 'not-pinned' | 'incompatible-api' | 'url-not-allowed' | 'element-already-defined'
 *   | 'fetch-failed' | 'integrity-mismatch' | 'execute-failed' | 'element-not-defined'} RefusalReason
 */

/**
 * @typedef {{ ok: true, id: string, version: string, element: string, url: string }
 *   | { ok: false, reason: RefusalReason, detail: string }} LoadResult
 */

/**
 * The exact text a signature covers.
 *
 * One `name=value` line per signed field, after the context line. Unambiguous because
 * `checkShape` refuses a newline in any field, so no value can forge the next line.
 *
 * @param {Pick<PluginManifest, 'id' | 'version' | 'apiVersion' | 'element' | 'integrity' | 'keyId'>} manifest
 * @returns {string}
 */
export function signedText(manifest) {
  return [
    SIGNATURE_CONTEXT,
    ...SIGNED_FIELDS.map(
      (field) => `${field}=${String(/** @type {Record<string, unknown>} */ (manifest)[field])}`,
    ),
    '',
  ].join('\n');
}

/**
 * @param {RefusalReason} reason
 * @param {string} detail
 * @returns {LoadResult}
 */
function refuse(reason, detail) {
  return { ok: false, reason, detail };
}

/**
 * @param {unknown} value
 * @returns {string | null} Why the manifest is malformed, or null.
 */
export function checkShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'the manifest is not an object';
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record).sort();
  const expected = [...MANIFEST_FIELDS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    return `the manifest has fields ${JSON.stringify(keys)}, not ${JSON.stringify(expected)}`;
  }
  for (const field of MANIFEST_FIELDS) {
    const fieldValue = record[field];
    if (field === 'apiVersion') {
      if (!Number.isInteger(fieldValue) || /** @type {number} */ (fieldValue) < 1) {
        return 'apiVersion is not a positive integer';
      }
      continue;
    }
    if (typeof fieldValue !== 'string') return `${field} is not a string`;
    if (/[\r\n]/.test(fieldValue)) return `${field} holds a line break`;
  }
  const manifest = /** @type {PluginManifest} */ (value);
  if (!PLUGIN_ID.test(manifest.id)) return `id ${JSON.stringify(manifest.id)} is not a plugin id`;
  if (!VERSION.test(manifest.version)) {
    return `version ${JSON.stringify(manifest.version)} is not an exact x.y.z version`;
  }
  if (!ELEMENT.test(manifest.element)) {
    return `element ${JSON.stringify(manifest.element)} is not a custom element name`;
  }
  const integrity = INTEGRITY.exec(manifest.integrity);
  if (!integrity) {
    return 'integrity is not exactly one sha384- or sha512- hash';
  }
  const [, algorithm, digest] = integrity;
  if (
    base64ToBytes(digest).length !== DIGEST_BYTES[/** @type {'sha384' | 'sha512'} */ (algorithm)]
  ) {
    return `integrity's ${algorithm} digest has the wrong length`;
  }
  if (!KEY_ID.test(manifest.keyId)) return 'keyId is not a key id';
  if (!BASE64URL.test(manifest.signature)) return 'signature is not base64url';
  if (manifest.url.length === 0) return 'url is empty';
  return null;
}

/**
 * The trust root's key for `keyId`, imported, or why it cannot be used.
 *
 * @param {readonly TrustedKey[]} trustedKeys
 * @param {string} keyId
 * @returns {Promise<{ key: CryptoKey } | { refusal: LoadResult }>}
 */
async function trustedKeyFor(trustedKeys, keyId) {
  const entry = trustedKeys.find((candidate) => candidate.keyId === keyId);
  if (!entry) {
    return { refusal: refuse('untrusted-key', `no trusted key has id ${JSON.stringify(keyId)}`) };
  }
  const jwk = entry.publicKey;
  if (jwk.d !== undefined) {
    return {
      refusal: refuse(
        'trust-root-invalid',
        `trusted key ${JSON.stringify(keyId)} carries a private half; a host holds public keys only`,
      ),
    };
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return {
      refusal: refuse('trust-root-invalid', `trusted key ${JSON.stringify(keyId)} is not EC P-256`),
    };
  }
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return { key };
  } catch (error) {
    return {
      refusal: refuse(
        'trust-root-invalid',
        `trusted key ${JSON.stringify(keyId)} does not import: ${describe(error)}`,
      ),
    };
  }
}

/**
 * Where the bundle is, resolved, or why it may not be fetched.
 *
 * The prefix is compared with the URL as the WHATWG parser normalises it, so `..` and `%2e%2e`
 * segments are resolved first. What normalising leaves alone is refused outright: credentials, a
 * query or a fragment (even an empty `?` or `#`), and an encoded `/`, `\`, `.` or `%` in the path,
 * which a store or proxy that decodes them, once or twice, could read as a way out of the prefix.
 *
 * @param {string} url
 * @param {LoaderPolicy} policy
 * @returns {{ href: string } | { why: string }}
 */
export function checkUrl(url, policy) {
  if (/[?#]/.test(url)) return { why: 'it has a query or a fragment' };
  let resolved;
  try {
    resolved = new URL(url, policy.baseUrl);
  } catch {
    return { why: 'it does not parse' };
  }
  if (resolved.username !== '' || resolved.password !== '')
    return { why: 'it carries credentials' };
  if (/%(?:2f|5c|2e|25)/i.test(resolved.pathname)) {
    return { why: 'its path has an encoded separator or dot' };
  }
  const href = resolved.href;
  const allowed = policy.allowedUrlPrefixes.some(
    (prefix) => prefix.endsWith('/') && href.startsWith(prefix),
  );
  return allowed ? { href } : { why: 'it is not under an allowed prefix' };
}

/**
 * The SRI string for `bytes` under `algorithm`.
 *
 * @param {Uint8Array} bytes
 * @param {'sha384' | 'sha512'} algorithm
 * @returns {Promise<string>}
 */
export async function integrityOf(bytes, algorithm = 'sha384') {
  // Copied, because WebCrypto takes an ArrayBuffer-backed view and a caller's may be shared.
  const digest = new Uint8Array(
    await crypto.subtle.digest(DIGEST_NAMES[algorithm], new Uint8Array(bytes)),
  );
  return `${algorithm}-${bytesToBase64(digest)}`;
}

/**
 * Load one plugin, or refuse it and say why.
 *
 * @param {unknown} manifest  Untrusted: whatever the registry served.
 * @param {LoaderPolicy} policy  Trusted: the deployment's own decisions.
 * @param {LoaderHost} host
 * @returns {Promise<LoadResult>}
 */
export async function loadPlugin(manifest, policy, host) {
  // One copy, read once: a getter on the caller's object cannot answer the checks one way and the
  // fetch another.
  const snapshot =
    typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
      ? Object.freeze({ ...manifest })
      : manifest;
  const malformed = checkShape(snapshot);
  if (malformed) return refuse('malformed-manifest', malformed);
  const plugin = /** @type {PluginManifest} */ (snapshot);

  const trusted = await trustedKeyFor(policy.trustedKeys, plugin.keyId);
  if ('refusal' in trusted) return trusted.refusal;

  const signature = base64UrlToBytes(plugin.signature);
  let verified = false;
  if (signature.length === 64) {
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      trusted.key,
      signature,
      new TextEncoder().encode(signedText(plugin)),
    );
  }
  if (!verified) {
    return refuse(
      'bad-signature',
      `the signature does not verify against trusted key ${JSON.stringify(plugin.keyId)}`,
    );
  }

  const pin = policy.pins.find((candidate) => candidate.id === plugin.id);
  if (!pin)
    return refuse('not-pinned', `the deployment pins no plugin ${JSON.stringify(plugin.id)}`);
  if (pin.version !== plugin.version || pin.integrity !== plugin.integrity) {
    return refuse(
      'not-pinned',
      `the deployment pins ${plugin.id} ${pin.version} (${pin.integrity}), not ${plugin.version} (${plugin.integrity})`,
    );
  }

  if (!policy.supportedApiVersions.includes(plugin.apiVersion)) {
    return refuse(
      'incompatible-api',
      `plugin API ${plugin.apiVersion} is not one this host serves (${policy.supportedApiVersions.join(', ')})`,
    );
  }

  const where = checkUrl(plugin.url, policy);
  if ('why' in where) {
    return refuse('url-not-allowed', `${JSON.stringify(plugin.url)} is refused: ${where.why}`);
  }
  const url = where.href;

  if (host.isDefined(plugin.element)) {
    return refuse(
      'element-already-defined',
      `<${plugin.element}> is already defined, so the bundle could not be shown to define it`,
    );
  }

  let bytes;
  try {
    bytes = await host.fetchBytes(url);
  } catch (error) {
    return refuse('fetch-failed', describe(error));
  }

  const algorithm = /** @type {'sha384' | 'sha512'} */ (plugin.integrity.split('-', 1)[0]);
  const actual = await integrityOf(bytes, algorithm);
  if (actual !== plugin.integrity) {
    return refuse(
      'integrity-mismatch',
      `the bytes hash to ${actual}, not the signed ${plugin.integrity}`,
    );
  }

  try {
    await host.execute(url, plugin.integrity);
  } catch (error) {
    return refuse('execute-failed', describe(error));
  }

  if (!host.isDefined(plugin.element)) {
    return refuse('element-not-defined', `the bundle ran and did not define <${plugin.element}>`);
  }

  return { ok: true, id: plugin.id, version: plugin.version, element: plugin.element, url };
}

/**
 * The members of `Document` the browser executor uses, and of the script element it makes.
 *
 * @typedef {object} ScriptDocument
 * @property {(tag: 'script') => ScriptElement} createElement
 * @property {{ append(node: any): void }} head
 */

/**
 * @typedef {object} ScriptElement
 * @property {string} type
 * @property {string} integrity
 * @property {string | null} crossOrigin
 * @property {string} referrerPolicy
 * @property {string} src
 * @property {(type: 'load' | 'error', listener: () => void) => void} addEventListener
 */

/**
 * The browser's half of `LoaderHost`, used by the host page and by the sandboxed frame's page;
 * `plugin-loader.spec.ts` holds its `execute` to the attributes below with a fake document.
 *
 * - `fetchBytes` does **not** pass `integrity` to `fetch`, so a wrong hash reaches step 10 and is
 *   reported as `integrity-mismatch` rather than as an opaque network error.
 * - `execute` **does** pass it, on a module `<script>`, so the browser itself refuses to run bytes
 *   that differ from the signed hash, whatever step 10 saw. That closes the window between the
 *   check and the run. It covers this one file only: a module the bundle imports in turn is not
 *   covered by this `integrity`, which is why the spike's bundles are single files.
 *
 * @param {ScriptDocument} document  The page's `document`, or a test's fake of these members.
 * @param {{ get(name: string): unknown }} registry  The page's `customElements`.
 * @returns {LoaderHost}
 */
export function browserLoaderHost(document, registry) {
  return {
    async fetchBytes(url) {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    execute(url, integrity) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.integrity = integrity;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () =>
          reject(
            new Error(`the browser refused to run ${url} (its integrity check, or the network)`),
          ),
        );
        script.src = url;
        document.head.append(script);
      });
    },
    isDefined(element) {
      return registry.get(element) !== undefined;
    },
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @param {string} base64
 * @returns {Uint8Array<ArrayBuffer>}
 */
function base64ToBytes(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * @param {string} base64url
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function base64UrlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
