/**
 * The controlled documents kit's export-control marks: business apps phase 8's document control
 * add-on, its last part (docs/business-apps/development-plan.md, phase 8, "The document control
 * add-on"), on the kit in `business-apps/packages/controlled-documents-demo`, version 0.3.0 or later,
 * with `nuxeo-agentic-documents` 0.3.0.
 *
 * The steps:
 *
 *   - **Set up:** an earlier run's drawings put away (trashed), and the run's own drawing, a first
 *     revision in series DWG, marked EC-2 for `ec2-cleared` by the engineer, who holds the add-on's
 *     `ChangeExportMark` as a document controller. Read back: the mark as written, and the server's
 *     who.
 *   - **1. A rendition, refused and served.** Over the REST API, the drawing's `xmlExport`
 *     rendition: refused, 403, to `UNCLEARED` of `data.mjs`, who is in no group of the mark;
 *     served, 200, to `CLEARED`, who is in `ec2-cleared`. The `exportMark` enricher says why to
 *     each: `not-in-groups`, and receives.
 *   - **2. A transmittal, refused and issued.** In the app, as the engineer: the transmittals
 *     register's Create form, filled in with the drawing's number and `UNCLEARED` as the recipient,
 *     refused, with the server's reason in the form, which stays open; nothing issued. Over the
 *     REST API, the same refused, 403, with the same reason, and to `CLEARED` issued, with a receipt
 *     for them.
 *   - **3. The mark carried to a new revision.** Over the REST API, as the engineer: revision B of
 *     the drawing, sent with another mark, EC-1. Read back: B carries A's, EC-2 for `ec2-cleared`,
 *     and its rendition is refused to `UNCLEARED` as A's is.
 *   - **4. A change of the mark without the permission refused, and with it made and audited.**
 *     `CLEARED`, who may write B and does not hold `ChangeExportMark`, changing B's mark and
 *     removing it: each refused, 403, and B still EC-2. The engineer changing it to EC-1 for
 *     `ec1-cleared`: made, the server writing who; `UNCLEARED` now served the rendition, and
 *     `CLEARED` refused it. B's history, the platform's audit, holds an `exportMarkChanged` entry by
 *     the engineer, from EC-2 to EC-1.
 *   - **5. The banners.** In the app: B's page shows the EC-1 banner, in the kit's words, and the
 *     Control card its mark; A's page the EC-2 banner.
 *
 * Why the run's own drawing: a mark changed stays changed, and the seeded register should read the
 * same afterwards. The seeded marked chain is only checked, as a precondition, to carry its mark.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit 0.3.0 or later installed on the local Nuxeo with `nuxeo-agentic-documents` 0.3.0, and
 *   seeded with `demo/seed.mjs`, which creates the demo's people, the marks' groups, the
 *   permissions, the register and the transmittals register.
 * - **The run's own user is the engineer:** `NUXEO_USER` is `ENGINEER` of `data.mjs`, and
 *   `NUXEO_PASS` the demo password. `CONTROLLED_DOCUMENTS_DEMO_PASSWORD`, the same password, signs
 *   in `CLEARED` and `UNCLEARED`, over the REST API only.
 * - The dev server with `npm run config:dev` serving the kit's layouts, forms and labels (the kit's
 *   README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=avega NUXEO_PASS="$CONTROLLED_DOCUMENTS_DEMO_PASSWORD" npm run beta:evidence -- controlled-documents-export-marks
 *
 * Load-bearing checks: the rendition served to the cleared person; the transmittal to them issued,
 * with their receipt; B's mark as the server holds it, A's carried; the engineer's change, as the
 * server holds it, and its audit entry; the banners. Negative ones: the rendition refused to the
 * person outside the mark's groups, before and after the change, and to the cleared one after it;
 * the transmittal refused in the form, with the reason shown, and over the REST API, nothing issued;
 * the creator's other mark not kept on B; the change and the removal without the permission
 * refused, nothing changed. Each refusal is read back as nothing changed.
 *
 * Not covered, and said in notes: a file's download, since the kit's stand-in type holds no file:
 * the add-on's own tests hold a file refused and served through the platform's download service,
 * with a version, a proxy and a folder's renditions (`mvn -pl nuxeo-agentic-documents -am verify`);
 * the server's own install of the layouts; the fence that keeps a change and a new revision or a
 * transmittal from crossing, which the add-on's tests hold.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'controlled-documents-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { CHAINS, CLEARED, ENGINEER, FOLDER, TRANSMITTALS, UNCLEARED, WORKSPACE, revisionsOf } =
  await import(join(KIT, 'demo', 'data.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [ENGINEER],
    who: 'the engineer who marks drawings and issues transmittals, a document controller',
  },
  signsInAs: [CLEARED, UNCLEARED],
  needs: [
    'the kit 0.3.0 or later installed, with nuxeo-agentic-documents 0.3.0',
    "the dev server with `npm run config:dev` serving the kit's layouts, forms and labels",
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
const REGISTER = `${ROOT}/${FOLDER.name}`;
const TRANSMITTALS_PATH = `${ROOT}/${TRANSMITTALS.name}`;
/** How this demo's own drawings are known again: their `dc:description`. Not the seed's. */
const MARKER = 'Controlled documents export-marks demo (fictional)';
/** The seeded marked chain, checked as a precondition. */
const SEEDED_MARKED = CHAINS.find((chain) => chain.mark?.classification === 'EC-2');
const EC2 = { classification: 'EC-2', groups: ['ec2-cleared'] };
const EC1 = { classification: 'EC-1', groups: ['ec1-cleared'] };

