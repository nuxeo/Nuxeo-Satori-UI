#!/usr/bin/env node
/**
 * Seed a Nuxeo server with the onboarding kit's fictional cases and disputes, so that its record
 * pages, queues and home have something to show: four onboarding cases, each with its fictional
 * account agreement attached and its KYC checklist under way, and three disputes, from `data.mjs`,
 * under /default-domain/workspaces/onboarding-demo, in the kit's two registers, with the kit's
 * groups' permissions on them.
 *
 *   node business-apps/packages/onboarding-demo/demo/seed.mjs
 *
 * Needs, installed first: nuxeo-agentic-signature, whose Signable and SignatureRequest facets the
 * kit's types carry, and this kit.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default: an administrator's, since the seed grants
 *                            the kit's groups their permissions on its registers.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   APP_URL                  the app, for the links printed at the end, default http://localhost:4200
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *   NUXEO_INDEX_WAIT_MS      how long the search index may take to list what was written, for the
 *                            open cases and open disputes queues, default 15000
 *
 * **It creates no user and no group.** `onboarding-officers`, `kyc-analysts` and
 * `dispute-analysts`, and the people in them, are the server's: whoever installs the kit decides
 * them. The officers, analysts and checklist ticks in `data.mjs` are user names only.
 *
 * **It sends nothing for signature.** A signature request is the demo's, created by an officer
 * (the kit's README, "The demo"); the seed writes no `sigreq:` or `sgn:` property, which are the
 * add-on's.
 *
 * **Safe to run twice.** Every record has a fixed place, named by its number. One already there
 * has `data.mjs`'s values written over its own, dates counted again from today's UTC day, but for
 * its KYC checklist, which people tick, and its attachments, never written over: the agreement is
 * attached to a case with no attachment, and a case with others is left as it is. A place that
 * holds a document of another type is left alone, and the run stops.
 *
 * **It checks what it seeded.** Last, the open cases and open disputes page providers, which the
 * search index answers a moment after a write, are asked until each lists every seeded record
 * that belongs in it and none that does not, or NUXEO_INDEX_WAIT_MS has passed.
 *
 * Node 24 and nothing else. Credentials are sent to NUXEO_URL only, as Basic authentication, and
 * never printed.
 *
 * Exit codes: 0, seeded and checked; 1, the server refused a write, stopped answering, a place held
 * another type, or a check failed; 2, a precondition, found before anything is written: no
 * credentials, no server, not an administrator, or a package missing.
 */
