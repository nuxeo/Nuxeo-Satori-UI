#!/usr/bin/env node
/**
 * Seed a Nuxeo server for the records kit's disposition review: fictional records under a retention
 * rule of the platform's retention module, one of them under a legal hold, and the repository's
 * disposition runs folder with the kit's two groups' permissions. It starts no run and approves
 * none: those are the demo's, by its people (the kit's README, "The demo").
 *
 *   node business-apps/packages/records-demo/demo/seed.mjs [--end-retention-now]
 *
 * Needs, installed first: the retention module (nuxeo-retention), the records add-on
 * (nuxeo-agentic-records) and this kit, whose stand-in type, RecordsFile, the records are.
 *
 * Writes, under /default-domain/workspaces/records-demo, and nowhere else but the rule:
 *   - files/: the records of data.mjs, each made a record with the rule attached, by the module's
 *     own Retention.AttachRule, and the one data.mjs marks put under a hold, by Document.Hold;
 *   - disposition/: the DispositionRuns folder, its inherited permissions blocked, with
 *     StartDisposition for records-managers and ApproveDisposition for records-approvers;
 *   - and in /RetentionRules, the module's folder, the rule: one minute from its attachment, with no
 *     end action, so that the module leaves the records to a review.
 *
 * The records are due once the platform has ended their retention: its hourly check does, a minute
 * after the attachment at the soonest. `--end-retention-now` waits for that minute, then fires the
 * check's own event, findRetentionExpired, as the platform's scheduler would.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default: an administrator's, since only an
 *                            administrator makes the disposition runs folder.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *
 * **It creates no user and no group.** records-managers and records-approvers are the server's.
 *
 * **Safe to run twice.** A record already there is left as it is: it is a record, and the seed
 * does not write over one. A place holding a document of another type stops the run, and so does a
 * disposition runs folder elsewhere in the repository, since a repository has one, or a rule of
 * the seed's name with an end action, which would dispose of the records itself.
 *
 * Node 24 and nothing else. Credentials are sent to NUXEO_URL only, as Basic authentication, and
 * never printed.
 *
 * Exit codes: 0, seeded; 1, the server refused a write or a check failed; 2, a precondition, found
 * before anything is written: no credentials, no server, not an administrator, or a package missing.
 */
import { FILES, GRANTS, RECORDS, RULE, RUNS, WORKSPACE } from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const WAIT_MS = Number(process.env['RECORDS_DEMO_WAIT_MS'] ?? RULE.durationMillis + 5_000);

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;
const RULES = '/RetentionRules';

class Precondition extends Error {}

class HttpError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path}: HTTP ${status}${detail ? `, ${detail}` : ''}`);
    this.status = status;
  }
}

const username = process.env['NUXEO_USER'];
const password = process.env['NUXEO_PASS'];
if (!username || !password) {
  console.error(
    'NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export an administrator\'s first:\n' +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const endNow = process.argv.includes('--end-retention-now');
const tally = { created: 0, attached: 0, held: 0, granted: 0 };
let preflighting = true;

try {
  await seed();
} catch (error) {
  if (error instanceof Precondition) {
    console.error(error.message);
    process.exit(EXIT_PRECONDITION);
  }
  console.error(error instanceof HttpError ? error.message : (error?.stack ?? String(error)));
  process.exit(1);
}

async function seed() {
  console.log(`Seeding ${SERVER} for the records kit's disposition review.`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description': 'Fictional records for the records kit. No real organisation, person or record.',
  });
  const files = await ensure(ROOT, FILES.name, 'Folder', { 'dc:title': FILES.title });
  const rule = await ensureRule();

  let attachedAt = 0;
  for (const record of RECORDS) {
    let document = await ensure(files.path, record.reference.toLowerCase(), 'RecordsFile', {
      'dc:title': record.title,
      'rfile:reference': record.reference,
      'rfile:series': record.series,
      'rfile:office': record.office,
      'rfile:closed': record.closed,
    });
    if (document.isRecord !== true) {
      document = await call('POST', '/automation/Retention.AttachRule', {
        json: { input: `doc:${document.uid}`, params: { rule: rule.uid } },
      });
      attachedAt = Date.now();
      tally.attached++;
      console.log(`  attached ${RULE.name} to ${record.reference}`);
    }
    if (record.hold && document.hasLegalHold !== true) {
      await call('POST', '/automation/Document.Hold', {
        json: { input: `doc:${document.uid}`, params: { description: record.hold } },
      });
      tally.held++;
      console.log(`  held     ${record.reference}: ${record.hold}`);
    }
  }

  const folder = await ensureRunsFolder();
  await ensureGrants(folder);

  if (endNow) {
    const wait = attachedAt === 0 ? 0 : Math.max(0, attachedAt + WAIT_MS - Date.now());
    if (wait > 0) {
      console.log(`  waiting  ${Math.ceil(wait / 1000)} s for the rule's minute to pass`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    await call('POST', '/automation/Event.Fire', { json: { params: { name: 'findRetentionExpired' } } });
    console.log('  fired    findRetentionExpired: the platform ends what retention has expired, in the background');
  }

  const { created, attached, held, granted } = tally;
  console.log(
    `\nDone: ${created} created, ${attached} attached to the rule, ${held} held, ${granted} permission(s) granted.`,
  );
  console.log(`The disposition runs folder: ${folder.path} (${folder.uid}).`);
  console.log(
    endNow
      ? 'The records are due as soon as the platform has ended their retention, in a few seconds.'
      : "The records are due once the platform's hourly retention check has run, a minute after they were attached at the soonest; --end-retention-now runs it.",
  );
  console.log("The demo itself, a run started and approved by three people, is the kit's README's.");
}

async function preflight() {
  let me;
  try {
    me = await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    if (error instanceof HttpError)
      throw new Precondition(`${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`);
    throw error;
  }
  if (me?.isAdministrator !== true)
    throw new Precondition(
      `${username} is not an administrator: only an administrator makes the repository's disposition runs folder.`,
    );
  for (const [type, from] of [
    ['RetentionRule', 'the retention module, nuxeo-retention'],
    ['DispositionRuns', 'the records add-on, nuxeo-agentic-records'],
    ['RecordsFile', 'this kit, records-demo'],
  ]) {
    if ((await find(`/config/types/${type}`)) === null)
      throw new Precondition(`${SERVER} has no ${type} type: install ${from} first, then run this again.`);
  }
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the records go.`);
  if ((await find(`/path${pathOf(RULES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${RULES}, the retention module's folder of rules.`);
}

/** The document at `parent/name`, created with `properties` when it is not there; refused when it is another type. */
async function ensure(parent, name, type, properties) {
  const path = `${parent}/${name}`;
  const existing = await find(`/path${pathOf(path)}`);
  if (existing === null) {
    const created = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties },
    });
    tally.created++;
    console.log(`  created  ${path}`);
    return created;
  }
  if (existing.type !== type)
    throw new Error(`${path} is a ${existing.type}, not a ${type}. It is not the seed's, so it is left alone.`);
  return existing;
}

