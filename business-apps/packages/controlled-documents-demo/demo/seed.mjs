#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the controlled documents kit's fictional register, so that its record
 * page, queue and home have something to show: five engineering documents, from `data.mjs`, nine
 * revisions in all, under /default-domain/workspaces/controlled-documents/register.
 *
 *   node business-apps/packages/controlled-documents-demo/demo/seed.mjs
 *
 * The kit's package and `nuxeo-agentic-documents` must be installed first: the records are of the
 * stand-in model's type, `EngineeringDocument`, which the add-on numbers.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset. An account
 *                            that may create a workspace in /default-domain/workspaces.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *
 * **The server numbers, the seed never does.** A chain's first revision is created naming its
 * series, `docctl:series`; each later one naming the revision before it, `docctl:supersedes`. The
 * server gives the number and the revision, and marks the one before superseded. The seed writes
 * no `docctl:` property on an update: the server refuses any change to them.
 *
 * **It creates no user and no group.** The kit's groups, `document-controllers` and `engineers`,
 * and the people in them, are the server's. The originators, in `data.mjs`, are user names only.
 *
 * **Safe to run twice.** Every revision has a fixed place. One already there has `data.mjs`'s
 * other values written over its own; one missing is created, superseding the revision before it,
 * which must then be current. A place that holds a document of another type, or a chain whose
 * revision before a missing one is no longer current, stops the run. A revision in the trash is
 * not looked for: restore it first, or the seed creates its place again.
 *
 * **It checks what it seeded.** Last, every revision is read back: a chain shares one number, no
 * two chains share one, each revision is the one `data.mjs` names, the last is current and the
 * others superseded, linked both ways. Then the kit's page providers are asked: the current
 * documents' must return each chain's last revision and none of the others, the superseded ones'
 * the others, and the revisions' each chain whole. Another document on the server may be in them:
 * the seed checks its own.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, a
 * place held another type, a chain could not be continued, or a check failed; 2, a precondition,
 * found before anything is written: no credentials, no server, or one that does not answer /me as
 * Nuxeo does, credentials refused, the package not installed, or no /default-domain/workspaces.
 */
import { CHAINS, FOLDER, WORKSPACE, revisionsOf } from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const TYPE = 'EngineeringDocument';

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;
const HOLDER = `${ROOT}/${FOLDER.name}`;

/** A precondition the environment or the server does not meet: fix it, not the script. */
class Precondition extends Error {}

/** The server answered with an error status. */
class HttpError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path}: HTTP ${status}${detail ? `, ${detail}` : ''}`);
    this.status = status;
  }
}

const tally = { created: 0, updated: 0 };
/** Whether the run is still in its preflight, where no answer at all means no server. */
let preflighting = true;

const username = process.env['NUXEO_USER'];
const password = process.env['NUXEO_PASS'];
if (!username || !password) {
  console.error(
    'NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export them first:\n' +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

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
  console.log(`Seeding ${SERVER} with the controlled documents kit's fictional register.`);
  await preflight();
  preflighting = false;

  await ensureFolder(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description': 'Fictional engineering documents for the controlled documents kit.',
  });
  await ensureFolder(ROOT, FOLDER.name, 'Folder', { 'dc:title': FOLDER.title });

  const today = new Date();
  /** Each chain's revisions as stored, in order. */
  const seeded = new Map();
  for (const chain of CHAINS) {
    const stored = [];
    for (const [index, revision] of revisionsOf(chain, today).entries()) {
      const before = stored[index - 1];
      stored.push(await ensureRevision(chain, revision, before));
    }
    seeded.set(chain.key, stored);
  }

  const problems = [...(await disagreementsOf(seeded)), ...(await providerDisagreements(seeded))];
  if (problems.length > 0)
    throw new Error(
      `What the server holds is not the register seeded:\n  ${problems.join('\n  ')}`,
    );
  console.log('  checked  numbers, revisions, supersession, and the three page providers');

  const { created, updated } = tally;
  console.log(`\nDone: ${created} created, ${updated} updated. The server holds what was seeded.`);
  console.log(`The home: ${APP}/#/home`);
  console.log(`The current documents: ${APP}/#/queues/current`);
  const pumpHouse = seeded.get('pump-house-ga');
  console.log(`A superseded revision, with its banner: ${APP}/#/doc/${pumpHouse[0].uid}`);
  console.log(`The current revision of it: ${APP}/#/doc/${pumpHouse.at(-1).uid}`);
}

