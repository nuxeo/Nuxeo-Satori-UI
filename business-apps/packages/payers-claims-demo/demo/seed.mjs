#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the Payers kit's fictional records and people, so that its record pages,
 * queues and home have something to show: four members, three providers, ten claims, five cases,
 * three of them appeals with their checklists, and four claim documents, and the six people who
 * work them, in the three groups the kit's rules name, from `data.mjs`. Each claim's lifecycle state is
 * brought to its status, so the two are one.
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
 * it knows by its marker (`MARKER`), is found before anything is written, and stops the run with
 * exit 2.
 *
 * **The claims' lifecycle.** A claim's lifecycle, `payersClaim`, has claim:status's values as its
 * states (`lifecycle.mjs` reads it from the stand-in model). After a claim is written, it follows
 * the fewest transitions from the state it is in to its status: a new claim starts `submitted`, and
 * one created before version 0.4.0 is in `project`, whose one way out is `submit`. A claim that no
 * transition can bring to its status, such as one reviewed since that `data.mjs` has as submitted,
 * stops the run (exit 1), naming it; restoring it from the trash restores its state too.
 *
 * **The appeals.** An appeal's checklist is written to `case:checklist`, version 0.4.1's, as
 * `data.mjs` has it, and every other case's is emptied. Before anything is asked of the server,
 * `data.mjs` is held to the Case page's checklist card (`appeals.mjs`): an appeal against a claim
 * that is not denied, or an entry the card does not list, stops the run with exit 1, naming it.
 * Since 0.7.0 a decided appeal's decision is written to `case:decision`, and every other case's
 * emptied; an appeal decided with none, or one open with one, stops the run the same way.
 *
 * **The people.** Each user is created, or put back to `data.mjs`'s values: name, e-mail, groups
 * and password. The seeded workspace and its folders give the demo's groups the permissions
 * `data.mjs` names, and only those: one of theirs it does not name is removed. Anyone else's stays.
 * Since 0.6.0, member services may change cases, so the appeals' specialist ticks an appeal's
 * checklist on its page.
 *
 * **It checks what it seeded.** Last, as `check` says: each user signs in, in their groups, with
 * the rights `GRANTS` implies on a claim and on a case, and none to change a member; each claim is
 * in the state its status names; each case holds the checklist it was given, entry for entry, and
 * since 0.7.0 its decision; then the kit's eight page providers return what it wrote, the four
 * queues' aggregates count it, and each adjuster's claims are what `payers_my_claims` returns to
 * them, asked as they are, through `$currentUser`. So a run that passes has run each of them on the server.
 *
 * Node 24 and nothing else: no install, no dependency. Credentials are sent to NUXEO_URL only, as
 * Basic authentication, and never printed.
 *
 * Exit codes: 0, seeded and checked; 1, `data.mjs` disagrees with the Case page's checklist, the
 * server refused a write, stopped answering part way, or a check failed; 2, a precondition, found
 * before anything is written: no credentials, no demo password, no server, credentials refused or
 * not an administrator's, the package not installed or older than 0.7.0, no
 * /default-domain/workspaces, or a user or a group of the demo's names that the seed did not
 * create.
 */
import {
  OPEN_APPEALS,
  appealProblems,
  checklistOnType,
  isOpenAppeal,
  readAppealChecklist,
  readOpenAppeals,
} from './appeals.mjs';
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
import { pathBetween, readLifecycle } from './lifecycle.mjs';

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
/** The stand-in model's types; `PayersClaimSearch` is version 0.3.0's, which the queues need. */
const TYPES = ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument', 'PayersClaimSearch'];
/**
 * Version 0.4.0's claims review workflow, which comes with the claim lifecycle the seed follows: a
 * server without it has the platform's default lifecycle on claims.
 */
const WORKFLOW_MODEL = 'PayersClaimReview';
/** Version 0.7.0's appeal review, which comes with `case:decision`, an appeal's decision. */
const APPEAL_MODEL = 'PayersAppealReview';
const LIFECYCLE = readLifecycle();
/** The Case page's checklist card, which version 0.4.1's `case:checklist` holds the state of. */
const CHECKLIST = readAppealChecklist();
const PAGE_PROVIDERS = [
  'member_claims',
  'member_cases',
  'provider_claims',
  'payers_claim_documents',
  'payers_unassigned_claims',
  'payers_my_claims',
  'payers_pending_claims',
  OPEN_APPEALS,
];
/** The statuses `payers_pending_claims` holds, as the stand-in model's query names them. */
const PENDING = ['inReview', 'pended'];
/** Version 0.6.0's open-appeals queue, read from the stand-in model: the appeals it holds, its facets. */
const OPEN = readOpenAppeals();
/**
 * The queues' search document's schema, which version 0.6.0 gives the open-appeals queue's facets'
 * fields: what tells that version apart, as `case:checklist` tells 0.4.1 apart.
 */
