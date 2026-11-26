#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the contracts kit's fictional contracts, so that its record page, queue
 * and home have something to show: seven contracts, from `data.mjs`, under
 * /default-domain/workspaces/contracts-demo/contracts.
 *
 *   node business-apps/packages/contracts-demo/demo/seed.mjs
 *
 * The package must be installed first: the records are of its stand-in model's type, `Contract`.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset. An account
 *                            that may create a workspace in /default-domain/workspaces.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *
 * **It creates no user and no group.** The kit's groups, `contract-managers` and
 * `legal-reviewers`, and the people in them, are the server's: whoever installs the kit decides
 * them. The contracts' owners, in `data.mjs`, are user names only.
 *
 * **Safe to run twice.** Every contract has a fixed place, named by its number. One already there
 * has `data.mjs`'s values written over its own, dates counted again from today's UTC day, and a
 * trashed one is restored. A place that holds a document of another type is left alone, and the
 * run stops.
 *
 * **It checks what it seeded.** Last, the kit's three page providers are asked, from the
 * repository, and each must return every seeded contract that belongs in it and none that does
 * not, the renewals in the order of their end dates, the one already ended, CTR-1007, among them.
 * Another contract on the server may be in them: the seed checks its own.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, a
 * place held another type, or a check failed; 2, a precondition, found before anything is
 * written: no credentials, no server, or one that does not answer /me as Nuxeo does, credentials
 * refused, the package not installed, or no /default-domain/workspaces.
 */
import { CONTRACTS, EXPECTED, FOLDER, RENEWALS, WORKSPACE, dayFrom } from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

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

const tally = { created: 0, updated: 0, restored: 0 };
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
  console.log(`Seeding ${SERVER} with the contracts kit's fictional contracts.`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description': 'Fictional contracts for the contracts kit. No real company or contract.',
  });
  await ensure(ROOT, FOLDER.name, 'Folder', { 'dc:title': FOLDER.title });

  const today = new Date();
  const seeded = new Map();
  for (const contract of CONTRACTS) {
    const document = await ensure(HOLDER, nameOf(contract.number), 'Contract', {
      'dc:title': contract.title,
      'contract:number': contract.number,
      'contract:counterparty': contract.counterparty,
      'contract:category': contract.category,
      'contract:status': contract.status,
      'contract:value': contract.value,
      'contract:currency': contract.currency,
      'contract:start': dayFrom(contract.start, today),
      'contract:end': dayFrom(contract.end, today),
      'contract:noticeDays': contract.noticeDays,
      'contract:autoRenew': contract.autoRenew,
      'contract:owner': contract.owner,
      'contract:terminationReason': contract.terminationReason ?? null,
      'contract:notes': contract.notes,
    });
    seeded.set(contract.number, document.uid);
  }

  const problems = await disagreements(seeded);
  if (problems.length > 0)
    throw new Error(`The page providers disagree with the seed:\n  ${problems.join('\n  ')}`);
  console.log(`  checked  ${Object.keys(EXPECTED).join(', ')}`);

  const { created, updated, restored } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash. ` +
      'The page providers return what was seeded.',
  );
  console.log(`The home: ${APP}/#/home`);
  console.log(`The queue, up for renewal or overdue: ${APP}/#/queues/up-for-renewal`);
  console.log(`A contract up for renewal: ${APP}/#/doc/${seeded.get(RENEWALS.due[0])}`);
  console.log(`A contract overdue for renewal: ${APP}/#/doc/${seeded.get(RENEWALS.overdue[0])}`);
  console.log(
    `A terminated contract: ${APP}/#/doc/${seeded.get(EXPECTED.contracts_terminated[0])}`,
  );
}

