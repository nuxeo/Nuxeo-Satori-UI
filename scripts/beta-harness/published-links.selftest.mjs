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

/**
 * A **negative** control requires the gate NOT to report a pass — it asserts a FAIL or a NOT RUN.
 * A positive one requires a clean tree to stay green.
 *
 * Declared per control and counted, never written into the summary by hand. The summary used to
 * say "4 of them negative" and I edited it to "5" in the same sitting that added three controls,
 * without recounting — so by its own definition it was wrong when review pointed at it, and the
 * right count is 7. This file's sibling `review-guardrails.selftest.mjs` already carries a note
 * about the same defect ("the summary hardcoded 'eight' while the list held nine"), which is how
 * little a number in prose is worth next to a list it does not come from.
 *
 * The declaration is checked against the control's own assertion below, so it cannot drift either.
 */
const NEGATIVE = { negative: true };
const POSITIVE = { negative: false };

/* `async`, and awaited one at a time. The first version used `spawnSync`, which blocks the event
 * loop of the very process hosting the fixture server, so every request timed out and three
 * controls "failed" for a reason that had nothing to do with the gate. */
async function control(name, { negative }, fn) {
  try {
    await fn();
    controls.push({ name, ok: true, negative });
  } catch (error) {
    controls.push({ name, ok: false, negative, why: error.message });
  }
}

/**
 * Asserts the child's exit code and records what kind of outcome it was, so the negative/positive
 * split is derived from what each control actually required rather than from a label.
 *
 * A declaration that disagrees with the assertion is itself a failure: a control marked positive
 * while demanding a non-zero exit would otherwise quietly change what the summary means.
 */
function expectExit(proc, expected, { negative }) {
  const isPass = expected === 0;
  if (negative === isPass) {
    throw new Error(
      `this control is declared ${negative ? 'negative' : 'positive'} but requires exit ` +
        `${expected}; a negative control is one that requires the gate not to pass`,
    );
  }
  expect(proc.status === expected, `exited ${proc.status}, expected ${expected}:\n${proc.output}`);
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
  /* `BETA_SKIP_PUBLISHED_LINKS` is deleted from the inherited environment before each control's
   * own override is applied.
   *
   * Without that, running the documented offline path — `BETA_SKIP_PUBLISHED_LINKS=1 npm run
   * beta:gate`, which is how this gate is meant to be skipped — leaked the flag into all eight
   * children, every one exited with the not-run code instead of 0 or 1, and seven controls
   * failed. So the skip that is supposed to make the run `pass-incomplete` made it FAIL instead,
   * one gate later. Review caught it (PR #544); `expectSkipControl` below is the one control that
   * sets the flag back on, deliberately. */
  const inherited = { ...process.env };
  delete inherited['BETA_SKIP_PUBLISHED_LINKS'];
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, '--ledger', path],
      { cwd: repoRoot, encoding: 'utf8', env: { ...inherited, ...env } },
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

await control('an advertised URL that answers 200 passes', POSITIVE, async () => {
  const proc = await run({ advertised: [advertised('/alive')], knownDead: [] });
  expectExit(proc, 0, POSITIVE);
  expect(/alive {2}200/.test(proc.stdout), `no alive line:\n${proc.stdout}`);
});

await control(
  'an advertised URL that redirects to a live page passes, and names the destination',
  POSITIVE,
  async () => {
    const proc = await run({ advertised: [advertised('/moved')], knownDead: [] });
    expectExit(proc, 0, POSITIVE);
    expect(/\(via .*\/alive\)/.test(proc.stdout), `the chain is not reported:\n${proc.stdout}`);
  },
);

await control(
  'an advertised URL that 404s FAILS, and says where it is advertised',
  NEGATIVE,
  async () => {
    const proc = await run({ advertised: [advertised('/gone')], knownDead: [] });
    expectExit(proc, 1, NEGATIVE);
    expect(/is advertised in a control and answers 404/.test(proc.output), proc.output.slice(-400));
  },
);

/** A port nothing listens on, so the probe gets no HTTP response of any kind. */
const UNANSWERED = 'http://127.0.0.1:1/nothing-listens-here';

