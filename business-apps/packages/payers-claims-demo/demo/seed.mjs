#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the Payers kit's fictional records, so that its record pages and queue
 * have something to show: four members, three providers, eight claims, three cases and four claim
 * documents, from `data.mjs`.
 *
 *   node business-apps/packages/payers-claims-demo/demo/seed.mjs
 *
 * The package must be installed first: the records are of its stand-in model's types.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *
 * **Safe to run twice.** Every record has a fixed place under
 * /default-domain/workspaces/payers-demo, named by its number. A record already there has
 * `data.mjs`'s values written over its own, a trashed one is restored, and a file already holding
 * the same bytes is not uploaded again. A place that holds a document of another type is left
 * alone, and the run stops.
 *
 * **It checks what it seeded.** Last, it runs the kit's five page providers and compares what they
 * return with what it wrote (`check`), so a run that passes has run each of them on the server.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, or
 * a check failed; 2, a precondition, found before anything is written: no credentials, no server,
 * credentials refused, the package not installed, or no /default-domain/workspaces.
 */
import { CASES, CLAIM_DOCUMENTS, CLAIMS, MEMBERS, PROVIDERS } from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/payers-demo`;
const FOLDERS = {
  members: 'Members',
  providers: 'Providers',
  claims: 'Claims',
  cases: 'Cases',
  documents: 'Claim documents',
};
const TYPES = ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument'];
const PAGE_PROVIDERS = [
  'member_claims',
  'member_cases',
  'provider_claims',
  'payers_claim_documents',
  'payers_unassigned_claims',
];

/** A precondition the environment or the server does not meet: fix it, not the script. */
class Precondition extends Error {}

/** The server answered with an error status. */
class HttpError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path}: HTTP ${status}${detail ? `, ${detail}` : ''}`);
    this.status = status;
  }
}

const tally = { created: 0, updated: 0, restored: 0, uploaded: 0 };
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
  console.log(`Seeding ${SERVER} with the Payers kit's fictional records.`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, 'payers-demo', 'Workspace', {
    'dc:title': 'Payers demo',
    'dc:description': 'Fictional records for the Payers kit. No real person, provider or claim.',
  });
  for (const [name, title] of Object.entries(FOLDERS)) {
    await ensure(ROOT, name, 'Folder', { 'dc:title': title });
  }

  const members = new Map();
  for (const member of MEMBERS) {
    const document = await ensure(`${ROOT}/members`, nameOf(member.number), 'Member', {
      'dc:title': `${member.firstName} ${member.lastName}`,
      'member:number': member.number,
      'member:firstName': member.firstName,
      'member:lastName': member.lastName,
      'member:birthDate': member.birthDate,
      'member:address': member.address,
      'member:phone': member.phone,
      'member:email': member.email,
      'member:plan': member.plan,
      'member:status': member.status,
      'member:ssn': member.ssn,
    });
    members.set(member.number, document.uid);
  }

  const providers = new Map();
  for (const provider of PROVIDERS) {
    const document = await ensure(`${ROOT}/providers`, nameOf(provider.number), 'Provider', {
      'dc:title': provider.name,
      'provider:number': provider.number,
      'provider:npi': provider.npi,
      'provider:specialty': provider.specialty,
      'provider:network': provider.network,
      'provider:phone': provider.phone,
      'provider:address': provider.address,
    });
    providers.set(provider.number, document.uid);
  }

  const claims = new Map();
  for (const claim of CLAIMS) {
    const document = await ensure(`${ROOT}/claims`, nameOf(claim.number), 'Claim', {
      'dc:title': claim.number,
      'claim:number': claim.number,
      'claim:member': idOf(members, claim.member, claim.number),
      'claim:provider': idOf(providers, claim.provider, claim.number),
      'claim:serviceDate': claim.serviceDate,
      'claim:serviceStart': claim.serviceStart ?? null,
      'claim:serviceEnd': claim.serviceEnd ?? null,
      'claim:received': claim.received,
      'claim:billedAmount': claim.billedAmount,
      'claim:allowedAmount': claim.allowedAmount,
      'claim:status': claim.status,
      'claim:adjuster': claim.adjuster,
      'claim:diagnosis': claim.diagnosis,
    });
    claims.set(claim.number, document.uid);
  }

  const cases = new Map();
  for (const kase of CASES) {
    const document = await ensure(`${ROOT}/cases`, nameOf(kase.number), 'Case', {
      'dc:title': kase.title,
      'case:number': kase.number,
      'case:member': idOf(members, kase.member, kase.number),
      'case:claim': kase.claim === null ? null : idOf(claims, kase.claim, kase.number),
      'case:category': kase.category,
      'case:state': kase.state,
      'case:received': kase.received,
      'case:due': kase.due,
      'case:assignee': kase.assignee,
      'case:summary': kase.summary,
    });
    cases.set(kase.number, document.uid);
  }

  const documents = new Map();
  for (const file of CLAIM_DOCUMENTS) {
    const fileName = `${nameOf(file.title)}.txt`;
    const bytes = Buffer.from(
      `${file.title}, ${file.category.toLowerCase()} for claim ${file.claim}.\n\n` +
        'A fictional document of the Payers kit demo. No real person, provider or claim.\n',
    );
    const document = await ensure(
      `${ROOT}/documents`,
      nameOf(file.number),
      'ClaimDocument',
      {
        'dc:title': file.title,
        'claimdoc:claim': file.claim,
        'claimdoc:category': file.category,
      },
      { fileName, bytes },
    );
    documents.set(file.number, document.uid);
  }

  await check({ members, providers, claims, cases, documents });

  const { created, updated, restored, uploaded } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash, ` +
      `${uploaded} file(s) uploaded. The page providers return what was seeded.`,
  );
  console.log(`A member's record page: ${APP}/#/doc/${members.get(MEMBERS[0].number)}`);
  console.log(`A provider's record page: ${APP}/#/doc/${providers.get(PROVIDERS[2].number)}`);
}

