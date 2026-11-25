/**
 * The Payers kit's demo script: business apps phase 1's five demo steps, end to end
 * (docs/business-apps/development-plan.md, phase 1, "Demo"), on the kit in
 * `business-apps/packages/payers-claims-demo`.
 *
 *   1. An adjuster's home, with KPIs from the page providers' aggregates.
 *   2. A queue opened, its rows in the server's order, and narrowed by a facet on the server.
 *   3. A member, opened from the queue's member link: age, combined address, and the member's
 *      claims and cases.
 *   4. Member services see the social security number, which an adjuster does not.
 *   5. The layout file behind the page: configuration, no code.
 *
 * Step 4 follows the Member page the kit has, layout-v2.md's section 9: the number shows to member
 * services alone, and is left out, not masked, for everyone else. The plan's wording, "the
 * protected fields are masked on screen", was written before that page; masking the value itself
 * is decision I.
 *
 * The figures, rows and values it expects are read from the kit's own files, `demo/data.mjs` and
 * `bundle/agentic-ui-config/`, so a change to the records is a change to what the demo asserts.
 * The demo's own choices are written here: which cards each group's home shows (`ADJUSTER_CARDS`,
 * `SERVICES_CARDS`, so a rule changed in `home.json` fails the demo), the member it opens
 * (`MEMBER`) and the facet bucket it picks, one of the adjuster's statuses.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The kit installed on the local Nuxeo, version 0.3.0 or later (its queue page providers), and
 *   seeded with `demo/seed.mjs`, which creates the demo's people.
 * - The dev server with `npm run config:dev` serving the kit's files (the kit's README, "Seeing
 *   it under nx serve"). A server's app registry serves the home, the menu, the queues and the
 *   labels too, after sign-in, and the files `config:dev` serves win over it.
 * - **The run's own user is an adjuster, and only that:** `NUXEO_USER` one of `data.mjs`'s users
 *   whose one group is `claims-adjusters`, such as `dana.lee`, and `NUXEO_PASS` the demo password.
 *   Step 1 signs in as them. A supervisor's home has member services' cards too.
 * - **No claim the seed did not write is in what the demo counts:** the figures are counted
 *   exactly, so such a claim in a queue, or a seeded member's, would change them.
 * - `PAYERS_DEMO_PASSWORD`, the password the seed gave the demo's people: step 4 signs the browser
 *   in as a member of `member-services` with it, declared with `h.signedInAs`.
 *
 *   NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-claims-demo
 *
 * Load-bearing checks, by step: the home's cards and their figures as the seed implies them, the
 * other group's cards absent; the queue's rows in the server's order, and narrowed by a facet on
 * the server; the queue's member link, named for the member and linking to it; the member's age,
 * address and related lists; the SSN nowhere on the adjuster's
 * Member page with the Properties panel drawn, and the adjuster unable to change the member, whose
 * Edit form would list it; the SSN on member services' Member card; the served layout file the
 * kit's own, and the page drawn as it says. Negative ones: the other group's cards and menu
 * entries, the SSN, and the adjuster's right to change a member, absent.
 *
 * Not covered, and said in notes: the server's own install (the dev server reads the layouts from
 * `config:dev`, not from the package), and the package's own actions (`actions.json` is not served
 * yet, so the approve button is left out of the queue's rows).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';
import { codeIn } from './payers-claims-demo/bundle-data.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { CASES, CLAIMS, MEMBERS, USERS } = await import(join(KIT, 'demo', 'data.mjs'));
/** The route model's zip, relative to the bundle, as the kit's workflow component names it. */
const { ZIP_PATH: ROUTE_MODEL_ZIP } = await import(join(KIT, 'workflow', 'route-model.mjs'));

/** A demo adjuster and nothing else, as the run's own user must be: step 1 signs in as them. */
const adjustersOnly = (user) =>
  JSON.stringify(user?.groups) === JSON.stringify(['claims-adjusters']);
/** The member services person step 4 signs the browser in as. */
const SERVICES = USERS.find((user) => user.groups.includes('member-services'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here: the kit, the
 * seeds to run first, who `NUXEO_USER` must be, who else it signs in as, and what
 * else must be in place. The people are the ones the preconditions below hold the run to.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: USERS.filter(adjustersOnly).map((user) => user.username),
    who: 'a demo adjuster, in claims-adjusters and in no other group',
  },
  signsInAs: [SERVICES.username],
  needs: [
    'the kit 0.3.0 or later installed, and no claim or case the seed did not write',
    "the dev server with `npm run config:dev` serving the kit's files",
  ],
};

