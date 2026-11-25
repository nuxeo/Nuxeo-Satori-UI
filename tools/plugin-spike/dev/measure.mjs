#!/usr/bin/env node
// @ts-check
/**
 * What the loader's checks cost, for bundles of several sizes, in Node: the figures in the
 * report's section 6. Signature, pin, URL and hash, with the fetch and the run faked, so no
 * network is in the number. Not a gate.
 *
 *   node tools/plugin-spike/dev/measure.mjs
 */
import { integrityOf, loadPlugin } from '../src/plugin-loader.mjs';
import { generateSpikeKey, signManifest } from './sign.mjs';

const RUNS = 20;
const key = await generateSpikeKey('measure-run');

for (const size of [64 * 1024, 512 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024]) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
  const integrity = await integrityOf(bytes);
  const manifest = await signManifest(
    {
      id: 'spike.measure',
      version: '1.0.0',
      apiVersion: 1,
      element: 'spike-measure',
      url: '/plugins/measure.js',
      integrity,
    },
    key,
  );
  const policy = {
    trustedKeys: [{ keyId: key.keyId, publicKey: key.publicJwk }],
    pins: [{ id: 'spike.measure', version: '1.0.0', integrity }],
    allowedUrlPrefixes: ['https://host.test/plugins/'],
    supportedApiVersions: [1],
    baseUrl: 'https://host.test/',
  };
  const run = async () => {
    let ran = false;
    const result = await loadPlugin(manifest, policy, {
      fetchBytes: async () => bytes,
      execute: async () => {
        ran = true;
      },
      isDefined: () => ran,
    });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  };
  for (let i = 0; i < 3; i += 1) await run();
  const start = performance.now();
  for (let i = 0; i < RUNS; i += 1) await run();
  const each = (performance.now() - start) / RUNS;
  process.stdout.write(`${size / 1024} KiB: ${each.toFixed(2)} ms per load, over ${RUNS} runs\n`);
}
