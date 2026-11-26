/**
 * The Payers kit's appeal review workflow, `PayersAppealReview`, version 0.7.0's, end to end, on
 * the kit in `business-apps/packages/payers-claims-demo`. Phase 2's "appeals kit"
 * (docs/business-apps/development-plan.md, phase 2, "Builds"): an appeal, a Case of the category
 * `appeal` opened against a denied claim, is reviewed by its specialist in member services, who
 * upholds or overturns the denial. Overturning reopens the claim for a new determination, by
 * starting the claims review on it; upholding leaves it denied. Either decision writes the appeal's
 * decision, `case:decision`, and its checklist's decision letter item, done, by the specialist,
 * today.
 *
 *   1. The review started on a seeded appeal, CASE-2041, in review already: it goes to its
 *      specialist, whose task panel draws the decision's task form from the kit's file; then the
 *      run cancels it, and the appeal is as the seed wrote it. The availability filter refuses a
 *      decided appeal and a grievance.
 *   2. Overturned, in the task form, on an appeal the run writes: the appeal decided, overturned,
 *      its decision letter item added; its claim reopened, in review, with a determination open
 *      for its adjuster; both histories saying so; the appeal gone from the open-appeals queue;
 *      the Case page showing the decision. Then the adjuster determines the claim again, and
 *      approves it. And an appeal against a claim never denied, overturned through the REST API:
 *      decided, and its claim left submitted, with no determination opened, its history saying why.
 *   3. Upheld, in the task form, on a second appeal the run writes: first the server refuses a
 *      decision with no rationale, sent past the form, and opens the decision again; then the
 *      form's field rule stops one; then upheld, the appeal decided with its decision letter
 *      entry ticked where it was, every other entry as it was, and its claim still denied, with
 *      no review started on it.
 *
 * The cases, claims and people it expects are read from the kit's own files: `demo/data.mjs`, and
 * the Case layout's checklist and the stand-in model's open-appeals queue through
 * `demo/appeals.mjs`, as the seed reads them.
 *
 * **It leaves nothing the other Payers steps files count.** Each run writes three claims, as the
 * workflow's adjuster, `WORKFLOW_ADJUSTER`, two denied and one submitted, and three appeals against
 * them, as the specialist,
 * numbered for the run and marked `MARKER` in their description, in the seeded folders: no member
 * and no provider, so neither the Member page's lists nor phase 1's figures hold them, and the
 * claims are the workflow's adjuster's, whom phase 1's demo does not count. By its end each appeal
 * is decided, so the open-appeals queue the appeals demo counts holds none, and each claim is
 * approved, denied or submitted with an adjuster, none of which phase 1's demo counts. On the seeded appeal it starts
 * one review, which writes nothing on the case, and cancels it. A run that stopped part way may
 * leave an appeal open or in review, a claim reopened, or a review running on the seeded appeal,
 * which the appeals demo and phase 1's would then refuse: the next run of this one puts them away
 * first, before it writes its own. Its reviews are cancelled, a reopened claim's determination is
 * denied as the adjuster's, which leaves the claim decided where cancelling its review would leave
 * it in review, and its records are trashed.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, version 0.7.0 or later, and seeded with `demo/seed.mjs`
 *   of that version.
 * - **The run's own user is the appeals' specialist:** `NUXEO_USER` is `APPEALS_SPECIALIST` of
 *   `data.mjs`, in `member-services` and neither claims group, and `NUXEO_PASS` the demo password.
 *   `PAYERS_DEMO_PASSWORD` signs the workflow's adjuster in through the REST API, in
 *   `claims-adjusters` and not `claims-supervisors`, to write the run's claims and determine the
 *   reopened one. The browser is the specialist's throughout.
 * - The dev server with `npm run config:dev` serving the kit's appeal decision task form, its
 *   labels and its Case page (the kit's README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=sam.patel NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-appeal-workflow
 *
 * Load-bearing checks: the review starting on the seeded appeal with its task the specialist's,
 * and the form drawn from the kit's file; the seeded appeal as seeded once the review is cancelled;
 * the overturned appeal decided, `overturned`, with its decision letter entry added, its claim in
 * review, state and status, with a determination open for its adjuster, and the histories' entries,
 * by the specialist, with the rationale; the claim approved by its new determination; the server's
 * refusal of a decision with no rationale, leaving the appeal in review and the decision open again;
 * the form's field rule; the upheld appeal decided, `upheld`, its decision letter entry ticked in
 * place; each appeal in the open-appeals queue while in review and gone once decided; the Case page
 * showing the decision. Negative ones: a decided appeal and a grievance refused a review; nothing
 * written on the seeded appeal; the decision with no rationale deciding nothing, in the form and on
 * the server; the upheld appeal's other checklist entries unchanged and none added; the upheld
 * appeal's claim still denied, and the never-denied one still submitted, each with no
 * determination opened and no "Denial overturned" in its history.
 *
 * Not covered, and said in notes: two reviews running on one appeal, which the filter cannot stop
 * and the decision step's first transition ends; an overturn whose claim was reopened or approved
 * since, which the chain leaves as it does the never-denied one; the server's own install of the
 * task form (the dev server serves it from `config:dev`).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { APPEALS_SPECIALIST, CASES, USERS, WORKFLOW_ADJUSTER } = await import(
  join(KIT, 'demo', 'data.mjs')
);
const { OPEN_APPEALS, checklistOnType, readAppealChecklist } = await import(
  join(KIT, 'demo', 'appeals.mjs')
);

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The people are
 * the ones the preconditions below hold the run to: the adjuster only through the REST API.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [APPEALS_SPECIALIST],
    who: "the appeals' case specialist, in member-services and neither claims group",
  },
  signsInAs: [WORKFLOW_ADJUSTER],
  needs: [
    'the kit 0.7.0 or later installed',
    "the dev server with `npm run config:dev` serving the kit's appeal decision task form, Case page and labels",
  ],
};

/** The route models, and their steps with a task, as the kit's files name them. */
const MODEL = 'PayersAppealReview';
const DECIDE = 'decide';
const CLAIM_MODEL = 'PayersClaimReview';
const DETERMINE = 'determine';
const CASES_FOLDER = '/default-domain/workspaces/payers-demo/cases';
const CLAIMS_FOLDER = '/default-domain/workspaces/payers-demo/claims';
/** How this demo's records are known again: their `dc:description`. Not another file's marker. */
const MARKER = 'Payers kit appeal workflow demo (fictional)';
const TASK_FORM = `tasks/${MODEL}.${DECIDE}.layout.json`;
const CASE_LAYOUT = 'layouts/Case/view.layout.json';

