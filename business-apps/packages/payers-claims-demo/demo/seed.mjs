#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the Payers kit's fictional records and people, so that its record pages,
 * queues and home have something to show: four members, three providers, eight claims, three cases
 * and four claim documents, and the four people who work them, in the three groups the kit's rules
 * name, from `data.mjs`.
 *
 *   node business-apps/packages/payers-claims-demo/demo/seed.mjs
 *
 * The package must be installed first: the records are of its stand-in model's types.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default. An empty value counts as unset. An
 *                            administrator: only one may create users and groups.
 *   PAYERS_DEMO_PASSWORD     required, with no default: the password the demo's people are given,
 *                            and put back to on every run. Choose one for this server.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end,
 *                            default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *   NUXEO_INDEX_WAIT_MS      how long the checks are asked again while the search index catches
 *                            up with what was written, default 60000
 *
 * **Safe to run twice.** Every record has a fixed place under
 * /default-domain/workspaces/payers-demo, named by its number. A record already there has
 * `data.mjs`'s values written over its own, a trashed one is restored, and a file already holding
 * the same bytes is not uploaded again. A place that holds a document of another type is left
 * alone, and the run stops. A user or a group of the same name that the seed did not create, which
 * it knows by its marker (`MARKER`), is left alone too, and the run stops.
 *
 * **The people.** Each user is created, or put back to `data.mjs`'s values: name, e-mail, groups
 * and password. The seeded workspace and its folders give the demo's groups the permissions
 * `data.mjs` names, and only those: one of theirs it does not name is removed. Anyone else's stays.
 *
 * **It checks what it seeded.** Last, it runs the kit's seven page
 * providers and compares what they return with what it wrote (`check`), so a run that passes has
 * run each of them on the server. The queue page providers' aggregates are checked too, and each
 * adjuster's claims are asked for as that adjuster, signed in with the password given, through
 * `$currentUser`: what the my-claims queue and the home send.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering part way, or
 * a check failed; 2, a precondition, found before anything is written: no credentials, no demo
 * password, no server, credentials refused or not an administrator's, the package not installed,
 * or no /default-domain/workspaces.
 */
import {
  CASES,
  CLAIM_DOCUMENTS,
  CLAIMS,
  GRANTS,
  GROUPS,
  MEMBERS,
  PROVIDERS,
  USERS,
} from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const INDEX_WAIT_MS = Number(process.env['NUXEO_INDEX_WAIT_MS']) || 60_000;
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
  'payers_my_claims',
  'payers_pending_claims',
];
/** The statuses `payers_pending_claims` holds, as the stand-in model's query names them. */
const PENDING = ['inReview', 'pended'];
/**
 * How a user or a group the seed created is known again: a user's `company`, a group's
 * `description`. One without it is not the seed's, and is left alone.
 */