/** The server answers, the credentials are accepted, the package's type is installed. */
async function preflight() {
  try {
    await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    if (error instanceof HttpError)
      throw new Precondition(
        `${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`,
      );
    throw error;
  }
  const type = await find(`/config/types/${TYPE}`);
  if (type === null)
    throw new Precondition(
      `${SERVER} has no ${TYPE} type: install nuxeo-agentic-documents and the ` +
        'controlled-documents-demo package first (business-apps/packages/controlled-documents-demo/README.md), ' +
        'then run this again.',
    );
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the records go.`);
}

/** A folder at `parent/name`: created when it is not there, refused when it is another type. */
async function ensureFolder(parent, name, type, properties) {
  const path = `${parent}/${name}`;
  const existing = await find(`/path${pathOf(path)}`);
  if (existing === null) {
    await create(parent, name, type, properties);
    return;
  }
  refuseOther(existing, path, type);
}

/**
 * One revision of a chain at its place: created when it is not there, naming its series if it is
 * the first, or the revision before it, which must be current, and given the seed's values
 * otherwise. The server's own properties are never written.
 */
async function ensureRevision(chain, revision, before) {
  const path = `${HOLDER}/${revision.name}`;
  const existing = await find(`/path${pathOf(path)}`);
  if (existing !== null) {
    refuseOther(existing, path, TYPE);
    const updated = await call('PUT', `/id/${existing.uid}`, {
      json: { 'entity-type': 'document', properties: revision.properties },
    });
    tally.updated++;
    console.log(`  updated  ${path}`);
    return updated;
  }
  if (before !== undefined && before.properties['docctl:status'] !== 'current')
    throw new Error(
      `${path} is missing, and the revision before it, ${before.path}, is no longer current: ` +
        `it is superseded by ${before.properties['docctl:supersededBy']}, which is not the seed's. ` +
        'Seed another server, or move the register aside.',
    );
  const controlled =
    before === undefined ? { 'docctl:series': chain.series } : { 'docctl:supersedes': before.uid };
  return create(HOLDER, revision.name, TYPE, { ...revision.properties, ...controlled });
}

async function create(parent, name, type, properties) {
  const created = await call('POST', `/path${pathOf(parent)}`, {
    json: { 'entity-type': 'document', name, type, properties },
  });
  // The server may store a document under another name than the one asked for: Nuxeo cuts a name
  // to `nuxeo.path.segment.maxsize`, 24 characters by default, without a word. Every later step
  // finds its places by path, so a renamed one would be looked for where it is not.
  if (created?.path !== `${parent}/${name}`)
    throw new Error(
      `${parent}/${name} was created as ${created?.path}: the server named it otherwise. Nuxeo ` +
        'cuts a name longer than nuxeo.path.segment.maxsize, 24 characters by default. Give it a ' +
        'shorter name in data.mjs.',
    );
  tally.created++;
  console.log(`  created  ${parent}/${name}`);
  return created;
}

function refuseOther(existing, path, type) {
  if (existing.type !== type)
    throw new Error(
      `${path} is a ${existing.type}, not a ${type}. It is not the seed's, so it is left alone; ` +
        'move it, or seed another server.',
    );
}

/**
 * Where the stored revisions disagree with the register: read back from the server, each chain
 * one number, no two chains the same, the revisions `data.mjs` names, the last current and the
 * others superseded by the next, each naming the one before.
 */
