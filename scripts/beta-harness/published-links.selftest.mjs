#!/usr/bin/env node
/**
 * Controls for `published-links.mjs`, against a local HTTP server rather than the web.
 *
 * The gate itself only ever observes one state of the world at a time — today both of its lists
 * happen to be correct — so nothing about a real run distinguishes a working check from one that
 * returns pass unconditionally. These drive all four outcomes on purpose:
 *
 *   advertised + alive  -> pass          known-dead + dead   -> pass
 *   advertised + dead   -> FAIL          known-dead + alive  -> FAIL
 *
 * The last of those is the one worth having: a ledger entry that outlives the problem it records
 * is how `docs/pages-redirect/README.md` would come to describe a 404 that somebody had quietly
 * fixed, with this gate green the whole time.
 *
 * Usage:  node scripts/beta-harness/published-links.selftest.mjs
 */

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { NOT_RUN_EXIT_CODE } from './gate-summary.mjs';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..', '..');
const script = join(here, 'published-links.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'published-links-selftest-'));

const controls = [];
/* `async`, and awaited one at a time. The first version used `spawnSync`, which blocks the event
 * loop of the very process hosting the fixture server, so every request timed out and three
 * controls "failed" for a reason that had nothing to do with the gate. */
async function control(name, fn) {
  try {
    await fn();
    controls.push({ name, ok: true });
  } catch (error) {
    controls.push({ name, ok: false, why: error.message });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** `/alive` answers 200, `/moved` 301 to `/alive`, anything else 404. */
const server = createServer((req, res) => {
  if (req.url === '/alive') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>alive</title>');
    return;
  }
  if (req.url === '/moved') {
    res.writeHead(301, { location: '/alive' });
    res.end();
    return;
  }
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>not found</title>');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;

let fixtureCount = 0;
function run(ledger, env = {}) {
  const path = join(workspace, `ledger-${(fixtureCount += 1)}.json`);
  writeFileSync(path, JSON.stringify(ledger), 'utf8');
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, '--ledger', path],
      { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        done({
          status: error ? (error.code ?? 1) : 0,
          stdout,
          stderr,
          output: `${stdout}${stderr}`,
        });
      },
    );
  });
}

const advertised = (path) => ({ url: `${origin}${path}`, advertisedIn: 'a control' });
const dead = (path) => ({
  url: `${origin}${path}`,
  why: 'a control',
  owner: 'a control',
  fix: 'a control',
});

await control('an advertised URL that answers 200 passes', async () => {
  const proc = await run({ advertised: [advertised('/alive')], knownDead: [] });
  expect(proc.status === 0, `exited ${proc.status}:\n${proc.output}`);
  expect(/alive {2}200/.test(proc.stdout), `no alive line:\n${proc.stdout}`);
});

await control(
  'an advertised URL that redirects to a live page passes, and names the destination',
  async () => {
    const proc = await run({ advertised: [advertised('/moved')], knownDead: [] });
    expect(proc.status === 0, `exited ${proc.status}:\n${proc.output}`);
    expect(/\(via .*\/alive\)/.test(proc.stdout), `the chain is not reported:\n${proc.stdout}`);
  },
);

await control('an advertised URL that 404s FAILS, and says where it is advertised', async () => {
  const proc = await run({ advertised: [advertised('/gone')], knownDead: [] });
  expect(proc.status === 1, `exited ${proc.status}, expected 1:\n${proc.output}`);
  expect(/is advertised in a control and answers 404/.test(proc.output), proc.output.slice(-400));
});

await control('an advertised URL that does not resolve at all FAILS', async () => {
  /* Distinct from a 404: a DNS or connection failure is `status: null`, which an `alive` test
   * written as `status !== 404` would have treated as alive. */
  const proc = await run({
    advertised: [{ url: 'http://127.0.0.1:1/nothing-listens-here', advertisedIn: 'a control' }],
    knownDead: [],
  });
  expect(proc.status === 1, `exited ${proc.status}, expected 1:\n${proc.output}`);
  expect(/answers no response/.test(proc.output), proc.output.slice(-400));
});

await control(
  'a known-dead URL that is still dead passes, and names who owns the fix',
  async () => {
    const proc = await run({ advertised: [], knownDead: [dead('/gone')] });
    expect(proc.status === 0, `exited ${proc.status}:\n${proc.output}`);
    expect(/dead {3}404 .*a control owns the fix/.test(proc.stdout), proc.stdout);
  },
);

await control(
  'a known-dead URL that has started answering FAILS, with the ledger entry to delete',
  async () => {
    /* The control that makes the rest mean something. Everything else here is a liveness check,
     * which rots in the one direction nobody looks: towards a record of a problem that is over. */
    const proc = await run({ advertised: [], knownDead: [dead('/alive')] });
    expect(proc.status === 1, `exited ${proc.status}, expected 1:\n${proc.output}`);
    expect(/recorded as dead and now answers 200/.test(proc.output), proc.output.slice(-500));
    expect(/Move it to ADVERTISED/.test(proc.output), 'it does not say what to do');
  },
);

await control('an empty ledger is not a pass', async () => {
  const proc = await run({ advertised: [], knownDead: [] });
  expect(proc.status === 1, `exited ${proc.status}, expected 1`);
  expect(/checked nothing/.test(proc.output), proc.output.slice(-300));
});

await control('the skip reports NOT RUN with the not-run exit code, never green', async () => {
  const proc = await run(
    { advertised: [advertised('/alive')], knownDead: [] },
    {
      BETA_SKIP_PUBLISHED_LINKS: '1',
    },
  );
  expect(proc.status === NOT_RUN_EXIT_CODE, `exited ${proc.status}, expected ${NOT_RUN_EXIT_CODE}`);
  expect(/NOT RUN/.test(proc.stdout), proc.stdout);
  expect(/1 advertised and 0 known-dead/.test(proc.stdout), 'it does not say what it skipped');
});

server.close();
rmSync(workspace, { recursive: true, force: true });

for (const c of controls)
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
const failed = controls.filter((c) => !c.ok).length;
console.log(
  failed
    ? `\npublished-links selftest: FAIL — ${failed} of ${controls.length} control(s) failed.`
    : `\npublished-links selftest: pass — ${controls.length} control(s), 4 of them negative.`,
);
process.exit(failed ? 1 : 0);
