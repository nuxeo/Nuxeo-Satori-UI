#!/usr/bin/env node
/**
 * Controls for `storybook-assemble-site.mjs`. The failure it guards against is a site that
 * deploys successfully and is empty, so every negative control asserts both that it refuses AND
 * that it wrote nothing: a refusal that leaves half a site behind is not a refusal.
 *
 * Fixtures are stub Storybooks — the real builds take minutes and prove nothing extra here, since
 * what is under test is the laying-out, not the building.
 *
 * Usage:  node scripts/storybook-assemble-site.selftest.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const SCRIPT = resolve(import.meta.dirname, 'storybook-assemble-site.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'storybook-assemble-site-selftest-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
/** A fresh directory per control, so one never sees another's leftovers. */
const scratch = () => {
  counter += 1;
  const dir = join(workspace, `case-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * A stub Storybook. `omit` drops one required file; `entries` of 0 writes an empty index.
 *
 * `marker` goes into every file, so the two fixtures are distinguishable once copied. They used to
 * be byte-identical, which made the happy path tautological: swapping the two copy sources passed
 * every assertion, so the controls did not test the one thing they are named for. Keep them
 * distinct.
 * @param {string} dir
 * @param {{ omit?: string, entries?: number, extra?: string, marker?: string }} [options]
 */
function storybook(dir, { omit, entries = 2, extra, marker = 'unmarked' } = {}) {
  mkdirSync(dir, { recursive: true });
  if (omit !== 'index.html') writeFileSync(join(dir, 'index.html'), `<html>${marker} index</html>`);
  if (omit !== 'iframe.html')
    writeFileSync(join(dir, 'iframe.html'), `<html>${marker} frame</html>`);
  const index = Object.fromEntries(
    Array.from({ length: entries }, (_, i) => [
      `${marker}-story--${i}`,
      { title: `${marker} ${i}` },
    ]),
  );
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ entries: index }));
  if (extra) mkdirSync(join(dir, extra), { recursive: true });
  return dir;
}

/** Runs the script and resolves with its exit code and output, however it exits. */
function assemble({ material, satori, out }) {
  const argv = [];
  if (material !== undefined) argv.push('--material', material);
  if (satori !== undefined) argv.push('--satori', satori);
  if (out !== undefined) argv.push('--out', out);
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...argv], (error, stdout, stderr) => {
      done({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** @param {string} dir */
const isEmpty = (dir) => !existsSync(dir) || readdirSync(dir).length === 0;

test('lays Material at the root and Satori under /satori', async () => {
  const dir = scratch();
  const out = join(dir, 'site');
  const result = await assemble({
    material: storybook(join(dir, 'material'), { marker: 'MATERIAL' }),
    satori: storybook(join(dir, 'satori-theme'), { marker: 'SATORI' }),
    out,
  });
  assert.equal(result.code, 0, result.stderr);

  // Which build landed where, not merely that something did. Asserting presence alone passes just
  // as happily when the two sources are swapped, which is the whole requirement reversed.
  for (const file of ['index.html', 'iframe.html', 'index.json']) {
    const root = readFileSync(join(out, file), 'utf8');
    const satori = readFileSync(join(out, 'satori', file), 'utf8');
    assert.match(root, /MATERIAL/, `/${file} should come from the Material build`);
    assert.doesNotMatch(root, /SATORI/, `/${file} must not come from the Satori build`);
    assert.match(satori, /SATORI/, `/satori/${file} should come from the Satori build`);
    assert.doesNotMatch(
      satori,
      /MATERIAL/,
      `/satori/${file} must not come from the Material build`,
    );
  }
  assert.match(result.stdout, /Material at \/, Satori at \/satori\//);
});

// Each of these must refuse AND write nothing.
const REFUSALS = [
  {
    name: 'the Material build does not exist',
    build: (dir) => ({
      material: join(dir, 'absent'),
      satori: storybook(join(dir, 'satori-theme')),
    }),
    expect: /--material .* does not exist/,
  },
  {
    name: 'the Satori build does not exist',
    build: (dir) => ({
      material: storybook(join(dir, 'material')),
      satori: join(dir, 'absent'),
    }),
    expect: /--satori .* does not exist/,
  },
  {
    name: 'the Material build has no iframe.html',
    build: (dir) => ({
      material: storybook(join(dir, 'material'), { omit: 'iframe.html' }),
      satori: storybook(join(dir, 'satori-theme')),
    }),
    expect: /--material .* is not a Storybook build \(no iframe\.html\)/,
  },
  {
    name: 'the Satori build has no index.html',
    build: (dir) => ({
      material: storybook(join(dir, 'material')),
      satori: storybook(join(dir, 'satori-theme'), { omit: 'index.html' }),
    }),
    expect: /--satori .* is not a Storybook build \(no index\.html\)/,
  },
  {
    name: 'the Material build indexes no stories',
    build: (dir) => ({
      material: storybook(join(dir, 'material'), { entries: 0 }),
      satori: storybook(join(dir, 'satori-theme')),
    }),
    expect: /--material .* has no index\.json listing a story/,
  },
  {
    name: 'the Satori build indexes no stories — the blank-site case',
    build: (dir) => ({
      material: storybook(join(dir, 'material')),
      satori: storybook(join(dir, 'satori-theme'), { entries: 0 }),
    }),
    expect: /--satori .* has no index\.json listing a story/,
  },
  {
    name: 'the Material build already has a satori/ entry to be overwritten',
    build: (dir) => ({
      material: storybook(join(dir, 'material'), { extra: 'satori' }),
      satori: storybook(join(dir, 'satori-theme')),
    }),
    expect: /already contains a "satori" entry/,
  },
  {
    name: 'both builds are missing',
    build: (dir) => ({ material: join(dir, 'a'), satori: join(dir, 'b') }),
    expect: /does not exist/,
  },
];

for (const refusal of REFUSALS) {
  test(`refuses, and writes nothing, when ${refusal.name}`, async () => {
    const dir = scratch();
    const out = join(dir, 'site');
    const result = await assemble({ ...refusal.build(dir), out });
    assert.equal(result.code, 1, `expected exit 1\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, refusal.expect);
    assert.match(result.stderr, /Nothing written/);
    assert.ok(isEmpty(out), `${out} should be empty, holds: ${JSON.stringify(safeList(out))}`);
  });
}

test('refuses bad usage with exit 2, distinctly from a bad build', async () => {
  const dir = scratch();
  for (const argv of [
    { material: storybook(join(dir, 'material')) },
    { satori: storybook(join(dir, 'satori-theme')), out: join(dir, 'site') },
    {},
  ]) {
    const result = await assemble(argv);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /^Usage: /m);
  }
});

/** @param {string} dir */
function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
