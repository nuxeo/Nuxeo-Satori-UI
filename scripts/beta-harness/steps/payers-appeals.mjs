/**
 * The Payers kit's appeals: business apps phase 2's demo step 6, end to end
 * (docs/business-apps/development-plan.md, phase 2, "Demo"), on the kit in
 * `business-apps/packages/payers-claims-demo`, version 0.4.1 or later.
 *
 *   6. Open an appeal case with its checklist and timeline.
 *
 * An appeal is a Case of the category `appeal`, opened against a denied claim, which it links to.
 * Its record page is the kit's Case layout (`bundle/agentic-ui-config/layouts/Case/view.layout.json`):
 * a checklist card, layout version 2's (layout-v2.md, section 7), whose items the file lists and
 * whose state, done or not with who and when, the case's `case:checklist` holds; and a timeline
 * card, the case's audit. The steps:
 *
 *   1. The appeal under way, CASE-2041: the file's items, in its order, with the labels' words,
 *      the two done each with who and when, the three not done with neither, and the count; its
 *      claim's link, which opens the claim, denied.
 *   2. Its timeline: the server's audit of the case, newest first, of the card's kinds only.
 *   3. The decided appeal, CASE-2043: the same items, in the same order, every one done, by the
 *      people and on the days the seed wrote. The items are the file's, the state the record's.
 *   4. A grievance, CASE-2042: no checklist, by the card's rule, and still its timeline.
 *   5. The configuration behind it: the Case layout served is the kit's file, and the bundle holds
 *      no code.
 *
 * The rows, names and days it expects are read from the kit's own files: `demo/data.mjs` for the
 * cases, their claims and the people, and the Case layout and the labels for the items and their
 * words, through `demo/appeals.mjs`, as the seed reads them. So a change to either is a change to
 * what the demo asserts.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, version 0.4.1 or later (its `case:checklist`), and
 *   seeded with `demo/seed.mjs`, which writes the appeals, their claims and the people.
 * - **The run's own user is the appeals' specialist:** `NUXEO_USER` is `APPEALS_SPECIALIST` of
 *   `data.mjs`, in `member-services` and neither claims group, and `NUXEO_PASS` the demo password.
 *   It reads and changes nothing, so it signs no one else in.
 * - The dev server with `npm run config:dev` serving the kit's Case layout and labels (the kit's
 *   README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=sam.patel NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-appeals
 *
 * Load-bearing checks: each appeal's checklist rows, item by item, against the file and the seed,
 * and its count; the claim link's text, its address and the claim it opens, denied; the timeline's
 * entries against the server's audit, in order; the decided appeal's items the same as the one
 * under way's; the served Case layout the kit's file. Negative ones: no one and no day on an item
 * not done, two of them with no entry on the record at all; no timeline entry of a kind outside
 * the card's; no checklist on a grievance, whose timeline still draws.
 *
 * Not covered, and said in notes: ticking an item, which the card does not do (it is read-only,
 * and decision 3 builds no operation buttons); the server's own install (the dev server serves the
 * layout from `config:dev`); and who may change a case's checklist through the API.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';
import { codeIn } from './payers-claims-demo/bundle-data.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { APPEALS_SPECIALIST, CASES, CLAIMS, USERS } = await import(join(KIT, 'demo', 'data.mjs'));
const { appealProblems, appealRows, readAppealChecklist } = await import(
  join(KIT, 'demo', 'appeals.mjs')
);
const { ZIP_PATH: ROUTE_MODEL_ZIP } = await import(join(KIT, 'workflow', 'route-model.mjs'));

const CASE_LAYOUT = 'layouts/Case/view.layout.json';
const CASES_FOLDER = '/default-domain/workspaces/payers-demo/cases';

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
  const [prefix, property] = CHECKLIST.field.split(':');
  const schema = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/config/schemas/${prefix}`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  h.requirePrecondition(
    `the kit 0.4.1 or later is installed: ${CHECKLIST.field} is on the server`,
    Boolean(schema?.fields && Object.hasOwn(schema.fields, property)),
    `GET /config/schemas/${prefix} has no ${property}: install the kit (README)`,
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
      !sameJson(held, kase.checklist ?? [])
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
  const servedLabels = await page.request
    .get(`${h.baseUrl}/agentic-ui-config/labels/en.json`)
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  h.requirePrecondition(
    "the dev server serves the kit's Case page and its labels",
    sameJson(servedLayout.content, kitFile(CASE_LAYOUT)) &&
      sameJson(servedLabels, kitFile('labels/en.json')),
    "not the kit's: run the README's config:dev command, then restart the dev server",
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
  const unrecorded = CHECKLIST.items.filter(
    (item) => !(UNDER_WAY.checklist ?? []).some((entry) => entry.item === item.id),
  );
  h.check(
    `each item not done shows Not done, with no one and no day, ${unrecorded.length} of them with no entry on the record`,
    sameJson(
      notDone,
      underWayRows.filter((row) => row.done === 'false'),
    ) &&
      notDone.every((row) => row.by === null && row.on === null) &&
      unrecorded.length > 0 &&
      unrecorded.every((item) => notDone.some((row) => row.item === item.id)),
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
  h.check(
    "no entry is of a kind outside the card's: no download, no login",
    drawnTimeline.length > 0 && drawnTimeline.every((entry) => kinds.includes(entry.event)),
    JSON.stringify(drawnTimeline.map((entry) => entry.event)),
  );
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

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    'ticking an item is not covered: the checklist card is read-only, and decision 3 builds no ' +
      "operation buttons, so a case's checklist changes through its Edit form or the API",
  );
  h.note(
    "the server's own install is not what the app read: under the dev server the Case layout " +
      'comes from config:dev',
  );
  h.note(
    "who may change a case's checklist is the server's permissions, not the card: the demo's " +
      'groups read cases and change none',
  );
}