/** The server answers, the credentials are accepted, and the package's types are installed. */
async function preflight() {
  try {
    await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    throw error;
  }
  const missing = [];
  for (const type of TYPES) {
    if ((await find(`/config/types/${type}`)) === null) missing.push(type);
  }
  if (missing.length > 0)
    throw new Precondition(
      `${SERVER} has no ${missing.join(', ')} type: install the payers-claims-demo package first ` +
        '(business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the records go.`);
}

/**
 * The document at `parent/name`, created or updated to `properties`. With `file`, its
 * `file:content` holds those bytes, uploaded only when the document does not already hold them.
 */
async function ensure(parent, name, type, properties, file) {
  const path = `${parent}/${name}`;
  const existing = (await find(`/path${pathOf(path)}`)) ?? (await trashedFrom(parent, name));
  if (existing === null) {
    const content = file ? { 'file:content': await upload(file) } : {};
    const created = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties: { ...properties, ...content } },
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
  const content =
    file && !(await holds(existing, file)) ? { 'file:content': await upload(file) } : {};
  const updated = await call('PUT', `/id/${existing.uid}`, {
    json: { 'entity-type': 'document', properties: { ...properties, ...content } },
  });
  tally.updated++;
  console.log(`  updated  ${path}`);
  return updated;
}

/**
 * The document trashed from `parent/name`, or `null`. Nuxeo renames what it trashes, to
 * `<name>._<time>_.trashed`, unless it is configured not to, so the record's place no longer finds
 * it. Restoring it gives the name back.
 */
async function trashedFrom(parent, name) {
  const folder = await find(`/path${pathOf(parent)}`);
  if (folder === null) return null;
  const entries = await nxql(
    `SELECT * FROM Document WHERE ecm:parentId = ${literal(folder.uid)} AND ecm:isTrashed = 1 ` +
      `AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:name LIKE ${literal(`${name}._%_.trashed`)}`,
  );
  if (entries.length > 1)
    throw new Error(
      `${parent} holds ${entries.length} trashed documents named ${name}, and the seed restores ` +
        'only one. Restore or delete all but one, then run this again.',
    );
  return entries[0] ?? null;
}

/** Whether the document's file is already `file`, by name and bytes. */
async function holds(document, file) {
  const current = document.properties?.['file:content'];
  if (!current || current.name !== file.fileName || Number(current.length) !== file.bytes.length)
    return false;
  const response = await request('GET', `/id/${document.uid}/@blob/file:content`);
  return Buffer.from(await response.arrayBuffer()).equals(file.bytes);
}

/** A text file uploaded to a new batch, as the value a document's `file:content` takes. */
async function upload({ fileName, bytes }) {
  const { batchId } = await call('POST', '/upload/');
  await call('POST', `/upload/${batchId}/0`, {
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName),
      'X-File-Type': 'text/plain',
      'X-File-Size': String(bytes.length),
    },
  });
  tally.uploaded++;
  return { 'upload-batch': batchId, 'upload-fileId': '0' };
}

/**
 * What the kit's page providers return: for each member and each provider, exactly the claims and
 * cases seeded for it; for each claim number, at least the documents seeded for it, since another
 * record on the server could carry the same number; and in the queue, every seeded claim that is
 * unassigned and still to be decided, and none of the others.
 */
