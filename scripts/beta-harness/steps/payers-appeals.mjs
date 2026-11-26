/**
 * The Payers kit's appeals: business apps phase 2's demo step 6, end to end
 * (docs/business-apps/development-plan.md, phase 2, "Demo"), on the kit in
 * `business-apps/packages/payers-claims-demo`, version 0.6.0 or later.
 *
 *   6. Open an appeal case with its checklist and timeline.
 *
 * An appeal is a Case of the category `appeal`, opened against a denied claim, which it links to.
 * Its record page is the kit's Case layout (`bundle/agentic-ui-config/layouts/Case/view.layout.json`):
 * a checklist card, layout version 2's (layout-v2.md, section 7), whose items the file lists and
 * whose state, done or not with who and when, the case's `case:checklist` holds; and a timeline
 * card, the case's audit. The steps:
 *
 *   1. The appeal under way, CASE-2041: the file's items, in the file's order, which is not the
 *      record's, with the labels' words, the two done each with who and when, the three not done
 *      with neither, though one's entry still names who asked and when, and the count; its
 *      claim's link, which opens the claim, denied.
 *   2. Its timeline: the server's audit of the case, of the card's kinds, newest first.
 *   3. The decided appeal, CASE-2043: the same items, in the same order, every one done, by the
 *      people and on the days the seed wrote. The items are the file's, the state the record's.
 *   4. A grievance, CASE-2042: no checklist, by the card's rule, and still its timeline.
 *   5. The configuration behind it: the Case layout served is the kit's file, and the bundle holds
 *      no code.
 *   6. The open appeals, version 0.6.0's queue: member services' home counts them and opens it,
 *      its menu lists it, and it lists the appeals not decided, the nearest due first, in the
 *      server's order, with neither the decided appeal nor a grievance; its State facet counts
 *      them, and narrowed to one state on the server, it keeps that state's appeal only.
 *   7. Ticking an item, version 0.6.0's `"tickable": true` on the Case page: the specialist, who
 *      may change cases, ticks an item on the appeal under way; the server holds it done, by them,
 *      now, and every other entry as it was, and its audit says who changed the case; the page
 *      says so. Unticked, the entry stays, not done. Then the checklist the seed wrote is put back.
 *
 * The rows, names and days it expects are read from the kit's own files: `demo/data.mjs` for the
 * cases, their claims and the people, and the Case layout and the labels for the items and their
 * words, through `demo/appeals.mjs`, as the seed reads them. So a change to either is a change to
 * what the demo asserts.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, version 0.6.0 or later (its open-appeals queue, and
 *   member services' right to change cases), and seeded with `demo/seed.mjs`, which writes the
 *   appeals, their claims and the people.
 * - **The run's own user is the appeals' specialist:** `NUXEO_USER` is `APPEALS_SPECIALIST` of
 *   `data.mjs`, in `member-services` and neither claims group, and `NUXEO_PASS` the demo password.
 *   It signs no one else in. It changes one thing, step 7's tick, and puts it back.
 * - The dev server with `npm run config:dev` serving the kit's Case layout, home, menu, queues and
 *   labels (the kit's README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=sam.patel NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-appeals
 *
 * Load-bearing checks: each appeal's checklist rows, item by item, against the file and the seed,
 * and its count; the claim link's text, its address and the claim it opens, denied; the timeline's
 * entries against the server's audit, in order; the decided appeal's items the same as the one
 * under way's; the served Case layout the kit's file; the open appeals' rows against the seed and
 * the server's own answer, in order, the home's figure and the facet's counts, and the narrowed
 * rows; the tick's entry on the server, done, by the specialist, now, the audit's author of the
 * change, and the card drawn from it; the untick's entry kept, not done. Negative ones: no one and
 * no day on an item not done, one of whose entries still names both and two of which have no entry
 * at all; no checklist on a grievance, whose timeline still draws; when the case's audit holds an
 * event outside the card's kinds, none of those drawn, and, when it holds none, a note rather than
 * a check that could not fail; neither the decided appeal nor an open grievance in the queue, and
 * the other state's appeal gone once narrowed; and every other entry of the checklist unchanged by
 * the tick.
 *
 * Not covered, and said in notes: the server's own install (the dev server serves the files from
 * `config:dev`); someone who may not change a case, who is offered no tick box, which the record
 * page's own tests show, as they show a refused write leaving the card as it was; and who may
 * change a case's checklist through the API, which the server's permissions decide.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';
import { codeIn } from './payers-claims-demo/bundle-data.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { APPEALS_SPECIALIST, CASES, CLAIMS, USERS } = await import(join(KIT, 'demo', 'data.mjs'));
const {
  OPEN_APPEALS,
  appealProblems,
  appealRows,
  checklistOnType,
  isOpenAppeal,
  readAppealChecklist,
  readOpenAppeals,
} = await import(join(KIT, 'demo', 'appeals.mjs'));
const { ZIP_PATH: ROUTE_MODEL_ZIP } = await import(join(KIT, 'workflow', 'route-model.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The person is
 * the one the preconditions below hold the run to; it signs no one else in.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [APPEALS_SPECIALIST],
    who: "the appeals' case specialist, in member-services and neither claims group",
  },
  signsInAs: [],
  needs: [
    'the kit 0.6.0 or later installed',
    "the dev server with `npm run config:dev` serving the kit's Case layout, home, menu, queues and labels",
  ],
};

const CASE_LAYOUT = 'layouts/Case/view.layout.json';
const CASES_FOLDER = '/default-domain/workspaces/payers-demo/cases';
/** The open-appeals queue's file, and the files the home and the menu that open it are. */
const APPEALS_QUEUE = 'queues/open-appeals.json';
const SERVED = [CASE_LAYOUT, 'labels/en.json', 'home.json', 'navigation.json', APPEALS_QUEUE];

