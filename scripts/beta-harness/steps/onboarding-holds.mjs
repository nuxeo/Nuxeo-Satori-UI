/**
 * The onboarding kit's legal holds and its disputes raised from a case: business apps phase 7's demo
 * step 5, "A legal hold blocks a deletion, on the server" (docs/business-apps/development-plan.md,
 * phase 7, "Demo"), and the case page's New dispute, on the kit in
 * `business-apps/packages/onboarding-demo`, version 0.2.0 or later (its README, "Legal holds on a
 * dispute" and "A dispute raised from its case").
 *
 *   5. A dispute analyst opens DSP-2002, places a legal hold on it from its Legal hold card with a
 *      reason, and is refused, by the server, the dispute's deletion, its trash and a change of its
 *      files, the page saying the server's reason; then releases the hold with a reason, and the
 *      card lists both, with who and why.
 *
 * Then a dispute raised from its case: the analyst opens ONB-1001, chooses New dispute on its
 * Disputes card, finds the case filled in and read-only, saves, and the card lists the new dispute,
 * filed in the disputes register with `dsp:case` the case's id. An onboarding officer is offered no
 * New dispute, and the server refuses a create they send past the page.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit 0.2.0 or later installed on the local Nuxeo, with `nuxeo-agentic-signature`, the
 *   retention module, `nuxeo-retention`, and `nuxeo-agentic-records` 0.4.0, seeded with
 *   `demo/seed.mjs`, and the README's deployment contribution in `nxserver/config/`: the registry
 *   must serve both holds actions.
 * - **The run's own user is a dispute analyst:** `NUXEO_USER` in `dispute-analysts` and not an
 *   administrator. `ONBOARDING_OFFICER` and `ONBOARDING_OFFICER_PASSWORD` sign an onboarding officer
 *   in, in `onboarding-officers` and not `dispute-analysts`, through the REST API and the browser.
 *   The kit creates no user: both are the server's.
 * - The dev server, serving the kit's pages and labels, or none of its labels.
 *
 *   NUXEO_USER=<analyst> NUXEO_PASS=<password> ONBOARDING_OFFICER=<officer> \
 *     ONBOARDING_OFFICER_PASSWORD=<password> npm run beta:evidence -- onboarding-holds
 *
 * Load-bearing checks: the card's hold before and after; the audit's `afterSetLegalHold` and
 * `afterRemoveLegalHold` with the reasons entered; the server refusing the trash, the deletion and
 * a change of the files while the hold is on, and a metadata change going through; the page's
 * toast saying the server's reason; the new dispute's `dsp:case`; the officer's create refused.
 * Negative ones: no Place on a held dispute, no Release on one not held, no New for the officer.
 *
 * Not covered, and said in notes: an administrator's trash, which the records add-on refuses with
 * its own 409 where the platform lets an administrator through (LegalHoldGuardTest), and the hold
 * on a folder holding the dispute, which the same tests hold.
 */
import { basename, dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'onboarding-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { CASES, DISPUTES, REGISTERS, WORKSPACE } = await import(join(KIT, 'demo', 'data.mjs'));

const APP = 'onboarding';
const PLACE = 'onboarding.dispute.placeHold';
const RELEASE = 'onboarding.dispute.releaseHold';
const HELD_MESSAGE = /legal hold/i;

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: ['sana.whitlock'],
    who: 'a dispute analyst, in dispute-analysts, no administrator',
  },
  signsInAs: ['an onboarding officer, ONBOARDING_OFFICER'],
  needs: [
    'the kit 0.2.0 or later installed, with nuxeo-agentic-signature, nuxeo-retention and nuxeo-agentic-records 0.4.0',
    "the kit's deployment contribution, deployment/onboarding-demo-operations-config.xml, in nxserver/config/: the allow-list by which the registry serves Place and Release legal hold",
    "the dev server serving the kit's pages and labels, or none of its labels",
  ],
};

/** The run's mark, in the reasons it enters and the dispute it creates, so they are known again. */
const RUN = `holds-${Date.now().toString(36)}`;

/**
 * As the payers-claims-workflow demo, and the trash the page asks for and the server refuses on
 * purpose, which the browser logs as a failed request.
 */
const ENVIRONMENTAL_ERRORS = [
  '/nuxeo/logout',
  /automation\/AI\./,
  /\/@rendition\/thumbnail$/,
  /automation\/Document\.Trash/,
];

const labels = JSON.parse(readFileSync(join(CONFIG, 'labels/en.json'), 'utf8')).labels;
const unread = () => null;