async function check({ members, providers, claims, cases, documents }) {
  const problems = [];
  const expect = async (pageProvider, parameter, wanted, { exact = true } = {}) => {
    const found = await results(pageProvider, parameter);
    const missing = wanted.filter((uid) => !found.includes(uid));
    const extra = exact ? found.filter((uid) => !wanted.includes(uid)) : [];
    if (missing.length > 0 || extra.length > 0)
      problems.push(
        `${pageProvider}(${parameter ?? ''}) returned ${found.length}, ` +
          `missing ${missing.length} seeded, with ${extra.length} not seeded`,
      );
  };
  for (const member of MEMBERS) {
    const id = members.get(member.number);
    await expect(
      'member_claims',
      id,
      CLAIMS.filter((claim) => claim.member === member.number).map((c) => claims.get(c.number)),
    );
    await expect(
      'member_cases',
      id,
      CASES.filter((kase) => kase.member === member.number).map((k) => cases.get(k.number)),
    );
  }
  for (const provider of PROVIDERS) {
    await expect(
      'provider_claims',
      providers.get(provider.number),
      CLAIMS.filter((claim) => claim.provider === provider.number).map((c) => claims.get(c.number)),
    );
  }
  for (const claim of CLAIMS) {
    // Another record on the server could carry the same claim number, so seeded ones must be in.
    await expect(
      'payers_claim_documents',
      claim.number,
      CLAIM_DOCUMENTS.filter((file) => file.claim === claim.number).map((f) =>
        documents.get(f.number),
      ),
      { exact: false },
    );
  }
  const unassigned = CLAIMS.filter(
    (claim) => claim.adjuster === null && ['submitted', 'inReview'].includes(claim.status),
  );
  const assigned = CLAIMS.filter((claim) => !unassigned.includes(claim));
  const queue = await results('payers_unassigned_claims');
  for (const claim of unassigned)
    if (!queue.includes(claims.get(claim.number)))
      problems.push(`payers_unassigned_claims does not hold ${claim.number}`);
  for (const claim of assigned)
    if (queue.includes(claims.get(claim.number)))
      problems.push(`payers_unassigned_claims holds ${claim.number}, which is not unassigned`);
  if (problems.length > 0)
    throw new Error(`The page providers disagree with the seed:\n  ${problems.join('\n  ')}`);
  console.log(`  checked  ${PAGE_PROVIDERS.join(', ')}`);
}

/** Every id a page provider returns, given one parameter or none, page after page. */
async function results(pageProvider, parameter) {
  const ids = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const query = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      currentPageIndex: `${index}`,
    });
    if (parameter !== undefined) query.set('queryParams', parameter);
    const page = await call('GET', `/search/pp/${pageProvider}/execute?${query}`);
    ids.push(...(page.entries ?? []).map((entry) => entry.uid));
    if (page.isNextPageAvailable !== true) return ids;
  }
  throw new Error(
    `${pageProvider} returns more than ${MAX_PAGES * PAGE_SIZE} records, past which the check ` +
      'does not read, so it cannot say what the page provider holds.',
  );
}

/** The documents an NXQL query finds, up to one page: the callers expect one or none. */
async function nxql(query) {
  const page = await call(
    'GET',
    `/search/lang/NXQL/execute?${new URLSearchParams({ query, pageSize: `${PAGE_SIZE}` })}`,
  );
  return page.entries ?? [];
}

/** An NXQL string literal. */
function literal(text) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function idOf(ids, number, from) {
  const id = ids.get(number);
  if (!id) throw new Error(`data.mjs: ${from} refers to ${number}, which it does not define`);
  return id;
}

/** A record's document name: its number or title, lower case, letters, digits and hyphens. */
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
async function call(method, path, options = {}) {
  const response = await request(method, path, options);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function request(method, path, { json, body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: AUTHORIZATION,
        Accept: 'application/json',
        // Every schema of a document, so that its file can be compared.
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? body : JSON.stringify(json),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const unanswered =
      `${SERVER} did not answer ${method} ${path}: ` +
      `${error?.cause?.code ?? error?.message ?? error}.`;
    // Before anything is written, no answer means no server. After, the run stopped part way.
    if (preflighting)
      throw new Precondition(`${unanswered} Is Nuxeo running, and is NUXEO_URL its address?`);
    throw new Error(`${unanswered} The run stopped part way; running it again is safe.`);
  }
  if (!response.ok) {
    const text = await response.text();
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = text.slice(0, 200);
    }
    throw new HttpError(response.status, method, path, detail);
  }
  return response;
}