/** The demo's three cases: the appeal under way, the decided one, and a grievance. */
const UNDER_WAY = CASES.find((kase) => kase.number === 'CASE-2041');
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
/** The open-appeals queue as the stand-in model contributes it: the states it holds, its sort. */
const OPEN = readOpenAppeals();

/** The appeals the queue holds, in its order: the stand-in model's sort, by the seeded value. */
function openAppealRows() {
  const field = OPEN.sort.field?.slice(OPEN.sort.field.indexOf(':') + 1);
  return CASES.filter((kase) => isOpenAppeal(kase, OPEN))
    .sort(
      (a, b) => (OPEN.sort.ascending ? 1 : -1) * String(a[field]).localeCompare(String(b[field])),
    )
    .map((kase) => kase.number);
}

/** Counts of `items` by `key`, as a plain object with sorted keys. */
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return canonical(counts);
}

/** The case numbers of the queue's rows, in the order drawn. */
function readCaseRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.queue-page tbody tr')]
      .map((row) => /CASE-\d+/.exec(row.textContent ?? '')?.[0] ?? null)
      .filter(Boolean),
  );
}

/** A facet's buckets as drawn, `{ key: count }`. */
function readFacet(page, aggregate) {
  return page.evaluate(
    (id) =>
      Object.fromEntries(
        [
          ...document.querySelectorAll(
            `fieldset.queue-facet[data-aggregate="${id}"] .queue-facet__bucket`,
          ),
        ].map((bucket) => {
          const match = /^\s*(\S+)\s*\((\d+)\)/.exec(bucket.textContent ?? '');
          return match ? [match[1], Number(match[2])] : [bucket.textContent, null];
        }),
      ),
    aggregate,
  );
}

/**
 * The timeline's kinds when its card names none: layout-v2.md's "default kinds", read from the
 * document as the record page's own spec reads them, so the demo and the engine agree on the list.
 */
const DEFAULT_EVENTS = (() => {
  const proposal = readFileSync(join(REPO, 'docs', 'business-apps', 'layout-v2.md'), 'utf8');
  const paragraph = /\*\*The default kinds\*\*([\s\S]*?)`download` is not one/.exec(proposal);
  if (!paragraph) throw new Error("layout-v2.md no longer lists the timeline's default kinds");
  return [...paragraph[1].matchAll(/`([A-Za-z_]+)`/g)].map((match) => match[1]);
})();

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

/** What a case's checklist card should draw, item by item, from the file and the seed. */
function expectedRows(kase) {
  return appealRows(kase, CHECKLIST).map((row, index) => ({
    item: row.id,
    done: String(row.done),
    label: labels[CHECKLIST.items[index].labelKey] ?? null,
    state: row.done ? 'Done' : 'Not done',
    by: row.done ? nameOf(row.doneBy) : null,
    on: row.done ? longDay(row.doneOn) : null,
  }));
}

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

/** A served file as the app reads it: a layout in the servlet's envelope, or as written. */
function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

/** A checklist entry as the server answers it, its day as the seed wrote it. */
const entryOf = (entry) => ({
  item: entry?.item ?? null,
  done: entry?.done ?? null,
  doneBy: entry?.doneBy ?? null,
  doneOn: typeof entry?.doneOn === 'string' ? entry.doneOn.slice(0, 10) : (entry?.doneOn ?? null),
});

/** The record page's cards as drawn, by id, and the checklist card's rows. */
function readCase(page) {
  return page.evaluate(() => {
    const part = (row, name) =>
      row.querySelector(`.record-page__checklist-${name}`)?.textContent?.trim() ?? null;
    const checklist = document.querySelector('.record-page__card[data-card-id="checklist"]');
    const claim = document.querySelector('[data-field="case:claim"] a');
    return {
      cards: [...document.querySelectorAll('.record-page__card')].map((card) =>
        card.getAttribute('data-card-id'),
      ),
      heading: checklist?.querySelector('.record-page__heading')?.textContent?.trim() ?? null,
      count: checklist?.querySelector('.record-page__checklist-count')?.textContent?.trim() ?? null,
      rows: [...(checklist?.querySelectorAll('.record-page__checklist-item') ?? [])].map((row) => ({
        item: row.getAttribute('data-item'),
        done: row.getAttribute('data-done'),
        label: part(row, 'label'),
        state: part(row, 'state'),
        by: part(row, 'by'),
        on: part(row, 'on'),
      })),
      claim: claim
        ? { text: claim.textContent?.trim() ?? '', href: claim.getAttribute('href') ?? '' }
        : null,
      timeline: [...document.querySelectorAll('.record-timeline__entry')].map((entry) => ({
        id: Number(entry.getAttribute('data-entry-id')),
        event: entry.getAttribute('data-event'),
      })),
    };
  });
}

