/**
 * The Payers acceptance tests, A and B (docs/business-apps/acceptance-tests.md, sections 3 and 4),
 * judged on the participant's package, never on the Payers kit: the Member page a presales engineer
 * rebuilt from nothing (phase 1), and with it the Claim and Case pages and a claims queue (phase 2).
 *
 *   ACCEPTANCE_SCOPE=member   test A: the Member page alone (the default)
 *   ACCEPTANCE_SCOPE=screens  test B: the Member, Claim and Case pages, and the queue
 *
 * The target is the protocol's target sheets, items A1 to A10 and B1 to B5. Each check names its
 * item. The records it opens and the values it expects are the Payers seed's, read from the
 * reference kit's `demo/data.mjs`, which prepared the server; nothing else of the reference kit is
 * read but its layouts, to refuse a copy of them. What the participant chose, their card ids,
 * headings and label keys, is read from their package: the page is held to their file, and their
 * file to the target. So the run says whether the package draws what the target asks for, from the
 * participant's own files, on the seeded server.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - `ACCEPTANCE_PACKAGE`, the participant's package folder, and not the reference kit's;
 *   `ACCEPTANCE_BASE`, the commit the session started from; for test B, `ACCEPTANCE_QUEUE` when the
 *   package has more than one queue.
 * - The reference kit back in the checkout (`git checkout -- business-apps/packages/payers-claims-demo`),
 *   for its seed data: the protocol moves it out of the way during the session.
 * - The Payers kit installed on the server and seeded with `demo/seed.mjs`, with no claim, case or
 *   claim document the seed did not write among those the run counts.
 * - The dev server with `npm run config:dev` serving the participant's files, not the kit's.
 * - **The run's own user is an adjuster, and only that:** `NUXEO_USER` one of the seed's users whose
 *   one group is `claims-adjusters`, such as `dana.lee`, and `NUXEO_PASS` the demo password.
 * - `PAYERS_DEMO_PASSWORD`: the last step signs the browser in as member services with it.
 *
 *   ACCEPTANCE_PACKAGE=business-apps/packages/<package> ACCEPTANCE_BASE=<commit> \
 *   NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- acceptance-payers
 *
 * Load-bearing checks: every target item, each against the seed's values or the server's answers;
 * each page drawn as the participant's file says; the queue narrowed on the server. Negative ones:
 * the social security number nowhere on the adjuster's Member page, the Properties panel included;
 * no checklist on a grievance; each layout not the reference kit's; no code in the bundle; no file
 * outside the package changed since the session's commit; no stand-in model in the package.
 *
 * Not covered, and said in notes: the pipeline, which the protocol runs as a command; the server's
 * own install (the dev server reads the package through `config:dev`); actions, which `config:dev`
 * does not serve; and whether a prospect would accept the result, which the review form records.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';
import {
  ENVIRONMENTAL_ERRORS,
  ageToday,
  alwaysShown,
  changedOutside,
  checkQueueNarrows,
  codeInPackage,
  daysSince,
  deferred,
  differsFromFile,
  fieldsOf,
  listsOf,
  notServedFromPackage,
  participantPackage,
  participantQueue,
  readAppMenu,
  readJson,
  readRecordPage,
  recordSettled,
  repositoryQuery,
  sameJson,
  sessionBase,
  switchBrowserTo,
  unheldFileErrors,
  unread,
  whoIs,
  withoutSchema,
} from './acceptance/participant.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The reference kit, by one path: its seed prepared the server, and its layouts are the answer. */
const REFERENCE = join(REPO, 'business-apps/packages/payers-claims-demo');
const REFERENCE_LAYOUTS = join(REFERENCE, 'bundle', 'agentic-ui-config', 'layouts');
const SEED_DATA = join(REFERENCE, 'demo', 'data.mjs');
const ROOT = '/default-domain/workspaces/payers-demo';

const SCOPE = process.env['ACCEPTANCE_SCOPE'] || 'member';

