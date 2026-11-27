/**
 * The Payers kit's letters: business apps phase 7's "letters through Template Rendering"
 * (docs/business-apps/development-plan.md, phase 7, "Builds"), on the kit in
 * `business-apps/packages/payers-claims-demo`, version 0.8.0 or later, with nuxeo-agentic-letters
 * and the platform's Template Rendering it depends on, and the demo server's letters allow-list
 * installed (the kit's README, "The letters").
 *
 *   L1. An adjuster opens a denied claim of the member whose letters are in Spanish, chooses Write the
 *       denial letter on its toolbar, leaves the language empty, confirms, and is told the letter is
 *       written. The letter is filed beside the claim, in Spanish, from the Spanish template, listed
 *       on the claim's Letters card, and the claim's history holds `letterGenerated`.
 *   L2. The same, with English chosen in the button's form: the letter is in English.
 *   L3. Member services write the appeal outcome letter on the decided appeal: the add-on picks the
 *       upheld template, by the conditions it holds the stored case to, in the member's English.
 *
 * Then, past the app, as a hand-crafted request would go:
 *
 * - **the add-on refuses someone who may not write the record:** member services, who read claims
 *   and may not change them, calling `Letter.Generate` on the claim through Nuxeo's own Automation
 *   endpoint, 403;
 * - **a language with no template is refused:** the denial letter in Swedish, `sv`, which the
 *   button's vocabulary does not offer and a request may still send, 400, through
 *   `AgenticUi.RunAction`;
 * - **the allow-list holds, whatever the button's rule:** the denial letter asked by member
 *   services, whom its groups leave out, 403, and on a claim in review, a state it does not name,
 *   403; and the kit's chain called directly, which its first step, `AgenticUi.RequireRunAction`,
 *   refuses;
 * - **none of the refusals writes a letter, or anything to the claim's history.**
 *
 * Each run files three letters, two beside the claim and one beside the appeal, and writes their
 * entries to those two records' histories, and changes nothing else: no other demo counts letters,
 * nor reads those histories' letter entries.
 *
 * **Not run on a server yet:** the kit 0.8.0 and nuxeo-agentic-letters are installed nowhere, and
 * the local Nuxeo has no Template Rendering. The add-on's tests, in Nuxeo's own test framework, hold
 * what this file asks of a server (nuxeo-agentic-letters' README).
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - The platform's Template Rendering, nuxeo-agentic-letters 0.1.0 and the kit 0.8.0 or later
 *   installed on the local Nuxeo and seeded with `demo/seed.mjs`, with `nuxeo-agentic-ui` from this
 *   branch or later, and the README's letters contribution in `nxserver/config/`: the registry must
 *   serve Write the denial letter.
 * - **The run's own user is an adjuster:** `NUXEO_USER` is `dana.lee`, in `claims-adjusters` and not
 *   `member-services`, and `NUXEO_PASS` the demo password. `PAYERS_DEMO_PASSWORD` signs
 *   `riley.brooks` in, member services, for the appeal letter and the refusals, through the REST
 *   API alone.
 * - The dev server, serving the kit's Claim page and labels, or none of its labels, which the app
 *   registry then serves (the kit's README, "Seeing it under nx serve").
 *
 *   NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-letters
 *
 * Load-bearing checks: the toolbar offering the button on the denied claim; its dialog asking the
 * kit's question with the language field; the success message; the letter filed beside the claim,
 * in Spanish with no language chosen and in English with English chosen, from the template of that
 * language, its text naming the claim and the member with no placeholder left; the claim's Letters
 * card listing it; `letterGenerated` in the claim's history; the appeal's letter from the upheld
 * template. Negative ones: the five refusals, with their statuses; no letter and no history entry
 * written by any of them; and, in the browser, no button on a claim that is not denied.
 *
 * Not covered, and said in notes: the language chosen in the dialog's vocabulary field, which L2
 * sends as the dialog does, through `AgenticUi.RunAction`; a template that tries to reach what it
 * should not, which an administrator cannot save and the add-on's tests refuse; and the letter's
 * output converted to PDF, which a template's `tmpl:outputFormat` asks of the platform and the kit's
 * templates do not.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { CASES, CLAIMS, LETTER_TEMPLATES, MEMBERS, USERS } = await import(
  join(KIT, 'demo', 'data.mjs')
);

const APP = 'payers-claims';
const DENIAL = 'payers.claim.writeDenialLetter';
const APPEAL = 'payers.case.writeAppealLetter';
const DENIAL_CHAIN = 'Payers.WriteDenialLetter';
const RUN_ACTION = 'AgenticUi.RunAction';
const GENERATE = 'Letter.Generate';
const AUDITED = 'letterGenerated';
const ADJUSTER = 'dana.lee';
const MEMBER_SERVICES = 'riley.brooks';

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. The people are
 * the ones the preconditions below hold the run to: member services is signed in through the REST
 * API alone. The allow-list is the deployment's, not the kit's.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [ADJUSTER], who: 'an adjuster, in claims-adjusters and not member-services' },
  signsInAs: [MEMBER_SERVICES],
  needs: [
    "the platform's Template Rendering (nuxeo-template-rendering) and nuxeo-agentic-letters 0.1.0 installed",
    'the kit 0.8.0 or later installed, with nuxeo-agentic-ui from the same candidate',
    "the kit's letters contribution, deployment/payers-claims-demo-letters-config.xml, in nxserver/config/: the allow-list by which the registry serves the two letter buttons",
    "the dev server serving the kit's Claim page and labels, or none of its labels",
  ],
};

/** As the payers-operations demo: not the kit's. */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));
const labels = kitFile('labels/en.json').labels;
const unread = () => null;