await control(
  'an advertised URL that does not resolve at all reports NOT RUN',
  NEGATIVE,
  async () => {
    /* Distinct from a 404 in both directions: a DNS or connection failure is `status: null`, which
     * an `alive` test written as `status !== 404` would read as alive, and which the first version
     * of this gate read as a definite FAIL. Neither is right — a refused connection is the
     * network, not a dead published address — so it is an inspection gap and the gate says so. */
    const proc = await run({
      advertised: [{ url: UNANSWERED, advertisedIn: 'a control' }],
      knownDead: [],
    });
    expectExit(proc, NOT_RUN_EXIT_CODE, NEGATIVE);
    expect(/gave no response/.test(proc.output), proc.output.slice(-400));
    expect(!/^published-links: pass/m.test(proc.stdout), 'it claimed a pass over a gap');
  },
);

await control(
  'a known-dead URL that does not answer is NOT RUN, not evidence that it is still dead',
  NEGATIVE,
  async () => {
    /* The hole review found (PR #544). `status: null` fell through the `!alive` branch and was
     * recorded as "dead — owner owns the fix", so the gate could report pass having established
     * neither direction. This is the control that would have caught it. */
    const proc = await run({
      advertised: [],
      knownDead: [{ url: UNANSWERED, why: 'a control', owner: 'a control', fix: 'a control' }],
    });
    expectExit(proc, NOT_RUN_EXIT_CODE, NEGATIVE);
    expect(
      /does not confirm the record/.test(proc.output),
      `it did not say why the probe proves nothing:\n${proc.output.slice(-400)}`,
    );
    expect(
      !/ {2}dead {3}/.test(proc.stdout),
      `an unanswered probe was still logged as confirmed dead:\n${proc.stdout}`,
    );
  },
);

await control(
  'a definite failure outranks a gap, so one dead address cannot be masked',
  NEGATIVE,
  async () => {
    /* Otherwise an unreachable entry would downgrade the whole run to NOT RUN and hide a genuinely
     * dead advertised address sitting beside it. */
    const proc = await run({
      advertised: [advertised('/gone'), { url: UNANSWERED, advertisedIn: 'a control' }],
      knownDead: [],
    });
    expectExit(proc, 1, NEGATIVE);
    expect(/answers 404/.test(proc.output), 'the definite finding is not reported');
    expect(/UNANSWERED:/.test(proc.output), 'the gap is not reported alongside it');
  },
);

await control(
  'a known-dead URL that is still dead passes, and names who owns the fix',
  POSITIVE,
  async () => {
    const proc = await run({ advertised: [], knownDead: [dead('/gone')] });
    expectExit(proc, 0, POSITIVE);
    expect(/dead {3}404 .*a control owns the fix/.test(proc.stdout), proc.stdout);
  },
);

await control(
  'a known-dead URL that has started answering FAILS, with the ledger entry to delete',
  NEGATIVE,
  async () => {
    /* The control that makes the rest mean something. Everything else here is a liveness check,
     * which rots in the one direction nobody looks: towards a record of a problem that is over. */
    const proc = await run({ advertised: [], knownDead: [dead('/alive')] });
    expectExit(proc, 1, NEGATIVE);
    expect(/recorded as dead and now answers 200/.test(proc.output), proc.output.slice(-500));
    expect(/Move it to ADVERTISED/.test(proc.output), 'it does not say what to do');
  },
);

await control('an empty ledger is not a pass', NEGATIVE, async () => {
  const proc = await run({ advertised: [], knownDead: [] });
  expectExit(proc, 1, NEGATIVE);
  expect(/checked nothing/.test(proc.output), proc.output.slice(-300));
});

/* `--ledger` misuse. Each case refuses in the gate's own voice and exits 1 rather than throwing a
 * stack trace. All of them are negative: none may report a pass.
 *
 * It already failed safe before this — an unhandled throw is exit 1 — so what these controls pin
 * is the diagnostic, which is the part a stack trace destroys. */
