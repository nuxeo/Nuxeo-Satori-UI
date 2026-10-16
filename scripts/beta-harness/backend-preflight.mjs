#!/usr/bin/env node
/**
 * Nuxeo backend preflight for the evidence harness.
 *
 * Brings the local Docker stack up — the `nuxeo` container and its OpenSearch
 * sidecar — and does not return until Nuxeo is actually answering the REST API.
 *
 * Why this exists: nothing in the harness verified the backend, so a stopped
 * container surfaced as a dozen "selector not visible" failures scattered across
 * a capture, which reads exactly like a broken component. One sentence at the top
 * of the run is worth more than twelve reds at the bottom.
 *
 * It waits on the API rather than on container state on purpose. `docker start`
 * returns in milliseconds; Nuxeo then takes tens of seconds to deploy, and a
 * capture launched into that window fails on half-initialised surfaces.
 *
 * Usage:
 *   node scripts/beta-harness/backend-preflight.mjs           # start if needed, then wait
 *   node scripts/beta-harness/backend-preflight.mjs --check    # report only, change nothing
 *   node scripts/beta-harness/backend-preflight.mjs --json
 *
 * Environment:
 *   NUXEO_CONTAINER       default `nuxeo`
 *   OPENSEARCH_CONTAINER  default `nuxeo-opensearch`
 *   NUXEO_URL             default http://localhost:8080
 *   NUXEO_USER/NUXEO_PASS required — no default (NXSAT-649)
 *   BACKEND_WAIT_SECONDS  default 180
 *
 * Exit 0 when Nuxeo is serving. Exit 1 with a specific, actionable reason
 * otherwise — Docker not running, container absent, or API never came up.
 * Exit 2 when NUXEO_USER or NUXEO_PASS is unset: a precondition, checked before
 * Docker is touched, because the probe has nothing to authenticate with and a
 * guessed pair is the defect this used to have.
 */

import { spawnSync } from 'node:child_process';

