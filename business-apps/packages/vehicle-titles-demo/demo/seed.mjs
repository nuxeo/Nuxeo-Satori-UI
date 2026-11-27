#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the vehicle titles kit's fictional titles and vehicle deals, so that its
 * record pages, queues and home have something to show: eight titles and eight deals, from
 * `data.mjs`, under /default-domain/workspaces/vehicle-titles-demo, in a folder for each type.
 *
 *   node business-apps/packages/vehicle-titles-demo/demo/seed.mjs
 *
 * The package must be installed first: the records are of its stand-in model's types,
 * `VehicleTitle` and `VehicleDeal`, the deal with its checklist schema, `vehicledeal_docs`.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset. An account
 *                            that may create a workspace in /default-domain/workspaces.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *   NUXEO_INDEX_WAIT_MS      how long the search index may take to list what was written, for the
 *                            titles awaiting lien release, default 15000
 *
 * **It creates no user and no group.** The kit's groups, `vehicle-deal-desk` and
 * `vehicle-title-clerks`, and the people in them, are the server's: whoever installs the kit
 * decides them. The salespeople, finance managers and title clerks in `data.mjs` are user names
 * only.
 *
 * **Links are ids.** A deal's `vdeal:title` and `vdeal:tradeInTitle` hold their titles' ids, as
 * the deal page's `document-link` fields read them. So the titles are written first, then the
 * deals.
 *
 * **It never writes a deal's attachments,** `files:files`: a photo or a scanned document filed on
 * a deal, from the phone capture page or the Attachments panel, stays through a second run.
 *
 * **It writes a deal's checklist whole, every run:** `vdocs:checklist`, an entry for each document
 * the deal's checklist cards list, done or not as `data.mjs` says. A tick made in a demo is undone
 * by the next run, so that the demo can be given again; the checklist is the demo's data, as every
 * other property is.
 *
 * **Safe to run twice.** Every record has a fixed place, named by its number. One already there has
 * `data.mjs`'s values written over its own, dates counted again from today's UTC day, and a
 * property the data leaves empty emptied; a trashed one is restored. A place that holds a document
 * of another type is left alone, and the run stops.
 *
 * **It checks what it seeded.** Last, the kit's five page providers are asked, and each must
 * return every seeded record that belongs in it and none that does not, in its order: the deals
 * missing documents, the titles overdue, and each title's deals sold and taken in trade, from the
 * repository; and the titles awaiting lien release, from the search index, which lists a write a
 * moment later, so it is asked again until it agrees or NUXEO_INDEX_WAIT_MS has passed. Its two
 * facets' buckets must count at least the seeded titles awaiting release. Another record on the
 * server may be in them: the seed checks its own.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, a
 * place held another type, or a check failed; 2, a precondition, found before anything is
 * written: no credentials, no server, or one that does not answer /me as Nuxeo does, credentials
 * refused, the package not installed, or no /default-domain/workspaces.
 */
