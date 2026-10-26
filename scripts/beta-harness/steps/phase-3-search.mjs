/**
 * Phase 3 — the one thing its evidence never covered: search, against live Nuxeo.
 *
 * ## Why this file exists separately
 *
 * `phase-3-adf-hx.mjs` has fifteen steps and none of them touches search. The phase's
 * own record says so in as many words: *"SEARCH IS STILL NOT VERIFIED AGAINST LIVE
 * NUXEO. The port is now correct at the wire — the generated NXQL is asserted — but no
 * evidence run drives the /#/search-adf-hx page against the real instance, so result
 * rendering, paging and the empty state are unproven."* That is why the phase is
 * recorded `in-progress` rather than complete, and this closes it.
 *
 * A separate file rather than fifteen more steps in an already 736-line one: this
 * covers a distinct claim and can be re-run on its own in seconds.
 *
 * ## Which checks are load-bearing
 *
 * - Step 2 is the phase's actual gap: a full-text term returns **real Nuxeo documents
 *   with titles that came from the repository**, cross-checked against what the REST
 *   API returns for the same term. Asserting "some rows rendered" would pass against
 *   any list, so the titles are compared.
 * - Step 4 is the empty state. A search UI that renders nothing for a nonsense term
 *   looks identical to one that is broken, so the empty state is asserted explicitly.
 * - Step 5 is paging. The register notes paging was only ever unit-tested; this drives
 *   the control and asserts the page indicator moves.
 *
 * - Step 3 is **negative**: it re-runs the same query and checks the count is stable.
 *   It would also pass if search were returning a constant, which is why step 2 does
 *   the work.
 *
 * ## The known flakiness, handled rather than ignored
 *
 * `phase-3-adf-hx.mjs` avoids NXQL search deliberately, because it is OpenSearch-backed
 * here and lags a check-in by seconds. So this file does not create content: it queries
 * the REST API first for a term, and only asserts the UI against terms the index has
 * already settled on. If the index has nothing, it aborts as a precondition rather than
 * reporting a failure that is really an environment.
 *
 * Prerequisites:
 *   docker start nuxeo
 *   npx nx serve nuxeo-ui
 *   npm run beta:evidence -- phase-3-search
 */

import { PreconditionError } from '../helpers.mjs';
import { checkFetchIdentity, ME_PATH } from '../identity-guard.mjs';

/**
 * The independent answer is asked of Nuxeo directly, not through the app's proxy. `NUXEO_URL`
 * names it, as for `backend-preflight.mjs`, so a run against a Nuxeo of your own does not compare
 * the app with a different server; and its identity is checked before its answer is used.
 */
const NUXEO = `${(process.env['NUXEO_URL'] ?? 'http://localhost:8080').replace(/\/+$/, '')}/nuxeo`;

/**
 * Credentials from the environment, with **no** fallback.
 *
 * `.cursor/rules/security.mdc`: "NEVER use Basic auth with hardcoded fallback defaults".
 * Moving the literal default Docker user/pass pair out of the `Buffer.from` and into a `??`
 * default leaves the same working credential pair in the repository — it is the spelling
 * that changed, not the fact. `apps/nuxeo-ui-e2e/src/fixtures.ts` and
 * `scripts/collect-evidence/story-runner.mjs` both throw here, and this file should match
 * them rather than the older harness scripts that still default.
 */
const USER = process.env['NUXEO_USER'];
const PASS = process.env['NUXEO_PASS'];
if (!USER || !PASS) {
  // `PreconditionError`, not `Error`. This throw happens while `phase-runner.mjs` is doing
  // `await import(stepsFile)` inside its try, and its catch keys on the error's NAME: a
  // `PreconditionError` sets `preconditionFailure` and the run exits 2, anything else exits 1.
  // Absent credentials are an environment precondition, and the runner's own docblock says
  // exit 1 means "iterate, this is a defect" while exit 2 means "do NOT iterate; fix the
  // environment". As a plain `Error` this reported `[error] steps aborted` and exited 1,
  // inviting someone to change working code to satisfy a step that was never applicable.
  throw new PreconditionError(
    '\nNUXEO_USER and NUXEO_PASS must both be set to run the phase-3-search evidence step.\n\n' +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>\n\n' +
      '  There is deliberately no default: a hardcoded Administrator pair is a credential in\n' +
      '  the repository, and one that is wrong on every instance but a local Docker one.',
  );
}
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

