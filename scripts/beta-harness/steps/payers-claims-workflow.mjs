/**
 * The Payers kit's claims review workflow: business apps phase 2's first three demo steps, end to
 * end (docs/business-apps/development-plan.md, phase 2, "Demo"), on the kit in
 * `business-apps/packages/payers-claims-demo`, version 0.4.0 or later.
 *
 *   1. An adjuster approves a claim over $5,000: it goes to the supervisor.
 *   2. The supervisor approves it, and the claim moves to Approved.
 *   3. Deny another claim without a reason: the field rule stops it.
 *
 * Each step is done in the app, in the Tasks page's task panel, through the step's task form
 * (`bundle/agentic-ui-config/tasks/`), and its outcome is read back from the server: the claim's
 * lifecycle state and `claim:status`, which the kit keeps as one, and the tasks open on it. Then,
 * through the REST API, past the form:
 *
 * - **a denial with no reason is refused by the server too:** the route model's first transition
 *   holds it, leaves the claim as it was and opens the determination again, and the same denial
 *   with a reason denies the claim, so the refusal is not the denial failing for another reason;
 * - **a claim billed exactly $5,000 skips the supervisor:** approved by the adjuster alone, with
 *   none of the history of a claim sent to a supervisor, which the claim of step 1 has.
 *
 * The amounts are the run's, and the threshold is read from the route model's own condition, so a
 * model whose threshold moved fails here, at the boundary. Each run writes three claims of its own
 * to the seeded claims folder, numbered for the run and marked `MARKER`. They hold no member, no
 * provider, and none of phase 1's adjusters, and the run ends with each one approved or denied, so
 * none is in what phase 1's demo counts. A run that stopped part way leaves claims in review, which
 * phase 1's demo would count: the next run of this one cancels their workflows and trashes them
 * first, before it writes its own.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, version 0.4.0 or later, and seeded with `demo/seed.mjs`,
 *   which creates the workflow's two people and the claims folder they may change.
 * - **The run's own user is the workflow's adjuster:** `NUXEO_USER` is `WORKFLOW_ADJUSTER` of
 *   `data.mjs`, in `claims-adjusters` and not `claims-supervisors`, and `NUXEO_PASS` the demo
 *   password. `PAYERS_DEMO_PASSWORD` signs the supervisor in, `WORKFLOW_SUPERVISOR`, in
 *   `claims-supervisors` and not `claims-adjusters`: step 2 signs the browser in as them,
 *   declared with `h.signedInAs`, and step 3 signs the adjuster back in.
 * - The dev server with `npm run config:dev` serving the kit's two task forms and its labels (the
 *   kit's README, "Seeing it under nx serve"). The app registry serves the same files on a server
 *   after sign-in; the files `config:dev` serves win over it.
 *
 *   NUXEO_USER=alex.rivera NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-claims-workflow
 *
 * Load-bearing checks: the workflow's start puts each claim in review, state and status; step 1's
 * form drawn from the kit's file, and after it the adjuster's task ended, a supervisor's open, the
 * claim still in review with its allowed amount; step 2's approval moving the claim to approved,
 * state and status, with no task left and the record page showing it; step 3's form refusing to
 * send the denial, the task still open and the claim still in review; the server leaving a claim
 * denied with no reason in review, with its determination open again, and denying it with one;
 * the claim at the threshold approved with no supervisor. Negative ones: the adjuster's
 * determination not approving the claim over the threshold, the denial with no reason not denying
 * it (in the form and on the server), and no supervisor for the claim at the threshold.
 *
 * Not covered, and said in notes: the supervisor sending a claim back, the server's own install of
 * the task forms (the dev server serves them from `config:dev`), and who may follow the lifecycle's
 * transitions outside the workflow.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { USERS, WORKFLOW_ADJUSTER, WORKFLOW_SUPERVISOR } = await import(
  join(KIT, 'demo', 'data.mjs')
);

/** The route model's name, and the two steps with a task, as the kit's files name them. */
const MODEL = 'PayersClaimReview';
const DETERMINE = 'determine';
const SUPERVISOR = 'supervisorApproval';
const CLAIMS_FOLDER = '/default-domain/workspaces/payers-demo/claims';
/** How this demo's claims are known again: their `dc:description`. Not the seed's marker. */
const MARKER = 'Payers kit workflow demo (fictional)';

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

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;
const taskFile = (step) => `tasks/${MODEL}.${step}.layout.json`;

