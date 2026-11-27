#!/usr/bin/env node
/**
 * The bundles' size budgets: the initial bundle and each lazy chunk, held to `budgets.json`.
 *
 *   npx nx run nuxeo-ui:build:production --stats-json      # the build, with esbuild's metafile
 *   npm run beta:bundle-budgets                             # judge it
 *   npm run beta:bundle-budgets -- --report /tmp/bundles.json
 *
 * It reads the production build in `dist/nuxeo-ui/browser` and the metafile the build writes beside
 * it, `dist/nuxeo-ui/browser-stats.json`, which says which source file each output was made for and
 * what each output imports. From them:
 *
 * - **the initial bundle:** `main-<hash>.js`, every chunk it imports statically, transitively, and
 *   the global stylesheet: what the browser fetches before the first route, as Angular's own
 *   "Initial total" counts it;
 * - **each lazy chunk:** for each output made for a dynamic import (a route's `loadChildren` or
 *   `loadComponent`, or another `import()`), that output and every chunk it imports statically,
 *   transitively, that is not in the initial bundle: what opening it costs beyond the first load.
 *
 * Sizes are the files' bytes on disk, as built, not compressed: deterministic, and what Angular's
 * own budgets count. The compressed size is reported beside them, for reading, not judged.
 *
 * Exit codes, as the beta harness's: 0 within budget; 1 over it, with each line that is over named
 * with its number and its budget; 2 a precondition not met (no build, or no metafile).
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { failures, judgeBundles, lazyChunkId, lowered, readBudgets, table } from './budgets.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
export const DIST = join(ROOT, 'dist/nuxeo-ui/browser');
export const STATS = join(ROOT, 'dist/nuxeo-ui/browser-stats.json');
const MAIN_ENTRY = 'apps/nuxeo-ui/src/main.ts';

/** Every output reachable from `start` by static imports, stopping at any in `stop`. */
export function staticClosure(outputs, start, stop = new Set()) {
  const seen = new Set();
  const pending = [...start];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file) || stop.has(file) || !outputs[file]) continue;
    seen.add(file);
    for (const imported of outputs[file].imports ?? []) {
      if (imported.kind === 'import-statement') pending.push(imported.path);
    }
  }
  return seen;
}

/**
 * The build's measures, from its metafile's outputs and a way to read each file's bytes.
 *
 * @param {Record<string, { entryPoint?: string, imports?: { path: string, kind: string }[] }>} outputs
 * @param {(file: string) => number} sizeOf the file's bytes
 * @param {(file: string) => number} [gzippedSizeOf]
 */
export function measureBundles(outputs, sizeOf, gzippedSizeOf = () => Number.NaN) {
  const files = Object.keys(outputs);
  const main = files.find((file) => outputs[file].entryPoint === MAIN_ENTRY);
  if (!main) throw new Error(`the metafile has no output for ${MAIN_ENTRY}`);
  const initial = staticClosure(outputs, [main]);
  const styles = files.filter((file) => file.endsWith('.css') && outputs[file].entryPoint);
  const sum = (set, read) => [...set].reduce((total, file) => total + read(file), 0);
  const initialFiles = new Set([...initial, ...styles]);
  const lazy = {};
  const detail = {};
  for (const file of files) {
    const entry = outputs[file].entryPoint;
    if (!entry || file === main || !file.endsWith('.js') || initial.has(file)) continue;
    const id = lazyChunkId(entry);
    const closure = staticClosure(outputs, [file], initial);
    const bytes = sum(closure, sizeOf);
    // Two entries of one id, which a rename could make: the larger is what opening it can cost.
    if (lazy[id] === undefined || bytes > lazy[id]) {
      lazy[id] = bytes;
      detail[id] = {
        entryPoint: entry,
        file,
        files: [...closure].sort(),
        bytes,
        gzipBytes: sum(closure, gzippedSizeOf),
      };
    }
  }
  return {
    initialBytes: sum(initialFiles, sizeOf),
    initialGzipBytes: sum(initialFiles, gzippedSizeOf),
    initialFiles: [...initialFiles].sort(),
    lazy,
    detail,
  };
}

function exitWith(code, message) {
  console.error(message);
  process.exit(code);
}

function parse() {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: DIST },
      stats: { type: 'string', default: STATS },
      report: { type: 'string' },
      // A control: one budget set to this limit, on purpose; the run must then fail on it.
      lower: { type: 'string', multiple: true, default: [] },
    },
    strict: true,
  });
  return values;
}

export function parseLowered(specs) {
  return specs.map((spec) => {
    const match = /^([^=]+)=(\d+)$/.exec(spec);
    if (!match) throw new Error(`--lower ${spec}: <budget id>=<whole limit>`);
    return { id: match[1], limit: Number(match[2]) };
  });
}

function main() {
  const options = parse();
  if (!existsSync(join(options.dist, 'index.html'))) {
    exitWith(
      2,
      `no production build at ${options.dist}: run npx nx run nuxeo-ui:build:production --stats-json`,
    );
  }
  if (!existsSync(options.stats)) {
    exitWith(2, `no metafile at ${options.stats}: build with --stats-json`);
  }
  let budgets = readBudgets();
  let lowers;
  try {
    lowers = parseLowered(options.lower);
    for (const { id, limit } of lowers) budgets = lowered(budgets, id, limit);
  } catch (error) {
    exitWith(2, error.message);
  }
  const { outputs } = JSON.parse(readFileSync(options.stats, 'utf8'));
  const sizeOf = (file) => statSync(join(options.dist, file)).size;
  const gzippedSizeOf = (file) => gzipSync(readFileSync(join(options.dist, file))).length;
  const measured = measureBundles(outputs, sizeOf, gzippedSizeOf);
  const judged = judgeBundles(measured, budgets);
  const report = { kind: 'bundles', lowered: lowers, measured, judged, pass: judged.pass };
  if (options.report)
    writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);

  console.log(table(judged));
  console.log(
    `\ninitial bundle: ${measured.initialBytes.toLocaleString('en')} bytes, ${measured.initialGzipBytes.toLocaleString('en')} gzipped, ${measured.initialFiles.length} files`,
  );
  if (lowers.length > 0) {
    console.log(
      `control: ${lowers.map(({ id, limit }) => `${id} lowered to ${limit}`).join(', ')}`,
    );
  }
  const over = failures(judged);
  if (over.length > 0) {
    for (const each of over) console.error(each);
    process.exit(1);
  }
  console.log(
    `within budget: the initial bundle and ${Object.keys(measured.lazy).length} lazy chunks`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