const SEARCH_SCHEMA = 'payers_claim_search';
const APPEALS_FACET = 'case_state_agg';
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

const tally = { created: 0, updated: 0, restored: 0, uploaded: 0, transitions: 0 };
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
  // The script's own data first, before the server is asked anything: an appeal the Case page
  // would show wrongly is data.mjs's fault, not the server's.
  const disagreeing = appealProblems({ cases: CASES, claims: CLAIMS, users: USERS }, CHECKLIST);
  if (disagreeing.length > 0)
    throw new Error(
      `data.mjs disagrees with the Case page's checklist:\n  ${disagreeing.join('\n  ')}`,
    );
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
    await settle(document, claim);
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
      'case:checklist': checklistOf(kase),
      // Since 0.7.0: a decided appeal's decision, and none on any other case.
      'case:decision': kase.decision ?? null,
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

  const { created, updated, restored, uploaded, transitions } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${restored} restored from the trash, ` +
      `${uploaded} file(s) uploaded, ${transitions} lifecycle transition(s) followed. The page ` +
      'providers return what was seeded.',
  );
  console.log(
    `People: ${people.created} created, ${people.updated} updated, ${people.granted} ` +
      `permission(s) granted, ${people.removed} removed, for ${USERS.length} users in ` +
      `${GROUPS.length} groups: ` +
      `${USERS.map((user) => `${user.username} (${user.groups.join(', ')})`).join('; ')}.`,
  );
  console.log(`A member's record page: ${APP}/#/doc/${members.get(MEMBERS[0].number)}`);
  console.log(`A provider's record page: ${APP}/#/doc/${providers.get(PROVIDERS[2].number)}`);
  for (const kase of CASES.filter((each) => each.category === 'appeal'))
    console.log(`An appeal's record page, ${kase.number}: ${APP}/#/doc/${cases.get(kase.number)}`);
  console.log(`The open appeals, for member services: ${APP}/#/queues/open-appeals`);
}

/**
 * A case's checklist as `case:checklist` holds it: an appeal's entries, each with its four
 * subfields, or none for any other case, so a checklist written by hand is emptied again.
 */
function checklistOf(kase) {
  return (kase.checklist ?? []).map(({ item, done, doneBy, doneOn }) => ({
    item,
    done,
    doneBy: doneBy ?? null,
    doneOn: doneOn ?? null,
  }));
}