/** The seeded appeal the review starts on, in review, the specialist's; and two it refuses. */
const SEEDED = CASES.find((kase) => kase.number === 'CASE-2041');
const DECIDED = CASES.find((kase) => kase.number === 'CASE-2043');
const GRIEVANCE = CASES.find((kase) => kase.number === 'CASE-2042');

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, which the app's sign-in calls to drop
 * a stale cookie session; `AI.*` operations come from a marketplace package this server may lack;
 * and the shell's recently-viewed list asks for a thumbnail of every document in it, which a record
 * with no file does not have.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const deferred = () => undefined;
const unread = () => null;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;
const CHECKLIST = readAppealChecklist();

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
 * A REST call from Node, as `username`, with Basic authentication and no cookie: the specialist's
 * and the adjuster's channels, which share nothing with the browser's cookie jar.
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

/** A served file as the app reads it: a layout in the servlet's envelope, or as written. */
function unwrap(body) {
  return body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout'
    ? body.content
    : body;
}

/** A checklist entry as the server answers it, its day as the seed writes one. */
const entryOf = (entry) => ({
  item: entry?.item ?? null,
  done: entry?.done ?? null,
  doneBy: entry?.doneBy ?? null,
  doneOn: typeof entry?.doneOn === 'string' ? entry.doneOn.slice(0, 10) : (entry?.doneOn ?? null),
});

/** A day, `YYYY-MM-DD`, in this machine's zone and in UTC: the server's day is one of them. */
const daysOf = (ms) =>
  new Set([
    new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(ms),
    new Date(ms).toISOString().slice(0, 10),
  ]);

/** A day as the `date` widget shows one in the app's locale, en-US: "November 2, 2026". */
const longDay = (day) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** A user as the page names one: their first and last name, as the seed wrote them. */
const nameOf = (username) => {
  const user = USERS.find((each) => each.username === username);
  return user ? `${user.firstName} ${user.lastName}` : username;
};

/** The task form drawn in the task panel, from a layout file of version 2, has settled. */
async function formSettled(page) {
  await page
    .waitForSelector('.nxs-task-detail__form nxs-metadata-editor[data-layout-source="version-2"]', {
      timeout: 30_000,
    })
    .catch(deferred);
}