/** The server answers, the credentials are accepted, the package's type is installed. */
async function preflight() {
  try {
    await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    // Any other refusal of the first read: not a Nuxeo that answers as one, before any write.
    if (error instanceof HttpError)
      throw new Precondition(
        `${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`,
      );
    throw error;
  }
  if ((await find('/config/types/Contract')) === null)
    throw new Precondition(
      `${SERVER} has no Contract type: install the contracts-demo package first ` +
        '(business-apps/packages/contracts-demo/README.md), then run this again.',
    );
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the records go.`);
}

/**
 * The document at `parent/name`: created with `properties` when it is not there, restored from
 * the trash when it was trashed, and given `properties` when it is. Refused when it is another
 * type, which is not the seed's.
 */
async function ensure(parent, name, type, properties) {
  const path = `${parent}/${name}`;
  const existing = (await find(`/path${pathOf(path)}`)) ?? (await trashedFrom(parent, name));
  if (existing === null) {
    const created = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties },
    });
    tally.created++;
    console.log(`  created  ${path}`);
    return created;
  }
  if (existing.type !== type)
    throw new Error(
      `${path} is a ${existing.type}, not a ${type}. It is not the seed's, so it is left alone; ` +
        'move it, or seed another server.',
    );
  if (existing.isTrashed === true) {
    await call('POST', '/automation/Document.Untrash', {
      json: { input: `doc:${existing.uid}`, params: {} },
    });
    tally.restored++;
    console.log(`  restored ${path}`);
  }
  const updated = await call('PUT', `/id/${existing.uid}`, {
    json: { 'entity-type': 'document', properties },
  });
  tally.updated++;
  console.log(`  updated  ${path}`);
  return updated;
}

/**
 * The document trashed from `parent/name`, or `null`, found in the repository itself. Nuxeo
 * renames what it trashes, to `<name>._<time>_.trashed`, so the record's place no longer finds it.
 * Restoring it gives the name back. The Payers kit's seed does the same, and says why.
 */
async function trashedFrom(parent, name) {
  const folder = await find(`/path${pathOf(parent)}`);
  if (folder === null) return null;
  const renamed = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\._\\d+_\\.trashed$`);
  const entries = (
    await nxql(
      `SELECT * FROM Document WHERE ecm:parentId = ${literal(folder.uid)} AND ecm:isTrashed = 1 ` +
        `AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:name LIKE ${literal(`${name}._%_.trashed`)}`,
    )
  ).filter((entry) => renamed.test(entry.path.slice(entry.path.lastIndexOf('/') + 1)));
  if (entries.length > 1)
    throw new Error(
      `${parent} holds ${entries.length} trashed documents named ${name}, and the seed restores ` +
        'only one. Restore or delete all but one, then run this again.',
    );
  return entries[0] ?? null;
}

/**
 * Where the kit's page providers disagree with `EXPECTED`, for the contracts the seed wrote: one
 * that belongs and is missing, one that does not and is there, or the renewals out of order.
 */
async function disagreements(seeded) {
  const numberOf = new Map([...seeded].map(([number, uid]) => [uid, number]));
  const problems = [];
  for (const [pageProvider, expected] of Object.entries(EXPECTED)) {
    const returned = (await results(pageProvider))
      .map((uid) => numberOf.get(uid))
      .filter((number) => number !== undefined);
    for (const number of expected)
      if (!returned.includes(number)) problems.push(`${pageProvider} does not return ${number}`);
    for (const number of returned)
      if (!expected.includes(number)) problems.push(`${pageProvider} returns ${number}`);
    const inOrder = returned.filter((number) => expected.includes(number));
    if (
      pageProvider === 'contracts_up_for_renewal' &&
      inOrder.length === expected.length &&
      inOrder.join() !== expected.join()
    )
      problems.push(`${pageProvider} returns ${inOrder.join(', ')}, not ${expected.join(', ')}`);
  }
  return problems;
}

/** Every record a page provider returns, by id, page after page. */
async function results(pageProvider) {
  const entries = await everyPage(pageProvider, (index) =>
    call(
      'GET',
      `/search/pp/${pageProvider}/execute?${new URLSearchParams({
        pageSize: `${PAGE_SIZE}`,
        currentPageIndex: `${index}`,
      })}`,
    ),
  );
  return entries.map((entry) => entry.uid);
}

/** Every document an NXQL query finds in the repository, through `Repository.Query`. */
async function nxql(query) {
  return everyPage('The NXQL query', (index) =>
    call('POST', '/automation/Repository.Query', {
      json: { params: { query, pageSize: PAGE_SIZE, currentPageIndex: index } },
    }),
  );
}

/** Every entry of a paged search. A server may cap a page below the size asked for. */
async function everyPage(what, pageAt) {
  const entries = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await pageAt(index);
    entries.push(...(page?.entries ?? []));
    if (page?.isNextPageAvailable !== true) return entries;
  }
  throw new Error(
    `${what} still reports another page after ${MAX_PAGES} pages (${entries.length} records ` +
      'read), past which the seed does not read, so it cannot say what the server holds.',
  );
}

/** An NXQL string literal. */
function literal(text) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/** A record's document name: its number, lower case, letters, digits and hyphens. */
function nameOf(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