/** The case's record page has drawn `cards`, its timeline's first page or its empty state. */
async function caseSettled(page, cards) {
  await page
    .waitForFunction(
      (ids) =>
        ids.every((id) => document.querySelector(`.record-page__card[data-card-id="${id}"]`)) &&
        document.querySelector(
          '.record-page__card[data-card-id="history"] :is(.record-timeline__entries, nxs-empty-state, nxs-error-state)',
        ) !== null &&
        // The checklist's names are read with the page's users, and show the stored user name
        // until then: wait until none does. Every demo user name has a dot, and no full name.
        [...document.querySelectorAll('.record-page__checklist-by')].every(
          (by) => !/\./.test(by.textContent ?? ''),
        ),
      cards,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the kit 0.4.1 installed and seeded, its Case page served');
  const { username } = requireStepCredentials('sign the appeals demo in as its specialist');
  h.requirePrecondition(
    `the run signs in as the appeals' specialist, ${APPEALS_SPECIALIST}`,
    username === APPEALS_SPECIALIST,
    `NUXEO_USER is ${username}: set it to ${APPEALS_SPECIALIST}, and NUXEO_PASS to the demo password`,
  );
  const me = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/me`)
    .then((r) => r.json())
    .catch(unread);
  const groups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the specialist, in member-services and neither claims group',
    me?.id === username &&
      groups.includes('member-services') &&
      !groups.includes('claims-adjusters') &&
      !groups.includes('claims-supervisors'),
    `/me answered ${me?.id} in ${JSON.stringify(groups)}: run demo/seed.mjs first`,
  );
  const problems = appealProblems({ cases: CASES, claims: CLAIMS, users: USERS }, CHECKLIST);
  h.requirePrecondition(
    "data.mjs agrees with the Case page's checklist, and each appeal is against a denied claim",
    problems.length === 0 && UNDER_WAY && DECIDED && GRIEVANCE,
    problems.join('; ') || 'CASE-2041, CASE-2043 or CASE-2042 is not in data.mjs',
  );
  // What makes step 1's checks able to fail: the appeal under way's entries are written in
  // another order than the file's, one not done still names who and when, and an item has none.
  const fileOrder = CHECKLIST.items.map((item) => item.id);
  const written = (UNDER_WAY?.checklist ?? []).map((entry) => entry.item);
  const stale = (UNDER_WAY?.checklist ?? []).filter(
    (entry) => entry.done === false && entry.doneBy != null && entry.doneOn != null,
  );
  const unrecorded = CHECKLIST.items.filter((item) => !written.includes(item.id));
  h.requirePrecondition(
    `${UNDER_WAY?.number}'s data tells the page's rules apart: entries out of the file's order, one not done naming who and when, and an item with no entry`,
    JSON.stringify(written) !== JSON.stringify(fileOrder.filter((id) => written.includes(id))) &&
      stale.length > 0 &&
      unrecorded.length > 0,
    `written ${JSON.stringify(written)}, file ${JSON.stringify(fileOrder)}, ` +
      `${stale.length} stale, ${unrecorded.length} unrecorded: change data.mjs`,
  );
  const caseType = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/config/types/Case`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  h.requirePrecondition(
    `the kit 0.4.1 or later is installed: ${CHECKLIST.field} is on the server`,
    checklistOnType(caseType, CHECKLIST.field),
    `GET /config/types/Case has no ${CHECKLIST.field}: install the kit (README)`,
  );
  h.requirePrecondition(
    "the Case page opts its checklist in to ticking, as the kit's 0.6.0 does",
    CHECKLIST.tickable === true,
    `the Case layout's checklist has no "tickable": true`,
  );

  // Each case the demo opens, as the server holds it: the seed's, with the checklist it wrote, and
  // each appeal's claim the denied one data.mjs names.
  const read = async (path) =>
    page.request
      .get(`${h.baseUrl}/nuxeo/api/v1${path}`, { headers: { properties: '*' } })
      .then((r) => (r.ok() ? r.json() : null))
      .catch(unread);
  const docs = {};
  const missing = [];
  for (const kase of [UNDER_WAY, DECIDED, GRIEVANCE]) {
    const doc = await read(`/path${CASES_FOLDER}/${kase.number.toLowerCase()}`);
    const held = (doc?.properties?.[CHECKLIST.field] ?? []).map(entryOf);
    if (
      doc?.type !== 'Case' ||
      doc.properties?.['case:number'] !== kase.number ||
      !sameJson(held, (kase.checklist ?? []).map(entryOf))
    )
      missing.push(`${kase.number} (${doc ? `checklist ${JSON.stringify(held)}` : 'not found'})`);
    docs[kase.number] = doc;
  }
  h.requirePrecondition(
    'the seeded cases are there, each with the checklist the seed wrote',
    missing.length === 0,
    `not as seeded: ${missing.join(', ')}. Run demo/seed.mjs against this server`,
  );
  const claims = {};
  const notDenied = [];
  for (const kase of [UNDER_WAY, DECIDED]) {
    const claim = await read(`/id/${docs[kase.number]?.properties?.['case:claim']}`);
    if (
      claim?.properties?.['claim:number'] !== kase.claim ||
      claim?.state !== 'denied' ||
      claim?.properties?.['claim:status'] !== 'denied'
    )
      notDenied.push(
        `${kase.number}'s ${kase.claim} (${claim?.state}, ${claim?.properties?.['claim:status']})`,
      );
    claims[kase.number] = claim;
  }
  h.requirePrecondition(
    'each appeal links to its claim, which the server has denied, state and status',
    notDenied.length === 0,
    `not a denied claim: ${notDenied.join(', ')}. Run demo/seed.mjs against this server`,
  );

  // What the dev server serves at /agentic-ui-config/ must be the kit's own Case page and labels:
  // they are what the rest of this run asserts the page was drawn from.
  const servedLayout = unwrap(
    await page.request
      .get(`${h.baseUrl}/agentic-ui-config/${CASE_LAYOUT}`)
      .then((r) => (r.ok() ? r.json() : null))
      .catch(unread),
  );
  const differing = [];
  for (const file of SERVED.filter((each) => each !== CASE_LAYOUT)) {
    const served = await page.request
      .get(`${h.baseUrl}/agentic-ui-config/${file}`)
      .then((r) => (r.ok() ? r.json() : null))
      .catch(unread);
    if (!sameJson(unwrap(served).content, kitFile(file))) differing.push(file);
  }
  if (!sameJson(servedLayout.content, kitFile(CASE_LAYOUT))) differing.push(CASE_LAYOUT);
  h.requirePrecondition(
    "the dev server serves the kit's Case page, home, menu, open-appeals queue and labels",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  // What makes step 6's checks able to fail: two open appeals, in two states and due on two days,
  // a decided appeal and an open grievance, which the queue must leave out.
  const open = CASES.filter((kase) => isOpenAppeal(kase, OPEN));
  const expectedQueue = openAppealRows();
  h.requirePrecondition(
    'data.mjs seeds two open appeals in two states, a decided one and an open grievance',
    open.length >= 2 &&
      new Set(open.map((kase) => kase.state)).size >= 2 &&
      new Set(open.map((kase) => kase.due)).size === open.length &&
      CASES.some((kase) => kase.category === 'appeal' && !isOpenAppeal(kase, OPEN)) &&
      CASES.some((kase) => kase.category !== 'appeal' && OPEN.states.includes(kase.state)),
    `open ${JSON.stringify(open.map((kase) => [kase.number, kase.state, kase.due]))}: change data.mjs`,
  );
  // The demo counts exactly: a case on the server the seed did not write would be in its figures.
  const served = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/search/pp/${OPEN_APPEALS}/execute`, {
      params: { pageSize: '100', currentPageIndex: '0' },
      headers: { properties: '*' },
    })
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  const servedOrder = (served?.entries ?? []).map((entry) => entry.properties?.['case:number']);
  h.requirePrecondition(
    `the server's ${OPEN_APPEALS} holds the seeded open appeals and nothing else`,
    served !== null && sameJson([...servedOrder].sort(), [...expectedQueue].sort()),
    `it answered ${served === null ? 'nothing' : JSON.stringify(servedOrder)}, the seed ` +
      `${JSON.stringify(expectedQueue)}: install the kit 0.6.0, run demo/seed.mjs, and use a server ` +
      'without other appeals',
  );
  // What step 7 needs: the specialist may change the appeal, as 0.6.0's seed grants member services.
  const mayWrite = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/id/${docs[UNDER_WAY.number]?.uid}`, {
      headers: { 'enrichers-document': 'permissions' },
    })
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  h.requirePrecondition(
    `${APPEALS_SPECIALIST} may change ${UNDER_WAY.number}, so its page offers tick boxes`,
    (mayWrite?.contextParameters?.permissions ?? []).includes('WriteProperties'),
    `their permissions there are ${JSON.stringify(mayWrite?.contextParameters?.permissions ?? null)}: run demo/seed.mjs of 0.6.0`,
  );

  // ── 1. The appeal under way ────────────────────────────────────────────────────────────────
  await h.step('6.1 Open an appeal case: its checklist, from the Case page, and its claim');
  await h.login();
  await h.goToDoc(docs[UNDER_WAY.number].uid);
  await caseSettled(page, ['case', 'checklist', 'history']);
  const underWay = await readCase(page);
  const fileCards = kitFile(CASE_LAYOUT).cards.map((card) => card.id);
  h.check(
    "the appeal's page draws the Case layout's cards, in its order, the checklist among them",
    JSON.stringify(underWay.cards) === JSON.stringify(fileCards),
    `drawn ${JSON.stringify(underWay.cards)}, file ${JSON.stringify(fileCards)}`,
  );
  h.check(
    `the checklist card is headed from the labels: ${labels['payers.appeal.checklist']}`,
    underWay.heading === labels['payers.appeal.checklist'],
    String(underWay.heading),
  );
  const underWayRows = expectedRows(UNDER_WAY);
  h.check(
    "the checklist lists the file's items, in its order, each with the labels' words",
    sameJson(
      underWay.rows.map((row) => [row.item, row.label]),
      underWayRows.map((row) => [row.item, row.label]),
    ),
    `drawn ${JSON.stringify(underWay.rows.map((row) => [row.item, row.label]))}`,
  );
  h.check(
    'each done item shows Done, who did it by name and the day, as the seed wrote them',
    sameJson(
      underWay.rows.filter((row) => row.done === 'true'),
      underWayRows.filter((row) => row.done === 'true'),
    ),
    `drawn ${JSON.stringify(underWay.rows.filter((row) => row.done === 'true'))}`,
  );
  const notDone = underWay.rows.filter((row) => row.done === 'false');
  h.check(
    `each item not done shows Not done, with no one and no day: ${stale.map((entry) => entry.item).join(', ')} though its entry names both, and ${unrecorded.map((item) => item.id).join(', ')} with no entry at all`,
    sameJson(
      notDone,
      underWayRows.filter((row) => row.done === 'false'),
    ) &&
      notDone.every((row) => row.by === null && row.on === null) &&
      [...stale.map((entry) => entry.item), ...unrecorded.map((item) => item.id)].every((id) =>
        notDone.some((row) => row.item === id),
      ),
    `drawn ${JSON.stringify(notDone)}`,
  );
  const doneCount = underWayRows.filter((row) => row.done === 'true').length;
  h.check(
    `the count says ${doneCount} of ${underWayRows.length} done`,
    underWay.count === `${doneCount} of ${underWayRows.length} done`,
    String(underWay.count),
  );
  const claim = claims[UNDER_WAY.number];
  h.check(
    `the appeal links to its claim, ${UNDER_WAY.claim}, by its title, to the claim's own page`,
    underWay.claim?.text === claim?.title &&
      (underWay.claim?.href ?? '').includes(claim?.uid ?? '-'),
    JSON.stringify(underWay.claim),
  );
  await h.screenshot('appeal-under-way-checklist', page.locator('[data-card-id="checklist"]'));
  await page
    .locator('[data-field="case:claim"] a')
    .first()
    .click({ timeout: 10_000 })
    .catch(deferred);
  await page
    .waitForSelector('.record-page__card [data-field="claim:status"]', { timeout: 30_000 })
    .catch(deferred);
  const opened = await page
    .locator('.record-page__card [data-field="claim:status"] dd')
    .first()
    .innerText({ timeout: 10_000 })
    .catch(unread);
  h.check(
    'the link opens the claim, which its record page shows denied',
    page.url().includes(claim?.uid ?? '-') && /^\s*denied\s*$/i.test(opened ?? ''),
    `${page.url()}: ${String(opened)}`,
  );
  await h.screenshot('appeal-claim-denied', page.locator('.record-page__card').first());

  // ── 2. Its timeline ────────────────────────────────────────────────────────────────────────
  await h.step("6.2 The appeal's timeline: the server's audit of the case, newest first");
  await h.goToDoc(docs[UNDER_WAY.number].uid);
  await caseSettled(page, ['case', 'checklist', 'history']);
  const drawnTimeline = (await readCase(page)).timeline;
  const timelineCard = kitFile(CASE_LAYOUT).cards.find((card) => card.id === 'history')?.timeline;
  const kinds = timelineCard?.events ?? DEFAULT_EVENTS;
  const pageSize = timelineCard?.pageSize ?? 10;
  const audit = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/id/${docs[UNDER_WAY.number].uid}/@audit`, {
      params: new URLSearchParams([
        ['pageSize', String(pageSize)],
        ['currentPageIndex', '0'],
        ['sortBy', 'eventDate'],
        ['sortOrder', 'desc'],
        ...kinds.map((kind) => ['eventId', kind]),
      ]),
    })
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  const audited = (audit?.entries ?? []).map((entry) => ({ id: entry.id, event: entry.eventId }));
  h.check(
    `the timeline shows the case's audit, its first ${pageSize} entries of the card's kinds, newest first`,
    audit !== null && audited.length > 0 && sameJson(drawnTimeline, audited),
    `drawn ${JSON.stringify(drawnTimeline)}, audit ${JSON.stringify(audited)}`,
  );
  // The negative side, only where it can fail: the case's whole audit, of every kind, and the
  // entries of the kinds the card leaves out, none of which may be drawn.
  const everything = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/id/${docs[UNDER_WAY.number].uid}/@audit`, {
      params: new URLSearchParams([
        ['pageSize', '100'],
        ['currentPageIndex', '0'],
      ]),
    })
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  const outside = (everything?.entries ?? []).filter((entry) => !kinds.includes(entry.eventId));
  h.check(
    "the case's audit is read with no kind filter, its first 100 entries, to tell the timeline's filter apart",
    Array.isArray(everything?.entries),
    `GET @audit with no kind answered ${everything === null ? 'nothing' : 'no list'}`,
  );
  if (outside.length > 0) {
    h.check(
      `none of the ${outside.length} audit entries of a kind the card leaves out is drawn`,
      !drawnTimeline.some((entry) => outside.some((other) => other.id === entry.id)),
      `left out ${JSON.stringify([...new Set(outside.map((entry) => entry.eventId))])}`,
    );
  } else {
    h.note(
      "the case's audit, in its first 100 entries, holds no event outside the timeline's kinds, " +
        'so its filter is not told apart from no filter here: record-timeline.spec.ts holds its ' +
        'request to the kinds',
    );
  }
  await h.screenshot('appeal-timeline', page.locator('[data-card-id="history"]'));

  // ── 3. The decided appeal ──────────────────────────────────────────────────────────────────
  await h.step('6.3 A decided appeal: the same items, every one done');
  await h.goToDoc(docs[DECIDED.number].uid);
  await caseSettled(page, ['case', 'checklist', 'history']);
  const decided = await readCase(page);
  const decidedRows = expectedRows(DECIDED);
  h.check(
    "the same items, in the same order and words, as the appeal under way: the file's, not the record's",
    sameJson(
      decided.rows.map((row) => [row.item, row.label]),
      underWay.rows.map((row) => [row.item, row.label]),
    ) && decided.rows.length === CHECKLIST.items.length,
    `drawn ${JSON.stringify(decided.rows.map((row) => row.item))}`,
  );
  h.check(
    `every item done, each by the person and on the day the seed wrote, ${decidedRows.length} of ${decidedRows.length}`,
    sameJson(decided.rows, decidedRows) &&
      decidedRows.every((row) => row.done === 'true') &&
      decided.count === `${decidedRows.length} of ${decidedRows.length} done`,
    `drawn ${JSON.stringify(decided.rows)}; ${decided.count}`,
  );
  await h.screenshot('appeal-decided-checklist', page.locator('[data-card-id="checklist"]'));

  // ── 4. A grievance ─────────────────────────────────────────────────────────────────────────
  await h.step('6.4 A grievance: no checklist, by its rule, and still its timeline');
  await h.goToDoc(docs[GRIEVANCE.number].uid);
  await caseSettled(page, ['case', 'history']);
  const grievance = await readCase(page);
  h.check(
    'a grievance shows no checklist card, which the Case page shows to appeals only',
    !grievance.cards.includes('checklist') && grievance.rows.length === 0,
    JSON.stringify(grievance.cards),
  );
  h.check(
    "its page is still the Case layout's, its timeline drawn",
    JSON.stringify(grievance.cards) ===
      JSON.stringify(fileCards.filter((id) => id !== 'checklist')),
    JSON.stringify(grievance.cards),
  );
  await h.screenshot('grievance-without-checklist');

  // ── 5. The configuration behind it ─────────────────────────────────────────────────────────
  await h.step('6.5 The configuration behind it: the Case layout, and no code');
  h.check(
    "the Case layout the dev server serves is the kit's file, layouts/Case/view.layout.json",
    typeof servedLayout.source === 'string' &&
      resolve(REPO, servedLayout.source) === join(CONFIG, CASE_LAYOUT),
    `served from ${servedLayout.source}`,
  );
  const code = codeIn(join(KIT, 'bundle'), ROUTE_MODEL_ZIP, KIT);
  h.check(
    "the kit's bundle holds no code: JSON, XML, XSD, its manifest, vocabularies' CSV and the " +
      "route model's zip of XML documents only",
    code.length === 0,
    `code in the bundle: ${code.join(', ')}`,
  );

  // ── 6. The open appeals ────────────────────────────────────────────────────────────────────
  await h.step('6.6 The open appeals: from the home and the menu, in order, and narrowed');
  await h.goTo('/#/home');
  await page
    .waitForFunction(
      () =>
        document.querySelector('li.home-card[data-card-id="appeals"] .home-card__figure') !==
          null && document.querySelector('.home-page [role="status"]') === null,
      undefined,
      { timeout: 30_000 },
    )
    .catch(deferred);
  const homeCard = await page
    .evaluate(() => {
      const card = document.querySelector('li.home-card[data-card-id="appeals"]');
      return card
        ? {
            title: card.querySelector('.home-card__title, .home-card__queue')?.textContent?.trim(),
            figure: card.querySelector('.home-card__figure')?.textContent?.trim() ?? null,
            link: card.querySelector('a.home-card__link')?.getAttribute('href') ?? null,
          }
        : null;
    })
    .catch(unread);
  h.check(
    `member services' home counts the ${expectedQueue.length} open appeals, from ${OPEN_APPEALS}`,
    homeCard?.figure === String(expectedQueue.length) &&
      homeCard?.title === labels['payers.home.appeals'],
    JSON.stringify(homeCard),
  );
  const menu = await page
    .evaluate(() =>
      [...document.querySelectorAll('a[data-nav-id^="appMenu."]')].map((a) =>
        a.getAttribute('data-nav-id'),
      ),
    )
    .catch(unread);
  h.check(
    "member services' menu lists the open appeals",
    Array.isArray(menu) && menu.includes('appMenu.appeals'),
    JSON.stringify(menu),
  );
  await page
    .locator('li.home-card[data-card-id="appeals"] a.home-card__link')
    .click({ timeout: 10_000 })
    .catch(deferred);
  await page.waitForURL(/#\/queues\/open-appeals$/, { timeout: 15_000 }).catch(deferred);
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      expectedQueue.length,
      { timeout: 30_000 },
    )
    .catch(deferred);
  const queueRows = await readCaseRows(page).catch(unread);
  h.check(
    'the home opens /queues/open-appeals, titled from its labelKey',
    page.url().endsWith('#/queues/open-appeals') &&
      (await page.locator('.queue-page__title').textContent().catch(unread))?.trim() ===
        labels['payers.queue.appeals'],
    page.url(),
  );
  h.check(
    `the queue lists the appeals not decided, the nearest due first, in the server's order: ${expectedQueue.join(', ')}`,
    sameJson(queueRows, expectedQueue) && sameJson(queueRows, servedOrder),
    `drawn ${JSON.stringify(queueRows)}, server ${JSON.stringify(servedOrder)}`,
  );
  const leftOut = CASES.filter(
    (kase) => !isOpenAppeal(kase, OPEN) && OPEN.states.includes(kase.state),
  ).map((kase) => kase.number);
  h.check(
    `neither the decided appeal, ${DECIDED.number}, nor an open grievance, ${leftOut.join(', ')}, is in it`,
    Array.isArray(queueRows) &&
      !queueRows.includes(DECIDED.number) &&
      leftOut.every((number) => !queueRows.includes(number)),
    JSON.stringify(queueRows),
  );
  const stateFacet = await readFacet(page, 'case_state_agg').catch(unread);
  h.check(
    'the State facet counts the open appeals by state, from the aggregate',
    sameJson(
      stateFacet,
      countBy(open, (kase) => kase.state),
    ),
    `drawn ${JSON.stringify(stateFacet)}`,
  );
  // One state, held by some of the open appeals only, so that choosing it narrows the queue.
  const chosen = open.find((kase) => open.some((other) => other.state !== kase.state)).state;
  const narrowed = page
    .waitForRequest(
      (request) =>
        request.url().includes(`/search/pp/${OPEN_APPEALS}/execute`) &&
        new URL(request.url()).searchParams.get('case_state_agg') === JSON.stringify([chosen]),
      { timeout: 15_000 },
    )
    .catch(unread);
  await page
    .locator('fieldset.queue-facet[data-aggregate="case_state_agg"] .queue-facet__bucket', {
      hasText: new RegExp(`^\\s*${chosen}\\b`),
    })
    .locator('input')
    .click()
    .catch(deferred);
  const sentNarrowed = await narrowed;
  const expectedNarrowed = expectedQueue.filter(
    (number) => CASES.find((kase) => kase.number === number).state === chosen,
  );
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      expectedNarrowed.length,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const narrowedRows = await readCaseRows(page).catch(unread);
  h.check(
    `narrowed to ${chosen} on the server, the queue keeps ${expectedNarrowed.join(', ')} only`,
    sentNarrowed !== null && sameJson(narrowedRows, expectedNarrowed),
    `request ${sentNarrowed ? 'sent' : 'not seen'}, drawn ${JSON.stringify(narrowedRows)}`,
  );
  await h.screenshot('open-appeals-queue');

  // ── 7. Ticking an item ─────────────────────────────────────────────────────────────────────
  await h.step('6.7 Tick an item on the appeal under way, untick it, and put it back');
  const caseUid = docs[UNDER_WAY.number].uid;
  // An item the appeal has no entry for: ticking it adds one, and every other entry stays.
  const item = CHECKLIST.items.find(
    (each) => !(UNDER_WAY.checklist ?? []).some((entry) => entry.item === each.id),
  );
  const seeded = (UNDER_WAY.checklist ?? []).map(entryOf);
  const heldNow = async () =>
    ((await read(`/id/${caseUid}`))?.properties?.[CHECKLIST.field] ?? null)?.map?.((entry) => ({
      ...entryOf(entry),
      doneOnInstant: entry?.doneOn ?? null,
    })) ?? null;
  await h.goToDoc(caseUid);
  await caseSettled(page, ['case', 'checklist', 'history']);
  const boxes = await page
    .evaluate(() =>
      [
        ...document.querySelectorAll(
          '.record-page__card[data-card-id="checklist"] li input[type="checkbox"]',
        ),
      ].map((input) => ({
        item: input.closest('li')?.getAttribute('data-item'),
        name: [...(input.labels ?? [])].map((label) => label.textContent?.trim()).join(' '),
        checked: input.checked,
      })),
    )
    .catch(unread);
  const rows = expectedRows(UNDER_WAY);
  h.check(
    'the specialist, who may change the case, is offered a tick box per item, named by its words, ticked as the record says',
    sameJson(
      boxes,
      rows.map((row) => ({ item: row.item, name: row.label, checked: row.done === 'true' })),
    ),
    JSON.stringify(boxes),
  );
  const box = page.locator(
    `.record-page__card[data-card-id="checklist"] li[data-item="${item?.id}"] input[type="checkbox"]`,
  );
  const tickedAt = Date.now();
  const putTick = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url().includes(`/api/v1/id/${caseUid}`),
      { timeout: 15_000 },
    )
    .catch(unread);
  await box.click({ timeout: 10_000 }).catch(deferred);
  const tickAnswer = await putTick;
  await page
    .waitForSelector(
      `.record-page__card[data-card-id="checklist"] li[data-item="${item?.id}"][data-done="true"]`,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const afterTick = await heldNow();
  const tickEntry = afterTick?.find((entry) => entry.item === item?.id);
  const tickedOn = Date.parse(tickEntry?.doneOnInstant ?? '');
  h.check(
    `the tick is written: ${item?.id} done, by ${APPEALS_SPECIALIST}, now, and every other entry as the seed wrote it`,
    tickAnswer?.status() === 200 &&
      tickEntry?.done === true &&
      tickEntry?.doneBy === APPEALS_SPECIALIST &&
      tickedOn >= tickedAt - 120_000 &&
      tickedOn <= Date.now() + 120_000 &&
      sameJson(
        afterTick
          .filter((entry) => entry.item !== item?.id)
          .map(({ doneOnInstant, ...entry }) => entry),
        seeded,
      ),
    `PUT ${tickAnswer?.status() ?? 'not seen'}; held ${JSON.stringify(afterTick)}`,
  );
  const tickedRow = (await readCase(page)).rows.find((row) => row.item === item?.id);
  const today = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(
    new Date(tickEntry?.doneOnInstant ?? 0),
  );
  h.check(
    `the page shows it done, by ${nameOf(APPEALS_SPECIALIST)}, on ${today}`,
    tickedRow?.done === 'true' &&
      tickedRow?.state === 'Done' &&
      tickedRow?.by === nameOf(APPEALS_SPECIALIST) &&
      tickedRow?.on === today,
    JSON.stringify(tickedRow),
  );
  // Who really changed it is the server's to say: its audit of the case, newest first.
  let author = null;
  for (let attempt = 0; attempt < 10 && author === null; attempt++) {
    const entries =
      (
        await page.request
          .get(`${h.baseUrl}/nuxeo/api/v1/id/${caseUid}/@audit`, {
            params: new URLSearchParams([
              ['pageSize', '5'],
              ['sortBy', 'eventDate'],
              ['sortOrder', 'desc'],
              ['eventId', 'documentModified'],
            ]),
          })
          .then((r) => (r.ok() ? r.json() : null))
          .catch(unread)
      )?.entries ?? [];
    author = entries.find((entry) => Date.parse(entry.eventDate ?? '') >= tickedAt - 5_000) ?? null;
    if (author === null) await page.waitForTimeout(1000);
  }
  h.check(
    `the server's audit says ${APPEALS_SPECIALIST} changed the case, whatever doneBy says`,
    author?.principalName === APPEALS_SPECIALIST,
    JSON.stringify(author),
  );
  await h.screenshot('appeal-item-ticked', page.locator('[data-card-id="checklist"]'));

  const putUntick = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url().includes(`/api/v1/id/${caseUid}`),
      { timeout: 15_000 },
    )
    .catch(unread);
  await box.click({ timeout: 10_000 }).catch(deferred);
  const untickAnswer = await putUntick;
  await page
    .waitForSelector(
      `.record-page__card[data-card-id="checklist"] li[data-item="${item?.id}"][data-done="false"]`,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const afterUntick = await heldNow();
  const untickEntry = afterUntick?.find((entry) => entry.item === item?.id);
  const untickedRow = (await readCase(page)).rows.find((row) => row.item === item?.id);
  h.check(
    `unticked, the entry stays, not done, and the page shows ${item?.id} not done, with no one and no day`,
    untickAnswer?.status() === 200 &&
      untickEntry?.done === false &&
      untickEntry?.doneBy === APPEALS_SPECIALIST &&
      untickedRow?.state === 'Not done' &&
      untickedRow?.by === null &&
      untickedRow?.on === null,
    `held ${JSON.stringify(untickEntry)}; drawn ${JSON.stringify(untickedRow)}`,
  );

  // Put back as the seed wrote it, so that the next run's preconditions hold.
  const putBack = await page.request
    .put(`${h.baseUrl}/nuxeo/api/v1/id/${caseUid}`, {
      data: {
        'entity-type': 'document',
        properties: {
          [CHECKLIST.field]: (UNDER_WAY.checklist ?? []).map(
            ({ item: id, done, doneBy, doneOn }) => ({
              item: id,
              done,
              doneBy: doneBy ?? null,
              doneOn: doneOn ?? null,
            }),
          ),
        },
      },
    })
    .catch(unread);
  const restored = (await heldNow())?.map(({ doneOnInstant, ...entry }) => entry) ?? null;
  h.check(
    `${UNDER_WAY.number}'s checklist is put back as the seed wrote it`,
    putBack?.ok() === true && sameJson(restored, seeded),
    `PUT ${putBack?.status() ?? 'failed'}; held ${JSON.stringify(restored)}. Run demo/seed.mjs to put it back`,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "the server's own install is not what the app read: under the dev server the Case layout, " +
      'home, menu and queue come from config:dev',
  );
  h.note(
    'someone who may not change a case is offered no tick box, and a refused write leaves the ' +
      "card as it was: the record page's own tests show both (record-page.checklist-ticks.spec.ts)",
  );
  h.note(
    "who may change a case's checklist is the server's permissions, not the card: since 0.6.0 " +
      'member services may change cases, and the claims groups may not',
  );
}