/** The files `config:dev` must serve as the kit has them: what this run's pages are drawn from. */
const SERVED = [
  'layouts/EngineeringDocument/view.layout.json',
  'layouts/Transmittal/create.layout.json',
  'labels/en.json',
];

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy; `AI.*` operations come from a
 * marketplace package this server may lack; the shell's recently-viewed list asks for a thumbnail
 * of every document in it, which a record with no file does not have; and the Create form's refused
 * transmittal, the 403 this run asks for.
 */
const ENVIRONMENTAL_ERRORS = [
  '/nuxeo/logout',
  /automation\/AI\./,
  /\/@rendition\/thumbnail$/,
  /\/api\/v1\/path\/.*\/transmittals$/,
];

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

/** A text as an NXQL string literal's contents: its backslashes, then its quotes, escaped. */
const nxqlText = (text) => String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** `probe()` until it answers something truthy, or `timeout` ms pass: its last answer either way. */
async function until(probe, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const answer = await probe().catch(unread);
    if (answer || Date.now() >= deadline) return answer;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A REST call from Node, as `username`, with Basic authentication and no cookie. */
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

/** A served file as the app reads it: a layout in the servlet's envelope, its `content`. */
function unwrap(body) {
  return body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout'
    ? body.content
    : body;
}

/** A day as the REST API writes a `date` property: `YYYY-MM-DD`, in UTC. */
const isoDay = (date) => date.toISOString().slice(0, 10);

/** A day as a person types it into the date field, after its placeholder, the locale's mask. */
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

/** The text of a record page's banner, by its id, or `null` when it is not shown. */
async function bannerText(page, id) {
  const banner = page.locator(`.record-page__banner[data-banner-id="${id}"]`).first();
  await banner.waitFor({ state: 'visible', timeout: 30_000 }).catch(deferred);
  return banner
    .innerText({ timeout: 10_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
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

/** A mark as a document's properties hold it. */
const markOf = (doc) => ({
  classification: doc?.properties?.['docmark:classification'] ?? null,
  groups: doc?.properties?.['docmark:groups'] ?? [],
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step(
    'Preconditions: the kit 0.3.0 installed and seeded, its files served, and its people',
  );
  const { username: engineer, password: engineerPassword } = requireStepCredentials(
    'sign the export-marks demo in as its engineer',
  );
  h.requirePrecondition(
    `the run signs in as the engineer, ${ENGINEER}`,
    engineer === ENGINEER,
    `NUXEO_USER is ${engineer}: set it to ${ENGINEER}, and NUXEO_PASS to the demo password`,
  );
  const asEngineer = (method, path, json, headers) =>
    restAs(h.baseUrl, engineer, engineerPassword, method, path, json, headers);
  const demoPassword = process.env['CONTROLLED_DOCUMENTS_DEMO_PASSWORD'] ?? '';
  h.requirePrecondition(
    'CONTROLLED_DOCUMENTS_DEMO_PASSWORD is set, for the people the marks clear and exclude',
    demoPassword !== '',
    'export the password the seed gave the demo users as CONTROLLED_DOCUMENTS_DEMO_PASSWORD',
  );
  const asCleared = (method, path, json, headers) =>
    restAs(h.baseUrl, CLEARED, demoPassword, method, path, json, headers);
  const asUncleared = (method, path, json, headers) =>
    restAs(h.baseUrl, UNCLEARED, demoPassword, method, path, json, headers);
  const groupsOf = (me) => (me?.extendedGroups ?? []).map((group) => group.name);
  const me = (await asEngineer('GET', '/me')).body;
  h.requirePrecondition(
    "the server has the engineer, a document controller, in both marks' groups",
    me?.id === engineer &&
      ['document-controllers', 'ec1-cleared', 'ec2-cleared'].every((group) =>
        groupsOf(me).includes(group),
      ),
    `/me answered ${me?.id} in ${JSON.stringify(groupsOf(me))}: run demo/seed.mjs first`,
  );
  const cleared = (await asCleared('GET', '/me')).body;
  const uncleared = (await asUncleared('GET', '/me')).body;
  h.requirePrecondition(
    `${CLEARED} is in ec2-cleared, and ${UNCLEARED} in ec1-cleared and not ec2-cleared`,
    cleared?.id === CLEARED &&
      groupsOf(cleared).includes('ec2-cleared') &&
      !groupsOf(cleared).includes('ec1-cleared') &&
      uncleared?.id === UNCLEARED &&
      groupsOf(uncleared).includes('ec1-cleared') &&
      !groupsOf(uncleared).includes('ec2-cleared'),
    `/me answered ${cleared?.id} in ${JSON.stringify(groupsOf(cleared))} and ${uncleared?.id} in ` +
      `${JSON.stringify(groupsOf(uncleared))}: run demo/seed.mjs with the same password`,
  );
  const schema = await asEngineer('GET', '/config/schemas/export_mark');
  h.requirePrecondition(
    'nuxeo-agentic-documents 0.3.0 or later is installed: its export_mark schema',
    schema.status === 200,
    `GET /config/schemas/export_mark answered ${schema.status}: install nuxeo-agentic-documents ` +
      '0.3.0 and the kit 0.3.0 (its README)',
  );
  const places = {};
  for (const [name, path] of [
    ['register', REGISTER],
    ['transmittals', TRANSMITTALS_PATH],
  ]) {
    const place = await asEngineer('GET', `/path${path}`, undefined, {
      'enrichers-document': 'permissions',
    });
    places[name] = place.body;
    const held = place.body?.contextParameters?.permissions ?? [];
    h.requirePrecondition(
      `the seeded ${name} folder is there, and the engineer may add to it` +
        (name === 'register' ? ' and holds ChangeExportMark on it' : ''),
      place.status === 200 &&
        held.includes('AddChildren') &&
        (name !== 'register' || held.includes('ChangeExportMark')),
      `GET /path${path} answered ${place.status}, with ${JSON.stringify(held)}: run demo/seed.mjs`,
    );
  }
  const differing = [];
  for (const path of SERVED) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const content = answer?.ok() ? unwrap(await answer.json().catch(unread)) : null;
    if (!sameJson(content, kitFile(path))) differing.push(`${path} (${answer?.status()})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's record page, Create form and labels",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );
  const seededMarked = await Promise.all(
    revisionsOf(SEEDED_MARKED).map(
      async (revision) => (await asEngineer('GET', `/path${REGISTER}/${revision.name}`)).body,
    ),
  );
  h.requirePrecondition(
    `the seeded ${SEEDED_MARKED.key} chain carries EC-2 on every revision`,
    seededMarked.length > 1 && seededMarked.every((doc) => sameJson(markOf(doc), EC2)),
    `${JSON.stringify(seededMarked.map(markOf))}: run demo/seed.mjs`,
  );

  /** A search, as `as`: the documents of an NXQL query, or `null` if not answered with a list. */
  const search = async (as, nxql) => {
    const answer = await as(
      'GET',
      `/search/lang/NXQL/execute?pageSize=200&query=${encodeURIComponent(nxql)}`,
    );
    return answer.status === 200 && Array.isArray(answer.body?.entries)
      ? answer.body.entries
      : null;
  };
  const read = async (as, uid) => (await as('GET', `/id/${uid}`)).body;
  const rendition = async (as, uid) => (await as('GET', `/id/${uid}/@rendition/xmlExport`)).status;
  const enriched = async (as, uid) =>
    (await as('GET', `/id/${uid}`, undefined, { 'enrichers-document': 'exportMark' })).body
      ?.contextParameters?.exportMark ?? null;

  // ── Set up: the run's own marked drawing ───────────────────────────────────────────────────
  await h.step(
    "Set up: an earlier run's drawings put away, and the run's own drawing, marked EC-2",
  );
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
  const runId = Date.now().toString(36).toUpperCase();
  const today = new Date();
  const drawing = {
    'dc:description': MARKER,
    'engdoc:category': 'Drawing',
    'engdoc:discipline': 'Electrical',
    'engdoc:project': 'Riverside Pumping Station',
    'engdoc:originator': engineer,
    'engdoc:purpose': 'For review',
    'engdoc:issuedOn': isoDay(today),
  };
  const createdA = await asEngineer('POST', `/path${REGISTER}`, {
    'entity-type': 'document',
    name: `xm-${runId.toLowerCase()}-a`,
    type: 'EngineeringDocument',
    properties: {
      ...drawing,
      'dc:title': `Run ${runId} control panel wiring, revision A`,
      'docctl:series': 'DWG',
      'docmark:classification': EC2.classification,
      'docmark:groups': EC2.groups,
    },
  });
  const revisionA = createdA.body;
  const runNumber = revisionA?.properties?.['docctl:number'] ?? null;
  h.check(
    "the run's drawing is created, numbered in DWG, marked EC-2 for ec2-cleared, the engineer written as having marked it",
    createdA.status === 201 &&
      /^DWG-\d{5,}$/.test(runNumber ?? '') &&
      sameJson(markOf(revisionA), EC2) &&
      revisionA?.properties?.['docmark:markedBy'] === engineer &&
      Boolean(revisionA?.properties?.['docmark:markedAt']),
    `POST answered ${createdA.status}: ${messageOf(createdA)} ${runNumber} ${JSON.stringify(markOf(revisionA))}`,
  );

  // ── 1. A rendition, refused and served ─────────────────────────────────────────────────────
  await h.step('1. A rendition of the marked drawing: refused outside its groups, served inside');
  const refusedA = await rendition(asUncleared, revisionA?.uid);
  h.check(
    `its xmlExport rendition is refused to ${UNCLEARED}, in no group of the mark, 403`,
    refusedA === 403,
    `answered ${refusedA}`,
  );
  const servedA = await rendition(asCleared, revisionA?.uid);
  h.check(`and served to ${CLEARED}, in ec2-cleared, 200`, servedA === 200, `answered ${servedA}`);
  const why = await enriched(asUncleared, revisionA?.uid);
  const whyNot = await enriched(asCleared, revisionA?.uid);
  h.check(
    'the exportMark enricher says why: not-in-groups to the one, receives to the other',
    why?.receives === false &&
      why?.reason === 'not-in-groups' &&
      why?.classification === 'EC-2' &&
      whyNot?.receives === true &&
      whyNot?.reason === null,
    JSON.stringify({ [UNCLEARED]: why, [CLEARED]: whyNot }),
  );

  // ── 2. A transmittal, refused and issued ───────────────────────────────────────────────────
  await h.step(
    `2. A transmittal of it: refused to ${UNCLEARED} in the app's form, issued to ${CLEARED}`,
  );
  await h.login();
  const subject = `Run ${runId}: control panel wiring, for review`;
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
  await tile.click({ timeout: 10_000 }).catch(deferred);
  await page
    .waitForSelector('mat-dialog-container [data-xpath="trm:documents"]', { timeout: 30_000 })
    .catch(deferred);
  await field(page, 'dc:title').fill(subject, { timeout: 10_000 }).catch(deferred);
  await choose(page, 'trm:purpose', 'review');
  const dueInput = page
    .locator('mat-dialog-container nxs-date-input[data-xpath="trm:dueDate"] input')
    .first();
  const mask = await dueInput.getAttribute('placeholder').catch(unread);
  await dueInput.fill(typedDay(mask, due), { timeout: 10_000 }).catch(deferred);
  await dueInput.press('Tab').catch(deferred);
  await chip(page, 'trm:documents', runNumber ?? '');
  await chip(page, 'trm:recipients', UNCLEARED);
  await h.screenshot('transmittal-to-uncleared-filled');
  await page
    .locator('mat-dialog-container mat-dialog-actions button[color="primary"]', {
      hasText: /^\s*Create\s*$/,
    })
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
  const shown = page.locator('mat-dialog-container .error-text').first();
  await shown.waitFor({ state: 'visible', timeout: 30_000 }).catch(deferred);
  const reason = await shown
    .innerText({ timeout: 10_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
  h.check(
    "the Create form refuses it, with the server's reason: the mark excludes the recipient from the drawing",
    reason !== null &&
      reason.includes('export-control marks exclude') &&
      reason.includes(UNCLEARED) &&
      reason.includes(runNumber ?? '#') &&
      reason.includes('EC-2'),
    String(reason),
  );
  h.check(
    'and the form stays open: its recipients field is still shown',
    await page
      .locator('mat-dialog-container [data-xpath="trm:recipients"]')
      .first()
      .isVisible()
      .catch(() => false),
  );
  await h.screenshot('transmittal-to-uncleared-refused', page.locator('mat-dialog-container'));
  const issuedQuery =
    `SELECT * FROM Transmittal WHERE dc:title = '${nxqlText(subject)}' ` +
    'AND ecm:isVersion = 0 AND ecm:isProxy = 0';
  const issuedByForm = await search(asEngineer, issuedQuery);
  h.check(
    'nothing was issued: the server holds no transmittal with its subject',
    issuedByForm !== null && issuedByForm.length === 0,
    JSON.stringify(issuedByForm?.map((doc) => doc.path)),
  );
  await page.keyboard.press('Escape').catch(deferred);

  const transmittal = (recipient) =>
    asEngineer('POST', `/path${TRANSMITTALS_PATH}`, {
      'entity-type': 'document',
      name: `xm-${runId.toLowerCase()}-${recipient}`.slice(0, 24),
      type: 'Transmittal',
      properties: {
        'dc:title': `${subject}, to ${recipient}`,
        'trm:documents': [runNumber],
        'trm:recipients': [recipient],
        'trm:purpose': 'review',
        'trm:dueDate': isoDay(due),
      },
    });
  const overApi = await transmittal(UNCLEARED);
  const issuedOverApi = await search(
    asEngineer,
    `SELECT * FROM Transmittal WHERE dc:title = '${nxqlText(`${subject}, to ${UNCLEARED}`)}' ` +
      'AND ecm:isVersion = 0 AND ecm:isProxy = 0',
  );
  h.check(
    `over the REST API, the server refuses it too, 403, naming the recipient the mark excludes`,
    overApi.status === 403 &&
      messageOf(overApi).includes('export-control marks exclude') &&
      messageOf(overApi).includes(UNCLEARED) &&
      issuedOverApi !== null &&
      issuedOverApi.length === 0,
    `answered ${overApi.status}: ${messageOf(overApi)}; ${issuedOverApi?.length} issued with its subject`,
  );
  const toCleared = await transmittal(CLEARED);
  const receipts =
    toCleared.status === 201
      ? await until(async () => {
          const answer = await asEngineer(
            'GET',
            `/search/pp/controlled_documents_transmittal_receipts/execute?queryParams=${toCleared.body?.uid}`,
          );
          return answer.body?.entries?.length ? answer.body.entries : null;
        })
      : null;
  h.check(
    `to ${CLEARED}, in ec2-cleared, it is issued, numbered, with their receipt`,
    toCleared.status === 201 &&
      /^TR-\d{5,}$/.test(toCleared.body?.properties?.['trm:number'] ?? '') &&
      receipts?.length === 1 &&
      receipts[0]?.properties?.['trr:recipient'] === CLEARED,
    `answered ${toCleared.status}: ${messageOf(toCleared)}; ${receipts?.length} receipt(s)`,
  );

  // ── 3. The mark carried to a new revision ──────────────────────────────────────────────────
  await h.step('3. A new revision carries the mark of the one it supersedes');
  const titleB = `Run ${runId} control panel wiring, revision B`;
  const createdB = await asEngineer('POST', `/path${REGISTER}`, {
    'entity-type': 'document',
    name: `xm-${runId.toLowerCase()}-b`,
    type: 'EngineeringDocument',
    properties: {
      ...drawing,
      'dc:title': titleB,
      'docctl:supersedes': revisionA?.uid,
      'docmark:classification': EC1.classification,
      'docmark:groups': EC1.groups,
    },
  });
  const revisionB = createdB.body;
  h.check(
    "revision B carries A's mark, EC-2 for ec2-cleared, and not the EC-1 it was sent with",
    createdB.status === 201 &&
      revisionB?.properties?.['docctl:revision'] === 'B' &&
      sameJson(markOf(revisionB), EC2) &&
      revisionB?.properties?.['docmark:markedBy'] === engineer,
    `POST answered ${createdB.status}: ${messageOf(createdB)} ${JSON.stringify(markOf(revisionB))}`,
  );
  const refusedB = await rendition(asUncleared, revisionB?.uid);
  h.check(
    `B's rendition is refused to ${UNCLEARED}, as A's is, 403`,
    refusedB === 403,
    `answered ${refusedB}`,
  );

  // ── 4. A change without the permission refused; with it, made and audited ─────────────────
  await h.step('4. Changing the mark: refused without ChangeExportMark, made and audited with it');
  const byCleared = await asCleared('PUT', `/id/${revisionB?.uid}`, {
    'entity-type': 'document',
    properties: { 'docmark:classification': EC1.classification, 'docmark:groups': EC1.groups },
  });
  const removedByCleared = await asCleared('PUT', `/id/${revisionB?.uid}`, {
    'entity-type': 'document',
    properties: { 'docmark:classification': null, 'docmark:groups': [] },
  });
  const stillB = await read(asEngineer, revisionB?.uid);
  h.check(
    `${CLEARED}, who may write B and does not hold ChangeExportMark, may neither change its mark nor remove it, 403; B is still EC-2`,
    byCleared.status === 403 &&
      messageOf(byCleared).includes('ChangeExportMark') &&
      removedByCleared.status === 403 &&
      messageOf(removedByCleared).includes('ChangeExportMark') &&
      sameJson(markOf(stillB), EC2),
    `answered ${byCleared.status} and ${removedByCleared.status}: ${messageOf(byCleared)}; ${JSON.stringify(markOf(stillB))}`,
  );
  const changed = await asEngineer('PUT', `/id/${revisionB?.uid}`, {
    'entity-type': 'document',
    properties: { 'docmark:classification': EC1.classification, 'docmark:groups': EC1.groups },
  });
  const nowB = await read(asEngineer, revisionB?.uid);
  h.check(
    'the engineer, who holds it, changes it to EC-1 for ec1-cleared; the server writes who',
    changed.status === 200 &&
      sameJson(markOf(nowB), EC1) &&
      nowB?.properties?.['docmark:markedBy'] === engineer,
    `answered ${changed.status}: ${messageOf(changed)}; ${JSON.stringify(markOf(nowB))}`,
  );
  const afterUncleared = await rendition(asUncleared, revisionB?.uid);
  const afterCleared = await rendition(asCleared, revisionB?.uid);
  h.check(
    `now ${UNCLEARED}, in ec1-cleared, is served B's rendition, and ${CLEARED} refused it`,
    afterUncleared === 200 && afterCleared === 403,
    `answered ${afterUncleared} and ${afterCleared}`,
  );
  const entry = await until(async () => {
    const answer = await asEngineer('GET', `/id/${revisionB?.uid}/@audit?pageSize=100`);
    return (answer.body?.entries ?? []).find(
      (each) =>
        each.eventId === 'exportMarkChanged' &&
        each.principalName === engineer &&
        String(each.comment ?? '').includes('changed from EC-2'),
    );
  }, 60_000);
  h.check(
    "B's history, the platform's audit, holds the change: exportMarkChanged, by the engineer, from EC-2 to EC-1",
    Boolean(entry) && String(entry?.comment ?? '').includes('to EC-1'),
    JSON.stringify(entry ?? 'none after 60 s'),
  );

  // ── 5. The banners ─────────────────────────────────────────────────────────────────────────
  await h.step("5. The pages: each revision's banner for its mark");
  await h.goToDoc(revisionB?.uid);
  const bannerB = await bannerText(page, 'export-mark-ec1');
  h.check(
    "B's page shows the EC-1 banner, in the kit's words",
    bannerB !== null && bannerB.includes(labels['controlled-documents.banner.exportMarkEc1']),
    String(bannerB),
  );
  const markShown = await shownField(page, 'control', 'docmark:classification');
  h.check(
    'and its Control card the mark',
    markShown !== null && markShown.includes('EC-1'),
    String(markShown),
  );
  await h.screenshot('revision-b-export-mark-banner');
  await h.goToDoc(revisionA?.uid);
  const bannerA = await bannerText(page, 'export-mark-ec2');
  h.check(
    "A's page shows the EC-2 banner, in the kit's words",
    bannerA !== null && bannerA.includes(labels['controlled-documents.banner.exportMarkEc2']),
    String(bannerA),
  );
  await h.screenshot('revision-a-export-mark-banner');

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "a file's download is not run: the kit's stand-in type holds no file. The add-on's own tests " +
      "hold a file refused and served through the platform's download service, and a version's, a " +
      "proxy's and a folder's renditions",
  );
  h.note(
    "the Create form shows the server's refusal: the form makes no check of its own, and the server " +
      'is what refuses, whichever client sends the transmittal',
  );
  h.note(
    'the fence that keeps a change of a mark and a new revision or a transmittal from crossing is ' +
      "held by the add-on's own tests, not by this run",
  );
  h.note(
    `the run leaves its two revisions and its transmittal to ${CLEARED} on the server; the next run ` +
      `trashes this run's drawings, marked "${MARKER}"`,
  );
}