/** The records the target names: the protocol's target sheets. */
const MEMBER_NUMBER = 'MEMBER-100048';
const CLAIM_NUMBER = 'CLAIM-000131';
const APPEAL_NUMBER = 'CASE-2041';
const GRIEVANCE_NUMBER = 'CASE-2042';
/** The appeal checklist's items, as the seed stores them: CASE-2043, decided, has every one. */
const CHECKLIST_ITEMS = [
  'appealLetter',
  'reviewerAssigned',
  'medicalRecords',
  'providerStatement',
  'decisionLetter',
];

/** A demo adjuster and nothing else, as the run's own user must be. */
const adjustersOnly = (user) =>
  JSON.stringify(user?.groups) === JSON.stringify(['claims-adjusters']);
/** A row or a value's digits, so that an amount reads the same however it is formatted. */
const digits = (text) => String(text ?? '').replace(/[^0-9]/g, '');
/** The value of the one field `match` picks, or `undefined`. */
const valueWhere = (record, match) => fieldsOf(record).find(match)?.value;

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step("Preconditions: the participant's package, the seeded server, the files served");
  h.requirePrecondition(
    `ACCEPTANCE_SCOPE is member (test A) or screens (test B)`,
    SCOPE === 'member' || SCOPE === 'screens',
    `ACCEPTANCE_SCOPE is ${SCOPE}`,
  );
  const screens = SCOPE === 'screens';
  const pkg = participantPackage(REPO, REFERENCE);
  h.requirePrecondition(
    "the participant's package is named, and is not the reference kit",
    !pkg.problem,
    pkg.problem,
  );
  const base = sessionBase(REPO);
  h.requirePrecondition(
    'the commit the session started from is named',
    !base.problem,
    base.problem,
  );
  h.requirePrecondition(
    "the reference kit's seed data is back in the checkout",
    existsSync(SEED_DATA),
    'restore it: git checkout -- business-apps/packages/payers-claims-demo',
  );
  const { CASES, CLAIMS, CLAIM_DOCUMENTS, MEMBERS, USERS } = await import(
    pathToFileURL(SEED_DATA).href
  );
  const MEMBER = MEMBERS.find((member) => member.number === MEMBER_NUMBER);
  const SERVICES = USERS.find((user) => user.groups.includes('member-services'));

  const adjuster = requireStepCredentials('sign the run in as an adjuster');
  h.requirePrecondition(
    'the run signs in as one of the seed adjusters, in no other group',
    adjustersOnly(USERS.find((user) => user.username === adjuster.username)),
    `NUXEO_USER is ${adjuster.username}: set it to a seed user whose one group is ` +
      `claims-adjusters, such as ${USERS.find(adjustersOnly)?.username}, and NUXEO_PASS to the demo password`,
  );
  const me = await whoIs(h.baseUrl, adjuster.username, adjuster.password);
  h.requirePrecondition(
    'the server has the adjuster, in claims-adjusters and in neither other group',
    me.id === adjuster.username &&
      me.groups.includes('claims-adjusters') &&
      !me.groups.includes('member-services') &&
      !me.groups.includes('claims-supervisors'),
    `/me answered ${me.status}, ${me.id} in ${JSON.stringify(me.groups)}: run the seed first`,
  );
  const demoPassword = process.env['PAYERS_DEMO_PASSWORD'] ?? '';
  const services = await whoIs(h.baseUrl, SERVICES.username, demoPassword);
  h.requirePrecondition(
    `PAYERS_DEMO_PASSWORD signs ${SERVICES.username} in, in member-services`,
    demoPassword !== '' &&
      services.id === SERVICES.username &&
      services.groups.includes('member-services'),
    `export the password the seed gave the demo users as PAYERS_DEMO_PASSWORD (/me answered ${services.status})`,
  );

  const read = (path) =>
    page.request
      .get(`${h.baseUrl}/nuxeo/api/v1/path${path}`, { headers: { properties: '*' } })
      .then((r) => (r.ok() ? r.json() : null))
      .catch(unread);
  const memberDoc = await read(`${ROOT}/members/${MEMBER_NUMBER.toLowerCase()}`);
  const claimDoc = screens ? await read(`${ROOT}/claims/${CLAIM_NUMBER.toLowerCase()}`) : null;
  const appealDoc = screens ? await read(`${ROOT}/cases/${APPEAL_NUMBER.toLowerCase()}`) : null;
  const grievanceDoc = screens
    ? await read(`${ROOT}/cases/${GRIEVANCE_NUMBER.toLowerCase()}`)
    : null;
  const appealClaim = CLAIMS.find(
    (claim) => claim.number === CASES.find((kase) => kase.number === APPEAL_NUMBER)?.claim,
  );
  const appealClaimDoc = screens
    ? await read(`${ROOT}/claims/${appealClaim.number.toLowerCase()}`)
    : null;
  const appealMember = MEMBERS.find(
    (member) => member.number === CASES.find((kase) => kase.number === APPEAL_NUMBER)?.member,
  );
  const appealMemberDoc = screens
    ? await read(`${ROOT}/members/${appealMember.number.toLowerCase()}`)
    : null;
  const missing = [
    memberDoc?.type === 'Member' ? null : MEMBER_NUMBER,
    ...(screens
      ? [
          claimDoc?.type === 'Claim' ? null : CLAIM_NUMBER,
          appealDoc?.type === 'Case' ? null : APPEAL_NUMBER,
          grievanceDoc?.type === 'Case' ? null : GRIEVANCE_NUMBER,
          appealClaimDoc?.type === 'Claim' ? null : appealClaim.number,
          appealMemberDoc?.type === 'Member' ? null : appealMember.number,
        ]
      : []),
  ].filter(Boolean);
  h.requirePrecondition(
    'the Payers kit is installed and seeded: the records the target names are there',
    missing.length === 0,
    `not found: ${missing.join(', ')}. Install the kit and run its demo/seed.mjs`,
  );

  // The lists are counted exactly, so no record the seed did not write may be in them: the
  // member's claims and cases, and the claim's documents. Asked of the repository, as the adjuster.
  const seeded = {
    Claim: CLAIMS.map((claim) => `${ROOT}/claims/${claim.number.toLowerCase()}`),
    Case: CASES.map((kase) => `${ROOT}/cases/${kase.number.toLowerCase()}`),
  };
  const live = 'ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0';
  const others = [];
  let judged = true;
  for (const [type, field] of [
    ['Claim', 'claim:member'],
    ['Case', 'case:member'],
  ]) {
    const entries = await repositoryQuery(
      h.baseUrl,
      adjuster,
      `SELECT * FROM ${type} WHERE ${field} = '${memberDoc?.uid}' AND ${live}`,
      type.toLowerCase(),
    );
    if (entries === null) judged = false;
    else
      for (const entry of entries)
        if (!seeded[type].includes(entry.path)) others.push(`${entry.path} (${type})`);
  }
  if (screens) {
    // A claim's documents are ClaimDocuments that name it by its number, in the seed's own folder.
    const documents = await repositoryQuery(
      h.baseUrl,
      adjuster,
      `SELECT * FROM ClaimDocument WHERE claimdoc:claim = '${CLAIM_NUMBER}' AND ${live}`,
      'dublincore',
    );
    const seededDocuments = CLAIM_DOCUMENTS.filter((doc) => doc.claim === CLAIM_NUMBER).map(
      (doc) => `${ROOT}/documents/${doc.number.toLowerCase()}`,
    );
    if (documents === null) judged = false;
    else
      for (const entry of documents)
        if (!seededDocuments.includes(entry.path))
          others.push(`${entry.path} (a document of ${CLAIM_NUMBER})`);
  }
  h.requirePrecondition(
    'no record the seed did not write is in the lists the run counts',
    judged && others.length === 0,
    judged
      ? `${others.length} record(s) not seeded: ${others.slice(0, 3).join(', ')}. Run it on a server without them`
      : 'a repository query was not answered whole',
  );

  // What the dev server serves must be the participant's own files: they are what the rest of the
  // run asserts the pages were drawn from.
  const { config } = pkg;
  // A package with no queue fails B4; one with several needs the facilitator to say which.
  const queue = screens ? participantQueue(config) : null;
  h.requirePrecondition(
    "the package's queue for test B is known, when it has more than one",
    !screens || queue.id !== undefined || queue.none,
    queue?.problem,
  );
  const layouts = ['Member', ...(screens ? ['Claim', 'Case'] : [])];
  const needed = [
    'labels/en.json',
    ...layouts.map((type) => `layouts/${type}/view.layout.json`),
    ...(screens ? ['navigation.json', ...(queue.id ? [`queues/${queue.id}.json`] : [])] : []),
  ];
  // A file the target needs and the package lacks is the participant's to write: it fails the
  // items it serves, below, and is named here. What the package holds must be what is served.
  const lacking = needed.filter((path) => !existsSync(join(config, path)));
  h.check(
    `the package holds every file its target's pages need${screens ? ', a queue among them' : ''}`,
    lacking.length === 0 && (!screens || queue.id !== undefined),
    `missing: ${[...lacking, ...(screens && !queue.id ? ['queues/<a queue>.json'] : [])].join(', ')}`,
  );
  const served = [
    ...needed.filter((path) => !lacking.includes(path)),
    ...(existsSync(join(config, 'layouts', 'Member', 'metadata.layout.json'))
      ? ['layouts/Member/metadata.layout.json']
      : []),
  ];
  const differing = await notServedFromPackage(page, h.baseUrl, REPO, config, served);
  h.requirePrecondition(
    "the dev server serves the participant's own files, as the package holds them",
    differing.length === 0,
    `not the package's: ${differing.join(', ')}. Run config:dev on the package's files, from ` +
      "the participant's checkout, whose dev server APP_URL names",
  );
  const labels = readJson(join(config, 'labels', 'en.json'))?.labels ?? {};
  const layout = (type) => readJson(join(config, 'layouts', type, 'view.layout.json'));

  // ── 1. The Member page ────────────────────────────────────────────────────────────────────
  await h.step('1. The Member page, as an adjuster: test A, items A1 to A8');
  await h.login();
  await h.goToDoc(memberDoc.uid);
  const memberFile = layout('Member');
  await recordSettled(page, alwaysShown(memberFile));
  const memberPage = await readRecordPage(page);
  h.check(
    "A1. the Member page is the participant's file: its cards in order, each headed from the package",
    differsFromFile(memberPage, memberFile, labels) === null,
    differsFromFile(memberPage, memberFile, labels) ?? '',
  );
  const name = `${MEMBER.firstName} ${MEMBER.lastName}`;
  h.check(
    `A2. a field shows the member's name: ${name}`,
    fieldsOf(memberPage).some((field) => field.value === name),
    JSON.stringify(fieldsOf(memberPage).map((field) => [field.key, field.value])),
  );
  const age = String(ageToday(MEMBER.birthDate));
  h.check(
    `A3. a field shows the age from the birth date ${MEMBER.birthDate}: ${age}`,
    fieldsOf(memberPage).some((field) => field.value === age),
    JSON.stringify(fieldsOf(memberPage).map((field) => [field.key, field.value])),
  );
  const address = Object.values(MEMBER.address);
  h.check(
    `A4. one field shows the whole address: ${address.join(', ')}`,
    fieldsOf(memberPage).some((field) => address.every((part) => field.value.includes(part))),
    JSON.stringify(fieldsOf(memberPage).map((field) => field.value)),
  );
  h.check(
    `A5. a field shows the phone: ${MEMBER.phone}`,
    fieldsOf(memberPage).some((field) => field.value.includes(MEMBER.phone)),
  );
  h.check(
    `A6. the status shows as a badge: ${MEMBER.status}`,
    fieldsOf(memberPage).some((field) => field.badge && field.value.includes(MEMBER.status)),
    JSON.stringify(fieldsOf(memberPage).filter((field) => field.badge)),
  );
  const byService = (claims) =>
    [...claims].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate));
  const memberClaims = byService(CLAIMS.filter((claim) => claim.member === MEMBER.number));
  const claimList = listsOf(memberPage).find((card) =>
    card.rows.some((row) => /CLAIM-\d+/.test(row)),
  );
  const claimRows = claimList?.rows ?? [];
  h.check(
    `A7. a list shows the member's ${memberClaims.length} claims, latest service first, each with its billed amount and status`,
    claimRows.length === memberClaims.length &&
      memberClaims.every(
        (claim, index) =>
          claimRows[index]?.includes(claim.number) &&
          digits(claimRows[index]).includes(String(claim.billedAmount)) &&
          claimRows[index].includes(claim.status),
      ),
    `drawn ${JSON.stringify(claimRows)}, expected ${JSON.stringify(memberClaims.map((c) => [c.number, c.billedAmount, c.status]))}`,
  );
  const memberCases = CASES.filter((kase) => kase.member === MEMBER.number);
  const caseList = listsOf(memberPage).find((card) =>
    card.rows.some((row) => memberCases.some((kase) => row.includes(kase.title))),
  );
  const caseRows = caseList?.rows ?? [];
  h.check(
    `A8. a list shows the member's ${memberCases.length} cases, and only those, each with its state`,
    caseRows.length === memberCases.length &&
      memberCases.every((kase) =>
        caseRows.some((row) => row.includes(kase.title) && row.includes(kase.state)),
      ),
    `drawn ${JSON.stringify(caseRows)}`,
  );
  const copied = layouts.filter((type) => {
    const theirs = withoutSchema(layout(type));
    const reference = withoutSchema(readJson(join(REFERENCE_LAYOUTS, type, 'view.layout.json')));
    return theirs !== null && reference !== null && sameJson(theirs, reference);
  });
  h.check(
    "the participant's layouts are their own: none is the reference kit's, nor layout-v2.md's section 9",
    copied.length === 0,
    `the same as the reference's: ${copied.join(', ')}`,
  );
  await h.screenshot('member-as-adjuster');

  // The panel is drawn once it shows any of the member's own values: which ones is the
  // participant's metadata layout's to say, or the schema's when they wrote none.
  const own = [
    MEMBER.number,
    MEMBER.firstName,
    MEMBER.lastName,
    MEMBER.phone,
    MEMBER.email,
    MEMBER.plan,
  ];
  await page
    .waitForFunction(
      (values) => {
        const text = document.querySelector('nxs-properties-panel')?.textContent ?? '';
        return values.some((value) => text.includes(value));
      },
      own,
      { timeout: 30_000 },
    )
    .catch(deferred);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(deferred);
  const panel = (await page.locator('nxs-properties-panel').textContent().catch(unread)) ?? '';
  const screen = (await page.evaluate(() => document.body.innerText).catch(unread)) ?? '';
  const panelDrawn = own.some((value) => panel.includes(value));
  h.check(
    "A9, first half. the Properties panel is drawn, and the SSN is nowhere on the adjuster's Member page",
    panelDrawn && screen !== '' && !screen.includes(MEMBER.ssn),
    panelDrawn
      ? 'the SSN is on the screen'
      : "the Properties panel shows none of the member's values",
  );

  if (screens) {
    // ── 2. The Claim page ─────────────────────────────────────────────────────────────────────
    await h.step(`2. The Claim page, on ${CLAIM_NUMBER}: test B, item B1`);
    const CLAIM = CLAIMS.find((claim) => claim.number === CLAIM_NUMBER);
    await h.goToDoc(claimDoc.uid);
    const claimFile = layout('Claim');
    await recordSettled(page, alwaysShown(claimFile));
    const claimPage = await readRecordPage(page);
    h.check(
      "B1. the Claim page is the participant's file: its cards in order, each headed from the package",
      differsFromFile(claimPage, claimFile, labels) === null,
      differsFromFile(claimPage, claimFile, labels) ?? '',
    );
    h.check(
      `B1. a field shows the claim's number: ${CLAIM.number}`,
      fieldsOf(claimPage).some((field) => field.value === CLAIM.number),
    );
    h.check(
      `B1. a field links to the claim's member, by name: ${name}`,
      fieldsOf(claimPage).some((field) =>
        field.links.some((link) => link.text === name && link.href.includes(memberDoc.uid)),
      ),
      JSON.stringify(fieldsOf(claimPage).flatMap((field) => field.links)),
    );
    h.check(
      `B1. fields show the billed amount, ${CLAIM.billedAmount}, and the day it was received`,
      fieldsOf(claimPage).some((field) =>
        digits(field.value).includes(String(CLAIM.billedAmount)),
      ) &&
        (valueWhere(claimPage, (field) => field.key === 'claim:received') ?? '').includes(
          CLAIM.received.slice(0, 4),
        ),
      JSON.stringify(fieldsOf(claimPage).map((field) => [field.key, field.value])),
    );
    h.check(
      'B1. a field shows the allowed amount, none yet on this claim',
      fieldsOf(claimPage).some((field) => field.key === 'claim:allowedAmount'),
    );
    h.check(
      `B1. the status shows as a badge: ${CLAIM.status}`,
      fieldsOf(claimPage).some((field) => field.badge && field.value.includes(CLAIM.status)),
      JSON.stringify(fieldsOf(claimPage).filter((field) => field.badge)),
    );
    const documents = CLAIM_DOCUMENTS.filter((doc) => doc.claim === CLAIM.number);
    const documentList = listsOf(claimPage).find((card) =>
      card.rows.some((row) => documents.some((doc) => row.includes(doc.title))),
    );
    h.check(
      `B1. a list shows the claim's ${documents.length} documents, and only those`,
      documentList?.rows.length === documents.length &&
        documents.every((doc) => documentList.rows.some((row) => row.includes(doc.title))),
      JSON.stringify(documentList?.rows ?? []),
    );
    await h.screenshot('claim');

    // ── 3. The Case page ──────────────────────────────────────────────────────────────────────
    await h.step(
      `3. The Case page, on the appeal ${APPEAL_NUMBER} and the grievance ${GRIEVANCE_NUMBER}: items B2 and B3`,
    );
    const APPEAL = CASES.find((kase) => kase.number === APPEAL_NUMBER);
    await h.goToDoc(appealDoc.uid);
    const caseFile = layout('Case');
    await recordSettled(page, alwaysShown(caseFile));
    const appealPage = await readRecordPage(page);
    h.check(
      "B2. the Case page is the participant's file: its cards in order, each headed from the package",
      differsFromFile(appealPage, caseFile, labels) === null,
      differsFromFile(appealPage, caseFile, labels) ?? '',
    );
    h.check(
      `B2. fields show the case's number, its category and its state as a badge: ${APPEAL.number}, ${APPEAL.category}, ${APPEAL.state}`,
      fieldsOf(appealPage).some((field) => field.value === APPEAL.number) &&
        fieldsOf(appealPage).some((field) => field.value === APPEAL.category) &&
        fieldsOf(appealPage).some((field) => field.badge && field.value.includes(APPEAL.state)),
      JSON.stringify(fieldsOf(appealPage).map((field) => [field.key, field.value, field.badge])),
    );
    const appealMemberName = `${appealMember.firstName} ${appealMember.lastName}`;
    const links = fieldsOf(appealPage).flatMap((field) => field.links);
    h.check(
      `B2. fields link to the case's member, ${appealMemberName}, and its claim, ${appealClaim.number}, by their titles`,
      links.some(
        (link) => link.text === appealMemberName && link.href.includes(appealMemberDoc.uid),
      ) &&
        links.some(
          (link) => link.text === appealClaim.number && link.href.includes(appealClaimDoc.uid),
        ),
      JSON.stringify(links),
    );
    const assignee = USERS.find((user) => user.username === APPEAL.assignee);
    h.check(
      `B2. a field shows who the case is assigned to: ${assignee.firstName} ${assignee.lastName}`,
      fieldsOf(appealPage).some(
        (field) =>
          field.value.includes(`${assignee.firstName} ${assignee.lastName}`) ||
          field.value === assignee.username,
      ),
    );
    const open = String(daysSince(APPEAL.received));
    h.check(
      `B2. fields show the days received and due, and the days the case has been open: ${open}`,
      (valueWhere(appealPage, (field) => field.key === 'case:received') ?? '') !== '' &&
        (valueWhere(appealPage, (field) => field.key === 'case:due') ?? '') !== '' &&
        fieldsOf(appealPage).some((field) => field.value === open),
      JSON.stringify(fieldsOf(appealPage).map((field) => [field.key, field.value])),
    );
    h.check(
      'B2. a field shows the summary',
      fieldsOf(appealPage).some((field) => field.value.includes(APPEAL.summary.slice(0, 40))),
    );
    const checklist = appealPage.cards.find((card) => card.checklist.length > 0)?.checklist ?? [];
    const doneItems = (APPEAL.checklist ?? [])
      .filter((entry) => entry.done)
      .map((entry) => entry.item);
    const doneBy = (item) => {
      const entry = APPEAL.checklist.find((each) => each.item === item);
      const user = USERS.find((each) => each.username === entry?.doneBy);
      return user ? `${user.firstName} ${user.lastName}` : null;
    };
    h.check(
      `B2. the appeal's checklist shows its ${CHECKLIST_ITEMS.length} items, ${doneItems.length} done, each done one with who and when`,
      checklist.length === CHECKLIST_ITEMS.length &&
        CHECKLIST_ITEMS.every((item) => {
          const row = checklist.find((each) => each.item === item);
          const done = doneItems.includes(item);
          return (
            row !== undefined &&
            row.done === String(done) &&
            (done ? row.by === doneBy(item) && Boolean(row.on) : row.by === null)
          );
        }),
      JSON.stringify(checklist),
    );
    h.check(
      "B2. the appeal's page has its timeline",
      appealPage.cards.some((card) => card.timeline),
    );
    await h.screenshot('appeal');

    await h.goToDoc(grievanceDoc.uid);
    await recordSettled(page, alwaysShown(caseFile));
    const grievancePage = await readRecordPage(page);
    h.check(
      `B3. the grievance ${GRIEVANCE_NUMBER} has no checklist, and still its timeline`,
      grievancePage.cards.length > 0 &&
        grievancePage.cards.every((card) => card.checklist.length === 0) &&
        grievancePage.cards.some((card) => card.timeline),
      JSON.stringify(
        grievancePage.cards.map((card) => [card.id, card.checklist.length, card.timeline]),
      ),
    );
    await h.screenshot('grievance');

    // ── 4. The claims queue ───────────────────────────────────────────────────────────────────
    await h.step(`4. The claims queue, ${queue.id ?? '(none)'}, narrowed on the server: item B4`);
    h.check('B4. the package has a queue', queue.id !== undefined, queue.problem ?? '');
    if (queue.id !== undefined) {
      const queueFile = readJson(join(config, 'queues', `${queue.id}.json`));
      await h.goTo('/#/home');
      const menu = (await readAppMenu(page)) ?? [];
      const entries = readJson(join(config, 'navigation.json'))?.entries ?? [];
      h.check(
        `B4. the menu has the package's entry for the queue ${queue.id}`,
        entries.some((entry) => entry.queue === queue.id && menu.includes(`appMenu.${entry.id}`)),
        `drawn ${JSON.stringify(menu)}`,
      );
      const buckets = await checkQueueNarrows(page, h, {
        id: queue.id,
        queue: queueFile,
        labels,
        item: 'B4',
      });
      // A Status facet: its buckets are the claims' statuses, which the seed's claims hold.
      const statuses = new Set(CLAIMS.map((claim) => claim.status));
      h.check(
        `B4. the facet is by status: each of its buckets is a claim status, ${[...statuses].join(', ')}`,
        buckets !== null &&
          Object.keys(buckets).length > 0 &&
          Object.keys(buckets).every((key) => statuses.has(key)),
        JSON.stringify(buckets),
      );
      const rows =
        (await page
          .evaluate(() =>
            [...document.querySelectorAll('.queue-page tbody tr')].map(
              (row) => row.innerText ?? '',
            ),
          )
          .catch(unread)) ?? [];
      h.check(
        'B4. the queue lists claims: each row shows a claim number',
        rows.length > 0 && rows.every((row) => /CLAIM-\d+/.test(row)),
        JSON.stringify(rows),
      );
    }
    await h.screenshot('claims-queue-narrowed');
  }

  // ── 5. Member services ─────────────────────────────────────────────────────────────────────
  await h.step('5. Member services see the social security number: item A9, second half');
  await switchBrowserTo(page, h, {
    username: SERVICES.username,
    password: demoPassword,
    reason: 'member services read the member the adjuster just read',
  });
  await h.goToDoc(memberDoc.uid);
  await recordSettled(page, alwaysShown(memberFile));
  const servicesPage = await readRecordPage(page);
  h.check(
    `A9, second half. member services see the SSN on the Member page: ${MEMBER.ssn}`,
    fieldsOf(servicesPage).some((field) => field.value === MEMBER.ssn),
    JSON.stringify(fieldsOf(servicesPage).map((field) => field.key)),
  );
  await h.screenshot('member-as-member-services');
  // page.request runs as the adjuster on the shared cookie jar: a cookie member services' session
  // picked up would answer it as them at the step boundary.
  await page.context().clearCookies();

  // ── 6. The package ─────────────────────────────────────────────────────────────────────────
  await h.step('6. The package: configuration only, and nothing else changed: item A10');
  const code = codeInPackage(pkg.dir);
  h.check(
    "A10. the package's bundle holds no code: JSON, XML, XSD and its manifest only",
    code.length === 0,
    `code in the bundle: ${code.join(', ')}`,
  );
  const outside = changedOutside(REPO, pkg.dir, base.commit);
  h.check(
    `A10. nothing outside ${pkg.shown} differs from the session's commit: no Angular code, no change to the platform`,
    Array.isArray(outside) && outside.length === 0,
    outside === null ? 'git did not answer' : `changed: ${outside.slice(0, 10).join(', ')}`,
  );
  const schemas = join(pkg.dir, 'bundle', 'schemas');
  const model = existsSync(schemas)
    ? readdirSync(schemas).filter((name) => name.endsWith('.xsd'))
    : [];
  h.check(
    "A10. the package ships no stand-in model: it is built on the server's",
    model.length === 0 && !existsSync(join(pkg.dir, 'content-model.json')),
    `schemas: ${model.join(', ')}`,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    ...ENVIRONMENTAL_ERRORS,
    ...unheldFileErrors(config),
  ]);
  h.note(
    "the pipeline is not run here: the protocol runs it as a command, with the server's model, " +
      'item A11',
  );
  h.note(
    "the server's own install is not what the app read: under the dev server the package's " +
      'files come from config:dev',
  );
  h.note(
    'whether a prospect would accept the result is not judged here: the review form records it',
  );
}