async function disagreementsOf(seeded) {
  const problems = [];
  const numbers = new Map();
  for (const chain of CHAINS) {
    const stored = [];
    for (const revision of seeded.get(chain.key))
      stored.push(await call('GET', `/id/${revision.uid}`));
    const number = stored[0].properties['docctl:number'];
    if (typeof number !== 'string' || !number.startsWith(`${chain.series}-`))
      problems.push(`${chain.key}: its number is ${number}, not one of series ${chain.series}`);
    if (numbers.has(number))
      problems.push(`${chain.key} and ${numbers.get(number)} share the number ${number}`);
    numbers.set(number, chain.key);
    stored.forEach((doc, index) => {
      const at = `${chain.key}, revision ${chain.revisions[index]}`;
      const last = index === stored.length - 1;
      const p = doc.properties;
      if (p['docctl:number'] !== number)
        problems.push(`${at}: number ${p['docctl:number']}, not ${number}`);
      if (p['docctl:revision'] !== chain.revisions[index])
        problems.push(`${at}: the server gave revision ${p['docctl:revision']}`);
      if (p['docctl:status'] !== (last ? 'current' : 'superseded'))
        problems.push(`${at}: ${p['docctl:status']}, not ${last ? 'current' : 'superseded'}`);
      const previous = stored[index - 1]?.uid ?? null;
      if ((p['docctl:supersedes'] || null) !== previous)
        problems.push(
          `${at}: supersedes ${p['docctl:supersedes'] || 'nothing'}, not ${previous ?? 'nothing'}`,
        );
      const next = stored[index + 1]?.uid ?? null;
      if ((p['docctl:supersededBy'] || null) !== next)
        problems.push(
          `${at}: superseded by ${p['docctl:supersededBy'] || 'nothing'}, not ${next ?? 'nothing'}`,
        );
    });
    seeded.set(chain.key, stored);
  }
  return problems;
}

/** Where the kit's page providers disagree with the register, for the revisions the seed wrote. */
async function providerDisagreements(seeded) {
  const problems = [];
  const ours = new Set([...seeded.values()].flat().map((doc) => doc.uid));
  const lasts = new Set([...seeded.values()].map((chain) => chain.at(-1).uid));
  const nameOf = new Map([...seeded.values()].flat().map((doc) => [doc.uid, doc.path]));
  const compare = (provider, returned, expected) => {
    const mine = returned.filter((uid) => ours.has(uid));
    for (const uid of expected)
      if (!mine.includes(uid)) problems.push(`${provider} does not return ${nameOf.get(uid)}`);
    for (const uid of mine)
      if (!expected.has(uid)) problems.push(`${provider} returns ${nameOf.get(uid)}`);
  };
  compare('controlled_documents_current', await results('controlled_documents_current'), lasts);
  compare(
    'controlled_documents_superseded',
    await results('controlled_documents_superseded'),
    new Set([...ours].filter((uid) => !lasts.has(uid))),
  );
  for (const chain of seeded.values()) {
    const number = chain[0].properties['docctl:number'];
    compare(
      `controlled_documents_revisions for ${number}`,
      await results('controlled_documents_revisions', [number]),
      new Set(chain.map((doc) => doc.uid)),
    );
  }
  return problems;
}

/** Every record a page provider returns, by id, page after page. */
async function results(pageProvider, queryParams = []) {
  const entries = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const query = new URLSearchParams({ pageSize: `${PAGE_SIZE}`, currentPageIndex: `${index}` });
    for (const parameter of queryParams) query.append('queryParams', parameter);
    const page = await call('GET', `/search/pp/${pageProvider}/execute?${query}`);
    entries.push(...(page?.entries ?? []));
    if (page?.isNextPageAvailable !== true) return entries.map((entry) => entry.uid);
  }
  throw new Error(
    `${pageProvider} still reports another page after ${MAX_PAGES} pages, past which the seed does ` +
      'not read, so it cannot say what the server holds.',
  );
}

/** A repository path as a URL path, each segment encoded. */
function pathOf(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** The answer to a GET, or `null` for a 404. */
async function find(path) {
  try {
    return await call('GET', path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/** A JSON call: the parsed answer, or `null` for an empty one. */
async function call(method, path, { json } = {}) {
  let response;
  let text;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: AUTHORIZATION,
        Accept: 'application/json',
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Read under the same timeout: a server that sends its headers and then stalls has not
    // answered either.
    text = await response.text();
  } catch (error) {
    const unanswered =
      `${SERVER} did not answer ${method} ${path}: ` +
      `${error?.cause?.code ?? error?.message ?? error}.`;
    if (preflighting)
      throw new Precondition(`${unanswered} Is Nuxeo running, and is NUXEO_URL its address?`);
    throw new Error(`${unanswered} The run stopped part way; running it again is safe.`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = text.slice(0, 200);
    }
    throw new HttpError(response.status, method, path, detail);
  }
  return text ? JSON.parse(text) : null;
}
