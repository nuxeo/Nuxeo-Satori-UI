/**
 * The Payers kit's operation buttons: business apps phase 2's demo step 4, "Request medical records"
 * runs a server chain (docs/business-apps/development-plan.md, phase 2, "Demo"), on the kit in
 * `business-apps/packages/payers-claims-demo`, version 0.5.0 or later, with the demo server's
 * allow-list installed (the kit's README, "The operation buttons").
 *
 *   4. An adjuster opens a claim in review, chooses Request medical records on its toolbar, fills in
 *      the button's form, confirms, and is told the records are requested; the chain has written the
 *      request to the claim's history, and `AgenticUi.RunAction` its own entry beside it.
 *
 * Then, past the app, as a hand-crafted request would go:
 *
 * - **the app registry refuses an unlisted chain:** the kit's `actions.json` names a second button,
 *   Refer to special investigations, whose chain the demo server's allow-list leaves out on purpose.
 *   The registry serves the file without it, and its diagnostics say why;
 * - **the endpoint refuses it too:** `AgenticUi.RunAction` asked for that action answers 404; and
 *   asked for Request medical records with a value its form does not send, 400, with a note longer
 *   than the allow-list's or with none, 400, by someone the allow-list's groups leave out, 403, and
 *   on a paid claim, a state the allow-list does not name, 403, whatever the button's rule;
 * - **Nuxeo's own Automation endpoint runs neither chain:** a direct call, and one through the
 *   `RunOperation` dispatcher, which no REST binding on a chain would stop, are refused by each
 *   chain's first step, `AgenticUi.RequireRunAction`. None of the ten refused requests writes to
 *   the claim's history.
 *
 * Each run writes two entries to the history of one seeded claim, the chain's marked by the run's id, and
 * changes nothing else: phase 1's and the workflow demo's figures do not read the history.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit 0.5.0 or later installed on the local Nuxeo and seeded with `demo/seed.mjs`, with
 *   `nuxeo-agentic-ui` from this branch or later, and the README's deployment contribution in
 *   `nxserver/config/`: the registry must serve Request medical records.
 * - **The run's own user is an adjuster:** `NUXEO_USER` is `dana.lee`, in `claims-adjusters` and not
 *   `claims-supervisors`, and `NUXEO_PASS` the demo password. `PAYERS_DEMO_PASSWORD` signs
 *   `riley.brooks` in, member services, for the group refusal, through the REST API alone.
 * - The dev server, serving the kit's Claim page and labels, or none of its labels, which the app
 *   registry then serves (the kit's README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-operations
 *
 * Load-bearing checks: the toolbar offering the button on a claim in review; its dialog asking the
 * kit's question with the form's two fields; the success message; the chain's and the endpoint's
 * entries in the claim's history, with the note entered and the run's marker. Negative ones: the
 * registry leaving the unlisted chain's button out, with a diagnostic; the endpoint's six
 * refusals; Nuxeo's own endpoint and `RunOperation` refusing both chains; nothing written by any of
 * them; and, in the browser, no button on a claim no longer in review.
 *
 * Not covered, and said in notes: a row action on a queue (the kit's my-claims queue offers it, and
 * the client's specs run it), an administrator calling the chain directly, which the same first
 * step refuses (AppActionRunnerTest), and the chain's effect outside the server, which is fictional.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { CLAIMS, USERS } = await import(join(KIT, 'demo', 'data.mjs'));

const APP = 'payers-claims';
const REQUEST = 'payers.claim.requestRecords';
const REFER = 'payers.claim.referToInvestigations';
const REQUEST_CHAIN = 'Payers.RequestMedicalRecords';
const REFER_CHAIN = 'Payers.ReferToInvestigations';
const RUN_ACTION = 'AgenticUi.RunAction';
const ADJUSTER = 'dana.lee';
const MEMBER_SERVICES = 'riley.brooks';

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The people are
 * the ones the preconditions below hold the run to: member services is signed in through the REST
 * API alone, for the group refusal. The allow-list is the deployment's, not the kit's.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [ADJUSTER], who: 'an adjuster, in claims-adjusters and not claims-supervisors' },
  signsInAs: [MEMBER_SERVICES],
  needs: [
    'the kit 0.5.0 or later installed, with nuxeo-agentic-ui from the same candidate',
    "the kit's deployment contribution, deployment/payers-claims-demo-operations-config.xml, in nxserver/config/: the allow-list by which the registry serves Request medical records",
    "the dev server serving the kit's Claim page and labels, or none of its labels",
  ],
};
/** The run's mark, in the note it enters, so that its history entries are known again. */
const RUN = `ops-${Date.now().toString(36)}`;