/** The read-only value a task form shows for a record's property. */
function readOnlyValue(page, xpath) {
  return page
    .locator(
      `.nxs-task-detail__form .nxs-metadata-editor__read-only[data-xpath="${xpath}"] .nxs-metadata-editor__read-only-value`,
    )
    .first()
    .innerText({ timeout: 10_000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(unread);
}

/** Pick `entry` in the task form's vocabulary field for `xpath`. */
async function choose(page, xpath, entry) {
  await page
    .locator(`.nxs-task-detail__form nxs-vocabulary-select[data-xpath="${xpath}"] input`)
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
  await page
    .locator(`mat-option[data-entry="${entry}"]`)
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
}

/** Run the task panel's action labelled `label`. */
async function act(page, label) {
  await page
    .locator('.nxs-task-detail__action', { hasText: label })
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
}

/** The labels of the actions the task panel offers. */
function actionLabels(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.nxs-task-detail__actions .nxs-task-detail__action')].map(
      (button) => button.textContent.trim(),
    ),
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step(
    'Preconditions: the kit 0.7.0 installed and seeded, its task form served, its people',
  );
  const { username: specialist, password: specialistPassword } = requireStepCredentials(
    'sign the appeal workflow demo in as its specialist',
  );
  h.requirePrecondition(
    `the run signs in as the appeals' specialist, ${APPEALS_SPECIALIST}`,
    specialist === APPEALS_SPECIALIST,
    `NUXEO_USER is ${specialist}: set it to ${APPEALS_SPECIALIST}, and NUXEO_PASS to the demo password`,
  );
  const asSpecialist = (method, path, json, headers) =>
    restAs(h.baseUrl, specialist, specialistPassword, method, path, json, headers);
  const me = (await asSpecialist('GET', '/me')).body;
  const myGroups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the specialist, in member-services and neither claims group',
    me?.id === specialist &&
      myGroups.includes('member-services') &&
      !myGroups.includes('claims-adjusters') &&
      !myGroups.includes('claims-supervisors'),
    `/me answered ${me?.id} in ${JSON.stringify(myGroups)}: run demo/seed.mjs first`,
  );
  const demoPassword = process.env['PAYERS_DEMO_PASSWORD'] ?? '';
  h.requirePrecondition(
    'PAYERS_DEMO_PASSWORD is set, for the adjuster',
    demoPassword !== '',
    'export the password the seed gave the demo users as PAYERS_DEMO_PASSWORD',
  );
  const adjuster = WORKFLOW_ADJUSTER;
  const asAdjuster = (method, path, json, headers) =>
    restAs(h.baseUrl, adjuster, demoPassword, method, path, json, headers);
  const adjusterMe = (await asAdjuster('GET', '/me')).body;
  const adjusterGroups = (adjusterMe?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    `${adjuster} signs in with it, in claims-adjusters and not claims-supervisors`,
    adjusterMe?.id === adjuster &&
      adjusterGroups.includes('claims-adjusters') &&
      !adjusterGroups.includes('claims-supervisors'),
    `/me as ${adjuster} answered ${adjusterMe?.id} in ${JSON.stringify(adjusterGroups)}: run ` +
      'demo/seed.mjs with the same PAYERS_DEMO_PASSWORD',
  );

  const variables = await asSpecialist('GET', `/config/schemas/var_${MODEL}_${DECIDE}`);
  const caseType = await asSpecialist('GET', '/config/types/Case');
  h.requirePrecondition(
    "the kit 0.7.0 or later is installed: the appeal decision's variables and case:decision are on the server",
    variables.status === 200 && checklistOnType(caseType.body, 'case:decision'),
    `GET /config/schemas/var_${MODEL}_${DECIDE} answered ${variables.status}, and the Case type ` +
      `${checklistOnType(caseType.body, 'case:decision') ? 'has' : 'has no'} case:decision: install the kit 0.7.0 (README)`,
  );
  const casesFolder = await asSpecialist('GET', `/path${CASES_FOLDER}`, undefined, {
    'enrichers-document': 'permissions',
  });
  const claimsFolder = await asAdjuster('GET', `/path${CLAIMS_FOLDER}`, undefined, {
    'enrichers-document': 'permissions',
  });
  h.requirePrecondition(
    'the seeded folders are there: the specialist may add cases, and the adjuster claims',
    (casesFolder.body?.contextParameters?.permissions ?? []).includes('AddChildren') &&
      (claimsFolder.body?.contextParameters?.permissions ?? []).includes('AddChildren'),
    `GET /path${CASES_FOLDER} answered ${casesFolder.status}, /path${CLAIMS_FOLDER} ` +
      `${claimsFolder.status}: run demo/seed.mjs of 0.7.0 against this server`,
  );

  // What the dev server serves at /agentic-ui-config/ must be the kit's own task form, labels and
  // Case page: they are what the rest of this run asserts the form and the page were drawn from.
  const differing = [];
  for (const path of [TASK_FORM, 'labels/en.json', CASE_LAYOUT]) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const content = answer?.ok() ? unwrap(await answer.json().catch(unread)) : null;
    if (!sameJson(content, kitFile(path))) differing.push(`${path} (${answer?.status()})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's appeal decision task form, its labels and its Case page",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  // ── Set up: an earlier run put away, then the run's claims and appeals ─────────────────────
  await h.step(
    'Set up: three claims, two of them denied, and three open appeals against them, of the run',
  );
  const query = (as, type) =>
    as('POST', '/automation/Repository.Query', {
      params: {
        query:
          `SELECT * FROM Document WHERE ecm:primaryType = '${type}' AND dc:description = ` +
          `'${MARKER}' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0`,
        pageSize: 1000,
      },
    });
  /** The workflows running on a record, as `as` reads them, or `null` when not read. */
  const runningOn = async (as, uid, model) => {
    const answer = await as('GET', `/id/${uid}/@workflow`);
    if (answer.status !== 200 || !Array.isArray(answer.body?.entries)) return null;
    return answer.body.entries.filter(
      (workflow) =>
        workflow.state === 'running' && (!model || workflow.workflowModelName === model),
    );
  };
  /** The tasks open on a record that `as` may read, or `null` when not read. */
  const tasksOn = async (as, uid) => {
    const answer = await as('GET', `/id/${uid}/@task`);
    if (answer.status !== 200 || !Array.isArray(answer.body?.entries)) return null;
    return answer.body.entries.filter((task) => task.state === 'opened');
  };
  const putAway = [];
  const seededDocs = {};
  for (const kase of [SEEDED, DECIDED, GRIEVANCE])
    seededDocs[kase.number] = (
      await asSpecialist('GET', `/path${CASES_FOLDER}/${kase.number.toLowerCase()}`)
    ).body;
  // An earlier run's appeals, and a review it left running on a seeded appeal: cancelled, as the
  // specialist who started them, and the run's own appeals trashed.
  const oldCases = await query(asSpecialist, 'Case');
  for (const doc of [...(oldCases.body?.entries ?? []), ...Object.values(seededDocs)]) {
    if (!doc?.uid) continue;
    const running = await runningOn(asSpecialist, doc.uid, MODEL);
    if (running === null) putAway.push(`${doc.path}'s workflows (not read)`);
    for (const workflow of running ?? []) {
      const cancelled = await asSpecialist('DELETE', `/workflow/${workflow.id}`);
      if (typeof cancelled.status !== 'number' || cancelled.status >= 300)
        putAway.push(`${doc.path}'s workflow ${workflow.id} (${cancelled.status})`);
    }
  }
  for (const doc of oldCases.body?.entries ?? []) {
    const trashed = await asSpecialist('POST', '/automation/Document.Trash', {
      input: `doc:${doc.uid}`,
      params: {},
    });
    if (trashed.status !== 200) putAway.push(`${doc.path} (${trashed.status})`);
  }
  // An earlier run's claims: a reopened one's new determination denied, as the adjuster's own,
  // which leaves it decided, where cancelling its review would leave it in review, which phase 1's
  // demo counts; then trashed.
  const oldClaims = await query(asAdjuster, 'Claim');
  for (const doc of oldClaims.body?.entries ?? []) {
    for (const task of (await tasksOn(asAdjuster, doc.uid)) ?? []) {
      if (task.nodeName !== DETERMINE) continue;
      const denied = await asAdjuster('PUT', `/task/${task.id}/submit`, {
        'entity-type': 'task',
        id: task.id,
        variables: { decision: 'deny', denialReason: 'Put away by the next run (fictional).' },
      });
      if (denied.status !== 200) putAway.push(`${doc.path}'s determination (${denied.status})`);
    }
    const trashed = await asAdjuster('POST', '/automation/Document.Trash', {
      input: `doc:${doc.uid}`,
      params: {},
    });
    if (trashed.status !== 200) putAway.push(`${doc.path} (${trashed.status})`);
  }
  h.requirePrecondition(
    "an earlier run's records are put away: its reviews cancelled, a reopened claim's determination denied, and they trashed",
    oldCases.status === 200 && oldClaims.status === 200 && putAway.length === 0,
    `could not put away ${putAway.join(', ') || `the earlier records (${oldCases.status}, ${oldClaims.status})`}`,
  );
  h.note(
    `${oldCases.body?.entries?.length ?? 0} appeal(s) and ${oldClaims.body?.entries?.length ?? 0} ` +
      'claim(s) of an earlier run were put away',
  );

  // The seeded appeals, as the seed wrote them: what step 1 holds the review to leaving alone.
  const seededAsWritten = (doc, kase) =>
    doc?.type === 'Case' &&
    doc.properties?.['case:number'] === kase.number &&
    doc.properties?.['case:state'] === kase.state &&
    (doc.properties?.['case:decision'] ?? null) === (kase.decision ?? null) &&
    sameJson(
      (doc.properties?.[CHECKLIST.field] ?? []).map(entryOf),
      (kase.checklist ?? []).map(entryOf),
    );
  const readCase = async (uid) => (await asSpecialist('GET', `/id/${uid}`)).body;
  for (const kase of [SEEDED, DECIDED, GRIEVANCE])
    seededDocs[kase.number] = await readCase(seededDocs[kase.number]?.uid ?? '-');
  h.requirePrecondition(
    `the seeded appeals are as the seed wrote them: ${SEEDED.number} in review, ${DECIDED.number} decided, ${GRIEVANCE.number} a grievance`,
    [SEEDED, DECIDED, GRIEVANCE].every((kase) => seededAsWritten(seededDocs[kase.number], kase)) &&
      SEEDED.state === 'inReview' &&
      SEEDED.assignee === specialist,
    'run demo/seed.mjs of 0.7.0 against this server',
  );

  const runId = Date.now().toString(36).toUpperCase();
  const startedAt = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(startedAt);
  const due = new Date(startedAt + 30 * 86_400_000).toISOString().slice(0, 10);
  const appeals = {
    overturned: {
      number: `CASE-AW-${runId}-1`,
      claim: { number: `CLAIM-AW-${runId}-1`, billedAmount: 1840, allowedAmount: 1700 },
      // Only the appeal letter: the decision letter's entry is added.
      checklist: [{ item: 'appealLetter', done: true, doneBy: specialist, doneOn: today }],
      rationale: 'The records show the service was medically necessary (fictional).',
    },
    // Against a claim the adjuster submitted and never denied: overturned, it is left as it is.
    leftAlone: {
      number: `CASE-AW-${runId}-3`,
      claim: { number: `CLAIM-AW-${runId}-3`, billedAmount: 980, keep: 'submitted' },
      checklist: [{ item: 'appealLetter', done: true, doneBy: specialist, doneOn: today }],
      rationale: 'Filed against a claim that was not denied (fictional).',
    },
    upheld: {
      number: `CASE-AW-${runId}-2`,
      claim: { number: `CLAIM-AW-${runId}-2`, billedAmount: 2650 },
      // The decision letter's entry is there, not done, between two others: it is ticked where
      // it is, and the others stay as they are.
      checklist: [
        { item: 'appealLetter', done: true, doneBy: specialist, doneOn: today },
        { item: 'decisionLetter', done: false, doneBy: null, doneOn: null },
        { item: 'reviewerAssigned', done: true, doneBy: specialist, doneOn: today },
      ],
      rationale: 'The plan does not cover the service, as the denial said (fictional).',
    },
  };
  const readClaim = (claim) =>
    asSpecialist('GET', `/id/${claim.uid}`).then(({ body }) => ({
      state: body?.state ?? null,
      status: body?.properties?.['claim:status'] ?? null,
      allowedAmount: body?.properties?.['claim:allowedAmount'] ?? null,
    }));
  for (const [name, appeal] of Object.entries(appeals)) {
    const { claim } = appeal;
    const created = await asAdjuster('POST', `/path${CLAIMS_FOLDER}`, {
      'entity-type': 'document',
      name: claim.number.toLowerCase(),
      type: 'Claim',
      properties: {
        'dc:title': claim.number,
        'dc:description': MARKER,
        'claim:number': claim.number,
        'claim:serviceDate': '2026-10-14',
        'claim:received': '2026-10-20',
        'claim:billedAmount': claim.billedAmount,
        'claim:status': 'submitted',
        'claim:adjuster': adjuster,
        'claim:diagnosis': 'M54.50',
      },
    });
    claim.uid = created.body?.uid ?? null;
    // Denied by the lifecycle, as the adjuster: what an appeal is against. The one left alone stays
    // submitted.
    const wanted = claim.keep ?? 'denied';
    for (const transition of wanted === 'denied' ? ['review', 'deny'] : [])
      if (claim.uid)
        await asAdjuster('POST', '/automation/Document.FollowLifecycleTransition', {
          input: `doc:${claim.uid}`,
          params: { value: transition },
        });
    const denied = claim.uid ? await readClaim(claim) : {};
    h.check(
      `${name}: claim ${claim.number}, billed $${claim.billedAmount}, is created ${wanted}, state and status`,
      created.status === 201 && denied.state === wanted && denied.status === wanted,
      `POST answered ${created.status}; ${JSON.stringify(denied)}`,
    );
    const filed = await asSpecialist('POST', `/path${CASES_FOLDER}`, {
      'entity-type': 'document',
      name: appeal.number.toLowerCase(),
      type: 'Case',
      properties: {
        'dc:title': `Appeal of ${claim.number}`,
        'dc:description': MARKER,
        'case:number': appeal.number,
        'case:category': 'appeal',
        'case:state': 'open',
        'case:claim': claim.uid,
        'case:received': today,
        'case:due': due,
        'case:assignee': specialist,
        'case:summary': `The member appeals the denial of claim ${claim.number} (fictional).`,
        [CHECKLIST.field]: appeal.checklist,
      },
    });
    appeal.uid = filed.body?.uid ?? null;
    h.check(
      `${name}: appeal ${appeal.number}, against it, is created open, as the specialist`,
      filed.status === 201 && filed.body?.properties?.['case:state'] === 'open',
      `POST answered ${filed.status}`,
    );
  }

  /** The case's checklist, state and decision as the server holds them now. */
  const heldCase = async (uid) => {
    const doc = await readCase(uid);
    const held = doc?.properties?.[CHECKLIST.field];
    return {
      state: doc?.properties?.['case:state'] ?? null,
      decision: doc?.properties?.['case:decision'] ?? null,
      checklist: Array.isArray(held) ? held.map(entryOf) : null,
    };
  };
  const taskOn = async (as, uid, step) =>
    ((await tasksOn(as, uid)) ?? []).find((task) => task.nodeName === step) ?? null;
  /** Whether the tasks on a record were read, and none of `step` is open: never a refused read. */
  const noTaskOf = async (as, uid, step) => {
    const tasks = await tasksOn(as, uid);
    return Array.isArray(tasks) && !tasks.some((task) => task.nodeName === step);
  };
  const actorsOf = (task) => (task?.actors ?? []).map((actor) => actor?.id ?? actor);
  /** The case numbers the open-appeals queue holds, as the server answers them, or `null`. */
  const openAppeals = async () => {
    const answer = await asSpecialist(
      'GET',
      `/search/pp/${OPEN_APPEALS}/execute?pageSize=100&currentPageIndex=0`,
    );
    return Array.isArray(answer.body?.entries)
      ? answer.body.entries.map((entry) => entry.properties?.['case:number'])
      : null;
  };
  /** A record's audit entries, newest first, as `as` reads them, or `null` when not read. */
  const historyRead = async (as, uid) => {
    const answer = await as(
      'GET',
      `/id/${uid}/@audit?pageSize=100&sortBy=eventDate&sortOrder=desc`,
    );
    return answer.status === 200 && Array.isArray(answer.body?.entries)
      ? answer.body.entries
      : null;
  };
  const historyOf = async (as, uid) => (await historyRead(as, uid)) ?? [];
  /** Start the review on an appeal, as the specialist, through the REST API. */
  const startReview = (uid) =>
    asSpecialist('POST', `/id/${uid}/@workflow`, {
      'entity-type': 'workflow',
      workflowModelName: MODEL,
      attachedDocumentIds: [uid],
    });

  // ── 1. The review started on a seeded appeal ───────────────────────────────────────────────
  await h.step(
    `1. The appeal review starts on ${SEEDED.number}, for its specialist, and is put away`,
  );
  const seededUid = seededDocs[SEEDED.number].uid;
  const seededStart = await startReview(seededUid);
  const seededWorkflow = seededStart.body?.id ?? null;
  h.check(
    `the ${MODEL} workflow starts on ${SEEDED.number}, in review already`,
    seededStart.status === 201 && seededStart.body?.workflowModelName === MODEL,
    `POST @workflow answered ${seededStart.status}, ${seededStart.body?.workflowModelName}`,
  );
  const seededTask = await until(() => taskOn(asSpecialist, seededUid, DECIDE));
  h.check(
    `its decision is open, for its specialist, user:${specialist}`,
    seededTask !== null && actorsOf(seededTask).includes(`user:${specialist}`),
    JSON.stringify({ id: seededTask?.id ?? null, actors: actorsOf(seededTask) }),
  );
  h.check(
    `the start writes nothing on ${SEEDED.number}: still in review, with its checklist and no decision`,
    seededAsWritten(await readCase(seededUid), SEEDED),
    JSON.stringify(await heldCase(seededUid)),
  );
  await h.login();
  await h.goTo(`/#/tasks/${seededTask?.id}`);
  await formSettled(page);
  h.check(
    "the task panel draws the decision's form from the kit's file, a layout of version 2",
    (await page
      .locator('.nxs-task-detail__form nxs-metadata-editor[data-layout-source="version-2"]')
      .count()
      .catch(() => 0)) === 1,
  );
  h.check(
    "the appeal's number shows read-only in the form",
    (await readOnlyValue(page, 'case:number')) === SEEDED.number,
    await readOnlyValue(page, 'case:number'),
  );
  const fieldsDrawn = await page
    .evaluate(() => ({
      decision:
        document.querySelector(
          '.nxs-task-detail__form nxs-vocabulary-select[data-xpath="var:decision"]',
        ) !== null,
      rationale:
        document.querySelector('.nxs-task-detail__form textarea[data-xpath="var:rationale"]') !==
        null,
    }))
    .catch(unread);
  const offered = await actionLabels(page).catch(unread);
  h.check(
    "the form asks for the decision, from its vocabulary, and the rationale; the panel offers the step's Submit",
    fieldsDrawn?.decision === true &&
      fieldsDrawn?.rationale === true &&
      Array.isArray(offered) &&
      offered.some((label) => /^submit$/i.test(label)),
    JSON.stringify({ fieldsDrawn, offered }),
  );
  await h.screenshot('appeal-decision-form');
  // Put away: the specialist, who started it, cancels it, and the seeded appeal is as it was.
  const cancelled = await asSpecialist('DELETE', `/workflow/${seededWorkflow}`);
  const afterCancel = await asSpecialist('GET', `/workflow/${seededWorkflow}`);
  h.check(
    'the specialist cancels the review, and no decision is left open on the appeal',
    typeof cancelled.status === 'number' &&
      cancelled.status < 300 &&
      afterCancel.body?.state === 'canceled' &&
      (await noTaskOf(asSpecialist, seededUid, DECIDE)),
    `DELETE answered ${cancelled.status}; the workflow is ${afterCancel.body?.state}`,
  );
  h.check(
    `${SEEDED.number} is as the seed wrote it`,
    seededAsWritten(await readCase(seededUid), SEEDED),
    JSON.stringify(await heldCase(seededUid)),
  );
  // The availability filter: no review on an appeal decided, nor on a grievance.
  for (const kase of [DECIDED, GRIEVANCE]) {
    const uid = seededDocs[kase.number].uid;
    const refused = await startReview(uid);
    const running = await runningOn(asSpecialist, uid, MODEL);
    h.check(
      `the review is refused on ${kase.number}, ${kase.category === 'appeal' ? `an appeal ${kase.state}` : 'a grievance'}: none starts`,
      refused.status !== 201 && Array.isArray(running) && running.length === 0,
      `POST @workflow answered ${refused.status}; running ${JSON.stringify(running)}`,
    );
  }

  // ── 2. Overturned ──────────────────────────────────────────────────────────────────────────
  await h.step('2. An appeal overturned in its task form: decided, and its claim reopened');
  const over = appeals.overturned;
  const overStart = await startReview(over.uid);
  over.workflow = overStart.body?.id ?? null;
  const overTask = await until(() => taskOn(asSpecialist, over.uid, DECIDE));
  const overInReview = await heldCase(over.uid);
  h.check(
    `the review starts on ${over.number}, open: it is put in review, and its decision is the specialist's`,
    overStart.status === 201 &&
      overInReview.state === 'inReview' &&
      overTask !== null &&
      actorsOf(overTask).includes(`user:${specialist}`),
    JSON.stringify({ answered: overStart.status, case: overInReview, task: overTask?.id ?? null }),
  );
  const queuedWhileInReview = await until(async () => {
    const rows = await openAppeals();
    return rows?.includes(over.number) ? rows : null;
  });
  h.check(
    `while in review, ${over.number} is in the open-appeals queue, ${OPEN_APPEALS}`,
    Array.isArray(queuedWhileInReview),
    JSON.stringify(await openAppeals()),
  );
  await h.goTo(`/#/tasks/${overTask?.id}`);
  await formSettled(page);
  await choose(page, 'var:decision', 'overturn');
  await page
    .locator('.nxs-task-detail__form textarea[data-xpath="var:rationale"]')
    .fill(over.rationale, { timeout: 10_000 })
    .catch(deferred);
  await h.screenshot('appeal-overturn');
  await act(page, 'Submit');
  const overDecided = await until(async () => {
    const now = await heldCase(over.uid);
    return now.state === 'decided' ? now : null;
  });
  h.check(
    'the appeal is decided, overturned: case:state decided, case:decision overturned',
    overDecided?.decision === 'overturned',
    JSON.stringify(overDecided ?? (await heldCase(over.uid))),
  );
  const overLetter = overDecided?.checklist?.at(-1);
  h.check(
    `its decision letter item is added, done, by ${specialist}, today, after the entry it had, which is unchanged`,
    overDecided?.checklist?.length === over.checklist.length + 1 &&
      sameJson(overDecided.checklist.slice(0, -1), over.checklist.map(entryOf)) &&
      overLetter?.item === 'decisionLetter' &&
      overLetter?.done === true &&
      overLetter?.doneBy === specialist &&
      new Set([...daysOf(startedAt), ...daysOf(Date.now())]).has(overLetter?.doneOn),
    JSON.stringify(overDecided?.checklist ?? null),
  );
  const overWorkflow = await asSpecialist('GET', `/workflow/${over.workflow}`);
  h.check(
    'the review is done, and no decision is left open on the appeal',
    overWorkflow.body?.state === 'done' && (await noTaskOf(asSpecialist, over.uid, DECIDE)),
    `the workflow is ${overWorkflow.body?.state}`,
  );
  const overHistory = await until(async () => {
    const entries = await historyOf(asSpecialist, over.uid);
    return entries.some((entry) => entry.eventId === 'Appeal overturned') ? entries : null;
  });
  h.check(
    `the appeal's history says who overturned it and why: "${specialist} overturned the denial: ${over.rationale}"`,
    (overHistory ?? []).some(
      (entry) =>
        entry.eventId === 'Appeal overturned' &&
        entry.comment === `${specialist} overturned the denial: ${over.rationale}`,
    ) && (overHistory ?? []).some((entry) => entry.eventId === 'Appeal review started'),
    JSON.stringify((overHistory ?? []).map((entry) => [entry.eventId, entry.comment ?? null])),
  );
  const reopened = await until(async () => {
    const now = await readClaim(over.claim);
    return now.state === 'inReview' ? now : null;
  });
  h.check(
    `its claim, ${over.claim.number}, is reopened: in review, its lifecycle state and claim:status both`,
    reopened?.status === 'inReview',
    JSON.stringify(reopened ?? (await readClaim(over.claim))),
  );
  // Read as its adjuster, the task's actor: the claims review the chain started, as the system, is
  // the one whose determination this is.
  const newDetermination = await until(() => taskOn(asAdjuster, over.claim.uid, DETERMINE));
  h.check(
    `for a new determination: the ${CLAIM_MODEL} workflow's determination is open on it, for its adjuster, user:${adjuster}`,
    newDetermination !== null &&
      newDetermination.workflowModelName === CLAIM_MODEL &&
      actorsOf(newDetermination).includes(`user:${adjuster}`),
    JSON.stringify({
      task: newDetermination?.id ?? null,
      model: newDetermination?.workflowModelName ?? null,
      actors: actorsOf(newDetermination),
    }),
  );
  const claimHistory = await until(async () => {
    const entries = await historyOf(asAdjuster, over.claim.uid);
    return entries.some((entry) => entry.eventId === 'Claim reopened') ? entries : null;
  });
  h.check(
    `the claim's history says so: "Denial overturned" on appeal ${over.number}, by ${specialist}, and "Claim reopened"`,
    (claimHistory ?? []).some(
      (entry) =>
        entry.eventId === 'Denial overturned' &&
        entry.comment ===
          `${specialist} overturned the denial on appeal ${over.number}. The claim is reopened for a new determination.`,
    ) && (claimHistory ?? []).some((entry) => entry.eventId === 'Claim reopened'),
    JSON.stringify((claimHistory ?? []).map((entry) => [entry.eventId, entry.comment ?? null])),
  );
  const queuedOnceDecided = await until(async () => {
    const rows = await openAppeals();
    return Array.isArray(rows) && !rows.includes(over.number) ? rows : null;
  });
  h.check(
    `decided, ${over.number} leaves the open-appeals queue`,
    Array.isArray(queuedOnceDecided),
    JSON.stringify(await openAppeals()),
  );
  // The Case page: the decision, by the layout's status badge, and the decision letter's row.
  await h.goToDoc(over.uid);
  await page
    .waitForFunction(
      () =>
        document.querySelector('.record-page__card [data-field="case:decision"] dd') !== null &&
        [...document.querySelectorAll('.record-page__checklist-by')].every(
          (by) => !/\./.test(by.textContent ?? ''),
        ),
      undefined,
      { timeout: 30_000 },
    )
    .catch(deferred);
  const casePage = await page
    .evaluate(() => {
      const row = document.querySelector(
        '.record-page__card[data-card-id="checklist"] .record-page__checklist-item[data-item="decisionLetter"]',
      );
      return {
        decision:
          document
            .querySelector('.record-page__card [data-field="case:decision"] dd')
            ?.textContent?.trim() ?? null,
        letter: row
          ? {
              done: row.getAttribute('data-done'),
              by: row.querySelector('.record-page__checklist-by')?.textContent?.trim() ?? null,
              on: row.querySelector('.record-page__checklist-on')?.textContent?.trim() ?? null,
            }
          : null,
      };
    })
    .catch(unread);
  h.check(
    `the Case page shows the decision, overturned, and the decision letter sent, by ${nameOf(specialist)}, on ${overLetter?.doneOn ? longDay(overLetter.doneOn) : '?'}`,
    /overturned/i.test(casePage?.decision ?? '') &&
      casePage?.letter?.done === 'true' &&
      casePage?.letter?.by === nameOf(specialist) &&
      casePage?.letter?.on === (overLetter?.doneOn ? longDay(overLetter.doneOn) : null),
    JSON.stringify(casePage),
  );
  await h.screenshot('appeal-overturned', page.locator('.record-page__card').first());
  // The new determination, the adjuster's, through the REST API: approved, so that no claim of
  // the run is left in review.
  const approved = await asAdjuster('PUT', `/task/${newDetermination?.id}/submit`, {
    'entity-type': 'task',
    id: newDetermination?.id,
    variables: { decision: 'approve', allowedAmount: over.claim.allowedAmount },
  });
  const approvedClaim = await until(async () => {
    const now = await readClaim(over.claim);
    return now.state === 'approved' ? now : null;
  });
  h.check(
    `the adjuster's new determination approves the reopened claim: approved, state and status, with $${over.claim.allowedAmount} allowed`,
    approved.status === 200 &&
      approvedClaim?.status === 'approved' &&
      Number(approvedClaim?.allowedAmount) === over.claim.allowedAmount,
    JSON.stringify({ answered: approved.status, claim: approvedClaim }),
  );
  // An appeal against a claim that is not denied, overturned through the REST API: decided, and
  // the claim left as it is, with no review started on it, which on a submitted claim would be an
  // ordinary one, and its history saying why.
  const alone = appeals.leftAlone;
  const aloneStart = await startReview(alone.uid);
  const aloneTask = await until(() => taskOn(asSpecialist, alone.uid, DECIDE));
  const aloneAnswer = await asSpecialist('PUT', `/task/${aloneTask?.id}/submit`, {
    'entity-type': 'task',
    id: aloneTask?.id,
    variables: { decision: 'overturn', rationale: alone.rationale },
  });
  const aloneCase = await until(async () => {
    const now = await heldCase(alone.uid);
    return now.state === 'decided' ? now : null;
  });
  const aloneHistory = await until(async () => {
    const entries = await historyRead(asAdjuster, alone.claim.uid);
    return entries?.some((entry) => entry.eventId === 'Appeal overturned, claim not reopened')
      ? entries
      : null;
  });
  const aloneClaim = await readClaim(alone.claim);
  h.check(
    `an appeal against ${alone.claim.number}, never denied, overturned through the REST API: decided, overturned, and the claim left submitted, with no determination opened on it`,
    aloneStart.status === 201 &&
      aloneAnswer.status === 200 &&
      aloneCase?.decision === 'overturned' &&
      aloneClaim.state === 'submitted' &&
      aloneClaim.status === 'submitted' &&
      (await noTaskOf(asAdjuster, alone.claim.uid, DETERMINE)),
    JSON.stringify({
      answered: [aloneStart.status, aloneAnswer.status],
      case: aloneCase,
      claim: aloneClaim,
    }),
  );
  h.check(
    `its history says why: "Appeal overturned, claim not reopened", and no "Denial overturned"`,
    Array.isArray(aloneHistory) &&
      aloneHistory.some(
        (entry) =>
          entry.eventId === 'Appeal overturned, claim not reopened' &&
          entry.comment ===
            `${specialist} overturned a denial on appeal ${alone.number}. The claim is not denied, so it is not reopened.`,
      ) &&
      !aloneHistory.some((entry) => entry.eventId === 'Denial overturned'),
    JSON.stringify((aloneHistory ?? []).map((entry) => [entry.eventId, entry.comment ?? null])),
  );

  // ── 3. Upheld ──────────────────────────────────────────────────────────────────────────────
  await h.step(
    '3. An appeal upheld: refused with no rationale, then decided, its claim left denied',
  );
  const kept = appeals.upheld;
  const keptStart = await startReview(kept.uid);
  kept.workflow = keptStart.body?.id ?? null;
  const keptTask = await until(() => taskOn(asSpecialist, kept.uid, DECIDE));
  h.check(
    `the review starts on ${kept.number}, its decision the specialist's`,
    keptStart.status === 201 && keptTask !== null,
    JSON.stringify({ answered: keptStart.status, task: keptTask?.id ?? null }),
  );
  // The server's side first, past the form: a decision with no rationale.
  const bare = await asSpecialist('PUT', `/task/${keptTask?.id}/submit`, {
    'entity-type': 'task',
    id: keptTask?.id,
    variables: { decision: 'uphold' },
  });
  const reopenedDecision = await until(async () => {
    const task = await taskOn(asSpecialist, kept.uid, DECIDE);
    return task && task.id !== keptTask?.id ? task : null;
  });
  const keptAfterBare = await heldCase(kept.uid);
  const refusal = await until(async () =>
    (await historyOf(asSpecialist, kept.uid)).find(
      (entry) =>
        entry.eventId === 'Appeal decision refused' &&
        /A decision needs its rationale/.test(entry.comment ?? ''),
    ),
  );
  h.check(
    'the server refuses a decision with no rationale: the appeal still in review, with no decision, and its decision open again, as a new task',
    keptAfterBare.state === 'inReview' &&
      keptAfterBare.decision === null &&
      reopenedDecision !== null,
    `PUT answered ${bare.status}; ${JSON.stringify(keptAfterBare)}`,
  );
  h.check(
    'the refusal is the rationale\'s: "A decision needs its rationale" in the appeal\'s history',
    Boolean(refusal),
    JSON.stringify(refusal ?? null),
  );
  h.note(
    `the server's answer to a decision with no rationale: HTTP ${bare.status}. It refuses it by its ` +
      'route model, not by an error: the first transition that holds opens the decision again',
  );
  // Then the form's field rule.
  await h.goTo(`/#/tasks/${reopenedDecision?.id}`);
  await formSettled(page);
  await choose(page, 'var:decision', 'uphold');
  await act(page, 'Submit');
  const requiredText = `${labels['payers.task.rationale']} is required.`;
  const rationale = page.locator('.nxs-task-detail__form textarea[data-xpath="var:rationale"]');
  await page
    .waitForFunction((text) => document.body.innerText.includes(text), requiredText, {
      timeout: 10_000,
    })
    .catch(deferred);
  h.check(
    `the field rule stops it: "${requiredText}" beside the rationale, which is marked invalid`,
    (await page.evaluate((text) => document.body.innerText.includes(text), requiredText)) &&
      (await rationale.getAttribute('data-nxs-invalid').catch(unread)) === 'true',
  );
  await h.screenshot('appeal-decision-without-rationale-refused');
  const stillOpen = await asSpecialist('GET', `/task/${reopenedDecision?.id}`);
  h.check(
    'nothing was sent: the decision is still open, and the appeal still in review',
    stillOpen.body?.state === 'opened' && (await heldCase(kept.uid)).state === 'inReview',
    JSON.stringify({ task: stillOpen.body?.state, case: await heldCase(kept.uid) }),
  );
  await rationale.fill(kept.rationale, { timeout: 10_000 }).catch(deferred);
  await act(page, 'Submit');
  const keptDecided = await until(async () => {
    const now = await heldCase(kept.uid);
    return now.state === 'decided' ? now : null;
  });
  h.check(
    'the appeal is decided, upheld: case:state decided, case:decision upheld',
    keptDecided?.decision === 'upheld',
    JSON.stringify(keptDecided ?? (await heldCase(kept.uid))),
  );
  const keptLetter = keptDecided?.checklist?.[1];
  h.check(
    `its decision letter entry is ticked where it was, done, by ${specialist}, today; the entries around it are unchanged, and none is added`,
    keptDecided?.checklist?.length === kept.checklist.length &&
      sameJson(keptDecided.checklist[0], entryOf(kept.checklist[0])) &&
      sameJson(keptDecided.checklist[2], entryOf(kept.checklist[2])) &&
      keptLetter?.item === 'decisionLetter' &&
      keptLetter?.done === true &&
      keptLetter?.doneBy === specialist &&
      new Set([...daysOf(startedAt), ...daysOf(Date.now())]).has(keptLetter?.doneOn),
    JSON.stringify(keptDecided?.checklist ?? null),
  );
  const keptHistory = await until(async () => {
    const entries = await historyOf(asSpecialist, kept.uid);
    return entries.some((entry) => entry.eventId === 'Appeal upheld') ? entries : null;
  });
  h.check(
    `the appeal's history says who upheld it and why: "${specialist} upheld the denial: ${kept.rationale}"`,
    (keptHistory ?? []).some(
      (entry) =>
        entry.eventId === 'Appeal upheld' &&
        entry.comment === `${specialist} upheld the denial: ${kept.rationale}`,
    ),
    JSON.stringify((keptHistory ?? []).map((entry) => [entry.eventId, entry.comment ?? null])),
  );
  const keptClaim = await readClaim(kept.claim);
  const keptClaimUntouched = await noTaskOf(asAdjuster, kept.claim.uid, DETERMINE);
  const keptClaimHistory = await historyRead(asAdjuster, kept.claim.uid);
  h.check(
    `its claim, ${kept.claim.number}, is left denied, with no determination opened on it and no "Denial overturned" in its history`,
    keptClaim.state === 'denied' &&
      keptClaim.status === 'denied' &&
      keptClaimUntouched &&
      Array.isArray(keptClaimHistory) &&
      !keptClaimHistory.some((entry) => entry.eventId === 'Denial overturned'),
    JSON.stringify({ claim: keptClaim, noDetermination: keptClaimUntouched }),
  );
  const keptWorkflow = await asSpecialist('GET', `/workflow/${kept.workflow}`);
  const keptGone = await until(async () => {
    const rows = await openAppeals();
    return Array.isArray(rows) && !rows.includes(kept.number) ? rows : null;
  });
  h.check(
    `the review is done, and ${kept.number}, decided, is not in the open-appeals queue`,
    keptWorkflow.body?.state === 'done' && Array.isArray(keptGone),
    JSON.stringify({ workflow: keptWorkflow.body?.state, queue: await openAppeals() }),
  );
  await h.goToDoc(kept.uid);
  await page
    .waitForSelector('.record-page__card [data-field="case:decision"] dd', { timeout: 30_000 })
    .catch(deferred);
  const shownDecision = await page
    .locator('.record-page__card [data-field="case:decision"] dd')
    .first()
    .innerText({ timeout: 10_000 })
    .catch(unread);
  h.check(
    "the Case page shows the decision, upheld, through the Case layout's status badge",
    /upheld/i.test(shownDecision ?? ''),
    String(shownDecision),
  );
  await h.screenshot('appeal-upheld', page.locator('.record-page__card').first());

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    'not run: two reviews on one appeal, which its availability filter cannot stop; the first ' +
      "to decide decides it, and the other's decision ends it with nothing written",
  );
  h.note(
    'not run: an overturned appeal whose claim was reopened since, or approved, which is left as ' +
      'it is, as the one never denied is here: the platform check holds the chain to that',
  );
  h.note(
    "the server's own install is not what the app read: under the dev server the task form and " +
      'the Case page come from config:dev',
  );
  h.note(
    `the run's records stay on the server, the appeals decided and the claims approved or denied, ` +
      `marked "${MARKER}": the next run trashes them`,
  );
}