import {
  DEALS,
  EXPECTED,
  FOLDERS,
  LIEN_BUCKETS,
  TITLES,
  WORKSPACE,
  checklistOf,
  dayFrom,
} from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const INDEX_WAIT_MS = Number(process.env['NUXEO_INDEX_WAIT_MS']) || 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;
const TYPES = ['VehicleTitle', 'VehicleDeal'];
/** The deal's checklist schema, which the package's own checklist component adds to the type. */
const CHECKLIST_SCHEMA = 'vehicledeal_docs';

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
  console.log(`Seeding ${SERVER} with the vehicle titles kit's fictional titles and deals.`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description':
      'Fictional vehicle titles and deals for the vehicle titles kit. No real buyer or vehicle.',
  });
  for (const folder of Object.values(FOLDERS))
    await ensure(ROOT, folder.name, 'Folder', { 'dc:title': folder.title });

  const today = new Date();
  const day = (days) => (days === undefined ? null : dayFrom(days, today));
  const titles = new Map();
  for (const title of TITLES) {
    const document = await ensure(
      `${ROOT}/${FOLDERS.titles.name}`,
      nameOf(title.number),
      'VehicleTitle',
      {
        'dc:title': title.summary,
        'vtitle:number': title.number,
        'vtitle:issuingState': title.issuingState,
        'vtitle:vin': title.vin,
        'vtitle:vehicle': title.vehicle,
        'vtitle:owner': title.owner,
        'vtitle:status': title.status,
        'vtitle:lienHolder': title.lienHolder ?? null,
        'vtitle:payoffSentOn': day(title.payoffSentOn),
        'vtitle:lienReleasedOn': day(title.lienReleasedOn),
        'vtitle:openedOn': day(title.openedOn),
        'vtitle:submittedOn': day(title.submittedOn),
        'vtitle:issuedOn': day(title.issuedOn),
        'vtitle:clerk': title.clerk ?? null,
        'vtitle:notes': title.notes ?? null,
      },
    );
    titles.set(title.number, document.uid);
  }

  const linked = (number) => {
    if (number === undefined) return null;
    if (!titles.has(number)) throw new Error(`data.mjs names a title ${number} it does not seed.`);
    return titles.get(number);
  };
  const deals = new Map();
  for (const deal of DEALS) {
    // files:files is not among them: a deal's photos and documents are not the seed's.
    const document = await ensure(
      `${ROOT}/${FOLDERS.deals.name}`,
      nameOf(deal.number),
      'VehicleDeal',
      {
        'dc:title': deal.summary,
        'vdeal:number': deal.number,
        'vdeal:buyer': deal.buyer,
        'vdeal:buyerEmail': deal.buyerEmail,
        'vdeal:buyerPhone': deal.buyerPhone,
        'vdeal:vin': deal.vin,
        'vdeal:year': deal.year,
        'vdeal:make': deal.make,
        'vdeal:model': deal.model,
        'vdeal:price': deal.price,
        'vdeal:financeType': deal.financeType,
        'vdeal:lender': deal.lender ?? null,
        'vdeal:amountFinanced': deal.amountFinanced ?? null,
        'vdeal:termMonths': deal.termMonths ?? null,
        'vdeal:tradeIn': deal.tradeIn,
        'vdeal:tradeInVehicle': deal.tradeInVehicle ?? null,
        'vdeal:tradeInVin': deal.tradeInVin ?? null,
        'vdeal:tradeInAllowance': deal.tradeInAllowance ?? null,
        'vdeal:tradeInPayoff': deal.tradeInPayoff ?? null,
        'vdeal:tradeInTitle': linked(deal.tradeInTitle),
        'vdeal:title': linked(deal.title),
        'vdeal:status': deal.status,
        'vdeal:salesperson': deal.salesperson ?? null,
        'vdeal:financeManager': deal.financeManager ?? null,
        'vdeal:soldOn': day(deal.soldOn),
        'vdeal:deliveredOn': day(deal.deliveredOn),
        'vdeal:notes': deal.notes ?? null,
        'vdocs:checklist': checklistOf(deal, today),
      },
    );
    deals.set(deal.number, document.uid);
  }

  const problems = await disagreements({ titles, deals });
  if (problems.length > 0)
    throw new Error(`The page providers disagree with the seed:\n  ${problems.join('\n  ')}`);
  console.log(`  checked  ${Object.keys(EXPECTED).join(', ')}`);

  const { created, updated, restored } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash. ` +
      'The page providers return what was seeded.',
  );
  console.log(`The home: ${APP}/#/home`);
  console.log(`Deals missing documents: ${APP}/#/queues/vehicle-deals-missing-documents`);
  console.log(`Titles overdue: ${APP}/#/queues/vehicle-titles-overdue`);
  console.log(`Titles awaiting lien release: ${APP}/#/queues/vehicle-titles-awaiting-lien-release`);
  console.log(`A deal missing its odometer statement: ${APP}/#/doc/${deals.get('VD-5002')}`);
  console.log(`A financed deal not funded after 14 days: ${APP}/#/doc/${deals.get('VD-5004')}`);
  console.log(`A title sold twice, and overdue: ${APP}/#/doc/${titles.get('TTL-6002')}`);
}