/**
 * The server answers, the credentials are accepted and are an administrator's, the package's
 * types are installed, version 0.3.0's search type among them, version 0.4.0's claims review
 * workflow, version 0.4.1's case:checklist, version 0.6.0's open-appeals queue and version 0.7.0's
 * appeal review, and no user or group of the demo's names is someone
 * else's.
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
      missing.length === 1 && missing[0] === 'PayersClaimSearch'
        ? `${SERVER} has version 0.2.0 or older of the payers-claims-demo package, with no ` +
            'PayersClaimSearch type for its queues: upgrade it to 0.7.0 ' +
            '(business-apps/packages/payers-claims-demo/README.md), then run this again.'
        : `${SERVER} has no ${missing.join(', ')} type: install the payers-claims-demo package ` +
            'first (business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  if ((await find(`/workflowModel/${WORKFLOW_MODEL}`)) === null)
    throw new Precondition(
      `${SERVER} has version 0.3.0 or older of the payers-claims-demo package, with no ` +
        `${WORKFLOW_MODEL} workflow and the platform's default lifecycle on claims: upgrade it to ` +
        '0.7.0 (business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  // The Case type's schemas, as the record page reads them: the property is on the type, under
  // the schema whose prefix the field names, whatever that schema is called.
  if (!checklistOnType(await find('/config/types/Case'), CHECKLIST.field))
    throw new Precondition(
      `${SERVER} has version 0.4.0 or older of the payers-claims-demo package, with no ` +
        `${CHECKLIST.field} for an appeal's checklist: upgrade it to 0.7.0 ` +
        '(business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  // Version 0.6.0's open-appeals queue: its facets' fields on the queues' search document, as the
  // server lists the schema's fields.
  const search = await find(`/config/schemas/${SEARCH_SCHEMA}`);
  if (
    !(search?.fields !== null && typeof search?.fields === 'object') ||
    !Object.hasOwn(search.fields, APPEALS_FACET)
  )
    throw new Precondition(
      `${SERVER} has version 0.5.1 or older of the payers-claims-demo package, with no ` +
        'open-appeals queue: upgrade it to 0.7.0 ' +
        '(business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  // Version 0.7.0's appeal review, which comes with the case's decision the seed writes.
  if ((await find(`/workflowModel/${APPEAL_MODEL}`)) === null)
    throw new Precondition(
      `${SERVER} has version 0.6.1 or older of the payers-claims-demo package, with no ` +
        `${APPEAL_MODEL} workflow and no case:decision for an appeal's decision: upgrade it to ` +
        '0.7.0 (business-apps/packages/payers-claims-demo/README.md), then run this again.',
    );
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the records go.`);
  // Before anything is written: a user or a group of the demo's names that is not the seed's.
  for (const { name } of GROUPS) {
    const group = await find(`/group/${encodeURIComponent(name)}`);
    if (group !== null && group.properties?.description !== MARKER)
      throw new Precondition(
        `${SERVER} has a group ${name} that the seed did not create, so it is left alone. ` +
          'Seed another server, or rename that group.',
      );
  }
  for (const { username: id } of USERS) {
    const user = await find(`/user/${encodeURIComponent(id)}`);
    if (user !== null && user.properties?.company !== MARKER)
      throw new Precondition(
        `${SERVER} has a user ${id} that the seed did not create, so it is left alone. ` +
          'Seed another server, or rename that user.',
      );
  }
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
 * The claim brought to the lifecycle state its status names, along the fewest transitions from the
 * state it is in. The server keeps claim:status in step with each one (the stand-in model's
 * `PayersClaim.KeepStatus`), so it ends as `data.mjs` has it. No path there stops the run before
 * any transition: the claim's status is written already, and its state is left as it was.
 */