/** Ask Nuxeo directly, so the UI is compared against an independent answer. */
async function restSearch(term, pageSize = 20) {
  const url =
    `${NUXEO}/api/v1/search/lang/NXQL/execute` +
    `?query=${encodeURIComponent(`SELECT * FROM Document WHERE ecm:fulltext = '${term}'`)}` +
    `&pageSize=${pageSize}`;
  const res = await fetch(url, { headers: { Authorization: AUTH } });
  if (!res.ok) return null;
  const body = await res.json();
  return {
    count: body.resultsCount ?? 0,
    titles: (body.entries ?? []).map((e) => e.title).filter(Boolean),
  };
}

async function signIn(page, baseUrl) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    // This Nuxeo permits anonymous access, so without this the app auto-authenticates
    // as Anonymous, which can see a fraction of the repository.
    sessionStorage.setItem('agentic_ui_signed_out', '1');
  });
  // And no cookie from that boot: a guest session that has answered an API call outranks the
  // Basic header the sign-in form is about to send (NXSAT-643).
  await page.context().clearCookies();

  /**
   * A real reload, not a hash navigation.
   *
   * The flag is set *after* the application has already booted, and the runner may
   * have navigated the page before the steps file ran — so `goto(baseUrl)` can be a
   * no-op and `goto('#/login')` is a same-document hash change under
   * `withHashLocation()`, which does not re-run `APP_INITIALIZER` or the guard. The
   * app therefore stayed signed in as Anonymous and bounced `/#/login` to
   * `/#/dashboard`, and the run reported a precondition failure that was really this.
   */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.goto(`${baseUrl}/#/login`, { waitUntil: 'domcontentloaded' });

  /**
   * Wait for the field rather than sampling once.
   *
   * A fixed 2.5s sleep was enough in a bare probe and not enough under the phase
   * runner, which boots the app with route interception installed. A single
   * `isVisible()` against a form that has not rendered yet reports "no login form"
   * and the run then reports a precondition failure that is really a race.
   */
  const username = page.locator('input[formcontrolname="username"]');
  await username.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  if (!(await username.isVisible().catch(() => false))) return false;

  await username.fill(USER);
  await page.locator('button[type="submit"]').first().click();

  const password = page.locator('input[formcontrolname="password"]');
  await password.waitFor({ state: 'visible', timeout: 15000 });
  await password.fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  return !(await password.isVisible().catch(() => false));
}

const SEARCH_INPUT = 'input[placeholder="Enter search term..."]';

/** Type a term and wait past the 300ms debounce plus the round trip. */
async function search(page, term) {
  const input = page.locator(SEARCH_INPUT);
  await input.fill('');
  await page.waitForTimeout(400);
  await input.fill(term);
  await page.waitForTimeout(3500);
}

/**
 * `adf-datatable-row` is NOT a descendant of `hxp-document-list` in the rendered DOM —
 * scoping the selector to it matched zero rows while 51 were on screen, and the run
 * reported "no rows rendered" against a working list. Query the rows directly.
 */
const resultTitles = (page) =>
  page.$$eval('adf-datatable-row', (rows) =>
    rows
      .map((r) => r.querySelector('.adf-datatable-cell-value')?.textContent?.trim())
      .filter((t) => t && t.length > 0),
  );

const countText = async (page) =>
  (await page
    .locator('.hxp-search-page__results-count')
    .first()
    .textContent()
    .catch(() => '')) ?? '';

