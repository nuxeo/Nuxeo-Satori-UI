// @ts-check
/**
 * The demo's scenarios: one plugin that must load, and one manifest or bundle per way of getting
 * it wrong. Built fresh for every run, with keys made for that run (`generateSpikeKey`), so no key
 * outlives the process and none is ever written down.
 *
 * Shared by the demo server (`serve.mjs`) and by the tests, which run every scenario through the
 * loader in Node and hold each to its `expected` outcome.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { integrityOf } from '../src/plugin-loader.mjs';
import { generateSpikeKey, signManifest } from './sign.mjs';

export const SAMPLE_PLUGIN_PATH = fileURLToPath(
  new URL('../sample/sample-plugin.js', import.meta.url),
);

export const PLUGIN_ID = 'spike.sample-plugin';
export const PLUGIN_ELEMENT = 'spike-sample-plugin';
export const PINNED_VERSION = '1.0.0';

/**
 * The sample plugin with code appended, as an attacker who could write to the plugin store would.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function tamper(bytes) {
  const appended = new TextEncoder().encode('\nwindow.__spikeTampered = true;\n');
  const out = new Uint8Array(bytes.length + appended.length);
  out.set(bytes, 0);
  out.set(appended, bytes.length);
  return out;
}

/**
 * @typedef {object} DemoScenario
 * @property {string} name
 * @property {string} expected  `loaded`, or the refusal reason the loader must give.
 * @property {boolean} [frame]  Run in a sandboxed iframe rather than the host's page.
 * @property {import('../src/plugin-loader.mjs').PluginManifest} manifest
 */

/**
 * @typedef {object} DemoBundle  What the server answers for one plugin path.
 * @property {Uint8Array} first  The bytes of the first request.
 * @property {Uint8Array} later  The bytes of every request after it.
 * @property {boolean} cors      Whether an opaque-origin frame may read it.
 */

/**
 * @param {string} origin  The demo server's own origin, such as `http://127.0.0.1:4410`.
 * @returns {Promise<{
 *   policy: import('../src/plugin-loader.mjs').LoaderPolicy,
 *   scenarios: DemoScenario[],
 *   bundles: Map<string, DemoBundle>,
 *   trustedKeyId: string,
 * }>}
 */
export async function buildDemo(origin) {
  const bytes = new Uint8Array(readFileSync(SAMPLE_PLUGIN_PATH));
  const tampered = tamper(bytes);
  const integrity = await integrityOf(bytes);
  const tamperedIntegrity = await integrityOf(tampered);

  const trusted = await generateSpikeKey('spike-run-trusted');
  const attacker = await generateSpikeKey('spike-run-attacker');

  const base = {
    id: PLUGIN_ID,
    version: PINNED_VERSION,
    apiVersion: 1,
    element: PLUGIN_ELEMENT,
    integrity,
  };
  const good = await signManifest({ ...base, url: '/plugins/good/sample-plugin.js' }, trusted);

  /** @type {DemoScenario[]} */
  // The refusals first: an element can be defined once per page, so once the good plugin has run,
  // the loader would refuse every later one in the page as `element-already-defined`.
  const scenarios = [
    {
      name: 'tampered bundle',
      expected: 'integrity-mismatch',
      manifest: await signManifest({ ...base, url: '/plugins/tampered/sample-plugin.js' }, trusted),
    },
    {
      name: 'tampered bundle, hash updated, not re-signed',
      expected: 'bad-signature',
      manifest: {
        ...good,
        integrity: tamperedIntegrity,
        url: '/plugins/tampered/sample-plugin.js',
      },
    },
    {
      name: 'signed by a key the deployment does not trust',
      expected: 'untrusted-key',
      manifest: await signManifest({ ...base, url: '/plugins/good/sample-plugin.js' }, attacker),
    },
    {
      name: "forged under the trusted key's id",
      expected: 'bad-signature',
      manifest: await signManifest(
        { ...base, url: '/plugins/good/sample-plugin.js' },
        attacker,
        trusted.keyId,
      ),
    },
    {
      name: 'an older version, validly signed (rollback)',
      expected: 'not-pinned',
      manifest: await signManifest(
        {
          ...base,
          version: '0.9.0',
          integrity: tamperedIntegrity,
          url: '/plugins/old/sample-plugin.js',
        },
        trusted,
      ),
    },
    {
      name: 'URL outside the plugin store',
      expected: 'url-not-allowed',
      manifest: await signManifest({ ...base, url: '/elsewhere/sample-plugin.js' }, trusted),
    },
    {
      name: 'bytes swapped between the check and the run',
      expected: 'execute-failed',
      manifest: await signManifest({ ...base, url: '/plugins/swap/sample-plugin.js' }, trusted),
    },
    { name: 'signed, pinned, intact', expected: 'loaded', manifest: good },
    {
      name: 'signed, pinned, intact, in a sandboxed iframe',
      expected: 'loaded',
      frame: true,
      manifest: await signManifest({ ...base, url: '/plugins/frame/sample-plugin.js' }, trusted),
    },
  ];

  /** @type {Map<string, DemoBundle>} */
  const bundles = new Map([
    ['/plugins/good/sample-plugin.js', { first: bytes, later: bytes, cors: false }],
    ['/plugins/tampered/sample-plugin.js', { first: tampered, later: tampered, cors: false }],
    ['/plugins/old/sample-plugin.js', { first: tampered, later: tampered, cors: false }],
    // The check reads the first answer; the browser's own load gets the second.
    ['/plugins/swap/sample-plugin.js', { first: bytes, later: tampered, cors: false }],
    ['/plugins/frame/sample-plugin.js', { first: bytes, later: bytes, cors: true }],
  ]);

  return {
    policy: {
      trustedKeys: [{ keyId: trusted.keyId, publicKey: trusted.publicJwk }],
      pins: [{ id: PLUGIN_ID, version: PINNED_VERSION, integrity }],
      allowedUrlPrefixes: [`${origin}/plugins/`],
      supportedApiVersions: [1],
      baseUrl: `${origin}/`,
    },
    scenarios,
    bundles,
    trustedKeyId: trusted.keyId,
  };
}
