#!/usr/bin/env node
/**
 * Seed a Nuxeo server for the records kit's disposition review and physical records: fictional
 * records under a retention rule of the platform's retention module, one of them under a legal hold;
 * a records centre's locations, and physical records kept there under the same rule, one of them held;
 * the repository's disposition runs folder and custody desk, with the kit's groups' permissions. It
 * starts no run, approves none, and moves, checks out or returns nothing: those are the demo's, by
 * its people (the kit's README, "The demo").
 *
 *   node business-apps/packages/records-demo/demo/seed.mjs [--end-retention-now]
 *
 * Needs, installed first: the retention module (nuxeo-retention), the records add-on
 * (nuxeo-agentic-records) and this kit, whose stand-in type, RecordsFile, the records are.
 *
 * Writes:
 *   - under /default-domain/workspaces/records-demo/files, the records of data.mjs, each made a
 *     record with the rule attached, by the module's own Retention.AttachRule, and the one data.mjs
 *     marks put under a hold, by Document.Hold;
 *   - under /default-domain/workspaces/records-demo/records-centre, the locations of data.mjs, a site,
 *     a room, shelves and positions, and in the records files folder its physical records, each kept
 *     at its position, made a record with the rule attached, and the one data.mjs marks held;
 *   - at the repository's root, /disposition-runs, the DispositionRuns folder, its inherited
 *     permissions blocked, with StartDisposition and ExportRecordsAudit for records-managers and
 *     ApproveDisposition for records-approvers: the add-on takes requests and audit exports in a
 *     folder at the root only;
 *   - and at the root too, /custody-desk, the CustodyDesk, its inherited permissions blocked, with
 *     RecordCustody for records-managers, where the add-on takes custody requests;
 *   - and in /RetentionRules, the module's folder, the rule: one minute from its attachment, with no
 *     end action, so that the module leaves the records to a review, for records files and physical
 *     records. A rule the seed made before physical records is given their type.
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
import {
  CENTRE,
  CUSTODY_GRANTS,
  DESK,
  FILES,
  GRANTS,
  LOCATIONS,
  PHYSICAL,
  RECORDS,
  RULE,
  RUNS,
  WORKSPACE,
} from './data.mjs';

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
const tally = { created: 0, attached: 0, held: 0, granted: 0, updated: 0 };
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
  const attach = async (document, reference) => {
    let attached = document;
    if (attached.isRecord !== true) {
      attached = await call('POST', '/automation/Retention.AttachRule', {
        json: { input: `doc:${attached.uid}`, params: { rule: rule.uid } },
      });
      attachedAt = Date.now();
      tally.attached++;
      console.log(`  attached ${RULE.name} to ${reference}`);
    }
    return attached;
  };
  const hold = async (document, reference, description) => {
    if (description && document.hasLegalHold !== true) {
      await call('POST', '/automation/Document.Hold', {
        json: { input: `doc:${document.uid}`, params: { description } },
      });
      tally.held++;
      console.log(`  held     ${reference}: ${description}`);
    }
  };
  for (const record of RECORDS) {
    let document = await ensure(files.path, record.reference.toLowerCase(), 'RecordsFile', {
      'dc:title': record.title,
      'rfile:reference': record.reference,
      'rfile:series': record.series,
      'rfile:office': record.office,
      'rfile:closed': record.closed,
    });
    document = await attach(document, record.reference);
    await hold(document, record.reference, record.hold);
  }

  // The records centre: its locations, each inside the one before it, then its physical records.
  const centre = await ensure(ROOT, CENTRE.name, 'Folder', { 'dc:title': CENTRE.title });
  const places = new Map();
  for (const location of LOCATIONS) {
    const parent = location.in === null ? centre : places.get(location.in);
    places.set(
      location.name,
      await ensure(parent.path, location.name, 'PhysicalLocation', {
        'dc:title': location.title,
        'ploc:kind': location.kind,
      }),
    );
  }
  for (const item of PHYSICAL) {
    let document = await ensure(files.path, item.name, 'PhysicalRecord', {
      'dc:title': item.title,
      'phys:kind': item.kind,
      'phys:location': places.get(item.at).uid,
      'phys:dispositionAction': item.disposition,
      ...(item.transferTo ? { 'phys:transferTo': item.transferTo } : {}),
    });
    document = await attach(document, item.name);
    await hold(document, item.name, item.hold);
  }

  const folder = await ensureRootFolder(RUNS, 'DispositionRuns', 'disposition runs folder');
  await ensureGrants(folder, GRANTS, 'records add-on takes no request');
  const desk = await ensureRootFolder(DESK, 'CustodyDesk', 'custody desk');
  await ensureGrants(desk, CUSTODY_GRANTS, 'records add-on takes no custody request');

  if (endNow) {
    const wait = attachedAt === 0 ? 0 : Math.max(0, attachedAt + WAIT_MS - Date.now());
    if (wait > 0) {
      console.log(`  waiting  ${Math.ceil(wait / 1000)} s for the rule's minute to pass`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    await call('POST', '/automation/Event.Fire', { json: { params: { name: 'findRetentionExpired' } } });
    console.log('  fired    findRetentionExpired: the platform ends what retention has expired, in the background');
  }

  const { created, attached, held, granted, updated } = tally;
  console.log(
    `\nDone: ${created} created, ${attached} attached to the rule, ${held} held, ${granted} permission(s) granted, ${updated} updated.`,
  );
  console.log(`The disposition runs folder: ${folder.path} (${folder.uid}).`);
  console.log(`The custody desk: ${desk.path} (${desk.uid}).`);
  console.log(
    endNow
      ? 'The records are due as soon as the platform has ended their retention, in a few seconds.'
      : "The records are due once the platform's hourly retention check has run, a minute after they were attached at the soonest; --end-retention-now runs it.",
  );
  console.log(
    "The demo itself, a run started and approved by three people, and a record checked out and returned, is the kit's README's.",
  );
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
    ['CustodyDesk', 'the records add-on 0.3.0, nuxeo-agentic-records, with physical records'],
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
  const path = `${parent === '/' ? '' : parent}/${name}`;
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
    'retention_rule:docTypes': RULE.docTypes,
    'retention_def:startingPointPolicy': 'immediate',
    'retention_def:durationMillis': RULE.durationMillis,
    'retention_def:endActions': [],
  });
  const properties = (await call('GET', `/id/${rule.uid}`, { schemas: '*' }))?.properties ?? {};
  const actions = properties['retention_def:endActions'];
  if (Array.isArray(actions) && actions.length > 0)
    throw new Error(
      `${RULES}/${RULE.name} has an end action, ${actions.join(', ')}: it would dispose of the records itself, with no review. Remove its end actions, or the rule.`,
    );
  // A rule the seed made before physical records takes their type too: the module refuses to attach
  // a rule to a type it does not list.
  const types = Array.isArray(properties['retention_rule:docTypes']) ? properties['retention_rule:docTypes'] : [];
  const missing = RULE.docTypes.filter((type) => !types.includes(type));
  if (missing.length > 0) {
    await call('PUT', `/id/${rule.uid}`, {
      json: { 'entity-type': 'document', properties: { 'retention_rule:docTypes': [...types, ...missing] } },
    });
    tally.updated++;
    console.log(`  updated  ${RULES}/${RULE.name}: it takes ${missing.join(', ')} too`);
  }
  return rule;
}

/** The repository's one folder of `type` at its root, the disposition runs folder or the custody desk: the seed's, or none elsewhere. */
async function ensureRootFolder(place, type, what) {
  const found = await call('GET', '/search/lang/NXQL/execute', {
    query: `SELECT * FROM ${type} WHERE ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0`,
  });
  const mine = `/${place.name}`;
  const other = (found?.entries ?? []).find((each) => each.path !== mine);
  if (other)
    throw new Error(`The repository has its ${what} already, at ${other.path}: a repository has one, so the seed makes none.`);
  return ensure('/', place.name, type, { 'dc:title': place.title });
}

/** The groups' permissions on the folder, and the block of every permission it would inherit. */
async function ensureGrants(folder, grants, refusal) {
  const acl = await call('GET', `/id/${folder.uid}/@acl`);
  const local = (acl?.acl ?? []).find((each) => each.name === 'local')?.aces ?? [];
  const has = (user, permission, granted = true) =>
    local.some((ace) => ace.username === user && ace.permission === permission && ace.granted === granted);
  const blocked = has('Everyone', 'Everything', false);
  for (const [index, { group, permission }] of grants.entries()) {
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
    throw new Error(`${folder.path} does not block the permissions it would inherit, and the ${refusal} until it does.`);
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