export default async function run(page, h) {
  // -------------------------------------------------------------------------
  await h.step('Precondition: signed in, and the full-text index has settled on a term');

  const signedIn = await signIn(page, h.baseUrl).catch(() => false);
  h.requirePrecondition(
    `signed in as ${USER}`,
    signedIn,
    'The login form did not complete. This Nuxeo allows anonymous access, so an ' +
      'unauthenticated run would search a fraction of the repository and report a ' +
      'smaller count as though it were the answer.',
  );

  // The reference channel: a guest-enabled Nuxeo answers a lost header as `Anonymous` with real,
  // smaller results, which would then read as the right count (NXSAT-643).
  const reference = await checkFetchIdentity(`${NUXEO.replace(/\/nuxeo$/, '')}${ME_PATH}`, AUTH, USER);
  h.requirePrecondition(
    `the REST reference at ${NUXEO} answers as ${USER}`,
    reference.ok,
    `${reference.problem}. Set NUXEO_URL to the Nuxeo the app is served against.`,
  );

  // Pick a term the index already knows about, rather than creating content and
  // racing the indexer — the reason the main Phase 3 run avoids NXQL search.
  let term = null;
  let expected = null;
  for (const candidate of ['claim', 'nuxeo', 'test', 'document']) {
    const result = await restSearch(candidate);
    if (result && result.count > 0) {
      term = candidate;
      expected = result;
      break;
    }
  }

  // `term !== null` rather than `Boolean(term)`: the assertion audit cannot prove a
  // `Boolean(...)` wrapper varies, and it is right to be suspicious — a precondition
  // that cannot fail is worse than none.
  h.requirePrecondition(
    'the OpenSearch full-text index returns at least one document',
    term !== null,
    'No candidate term matched anything over REST, so the UI cannot be compared ' +
      'against an independent answer. This is an environment state, not a defect: ' +
      'seed content and let the index settle, then re-run.',
  );
  h.note(
    `Comparing the UI against REST for the term "${term}", which Nuxeo reports as ` +
      `${expected.count} result(s). The term was chosen because the index already has ` +
      'it, so this run does not race the indexer.',
  );

  await page.goto(`${h.baseUrl}/#/search-adf-hx`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  h.requirePrecondition(
    'the adf-hx search page renders',
    Boolean(await page.$('.hxp-search-page')),
    'No `.hxp-search-page` found — check the route still exists.',
  );

  /**
   * Disable animations before any screenshot.
   *
   * `page.screenshot()` waits for the page to be visually stable, and this page has a
   * perpetual Material animation, so every capture timed out after 30s with "fonts
   * loaded" and then nothing. Affects only the capture, not what is asserted — every
   * check above and below reads the DOM directly.
   */
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; ' +
      'caret-color: transparent !important; }',
  });

  await h.screenshot('search-page-initial');

  // -------------------------------------------------------------------------
  await h.step('The gap Phase 3 recorded: a full-text term returns real Nuxeo documents');

  await search(page, term);
  const titles = await resultTitles(page);
  const shown = await countText(page);

  h.check(
    `the page renders at least one row for "${term}"`,
    titles.length > 0,
    `no rows rendered, while REST reports ${expected.count} result(s) for the same term`,
  );

  // The load-bearing assertion: the titles on screen are titles Nuxeo returned, not
  // whatever the list happened to be showing before.
  const overlap = titles.filter((t) => expected.titles.some((e) => e === t || e.includes(t)));
  h.check(
    'the rendered titles are documents REST returns for the same query',
    overlap.length > 0,
    `rendered [${titles.slice(0, 5).join(' | ')}] but REST returned ` +
      `[${expected.titles.slice(0, 5).join(' | ')}] — the list is not showing this query's results`,
  );

  h.check(
    'a result count is displayed',
    /\d+\s+result/i.test(shown),
    `results-count read "${shown.trim()}"`,
  );
  h.note(`UI shows "${shown.trim()}"; REST reports ${expected.count} for the same term.`);
  await h.screenshot('search-results-real-documents');

  // -------------------------------------------------------------------------
  await h.step('The same query twice returns the same count (negative check)');

  const first = (await countText(page)).trim();
  await search(page, term);
  const second = (await countText(page)).trim();
  h.check(
    'repeating the query is stable',
    first === second,
    `"${first}" then "${second}". This check would also pass if search returned a ` +
      'constant, so read it alongside step 2 rather than on its own.',
  );

  // -------------------------------------------------------------------------
  await h.step('A term with no matches renders the empty state, not an empty page');

  await search(page, 'zzznomatchzzz' + Date.now());
  const emptyTitles = await resultTitles(page);
  h.check(
    'no rows are rendered',
    emptyTitles.length === 0,
    `rendered ${emptyTitles.length} row(s)`,
  );
  h.check(
    'the "no results" state is visible',
    Boolean(await page.$('.hxp-search-page__no-results')),
    'Neither rows nor an empty state: a broken search and a genuinely empty result ' +
      'would look identical to a user.',
  );
  await h.screenshot('search-empty-state');

  // -------------------------------------------------------------------------
  await h.step('Paging drives the port, which was only ever unit-tested');

  /**
   * Paged against the **unfiltered** result set, not the search term.
   *
   * `claim` matches 8 documents and the page size is 50, so there is no second page
   * and Next is correctly disabled — driving it there proves nothing. Clearing the
   * term returns the whole repository, which does page. An earlier cut paged on the
   * term, clicked a disabled control, and reported an empty page 2 as a failure of the
   * offset rather than as the end of the results.
   */
  await search(page, '');
  const pageInfoBefore =
    (await page
      .locator('.hxp-search-page__page-info')
      .textContent()
      .catch(() => '')) ?? '';
  const titlesBefore = await resultTitles(page);
  h.note(`Paging the unfiltered result set: ${(await countText(page)).trim()}.`);

  const next = page.locator('.hxp-search-page__pagination button').last();
  const canPage = (await next.count()) > 0 && (await next.isEnabled().catch(() => false));

  if (!canPage) {
    h.note(
      'The Next control is absent or disabled, so paging could not be driven. Not ' +
        'recorded as a pass: the register still lists a second page as unexercised.',
    );
  } else {
    await next.click();
    await page.waitForTimeout(3500);
    const pageInfoAfter =
      (await page
        .locator('.hxp-search-page__page-info')
        .textContent()
        .catch(() => '')) ?? '';
    const titlesAfter = await resultTitles(page);

    h.check(
      'the page indicator advances',
      pageInfoBefore.trim() !== pageInfoAfter.trim(),
      `indicator read "${pageInfoBefore.trim()}" before and "${pageInfoAfter.trim()}" after`,
    );
    // Rows changing is the real proof the offset reached the server; the indicator
    // alone is client state.
    // No `length === 0` escape. An earlier cut allowed "zero rows" to satisfy this,
    // and zero rows is precisely what the broken search produced — so the check
    // passed against a page that was fetching nothing at all.
    h.check(
      'the second page renders rows, and they differ from the first',
      titlesAfter.length > 0 && titlesAfter.join('|') !== titlesBefore.join('|'),
      `page 1 [${titlesBefore.slice(0, 3).join(' | ')}] vs page 2 ` +
        `[${titlesAfter.slice(0, 3).join(' | ')}] — identical or empty means the offset ` +
        'is not reaching Nuxeo',
    );
    await h.screenshot('search-second-page');
  }

  // -------------------------------------------------------------------------
  await h.step('Health');
  h.note(
    'Not covered here: the four upstream search filter components (created-date, ' +
      'document-category, file-type, saved searches) remain unadopted, and the HXQL ' +
      'translation still refuses every statement it does not recognise by name.',
  );
  await h.expectNoConsoleErrors('no unexpected console errors on the search page', [
    // Ignored by **specific path**, not by a blanket 'Failed to load resource' — which
    // an earlier cut used and which would have hidden any resource failure at all,
    // making this check unable to fail.
    //
    // Nothing answers `agentic-ui-config/*` under `nx serve` unless a developer has put a
    // file there; falling back to packaged defaults is the documented behaviour, and
    // `app-config` reports it.
    '/agentic-ui-config/bootstrap.json',
    '/agentic-ui-config/manifest.json',
    // This run signs out deliberately in order to reach the login form.
    '/nuxeo/logout',
    // The AI backend is a separate marketplace package; its absence is a 500 by design.
    'AI.',
  ]);
}
