/**
 * The controlled documents kit's transmittals and review cycles: business apps phase 8's demo
 * steps 1 to 3, inside the server, with no portal (docs/business-apps/development-plan.md, phase 8,
 * "Demo"), on the kit in `business-apps/packages/controlled-documents-demo`, version 0.2.0 or
 * later, with `nuxeo-agentic-documents` 0.2.0.
 *
 *   1. An engineer issues a transmittal: here to a named person inside the server, not to an
 *      outside contractor, whose sign-in is decision C's portal and not built.
 *   2. The recipient comments and returns it: here signed in to the app itself, and the comments
 *      of a review are Nuxeo's own, in a review cycle the server keeps from closing while one is
 *      open.
 *   3. The new revision supersedes the old one.
 *
 * The steps:
 *
 *   - **Set up:** an earlier run's drawings put away (trashed), and the run's own drawing, a first
 *     revision in series DWG, created through the server's numbering.
 *   - **1.** As the engineer, `ENGINEER` of `data.mjs`, in the app: the transmittals register's
 *     Create menu offers a Transmittal, its Create form (the kit's `create.layout.json`) is filled in,
 *     subject, purpose, due day, a document by its number and the recipient by user name, and
 *     created. Read back from the server: numbered `TR-` and five digits, the document listed at
 *     its current revision, issued by the engineer, and one receipt, the recipient's, awaiting. The
 *     record page shows the number, and the Recipients card the recipient awaiting. Over the REST
 *     API, the same transmittal naming a superseded revision is refused, 409, and nothing is made.
 *   - **2.** First over the REST API, as the engineer, who may write every receipt and is not
 *     this one's recipient: their answer is refused, 403, and the receipt still awaits. Then the
 *     browser signs in as the recipient, `RECIPIENT`: the Transmittals awaiting me queue lists the
 *     receipt; on its page, Edit, answer Returned with a comment, Save. Read back: returned, the
 *     comment as typed, and the server's time of the answer. Answering again is refused, 409.
 *   - **2, the review comments.** Over the REST API: the engineer opens a review cycle on the run's
 *     drawing, the recipient its reviewer; the reviewer comments, in Nuxeo's own comments, and the
 *     server makes the comment an open thread; someone who is not a reviewer is refused, 403; the
 *     engineer's close is refused, 409, while the thread is open; the reviewer, who is not the
 *     opener, may not resolve it, 403; the engineer resolves it and closes the cycle, which the
 *     server records on the revision; and a comment after the close is refused, 409. In the app, the
 *     cycle's page lists the thread, and the drawing's review-cycle card the cycle.
 *   - **3.** Over the REST API, as the engineer: a revision B of the run's drawing, naming the one
 *     it supersedes. Read back: B has the drawing's number and revision B, and is current; A is
 *     superseded, linked to B, and B to A. A second revision over A is refused, 409. In the app,
 *     A's page shows the superseded banner, linking to B by its title.
 *
 * Why the run's own drawing, and not the seeded register: a review cycle closed cannot be opened
 * again, a superseded revision stays superseded, and one cycle at a time is open on a revision.
 * Run on the seeded chains, a second run would find them changed by the first. The run's drawing is
 * new each time, so the run is repeatable, and the seeded register reads the same afterwards. The
 * transmittal of step 1 lists the seeded pump house drawing at its current revision, which it does
 * not change.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit 0.2.0 or later installed on the local Nuxeo with `nuxeo-agentic-documents` 0.2.0, and
 *   seeded with `demo/seed.mjs`, which creates the demo's people, their groups and permissions,
 *   the register, the transmittals register and the review cycles' folder.
 * - **The run's own user is the engineer:** `NUXEO_USER` is `ENGINEER` of `data.mjs`, and
 *   `NUXEO_PASS` the demo password. `CONTROLLED_DOCUMENTS_DEMO_PASSWORD`, the same password, signs
 *   the recipient in, in the browser for step 2, and signs in the third person, who is neither the
 *   recipient nor a reviewer, over the REST API only.
 * - The dev server with `npm run config:dev` serving the kit's layouts, forms, home, menu, queues
 *   and labels (the kit's README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=avega NUXEO_PASS="$CONTROLLED_DOCUMENTS_DEMO_PASSWORD" npm run beta:evidence -- controlled-documents-transmittals
 *
 * Load-bearing checks: the transmittal the app's Create form made, as the server holds it, its
 * number, its document at the current revision, its issuer and the recipient's receipt awaiting;
 * the record page's number and Recipients row; the receipt in the recipient's queue; the answer the
 * Edit form saved, as the server holds it, returned, with its comment and its time; the comment
 * made an open thread of the cycle; the cycle closed only once its thread is resolved, by its
 * opener, and recorded on the revision; the new revision's number, revision, status and links, and
 * the old one's; the superseded banner's link. Negative ones: a superseded revision not sent; a
 * receipt not answered by anyone but its recipient, nor twice; a comment refused from someone not
 * a reviewer, and after the close; a close refused with a thread open; a thread not resolved by a
 * reviewer; a revision not superseded twice. Each refusal is read back as nothing changed.
 *
 * Not covered, and said in notes: outside users and the portal (decision C); the server's own
 * install of the layouts (the dev server serves them from `config:dev`); resolving a thread and
 * closing a cycle in the app, which the run does over the REST API; and the server's concurrency
 * and permission rules beyond these, which the add-on's own tests hold
 * (`nuxeo-agentic-documents`, `mvn -pl nuxeo-agentic-documents -am verify`).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'controlled-documents-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const {
  CHAINS,
  ENGINEER,
  FOLDER,
  RECIPIENT,
  REVIEWS,
  TRANSMITTALS,
  USERS,
  WORKSPACE,
  revisionsOf,
} = await import(join(KIT, 'demo', 'data.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The people are
 * the ones the preconditions below hold the run to.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [ENGINEER],
    who: 'the engineer who issues transmittals and opens review cycles, a document controller',
  },
  signsInAs: [RECIPIENT],
  needs: [
    'the kit 0.2.0 or later installed, with nuxeo-agentic-documents 0.2.0',
    "the dev server with `npm run config:dev` serving the kit's layouts, forms, home, menu, queues and labels",
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
const REGISTER = `${ROOT}/${FOLDER.name}`;
const TRANSMITTALS_PATH = `${ROOT}/${TRANSMITTALS.name}`;
const REVIEWS_PATH = `${ROOT}/${REVIEWS.name}`;
/** How this demo's own drawings are known again: their `dc:description`. Not the seed's. */
const MARKER = 'Controlled documents transmittals demo (fictional)';
/** The seeded chain the transmittal of step 1 lists, at its current revision. */
const LISTED = CHAINS.find((chain) => chain.key === 'pump-house-ga');
/** Someone who may read and write everything here, and is neither the recipient nor a reviewer. */
const BYSTANDER = USERS.find((user) => ![ENGINEER, RECIPIENT].includes(user.username))?.username;