/**
 * The supervisor's threshold, read from the route model's own condition: the determination's
 * `toSupervisor` transition, `... Document["claim:billedAmount"] > <threshold>`.
 */
const THRESHOLD = (() => {
  const xml = readFileSync(join(KIT, 'workflow', MODEL, DETERMINE, 'document.xml'), 'utf8');
  const transition =
    /<name><!\[CDATA\[toSupervisor\]\]><\/name>[\s\S]*?<condition><!\[CDATA\[([\s\S]*?)\]\]><\/condition>/.exec(
      xml,
    );
  const amount = /Document\["claim:billedAmount"\] > (\d+(?:\.\d+)?)/.exec(transition?.[1] ?? '');
  if (!amount)
    throw new Error('the determination has no toSupervisor threshold this demo can read');
  return Number(amount[1]);
})();

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
 * A REST call from Node, as `username`, with Basic authentication and no cookie: the adjuster's
 * and the supervisor's channels. Not page.request, which shares the browser's cookie jar, so that
 * once the browser has signed in as the supervisor it could be answered as them.
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

/**
 * A served file as the app reads it. A layout comes in the servlet's envelope, as `config:dev`
 * writes it too: its `content`. The task forms and the labels come as the package writes them.
 */
function unwrap(body) {
  return body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout'
    ? body.content
    : body;
}

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
    'Preconditions: the kit 0.4.0 installed and seeded, its task forms served, its people',
  );
  const { username: adjuster, password: adjusterPassword } = requireStepCredentials(
    'sign the workflow demo in as its adjuster',
  );
  h.requirePrecondition(
    `the run signs in as the workflow's adjuster, ${WORKFLOW_ADJUSTER}`,
    adjuster === WORKFLOW_ADJUSTER &&
      USERS.some((user) => user.username === adjuster && user.groups.includes('claims-adjusters')),
    `NUXEO_USER is ${adjuster}: set it to ${WORKFLOW_ADJUSTER}, and NUXEO_PASS to the demo password`,
  );
  const asAdjuster = (method, path, json, headers) =>
    restAs(h.baseUrl, adjuster, adjusterPassword, method, path, json, headers);
  const me = (await asAdjuster('GET', '/me')).body;
  const myGroups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the adjuster, in claims-adjusters and not claims-supervisors',
    me?.id === adjuster &&
      myGroups.includes('claims-adjusters') &&
      !myGroups.includes('claims-supervisors'),
    `/me answered ${me?.id} in ${JSON.stringify(myGroups)}: run demo/seed.mjs first`,
  );

  const demoPassword = process.env['PAYERS_DEMO_PASSWORD'] ?? '';
  h.requirePrecondition(
    'PAYERS_DEMO_PASSWORD is set, for the supervisor',
    demoPassword !== '',
    'export the password the seed gave the demo users as PAYERS_DEMO_PASSWORD',
  );
  const supervisor = WORKFLOW_SUPERVISOR;
  const asSupervisor = (method, path, json) =>
    restAs(h.baseUrl, supervisor, demoPassword, method, path, json);
  const supervisorMe = (await asSupervisor('GET', '/me')).body;
  const supervisorGroups = (supervisorMe?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    `${supervisor} signs in with it, in claims-supervisors and not claims-adjusters`,
    supervisorMe?.id === supervisor &&
      supervisorGroups.includes('claims-supervisors') &&
      !supervisorGroups.includes('claims-adjusters'),
    `/me as ${supervisor} answered ${supervisorMe?.id} in ${JSON.stringify(supervisorGroups)}: ` +
      'run demo/seed.mjs with the same PAYERS_DEMO_PASSWORD',
  );

  const schema = await asAdjuster('GET', `/config/schemas/var_${MODEL}_${DETERMINE}`);
  h.requirePrecondition(
    'the kit 0.4.0 or later is installed: its determination variables are on the server',
    schema.status === 200,
    `GET /config/schemas/var_${MODEL}_${DETERMINE} answered ${schema.status}: install the kit (README)`,
  );
  const folder = await asAdjuster('GET', `/path${CLAIMS_FOLDER}`, undefined, {
    'enrichers-document': 'permissions',
  });
  h.requirePrecondition(
    'the seeded claims folder is there, and the adjuster may add claims to it',
    folder.status === 200 &&
      (folder.body?.contextParameters?.permissions ?? []).includes('AddChildren'),
    `GET /path${CLAIMS_FOLDER} answered ${folder.status}: run demo/seed.mjs against this server`,
  );

  // What the dev server serves at /agentic-ui-config/ must be the kit's own task forms, labels and
  // Claim page: they are what the rest of this run asserts the forms and the page were drawn from.
  const differing = [];
  for (const path of [
    taskFile(DETERMINE),
    taskFile(SUPERVISOR),
    'labels/en.json',
    'layouts/Claim/view.layout.json',
  ]) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const content = answer?.ok() ? unwrap(await answer.json().catch(unread)) : null;
    if (!sameJson(content, kitFile(path))) differing.push(`${path} (${answer?.status()})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's two task forms, its labels and its Claim page",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  // ── Set up: the run's claims, each with the workflow started ───────────────────────────────
  await h.step('Set up: three claims of the run, each with the claims review workflow started');
  // An earlier run's claims, put away first: their workflows cancelled, and the claims trashed.
  const leftovers = await asAdjuster('POST', '/automation/Repository.Query', {
    params: {
      query:
        "SELECT * FROM Document WHERE ecm:primaryType = 'Claim' AND dc:description = " +
        `'${MARKER}' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0`,
      pageSize: 1000,
    },
  });
  const putAway = [];
  for (const claim of leftovers.body?.entries ?? []) {
    const running = await asAdjuster('GET', `/id/${claim.uid}/@workflow`);
    if (running.status !== 200) putAway.push(`${claim.path}'s workflows (${running.status})`);
    for (const workflow of running.body?.entries ?? []) {
      if (workflow.state !== 'running') continue;
      const cancelled = await asAdjuster('DELETE', `/workflow/${workflow.id}`);
      if (typeof cancelled.status !== 'number' || cancelled.status >= 300)
        putAway.push(`${claim.path}'s workflow ${workflow.id} (${cancelled.status})`);
    }
    const trashed = await asAdjuster('POST', '/automation/Document.Trash', {
      input: `doc:${claim.uid}`,
      params: {},
    });
    if (trashed.status !== 200) putAway.push(`${claim.path} (${trashed.status})`);
  }
  h.requirePrecondition(
    "an earlier run's claims are put away: their workflows cancelled, and they trashed",
    leftovers.status === 200 && putAway.length === 0,
    `could not put away ${putAway.join(', ') || `the earlier claims (${leftovers.status})`}`,
  );
  h.note(
    `${leftovers.body?.entries?.length ?? 0} claim(s) of an earlier run were put away: their ` +
      'workflows cancelled, and the claims trashed',
  );

  const runId = Date.now().toString(36).toUpperCase();
  const claims = {
    over: { number: `CLAIM-WF-${runId}-1`, billedAmount: 7250, allowedAmount: 7000 },
    atThreshold: {
      number: `CLAIM-WF-${runId}-2`,
      billedAmount: THRESHOLD,
      allowedAmount: THRESHOLD,
    },
    denied: { number: `CLAIM-WF-${runId}-3`, billedAmount: 2310 },
  };
  const read = (claim) =>
    asAdjuster('GET', `/id/${claim.uid}`).then(({ body }) => ({
      state: body?.state ?? null,
      status: body?.properties?.['claim:status'] ?? null,
      allowedAmount: body?.properties?.['claim:allowedAmount'] ?? null,
    }));
  /**
   * The tasks open on a claim, as the adjuster and as the supervisor, each of whom may read their
   * own step's, or `null` when either is not answered with a list: so "none open" is never what a
   * refused or failed read looks like.
   */
  const openTasks = async (claim) => {
    const asked = await asSupervisor('GET', `/id/${claim.uid}/@task`);
    const mine = await asAdjuster('GET', `/id/${claim.uid}/@task`);
    if (![asked, mine].every(({ status, body }) => status === 200 && Array.isArray(body?.entries)))
      return null;
    const all = [...asked.body.entries, ...mine.body.entries];
    return [...new Map(all.map((task) => [task.id, task])).values()].filter(
      (task) => task.state === 'opened',
    );
  };
  const taskOn = async (claim, step) =>
    (await openTasks(claim))?.find((task) => task.nodeName === step) ?? null;
  /** Whether the claim was read, and has no task open. */
  const noTaskOpen = async (claim) => (await openTasks(claim))?.length === 0;
  const actorsOf = (task) => (task?.actors ?? []).map((actor) => actor?.id ?? actor);

  for (const [name, claim] of Object.entries(claims)) {
    const created = await asAdjuster('POST', `/path${CLAIMS_FOLDER}`, {
      'entity-type': 'document',
      name: claim.number.toLowerCase(),
      type: 'Claim',
      properties: {
        'dc:title': claim.number,
        'dc:description': MARKER,
        'claim:number': claim.number,
        'claim:serviceDate': '2026-11-02',
        'claim:received': '2026-11-20',
        'claim:billedAmount': claim.billedAmount,
        'claim:status': 'submitted',
        'claim:adjuster': adjuster,
        'claim:diagnosis': 'M17.11',
      },
    });
    claim.uid = created.body?.uid ?? null;
    h.check(
      `${name}: claim ${claim.number}, billed $${claim.billedAmount}, is created as submitted`,
      created.status === 201 && created.body?.state === 'submitted',
      `POST answered ${created.status}, state ${created.body?.state}`,
    );
    const started = claim.uid
      ? await asAdjuster('POST', `/id/${claim.uid}/@workflow`, {
          'entity-type': 'workflow',
          workflowModelName: MODEL,
          attachedDocumentIds: [claim.uid],
        })
      : { status: 'not created', body: null };
    claim.workflow = started.body?.id ?? null;
    h.check(
      `${name}: the ${MODEL} workflow starts on it`,
      started.status === 201 && started.body?.workflowModelName === MODEL,
      `POST @workflow answered ${started.status}, ${started.body?.workflowModelName}`,
    );
  }
  for (const [name, claim] of Object.entries(claims)) {
    const now = await read(claim);
    h.check(
      `${name}: the start puts the claim in review, its lifecycle state and claim:status both inReview`,
      now.state === 'inReview' && now.status === 'inReview',
      JSON.stringify(now),
    );
    claim.task = await until(() => taskOn(claim, DETERMINE));
    h.check(
      `${name}: its determination is open, for the claim's adjuster, user:${adjuster}`,
      claim.task !== null && actorsOf(claim.task).includes(`user:${adjuster}`),
      JSON.stringify({ id: claim.task?.id, actors: actorsOf(claim.task) }),
    );
  }

  // ── 1. The adjuster approves a claim over the threshold ────────────────────────────────────
  await h.step(`1. An adjuster approves a claim over $${THRESHOLD}: it goes to the supervisor`);
  await h.login();
  await h.goTo(`/#/tasks/${claims.over.task?.id}`);
  await formSettled(page);
  h.check(
    "the task panel draws the step's form from the kit's file, a layout of version 2",
    (await page
      .locator('.nxs-task-detail__form nxs-metadata-editor[data-layout-source="version-2"]')
      .count()
      .catch(() => 0)) === 1,
  );
  h.check(
    "the claim's number shows read-only in the form",
    (await readOnlyValue(page, 'claim:number')) === claims.over.number,
    await readOnlyValue(page, 'claim:number'),
  );
  await choose(page, 'var:decision', 'approve');
  await page
    .locator('.nxs-task-detail__form input[data-xpath="var:allowedAmount"]')
    .fill(String(claims.over.allowedAmount), { timeout: 10_000 })
    .catch(deferred);
  await h.screenshot('determination-approve-over-threshold');
  await act(page, 'Submit');
  const toSupervisor = await until(() => taskOn(claims.over, SUPERVISOR));
  const overAfter = await read(claims.over);
  const overOpen = await openTasks(claims.over);
  h.check(
    "the adjuster's determination is ended",
    Array.isArray(overOpen) && !overOpen.some((task) => task.id === claims.over.task?.id),
    JSON.stringify(overOpen?.map((task) => task.nodeName) ?? 'the tasks were not read'),
  );
  h.check(
    "a supervisor's approval is open on the claim, for claims-supervisors",
    toSupervisor !== null && actorsOf(toSupervisor).includes('group:claims-supervisors'),
    JSON.stringify({ id: toSupervisor?.id, actors: actorsOf(toSupervisor) }),
  );
  h.check(
    `the claim is still in review, not approved by the adjuster, with $${claims.over.allowedAmount} allowed`,
    overAfter.state === 'inReview' &&
      overAfter.status === 'inReview' &&
      Number(overAfter.allowedAmount) === claims.over.allowedAmount,
    JSON.stringify(overAfter),
  );
  await h.screenshot('determination-sent-to-supervisor');

  // ── 2. The supervisor approves it ──────────────────────────────────────────────────────────
  await h.step('2. The supervisor approves it, and the claim moves to Approved');
  // As phase 1's demo signs in member services: declared first, the adjuster's cookie dropped,
  // every frame's Nuxeo request given the supervisor's header until the reload commits, then the
  // app's own header, from the session it restored. The REST reads below are Node's, as the
  // adjuster or the supervisor, and share no cookie with the browser.
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(deferred);
  await h.signedInAs(supervisor, "the supervisor approves the adjuster's determination");
  const supervisorBasic = Buffer.from(`${supervisor}:${demoPassword}`).toString('base64');
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
          headers: { ...route.request().headers(), authorization: `Basic ${supervisorBasic}` },
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
        username: supervisor,
        basic: supervisorBasic,
        isAdministrator: false,
        groups: [],
      }),
    },
  );
  await page.reload({ waitUntil: 'commit', timeout: 120_000 });
  await page.unroute('**/nuxeo/**');
  await page.waitForLoadState('load', { timeout: 120_000 });
  await h.goTo(`/#/tasks/${toSupervisor?.id}`);
  await formSettled(page);
  const shownAllowed = await readOnlyValue(page, 'claim:allowedAmount');
  h.check(
    `the supervisor's form shows the allowed amount, $${claims.over.allowedAmount}, read-only, from the claim`,
    shownAllowed !== null &&
      Number(shownAllowed.replace(/[^0-9.]/g, '')) === claims.over.allowedAmount,
    String(shownAllowed),
  );
  const offered = await actionLabels(page);
  h.check(
    "the panel offers the step's own actions, from the route model: Approve and Send back",
    offered.some((label) => /^approve$/i.test(label)) &&
      offered.some((label) => /^send back$/i.test(label)),
    JSON.stringify(offered),
  );
  await h.screenshot('supervisor-approval');
  await act(page, 'Approve');
  const approved = await until(async () => {
    const now = await read(claims.over);
    return now.state === 'approved' ? now : null;
  });
  h.check(
    'the claim moves to Approved: its lifecycle state and claim:status both approved',
    approved?.state === 'approved' && approved?.status === 'approved',
    JSON.stringify(approved ?? (await read(claims.over))),
  );
  h.check('no task is left open on the claim', await noTaskOpen(claims.over));
  const workflow = await asAdjuster('GET', `/workflow/${claims.over.workflow}`);
  h.check(
    "the claim's workflow, read by its id, is done",
    workflow.status === 200 && workflow.body?.state === 'done',
    `GET /workflow answered ${workflow.status}, ${workflow.body?.state}`,
  );
  await h.goToDoc(claims.over.uid);
  await page
    .waitForSelector('.record-page__card [data-field="claim:status"]', { timeout: 30_000 })
    .catch(deferred);
  const shownStatus = await page
    .locator('.record-page__card [data-field="claim:status"] dd')
    .first()
    .innerText({ timeout: 10_000 })
    .catch(unread);
  h.check(
    "the claim's record page shows it approved, through the Claim layout's status badge",
    /approved/i.test(shownStatus ?? ''),
    String(shownStatus),
  );
  await h.screenshot('claim-approved', page.locator('.record-page__card').first());
  // The browser's cookie jar is the identity guard's to judge: a cookie the supervisor's session
  // picked up would answer the next step boundary as them.
  await page.context().clearCookies();

  // ── 3. A denial with no reason ─────────────────────────────────────────────────────────────
  await h.step('3. Deny another claim without a reason: the field rule stops it');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(deferred);
  await h.login();
  await h.goTo(`/#/tasks/${claims.denied.task?.id}`);
  await formSettled(page);
  await choose(page, 'var:decision', 'deny');
  const reason = page.locator('.nxs-task-detail__form textarea[data-xpath="var:denialReason"]');
  await reason.waitFor({ state: 'visible', timeout: 10_000 }).catch(deferred);
  h.check(
    'choosing Deny shows the reason field, by its rule',
    await reason.isVisible().catch(() => false),
  );
  await act(page, 'Submit');
  const requiredText = `${labels['payers.task.denialReason']} is required.`;
  await page
    .waitForFunction((text) => document.body.innerText.includes(text), requiredText, {
      timeout: 10_000,
    })
    .catch(deferred);
  h.check(
    `the field rule stops it: "${requiredText}" beside the reason, which is marked invalid`,
    (await page.evaluate((text) => document.body.innerText.includes(text), requiredText)) &&
      (await reason.getAttribute('data-nxs-invalid').catch(unread)) === 'true',
  );
  await h.screenshot('denial-without-reason-refused');
  const stillOpen = await asAdjuster('GET', `/task/${claims.denied.task?.id}`);
  const deniedAfterForm = await read(claims.denied);
  h.check(
    'nothing was sent: the determination is still open, and the claim still in review',
    stillOpen.body?.state === 'opened' &&
      deniedAfterForm.state === 'inReview' &&
      deniedAfterForm.status === 'inReview',
    JSON.stringify({ task: stillOpen.body?.state, claim: deniedAfterForm }),
  );

  // ── The server's side: past the form ───────────────────────────────────────────────────────
  await h.step('The server refuses a denial with no reason, and denies one with a reason');
  const bare = await asAdjuster('PUT', `/task/${claims.denied.task?.id}/submit`, {
    'entity-type': 'task',
    id: claims.denied.task?.id,
    variables: { decision: 'deny' },
  });
  const reopened = await until(async () => {
    const task = await taskOn(claims.denied, DETERMINE);
    return task && task.id !== claims.denied.task?.id ? task : null;
  });
  const deniedAfterServer = await read(claims.denied);
  h.check(
    'the claim is not denied: still in review, state and status',
    deniedAfterServer.state === 'inReview' && deniedAfterServer.status === 'inReview',
    `PUT answered ${bare.status}; the claim is ${JSON.stringify(deniedAfterServer)}`,
  );
  h.check(
    'the server opens the determination again, as a new task',
    reopened !== null,
    `PUT answered ${bare.status}`,
  );
  // Which transition held: the denial's own refusal, by the comment its chain records, and not the
  // one for no decision at all, which would mean the variables were never applied.
  const refusal = await until(async () => {
    const entries =
      (await asAdjuster('GET', `/id/${claims.denied.uid}/@audit`)).body?.entries ?? [];
    return entries.find(
      (entry) =>
        entry.eventId === 'Determination refused' &&
        /A denial needs a reason/.test(entry.comment ?? ''),
    );
  });
  h.check(
    'the refusal is the denial\'s: "A denial needs a reason" in the claim\'s history',
    Boolean(refusal),
    JSON.stringify(refusal ?? null),
  );
  h.note(
    `the server's answer to a denial with no reason: HTTP ${bare.status}. It refuses it by its ` +
      'route model, not by an error: the first transition holds, the claim stays in review, and ' +
      'the determination opens again',
  );
  const withReason = await asAdjuster('PUT', `/task/${reopened?.id}/submit`, {
    'entity-type': 'task',
    id: reopened?.id,
    variables: { decision: 'deny', denialReason: 'Not a covered service (fictional).' },
  });
  const denied = await until(async () => {
    const now = await read(claims.denied);
    return now.state === 'denied' ? now : null;
  });
  h.check(
    'the same denial, with a reason, denies the claim, with nothing allowed',
    // Strictly 0: the claim was created with no allowed amount, which reads as null, not 0.
    withReason.status === 200 && denied?.status === 'denied' && denied?.allowedAmount === 0,
    JSON.stringify({ answered: withReason.status, claim: denied ?? (await read(claims.denied)) }),
  );

  // ── At the threshold: no supervisor ────────────────────────────────────────────────────────
  await h.step(`A claim billed $${THRESHOLD}, at the threshold, skips the supervisor`);
  const atThreshold = await asAdjuster('PUT', `/task/${claims.atThreshold.task?.id}/submit`, {
    'entity-type': 'task',
    id: claims.atThreshold.task?.id,
    variables: { decision: 'approve', allowedAmount: claims.atThreshold.allowedAmount },
  });
  const approvedAlone = await until(async () => {
    const now = await read(claims.atThreshold);
    return now.state === 'approved' ? now : null;
  });
  h.check(
    `the adjuster's approval approves it: approved, state and status, with $${THRESHOLD} allowed`,
    atThreshold.status === 200 &&
      approvedAlone?.status === 'approved' &&
      Number(approvedAlone?.allowedAmount) === claims.atThreshold.allowedAmount,
    JSON.stringify({ answered: atThreshold.status, claim: approvedAlone }),
  );
  h.check('no supervisor: no task is open on it', await noTaskOpen(claims.atThreshold));
  // The claims' histories, which the audit writes a moment after each change: the claim of step 1
  // went to a supervisor, and this one did not, by the event the route model's chain records.
  const events = async (claim) =>
    ((await asAdjuster('GET', `/id/${claim.uid}/@audit`)).body?.entries ?? []).map(
      (entry) => entry.eventId,
    );
  const overEvents = await until(async () => {
    const found = await events(claims.over);
    return found.includes('Claim approved') ? found : null;
  });
  const thresholdEvents = await until(async () => {
    const found = await events(claims.atThreshold);
    return found.includes('Claim approved') ? found : null;
  });
  h.check(
    'step 1\'s claim has "Sent to a supervisor" in its history, and this one does not',
    (overEvents ?? []).includes('Sent to a supervisor') &&
      Array.isArray(thresholdEvents) &&
      !thresholdEvents.includes('Sent to a supervisor'),
    JSON.stringify({ over: overEvents, atThreshold: thresholdEvents }),
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "not run: a supervisor sending a determination back, which the route model's sendBack " +
      'transition does, to the adjuster',
  );
  h.note(
    "the server's own install is not what the app read: under the dev server the task forms come " +
      'from config:dev, which only the app registry serves from a package',
  );
  h.note(
    "the lifecycle's transitions are not the workflow's alone: anyone the server lets change a " +
      'claim may follow approve through the API, and hiding a button is not a control',
  );
  h.note(
    `the run's claims stay on the server, approved or denied, marked "${MARKER}": the next run ` +
      'trashes them',
  );
}