/** The session `AuthService` keeps, which the app's interceptor reads: helpers.mjs's key. */
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/** The home's cards an adjuster sees, and member services see: the demo's two groups. */
const ADJUSTER_CARDS = ['unassigned', 'unassigned-by-status', 'mine'];
const SERVICES_CARDS = ['pending', 'pended'];

/** The member the demo opens: the one whose claims are the adjuster's, as in layout-v2.md. */
const MEMBER = MEMBERS.find((member) => member.number === 'MEMBER-100048');

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, which the app's sign-in calls to drop
 * a stale cookie session; `AI.*` operations come from a marketplace package this server may lack;
 * and the shell's recently-viewed list asks for a thumbnail of every document in it
 * (`nav-drawer.component.ts`, `loadThumbnails`), which a record with no file does not have, so
 * Nuxeo answers 404. The list catches it and shows the type's icon; the browser logs the 404.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

/**
 * The handlers of every wait, click and read here whose failure a check after it reports, so that
 * the failure is deferred to the check, not lost. A wait that times out leaves the page as it was,
 * and the next check reads what was drawn and fails with it, which says more than a timeout; a
 * click that misses leaves the page unchanged, and so fails the same check. A read that fails
 * gives `null`, which every check or precondition that reads it refuses, with what it found.
 */
const deferred = () => undefined;
const unread = () => null;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;

/** Whole years from `birth` (YYYY-MM-DD) to today, in this machine's time zone, as the browser's */
function ageToday(birth) {
  const [year, month, day] = birth.split('-').map(Number);
  const today = new Date();
  const before =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  return today.getFullYear() - year - (before ? 1 : 0);
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

/**
 * A served file as the app reads it. A layout comes in the servlet's envelope, as `config:dev`
 * writes it too: its `content`, and the `source` it was read from. The home, the menu, the queues
 * and the labels come as the package writes them, with no envelope.
 */
function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

/** Counts of `items` by `key`, as a plain object with sorted keys. */
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return canonical(counts);
}

/** The home's cards as drawn: id, title, figure and buckets. */
function readHome(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('li.home-card')].map((card) => ({
      id: card.getAttribute('data-card-id'),
      title: card.querySelector('.home-card__title, .home-card__queue')?.textContent?.trim() ?? '',
      figure: card.querySelector('.home-card__figure')?.textContent?.trim() ?? null,
      buckets: Object.fromEntries(
        [...card.querySelectorAll('.home-card__bucket')].map((bucket) => [
          bucket.querySelector('dt')?.textContent?.trim(),
          Number(bucket.querySelector('dd')?.textContent?.trim()),
        ]),
      ),
      link: card.querySelector('a.home-card__link')?.getAttribute('href') ?? null,
    })),
  );
}

/** The home has drawn every card it shows, figures included. */
async function homeSettled(page) {
  await page
    .waitForFunction(
      () =>
        document.querySelector('li.home-card') !== null &&
        document.querySelector('.home-page [role="status"]') === null,
      undefined,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/** The app's own menu entries, from `navigation.json`, as drawn: their nav ids. */
function readAppMenu(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[data-nav-id^="appMenu."]')].map((a) =>
      a.getAttribute('data-nav-id'),
    ),
  );
}