/** The files `config:dev` must serve as the kit has them: what this run's pages are drawn from. */
const SERVED = [
  'layouts/Transmittal/view.layout.json',
  'layouts/Transmittal/create.layout.json',
  'layouts/TransmittalReceipt/view.layout.json',
  'layouts/TransmittalReceipt/edit.layout.json',
  'layouts/ReviewCycle/view.layout.json',
  'layouts/EngineeringDocument/view.layout.json',
  'queues/awaiting-me.json',
  'labels/en.json',
];

/** The session `AuthService` keeps, which the app's interceptor reads: helpers.mjs's key. */
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, which the app's sign-in calls to drop
 * a stale cookie session; `AI.*` operations come from a marketplace package this server may lack;
 * and the shell's recently-viewed list asks for a thumbnail of every document in it, which a record
 * with no file does not have.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const deferred = () => undefined;
const unread = () => null;
const DAY = 24 * 60 * 60 * 1000;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;

/** A JSON value with its object keys sorted, so two parses compare as text. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** `probe()` until it answers something truthy, or `timeout` ms pass: its last answer either way. */
async function until(probe, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const answer = await probe().catch(unread);
    if (answer || Date.now() >= deadline) return answer;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * A REST call from Node, as `username`, with Basic authentication and no cookie: each person's own
 * channel. Not page.request, which shares the browser's cookie jar, so that once the browser has
 * signed in as the recipient it could be answered as them.
 */
async function restAs(baseUrl, username, password, method, path, json, headers = {}) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo/api/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        properties: '*',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: String(error?.message ?? error), body: null };
  }
}

/** A refusal's words, as the REST API answers with them. */
const messageOf = (answer) => String(answer?.body?.message ?? '');

/**
 * A served file as the app reads it. A layout comes in the servlet's envelope, as `config:dev`
 * writes it too: its `content`. The queues and the labels come as the package writes them.
 */
function unwrap(body) {
  return body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout'
    ? body.content
    : body;
}

/** A day as the REST API writes a `date` property: `YYYY-MM-DD`, in UTC. */
const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * A day as a person types it into the date field, after its placeholder, the locale's mask:
 * `mm/dd/yyyy` in English. The calendar day of `date` on the browser's clock.
 */
function typedDay(mask, date) {
  const shape = /yyyy/i.test(mask ?? '') ? mask.toLowerCase() : 'mm/dd/yyyy';
  return shape
    .replace('yyyy', String(date.getFullYear()))
    .replace('mm', String(date.getMonth() + 1).padStart(2, '0'))
    .replace('dd', String(date.getDate()).padStart(2, '0'));
}

/** The form field of `xpath` in the open dialog's version 2 form. */
const field = (page, xpath) => page.locator(`mat-dialog-container [data-xpath="${xpath}"]`).first();

/** Pick `entry` in the open dialog's vocabulary field for `xpath`. */
async function choose(page, xpath, entry) {
  await page
    .locator(`mat-dialog-container nxs-vocabulary-select[data-xpath="${xpath}"] input`)
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
  await page
    .locator(`mat-option[data-entry="${entry}"]`)
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
}

/** Type `value` into the open dialog's chips field for `xpath`, and end the chip. */
async function chip(page, xpath, value) {
  const input = page.locator(`mat-dialog-container input[data-xpath="${xpath}"]`).first();
  await input.fill(value, { timeout: 10_000 }).catch(deferred);
  await input.press('Enter', { timeout: 10_000 }).catch(deferred);
}