async function until(probe, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const answer = await probe().catch(unread);
    if (answer || Date.now() >= deadline) return answer;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A request from Node, as `username`, with Basic authentication and no cookie, below `/nuxeo/`. */
async function as(baseUrl, username, password, method, path, json) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'X-No-Basic-Header': 'true',
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
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

const groupsOf = (me) => (me?.extendedGroups ?? []).map((group) => group.name);
const placeOf = (register, number) =>
  `/default-domain/workspaces/${WORKSPACE.name}/${REGISTERS[register].name}/${number.toLowerCase()}`;

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the kit 0.2.0, the records add-on and the allow-list installed');
  const { username, password } = requireStepCredentials(
    'sign the holds demo in as a dispute analyst',
  );
  const asAnalyst = (method, path, json) => as(h.baseUrl, username, password, method, path, json);
  const me = (await asAnalyst('GET', '/api/v1/me')).body;
  h.requirePrecondition(
    'the run signs in as a dispute analyst, no administrator',
    me?.id === username &&
      groupsOf(me).includes('dispute-analysts') &&
      me?.isAdministrator !== true,
    `/me answered ${me?.id} in ${JSON.stringify(groupsOf(me))}: sign in as a dispute analyst`,
  );
  const officer = process.env['ONBOARDING_OFFICER'] ?? '';
  const officerPassword = process.env['ONBOARDING_OFFICER_PASSWORD'] ?? '';
  const asOfficer = (method, path, json) =>
    as(h.baseUrl, officer, officerPassword, method, path, json);
  const theirs = (await asOfficer('GET', '/api/v1/me')).body;
  h.requirePrecondition(
    'ONBOARDING_OFFICER signs an onboarding officer in, not a dispute analyst',
    officer !== '' &&
      theirs?.id === officer &&
      groupsOf(theirs).includes('onboarding-officers') &&
      !groupsOf(theirs).includes('dispute-analysts'),
    `/me as ${officer || '(no ONBOARDING_OFFICER)'} answered ${theirs?.id}`,
  );
  const listing = (await asAnalyst('GET', '/agentic-ui-apps/apps.json')).body;
  const app = (listing?.apps ?? []).find((entry) => entry.id === APP);
  const [major, minor] = String(app?.content?.packageVersion ?? '')
    .split('.')
    .map(Number);
  h.requirePrecondition(
    'the app registry lists the kit 0.2.0 or later to the analyst',
    app !== undefined && (major > 0 || minor >= 2),
    `apps.json lists ${app ? `${APP} ${app.content?.packageVersion}` : `no ${APP}`}`,
  );
  const release = await asAnalyst('GET', '/api/v1/automation/Records.ReleaseLegalHold');
  h.requirePrecondition(
    'the server has Records.ReleaseLegalHold: nuxeo-agentic-records 0.4.0 is installed',
    release.status === 200,
    `GET /automation/Records.ReleaseLegalHold answered ${release.status}`,
  );
  const served = await asAnalyst('GET', `/agentic-ui-apps/apps/${APP}/actions.json`);
  const servedIds = (served.body?.actions ?? []).map((action) => action.id);
  h.requirePrecondition(
    "the server's allow-list lets both holds actions run: the registry serves them",
    served.status === 200 && servedIds.includes(PLACE) && servedIds.includes(RELEASE),
    `actions.json answered ${served.status} with ${JSON.stringify(servedIds)}: put the README's ` +
      'deployment contribution in nxserver/config/, and restart the server',
  );
  const seeded = DISPUTES.find((dispute) => dispute.case);
  const dispute = (await asAnalyst('GET', `/api/v1/path${placeOf('disputes', seeded.number)}`))
    .body;
  h.requirePrecondition(
    `the seeded dispute ${seeded.number} is there, under no legal hold`,
    dispute?.uid !== undefined && dispute?.hasLegalHold === false,
    `${seeded.number}: ${dispute?.uid ? 'held already: release it first' : 'run demo/seed.mjs'}`,
  );
  const kase = (await asAnalyst('GET', `/api/v1/path${placeOf('onboarding', seeded.case)}`)).body;
  h.requirePrecondition(
    `the case it is raised on, ${seeded.case}, is there, and the analyst may read it`,
    kase?.uid !== undefined && dispute.properties?.['dsp:case'] === kase.uid,
    `${seeded.case} answered ${kase?.uid ?? 'nothing'}: run demo/seed.mjs again`,
  );
  const holds = async () =>
    (
      (
        await asAnalyst(
          'GET',
          `/api/v1/id/${dispute.uid}/@audit?pageSize=50&eventId=afterSetLegalHold&eventId=afterRemoveLegalHold`,
        )
      ).body?.entries ?? []
    ).map((entry) => ({ eventId: entry.eventId, comment: String(entry.comment ?? '') }));

  // ── 5. A legal hold blocks a deletion, on the server ───────────────────────────────────────
  await h.step('5. A legal hold blocks a deletion, on the server');
  await h.login();
  await h.goToDoc(dispute.uid);
  const card = page.locator('[data-card-id="holds"]');
  await card.waitFor({ state: 'visible', timeout: 30_000 }).catch(unread);
  const fact = (name) =>
    card
      .locator(`[data-fact="${name}"] dd`)
      .innerText()
      .then((text) => text.trim())
      .catch(() => '');
  h.check('the Legal hold card says the dispute is under no hold', (await fact('hold')) === 'None');
  const place = card.locator(`[data-action="${PLACE}"] button`);
  h.check(
    'it offers Place legal hold, and no Release',
    (await place.count()) === 1 && (await card.locator(`[data-action="${RELEASE}"]`).count()) === 0,
  );
  await place.click();
  const dialog = page.locator('lib-app-action-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(unread);
  const reason = `Chargeback dispute with the card scheme. ${RUN}`;
  await dialog.locator('textarea[data-xpath="var:reason"]').fill(reason);
  await dialog.locator('[data-app-action-run]').click();
  const placed = await page
    .getByText(labels['onboarding.action.placeHold.done'], { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  h.check('the analyst is told the legal hold is placed', placed);
  const held = await until(async () =>
    (await asAnalyst('GET', `/api/v1/id/${dispute.uid}`)).body?.hasLegalHold === true ? true : null,
  );
  h.check('the server holds the dispute', held === true);
  const audited = await until(async () =>
    (await holds()).some(
      (entry) => entry.eventId === 'afterSetLegalHold' && entry.comment === reason,
    )
      ? true
      : null,
  );
  h.check("the platform's audit has the hold placed, with the reason entered", audited === true);
  await page.reload();
  await card.waitFor({ state: 'visible', timeout: 30_000 }).catch(unread);
  h.check('the card says the dispute is on legal hold', (await fact('hold')) === 'On legal hold');
  h.check(
    'the card lists the hold, with its reason',
    (
      await card
        .locator('.record-holds__entry')
        .first()
        .innerText()
        .catch(() => '')
    ).includes(RUN),
  );
  await h.screenshot('dispute-on-legal-hold');

  const trashed = await asAnalyst('POST', '/api/v1/automation/Document.Trash', {
    input: `doc:${dispute.uid}`,
  });
  h.check(
    'the server refuses to put the held dispute in the trash, with its reason',
    (trashed.status === 403 || trashed.status === 409) && typeof trashed.body?.message === 'string',
    `${trashed.status}: ${trashed.body?.message}`,
  );
  const deleted = await asAnalyst('DELETE', `/api/v1/id/${dispute.uid}`);
  h.check(
    'the server refuses to delete it',
    deleted.status === 403 || deleted.status === 409,
    `${deleted.status}: ${deleted.body?.message}`,
  );
  const files = await asAnalyst('PUT', `/api/v1/id/${dispute.uid}`, {
    'entity-type': 'document',
    properties: { 'files:files': [] },
  });
  h.check(
    'the server refuses a change of its files',
    files.status === 403 || files.status === 409,
    `${files.status}: ${files.body?.message}`,
  );
  const described = await asAnalyst('PUT', `/api/v1/id/${dispute.uid}`, {
    'entity-type': 'document',
    properties: { 'dsp:resolution': `Under investigation, hold on. ${RUN}` },
  });
  h.check(
    'a change of its description goes through, as the platform keeps it',
    described.status === 200,
  );
  const still = (await asAnalyst('GET', `/api/v1/id/${dispute.uid}`)).body;
  h.check('the dispute is still there, out of the trash', still?.isTrashed === false);

  await page.reload();
  await page.locator('nxs-document-toolbar').first().waitFor({ timeout: 30_000 }).catch(unread);
  const remove = page.locator('[data-action-id="app.toolbar.delete"]');
  if ((await remove.count()) > 0) {
    await remove.first().click();
    await page
      .getByRole('button', { name: /delete/i })
      .last()
      .click()
      .catch(unread);
    const told = await page
      .getByText(HELD_MESSAGE)
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    h.check("Delete on the page shows the server's reason", told);
  } else {
    h.note('the toolbar offered no Delete: the platform took Remove from the held dispute');
  }

  const releaseButton = card.locator(`[data-action="${RELEASE}"] button`);
  h.check('it offers Release legal hold, and no Place', (await releaseButton.count()) === 1);
  await releaseButton.click();
  await dialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(unread);
  const why = `Settled with the merchant. ${RUN}`;
  await dialog.locator('textarea[data-xpath="var:reason"]').fill(why);
  await dialog.locator('[data-app-action-run]').click();
  const released = await until(async () =>
    (await asAnalyst('GET', `/api/v1/id/${dispute.uid}`)).body?.hasLegalHold === false
      ? true
      : null,
  );
  h.check('the server releases the hold', released === true);
  const releasedAudit = await until(async () =>
    (await holds()).some(
      (entry) => entry.eventId === 'afterRemoveLegalHold' && entry.comment === why,
    )
      ? true
      : null,
  );
  h.check("the platform's audit has the release, with the reason entered", releasedAudit === true);
  await h.screenshot('dispute-hold-released');

  // ── A dispute raised from its case ─────────────────────────────────────────────────────────
  await h.step('A dispute raised from its case: New dispute on the case page');
  await h.goToDoc(kase.uid);
  const disputes = page.locator('[data-card-id="disputes"]');
  await disputes.waitFor({ state: 'visible', timeout: 30_000 }).catch(unread);
  h.check(
    `the case's Disputes card lists ${seeded.number}`,
    (await disputes.innerText().catch(() => '')).includes(seeded.number),
  );
  const create = disputes.locator('[data-record-create] button');
  h.check('it offers New dispute', (await create.count()) === 1);
  await create.click();
  const form = page.locator('lib-record-create-dialog');
  await form.waitFor({ state: 'visible', timeout: 15_000 }).catch(unread);
  h.check(
    'the form shows the case, read-only, by its title',
    (await form.locator('input[data-xpath="dsp:case"]').count()) === 0 &&
      (
        await form
          .locator('[data-xpath="dsp:case"]')
          .innerText()
          .catch(() => '')
      ).includes(CASES.find((each) => each.number === seeded.case).number),
  );
  const number = `DSP-${RUN.slice(-4).toUpperCase()}`;
  await form.locator('input[data-xpath="dc:title"]').fill(`Raised from the case. ${RUN}`);
  await form.locator('input[data-xpath="dsp:number"]').fill(number);
  await form.locator('input[data-xpath="dsp:customer"]').fill(seeded.customer);
  await form.locator('input[data-xpath="dsp:amount"]').fill('42');
  await h.screenshot('new-dispute-form');
  await form.locator('[data-record-create-save] button').click();
  const created = await until(async () => {
    const found = await asAnalyst('POST', '/api/v1/automation/Repository.Query', {
      params: {
        query: `SELECT * FROM DisputeCase WHERE dsp:number = '${number}' AND ecm:isTrashed = 0`,
      },
    });
    return found.body?.entries?.[0] ?? null;
  });
  h.check(
    'the dispute is created in the disputes register, referring to the case',
    created?.properties?.['dsp:case'] === kase.uid &&
      String(created?.path ?? '').startsWith(placeOf('disputes', '').replace(/\/$/, '')),
    `${created?.path}: ${created?.properties?.['dsp:case']}`,
  );

  await h.step('No New dispute for an onboarding officer, and the server refuses theirs');
  const refused = await asOfficer(
    'POST',
    `/api/v1/path${placeOf('disputes', '').replace(/\/$/, '')}`,
    {
      'entity-type': 'document',
      type: 'DisputeCase',
      name: `officer-${RUN}`,
      properties: { 'dc:title': `Not the officer's. ${RUN}`, 'dsp:case': kase.uid },
    },
  );
  h.check(
    'the server refuses an officer the create',
    refused.status === 403 || refused.status === 404,
    String(refused.status),
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  if (created?.uid)
    await asAnalyst('POST', '/api/v1/automation/Document.Trash', { input: `doc:${created.uid}` });
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "not run here: an administrator's trash of a held record, which the platform lets through and " +
      "nuxeo-agentic-records refuses, 409 (LegalHoldGuardTest); nor the officer's page in a browser",
  );
  h.note(
    `the run leaves a hold placed and released on ${seeded.number}, marked "${RUN}", and the ` +
      'dispute it created, in the trash',
  );
}
