#!/usr/bin/env node
/**
 * Node runtime preflight — gate zero.
 *
 * Exists because of a real, expensive misdiagnosis: an agent running Node 25
 * saw `nuxeo-client:test` fail with `SecurityError: Cannot initialize local
 * storage without a --localstorage-file path` and reported it as a product
 * defect. It was not. Node 25 defines a global `localStorage` getter that
 * *throws* unless a store path is given, and it shadows jsdom's implementation,
 * so `clipboard.utils.spec.ts` blows up on a line that is correct.
 *
 * A red that looks exactly like a code defect but is caused by the runtime is
 * the worst failure mode this harness has, because the obvious "fix" is to
 * damage working code. So the cheapest gate runs first and says so out loud.
 *
 * Three outcomes:
 *   supported  — running the major the repo pins. Nothing to say.
 *   mitigated  — a newer major whose hazards this harness works around. Passes,
 *                but warns that commands run *outside* the gate will break.
 *   unsupported — older than the pinned major, or a hazard with no workaround.
 *                 Fails, because nothing downstream can be trusted.
 *
 * Usage:
 *   node scripts/beta-harness/node-version.mjs [--json]
 *
 * Environment:
 *   BETA_GATE_NODE_STRICT=1  treat anything but the pinned major as a failure
 *                            (what CI wants; CI already pins Node 20)
 *
 * Exit code is 1 when the runtime cannot be trusted to produce a meaningful
 * result from the gates that follow.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const asJson = process.argv.includes('--json');
const strict = process.env['BETA_GATE_NODE_STRICT'] === '1';

const report = assess();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const line of report.lines) console.log(line);
}

process.exit(report.ok ? 0 : 1);

/**
 * @returns {{ ok: boolean, status: string, running: string, pinned: string|null,
 *             engines: string|null, hazards: object, lines: string[] }}
 */
function assess() {
  const running = process.versions.node;
  const runningMajor = Number(running.split('.')[0]);
  const engines = readEngines();
  const nvmrc = readNvmrc();
  const pinned = majorOf(nvmrc) ?? majorOf(engines);

  const hazards = probeHazards();
  const lines = [];

  if (pinned === null) {
    // No pin to check against. Say so rather than inventing a verdict — a gate
    // that cannot fail is not a gate.
    lines.push(
      `node-version: inconclusive — Node ${running}, but neither .nvmrc nor package.json engines pins a major.`,
    );
    return { ok: true, status: 'inconclusive', running, pinned, engines, hazards, lines };
  }

  const pin = `Node ${pinned}.x (.nvmrc ${nvmrc ?? 'absent'}, engines ${engines ?? 'absent'})`;

  if (runningMajor === pinned) {
    lines.push(`node-version: pass — Node ${running} matches the pinned ${pin}.`);
    return { ok: true, status: 'supported', running, pinned, engines, hazards, lines };
  }

  if (runningMajor < pinned) {
    lines.push(
      `node-version: FAIL — Node ${running} is older than the pinned ${pin}.`,
      '',
      'The Angular 21 / Nx 22 toolchain in this repo is not expected to work here, and any',
      'failure the later gates report would be uninterpretable. Switch runtime, then re-run:',
      '',
      `  nvm install ${pinned} && nvm use ${pinned}`,
      '',
    );
    return { ok: false, status: 'unsupported', running, pinned, engines, hazards, lines };
  }

  // Newer than pinned.
  if (strict) {
    lines.push(
      `node-version: FAIL — Node ${running} is newer than the pinned ${pin}, and BETA_GATE_NODE_STRICT=1.`,
      '',
      `Only Node ${pinned}.x is authoritative. CI pins it; local runs should match before a phase is signed off.`,
      '',
    );
    return { ok: false, status: 'unsupported', running, pinned, engines, hazards, lines };
  }

  if (hazards.webStorage.present && !hazards.webStorage.mitigable) {
    lines.push(
      `node-version: FAIL — Node ${running} shadows jsdom's localStorage and this runtime rejects the opt-out flag.`,
      '',
      `Specs touching localStorage will throw regardless of the code under test. Use Node ${pinned}.x.`,
      '',
    );
    return { ok: false, status: 'unsupported', running, pinned, engines, hazards, lines };
  }

  if (hazards.webStorage.present) {
    lines.push(
      `node-version: PASS WITH WARNING — Node ${running} is newer than the pinned ${pin}.`,
      '',
      '  Hazard: this Node defines a global `localStorage` that throws unless',
      "          --localstorage-file is given, and it shadows jsdom's. Specs that touch",
      '          localStorage fail with SecurityError on correct code.',
      '  Status: the gate works around it by passing --no-experimental-webstorage to every',
      '          child, so the results below are trustworthy.',
      '',
      '  READ THIS BEFORE DIAGNOSING ANY RED:',
      '    Commands run OUTSIDE this gate do not get the workaround. On this runtime',
      '      npx nx run nuxeo-client:test',
      '    fails on working code. Route every verification through `npm run beta:gate`,',
      `    or switch to Node ${pinned}.x, before concluding anything is broken.`,
      '',
    );
    return { ok: true, status: 'mitigated', running, pinned, engines, hazards, lines };
  }

  lines.push(
    `node-version: PASS WITH NOTE — Node ${running} is newer than the pinned ${pin}, with no known hazard detected.`,
    `  CI runs Node ${pinned}.x, so only a CI run is authoritative for a phase gate.`,
  );
  return { ok: true, status: 'newer-no-hazard', running, pinned, engines, hazards, lines };
}

/**
 * Probe the runtime's actual behaviour rather than consulting a version table.
 * Node moved `localStorage` from absent (20, 22, 24) to a throwing global (25),
 * and a hardcoded major list would have to be maintained every release.
 *
 * @returns {{ webStorage: { present: boolean, mitigable: boolean, detail: string } }}
 */
function probeHazards() {
  // Strip inherited NODE_OPTIONS so an opt-out set by a parent gate run does not
  // hide the hazard from the probe.
  const clean = { ...process.env };
  delete clean['NODE_OPTIONS'];

  // `typeof`, not a plain reference: an *absent* global is the safe case, and a
  // plain reference to one throws ReferenceError, which would read as the hazard.
  // The hazard is narrower — an identifier that resolves but throws on access.
  const PROBE =
    "try { process.stdout.write(typeof localStorage) } catch (e) { process.stdout.write('throws:' + e.name) }";

  const bare = spawnSync(process.execPath, ['-e', PROBE], { encoding: 'utf8', env: clean });
  const present = (bare.stdout ?? '').startsWith('throws:');

  if (!present) {
    return { webStorage: { present: false, mitigable: true, detail: (bare.stdout ?? '').trim() } };
  }

  const optedOut = spawnSync(process.execPath, ['--no-experimental-webstorage', '-e', PROBE], {
    encoding: 'utf8',
    env: clean,
  });
  const mitigable = optedOut.status === 0 && (optedOut.stdout ?? '').trim() === 'undefined';

  return { webStorage: { present: true, mitigable, detail: (bare.stdout ?? '').trim() } };
}

/** @returns {string|null} */
function readEngines() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    return pkg?.engines?.node ?? null;
  } catch {
    return null;
  }
}

/** @returns {string|null} */
function readNvmrc() {
  try {
    return readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * First integer in a version expression — `20`, `20.x`, `v20.11.1`, `>=20 <21`.
 * @param {string|null} spec
 * @returns {number|null}
 */
function majorOf(spec) {
  if (!spec) return null;
  const m = /(\d+)/.exec(spec);
  return m ? Number(m[1]) : null;
}