/** The claim numbers of a list's rows, in the order drawn. */
function readClaimRows(page, root) {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} tbody tr`)]
        .map((row) => /CLAIM-\d+/.exec(row.textContent ?? '')?.[0] ?? null)
        .filter(Boolean),
    root,
  );
}

/** The record page as drawn: each card's id, heading, fields and rows. */
function readRecordPage(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.record-page__card')].map((card) => ({
      id: card.getAttribute('data-card-id'),
      heading: card.querySelector('.record-page__heading')?.textContent?.trim() ?? null,
      fields: [...card.querySelectorAll('.record-page__field')].map((field) => ({
        key: field.getAttribute('data-field'),
        label: field.querySelector('dt')?.textContent?.trim() ?? '',
        value: (field.querySelector('dd')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      })),
      rows: [...card.querySelectorAll('tbody tr')].map((row) =>
        (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
      ),
    })),
  );
}

/** The record page has drawn its cards and their related lists' rows. */
async function recordSettled(page, cards) {
  await page
    .waitForFunction(
      (ids) =>
        ids.every((id) => document.querySelector(`.record-page__card[data-card-id="${id}"]`)) &&
        [...document.querySelectorAll('.record-page__card lib-record-list')].every(
          (list) => list.querySelector('tbody tr') !== null,
        ),
      cards,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/** The Properties panel beside the record page has drawn the member's own properties. */
async function panelSettled(page, number) {
  await page
    .waitForFunction(
      (text) => (document.querySelector('nxs-properties-panel')?.textContent ?? '').includes(text),
      number,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/** Who a pair of credentials signs in as on the server, and their groups, asked from Node. */
async function whoIs(baseUrl, username, password) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo/api/v1/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { id: null, groups: [], status: response.status };
    const me = await response.json();
    return {
      id: me?.id ?? null,
      groups: (me?.extendedGroups ?? []).map((group) => group.name),
      status: response.status,
    };
  } catch (error) {
    return { id: null, groups: [], status: String(error?.message ?? error) };
  }
}

/**
 * Every document an NXQL query finds in the repository, as `username`, with `schema`'s properties,
 * from Node: `Repository.Query`, not the search endpoint, whose index can still hold a trashed
 * document. `null` when it is refused, or holds more than one page.
 */
async function repositoryQuery(baseUrl, username, password, query, schema) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo/api/v1/automation/Repository.Query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        properties: schema,
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({ params: { query, pageSize: 1000 } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const page = await response.json();
    return page?.isNextPageAvailable === true ? null : (page?.entries ?? null);
  } catch {
    // Refused or unanswered: the caller says it could not judge, and the precondition fails.
    return null;
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the kit installed and seeded, its files served, its people');
  const { username: adjuster } = requireStepCredentials('sign the demo in as an adjuster');
  const adjusterRecord = USERS.find((user) => user.username === adjuster);
  h.requirePrecondition(
    'the run signs in as one of the demo adjusters, in no other group',
    adjustersOnly(adjusterRecord),
    `NUXEO_USER is ${adjuster}: set it to a user of data.mjs whose one group is ` +
      `claims-adjusters, such as ${USERS.find(adjustersOnly)?.username}, and NUXEO_PASS to the ` +
      'demo password',
  );
  const me = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/me`)
    .then((r) => r.json())
    .catch(unread);
  const myGroups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the adjuster, in claims-adjusters and in neither other demo group',
    me?.id === adjuster &&
      myGroups.includes('claims-adjusters') &&
      !myGroups.includes('member-services') &&
      !myGroups.includes('claims-supervisors'),
    `/me answered ${me?.id} in ${JSON.stringify(myGroups)}: run demo/seed.mjs first`,
  );

  const demoPassword = process.env['PAYERS_DEMO_PASSWORD'] ?? '';
  const services = SERVICES;
  h.requirePrecondition(
    'PAYERS_DEMO_PASSWORD is set, for member services',
    demoPassword !== '',
    'export the password the seed gave the demo users as PAYERS_DEMO_PASSWORD',
  );
  const servicesMe = await whoIs(h.baseUrl, services.username, demoPassword);
  h.requirePrecondition(
    `${services.username} signs in with it, in member-services`,
    servicesMe.id === services.username && servicesMe.groups.includes('member-services'),
    `/me as ${services.username} answered ${servicesMe.status}, ${servicesMe.id}: ` +
      'run demo/seed.mjs with the same PAYERS_DEMO_PASSWORD',
  );

  const searchType = await page.request.get(
    `${h.baseUrl}/nuxeo/api/v1/config/types/PayersClaimSearch`,
  );
  h.requirePrecondition(
    'the kit 0.3.0 or later is installed: its queues search type is on the server',
    searchType.status() === 200,
    `GET /config/types/PayersClaimSearch answered ${searchType.status()}: install the kit (README)`,
  );

  const memberDoc = await page.request
    .get(
      `${h.baseUrl}/nuxeo/api/v1/path/default-domain/workspaces/payers-demo/members/${MEMBER.number.toLowerCase()}`,
    )
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  h.requirePrecondition(
    `the seeded member ${MEMBER.number} is there`,
    memberDoc?.type === 'Member' && memberDoc?.properties?.['member:number'] === MEMBER.number,
    'run demo/seed.mjs against this server',
  );

  // The figures and lists are counted exactly, so no record the seed did not write may be in what
  // they count: a queue's claims, the member's claims, or the member's cases. Asked as each of the
  // two people the demo signs in as, since each counts what they may read, and of the repository,
  // not the index, which can still hold a trashed one. Each seeded claim must come back with its
  // seeded status, or the properties did not arrive and nothing would be judged.
  const seededAt = (folder, number) =>
    `/default-domain/workspaces/payers-demo/${folder}/${number.toLowerCase()}`;
  const counted = {
    Claim: (claim, as) =>
      ((claim['claim:adjuster'] ?? null) === null &&
        ['submitted', 'inReview'].includes(claim['claim:status'])) ||
      ['inReview', 'pended'].includes(claim['claim:status']) ||
      claim['claim:adjuster'] === as ||
      claim['claim:member'] === memberDoc?.uid,
    Case: (kase) => kase['case:member'] === memberDoc?.uid,
  };
  const seededPaths = {
    Claim: CLAIMS.map((claim) => seededAt('claims', claim.number)),
    Case: CASES.map((kase) => seededAt('cases', kase.number)),
  };
  const { password: adjusterPassword } = requireStepCredentials('read as the adjuster');
  const intruders = [];
  const unjudged = [];
  for (const [as, password] of [
    [adjuster, adjusterPassword],
    [services.username, demoPassword],
  ]) {
    for (const [type, schema] of [
      ['Claim', 'claim'],
      ['Case', 'case'],
    ]) {
      const entries = await repositoryQuery(
        h.baseUrl,
        as,
        password,
        `SELECT * FROM Document WHERE ecm:primaryType = '${type}' AND ecm:isVersion = 0 ` +
          'AND ecm:isProxy = 0 AND ecm:isTrashed = 0',
        schema,
      );
      if (entries === null) {
        unjudged.push(`${type} as ${as}: the query was not answered whole`);
        continue;
      }
      if (type === 'Claim') {
        const misread = CLAIMS.filter(
          (claim) =>
            entries.find((entry) => entry.path === seededAt('claims', claim.number))?.properties?.[
              'claim:status'
            ] !== claim.status,
        );
        if (misread.length > 0)
          unjudged.push(`${misread.length} seeded claim(s) read without their status as ${as}`);
      }
      for (const entry of entries)
        if (!seededPaths[type].includes(entry.path) && counted[type](entry.properties ?? {}, as))
          intruders.push(`${entry.path} (${type}, read as ${as})`);
    }
  }
  h.requirePrecondition(
    'no record the seed did not write is in what the demo counts, as either person',
    unjudged.length === 0 && intruders.length === 0,
    unjudged.length > 0
      ? `could not judge: ${unjudged.join('; ')}`
      : `${intruders.length} record(s) not seeded would change the demo's figures: ` +
          `${intruders.slice(0, 3).join(', ')}. Run it on a server without them`,
  );

  // What the dev server serves at /agentic-ui-config/ must be the kit's own files: they are what
  // the rest of this run asserts the page was drawn from.
  const served = [
    'home.json',
    'navigation.json',
    'labels/en.json',
    'layouts/Member/view.layout.json',
    'layouts/Member/metadata.layout.json',
    ...readdirSync(join(CONFIG, 'queues')).map((name) => `queues/${name}`),
  ];
  const differing = [];
  for (const path of served) {
    const answer = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`);
    const { content, source } = unwrap(answer.ok() ? await answer.json().catch(unread) : null);
    // config:dev records each layout's path relative to the repository's root.
    const fromKit = source === null || resolve(REPO, source) === join(CONFIG, path);
    if (!sameJson(content, kitFile(path)) || !fromKit)
      differing.push(`${path} (${answer.status()}${source ? `, from ${source}` : ''})`);
  }
  h.requirePrecondition(
    "the dev server serves the kit's home, menu, labels, queues and Member layouts",
    differing.length === 0,
    `not the kit's: ${differing.join(', ')}. Run the README's config:dev command, then restart ` +
      'the dev server',
  );

  // ── 1. An adjuster's home ──────────────────────────────────────────────────────────────────
  await h.step("1. An adjuster's home, with KPIs from the page providers' aggregates");
  await h.login();
  await h.goTo('/#/home');
  await homeSettled(page);
  const home = await readHome(page);
  const unassigned = CLAIMS.filter(
    (claim) => claim.adjuster === null && ['submitted', 'inReview'].includes(claim.status),
  );
  const mine = CLAIMS.filter((claim) => claim.adjuster === adjuster);
  const card = (id) => home.find((c) => c.id === id);
  h.check(
    "the home shows the adjusters' cards and none of member services'",
    JSON.stringify(home.map((c) => c.id)) === JSON.stringify(ADJUSTER_CARDS),
    `drawn ${JSON.stringify(home.map((c) => c.id))}, expected ${JSON.stringify(ADJUSTER_CARDS)}`,
  );
  h.check(
    `"Unassigned claims" counts the ${unassigned.length} unassigned claims seeded`,
    card('unassigned')?.figure === String(unassigned.length) &&
      card('unassigned')?.title === labels['payers.home.unassigned'],
    JSON.stringify(card('unassigned')),
  );
  h.check(
    '"Unassigned, by status" shows the claim_status_agg buckets, counted as seeded',
    sameJson(
      card('unassigned-by-status')?.buckets,
      countBy(unassigned, (c) => c.status),
    ),
    `drawn ${JSON.stringify(card('unassigned-by-status')?.buckets)}`,
  );
  h.check(
    `"My claims" counts ${adjuster}'s own ${mine.length}, through $currentUser`,
    card('mine')?.figure === String(mine.length),
    JSON.stringify(card('mine')),
  );
  const menu = await readAppMenu(page);
  h.check(
    "the menu adds the adjusters' queues and not pending determination",
    ['appMenu.home', 'appMenu.unassigned', 'appMenu.mine'].every((id) => menu.includes(id)) &&
      !menu.includes('appMenu.pending'),
    `app entries drawn: ${JSON.stringify(menu)}`,
  );
  await h.screenshot('adjuster-home');

  // ── 2. A queue ─────────────────────────────────────────────────────────────────────────────
  await h.step('2. A queue opened: my claims, sorted and filtered on the server');
  await page.locator('li.home-card[data-card-id="mine"] a.home-card__link').click().catch(deferred);
  await page.waitForURL(/#\/queues\/my-claims$/, { timeout: 15_000 }).catch(deferred);
  await page
    .waitForFunction(
      () => document.querySelectorAll('.queue-page tbody tr').length > 0,
      undefined,
      {
        timeout: 30_000,
      },
    )
    .catch(deferred);
  const byService = (claims) =>
    [...claims].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate)).map((c) => c.number);
  const queueRows = await readClaimRows(page, '.queue-page');
  h.check(
    'the home\'s "Open the queue" opens /queues/my-claims, titled from its labelKey',
    page.url().endsWith('#/queues/my-claims') &&
      (await page.locator('.queue-page__title').textContent().catch(unread))?.trim() ===
        labels['payers.queue.mine'],
    page.url(),
  );
  h.check(
    `the queue lists ${adjuster}'s claims, latest service first`,
    JSON.stringify(queueRows) === JSON.stringify(byService(mine)),
    `drawn ${JSON.stringify(queueRows)}, expected ${JSON.stringify(byService(mine))}`,
  );
  const facet = await page.evaluate(() =>
    Object.fromEntries(
      [
        ...document.querySelectorAll(
          'fieldset.queue-facet[data-aggregate="claim_status_agg"] .queue-facet__bucket',
        ),
      ].map((bucket) => {
        const match = /^\s*(\S+)\s*\((\d+)\)/.exec(bucket.textContent ?? '');
        return match ? [match[1], Number(match[2])] : [bucket.textContent, null];
      }),
    ),
  );
  h.check(
    'the Status facet counts the claims by status, from the aggregate',
    sameJson(
      facet,
      countBy(mine, (c) => c.status),
    ),
    `drawn ${JSON.stringify(facet)}`,
  );
  // A status some, not all, of the adjuster's claims have, so that choosing it narrows the queue.
  const statuses = countBy(mine, (c) => c.status);
  const chosen =
    statuses.paid < mine.length
      ? 'paid'
      : Object.keys(statuses).find((key) => statuses[key] < mine.length);
  h.requirePrecondition(
    "the adjuster's claims have more than one status, so a facet can narrow them",
    chosen !== undefined,
    `every one of ${adjuster}'s claims is ${Object.keys(statuses).join(', ')}: change data.mjs`,
  );
  const filtered = page
    .waitForRequest(
      (request) =>
        request.url().includes('/search/pp/payers_my_claims/execute') &&
        new URL(request.url()).searchParams.get('claim_status_agg') === JSON.stringify([chosen]),
      { timeout: 15_000 },
    )
    .catch(unread);
  await page
    .locator('fieldset.queue-facet[data-aggregate="claim_status_agg"] .queue-facet__bucket', {
      hasText: new RegExp(`^\\s*${chosen}\\b`),
    })
    .locator('input')
    .click()
    .catch(deferred);
  const sent = await filtered;
  const expectedChosen = byService(mine.filter((c) => c.status === chosen));
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      expectedChosen.length,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const chosenRows = await readClaimRows(page, '.queue-page');
  h.check(
    `choosing "${chosen}" sends claim_status_agg=["${chosen}"] to the page provider`,
    sent !== null,
  );
  h.check(
    `the server narrows the queue to the ${chosen} claims`,
    JSON.stringify(chosenRows) === JSON.stringify(expectedChosen),
    `drawn ${JSON.stringify(chosenRows)}, expected ${JSON.stringify(expectedChosen)}`,
  );
  await h.screenshot('my-claims-paid');

  // ── 3. A member ────────────────────────────────────────────────────────────────────────────
  await h.step('3. A member: age, combined address, and the claims and cases lists');
  h.note(
    'the member is opened from the narrowed queue, through its member column: a "document-link", ' +
      "which shows the member's title as a link that opens the member (layout-v2.md, section 11)",
  );
  // A row step 2 left on screen whose claim is the member's: the queue's member link opens it.
  const viaClaim = expectedChosen.find(
    (number) => CLAIMS.find((claim) => claim.number === number)?.member === MEMBER.number,
  );
  h.requirePrecondition(
    `one of the ${chosen} claims step 2 leaves on screen is ${MEMBER.number}'s`,
    viaClaim !== undefined,
    `none of ${JSON.stringify(expectedChosen)} is the member's: change data.mjs`,
  );
  const memberName = `${MEMBER.firstName} ${MEMBER.lastName}`;
  // The cell shows nothing while the member is read, and the link once it is.
  const memberLink = page
    .locator('.queue-page tbody tr', { hasText: viaClaim })
    .locator('a.nxs-document-list__link');
  await memberLink.first().waitFor({ timeout: 15_000 }).catch(deferred);
  const drawnLinks = await memberLink
    .evaluateAll((links) =>
      links.map((link) => ({
        text: link.textContent?.trim() ?? '',
        href: link.getAttribute('href') ?? '',
      })),
    )
    .catch(unread);
  h.check(
    `the queue's member column links ${viaClaim} to its member, by name: ${memberName}`,
    drawnLinks?.length === 1 &&
      drawnLinks[0].text === memberName &&
      drawnLinks[0].href.endsWith(`/doc/${memberDoc.uid}`),
    `drawn ${JSON.stringify(drawnLinks)}`,
  );
  await memberLink.first().click().catch(deferred);
  await page.waitForURL(new RegExp(`#/doc/${memberDoc.uid}$`), { timeout: 15_000 }).catch(deferred);
  await recordSettled(page, ['member', 'claims', 'cases']);
  const adjusterPage = await readRecordPage(page);
  const viewFile = kitFile('layouts/Member/view.layout.json');
  const memberCard = adjusterPage.find((c) => c.id === 'member');
  const value = (cardFields, key) => cardFields?.fields.find((f) => f.key === key)?.value;
  h.check(
    "the record page draws the layout's three cards",
    JSON.stringify(adjusterPage.map((c) => c.id)) ===
      JSON.stringify(viewFile.cards.map((c) => c.id)),
    JSON.stringify(adjusterPage.map((c) => c.id)),
  );
  h.check(
    `the name is computed from first and last name: ${MEMBER.firstName} ${MEMBER.lastName}`,
    value(memberCard, 'name') === `${MEMBER.firstName} ${MEMBER.lastName}`,
    value(memberCard, 'name'),
  );
  h.check(
    `the age is computed from the birth date ${MEMBER.birthDate}: ${ageToday(MEMBER.birthDate)}`,
    value(memberCard, 'age') === String(ageToday(MEMBER.birthDate)),
    value(memberCard, 'age'),
  );
  const address = value(memberCard, 'member:address') ?? '';
  h.check(
    'the address is one field, combining street, city, postcode and country',
    Object.values(MEMBER.address).every((part) => address.includes(part)),
    address,
  );
  const memberClaims = CLAIMS.filter((claim) => claim.member === MEMBER.number);
  const claimRows = adjusterPage
    .find((c) => c.id === 'claims')
    ?.rows.map((row) => /CLAIM-\d+/.exec(row)?.[0]);
  h.check(
    "the claims card lists the member's claims, latest service first",
    JSON.stringify(claimRows) === JSON.stringify(byService(memberClaims)),
    `drawn ${JSON.stringify(claimRows)}, expected ${JSON.stringify(byService(memberClaims))}`,
  );
  const memberCases = CASES.filter((kase) => kase.member === MEMBER.number).map((k) => k.title);
  const caseRows = adjusterPage.find((c) => c.id === 'cases')?.rows ?? [];
  h.check(
    "the cases card lists the member's cases, and only those",
    caseRows.length === memberCases.length &&
      memberCases.every((title) => caseRows.some((row) => row.startsWith(title))),
    `drawn ${JSON.stringify(caseRows)}`,
  );
  await h.screenshot('member-as-adjuster');

  // ── 4. Member services ─────────────────────────────────────────────────────────────────────
  await h.step('4. Member services see the social security number, which an adjuster does not');
  await panelSettled(page, MEMBER.number);
  const adjusterScreen = await page.evaluate(() => document.body.innerText);
  h.check(
    "the adjuster's Properties panel is drawn, with the member's own properties",
    (
      await page
        .locator('nxs-properties-panel')
        .textContent()
        .catch(() => '')
    ).includes(MEMBER.number),
  );
  h.check(
    "the SSN is nowhere on the adjuster's Member page, the Properties panel included",
    !adjusterScreen.includes(MEMBER.ssn) &&
      !adjusterPage.some((c) => c.fields.some((f) => f.key === 'member:ssn')),
    'the SSN is on the screen',
  );
  const memberRights = await page.request
    .get(`${h.baseUrl}/nuxeo/api/v1/id/${memberDoc.uid}`, {
      headers: { 'enrichers-document': 'permissions' },
    })
    .then((r) => (r.ok() ? r.json() : null))
    .catch(unread);
  const adjusterRights = memberRights?.contextParameters?.permissions ?? null;
  h.check(
    "the adjuster lacks WriteProperties on the member, which a member's Edit form, listing the SSN, needs",
    Array.isArray(adjusterRights) &&
      adjusterRights.includes('Read') &&
      !adjusterRights.includes('WriteProperties'),
    `the adjuster's permissions on the member: ${JSON.stringify(adjusterRights)}`,
  );

  // Declared before the new session is installed, and the adjuster's cookie dropped first: a
  // JSESSIONID Nuxeo has answered on beats a Basic header, so it would keep the browser the
  // adjuster's whatever the session says. Until the reload below, the app still holds the
  // adjuster's session in memory, so every request a frame sends to Nuxeo is given member
  // services' header here, and the route is removed as soon as the reload commits: from then on
  // the header is the app's own, from the session it restored, and the identity guard judges that.
  // page.request, the run's own channel, is not routed here and keeps the adjuster's.
  await h.signedInAs(services.username, 'member services read the member the adjuster just read');
  const servicesBasic = Buffer.from(`${services.username}:${demoPassword}`).toString('base64');
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
          headers: { ...route.request().headers(), authorization: `Basic ${servicesBasic}` },
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
        username: services.username,
        basic: servicesBasic,
        isAdministrator: false,
        groups: [],
      }),
    },
  );
  // The route goes as soon as the new document is committed, before the app's script runs, so
  // every request the app makes as it boots carries the header of the session it restored.
  await page.reload({ waitUntil: 'commit', timeout: 120_000 });
  await page.unroute('**/nuxeo/**');
  await page.waitForLoadState('load', { timeout: 120_000 });
  await h.goTo('/#/home');
  await homeSettled(page);
  const servicesHome = await readHome(page);
  const pending = CLAIMS.filter((claim) => ['inReview', 'pended'].includes(claim.status));
  h.check(
    "member services' home shows their cards and none of the adjusters'",
    JSON.stringify(servicesHome.map((c) => c.id)) === JSON.stringify(SERVICES_CARDS),
    `drawn ${JSON.stringify(servicesHome.map((c) => c.id))}`,
  );
  h.check(
    `"Pending determination" counts the ${pending.length} claims in review or pended, and "Pended" its bucket`,
    servicesHome.find((c) => c.id === 'pending')?.figure === String(pending.length) &&
      servicesHome.find((c) => c.id === 'pended')?.figure ===
        String(pending.filter((c) => c.status === 'pended').length),
    JSON.stringify(servicesHome),
  );
  const servicesMenu = await readAppMenu(page);
  h.check(
    "member services' menu has pending determination and not the adjusters' queues",
    servicesMenu.includes('appMenu.pending') &&
      !servicesMenu.includes('appMenu.unassigned') &&
      !servicesMenu.includes('appMenu.mine'),
    JSON.stringify(servicesMenu),
  );
  await h.screenshot('member-services-home');

  await h.goToDoc(memberDoc.uid);
  await recordSettled(page, ['member', 'claims', 'cases']);
  const servicesPage = await readRecordPage(page);
  const ssn = servicesPage
    .find((c) => c.id === 'member')
    ?.fields.find((f) => f.key === 'member:ssn');
  h.check(
    `member services see the SSN on the Member card, labelled from the kit: ${labels['layout.field.member:ssn']}`,
    ssn?.value === MEMBER.ssn && ssn?.label === labels['layout.field.member:ssn'],
    JSON.stringify(ssn),
  );
  await h.screenshot('member-as-member-services', page.locator('[data-field="member:ssn"]'));
  // page.request runs as the adjuster on the shared cookie jar: a cookie member services' session
  // picked up would answer it as them at the step boundary.
  await page.context().clearCookies();

  // ── 5. The layout file ─────────────────────────────────────────────────────────────────────
  await h.step('5. The layout file behind the page: configuration, no code');
  const fileText = readFileSync(join(CONFIG, 'layouts', 'Member', 'view.layout.json'), 'utf8');
  const servedLayout = unwrap(
    await page.request
      .get(`${h.baseUrl}/agentic-ui-config/layouts/Member/view.layout.json`)
      .then((r) => r.json())
      .catch(unread),
  );
  h.check(
    "the Member layout the dev server serves the app is the kit's file, layouts/Member/view.layout.json",
    sameJson(servedLayout.content, JSON.parse(fileText)) &&
      typeof servedLayout.source === 'string' &&
      resolve(REPO, servedLayout.source) === join(CONFIG, 'layouts', 'Member', 'view.layout.json'),
    `served from ${servedLayout.source}`,
  );
  const fileFields = viewFile.cards.map((c) => ({
    id: c.id,
    heading: labels[c.labelKey],
    fields: (c.fields ?? []).map((f) => (typeof f === 'string' ? f : (f.field ?? f.id))),
  }));
  const drawn = servicesPage.map((c) => ({
    id: c.id,
    heading: c.heading,
    fields: c.fields.map((f) => f.key),
  }));
  h.check(
    'the page is the file: its cards, their headings from the labels, and every field, in order',
    JSON.stringify(drawn) === JSON.stringify(fileFields),
    `drawn ${JSON.stringify(drawn)}, file ${JSON.stringify(fileFields)}`,
  );
  // Data only, by place: what counts is bundle-data.mjs's, and its selftest sees code refused.
  const code = codeIn(join(KIT, 'bundle'), ROUTE_MODEL_ZIP, KIT);
  h.check(
    "the kit's bundle holds no code: JSON, XML, XSD, its manifest, vocabularies' CSV and the " +
      "route model's zip of XML documents only",
    code.length === 0,
    `code in the bundle: ${code.join(', ')}`,
  );
  // The file shown beside the page it draws, in an overlay this run adds for the picture and
  // removes after it: it is not the app's.
  await page.evaluate((text) => {
    const aside = document.createElement('aside');
    aside.id = 'payers-demo-layout-file';
    aside.setAttribute('aria-label', 'Evidence overlay: the layout file');
    aside.style.cssText =
      'position:fixed;top:72px;right:16px;bottom:16px;width:46%;overflow:auto;z-index:99999;' +
      'background:#1e1e2e;color:#e6e6e6;border-radius:8px;padding:16px;box-shadow:0 4px 24px #0006';
    const title = document.createElement('p');
    title.textContent =
      'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/layouts/Member/view.layout.json';
    title.style.cssText = 'margin:0 0 8px;font:600 12px monospace;color:#9ecbff';
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = 'margin:0;font:11px/1.4 monospace;white-space:pre';
    aside.append(title, pre);
    document.body.append(aside);
  }, fileText);
  await h.screenshot('member-layout-file');
  await page.evaluate(() => document.getElementById('payers-demo-layout-file')?.remove());
  h.note(
    'the layout file is shown in an overlay this run adds over the page for the screenshot, ' +
      'not a screen of the app',
  );
  await page.context().clearCookies();

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "the server's own install is not what the app read: under the dev server the layouts come " +
      'from config:dev, as the home, menu, queues and labels do, which only the app registry ' +
      'will serve from a package',
  );
  h.note(
    "the kit's approve button is left out of the queue's rows: actions.json is not served yet",
  );
}