/** The seeded denied claim of the member whose letters are in Spanish, the adjuster's own. */
const SPANISH = MEMBERS.find((member) => member.language === 'es');
const DENIED = CLAIMS.find(
  (claim) =>
    claim.member === SPANISH?.number && claim.status === 'denied' && claim.adjuster === ADJUSTER,
);
/** The seeded appeal whose decision upheld the denial. */
const DECIDED = CASES.find((kase) => kase.category === 'appeal' && kase.decision === 'upheld');
const template = (letter, language, conditions = []) =>
  LETTER_TEMPLATES.find(
    (each) =>
      each.letter === letter &&
      each.language === language &&
      conditions.every((condition) => each.conditions.includes(condition)),
  );

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
 * REST API's or the app registry's, every schema of a document answered. Not page.request, which
 * shares the browser's cookie jar. `text` reads the answer as text, as a letter's file is.
 */
async function as(baseUrl, username, password, method, path, json, { text = false } = {}) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo${path}`, {
      method,
      headers: {
        Accept: text ? '*/*' : 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'X-No-Basic-Header': 'true',
        properties: '*',
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (text) return { status: response.status, body };
    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
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
  await h.step(
    'Preconditions: Template Rendering, nuxeo-agentic-letters, the kit 0.8.0 and its letters allow-list installed',
  );
  const { username, password } = requireStepCredentials('sign the letters demo in as an adjuster');
  h.requirePrecondition(
    `the run signs in as the adjuster ${ADJUSTER}`,
    username === ADJUSTER,
    `NUXEO_USER is ${username}: set it to ${ADJUSTER}, and NUXEO_PASS to the demo password`,
  );
  h.requirePrecondition(
    "data.mjs seeds a denied claim of the adjuster's, for the member whose letters are in Spanish, and an upheld appeal",
    DENIED !== undefined && DECIDED !== undefined,
    `found ${DENIED?.number} and ${DECIDED?.number} in data.mjs`,
  );
  const asAdjuster = (method, path, json, options) =>
    as(h.baseUrl, username, password, method, path, json, options);
  const me = (await asAdjuster('GET', '/api/v1/me')).body;
  const groups = (me?.extendedGroups ?? []).map((group) => group.name);
  h.requirePrecondition(
    'the server has the adjuster, in claims-adjusters and not member-services',
    me?.id === ADJUSTER &&
      groups.includes('claims-adjusters') &&
      !groups.includes('member-services'),
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
  const letterType = await asAdjuster('GET', '/api/v1/config/types/LetterTemplate');
  h.requirePrecondition(
    "nuxeo-agentic-letters is installed, on the platform's Template Rendering: its LetterTemplate type",
    letterType.status === 200,
    `GET /config/types/LetterTemplate answered ${letterType.status}: install nuxeo-template-rendering ` +
      'from the Marketplace, then nuxeo-agentic-letters (the kit README, "The letters")',
  );

  const listing = (await asAdjuster('GET', '/agentic-ui-apps/apps.json')).body;
  const app = (listing?.apps ?? []).find((entry) => entry.id === APP);
  const version = app?.content?.packageVersion ?? '';
  const [major, minor] = version.split('.').map(Number);
  h.requirePrecondition(
    'the app registry lists the kit 0.8.0 or later to the adjuster',
    app !== undefined && (major > 0 || minor >= 8),
    `apps.json lists ${app ? `${APP} ${version}` : `no ${APP}`}: install the kit 0.8.0 (README)`,
  );
  const served = await asAdjuster('GET', `/agentic-ui-apps/apps/${APP}/actions.json`);
  const servedIds = (served.body?.actions ?? []).map((action) => action.id);
  h.requirePrecondition(
    "the server's letters allow-list lets Write the denial letter run: the registry serves it",
    served.status === 200 && servedIds.includes(DENIAL),
    `actions.json answered ${served.status} with ${JSON.stringify(servedIds)}: put the README's ` +
      'letters contribution in nxserver/config/, and restart the server',
  );

  const one = async (type, property, value) =>
    (
      await asAdjuster('POST', '/api/v1/automation/Repository.Query', {
        params: {
          query:
            `SELECT * FROM Document WHERE ecm:primaryType = '${type}' AND ${property} = '${value}' ` +
            'AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0',
        },
      })
    ).body?.entries?.[0];
  const claim = await one('Claim', 'claim:number', DENIED.number);
  h.requirePrecondition(
    `the seeded claim ${DENIED.number} is there, denied, its letters in Spanish`,
    claim?.uid !== undefined &&
      claim?.state === 'denied' &&
      claim?.properties?.['corr:language'] === 'es',
    `${DENIED.number} is ${claim?.state}, its letters in ${claim?.properties?.['corr:language']}: run demo/seed.mjs again`,
  );
  const kase = await one('Case', 'case:number', DECIDED.number);
  h.requirePrecondition(
    `the seeded appeal ${DECIDED.number} is there, its denial upheld`,
    kase?.uid !== undefined && kase?.properties?.['case:decision'] === 'upheld',
    `${DECIDED.number} answered ${kase?.properties?.['case:decision']}: run demo/seed.mjs again`,
  );
  const reviewing = CLAIMS.find((each) => each.adjuster === ADJUSTER && each.status === 'inReview');
  const inReview = await one('Claim', 'claim:number', reviewing.number);
  h.requirePrecondition(
    `the seeded claim ${reviewing.number} is there, in review`,
    inReview?.uid !== undefined && inReview?.state === 'inReview',
    `${reviewing.number} is ${inReview?.state}: run demo/seed.mjs again`,
  );
  const readable = (
    await asAdjuster('POST', '/api/v1/automation/Repository.Query', {
      params: {
        query:
          "SELECT * FROM LetterTemplate WHERE ltpl:letter = 'payers.denial' " +
          'AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0',
      },
    })
  ).body?.entries;
  h.requirePrecondition(
    'the adjuster reads the denial letter templates, in English and Spanish, which writing it needs',
    Array.isArray(readable) &&
      ['en', 'es'].every((language) =>
        readable.some((entry) => entry.properties?.['ltpl:language'] === language),
      ),
    `the adjuster reads ${readable?.length ?? 'no'} denial templates: run demo/seed.mjs again`,
  );

  /** A record's letters, newest first, as its Letters card asks for them. */
  const letters = async (uid, ask = asAdjuster) =>
    (
      await ask(
        'GET',
        `/api/v1/search/pp/payers_record_letters/execute?${new URLSearchParams({
          queryParams: uid,
          pageSize: '100',
        })}`,
      )
    ).body?.entries ?? [];
  const history = async (uid, ask = asAdjuster) =>
    ((await ask('GET', `/api/v1/id/${uid}/@audit?pageSize=100`)).body?.entries ?? []).map(
      (entry) => ({ ...entry, comment: String(entry.comment ?? '') }),
    );
  /** The one letter on `uid` that `before` did not hold, once the search has it. */
  const newLetter = (uid, before, ask = asAdjuster) =>
    until(async () => {
      const added = (await letters(uid, ask)).filter(
        (entry) => !before.some((old) => old.uid === entry.uid),
      );
      return added.length === 1 ? added[0] : null;
    });
  const textOf = async (letter) =>
    (
      await asAdjuster('GET', `/api/v1/id/${letter.uid}/@blob/file:content`, undefined, {
        text: true,
      })
    ).body;

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

  // ── L1. The denial letter, in the member's language ────────────────────────────────────────
  await h.step('L1. "Write the denial letter" on a denied claim, in the member\'s Spanish');
  const spanish = template('payers.denial', 'es');
  const beforeFirst = await letters(claim.uid);
  await h.login();
  await h.goToDoc(claim.uid);
  const name = labels['payers.action.denialLetter'];
  const button = page.locator(`[data-action-id="${DENIAL}"]`);
  await button.waitFor({ state: 'visible', timeout: 30_000 }).catch(unread);
  // Its accessible name, not its text, as the payers-operations demo reads the action bar's.
  const named = await button.ariaSnapshot().catch(() => '');
  h.check(
    'the denied claim offers Write the denial letter on its toolbar, by that name',
    (await button.count()) === 1 && named.includes(`button ${JSON.stringify(name)}`),
    `${await button.count()} button(s): ${JSON.stringify(named)}`,
  );
  await h.screenshot('denied-claim-toolbar-with-the-denial-letter');
  await button.click();
  const dialog = page.locator('lib-app-action-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(unread);
  const question = await dialog
    .locator('.lib-app-action__question')
    .innerText()
    .catch(() => '');
  h.check(
    "the dialog asks the kit's question",
    question.trim() === labels['payers.action.denialLetter.confirm'],
    JSON.stringify(question),
  );
  h.check(
    "the dialog draws the button's form: the language, from the kit's vocabulary",
    (await dialog.locator('[data-xpath="var:language"]').count()) === 1,
  );
  await h.screenshot('denial-letter-form');
  // The language left empty: the add-on writes the letter in the claim's.
  await dialog.locator('[data-app-action-run]').click();
  const done = labels['payers.action.denialLetter.done'];
  const toast = await page
    .getByText(done, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  h.check('the person is told the letter is written', toast, done);
  h.check('the dialog has closed', (await dialog.count()) === 0);

  const first = await newLetter(claim.uid, beforeFirst);
  const firstProperties = first?.properties ?? {};
  h.check(
    'one letter is filed beside the claim, in Spanish, from the Spanish template, by the adjuster',
    first !== null &&
      firstProperties['letter:record'] === claim.uid &&
      firstProperties['letter:letter'] === 'payers.denial' &&
      firstProperties['letter:language'] === 'es' &&
      firstProperties['letter:templateName'] === spanish.name &&
      firstProperties['letter:writtenBy'] === ADJUSTER &&
      first.title === `${spanish.title}, ${claim.title}` &&
      first.path?.slice(0, first.path.lastIndexOf('/')) ===
        claim.path?.slice(0, claim.path.lastIndexOf('/')),
    JSON.stringify(first ? { title: first.title, path: first.path, ...firstProperties } : null),
  );
  const firstText = first ? await textOf(first) : '';
  h.check(
    "its text is the Spanish template's, with the claim's and the member's values and no placeholder left",
    typeof firstText === 'string' &&
      firstText.includes('Aviso de denegación de reclamación') &&
      firstText.includes(DENIED.number) &&
      firstText.includes(`${SPANISH.firstName} ${SPANISH.lastName}`) &&
      firstText.includes(SPANISH.number) &&
      / de \p{L}+ de \d{4}/u.test(firstText) &&
      !firstText.includes('{{') &&
      !firstText.includes(SPANISH.ssn),
    String(firstText).slice(0, 300),
  );
  await h.goToDoc(claim.uid);
  const card = page.locator('.record-page__card[data-card-id="letters"]');
  await card
    .locator('tbody tr')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(unread);
  const rows = await card
    .locator('tbody tr')
    .allInnerTexts()
    .catch(() => []);
  h.check(
    "the claim's Letters card lists it",
    first !== null && rows.some((row) => row.includes(first.title)),
    JSON.stringify(rows),
  );
  await h.screenshot('claim-letters-card');
  const audited = await until(async () => {
    const all = await history(claim.uid);
    const ours = all.filter(
      (entry) => entry.eventId === AUDITED && first && entry.comment.includes(first.uid),
    );
    return ours.length > 0 ? ours : null;
  });
  h.check(
    `the claim's history holds ${AUDITED}, by the adjuster, naming the template and the letter`,
    audited !== null &&
      audited.length === 1 &&
      audited[0].principalName === ADJUSTER &&
      audited[0].category === 'Letters' &&
      audited[0].comment.includes(spanish.name),
    JSON.stringify(audited),
  );

  // ── L2. English chosen ─────────────────────────────────────────────────────────────────────
  await h.step('L2. The same letter with English chosen: written in English');
  const english = template('payers.denial', 'en');
  const beforeSecond = await letters(claim.uid);
  const chosen = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(DENIAL, claim.uid, { language: 'en' }),
  );
  h.check(
    'AgenticUi.RunAction, as the dialog sends it, answers 200',
    chosen.status === 200,
    String(chosen.status),
  );
  const second = await newLetter(claim.uid, beforeSecond);
  h.check(
    'one more letter beside the claim, in English, from the English template',
    second !== null &&
      second.properties?.['letter:language'] === 'en' &&
      second.properties?.['letter:templateName'] === english.name &&
      second.title === `${english.title}, ${claim.title}`,
    JSON.stringify(second ? { title: second.title, ...second.properties } : null),
  );
  const secondText = second ? await textOf(second) : '';
  h.check(
    "its text is the English template's, with the claim's values and no placeholder left",
    typeof secondText === 'string' &&
      secondText.includes('Notice of claim denial') &&
      secondText.includes(DENIED.number) &&
      !secondText.includes('{{'),
    String(secondText).slice(0, 300),
  );

  // ── L3. The appeal outcome letter ──────────────────────────────────────────────────────────
  await h.step('L3. Member services write the decision letter of the upheld appeal');
  const upheld = template('payers.appealOutcome', 'en', ['case:decision=upheld']);
  const beforeAppeal = await letters(kase.uid, asMemberServices);
  const appealRun = await asMemberServices(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(APPEAL, kase.uid, {}),
  );
  h.check(
    'member services run Write the appeal decision letter: 200',
    appealRun.status === 200,
    String(appealRun.status),
  );
  const appealLetter = await newLetter(kase.uid, beforeAppeal, asMemberServices);
  h.check(
    "the letter is the upheld template's, chosen by the stored case's decision, in the member's English",
    appealLetter !== null &&
      appealLetter.properties?.['letter:templateName'] === upheld.name &&
      appealLetter.properties?.['letter:language'] === 'en' &&
      appealLetter.properties?.['letter:writtenBy'] === MEMBER_SERVICES,
    JSON.stringify(appealLetter?.properties ?? null),
  );

  // ── The add-on and the allow-list refuse ───────────────────────────────────────────────────
  await h.step(
    'Refused: no Write, a language with no template, the allow-list, the chain called directly',
  );
  const lettersBefore = (await letters(claim.uid)).length;
  const entriesBefore = (await history(claim.uid)).filter(
    (entry) => entry.eventId === AUDITED,
  ).length;
  const noWrite = await asMemberServices('POST', `/api/v1/automation/${GENERATE}`, {
    input: `doc:${claim.uid}`,
    params: { letter: 'payers.denial' },
    context: {},
  });
  h.check(
    `member services, who read the claim and may not change it, calling ${GENERATE} directly: 403`,
    noWrite.status === 403,
    String(noWrite.status),
  );
  const swedish = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(DENIAL, claim.uid, { language: 'sv' }),
  );
  h.check(
    'the denial letter in Swedish, a language with no template: 400',
    swedish.status === 400,
    String(swedish.status),
  );
  const outsider = await asMemberServices(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(DENIAL, claim.uid, {}),
  );
  h.check(
    "the denial letter asked by member services, whom the allow-list's groups leave out: 403",
    outsider.status === 403,
    String(outsider.status),
  );
  const notDenied = await asAdjuster(
    'POST',
    `/api/v1/automation/${RUN_ACTION}`,
    runAction(DENIAL, inReview.uid, {}),
  );
  h.check(
    "the denial letter on a claim in review, a state the allow-list does not name: 403, whatever the button's rule",
    notDenied.status === 403,
    String(notDenied.status),
  );
  const direct = await asAdjuster('POST', `/api/v1/automation/${DENIAL_CHAIN}`, {
    input: `doc:${claim.uid}`,
    params: {},
    context: {},
  });
  h.check(
    "the kit's chain called through Nuxeo's own endpoint is refused by its first step, AgenticUi.RequireRunAction",
    typeof direct.status === 'number' && direct.status >= 400,
    String(direct.status),
  );
  // The audit is written a moment after a change: wait as long as the run's own entries took.
  await page.waitForTimeout(3000);
  const lettersAfter = (await letters(claim.uid)).length;
  const entriesAfter = (await history(claim.uid)).filter(
    (entry) => entry.eventId === AUDITED,
  ).length;
  h.check(
    "none of the five refused requests filed a letter, or wrote to the claim's history",
    lettersAfter === lettersBefore &&
      entriesAfter === entriesBefore &&
      (await letters(inReview.uid)).length === 0,
    `${lettersBefore} letters and ${entriesBefore} entries before, ${lettersAfter} and ${entriesAfter} after`,
  );

  // ── The button follows the record ──────────────────────────────────────────────────────────
  await h.step('No denial letter button on a claim that is not denied');
  await h.goToDoc(inReview.uid);
  await page.locator('nxs-document-toolbar').first().waitFor({ timeout: 30_000 }).catch(unread);
  h.check(
    `the claim in review ${reviewing.number} does not offer it: its visibleWhen reads the record's state`,
    (await page.locator(`[data-action-id="${DENIAL}"]`).count()) === 0,
  );

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
  h.note(
    "not run here: the language chosen in the dialog's vocabulary field; L2 sends what the dialog " +
      'sends, through AgenticUi.RunAction',
  );
  h.note(
    'not run here: a template that tries to reach what it should not, which an administrator ' +
      "cannot save and nuxeo-agentic-letters' tests refuse",
  );
  h.note(
    `the run leaves its three letters, two beside ${DENIED.number} and one beside ` +
      `${DECIDED.number}, and their entries in those records' histories`,
  );
}