/** The rule, in the module's folder: one minute, attached by hand, and no end action. */
async function ensureRule() {
  const rule = await ensure(RULES, RULE.name, 'RetentionRule', {
    'dc:title': RULE.title,
    'retention_rule:applicationPolicy': 'manual',
    'retention_rule:enabled': true,
    'retention_rule:docTypes': ['RecordsFile'],
    'retention_def:startingPointPolicy': 'immediate',
    'retention_def:durationMillis': RULE.durationMillis,
    'retention_def:endActions': [],
  });
  const actions = (await call('GET', `/id/${rule.uid}`, { schemas: '*' }))?.properties?.['retention_def:endActions'];
  if (Array.isArray(actions) && actions.length > 0)
    throw new Error(
      `${RULES}/${RULE.name} has an end action, ${actions.join(', ')}: it would dispose of the records itself, with no review. Remove its end actions, or the rule.`,
    );
  return rule;
}

/** The repository's one disposition runs folder: the seed's, or none elsewhere. */
async function ensureRunsFolder() {
  const found = await call('GET', '/search/lang/NXQL/execute', {
    query: 'SELECT * FROM DispositionRuns WHERE ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0',
  });
  const mine = `${ROOT}/${RUNS.name}`;
  const other = (found?.entries ?? []).find((each) => each.path !== mine);
  if (other)
    throw new Error(
      `The repository has its disposition runs folder already, at ${other.path}: a repository has one, so the seed makes none.`,
    );
  return ensure(ROOT, RUNS.name, 'DispositionRuns', { 'dc:title': RUNS.title });
}

/** The two groups' permissions on the folder, and the block of every permission it would inherit. */
async function ensureGrants(folder) {
  const acl = await call('GET', `/id/${folder.uid}/@acl`);
  const local = (acl?.acl ?? []).find((each) => each.name === 'local')?.aces ?? [];
  const has = (user, permission, granted = true) =>
    local.some((ace) => ace.username === user && ace.permission === permission && ace.granted === granted);
  const blocked = has('Everyone', 'Everything', false);
  for (const [index, { group, permission }] of GRANTS.entries()) {
    if (has(group, permission)) continue;
    await call('POST', '/automation/Document.AddPermission', {
      json: {
        input: `doc:${folder.uid}`,
        params: { users: [group], permission, notify: false, ...(index === 0 && !blocked ? { blockInheritance: true } : {}) },
      },
    });
    tally.granted++;
    console.log(`  granted  ${permission} to ${group}`);
  }
  const after = await call('GET', `/id/${folder.uid}/@acl`);
  const aces = (after?.acl ?? []).find((each) => each.name === 'local')?.aces ?? [];
  if (!aces.some((ace) => ace.username === 'Everyone' && ace.permission === 'Everything' && ace.granted === false))
    throw new Error(
      `${folder.path} does not block the permissions it would inherit, and the records add-on takes no request until it does.`,
    );
}

function pathOf(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function find(path) {
  try {
    return await call('GET', path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function call(method, path, { json, schemas, query } = {}) {
  const url = new URL(`${API}${path}`);
  if (query) url.searchParams.set('query', query);
  const headers = { Authorization: AUTHORIZATION, Accept: 'application/json' };
  if (schemas) headers['X-NXproperties'] = schemas;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (preflighting) throw new Precondition(`${SERVER} did not answer: ${error?.cause?.code ?? error?.name ?? error}.`);
    throw new Error(`${method} ${path}: no answer from ${SERVER}, ${error?.cause?.code ?? error?.name ?? error}.`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = '';
    }
    throw new HttpError(response.status, method, path, String(detail).slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}
