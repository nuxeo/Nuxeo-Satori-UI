// @ts-check
/**
 * The publisher's half of the spike, for its tests and its demo server only: make a key, and sign
 * a manifest with it.
 *
 * **Every key this file makes lives in memory for one process and is trusted nowhere.** No key is
 * written to disk or committed; `checkPluginSpikeIsolated` fails if a private key appears under
 * `tools/plugin-spike/`. A real publisher would sign in CI with a key it never sees (a KMS, or
 * Sigstore's keyless signing, as docs/business-apps/package-pipeline.md section 9 proposes), and a
 * host would never hold this code at all: the loader only verifies.
 */
import { bytesToBase64Url, signedText } from '../src/plugin-loader.mjs';

/**
 * @typedef {object} SpikeSigningKey
 * @property {string} keyId
 * @property {CryptoKey} privateKey  Not extractable: it cannot leave this process.
 * @property {JsonWebKey} publicJwk  The public half, as a host's trust root would hold it.
 */

/**
 * A fresh ECDSA P-256 key pair, for one run.
 *
 * @param {string} keyId
 * @returns {Promise<SpikeSigningKey>}
 */
export async function generateSpikeKey(keyId) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // Re-import the private half as non-extractable, and drop the extractable original.
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return {
    keyId,
    privateKey,
    publicJwk: { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y },
  };
}

/**
 * The manifest's fields, signed by `key`, with `keyId` set to `key.keyId` unless `keyIdOverride`
 * says otherwise. The override exists for one test: a key the host does not trust claiming the id
 * of one it does.
 *
 * @param {Omit<import('../src/plugin-loader.mjs').PluginManifest, 'keyId' | 'signature'>} fields
 * @param {SpikeSigningKey} key
 * @param {string} [keyIdOverride]
 * @returns {Promise<import('../src/plugin-loader.mjs').PluginManifest>}
 */
export async function signManifest(fields, key, keyIdOverride) {
  const unsigned = { ...fields, keyId: keyIdOverride ?? key.keyId };
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      new TextEncoder().encode(signedText(unsigned)),
    ),
  );
  return { ...unsigned, signature: bytesToBase64Url(signature) };
}