/** The text of a record page's field, `[data-field="<xpath>"]`, in the card `card`. */
function shownField(page, card, xpath) {
  return page
    .locator(`.record-page__card[data-card-id="${card}"] [data-field="${xpath}"] dd`)
    .first()
    .innerText({ timeout: 10_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
}

/** The row of a list, in the card `card` or anywhere when `card` is null, for the record `uid`. */
function rowText(page, card, uid) {
  const scope = card ? `.record-page__card[data-card-id="${card}"] ` : '';
  return page
    .locator(`${scope}tr[data-uid="${uid}"]`)
    .first()
    .innerText({ timeout: 15_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step(
    'Preconditions: the kit 0.2.0 installed and seeded, its files served, and its people',
  );
  const { username: engineer, password: engineerPassword } = requireStepCredentials(
    'sign the transmittals demo in as its engineer',
  );
  h.requirePrecondition(
    `the run signs in as the engineer, ${ENGINEER}`,
    engineer === ENGINEER,
    `NUXEO_USER is ${engineer}: set it to ${ENGINEER}, and NUXEO_PASS to the demo password`,
  );
  const asEngineer = (method, path, json, headers) =>
    restAs(h.baseUrl, engineer, engineerPassword, method, path, json, headers);
  const me = (await asEngineer('GET', '/me')).body;
  const myGroups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the engineer, in engineers and document-controllers',
    me?.id === engineer &&
      myGroups.includes('engineers') &&
      myGroups.includes('document-controllers'),
    `/me answered ${me?.id} in ${JSON.stringify(myGroups)}: run demo/seed.mjs first`,
  );

  const demoPassword = process.env['CONTROLLED_DOCUMENTS_DEMO_PASSWORD'] ?? '';
  h.requirePrecondition(
    'CONTROLLED_DOCUMENTS_DEMO_PASSWORD is set, for the recipient',
    demoPassword !== '',
    'export the password the seed gave the demo users as CONTROLLED_DOCUMENTS_DEMO_PASSWORD',
  );
  const recipient = RECIPIENT;
  const asRecipient = (method, path, json) =>
    restAs(h.baseUrl, recipient, demoPassword, method, path, json);
  const bystander = BYSTANDER;
  const asBystander = (method, path, json) =>
    restAs(h.baseUrl, bystander, demoPassword, method, path, json);
  for (const [who, as] of [
    [recipient, asRecipient],
    [bystander, asBystander],
  ]) {
    const found = (await as('GET', '/me')).body;
    h.requirePrecondition(
      `${who} signs in with it, in engineers`,
      found?.id === who &&
        (found?.extendedGroups ?? []).some((group) => group.name === 'engineers'),
      `/me as ${who} answered ${found?.id}: run demo/seed.mjs with the same password`,
    );
  }

  const types = await Promise.all(
    ['Transmittal', 'TransmittalReceipt', 'ReviewCycle'].map((type) =>
      asEngineer('GET', `/config/types/${type}`),
    ),
  );
  h.requirePrecondition(
    'the kit 0.2.0 or later is installed: its Transmittal, TransmittalReceipt and ReviewCycle types',
    types.every((answer) => answer.status === 200),
    `GET /config/types answered ${types.map((answer) => answer.status).join(', ')}: install ` +
      'nuxeo-agentic-documents 0.2.0 and the kit (its README)',
  );
  const places = {};
  for (const [name, path, type] of [
    ['register', REGISTER, 'Folder'],
    ['transmittals', TRANSMITTALS_PATH, TRANSMITTALS.type],
    ['reviews', REVIEWS_PATH, REVIEWS.type],
  ]) {
    const place = await asEngineer('GET', `/path${path}`, undefined, {
      'enrichers-document': 'permissions',
    });
    places[name] = place.body;
    h.requirePrecondition(
      `the seeded ${name} folder is there, a ${type}, and the engineer may add to it`,
      place.status === 200 &&
        place.body?.type === type &&
        (place.body?.contextParameters?.permissions ?? []).includes('AddChildren'),
      `GET /path${path} answered ${place.status}, ${place.body?.type}: run demo/seed.mjs`,
    );
  }

  // What the dev server serves at /agentic-ui-config/ must be the kit's own files: they are what
  // the rest of this run asserts the pages and the forms were drawn from.
  const differing = [];
  for (const path of SERVED) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const content = answer?.ok() ? unwrap(await answer.json().catch(unread)) : null;
    if (!sameJson(content, kitFile(path))) differing.push(`${path} (${answer?.status()})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's layouts, forms, queue and labels",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  /** A search, as the engineer: the documents of an NXQL query, or `null` if not answered with a list. */
  const search = async (as, nxql) => {
    const answer = await as(
      'GET',
      `/search/lang/NXQL/execute?pageSize=200&query=${encodeURIComponent(nxql)}`,
    );
    return answer.status === 200 && Array.isArray(answer.body?.entries)
      ? answer.body.entries
      : null;
  };
  /** A page provider's results, as `as`. */
  const provider = async (as, name, ...parameters) => {
    const query = new URLSearchParams({ pageSize: '100' });
    for (const parameter of parameters) query.append('queryParams', parameter);
    const answer = await as('GET', `/search/pp/${name}/execute?${query}`);
    return answer.status === 200 && Array.isArray(answer.body?.entries)
      ? answer.body.entries
      : null;
  };
  const read = async (as, uid) => (await as('GET', `/id/${uid}`)).body;

  // The seeded drawing the transmittal lists: its number's current revision, as the server has it.
  const listedFirst = (await asEngineer('GET', `/path${REGISTER}/${revisionsOf(LISTED)[0].name}`))
    .body;
  const listedNumber = listedFirst?.properties?.['docctl:number'] ?? null;
  const listedRevisions = listedNumber
    ? await provider(asEngineer, 'controlled_documents_revisions', listedNumber)
    : null;
  const listedCurrent =
    listedRevisions?.find((doc) => doc.properties?.['docctl:status'] === 'current') ?? null;
  const listedSuperseded =
    listedRevisions?.find((doc) => doc.properties?.['docctl:status'] === 'superseded') ?? null;
  h.requirePrecondition(
    `the seeded ${LISTED.key} chain is there, with a current revision and a superseded one`,
    listedCurrent !== null && listedSuperseded !== null,
    `its first revision answered ${listedNumber ?? 'nothing'}: run demo/seed.mjs`,
  );

  // ── Set up: the run's own drawing ──────────────────────────────────────────────────────────
  await h.step("Set up: an earlier run's drawings put away, and the run's own drawing created");
  const leftovers = await search(
    asEngineer,
    "SELECT * FROM EngineeringDocument WHERE dc:description = '" +
      `${MARKER}' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0`,
  );
  const putAway = [];
  for (const doc of leftovers ?? []) {
    const trashed = await asEngineer('POST', '/automation/Document.Trash', {
      input: `doc:${doc.uid}`,
      params: {},
    });
    if (trashed.status !== 200) putAway.push(`${doc.path} (${trashed.status})`);
  }
  h.requirePrecondition(
    "an earlier run's drawings are put away, trashed",
    leftovers !== null && putAway.length === 0,
    `could not put away ${putAway.join(', ') || 'the earlier drawings (not searched)'}`,
  );
  h.note(
    `${leftovers?.length ?? 0} drawing(s) of an earlier run were trashed. Its transmittals, receipts ` +
      'and review cycles stay: the server keeps them, and only an administrator deletes one',
  );

  const runId = Date.now().toString(36).toUpperCase();
  const today = new Date();
  const drawing = {
    'dc:description': MARKER,
    'engdoc:category': 'Drawing',
    'engdoc:discipline': 'Mechanical',
    'engdoc:project': 'Riverside Pumping Station',
    'engdoc:originator': engineer,
    'engdoc:purpose': 'For review',
    'engdoc:issuedOn': isoDay(today),
  };
  const createdA = await asEngineer('POST', `/path${REGISTER}`, {
    'entity-type': 'document',
    name: `run-${runId.toLowerCase()}-a`,
    type: 'EngineeringDocument',
    properties: {
      ...drawing,
      'dc:title': `Run ${runId} valve chamber, revision A`,
      'docctl:series': 'DWG',
    },
  });
  const revisionA = createdA.body;
  const runNumber = revisionA?.properties?.['docctl:number'] ?? null;
  h.check(
    "the run's drawing is created, numbered by the server in DWG, revision A, current",
    createdA.status === 201 &&
      /^DWG-\d{5,}$/.test(runNumber ?? '') &&
      revisionA?.properties?.['docctl:revision'] === 'A' &&
      revisionA?.properties?.['docctl:status'] === 'current',
    `POST answered ${createdA.status}: ${runNumber}, ${revisionA?.properties?.['docctl:revision']}`,
  );

  // ── 1. The engineer issues a transmittal ───────────────────────────────────────────────────
  await h.step(`1. An engineer issues a transmittal to ${recipient}, in the app`);
  await h.login();
  const subject = `Run ${runId}: pump house general arrangement, for review`;
  const due = new Date(today.getTime() + 14 * DAY);
  await h.goToDoc(places.transmittals?.uid);
  await page
    .locator('button', { hasText: 'Create / Import' })
    .first()
    .click({ timeout: 30_000 })
    .catch(deferred);
  const tile = page
    .locator('mat-dialog-container .doctype-tile', { hasText: /^\s*Transmittal\s*$/ })
    .first();
  await tile.waitFor({ state: 'visible', timeout: 30_000 }).catch(deferred);
  h.check(
    "the transmittals register's Create menu offers a Transmittal",
    await tile.isVisible().catch(() => false),
  );
  await tile.click({ timeout: 10_000 }).catch(deferred);
  await page
    .waitForSelector('mat-dialog-container [data-xpath="trm:documents"]', { timeout: 30_000 })
    .catch(deferred);
  const formFields = await page
    .evaluate(() =>
      [...document.querySelectorAll('mat-dialog-container [data-xpath]')].map((element) =>
        element.getAttribute('data-xpath'),
      ),
    )
    .catch(() => []);
  const formXpaths = kitFile('layouts/Transmittal/create.layout.json').cards.flatMap((card) =>
    card.fields.map((entry) => entry.field),
  );
  h.check(
    "the Create form draws the kit's create.layout.json: each of its fields, and none of the server's",
    formXpaths.every((xpath) => formFields.includes(xpath)) &&
      !formFields.some((xpath) => /^trm:(number|items|issuedBy|issuedAt)$/.test(xpath ?? '')),
    JSON.stringify([...new Set(formFields)]),
  );
  await field(page, 'dc:title').fill(subject, { timeout: 10_000 }).catch(deferred);
  await choose(page, 'trm:purpose', 'review');
  const dueInput = page
    .locator('mat-dialog-container nxs-date-input[data-xpath="trm:dueDate"] input')
    .first();
  const mask = await dueInput.getAttribute('placeholder').catch(unread);
  await dueInput.fill(typedDay(mask, due), { timeout: 10_000 }).catch(deferred);
  await dueInput.press('Tab').catch(deferred);
  await chip(page, 'trm:documents', listedNumber ?? '');
  await chip(page, 'trm:recipients', recipient);
  await page
    .locator('mat-dialog-container textarea[data-xpath="dc:description"]')
    .first()
    .fill('Please review before the design freeze (a demo run).', { timeout: 10_000 })
    .catch(deferred);
  await h.screenshot('transmittal-create-form-filled');
  await page
    .locator('mat-dialog-container mat-dialog-actions button[color="primary"]', {
      hasText: /^\s*Create\s*$/,
    })
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);

  const issuedQuery =
    `SELECT * FROM Transmittal WHERE dc:title = '${subject.replace(/'/g, "\\'")}' ` +
    'AND ecm:isVersion = 0 AND ecm:isProxy = 0';
  let transmittal = await until(async () => (await search(asEngineer, issuedQuery))?.[0], 30_000);
  h.check(
    "the app's Create form issued the transmittal: the server holds one with its subject",
    Boolean(transmittal),
    transmittal ? transmittal.path : 'none found after 30 s',
  );
  await page
    .locator('mat-dialog-container button', { hasText: /^\s*OK\s*$/ })
    .first()
    .click({ timeout: 5_000 })
    .catch(deferred);
  if (!transmittal) {
    // So that the steps after this one still run: the same transmittal, issued over the API.
    const issued = await asEngineer('POST', `/path${TRANSMITTALS_PATH}`, {
      'entity-type': 'document',
      name: `run-${runId.toLowerCase()}`,
      type: 'Transmittal',
      properties: {
        'dc:title': subject,
        'trm:documents': [listedNumber],
        'trm:recipients': [recipient],
        'trm:purpose': 'review',
        'trm:dueDate': isoDay(due),
      },
    });
    transmittal = issued.body;
    h.note(
      `the form did not issue it, so it was issued over the REST API (${issued.status}), for the ` +
        'steps after this one: the check above records the failure',
    );
  }
  transmittal = (await read(asEngineer, transmittal?.uid)) ?? transmittal;
  const tp = transmittal?.properties ?? {};
  const items = tp['trm:items'] ?? [];
  h.check(
    'the server numbered it in TR: TR- and five digits',
    /^TR-\d{5,}$/.test(tp['trm:number'] ?? ''),
    String(tp['trm:number']),
  );
  h.check(
    `it lists ${listedNumber} at its current revision, ${listedCurrent?.properties?.['docctl:revision']}, by id and as issued`,
    items.length === 1 &&
      items[0]?.document === listedCurrent?.uid &&
      items[0]?.number === listedNumber &&
      items[0]?.revision === listedCurrent?.properties?.['docctl:revision'] &&
      sameJson(tp['trm:documents'], [listedCurrent?.uid]),
    JSON.stringify({ items, documents: tp['trm:documents'] }),
  );
  const dueHeld = Date.parse(tp['trm:dueDate'] ?? '');
  h.check(
    `issued by ${engineer}, for review, to ${recipient} alone, due about 14 days from today`,
    tp['trm:issuedBy'] === engineer &&
      tp['trm:purpose'] === 'review' &&
      sameJson(tp['trm:recipients'], [recipient]) &&
      Math.abs(dueHeld - due.getTime()) <= 2 * DAY,
    JSON.stringify({
      issuedBy: tp['trm:issuedBy'],
      purpose: tp['trm:purpose'],
      recipients: tp['trm:recipients'],
      dueDate: tp['trm:dueDate'],
    }),
  );
  const receipts = transmittal?.uid
    ? await provider(asEngineer, 'controlled_documents_transmittal_receipts', transmittal.uid)
    : null;
  const receipt = receipts?.find((doc) => doc.properties?.['trr:recipient'] === recipient) ?? null;
  h.check(
    `the server made one receipt beside it, ${recipient}'s, awaiting, with the transmittal's number`,
    receipts?.length === 1 &&
      receipt?.properties?.['trr:status'] === 'awaiting' &&
      receipt?.properties?.['trr:number'] === tp['trm:number'] &&
      receipt?.properties?.['trr:transmittal'] === transmittal?.uid &&
      receipt?.path?.startsWith(`${TRANSMITTALS_PATH}/`),
    JSON.stringify(receipts?.map((doc) => [doc.path, doc.properties?.['trr:status']]) ?? null),
  );

  await h.goToDoc(transmittal?.uid);
  await page
    .waitForSelector('.record-page__card[data-card-id="recipients"] tr[data-uid]', {
      timeout: 30_000,
    })
    .catch(deferred);
  const shownNumber = await shownField(page, 'transmittal', 'trm:number');
  h.check(
    "the transmittal's record page shows its number",
    shownNumber === tp['trm:number'],
    String(shownNumber),
  );
  const recipientRow = await rowText(page, 'recipients', receipt?.uid);
  h.check(
    `its Recipients card lists ${recipient}'s receipt, awaiting`,
    /awaiting/i.test(recipientRow ?? ''),
    String(recipientRow),
  );
  await h.screenshot('transmittal-issued', page.locator('[data-card-id="recipients"]'));

  // A superseded revision is not sent: over the API, naming it by its id.
  const refusedSubject = `Run ${runId}: a superseded revision, refused`;
  const superseded = await asEngineer('POST', `/path${TRANSMITTALS_PATH}`, {
    'entity-type': 'document',
    name: `run-${runId.toLowerCase()}-refused`,
    type: 'Transmittal',
    properties: {
      'dc:title': refusedSubject,
      'trm:documents': [listedSuperseded?.uid],
      'trm:recipients': [recipient],
      'trm:purpose': 'construction',
      'trm:dueDate': isoDay(due),
    },
  });
  const madeAnyway = await search(
    asEngineer,
    `SELECT * FROM Transmittal WHERE dc:title = '${refusedSubject.replace(/'/g, "\\'")}'`,
  );
  h.check(
    `a transmittal naming ${listedNumber}'s superseded revision is refused, 409, and nothing is made`,
    superseded.status === 409 &&
      /current revision/.test(messageOf(superseded)) &&
      Array.isArray(madeAnyway) &&
      madeAnyway.length === 0,
    `answered ${superseded.status}: ${messageOf(superseded)}; ${madeAnyway?.length} made`,
  );

  // ── 2. The recipient returns it ────────────────────────────────────────────────────────────
  await h.step(`2. The recipient, ${recipient}, returns it with a comment, and nobody else may`);
  // First, over the API: the engineer may write every receipt in the register, and this one is not
  // theirs to answer.
  const byEngineer = await asEngineer('PUT', `/id/${receipt?.uid}`, {
    'entity-type': 'document',
    properties: { 'trr:status': 'acknowledged' },
  });
  const afterEngineer = (await read(asEngineer, receipt?.uid))?.properties ?? {};
  h.check(
    `the engineer's answer to ${recipient}'s receipt is refused, 403, and it still awaits`,
    byEngineer.status === 403 &&
      new RegExp(`Only the recipient this transmittal was sent to, ${recipient}`).test(
        messageOf(byEngineer),
      ) &&
      afterEngineer['trr:status'] === 'awaiting' &&
      !afterEngineer['trr:respondedAt'],
    `answered ${byEngineer.status}: ${messageOf(byEngineer)}; now ${afterEngineer['trr:status']}`,
  );

  // As payers-claims-workflow signs its supervisor in: declared first, the engineer's cookie
  // dropped, every frame's Nuxeo request given the recipient's header until the reload commits,
  // then the app's own header, from the session it restored. Off the transmittal's page first,
  // to the home, which the recipient may read too.
  await h.goTo('/#/home');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(deferred);
  await h.signedInAs(recipient, 'the recipient answers the transmittal sent to them');
  const recipientBasic = Buffer.from(`${recipient}:${demoPassword}`).toString('base64');
  await page.route('**/nuxeo/**', (route) => {
    let fromFrame = false;
    try {
      fromFrame = Boolean(route.request().frame());
    } catch {
      // A service worker's request has no frame, and keeps its own header.
      fromFrame = false;
    }
    return fromFrame
      ? route.continue({
          headers: { ...route.request().headers(), authorization: `Basic ${recipientBasic}` },
        })
      : route.continue();
  });
  await page.context().clearCookies();
  await page.evaluate(
    ({ key, value, outKey }) => {
      localStorage.removeItem(key);
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(outKey);
    },
    {
      key: SESSION_KEY,
      outKey: SIGNED_OUT_KEY,
      value: JSON.stringify({
        kind: 'basic',
        username: recipient,
        basic: recipientBasic,
        isAdministrator: false,
        groups: [],
      }),
    },
  );
  await page.reload({ waitUntil: 'commit', timeout: 120_000 });
  await page.unroute('**/nuxeo/**');
  await page.waitForLoadState('load', { timeout: 120_000 });

  await h.goTo('/#/queues/awaiting-me');
  await page.waitForSelector('.queue-page tbody tr[data-uid]', { timeout: 30_000 }).catch(deferred);
  const queueRow = await rowText(page, null, receipt?.uid);
  const awaitingServed = await provider(asRecipient, 'controlled_documents_awaiting_me', recipient);
  h.check(
    `the Transmittals awaiting me queue lists ${recipient}'s receipt, as the server does`,
    queueRow !== null &&
      queueRow.includes(tp['trm:number'] ?? '\u0000') &&
      (awaitingServed ?? []).some((doc) => doc.uid === receipt?.uid),
    `drawn: ${queueRow}; served: ${awaitingServed?.length ?? 'not read'}`,
  );
  await h.screenshot('awaiting-me-queue');

  await h.goToDoc(receipt?.uid);
  await page
    .waitForSelector('.record-page__banner[data-banner-id="awaiting"]', { timeout: 30_000 })
    .catch(deferred);
  h.check(
    "the receipt's page says it awaits its recipient's answer, by the kit's banner",
    await page
      .locator('.record-page__banner[data-banner-id="awaiting"]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  const comment = `Section B-B needs the crane rail level (run ${runId}).`;
  const edit = page
    .locator('[data-action-id="app.toolbar.edit"], [data-action-id="app.toolbar.editProperties"]')
    .first();
  if (await edit.isVisible().catch(() => false)) await edit.click().catch(deferred);
  else
    await page
      .getByRole('button', { name: /^Edit$/ })
      .first()
      .click({ timeout: 10_000 })
      .catch(deferred);
  await page
    .waitForSelector('mat-dialog-container nxs-vocabulary-select[data-xpath="trr:status"]', {
      timeout: 30_000,
    })
    .catch(deferred);
  await choose(page, 'trr:status', 'returned');
  await page
    .locator('mat-dialog-container textarea[data-xpath="trr:comment"]')
    .first()
    .fill(comment, { timeout: 10_000 })
    .catch(deferred);
  await h.screenshot('receipt-edit-form-returned');
  await page
    .locator('mat-dialog-container button', { hasText: /^\s*Save\s*$/ })
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
  const answered = await until(async () => {
    const now = (await read(asRecipient, receipt?.uid))?.properties;
    return now?.['trr:status'] !== 'awaiting' ? now : null;
  }, 30_000);
  const respondedAt = Date.parse(answered?.['trr:respondedAt'] ?? '');
  h.check(
    "the Edit form's answer is the server's: returned, with the comment as typed, and when",
    answered?.['trr:status'] === 'returned' &&
      answered?.['trr:comment'] === comment &&
      Number.isFinite(respondedAt) &&
      Math.abs(respondedAt - Date.now()) < 10 * 60 * 1000,
    JSON.stringify({
      status: answered?.['trr:status'],
      comment: answered?.['trr:comment'],
      respondedAt: answered?.['trr:respondedAt'],
    }),
  );
  await h.screenshot('receipt-returned');
  const again = await asRecipient('PUT', `/id/${receipt?.uid}`, {
    'entity-type': 'document',
    properties: { 'trr:status': 'acknowledged', 'trr:comment': 'Changed my mind' },
  });
  const afterAgain = (await read(asRecipient, receipt?.uid))?.properties ?? {};
  h.check(
    `${recipient}'s second answer is refused, 409, and the first stays`,
    again.status === 409 &&
      /has been answered/.test(messageOf(again)) &&
      afterAgain['trr:status'] === 'returned' &&
      afterAgain['trr:comment'] === comment,
    `answered ${again.status}: ${messageOf(again)}; now ${afterAgain['trr:status']}`,
  );
  // The browser's cookie jar is the identity guard's to judge: a cookie the recipient's session
  // picked up would answer the next step boundary as them.
  await page.context().clearCookies();

  // ── 2, the review comments ─────────────────────────────────────────────────────────────────
  await h.step('2. Review cycle: the server keeps a cycle with an open comment from closing');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(deferred);
  await h.login();
  const opened = await asEngineer('POST', `/path${REVIEWS_PATH}`, {
    'entity-type': 'document',
    name: `run-${runId.toLowerCase()}`,
    type: 'ReviewCycle',
    properties: {
      'rvw:document': revisionA?.uid,
      'rvw:reviewers': [recipient],
      'rvw:dueDate': isoDay(new Date(today.getTime() + 7 * DAY)),
    },
  });
  const cycle = opened.body;
  h.check(
    `the engineer opens a review cycle on ${runNumber} revision A, ${recipient} its reviewer`,
    opened.status === 201 &&
      cycle?.properties?.['rvw:status'] === 'open' &&
      cycle?.properties?.['rvw:openedBy'] === engineer &&
      cycle?.properties?.['rvw:number'] === runNumber &&
      cycle?.properties?.['rvw:revision'] === 'A',
    `POST answered ${opened.status}: ${messageOf(opened) || cycle?.properties?.['rvw:status']}`,
  );
  const remark = `The valve spindle clearance is not dimensioned (run ${runId}).`;
  const commented = await asRecipient('POST', `/id/${cycle?.uid}/@comment`, {
    'entity-type': 'comment',
    parentId: cycle?.uid,
    text: remark,
  });
  const thread = commented.body?.id ? await read(asRecipient, commented.body.id) : null;
  h.check(
    "the reviewer's comment, Nuxeo's own, is an open thread of the cycle",
    commented.status === 201 &&
      (thread?.facets ?? []).includes('ReviewComment') &&
      thread?.properties?.['rvwc:cycle'] === cycle?.uid &&
      thread?.properties?.['rvwc:status'] === 'open',
    `POST @comment answered ${commented.status}; ${JSON.stringify({
      facets: thread?.facets,
      cycle: thread?.properties?.['rvwc:cycle'],
      status: thread?.properties?.['rvwc:status'],
    })}`,
  );
  const byBystander = await asBystander('POST', `/id/${cycle?.uid}/@comment`, {
    'entity-type': 'comment',
    parentId: cycle?.uid,
    text: 'Not a reviewer of this cycle.',
  });
  h.check(
    `${bystander}, who may read and write the cycle and is not its reviewer, may not comment in it: 403`,
    byBystander.status === 403,
    `answered ${byBystander.status}: ${messageOf(byBystander)}`,
  );
  const closeEarly = await asEngineer('PUT', `/id/${cycle?.uid}`, {
    'entity-type': 'document',
    properties: { 'rvw:status': 'closed' },
  });
  const stillOpen = (await read(asEngineer, cycle?.uid))?.properties ?? {};
  h.check(
    "the engineer's close is refused, 409, while the thread is open, and the cycle stays open",
    closeEarly.status === 409 &&
      /1 comment of this review cycle is open/.test(messageOf(closeEarly)) &&
      stillOpen['rvw:status'] === 'open' &&
      !stillOpen['rvw:closedBy'],
    `answered ${closeEarly.status}: ${messageOf(closeEarly)}; now ${stillOpen['rvw:status']}`,
  );
  await h.goToDoc(cycle?.uid);
  await page
    .waitForSelector('.record-page__card[data-card-id="threads"] tr[data-uid]', {
      timeout: 30_000,
    })
    .catch(deferred);
  const threadRow = await rowText(page, 'threads', thread?.uid);
  h.check(
    "the cycle's page lists the thread to resolve, open",
    threadRow !== null && /open/i.test(threadRow),
    String(threadRow),
  );
  await h.screenshot('review-cycle-thread-open', page.locator('[data-card-id="threads"]'));
  const byReviewer = await asRecipient('PUT', `/id/${thread?.uid}`, {
    'entity-type': 'document',
    properties: { 'rvwc:status': 'resolved' },
  });
  h.check(
    `the reviewer, ${recipient}, who did not open the cycle, may not resolve the thread: 403`,
    byReviewer.status === 403 &&
      new RegExp(`Only whoever opened this review cycle, ${engineer}`).test(messageOf(byReviewer)),
    `answered ${byReviewer.status}: ${messageOf(byReviewer)}`,
  );
  const resolved = await asEngineer('PUT', `/id/${thread?.uid}`, {
    'entity-type': 'document',
    properties: { 'rvwc:status': 'resolved', 'rvwc:resolution': 'Clearance added to note 3.' },
  });
  const resolvedNow = (await read(asEngineer, thread?.uid))?.properties ?? {};
  h.check(
    'the engineer resolves it, and the server writes who and when',
    resolved.status === 200 &&
      resolvedNow['rvwc:status'] === 'resolved' &&
      resolvedNow['rvwc:resolvedBy'] === engineer &&
      Boolean(resolvedNow['rvwc:resolvedAt']),
    `PUT answered ${resolved.status}: ${messageOf(resolved)}`,
  );
  const closed = await asEngineer('PUT', `/id/${cycle?.uid}`, {
    'entity-type': 'document',
    properties: { 'rvw:status': 'closed' },
  });
  const closedNow = (await read(asEngineer, cycle?.uid))?.properties ?? {};
  h.check(
    'with no thread open, the cycle closes: closed by the engineer, one thread resolved',
    closed.status === 200 &&
      closedNow['rvw:status'] === 'closed' &&
      closedNow['rvw:closedBy'] === engineer &&
      Number(closedNow['rvw:comments']) === 1,
    `PUT answered ${closed.status}: ${messageOf(closed)}; ${JSON.stringify({
      status: closedNow['rvw:status'],
      by: closedNow['rvw:closedBy'],
      comments: closedNow['rvw:comments'],
    })}`,
  );
  const recorded = (await read(asEngineer, revisionA?.uid))?.properties?.['docrev:cycles'] ?? [];
  h.check(
    'the closed cycle is recorded on the revision it reviewed, by the server',
    recorded.length === 1 &&
      recorded[0]?.cycle === cycle?.uid &&
      recorded[0]?.closedBy === engineer &&
      Number(recorded[0]?.comments) === 1,
    JSON.stringify(recorded),
  );
  const late = await asRecipient('POST', `/id/${cycle?.uid}/@comment`, {
    'entity-type': 'comment',
    parentId: cycle?.uid,
    text: 'A comment after the close.',
  });
  h.check(
    'a comment after the close is refused, 409',
    late.status === 409,
    `answered ${late.status}: ${messageOf(late)}`,
  );
  await h.goToDoc(revisionA?.uid);
  await page
    .waitForSelector('.record-page__card[data-card-id="reviews"] tr[data-uid]', {
      timeout: 30_000,
    })
    .catch(deferred);
  const cycleRow = await rowText(page, 'reviews', cycle?.uid);
  h.check(
    "the drawing's review-cycle card lists the cycle, closed",
    cycleRow !== null && /closed/i.test(cycleRow),
    String(cycleRow),
  );
  await h.screenshot('revision-review-cycles', page.locator('[data-card-id="reviews"]'));

  // ── 3. The new revision supersedes the old one ─────────────────────────────────────────────
  await h.step('3. The new revision supersedes the old one');
  const titleB = `Run ${runId} valve chamber, revision B`;
  const createdB = await asEngineer('POST', `/path${REGISTER}`, {
    'entity-type': 'document',
    name: `run-${runId.toLowerCase()}-b`,
    type: 'EngineeringDocument',
    properties: { ...drawing, 'dc:title': titleB, 'docctl:supersedes': revisionA?.uid },
  });
  const revisionB = createdB.body;
  const pb = revisionB?.properties ?? {};
  h.check(
    `revision B takes ${runNumber} and the next revision, B, and is current, superseding A`,
    createdB.status === 201 &&
      pb['docctl:number'] === runNumber &&
      pb['docctl:revision'] === 'B' &&
      pb['docctl:status'] === 'current' &&
      pb['docctl:supersedes'] === revisionA?.uid,
    `POST answered ${createdB.status}: ${JSON.stringify({
      number: pb['docctl:number'],
      revision: pb['docctl:revision'],
      status: pb['docctl:status'],
    })}`,
  );
  const aNow = (await read(asEngineer, revisionA?.uid))?.properties ?? {};
  h.check(
    'revision A is superseded, and linked to B',
    aNow['docctl:status'] === 'superseded' && aNow['docctl:supersededBy'] === revisionB?.uid,
    JSON.stringify({ status: aNow['docctl:status'], by: aNow['docctl:supersededBy'] }),
  );
  const twice = await asEngineer('POST', `/path${REGISTER}`, {
    'entity-type': 'document',
    name: `run-${runId.toLowerCase()}-b2`,
    type: 'EngineeringDocument',
    properties: {
      ...drawing,
      'dc:title': `Run ${runId} a second revision B`,
      'docctl:supersedes': revisionA?.uid,
    },
  });
  const revisionsNow = await provider(asEngineer, 'controlled_documents_revisions', runNumber);
  h.check(
    'a second revision over A is refused, 409, and the number still has two revisions',
    twice.status === 409 && /not current/.test(messageOf(twice)) && revisionsNow?.length === 2,
    `answered ${twice.status}: ${messageOf(twice)}; ${revisionsNow?.length} revisions`,
  );
  await h.goToDoc(revisionA?.uid);
  const banner = page.locator('.record-page__banner[data-banner-id="superseded"]').first();
  await banner.waitFor({ state: 'visible', timeout: 30_000 }).catch(deferred);
  const bannerText = await banner
    .innerText({ timeout: 10_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
  const words = labels['controlled-documents.banner.superseded'];
  h.check(
    "A's page shows the superseded banner, in the kit's words, linking to B by its title",
    bannerText !== null && bannerText.includes(words) && bannerText.includes(titleB),
    String(bannerText),
  );
  await h.screenshot('revision-a-superseded-banner', banner);

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    'inside the server only: the recipient is a user of this server. Outside users, their ' +
      "sign-in and the portal are decision C's, phase 8's portal, and not built",
  );
  h.note(
    "the server's own install is not what the app read: under the dev server the layouts and " +
      'forms come from config:dev; the app registry serves the same files from the package',
  );
  h.note(
    'resolving a thread and closing a cycle are done over the REST API: the kit has an Edit form ' +
      "for a cycle's status, and no Resolve action on a comment, which is not built",
  );
  h.note(
    `the run leaves its transmittal, ${tp['trm:number']}, its receipt and its closed review cycle on ` +
      "the server, which keeps them; the next run trashes this run's drawings, marked " +
      `"${MARKER}"`,
  );
  h.note(
    "the add-on's concurrency rules (one answer per receipt, one open cycle per revision, a " +
      'comment and a close never crossing) and its permission rules beyond these are held by its ' +
      'own tests, not by this run',
  );
}