import {
  CASES,
  DISPUTES,
  GRANTS,
  OPEN_CASE_STATUSES,
  OPEN_DISPUTE_STATUSES,
  REGISTERS,
  WORKSPACE,
  agreementName,
  agreementPdf,
  dayFrom,
} from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const APP = (process.env['APP_URL'] || 'http://localhost:4200').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;
const INDEX_WAIT_MS = Number(process.env['NUXEO_INDEX_WAIT_MS'] ?? 15_000);

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;

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
    "NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export an administrator's first:\n" +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const tally = { created: 0, updated: 0, attached: 0, granted: 0 };
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
  console.log(`Seeding ${SERVER} with the onboarding kit's fictional cases and disputes.`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description':
      'Fictional onboarding cases and disputes for the onboarding kit. No real customer.',
  });
  const registers = {};
  for (const [key, register] of Object.entries(REGISTERS))
    registers[key] = (
      await ensure(ROOT, register.name, register.type, { 'dc:title': register.title })
    ).document;
  for (const grant of GRANTS)
    await ensureGrant(registers[grant.register], grant.group, grant.permission);

  const today = new Date();
  const cases = [];
  for (const kase of CASES) {
    const properties = {
      'dc:title': kase.title,
      'onb:number': kase.number,
      'onb:customer': kase.customer,
      'onb:customerType': kase.customerType,
      'onb:country': kase.country,
      'onb:product': kase.product,
      'onb:status': kase.status,
      'onb:riskRating': kase.riskRating,
      'onb:openedOn': dayFrom(kase.openedOn, today),
      'onb:officer': kase.officer,
      'onb:notes': kase.notes,
    };
    const checklist = kase.checklist.map((entry) => ({
      ...entry,
      doneOn: dayFrom(entry.doneOn, today),
    }));
    const { document, created } = await ensure(
      registers.onboarding.path,
      nameOf(kase.number),
      'OnboardingCase',
      {
        ...properties,
        // Written when the case is made only: from then on, the checklist is the people's.
        'kyc:checklist': checklist,
      },
      properties,
    );
    await ensureAgreement(document, kase, created);
    cases.push({ ...kase, uid: document.uid });
  }
  const disputes = [];
  for (const dispute of DISPUTES) {
    const properties = {
      'dc:title': dispute.title,
      'dsp:number': dispute.number,
      'dsp:customer': dispute.customer,
      'dsp:account': dispute.account,
      'dsp:amount': dispute.amount,
      'dsp:reason': dispute.reason,
      'dsp:status': dispute.status,
      'dsp:openedOn': dayFrom(dispute.openedOn, today),
      'dsp:dueOn': dayFrom(dispute.dueOn, today),
      'dsp:analyst': dispute.analyst,
      'dsp:resolution': dispute.resolution || null,
    };
    const { document } = await ensure(
      registers.disputes.path,
      nameOf(dispute.number),
      'DisputeCase',
      properties,
      properties,
    );
    disputes.push({ ...dispute, uid: document.uid });
  }

  await checkListed('onboarding_open_cases', cases, (kase) =>
    OPEN_CASE_STATUSES.includes(kase.status),
  );
  await checkListed('onboarding_open_disputes', disputes, (dispute) =>
    OPEN_DISPUTE_STATUSES.includes(dispute.status),
  );

  const { created, updated, attached, granted } = tally;
  console.log(
    `\nDone: ${created} created, ${updated} updated, ${attached} agreement(s) attached, ${granted} permission(s) granted.`,
  );
  console.log(
    `The onboarding register: ${registers.onboarding.path}. Its Create menu offers a signature request.`,
  );
  const ready = cases.find((kase) => kase.status === 'Awaiting signature');
  if (ready)
    console.log(
      `The case ready for signature, ${ready.number}: ${APP}/#/doc/${ready.uid}, its agreement ${agreementName(ready.number)}.`,
    );
  console.log(
    `The queues: ${APP}/#/queues/open-cases, ${APP}/#/queues/awaiting-signature, ${APP}/#/queues/open-disputes.`,
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
      throw new Precondition(
        `${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`,
      );
    throw error;
  }
  if (me === null || typeof me !== 'object' || typeof me.id !== 'string')
    throw new Precondition(
      `${SERVER} answered GET /me with something that is not a user: is NUXEO_URL a Nuxeo server's address?`,
    );
  if (me.isAdministrator !== true)
    throw new Precondition(
      `${username} is not an administrator: only an administrator grants the kit's groups their permissions.`,
    );
  for (const [path, from] of [
    ['/config/facets/Signable', 'the e-signature add-on, nuxeo-agentic-signature'],
    ['/config/types/OnboardingCase', 'this kit, onboarding-demo'],
    ['/config/types/ESignatureRequest', 'this kit, onboarding-demo'],
    ['/config/types/OnboardingRegister', 'this kit, onboarding-demo'],
    ['/config/types/DisputeRegister', 'this kit, onboarding-demo'],
  ]) {
    if ((await find(path)) === null)
      throw new Precondition(
        `${SERVER} has no ${path.split('/').pop()}: install ${from} first, then run this again.`,
      );
  }
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the kit's records go.`);
}

/**
 * The document at `parent/name`: created with `properties`, or, when there, of the same type,
 * given `update` (none: left as it is) and restored from the trash. Another type stops the run.
 */
async function ensure(parent, name, type, properties, update) {
  const path = `${parent === '/' ? '' : parent}/${name}`;
  const existing = await find(`/path${pathOf(path)}`);
  if (existing === null) {
    const document = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties },
    });
    tally.created++;
    console.log(`  created  ${path}`);
    return { document, created: true };
  }
  if (existing.type !== type)
    throw new Error(
      `${path} is a ${existing.type}, not a ${type}. It is not the seed's, so it is left alone.`,
    );
  if (existing.isTrashed === true) {
    await call('POST', '/automation/Document.Untrash', { json: { input: `doc:${existing.uid}` } });
    console.log(`  restored ${path}`);
  }
  if (!update) return { document: existing, created: false };
  const document = await call('PUT', `/id/${existing.uid}`, {
    json: { 'entity-type': 'document', properties: update },
  });
  tally.updated++;
  return { document, created: false };
}