/** The server answers, the credentials are accepted, the package's types are installed. */
async function preflight() {
  let me;
  try {
    me = await call('GET', '/me');
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
  // Nuxeo answers /me with the user signed in, an object with its id.
  if (typeof me?.id !== 'string' || me.id === '')
    throw new Precondition(
      `${SERVER} answered GET /me with no user: is NUXEO_URL a Nuxeo server's address?`,
    );
  for (const type of TYPES) {
    const described = await find(`/config/types/${type}`);
    if (described === null)
      throw new Precondition(
        `${SERVER} has no ${type} type: install the vehicle-titles-demo package first ` +
          '(business-apps/packages/vehicle-titles-demo/README.md), then run this again.',
      );
    // The checklist schema comes from the package's own checklist component: without it, every
    // write of a deal's checklist would be refused part way.
    const schemas = (Array.isArray(described.schemas) ? described.schemas : []).map((schema) =>
      typeof schema === 'string' ? schema : schema?.name,
    );
    if (type === 'VehicleDeal' && !schemas.includes(CHECKLIST_SCHEMA))
      throw new Precondition(
        `${SERVER}'s VehicleDeal type has no ${CHECKLIST_SCHEMA} schema, which the package's ` +
          'checklist component adds: install vehicle-titles-demo whole, then run this again.',
      );
  }
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
 * Restoring it gives the name back. The P&C claims and moves kits' seeds do the same.
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
 * Where the kit's page providers disagree with `EXPECTED`, for the records the seed wrote: one that
 * belongs and is missing, one that does not and is there, its own out of order, or one listed
 * twice. The titles awaiting lien release are asked again while the search index catches up.
 */
async function disagreements({ titles, deals }) {
  const problems = [];
  const keyOf = new Map([...titles, ...deals].map(([key, uid]) => [uid, key]));
  const compare = (what, returned, expected) => {
    const own = returned.map((uid) => keyOf.get(uid)).filter((key) => key !== undefined);
    const found = [];
    for (const key of expected)
      if (!own.includes(key)) found.push(`${what} does not return ${key}`);
    for (const key of new Set(own))
      if (!expected.includes(key)) found.push(`${what} returns ${key}`);
    if (found.length === 0 && own.join() !== expected.join())
      found.push(`${what} returns ${own.join(', ')}, not ${expected.join(', ')}`);
    return found;
  };

  for (const pageProvider of ['vtitles_deals_missing_documents', 'vtitles_overdue_titles'])
    problems.push(...compare(pageProvider, await results(pageProvider), EXPECTED[pageProvider]));
  for (const pageProvider of ['vtitles_title_sales', 'vtitles_title_trade_ins'])
    for (const [number, uid] of titles)
      problems.push(
        ...compare(
          `${pageProvider} for ${number}`,
          await results(pageProvider, uid),
          EXPECTED[pageProvider][number],
        ),
      );

  // The search index lists a write a moment after the repository: ask again until it agrees.
  const deadline = Date.now() + INDEX_WAIT_MS;
  let awaiting;
  for (;;) {
    const { uids, aggregations } = await indexed('vtitles_awaiting_lien_release');
    awaiting = [
      ...compare('vtitles_awaiting_lien_release', uids, EXPECTED.vtitles_awaiting_lien_release),
      ...bucketProblems(aggregations),
    ];
    if (awaiting.length === 0 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  problems.push(...awaiting);
  return problems;
}

/** Where the lien release queue's facets count fewer than the seeded titles in a bucket. */
function bucketProblems(aggregations) {
  const problems = [];
  for (const [aggregate, expected] of Object.entries(LIEN_BUCKETS)) {
    const buckets = aggregations?.[aggregate]?.buckets;
    if (!Array.isArray(buckets)) {
      problems.push(
        `vtitles_awaiting_lien_release answers no aggregate ${aggregate}, which its facet needs`,
      );
      continue;
    }
    for (const [key, count] of Object.entries(expected)) {
      const bucket = buckets.find((b) => String(b?.key) === key);
      if (!bucket || !(Number(bucket.docCount) >= count))
        problems.push(
          `vtitles_awaiting_lien_release's ${aggregate} counts ${bucket ? bucket.docCount : 'nothing'} in ${key}, not at least ${count}`,
        );
    }
  }
  return problems;
}

/** Every record a page provider returns, by id, page after page, given its parameter if any. */
async function results(pageProvider, parameter) {
  const entries = await everyPage(pageProvider, (index) => execute(pageProvider, index, parameter));
  return entries.map((entry) => entry.uid);
}

/** A page provider of the search index: every record by id, and the first page's aggregates. */
async function indexed(pageProvider) {
  let aggregations;
  const entries = await everyPage(pageProvider, async (index) => {
    const page = await execute(pageProvider, index);
    if (index === 0) aggregations = page?.aggregations;
    return page;
  });
  return { uids: entries.map((entry) => entry.uid), aggregations };
}

function execute(pageProvider, index, parameter) {
  return call(
    'GET',
    `/search/pp/${pageProvider}/execute?${new URLSearchParams({
      pageSize: `${PAGE_SIZE}`,
      currentPageIndex: `${index}`,
      ...(parameter === undefined ? {} : { queryParams: parameter }),
    })}`,
  );
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
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    const notJson = `${SERVER} answered ${method} ${path} with something that is not JSON.`;
    if (preflighting) throw new Precondition(`${notJson} Is NUXEO_URL a Nuxeo server's address?`);
    throw new Error(notJson);
  }
}