import {
  EXIT_PRECONDITION,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from './nuxeo-credentials.mjs';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const asJson = argv.includes('--json');

const nuxeoContainer = process.env['NUXEO_CONTAINER'] ?? 'nuxeo';
const searchContainer = process.env['OPENSEARCH_CONTAINER'] ?? 'nuxeo-opensearch';
const nuxeoUrl = (process.env['NUXEO_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');
const waitSeconds = Number(process.env['BACKEND_WAIT_SECONDS'] ?? 180);

/**
 * Both halves defaulted to the local Docker administrator pair, so with the variables unset this
 * reported "pass — Nuxeo is serving" on the strength of a credential nobody had supplied, and the
 * capture after it then ran as an administrator. Now a missing pair stops here, before any
 * container is started — a `docker start` for a run that cannot authenticate is a side effect
 * with no purpose. `--json` still emits one object, so a caller parsing stdout is not broken.
 */
const credentials = readNuxeoCredentials();
if (!credentials) {
  const detail = missingNuxeoCredentialsMessage('probe the Nuxeo REST API');
  if (asJson) {
    const report = { ok: false, status: 'credentials-missing', detail, log: [] };
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`\nbackend-preflight: PRECONDITION — ${detail}\n`);
  }
  process.exit(EXIT_PRECONDITION);
}
const { username: user, password: pass } = credentials;

const log = [];
/** @param {string} m */
const say = (m) => {
  log.push(m);
  if (!asJson) console.log(m);
};

const result = await main();

if (asJson) console.log(JSON.stringify({ ...result, log }, null, 2));
process.exit(result.ok ? 0 : 1);

async function main() {
  // Fast path first. If the API already answers, nothing else matters — the
  // containers could be named anything, or Nuxeo could be running outside Docker.
  const already = await probeApi();
  if (already.ok) {
    say(`backend-preflight: pass — Nuxeo is serving at ${nuxeoUrl} (HTTP ${already.status}, user ${already.user}).`);
    return { ok: true, status: 'already-up', apiStatus: already.status };
  }

  say(`backend-preflight: ${nuxeoUrl}/nuxeo/api/v1/me is not answering (${already.detail}). Checking Docker.`);

  const docker = dockerAvailable();
  if (!docker.ok) {
    say(
      `backend-preflight: FAIL — ${docker.detail}\n` +
        '  Start Docker Desktop, then re-run. Nothing in this harness can substitute for it;\n' +
        '  a capture launched now would fail on every data-bearing surface.',
    );
    return { ok: false, status: 'docker-unavailable', detail: docker.detail };
  }

  const containers = [
    { name: searchContainer, role: 'OpenSearch' },
    { name: nuxeoContainer, role: 'Nuxeo' },
  ];

  for (const c of containers) {
    const state = containerState(c.name);
    if (state === 'absent') {
      say(
        `backend-preflight: FAIL — no container named \`${c.name}\` exists (${c.role}).\n` +
          `  This repo has no compose file, so the stack was created by hand and cannot be\n` +
          `  recreated from here. Create it, or point at yours:\n` +
          `    ${c.role === 'Nuxeo' ? 'NUXEO_CONTAINER' : 'OPENSEARCH_CONTAINER'}=<name> npm run beta:backend`,
      );
      return { ok: false, status: 'container-absent', container: c.name };
    }
    if (state === 'running') {
      say(`  ${c.role} container \`${c.name}\` is already running.`);
      continue;
    }
    if (checkOnly) {
      say(`  ${c.role} container \`${c.name}\` is ${state}. --check given, so not starting it.`);
      continue;
    }
    // OpenSearch is started first, and deliberately: Nuxeo indexes against it on
    // boot and logs errors for the whole window it is missing.
    say(`  starting ${c.role} container \`${c.name}\` (was ${state})`);
    const started = spawnSync('docker', ['start', c.name], { encoding: 'utf8' });
    if (started.status !== 0) {
      const detail = `${started.stderr ?? ''}`.trim() || `exit ${started.status}`;
      say(`backend-preflight: FAIL — could not start \`${c.name}\`: ${detail}`);
      return { ok: false, status: 'start-failed', container: c.name, detail };
    }
  }

  if (checkOnly) {
    say('backend-preflight: FAIL — the API is not answering and --check forbids starting anything.');
    return { ok: false, status: 'down', detail: already.detail };
  }

  // The part that actually matters. `docker start` returning says nothing about
  // whether Nuxeo has deployed.
  say(`  waiting up to ${waitSeconds}s for ${nuxeoUrl}/nuxeo/api/v1/me`);
  const deadline = Date.now() + waitSeconds * 1000;
  let last = already;
  let dots = 0;
  while (Date.now() < deadline) {
    await sleep(3000);
    last = await probeApi();
    if (last.ok) {
      say(`backend-preflight: pass — Nuxeo came up (HTTP ${last.status}, user ${last.user}).`);
      return { ok: true, status: 'started', apiStatus: last.status };
    }
    if (!asJson && ++dots % 5 === 0) {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      console.log(`    still deploying (${last.detail}), ${left}s left`);
    }
  }

  say(
    `backend-preflight: FAIL — Nuxeo did not answer within ${waitSeconds}s (last: ${last.detail}).\n` +
      `  Check the container's own log before assuming anything about the app:\n` +
      `    docker logs --tail 100 ${nuxeoContainer}`,
  );
  return { ok: false, status: 'timeout', detail: last.detail };
}

/**
 * @returns {Promise<{ ok: boolean, status?: number, user?: string, detail: string }>}
 */
async function probeApi() {
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  try {
    const res = await fetch(`${nuxeoUrl}/nuxeo/api/v1/me`, {
      headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, status: res.status, detail: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, user: body?.id ?? 'unknown', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** @returns {{ ok: boolean, detail: string }} */
function dockerAvailable() {
  const cli = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (cli.error) return { ok: false, detail: 'the `docker` CLI is not on PATH.' };
  if (cli.status !== 0) {
    return { ok: false, detail: 'the Docker daemon is not responding — Docker Desktop is probably not running.' };
  }
  return { ok: true, detail: `Docker server ${(cli.stdout ?? '').trim()}` };
}

/**
 * @param {string} name
 * @returns {'running'|'absent'|string} the container's state, or `absent`
 */
function containerState(name) {
  const res = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', name], { encoding: 'utf8' });
  if (res.status !== 0) return 'absent';
  return (res.stdout ?? '').trim() || 'absent';
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
