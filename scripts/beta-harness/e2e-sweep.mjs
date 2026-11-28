#!/usr/bin/env node
/**
 * Trash what one CI run of the e2e suite left on the shared Nuxeo: every live document whose title
 * starts with the run's prefix (`E2E_RUN_PREFIX`, `e2e-run-prefix.mjs`).
 *
 * The smoke specs delete their own documents in `afterEach`. This runs after them, `if: always()`,
 * for what they could not: a run cancelled half way, a spec that died between creating a document
 * and recording it, a server that refused a delete. Normally it finds nothing and says so.
 *
 * Trash, not delete: a leftover may be the evidence of why a run failed, and the trash keeps it
 * restorable until the server empties it.
 *
 * It talks to Nuxeo as the specs do, through the served app's proxy at `E2E_BASE_URL`, with the
 * same three guards as `e2e-preflight.mjs` before anything is sent with the credentials: the host is
 * named in `E2E_ALLOWED_HOSTS`, `NUXEO_USER` and `NUXEO_PASS` are both set, and `/me` answers as
 * `NUXEO_USER`. The query is the repository's (`Repository.Query`), not the search index's, so a
 * document made a second before the run stopped is found too.
 *
 * Usage: E2E_RUN_PREFIX=e2e-pr1-2-1- npx tsx scripts/beta-harness/e2e-sweep.mjs
 * Exit: 0 nothing left; 1 a document could not be trashed, or some remain; 2 a precondition.
 */
import { leftoverQuery, runPrefix, RUN_PREFIX_ENV } from './e2e-run-prefix.mjs';

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';
const PAGE_SIZE = 100;
const MAX_ROUNDS = 20;

const { parseAllowedHosts, isHostAllowed, ALLOWED_HOSTS_ENV } = await import(
  new URL('../../libs/integration-tests/src/lib/integration-preflight.ts', import.meta.url).href
);
const { checkFetchIdentity, ME_PATH } = await import(
  new URL('./identity-guard.mjs', import.meta.url).href
);

function precondition(message) {
  console.error(`e2e-sweep: PRECONDITION NOT MET — ${message}`);
  process.exit(2);
}

let prefix;
try {
  prefix = runPrefix();
} catch (error) {
  precondition(error instanceof Error ? error.message : String(error));
}
if (!prefix) precondition(`${RUN_PREFIX_ENV} is not set, so there is no run to sweep for.`);

const allowed = parseAllowedHosts(
  process.env['E2E_ALLOWED_HOSTS'] ?? process.env[ALLOWED_HOSTS_ENV],
);
if (allowed.length === 0 || !isHostAllowed(BASE, allowed))
  precondition(`E2E_BASE_URL (${BASE}) is not named in E2E_ALLOWED_HOSTS.`);

const USER = process.env['NUXEO_USER'];
const PASS = process.env['NUXEO_PASS'];
if (!USER || !PASS) precondition('NUXEO_USER and NUXEO_PASS must both be set.');
const auth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

const identity = await checkFetchIdentity(new URL(ME_PATH, BASE).href, auth, USER);
if (!identity.ok) precondition(`${identity.problem}.`);

const headers = {
  Authorization: auth,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-NXproperties': 'dublincore',
};

async function leftovers() {
  const response = await fetch(new URL('/nuxeo/api/v1/automation/Repository.Query', BASE), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      params: { query: leftoverQuery(prefix), pageSize: PAGE_SIZE, currentPageIndex: 0 },
      context: {},
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    precondition(
      `Repository.Query answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const body = await response.json();
  if (!Array.isArray(body.entries))
    precondition(
      `Repository.Query answered without entries: ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body.entries;
}

let trashed = 0;
const refused = [];
for (let round = 0; round < MAX_ROUNDS; round++) {
  const entries = (await leftovers()).filter((entry) => !refused.some((r) => r.uid === entry.uid));
  if (entries.length === 0) break;
  for (const entry of entries) {
    const response = await fetch(
      new URL(`/nuxeo/api/v1/id/${entry.uid}/@op/Document.Trash`, BASE),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ params: {}, context: {} }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.ok) {
      trashed += 1;
      console.log(`  trashed ${entry.uid} ${entry.path ?? ''} "${entry.title ?? ''}"`);
    } else {
      refused.push({ uid: entry.uid, path: entry.path, status: response.status });
    }
  }
}

const remaining = await leftovers();
if (refused.length || remaining.length) {
  console.error(
    `e2e-sweep: ${trashed} trashed, but ${refused.length} refused and ${remaining.length} still live ` +
      `under the prefix ${prefix}.`,
  );
  for (const r of refused) console.error(`  - ${r.uid} ${r.path ?? ''}: HTTP ${r.status}`);
  process.exit(1);
}
console.log(
  trashed === 0
    ? `e2e-sweep: nothing was left under the prefix ${prefix}; the specs cleaned up after themselves.`
    : `e2e-sweep: ${trashed} document(s) left under the prefix ${prefix}, now trashed.`,
);