async function settle(document, claim) {
  const from = document.state;
  const path = pathBetween(LIFECYCLE, from, claim.status);
  if (path === null)
    throw new Error(
      `${claim.number} is ${from}, and the claim lifecycle has no way from there to ` +
        `${claim.status}, its seeded status. Delete it, and empty it from the trash, then run ` +
        'this again.',
    );
  for (const transition of path) {
    await call('POST', '/automation/Document.FollowLifecycleTransition', {
      json: { input: `doc:${document.uid}`, params: { value: transition } },
    });
    tally.transitions++;
  }
  if (path.length > 0)
    console.log(`  moved    ${claim.number} from ${from} to ${claim.status}: ${path.join(', ')}`);
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
 * What the seed checks, last. First, once, the people: each user signs in with the demo password,
 * as themself and in their groups, and may change what `GRANTS` lets them change, and no member.
 * Then the page providers: for each member and each provider, exactly the claims and cases seeded
 * for it; for each claim number, at least the documents seeded for it, since another record on the
 * server could carry the same number; and in each of the three claim queues, every seeded claim
 * that belongs there, none of the seeded claims that do not, and its aggregates counting at least
 * the seeded claims in each bucket, and in the open-appeals queue the same of the seeded cases.
 * Another record on the server may be in a queue: the seed checks what it wrote, and the demo,
 * which counts exactly, refuses such a server (exit 2).
 *
 * The queue page providers read the search index, which is written a moment after the repository,
 * so a disagreement among them is asked again, once a second, until INDEX_WAIT_MS has passed. Not
 * `Search.WaitForIndexing`: it waits for every indexing the server has queued, anyone's, and on a
 * shared server it timed out with the kit's records long indexed. A problem with the people is not
 * the index's, so it is not asked again.
 */
async function check(seeded) {
  const refused = await staff(seeded);
  if (refused.length > 0)
    throw new Error(`The demo's people are not as seeded:\n  ${refused.join('\n  ')}`);
  const unsettled = await lifecycles(seeded);
  if (unsettled.length > 0)
    throw new Error(`The claims are not in their statuses' states:\n  ${unsettled.join('\n  ')}`);
  const unchecked = await checklists(seeded);
  if (unchecked.length > 0)
    throw new Error(
      `The cases' checklists or decisions are not as seeded:\n  ${unchecked.join('\n  ')}`,
    );
  const deadline = Date.now() + INDEX_WAIT_MS;
  for (;;) {
    const problems = await disagreements(seeded);
    if (problems.length === 0) {
      console.log(`  checked  every user, and ${PAGE_PROVIDERS.join(', ')}`);
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

/**
 * Each user signs in with the demo password as themself, in their groups, and holds on a claim, on
 * a case and on a member exactly the rights `GRANTS` implies: adjusters and supervisors may change
 * a claim (`WriteProperties`) and move its lifecycle (`WriteLifeCycle`, which approving needs);
 * member services may change a case, and so tick an appeal's checklist, and no one else may; no one
 * may change a member, whose Edit form would list the social security number. Read through the
 * `permissions` enricher, as each user, so a permission from anywhere counts: an inherited one, or
 * one given to `members`.
 */
async function staff({ members, claims, cases }) {
  const problems = [];
  const memberId = members.get(MEMBERS[0].number);
  const claimId = claims.get(CLAIMS[0].number);
  const caseId = cases.get(CASES.find((kase) => kase.category === 'appeal').number);
  for (const user of USERS) {
    const authorization = basic(user.username, demoPassword);
    let me;
    try {
      me = await call('GET', '/me', { authorization });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      problems.push(`${user.username} cannot sign in with PAYERS_DEMO_PASSWORD (${error.status})`);
      continue;
    }
    const groups = (me?.extendedGroups ?? []).map((group) => group.name);
    if (me?.id !== user.username || user.groups.some((group) => !groups.includes(group))) {
      problems.push(
        `${user.username} signs in as ${me?.id}, in ${groups.join(', ') || 'no group'}, ` +
          `not in ${user.groups.join(', ')}`,
      );
      continue;
    }
    const rights = async (id) =>
      (
        await call('GET', `/id/${id}`, {
          authorization,
          headers: { 'enrichers-document': 'permissions' },
        })
      )?.contextParameters?.permissions ?? [];
    let onClaim;
    let onCase;
    let onMember;
    try {
      onClaim = await rights(claimId);
      onCase = await rights(caseId);
      onMember = await rights(memberId);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      problems.push(`${user.username} cannot read the seeded records (${error.status})`);
      continue;
    }
    const mayChange = (place) =>
      GRANTS.some(
        (entry) =>
          entry.place === place &&
          user.groups.includes(entry.group) &&
          entry.permission === 'ReadWrite',
      );
    const mayChangeClaims = mayChange('claims');
    if (onCase.includes('WriteProperties') !== mayChange('cases'))
      problems.push(
        `${user.username} ${mayChange('cases') ? 'may not change' : 'may change'} an appeal, ` +
          `and ${mayChange('cases') ? 'would not' : 'would'} be offered its checklist's tick boxes`,
      );
    for (const right of ['WriteProperties', 'WriteLifeCycle'])
      if (onClaim.includes(right) !== mayChangeClaims)
        problems.push(
          `${user.username} ${mayChangeClaims ? 'lacks' : 'holds'} ${right} on a claim`,
        );
    if (onMember.includes('WriteProperties'))
      problems.push(`${user.username} may change a member, and would see its Edit form`);
  }
  return problems;
}

/**
 * Each seeded case, read again from the repository, holding the checklist it was given, entry for
 * entry and in order: what the Case page reads each item's state from. A day comes back as the
 * server writes a date, so it is compared by its day; a day the server moved, as a zone would, is
 * a difference. Since 0.7.0, and the decision it was given, or none.
 */
async function checklists({ cases }) {
  const problems = [];
  const day = (value) => (typeof value === 'string' ? value.slice(0, 10) : value);
  for (const kase of CASES) {
    const document = await call('GET', `/id/${cases.get(kase.number)}`);
    const held = document?.properties?.[CHECKLIST.field];
    const read = (Array.isArray(held) ? held : [held]).map((entry) => ({
      item: entry?.item ?? null,
      done: entry?.done ?? null,
      doneBy: entry?.doneBy ?? null,
      doneOn: day(entry?.doneOn ?? null),
    }));
    const wanted = checklistOf(kase);
    if (!Array.isArray(held) || JSON.stringify(read) !== JSON.stringify(wanted))
      problems.push(
        `${kase.number} holds ${JSON.stringify(held ?? null)}, not ${JSON.stringify(wanted)}`,
      );
    // Since 0.7.0, the case's decision, which the Case page shows on a decided appeal.
    const decision = document?.properties?.['case:decision'] ?? null;
    if (decision !== (kase.decision ?? null))
      problems.push(
        `${kase.number}'s decision is ${JSON.stringify(decision)}, not ${JSON.stringify(kase.decision ?? null)}`,
      );
  }
  return problems;
}

/**
 * Each seeded claim, read again from the repository, in the lifecycle state its status names, with
 * that status: the two are one, which the queues, read by status, and the lifecycle's buttons and
 * the workflow, read by state, rely on.
 */
async function lifecycles({ claims }) {
  const problems = [];
  for (const claim of CLAIMS) {
    const document = await call('GET', `/id/${claims.get(claim.number)}`);
    const status = document?.properties?.['claim:status'];
    if (document?.state !== claim.status || status !== claim.status)
      problems.push(
        `${claim.number} is ${document?.state} with status ${status}, not ${claim.status}`,
      );
  }
  return problems;
}

/** Every way the page providers disagree with what was seeded, or none. */
async function disagreements({ members, providers, claims, cases, documents }) {
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

  /**
   * A queue's page provider holds every seeded record that `belongs`, and none that does not, and
   * each of its aggregates counts at least the seeded records in each bucket: another record on the
   * server may be in the queue, or in the same bucket. The records are the claims, unless `records`
   * and their `ids` say otherwise, as the open appeals' cases do.
   */
  const queue = async (
    pageProvider,
    belongs,
    aggregates,
    { parameter, authorization, as, records = CLAIMS, ids = claims } = {},
  ) => {
    const name = `${pageProvider}${as ? ` as ${as}` : ''}`;
    const found = await results(pageProvider, parameter, authorization);
    for (const record of records) {
      const held = found.includes(ids.get(record.number));
      if (belongs(record) && !held) problems.push(`${name} does not hold ${record.number}`);
      if (!belongs(record) && held)
        problems.push(`${name} holds ${record.number}, which it should not`);
    }
    const page = await call(
      'GET',
      `/search/pp/${pageProvider}/execute?${new URLSearchParams({
        ...(parameter === undefined ? {} : { queryParams: parameter }),
        pageSize: '1',
      })}`,
      { authorization },
    );
    for (const [aggregate, property] of aggregates) {
      const buckets = page?.aggregations?.[aggregate]?.buckets;
      if (!Array.isArray(buckets)) {
        problems.push(`${name} answered no ${aggregate}: is it served by the search index?`);
        continue;
      }
      const wanted = new Map();
      for (const record of records.filter(belongs))
        if (record[property] !== null)
          wanted.set(record[property], (wanted.get(record[property]) ?? 0) + 1);
      for (const [key, count] of wanted) {
        const counted = buckets.find((bucket) => bucket.key === key)?.docCount ?? 0;
        if (counted < count)
          problems.push(`${name}'s ${aggregate} counts ${counted} ${key}, not ${count}`);
      }
    }
  };
  const status = ['claim_status_agg', 'status'];
  await queue(
    'payers_unassigned_claims',
    (claim) => claim.adjuster === null && ['submitted', 'inReview'].includes(claim.status),
    [status],
  );
  await queue('payers_pending_claims', (claim) => PENDING.includes(claim.status), [
    status,
    ['claim_adjuster_agg', 'adjuster'],
  ]);
  // Each adjuster's own claims, asked for as that adjuster, as the queue and the home ask:
  // $currentUser, which the server replaces with the person signed in.
  for (const user of USERS.filter((u) => u.groups.includes('claims-adjusters')))
    await queue('payers_my_claims', (claim) => claim.adjuster === user.username, [status], {
      parameter: '$currentUser',
      authorization: basic(user.username, demoPassword),
      as: user.username,
    });
  // The open appeals: every seeded appeal not yet decided, and no grievance, by state and by
  // specialist.
  await queue(
    OPEN_APPEALS,
    (kase) => isOpenAppeal(kase, OPEN),
    OPEN.aggregates.map(({ id, property }) => [id, property.slice(property.indexOf(':') + 1)]),
    { records: CASES, ids: cases },
  );

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