const MARKER = 'Payers kit demo (fictional)';

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
const people = { created: 0, updated: 0, granted: 0, removed: 0 };
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
const demoPassword = process.env['PAYERS_DEMO_PASSWORD'];
if (!demoPassword) {
  console.error(
    "PAYERS_DEMO_PASSWORD must be set, and has no default: the password the demo's users are " +
      'given. Choose one for this server, and export it:\n' +
      '  export PAYERS_DEMO_PASSWORD=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const basic = (user, secret) => `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
const AUTHORIZATION = basic(username, password);

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

  for (const group of GROUPS) await ensureGroup(group);
  for (const user of USERS) await ensureUser(user);

  const places = new Map();
  places.set(
    '',
    await ensure(WORKSPACES, 'payers-demo', 'Workspace', {
      'dc:title': 'Payers demo',
      'dc:description': 'Fictional records for the Payers kit. No real person, provider or claim.',
    }),
  );
  for (const [name, title] of Object.entries(FOLDERS)) {
    places.set(name, await ensure(ROOT, name, 'Folder', { 'dc:title': title }));
  }
  for (const [place, document] of places) await grant(place, document);

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
  console.log(
    `People: ${people.created} created, ${people.updated} updated, ${people.granted} ` +
      `permission(s) granted, ${people.removed} removed, for ${USERS.length} users in ` +
      `${GROUPS.length} groups: ` +
      `${USERS.map((user) => `${user.username} (${user.groups.join(', ')})`).join('; ')}.`,
  );
  console.log(`A member's record page: ${APP}/#/doc/${members.get(MEMBERS[0].number)}`);
  console.log(`A provider's record page: ${APP}/#/doc/${providers.get(PROVIDERS[2].number)}`);
}

/**
 * The server answers, the credentials are accepted and are an administrator's, and the package's
 * types are installed.
 */
async function preflight() {
  let me;
  try {
    me = await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    throw error;
  }
  if (me?.isAdministrator !== true)
    throw new Precondition(
      `NUXEO_USER is not an administrator on ${SERVER}, and only one may create the demo's users ` +
        'and groups. Sign in as one.',
    );
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

/** The group, created with no members, or left as it is when the seed created it before. */
async function ensureGroup({ name, label }) {
  const existing = await find(`/group/${encodeURIComponent(name)}`);
  if (existing === null) {
    await call('POST', '/group', {
      json: {
        'entity-type': 'group',
        groupname: name,
        grouplabel: label,
        properties: { groupname: name, grouplabel: label, description: MARKER },
      },
    });
    people.created++;
    console.log(`  created  group ${name}`);
    return;
  }
  if (existing.properties?.description !== MARKER)
    throw new Error(
      `${SERVER} has a group ${name} that the seed did not create, so it is left alone. ` +
        'Seed another server, or rename that group.',
    );
}

/**
 * The user, created or put back to `data.mjs`'s values and the demo password. Their groups are
 * `data.mjs`'s alone: a user the seed created is the seed's.
 */
async function ensureUser({ username: id, firstName, lastName, groups }) {
  const properties = {
    username: id,
    firstName,
    lastName,
    email: `${id}@example.com`,
    company: MARKER,
    groups,
    password: demoPassword,
  };
  const existing = await find(`/user/${encodeURIComponent(id)}`);
  if (existing === null) {
    await call('POST', '/user', { json: { 'entity-type': 'user', id, properties } });
    people.created++;
    console.log(`  created  user ${id}`);
    return;
  }
  if (existing.properties?.company !== MARKER)
    throw new Error(
      `${SERVER} has a user ${id} that the seed did not create, so it is left alone. ` +
        'Seed another server, or rename that user.',
    );
  await call('PUT', `/user/${encodeURIComponent(id)}`, {
    json: { 'entity-type': 'user', id, properties },
  });
  people.updated++;
  console.log(`  updated  user ${id}`);
}

/**
 * The demo's groups' permissions on one place of the workspace, `data.mjs`'s `GRANTS`, in its
 * local ACL: each one there, and none of theirs that `GRANTS` does not name. Anyone else's
 * permission is left as it is.
 */
async function grant(place, document) {
  const path = place === '' ? ROOT : `${ROOT}/${place}`;
  const wanted = GRANTS.filter((entry) => entry.place === place);
  const ours = new Set(GROUPS.map((group) => group.name));
  const { contextParameters } = await call('GET', `/id/${document.uid}`, {
    headers: { 'enrichers-document': 'acls' },
  });
  const local = (contextParameters?.acls ?? []).find((acl) => acl.name === 'local');
  const aces = (local?.aces ?? []).map((ace) => ({
    id: ace.id,
    group: ace.username?.id ?? ace.username,
    permission: ace.permission,
    current: ace.granted === true && (ace.status ?? 'effective') === 'effective',
  }));
  for (const ace of aces) {
    if (!ours.has(ace.group)) continue;
    const named = wanted.some(
      (entry) => entry.group === ace.group && entry.permission === ace.permission && ace.current,
    );
    if (named) continue;
    await call('POST', '/automation/Document.RemovePermission', {
      json: { input: `doc:${document.uid}`, params: { id: ace.id, acl: 'local' } },
    });
    people.removed++;
    console.log(`  removed  ${ace.permission} on ${path} from ${ace.group}`);
  }
  for (const { group, permission } of wanted) {
    const held = aces.some(
      (ace) => ace.group === group && ace.permission === permission && ace.current,
    );
    if (held) continue;
    await call('POST', '/automation/Document.AddPermission', {
      json: { input: `doc:${document.uid}`, params: { permission, users: [group], acl: 'local' } },
    });
    people.granted++;
    console.log(`  granted  ${permission} on ${path} to ${group}`);
  }
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
 * The document trashed from `parent/name`, or `null`, found in the repository itself. Nuxeo
 * renames what it trashes, to `<name>._<time>_.trashed`, unless it is configured not to, so the
 * record's place no longer finds it. Restoring it gives the name back.
 */
async function trashedFrom(parent, name) {
  const folder = await find(`/path${pathOf(parent)}`);
  if (folder === null) return null;
  // LIKE narrows the search, but `_` and `%` are its wildcards: `member-1.backup._1_.trashed`
  // matches `member-1._%_.trashed` too. Only this exact name, renamed, counts.
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

/** Whether the document's file is already `file`, by name and bytes. */
async function holds(document, file) {
  const current = document.properties?.['file:content'];
  if (!current || current.name !== file.fileName || Number(current.length) !== file.bytes.length)
    return false;
  const { bytes } = await request('GET', `/id/${document.uid}/@blob/file:content`);
  return bytes.equals(file.bytes);
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
 *
 * The queue page providers read the search index, which is written a moment after the repository,
 * so a disagreement is asked again, once a second, until INDEX_WAIT_MS has passed. Not
 * `Search.WaitForIndexing`: it waits for every indexing the server has queued, anyone's, and on a
 * shared server it timed out with the kit's records long indexed.
 */
async function check(seeded) {
  const deadline = Date.now() + INDEX_WAIT_MS;
  for (;;) {
    const problems = await disagreements(seeded);
    if (problems.length === 0) {
      console.log(`  checked  ${PAGE_PROVIDERS.join(', ')}, and every user signs in`);
      return;
    }
    if (Date.now() >= deadline)
      throw new Error(`The page providers disagree with the seed:\n  ${problems.join('\n  ')}`);
    console.log(
      `  waiting  ${problems.length} disagreement(s), the search index may be catching up: ` +
        'asking again',
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Every way the page providers disagree with what was seeded, or none. */
async function disagreements({ members, providers, claims, cases, documents }) {
  const problems = [];
  const expect = async (
    pageProvider,
    parameter,
    wanted,
    { exact = true, authorization, as } = {},
  ) => {
    const found = await results(pageProvider, parameter, authorization);
    const missing = wanted.filter((uid) => !found.includes(uid));
    const extra = exact ? found.filter((uid) => !wanted.includes(uid)) : [];
    if (missing.length > 0 || extra.length > 0)
      problems.push(
        `${pageProvider}(${parameter ?? ''})${as ? ` as ${as}` : ''} returned ${found.length}, ` +
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

  // The pending-determination queue and the home's KPIs on it: exactly the claims in review or
  // pended, and the aggregates the queue's facets and the KPIs read, counted as seeded.
  const pending = CLAIMS.filter((claim) => PENDING.includes(claim.status));
  await expect(
    'payers_pending_claims',
    undefined,
    pending.map((c) => claims.get(c.number)),
  );
  const { aggregations } = await call(
    'GET',
    `/search/pp/payers_pending_claims/execute?${new URLSearchParams({ pageSize: '1' })}`,
  );
  for (const [aggregate, property] of [
    ['claim_status_agg', 'status'],
    ['claim_adjuster_agg', 'adjuster'],
  ]) {
    const buckets = aggregations?.[aggregate]?.buckets;
    if (!Array.isArray(buckets)) {
      problems.push(
        `payers_pending_claims answered no ${aggregate}: is it served by the search index?`,
      );
      continue;
    }
    const wanted = new Map();
    for (const claim of pending)
      if (claim[property] !== null)
        wanted.set(claim[property], (wanted.get(claim[property]) ?? 0) + 1);
    for (const [key, count] of wanted) {
      const found = buckets.find((bucket) => bucket.key === key)?.docCount ?? 0;
      // At least: another claim on the server could be in the same bucket.
      if (found < count)
        problems.push(`payers_pending_claims's ${aggregate} counts ${found} ${key}, not ${count}`);
    }
  }

  // Each user can sign in with the demo password and is in their groups; each adjuster's own
  // claims are what payers_my_claims returns to them, asked for as the queue asks: $currentUser.
  for (const user of USERS) {
    const theirs = basic(user.username, demoPassword);
    let me;
    try {
      me = await call('GET', '/me', { authorization: theirs });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      problems.push(`${user.username} cannot sign in with PAYERS_DEMO_PASSWORD (${error.status})`);
      continue;
    }
    const groups = (me?.extendedGroups ?? []).map((group) => group.name);
    if (me?.id !== user.username || user.groups.some((group) => !groups.includes(group)))
      problems.push(
        `${user.username} signs in as ${me?.id}, in ${groups.join(', ') || 'no group'}, ` +
          `not in ${user.groups.join(', ')}`,
      );
    if (!user.groups.includes('claims-adjusters')) continue;
    await expect(
      'payers_my_claims',
      '$currentUser',
      CLAIMS.filter((claim) => claim.adjuster === user.username).map((c) => claims.get(c.number)),
      { authorization: theirs, as: user.username },
    );
  }

  return problems;
}

/**
 * Every id a page provider returns, given one parameter or none, asked as NUXEO_USER or with
 * another user's `authorization`.
 */
async function results(pageProvider, parameter, authorization) {
  const parameters = parameter === undefined ? {} : { queryParams: parameter };
  const entries = await everyPage(pageProvider, (index) =>
    call(
      'GET',
      `/search/pp/${pageProvider}/execute?${new URLSearchParams({
        ...parameters,
        pageSize: `${PAGE_SIZE}`,
        currentPageIndex: `${index}`,
      })}`,
      { authorization },
    ),
  );
  return entries.map((entry) => entry.uid);
}

/** Every document an NXQL query finds. */
/**
 * Every document an NXQL query finds in the repository, through `Repository.Query`. Not
 * `search/lang/NXQL/execute`: with an OpenSearch search client installed, that one answers from the
 * index, which can still hold a trashed document as live, so a record trashed a moment ago would
 * not be found, and the seed would create a second one (`browse.service.ts`, which measured it).
 */
async function nxql(query) {
  return everyPage('The NXQL query', (index) =>
    call('POST', '/automation/Repository.Query', {
      json: { params: { query, pageSize: PAGE_SIZE, currentPageIndex: index } },
    }),
  );
}

/**
 * Every entry of a paged search, page after page. A server may cap a page below the size asked
 * for, so one page is never taken for all of them.
 */
async function everyPage(what, pageAt) {
  const entries = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await pageAt(index);
    entries.push(...(page.entries ?? []));
    if (page.isNextPageAvailable !== true) return entries;
  }
  // Counted in pages, not records: a server may cap a page below PAGE_SIZE.
  throw new Error(
    `${what} still reports another page after ${MAX_PAGES} pages (${entries.length} records ` +
      'read), past which the seed does not read, so it cannot say what the server holds.',
  );
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
  const text = (await request(method, path, options)).bytes.toString('utf8');
  return text ? JSON.parse(text) : null;
}

/** An answer read whole, its body's bytes included, within the one timeout. */
async function request(method, path, { json, body, headers = {}, authorization } = {}) {
  let response;
  let bytes;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: authorization ?? AUTHORIZATION,
        Accept: 'application/json',
        // Every schema of a document, so that its file can be compared.
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? body : JSON.stringify(json),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Read here, under the same timeout and the same verdict: a server that sends its headers and
    // then stalls has not answered either.
    bytes = Buffer.from(await response.arrayBuffer());
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
    const text = bytes.toString('utf8');
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = text.slice(0, 200);
    }
    throw new HttpError(response.status, method, path, detail);
  }
  return { status: response.status, bytes };
}