/**
 * The case's account agreement, attached to a case with no attachment: a case's attachments are
 * never written over, so one that has others and not this one is left as it is, and said so.
 */
async function ensureAgreement(document, kase, created) {
  const name = agreementName(kase.number);
  const current = created ? null : await call('GET', `/id/${document.uid}`, { schemas: 'files' });
  const files = current?.properties?.['files:files'] ?? [];
  if (files.some((entry) => entry?.file?.name === name)) return;
  if (files.length > 0) {
    console.log(
      `  left     ${kase.number}'s attachments as they are: none is ${name}; attach it in the app to send it`,
    );
    return;
  }
  const batch = await call('POST', '/upload/new/default');
  const batchId = batch?.batchId;
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(batchId))
    throw new Error('The server answered the upload with no batch to upload to.');
  await call('POST', `/upload/${batchId}/0`, {
    bytes: agreementPdf(kase),
    headers: { 'X-File-Name': encodeURIComponent(name), 'X-File-Type': 'application/pdf' },
  });
  await call('PUT', `/id/${document.uid}`, {
    json: {
      'entity-type': 'document',
      properties: { 'files:files': [{ file: { 'upload-batch': batchId, 'upload-fileId': '0' } }] },
    },
  });
  tally.attached++;
  console.log(`  attached ${name} to ${kase.number}`);
}

/** A register's permission for one of the kit's groups. */
async function ensureGrant(folder, group, permission) {
  const acl = await call('GET', `/id/${folder.uid}/@acl`);
  const local = (acl?.acl ?? []).find((each) => each.name === 'local')?.aces ?? [];
  if (
    local.some(
      (ace) => ace.username === group && ace.permission === permission && ace.granted === true,
    )
  )
    return;
  await call('POST', '/automation/Document.AddPermission', {
    json: { input: `doc:${folder.uid}`, params: { users: [group], permission, notify: false } },
  });
  tally.granted++;
  console.log(`  granted  ${permission} on ${folder.path} to ${group}`);
}

/** Every seeded record that belongs in the page provider is listed, and none that does not. */
async function checkListed(pageProvider, records, belongs) {
  const deadline = Date.now() + INDEX_WAIT_MS;
  for (;;) {
    const page = await call('GET', `/search/pp/${pageProvider}/execute`, { pageSize: '100' });
    const listed = new Set((page?.entries ?? []).map((entry) => entry.uid));
    const missing = records
      .filter((record) => belongs(record) && !listed.has(record.uid))
      .map((r) => r.number);
    const extra = records
      .filter((record) => !belongs(record) && listed.has(record.uid))
      .map((r) => r.number);
    if (missing.length === 0 && extra.length === 0) {
      console.log(
        `  checked  ${pageProvider}: the seeded records that belong in it, and none other`,
      );
      return;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `${pageProvider} does not list what was seeded: ${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `listed and should not be ${extra.join(', ')}` : ''}.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function nameOf(number) {
  return number.toLowerCase();
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

async function call(method, path, { json, bytes, headers: extra = {}, schemas, pageSize } = {}) {
  const url = new URL(`${API}${path}`);
  if (pageSize) url.searchParams.set('pageSize', pageSize);
  const headers = { Authorization: AUTHORIZATION, Accept: 'application/json', ...extra };
  if (schemas) headers['X-NXproperties'] = schemas;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (bytes !== undefined) headers['Content-Type'] = 'application/octet-stream';
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bytes ?? (json === undefined ? undefined : JSON.stringify(json)),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (preflighting)
      throw new Precondition(
        `${SERVER} did not answer: ${error?.cause?.code ?? error?.name ?? error}.`,
      );
    throw new Error(
      `${method} ${path}: no answer from ${SERVER}, ${error?.cause?.code ?? error?.name ?? error}.`,
    );
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
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (preflighting)
      throw new Precondition(
        `${SERVER} answered ${method} ${path} with something that is not JSON.`,
      );
    throw new Error(`${method} ${path}: the answer is not JSON.`);
  }
}