const LEDGER_MISUSE = [
  /* Entry-level validation, reported on PR #554. The list-shape check stopped at "is it an
   * array", and the two cases review named were half of it — all four were driven against the
   * real gate before fixing. The first is the worst: NOT RUN is the verdict for "I could not find
   * out", and spending it on a malformed ledger makes a real inspection gap and a typo identical. */
  [
    'an entry that is not an object',
    () => ['--ledger', fixtureFile('e1.json', '{"advertised":[null]}')],
    /"advertised"\[0\] as null/,
  ],
  [
    'an entry with no url',
    () => ['--ledger', fixtureFile('e2.json', '{"advertised":[{}]}')],
    /"advertised"\[0\] with no "url" string/,
  ],
  [
    'a url that is not a URL',
    () => [
      '--ledger',
      fixtureFile('e3.json', '{"advertised":[{"url":"not a url","advertisedIn":"x"}]}'),
    ],
    /whose "url" is not a URL/,
  ],
  [
    'a non-http scheme',
    () => [
      '--ledger',
      fixtureFile('e4.json', '{"advertised":[{"url":"file:///etc/passwd","advertisedIn":"x"}]}'),
    ],
    /with the scheme `file:`/,
  ],
  [
    'an advertised entry with no advertisedIn',
    () => ['--ledger', fixtureFile('e5.json', '{"advertised":[{"url":"https://example.test/"}]}')],
    /with no "advertisedIn"/,
  ],
  [
    'a known-dead entry with no owner',
    () => [
      '--ledger',
      fixtureFile('e6.json', '{"knownDead":[{"url":"https://example.test/","why":"x","fix":"x"}]}'),
    ],
    /with no "owner"/,
  ],
  [
    'the same url in both lists',
    () => [
      '--ledger',
      fixtureFile(
        'e7.json',
        '{"advertised":[{"url":"https://example.test/","advertisedIn":"x"}],"knownDead":[{"url":"https://example.test/","why":"x","owner":"x","fix":"x"}]}',
      ),
    ],
    /in both "advertised"\[0\] and "knownDead"\[0\]/,
  ],

  ['no path at all', () => ['--ledger'], /needs a path, and was given nothing/],
  [
    'a flag where the path should be',
    () => ['--ledger', '--json'],
    /needs a path, and was given `--json`/,
  ],
  [
    'a path that does not exist',
    () => ['--ledger', join(workspace, 'absent.json')],
    /could not read/,
  ],
  [
    'a file that is not JSON',
    () => ['--ledger', fixtureFile('not.json', 'this is not json')],
    /is not valid JSON/,
  ],
  [
    'JSON that is not an object',
    () => ['--ledger', fixtureFile('array.json', '[1,2,3]')],
    /must hold a JSON object/,
  ],
  [
    'a list field that is not a list',
    () => ['--ledger', fixtureFile('bad.json', '{"advertised":"nope"}')],
    /has "advertised" as string/,
  ],
];

/** Writes a fixture under the workspace and returns its path. */
function fixtureFile(name, body) {
  const path = join(workspace, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

/** Runs the gate with raw argv, bypassing `run()`'s ledger-file plumbing. */
function runArgv(argv) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, ...argv],
      { cwd: repoRoot, encoding: 'utf8' },
      (error, stdout, stderr) =>
        done({
          status: error ? (error.code ?? 1) : 0,
          stdout,
          stderr,
          output: `${stdout}${stderr}`,
        }),
    );
  });
}

for (const [label, argvOf, expected] of LEDGER_MISUSE) {
  await control(`--ledger with ${label} refuses in the gate's voice`, NEGATIVE, async () => {
    const proc = await runArgv(argvOf());
    expectExit(proc, 1, NEGATIVE);
    expect(expected.test(proc.output), `the refusal did not say why:\n${proc.output.slice(-400)}`);
    expect(
      /Usage: node scripts\/beta-harness\/published-links\.mjs/.test(proc.output),
      'the refusal does not say how to invoke it correctly',
    );
    expect(
      !/^\s+at /m.test(proc.output),
      `it threw a stack trace instead of refusing:\n${proc.output.slice(0, 400)}`,
    );
  });
}

await control(
  'the skip reports NOT RUN with the not-run exit code, never green',
  NEGATIVE,
  async () => {
    const proc = await run(
      { advertised: [advertised('/alive')], knownDead: [] },
      {
        BETA_SKIP_PUBLISHED_LINKS: '1',
      },
    );
    expectExit(proc, NOT_RUN_EXIT_CODE, NEGATIVE);
    expect(/NOT RUN/.test(proc.stdout), proc.stdout);
    expect(/1 advertised and 0 known-dead/.test(proc.stdout), 'it does not say what it skipped');
  },
);

server.close();
rmSync(workspace, { recursive: true, force: true });

for (const c of controls)
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
const failed = controls.filter((c) => !c.ok).length;
const negative = controls.filter((c) => c.negative).length;
console.log(
  failed
    ? `\npublished-links selftest: FAIL — ${failed} of ${controls.length} control(s) failed.`
    : `\npublished-links selftest: pass — ${controls.length} control(s), ${negative} of them ` +
        `negative (the gate must not pass) and ${controls.length - negative} positive.`,
);
process.exit(failed ? 1 : 0);