/** As the payers-claims-workflow demo: not the kit's. */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;
const kitActions = kitFile('actions.json').actions;
const unread = () => null;

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
 * A request from Node, as `username`, with Basic authentication and no cookie: below `/nuxeo/`, the
 * REST API's or the app registry's. Not page.request, which shares the browser's cookie jar.
 */
async function as(baseUrl, username, password, method, path, json) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'X-No-Basic-Header': 'true',
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

/** `AgenticUi.RunAction`, as the app sends it, for `action` on `uid`, with `values`. */
const runAction = (action, uid, values) => ({
  input: `doc:${uid}`,
  params: { app: APP, action, values: JSON.stringify(values) },
  context: {},
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the kit 0.5.0 and its allow-list installed, a claim in review');
  const { username, password } = requireStepCredentials(
    'sign the operations demo in as an adjuster',
  );
  h.requirePrecondition(
    `the run signs in as the adjuster ${ADJUSTER}`,
    username === ADJUSTER,
    `NUXEO_USER is ${username}: set it to ${ADJUSTER}, and NUXEO_PASS to the demo password`,
  );
  const asAdjuster = (method, path, json) => as(h.baseUrl, username, password, method, path, json);
  const me = (await asAdjuster('GET', '/api/v1/me')).body;
  const groups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the adjuster, in claims-adjusters and not claims-supervisors',
    me?.id === ADJUSTER &&
      groups.includes('claims-adjusters') &&
      !groups.includes('claims-supervisors'),
    `/me answered ${me?.id} in ${JSON.stringify(groups)}: run demo/seed.mjs first`,
  );
  const demoPassword = process.env['PAYERS_DEMO_PASSWORD'] ?? '';
  const asMemberServices = (method, path, json) =>
    as(h.baseUrl, MEMBER_SERVICES, demoPassword, method, path, json);
  const theirs = (await asMemberServices('GET', '/api/v1/me')).body;
  const theirGroups = (theirs?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    `PAYERS_DEMO_PASSWORD signs ${MEMBER_SERVICES} in, in member-services and not claims-adjusters`,
    demoPassword !== '' &&
      theirs?.id === MEMBER_SERVICES &&
      theirGroups.includes('member-services') &&
      !theirGroups.includes('claims-adjusters') &&
      USERS.some((user) => user.username === MEMBER_SERVICES),
    `/me as ${MEMBER_SERVICES} answered ${theirs?.id}: export the seed's demo password as PAYERS_DEMO_PASSWORD`,
  );

  const listing = (await asAdjuster('GET', '/agentic-ui-apps/apps.json')).body;
  const app = (listing?.apps ?? []).find((entry) => entry.id === APP);
  const version = app?.content?.packageVersion ?? '';
  const [major, minor] = version.split('.').map(Number);
  h.requirePrecondition(
    'the app registry lists the kit 0.5.0 or later to the adjuster',
    app !== undefined && (major > 0 || minor >= 5),
    `apps.json lists ${app ? `${APP} ${version}` : `no ${APP}`}: install the kit 0.5.0 (README)`,
  );
  const served = await asAdjuster('GET', `/agentic-ui-apps/apps/${APP}/actions.json`);
  const servedIds = (served.body?.actions ?? []).map((action) => action.id);
  h.requirePrecondition(
    "the server's allow-list lets Request medical records run: the registry serves it",
    served.status === 200 && servedIds.includes(REQUEST),
    `actions.json answered ${served.status} with ${JSON.stringify(servedIds)}: put the README's ` +
      'deployment contribution in nxserver/config/, and restart the server',
  );

  const seeded = CLAIMS.find((claim) => claim.adjuster === ADJUSTER && claim.status === 'inReview');
  const found = await asAdjuster('POST', '/api/v1/automation/Repository.Query', {
    params: {
      query:
        "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND " +
        `claim:number = '${seeded.number}' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0`,
    },
  });
  const claim = found.body?.entries?.[0];
  h.requirePrecondition(
    `the seeded claim ${seeded.number} is there, in review, and the adjuster may change it`,
    claim?.uid !== undefined && claim?.state === 'inReview',
    `${seeded.number} answered ${found.status}, in ${claim?.state}: run demo/seed.mjs again`,
  );
  const history = async () =>
    (
      (await asAdjuster('GET', `/api/v1/id/${claim.uid}/@audit?pageSize=100`)).body?.entries ?? []
    ).map((entry) => ({ ...entry, comment: String(entry.comment ?? '') }));

  const decided = CLAIMS.find((entry) => entry.adjuster === ADJUSTER && entry.status === 'paid');
  const paid = (
    await asAdjuster('POST', '/api/v1/automation/Repository.Query', {
      params: {
        query:
          "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND " +
          `claim:number = '${decided.number}' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0`,
      },
    })
  ).body?.entries?.[0];
  h.requirePrecondition(
    `the seeded claim ${decided.number} is there, paid`,
    paid?.uid !== undefined && paid?.state === 'paid',
    `${decided.number} answered ${paid?.state}: run demo/seed.mjs again`,
  );

  // The labels the button is drawn with: the dev server's, when it serves the kit's, else the
  // registry's, which are the package's.
  const devLabels = await page.request
    .get(`${h.baseUrl}/agentic-ui-config/labels/en.json`)
    .catch(unread);
  const devServes = devLabels?.ok() === true;
  const devContent = devServes ? await devLabels.json().catch(unread) : null;
  h.requirePrecondition(
    "the dev server serves the kit's labels, or none, for the registry to serve them",
    !devServes || JSON.stringify(devContent?.labels) === JSON.stringify(labels),
    "the dev server serves other labels: run the README's config:dev command, then restart it",
  );

  // ── 4. Request medical records runs a server chain ─────────────────────────────────────────
  await h.step('4. "Request medical records" runs a server chain');
  await h.login();
  await h.goToDoc(claim.uid);
  const name = labels['payers.action.requestRecords'];
  const button = page.locator(`[data-action-id="${REQUEST}"]`);
  await button.waitFor({ state: 'visible', timeout: 30_000 }).catch(unread);
  h.check(
    'the claim in review offers Request medical records on its toolbar',
    (await button.count()) === 1 && (await button.innerText().catch(() => '')).includes(name),
    `${await button.count()} buttons, named ${JSON.stringify(await button.innerText().catch(() => ''))}`,
  );
  h.check(
    "the toolbar does not offer Refer to special investigations, which the server's allow-list leaves out",
    (await page.locator(`[data-action-id="${REFER}"]`).count()) === 0,
  );
  await h.screenshot('claim-toolbar-with-request-medical-records');

  await button.click();
  const dialog = page.locator('lib-app-action-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(unread);
  const question = await dialog
    .locator('.lib-app-action__question')
    .innerText()
    .catch(() => '');
  h.check(
    "the dialog asks the kit's question",
    question.trim() === labels['payers.action.requestRecords.confirm'],
    JSON.stringify(question),
  );
  const note = dialog.locator('textarea[data-xpath="var:note"]');
  const urgent = dialog.locator('[data-xpath="var:urgent"]');
  h.check(
    "the dialog draws the button's form: Urgent and the note to the provider",
    (await note.count()) === 1 && (await urgent.count()) === 1,
    `${await note.count()} note fields, ${await urgent.count()} urgent fields`,
  );
  // Run with the note empty: the form's required field stops it, and nothing is sent.
  await dialog.locator('[data-app-action-run]').click();
  await page.waitForTimeout(800);
  h.check(
    'with the note empty, the form refuses to run it, and the dialog stays',
    (await dialog.count()) === 1 && (await dialog.locator('mat-error').count()) > 0,
  );
  const typed = `Please send the visit notes before Friday. ${RUN}`;
  await note.fill(typed);
  await urgent.locator('input').setChecked(true).catch(unread);
  await h.screenshot('request-medical-records-form');
  await dialog.locator('[data-app-action-run]').click();
  const done = labels['payers.action.requestRecords.sent'];
  const toast = await page
    .getByText(done, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  h.check('the person is told the medical records are requested', toast, done);
  h.check('the dialog has closed', (await dialog.count()) === 0);
  await h.screenshot('medical-records-requested');

  const entries = await until(async () => {
    const all = await history();
    const ours = all.filter(
      (entry) => entry.eventId === 'Medical records requested' && entry.comment.includes(RUN),
    );
    const endpoint = all.filter(
      (entry) =>
        entry.eventId === 'App action run' &&
        entry.comment.includes(`${REQUEST} of the app ${APP}, which runs ${REQUEST_CHAIN}`),
    );
    return ours.length > 0 && endpoint.length > 0 ? { ours, endpoint } : null;
  });
  h.check(
    "the chain wrote the request to the claim's history, urgently, with the note entered",
    entries !== null &&
      entries.ours.length === 1 &&
      entries.ours[0].comment.includes(', urgently: ') &&
      entries.ours[0].comment.includes(typed) &&
      entries.ours[0].principalName === ADJUSTER,
    JSON.stringify(entries?.ours ?? null),
  );
  h.check(
    'AgenticUi.RunAction wrote who ran which action of which app, and no value, to its history',
    entries !== null &&
      entries.endpoint.some(
        (entry) => entry.principalName === ADJUSTER && !entry.comment.includes(RUN),
      ),
    JSON.stringify(entries?.endpoint ?? null),
  );

  // ── The registry refuses an unlisted chain ─────────────────────────────────────────────────
  await h.step('The app registry leaves out the button whose chain the allow-list does not hold');
  h.check(
    "the kit's own actions.json names Refer to special investigations",
    kitActions.some((action) => action.id === REFER && action.operation === REFER_CHAIN),
  );
  h.check(
    'the registry serves the file without it, and with Request medical records',
    !servedIds.includes(REFER) && servedIds.includes(REQUEST),
    JSON.stringify(servedIds),
  );
  const diagnostics = (listing?.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.app === APP && diagnostic.code === 'action-refused',
  );
  h.check(
    "the registry's diagnostics, which the adjuster may read, say why it is left out",
    diagnostics.some(
      (diagnostic) =>
        diagnostic.message.includes(`"${REFER}"`) &&
        diagnostic.message.includes(
          `"${REFER_CHAIN}", which this server's allow-list does not hold`,
        ),
    ),
    JSON.stringify(diagnostics),
  );

  // ── The endpoint refuses what the registry did not serve, and more ─────────────────────────
  await h.step(
    'AgenticUi.RunAction refuses the unlisted chain, values it does not take, and others',
  );
  const before = (await history()).length;
  const refer = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REFER, claim.uid, {}),
  );
  h.check(
    "asked for the unlisted chain's action, it answers 404",
    refer.status === 404,
    String(refer.status),
  );
  const smuggled = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REQUEST, claim.uid, { note: RUN, operation: REFER_CHAIN }),
  );
  h.check(
    'asked with a value the form does not send, it answers 400',
    smuggled.status === 400,
    String(smuggled.status),
  );
  const long = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REQUEST, claim.uid, { note: `${RUN} ${'x'.repeat(500)}` }),
  );
  h.check(
    "asked with a note longer than the allow-list's 500 characters, it answers 400",
    long.status === 400,
    String(long.status),
  );
  const outsider = await asMemberServices(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REQUEST, claim.uid, { note: RUN }),
  );
  h.check(
    "asked by member services, whom the allow-list's groups leave out, it answers 403",
    outsider.status === 403,
    String(outsider.status),
  );
  const emptyNote = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REQUEST, claim.uid, { urgent: true }),
  );
  h.check(
    'asked with the note left empty, which the allow-list requires, it answers 400',
    emptyNote.status === 400,
    String(emptyNote.status),
  );
  const onPaid = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(REQUEST, paid.uid, { note: RUN }),
  );
  h.check(
    "asked for a paid claim, a state the allow-list does not name, it answers 403 whatever the button's rule",
    onPaid.status === 403,
    String(onPaid.status),
  );

  // ── Nuxeo's own Automation endpoint, beside it ─────────────────────────────────────────────
  await h.step(
    "Nuxeo's own Automation endpoint, and its dispatcher, run neither of the kit's chains",
  );
  const chainCall = (chain) =>
    asAdjuster('POST', `/api/v1/automation/${chain}`, {
      input: `doc:${claim.uid}`,
      params: { note: RUN },
      context: {},
    });
  const dispatched = (chain) =>
    asAdjuster('POST', '/api/v1/automation/RunOperation', {
      input: `doc:${claim.uid}`,
      params: { id: chain },
      context: { note: RUN },
    });
  const refusedStatus = (answer) => typeof answer.status === 'number' && answer.status >= 400;
  const direct = [await chainCall(REQUEST_CHAIN), await chainCall(REFER_CHAIN)];
  h.check(
    "a direct call is refused, by each chain's first step, AgenticUi.RequireRunAction",
    direct.every(refusedStatus),
    direct.map((answer) => answer.status).join(', '),
  );
  const viaDispatcher = [await dispatched(REQUEST_CHAIN), await dispatched(REFER_CHAIN)];
  h.check(
    "RunOperation, which no REST binding on a chain stops, is refused by each chain's first step, AgenticUi.RequireRunAction",
    viaDispatcher.every(refusedStatus),
    viaDispatcher.map((answer) => answer.status).join(', '),
  );
  // The audit is written a moment after a change: wait as long as the run's own entries took.
  await page.waitForTimeout(3000);
  const after = await history();
  h.check(
    "none of the ten refused requests wrote to the claim's history",
    after.length === before &&
      !after.some((entry) => entry.eventId === 'Referred to special investigations'),
    `${before} entries before, ${after.length} after`,
  );

  // ── The button follows the record ──────────────────────────────────────────────────────────
  await h.step('No button on a claim no longer in review');
  await h.goToDoc(paid.uid);
  await page.locator('nxs-document-toolbar').first().waitFor({ timeout: 30_000 }).catch(unread);
  h.check(
    `the paid claim ${decided.number} does not offer it: its visibleWhen reads the record's state`,
    (await page.locator(`[data-action-id="${REQUEST}"]`).count()) === 0,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "not run here: the button on a queue's rows, which the kit's my-claims queue offers and the " +
      "client's specs run (app-actions.rows.spec.ts)",
  );
  h.note(
    "not run: an administrator calling the chains through Nuxeo's own endpoint, which each chain's " +
      'first step refuses as it refuses an adjuster; the Java tests hold the guard to that',
  );
  h.note(
    `the run leaves its two history entries on ${seeded.number}, marked "${RUN}": the history is ` +
      'not what the other demos count',
  );
}
