import type { A11yFixture, ScanPageOptions } from '@a11y-scout/playwright';
import type { Page, Response, TestInfo, TestType } from '@playwright/test';
import {
  aiFindingsNote,
  expect,
  expectSurfaceUsable,
  REPORT_DIR,
  requireNuxeoCredentials,
  test,
  waitForScreenSettled,
} from '../fixtures';
import {
  JOURNEY_SCREENS,
  journeyReportName,
  journeyTag,
  type JourneyScreenId,
} from './journey.screens';

/**
 * WCAG 2.1 AA scan of the **user journey**, one self-contained report per screen.
 *
 * ## What this adds over the suites that already exist
 *
 * `surfaces.a11y.spec.ts` scans seven authenticated routes into ONE consolidated report, and
 * `interaction-states.a11y.spec.ts` scans seven states behind clicks into another. Both group
 * their output by WCAG rule, which answers "which rules does this app fail" but not "how bad
 * is the screen I am about to demo". This file answers the second question: it walks the
 * screens in the order a real user meets them and emits a separate report for each, so a
 * screen can be handed to whoever owns it without them reading around six other screens.
 *
 * Most screens below are scanned here and by nothing else:
 *
 *   - **login** — no committed script has ever scanned it. It was covered once by an ad-hoc
 *     `a11y-scout scan-url` against a backend-less dev server, which is not the same page:
 *     that run saw the form in its error state.
 *   - **dashboard** — `apps/nuxeo-ui/src/app/app.routes.ts` redirects `path: ''` here, so it is
 *     the first screen
 *     every signed-in user sees, and it is absent from `SURFACES`.
 *   - **document detail** — the most-used read surface in the product.
 *   - **search with a query, documents, a collection, personal space** — routed screens with
 *     real result lists, none in `SURFACES` except `/#/search`, which that suite scans with no
 *     query applied.
 *   - **favorites, recently viewed, clipboard, expired queue** — these routes render a
 *     "Coming soon" placeholder; the screen is the nav-drawer panel that a deep link opens.
 *     Other suites see the drawer only as it is on their own routes — the folder tree on
 *     browse, the tasks panel on tasks — so these four panels are scanned here and nowhere else.
 *
 * Tasks, trash and administration are in `SURFACES` too, but there with only the general
 * `expectSurfaceUsable` check. How strongly each screen here is tied to real content varies,
 * and each test says which applies:
 *
 *   - **its own data request succeeded, and the first entry it returned is on screen** —
 *     search, documents, collection, favorites, recently viewed, trash, and the expired queue
 *     when it has entries. See `captureDataRequest`. On search, documents and trash the drawer
 *     makes the same kind of request, and every one of them must succeed — see
 *     `captureEveryDataRequest`.
 *   - **its own data request succeeded, and the screen that follows from it is shown** — tasks
 *     (the first task's form, or the empty inbox; the drawer's identical request must succeed
 *     too), personal space (the redirect to the path the server returned) and administration
 *     (the request succeeded; the landing tab shows no repository data to check against).
 *   - **a named document is on screen, from a separate repository query** — document detail,
 *     and clipboard, whose content is seeded in the browser rather than requested.
 *   - **the screen rendered without an error state** — login, dashboard and browse, which have
 *     no single piece of data guaranteed to be present.
 *
 * ## Why one Playwright project per screen, rather than one `generateReport()` call each
 *
 * The a11y-scout accumulator is **worker-scoped**, and `finalizeAndEmit` does not clear
 * `pageScans` when it emits — it only flips `reportEmitted`. Calling `generateReport()` once
 * per screen inside a single worker would therefore produce cumulative reports: login, then
 * login+dashboard, then login+dashboard+browse. Each would be labelled with one screen and
 * contain several, which is precisely the kind of self-confirming artifact this repository
 * has been bitten by before.
 *
 * A Playwright project gets its own worker, so `../playwright.config.ts` declares one
 * project per screen and each accumulates and emits independently. `emitScreenReport()`
 * asserts `pagesScanned.length === 1` so that if this assumption ever stops holding — a
 * Playwright change, a fixture change — the run goes red instead of quietly emitting a
 * report that covers more than its title claims.
 *
 * ## Prerequisites (versions kept in sync with a11y/versions.mjs)
 *
 *   npm install --no-save @playwright/test@1.63.0 @axe-core/playwright@4.13.0 \
 *     <path>/a11y-scout-0.3.0.tgz <path>/a11y-scout-playwright-0.3.0.tgz
 *   npm run beta:backend && npx nx serve nuxeo-ui
 *
 * Run:
 *   npm run a11y:scan -- journey
 */

/**
 * Scan settings shared by every screen, so no screen is accidentally measured more weakly
 * than its neighbours and a cross-screen comparison stays meaningful.
 *
 * `keyboard` is on everywhere. It is the reason this suite exists — axe cannot detect a
 * keyboard trap or a modal focus leak, and on the column picker alone the keyboard walk
 * produced 42 of 51 findings. `noFocusIndicatorScreenshots` is on for the same reason as in
 * `surfaces.a11y.spec.ts`: tier-2 pixel-diffing costs minutes per screen to upgrade a
 * heuristic that already reports, and nothing here is triaged yet.
 */
const SCREEN_SCAN: ScanPageOptions = {
  level: 'AA',
  failOnBlockers: false,
  keyboard: true,
  noFocusIndicatorScreenshots: true,
};

/**
 * The fixtures a journey test receives, derived from the `test` object rather than restated.
 *
 * Written this way because `Parameters<typeof test>[1]` resolves to `TestDetails` — `test` is
 * overloaded as `(title, body)` and `(title, details, body)` — which typechecks against nothing
 * useful and produces a wall of implicit-`any` errors at each call site.
 */
type JourneyArgs =
  typeof test extends TestType<infer Args, infer WorkerArgs> ? Args & WorkerArgs : never;
type JourneyBody = (args: JourneyArgs, testInfo: TestInfo) => Promise<void> | void;

/** Screens that have actually been given a test below. Checked against `JOURNEY_SCREENS`. */
const declared = new Set<JourneyScreenId>();

/**
 * Declare one screen's test.
 *
 * The only way to add a screen to this file, and it exists to remove a whole class of silent
 * failure. The tag is derived from the same `id` the config derives the project's `grep` from,
 * so the two cannot drift; and the id is a literal union, so a typo is a compile error rather
 * than a project that quietly matches nothing.
 *
 * See `assertEveryScreenDeclared()` for the other half — this guards a *mistyped* screen, that
 * guards a *missing* one.
 */
function journeyTest(id: JourneyScreenId, body: JourneyBody): void {
  const screen = JOURNEY_SCREENS.find((s) => s.id === id);
  if (!screen) {
    throw new Error(`journeyTest called with an id absent from JOURNEY_SCREENS: ${id}`);
  }
  declared.add(id);
  test(`${screen.label} ${journeyTag(id)}`, body);
}

/**
 * Fail collection if a screen is declared in `journey.screens.ts` but has no test here.
 *
 * Called at module scope, so it throws while Playwright is loading the file — which fails
 * *every* project, including a run that filtered down to one screen. That matters because of
 * the behaviour this whole arrangement is built around: Playwright reports "No tests found"
 * only when the entire run is empty, so an unwritten screen's project would otherwise be
 * dropped in silence alongside the screens that do work, and the command would stay green.
 */
function assertEveryScreenDeclared(): void {
  const missing = JOURNEY_SCREENS.filter((s) => !declared.has(s.id)).map((s) => s.id);
  if (missing.length > 0) {
    throw new Error(
      `journey.a11y.spec.ts: ${missing.length} screen(s) declared in journey.screens.ts have ` +
        `no test here: ${missing.join(', ')}. Its Playwright project exists and would match ` +
        `nothing, which Playwright does not report when other projects match — so the screen ` +
        `would silently never be scanned. Add a journeyTest('<id>', …) call, or remove the ` +
        `entry from JOURNEY_SCREENS.`,
    );
  }
}

/**
 * Emit this screen's report and prove it covers this screen only.
 *
 * The assertion is the load-bearing part. A per-screen report that silently accumulated a
 * previous screen would still be a valid HTML file with plausible numbers in it, and nobody
 * reading it would notice.
 *
 * `screenState` is printed beside the report when what was scanned is not the screen's
 * populated state — an empty task inbox, say — so a low count is never read as a clean one.
 */
async function emitScreenReport(
  a11y: A11yFixture,
  reportName: string,
  screenState?: string,
): Promise<void> {
  const { state, reportPaths } = await a11y.generateReport({
    outDir: REPORT_DIR,
    reportName,
    failOnBlockers: false,
  });

  const { findings } = state;
  const bySource = [...new Set(findings.map((f) => f.source))]
    .map((s) => `${s}=${findings.filter((f) => f.source === s).length}`)
    .join(' ');

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `  screen    : ${reportName}`,
      ...(screenState ? [`  state     : ${screenState}`] : []),
      `  page      : ${state.meta.pagesScanned.join(', ')}`,
      `  findings  : ${findings.length} (${bySource})`,
      `  blockers  : ${findings.filter((f) => f.severity === 'blocker').length}`,
      `  rules     : ${[...new Set(findings.map((f) => f.ruleId))].sort().join(', ') || '—'}`,
      `  provider  : ${state.meta.llmProvider}${state.meta.llmMockMode ? ' (MOCK)' : ''}`,
      `  ai findings: ${aiFindingsNote(state)}`,
      `  report    : ${reportPaths.html}`,
      '',
    ].join('\n'),
  );

  expect(
    state.meta.pagesScanned.length,
    `"${reportName}" must be a self-contained report covering exactly one screen — ` +
      `got ${state.meta.pagesScanned.length}: ${state.meta.pagesScanned.join(', ')}`,
  ).toBe(1);
}

/**
 * A uid for a document that actually opens in the detail view.
 *
 * Resolved from the repository rather than by clicking a row, because `onRowClick` routes
 * folderish documents to `/browse` and collections to `/collections` — only a non-folderish
 * document reaches `/doc/:uid`. The browse root of a fresh instance shows a single folder,
 * so "click the first row" would land on browse and scan it under the document-detail label.
 *
 * Three constraints on the query, each of which this repository's data violated on the
 * first attempt:
 *
 *   - `FROM File` rather than `FROM Document`. A plain non-folderish query returns
 *     `AdministrativeStatus` records from `/management` first — internal plumbing with no
 *     blob, no thumbnail and no preview, which would scan a near-empty detail view and
 *     report it as the document screen.
 *   - `ecm:mixinType <> 'HiddenInNavigation'` for the same reason: hidden documents are not
 *     a screen any user reaches.
 *   - `ORDER BY dc:created` so repeated runs open the same document and two reports for
 *     this screen are comparable.
 *
 * Credentials are never handled here: the request goes through the app origin, so the
 * `httpCredentials` block in `playwright.config.ts` — itself read from `NUXEO_USER` /
 * `NUXEO_PASS` — authenticates it, and the dev-server proxy forwards it to Nuxeo.
 *
 * The title comes back with the uid so the screen assertion can prove the detail view
 * rendered *that* document rather than an error panel, which is also visible.
 */
async function firstOpenableDocument(page: Page): Promise<RepoEntry> {
  const entries = await nxqlEntries(
    page,
    "SELECT * FROM File WHERE ecm:mixinType <> 'HiddenInNavigation' " +
      'AND ecm:isVersion = 0 AND ecm:isTrashed = 0 ORDER BY dc:created',
    1,
    'document detail',
  );
  return requireEntry(
    entries,
    'the repository holds no File document, so there is nothing to open in the detail view — ' +
      'seed a document before running this screen rather than letting it scan an error panel',
  );
}

const FILE_WITH_MAIN_BLOB_NXQL =
  "SELECT * FROM File WHERE ecm:mixinType <> 'HiddenInNavigation' " +
  'AND ecm:isVersion = 0 AND ecm:isTrashed = 0 AND file:content/name IS NOT NULL ' +
  'ORDER BY dc:created';

/**
 * A File whose main blob is persisted — required when the scan must reach footer controls that
 * only render when `fileName()` is populated (`document-detail.html`).
 */
async function firstFileWithMainBlob(page: Page): Promise<RepoEntry> {
  let chosen: RepoEntry | undefined;
  let examined = 0;
  for (let pageIndex = 0; !chosen; pageIndex++) {
    const { entries, isNextPageAvailable } = await nxqlPage(
      page,
      FILE_WITH_MAIN_BLOB_NXQL,
      20,
      pageIndex,
      'document detail blob',
    );
    if (entries.length === 0 && isNextPageAvailable) {
      throw new Error(
        `document detail blob: page ${pageIndex} of the File query is empty but claims another ` +
          'follows, so paging it would never end',
      );
    }
    for (const candidate of entries) {
      examined++;
      const head = await page.request.head(`/nuxeo/api/v1/id/${candidate.uid}/@blob/file:content`, {
        failOnStatusCode: false,
      });
      if (head.ok()) {
        chosen = candidate;
        break;
      }
    }
    if (!isNextPageAvailable) {
      break;
    }
  }
  return requireEntry(
    chosen ? [chosen] : [],
    `the repository holds no File with a persisted main blob among ${examined} candidate(s) — ` +
      'seed a document with file:content before running document detail when replace-main-file ' +
      'must be in the scanned DOM',
  );
}

/** The fields of a Nuxeo document entry this file reads. */
interface RepoEntry {
  readonly uid: string;
  readonly title: string;
  readonly type?: string;
}

/**
 * Run an NXQL query through the app origin and return its entries.
 *
 * For **setup** only — choosing which collection to open, say. It is never the evidence that
 * a screen loaded; that is the screen's own request, captured by `captureDataRequest` or
 * `captureEveryDataRequest`.
 * Credentials come from `httpCredentials`, as in `firstOpenableDocument`.
 */
async function nxqlEntries(
  page: Page,
  query: string,
  pageSize: number,
  label: string,
): Promise<RepoEntry[]> {
  return (await nxqlPage(page, query, pageSize, 0, label)).entries;
}

/**
 * One page of an NXQL query, and whether Nuxeo says there is another.
 *
 * `isNextPageAvailable` is required rather than defaulted to `false`: a body without it would
 * end the caller's paging after the first page and report the rest of the repository as absent.
 */
async function nxqlPage(
  page: Page,
  query: string,
  pageSize: number,
  currentPageIndex: number,
  label: string,
): Promise<{ entries: RepoEntry[]; isNextPageAvailable: boolean }> {
  const response = await page.request.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
    params: { query, pageSize, currentPageIndex },
  });
  expect(
    response.ok(),
    `repository query failed with ${response.status()} — ${label} cannot be scanned`,
  ).toBeTruthy();
  const body: unknown = await response.json();
  const isNextPageAvailable = (body as { isNextPageAvailable?: unknown } | null)
    ?.isNextPageAvailable;
  if (typeof isNextPageAvailable !== 'boolean') {
    throw new Error(
      `${label}: page ${currentPageIndex} of the repository query has no boolean ` +
        '`isNextPageAvailable`, so there is no telling whether the rest was searched',
    );
  }
  return { entries: entriesOf(body), isNextPageAvailable };
}

/**
 * `entries` from a Nuxeo list response.
 *
 * Throws when there is no `entries` array rather than returning none: an empty list is a
 * legitimate answer on tasks and the expired queue, where it selects the empty-state scan, so a
 * malformed body read as `[]` would be reported as "0 task(s)" instead of as malformed. A list
 * response with nothing in it still carries `entries: []`.
 */
function entriesOf(body: unknown): RepoEntry[] {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) {
    const shape =
      body !== null && typeof body === 'object'
        ? `keys: ${Object.keys(body).join(', ') || 'none'}`
        : String(body);
    throw new Error(
      `a list response had no \`entries\` array (${shape}), so it cannot say what the screen holds`,
    );
  }
  return entries as RepoEntry[];
}

/**
 * The first entry, or a failure that says what to seed.
 *
 * `throw` rather than `expect(...).toBeTruthy()`: the latter does not narrow the type, so it
 * would leave non-null assertions behind at every call site, and the message is no weaker.
 *
 * The entry's `uid` and `title` are checked, not trusted from the cast in `entriesOf`. Every
 * caller goes on to require that title on screen, and a missing or empty one would make that
 * check vacuous: `filter({ hasText: '' })` keeps every row and `toContainText('')` passes on
 * any page, error panels included.
 */
function requireEntry(entries: readonly RepoEntry[], whyEmptyIsFatal: string): RepoEntry {
  const entry = entries[0];
  if (!entry) throw new Error(whyEmptyIsFatal);
  const { uid, title } = entry as { uid?: unknown; title?: unknown };
  if (typeof uid !== 'string' || uid === '' || typeof title !== 'string' || title.trim() === '') {
    throw new Error(
      `the first entry has no usable uid or title (${JSON.stringify({ uid, title })}), so ` +
        'nothing on screen could be checked against it',
    );
  }
  return entry;
}

/**
 * Navigate, and capture the response to the screen's **own** data request.
 *
 * ## Why the screen's request, not a separate query
 *
 * A REST query made by the test proves the repository holds data. It does not prove this
 * screen received it, and several screens here cannot be trusted to say when they did not:
 * the search page sets an `error` signal its template never renders, and the favorites and
 * collections panels have no error state at all — a failed request on any of them renders as
 * an empty list, which the error-class check cannot tell from a real one. Capturing the
 * request the screen itself made, and requiring it to succeed, closes that.
 *
 * The listener is registered before navigating, so a response that arrives during the
 * navigation is not missed. A navigation that fails is reported as that, not as a missing
 * request — the two have different causes and a shared message sent people after the wrong one.
 *
 * Only for a request no other component on the screen makes. Where another one does, the
 * first match may be the wrong one, and the other's failure goes unseen: use
 * `captureEveryDataRequest`.
 *
 * @param matches  identifies the request. Call sites match on more than the endpoint where
 *   the endpoint also serves requests for something else, such as the NXQL endpoint.
 */
async function captureDataRequest(
  page: Page,
  label: string,
  matches: (url: URL, method: string) => boolean,
  navigate: () => Promise<unknown>,
): Promise<unknown> {
  const firstLine = (err: unknown) =>
    err instanceof Error ? err.message.split('\n')[0] : String(err);
  const pending = page.waitForResponse((r) => matches(new URL(r.url()), r.request().method()), {
    timeout: 30_000,
  });
  try {
    await navigate();
  } catch (err) {
    // Observed so the abandoned wait cannot surface later as an unhandled rejection.
    pending.catch(() => undefined);
    throw new Error(`${label}: navigating to the screen failed — ${firstLine(err)}`);
  }
  let response: Response;
  try {
    response = await pending;
  } catch (err) {
    throw new Error(
      `${label}: the screen never made the data request this test waits for, so it cannot be ` +
        `shown to have loaded — ${firstLine(err)}`,
    );
  }
  expect(
    response.ok(),
    `${label}: its data request ${new URL(response.url()).pathname} failed with ` +
      `${response.status()} — the screen is showing a failure, not data`,
  ).toBeTruthy();
  return response.json();
}

/**
 * Navigate, and capture **every** response to a request that more than one component on the
 * screen makes, until the screen settles.
 *
 * For when the first match proves too little. Where the page and the drawer make the identical
 * request, the drawer's success can arrive first while the page's own request fails. Where
 * they differ only in `pageSize`, the drawer's request swallows its errors and renders empty
 * facets, a degraded panel the scan would measure as normal. Requiring every match to succeed,
 * and at least as many as there are known callers, leaves no unvalidated one.
 *
 * @param minimum  how many components are known to make the request; fewer is a failure,
 *   because one of them never asked
 * @param settle  run while still listening, so a request made late in the load is included
 * @returns each response's URL and body, in arrival order
 */
async function captureEveryDataRequest(
  page: Page,
  label: string,
  matches: (url: URL, method: string) => boolean,
  navigate: () => Promise<unknown>,
  settle: () => Promise<unknown>,
  minimum: number,
): Promise<{ url: URL; body: unknown }[]> {
  const seen: Response[] = [];
  const onResponse = (r: Response) => {
    if (matches(new URL(r.url()), r.request().method())) seen.push(r);
  };
  let settleError: unknown;
  page.on('response', onResponse);
  try {
    try {
      await navigate();
    } catch (err) {
      throw new Error(
        `${label}: navigating to the screen failed — ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
    }
    // Held until the responses are checked: a failed request is usually why the screen never
    // settled, and it is the cause worth reporting.
    await settle().catch((err: unknown) => {
      settleError = err;
    });
  } finally {
    page.off('response', onResponse);
  }

  for (const r of seen) {
    expect(
      r.ok(),
      `${label}: one of its data requests, ${new URL(r.url()).pathname}, failed with ${r.status()} — ` +
        'the screen may be showing a failure, not data',
    ).toBeTruthy();
  }
  if (settleError !== undefined) throw settleError;
  expect(
    seen.length,
    `${label}: ${minimum} components make this data request and only ${seen.length} response(s) ` +
      'arrived, so at least one of them was never shown to have loaded',
  ).toBeGreaterThanOrEqual(minimum);
  return Promise.all(seen.map(async (r) => ({ url: new URL(r.url()), body: await r.json() })));
}

/**
 * The page's own body among responses captured together, identified by a query parameter the
 * drawer's request sets differently.
 */
function pageResponse(
  label: string,
  responses: readonly { url: URL; body: unknown }[],
  param: string,
  value: string,
): unknown {
  const own = responses.find((r) => r.url.searchParams.get(param) === value);
  if (!own) {
    throw new Error(
      `${label}: none of the ${responses.length} matching response(s) had ${param}=${value}, ` +
        "so the page's own request was never seen",
    );
  }
  return own.body;
}

/** True for an NXQL GET whose query contains every fragment given. */
function isNxqlQuery(url: URL, ...fragments: string[]): boolean {
  if (!url.pathname.endsWith('/search/lang/NXQL/execute')) return false;
  const query = url.searchParams.get('query') ?? '';
  return fragments.every((f) => query.includes(f));
}

/** The shell's nav drawer, which is the whole screen on the placeholder routes. */
const NAV_DRAWER = 'app-nav-drawer';

/**
 * Prove the drawer is open and is not showing a load error.
 *
 * `.tree-empty.error` is deliberately absent from `ERROR_STATE_CLASSES`, whose checks are
 * scoped to a feature host — see `NOT_A_SURFACE_ERROR` in `../surface.mjs`. On the screens
 * where the drawer panel IS the screen, it has to be checked here or not at all.
 */
async function expectDrawerPanelHealthy(page: Page, label: string): Promise<void> {
  await expect(
    page.locator('mat-sidenav.nav-drawer-sidenav'),
    `${label}: the deep link must open the nav drawer, or there is no panel to scan`,
  ).toBeVisible();
  await expect(
    page.locator(`${NAV_DRAWER} .tree-empty.error`),
    `${label}: the drawer panel is showing its load error`,
  ).toHaveCount(0);
}

/**
 * The app's "the user pressed Sign out" marker. Mirrors `SIGNED_OUT_KEY` in
 * `apps/nuxeo-ui/src/app/auth/auth.service.ts`;
 * when it is set, `runHydration()` returns a null session without probing the server at all.
 */
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/**
 * Screen 1 — the sign-in form.
 *
 * ## Why simply omitting `signedIn` is not enough, and what that cost
 *
 * The obvious approach — don't request the `signedIn` fixture, so no session is injected,
 * so `authGuard` bounces `/` to `/#/login` — does not work here, and the first run of this
 * file failed on exactly that:
 *
 *     Expected pattern: /#\/login/
 *     Received string:  "http://localhost:4200/#/dashboard"
 *
 * With no stored session, `runHydration()` falls through to `tryEstablishCookieSessionOnly()`,
 * which GETs `/nuxeo/api/v1/me`. The base config sets `httpCredentials` for the app origin,
 * so Playwright answers that request's Basic auth challenge automatically, `/me` returns a
 * user, the app builds a cookie session, and the guard lets it through to the dashboard.
 * "No session injected" is therefore not the same as "signed out" — the browser signs itself
 * in on the app's behalf.
 *
 * That failure is the reason this test asserts the URL before scanning. Without it the scan
 * would have run on the dashboard and emitted a report titled `journey-01-login` containing
 * dashboard findings, which is the vacuous pass
 * `scripts/beta-harness/steps/phase-6-a11y.mjs` shipped once already.
 *
 * ## The two mechanisms used instead, and what each is for
 *
 *   - `httpCredentials: undefined` on this project (see `../playwright.config.ts`) removes
 *     the automatic Basic auth, so the browser genuinely has no credentials to offer.
 *   - The signed-out marker makes hydration short-circuit before it probes the server at all,
 *     so the screen does not depend on how the server answers an anonymous `/me`.
 *
 * Both are setup, not verification. The `toHaveURL` and `toBeVisible` assertions below are
 * what actually prove the sign-in form is on screen, and they have already been seen to fail.
 */
journeyTest('login', async ({ page, a11y }) => {
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), SIGNED_OUT_KEY);
  await page.goto('/', { waitUntil: 'networkidle' });

  await expect(page, 'a visit to / without credentials must land on the sign-in form').toHaveURL(
    /#\/login/,
  );
  await expect(page.locator('app-login-page'), 'app-login-page must render').toBeVisible();

  // No drawer on the sign-in page; this waits on the form alone.
  await waitForScreenSettled(page, 'app-login-page', false);

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('login'));
});

/**
 * Screen 2 — the dashboard, the landing screen after sign-in.
 *
 * `expectSurfaceUsable` rather than a hand-rolled host-plus-text check. It makes the same two
 * assertions and adds absence of the known error classes, and using the shared helper is what
 * stops this screen drifting below the standard the other scans hold — which is exactly what
 * had happened: surfaces and display-modes were tightened and this was left behind.
 *
 * Its limit still applies and is worth restating here: the dashboard has no single piece of
 * repository data guaranteed to be present, so nothing asserts the data actually arrived. A
 * silent failure with a plausible empty layout would still pass.
 */
journeyTest('dashboard', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/dashboard', { waitUntil: 'networkidle' });

  // The drawer renders a folder tree only on browse-family routes, so it is not required
  // here — but the widgets load on their own, and an error panel can arrive last.
  await waitForScreenSettled(page, 'app-dashboard-page', false);
  await expectSurfaceUsable(page, 'app-dashboard-page', 'dashboard');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('dashboard'));
});

/**
 * Screen 3 — browse, the primary navigation surface.
 *
 * Scanned by `surfaces.a11y.spec.ts` too, deliberately. It is in the journey because a
 * per-screen report for browse is the thing someone owning browse would be handed, and
 * because it is the control: its numbers here should match its slice of the surfaces run,
 * which is a cheap cross-check that the per-screen split did not change what is measured.
 */
journeyTest('browse', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/browse', { waitUntil: 'networkidle' });

  await expect(page.locator('lib-browse'), 'lib-browse must render').toBeVisible();
  await expect(
    page.locator('.browse-row, .doc-card-wrapper').first(),
    'browse must list at least one document, or this scans an empty table',
  ).toBeVisible();
  await waitForScreenSettled(page, 'lib-browse', true);
  await expectSurfaceUsable(page, 'lib-browse', 'browse');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('browse'));
});

/**
 * Enter the Replace main file tooltip interaction state without an axe WCAG verdict.
 *
 * Label-in-name conformance is gated in phase-6 (`docs/accessibility.md`). Here we only prove
 * the journey reached the intended DOM state: control present, tooltip visible, tooltip text
 * matches the control's accessible name (precondition, not axe).
 */
const DOCUMENT_DETAIL_TOOLBAR_ADD_TO_COLLECTION = '[data-action-id="app.toolbar.addToCollection"]';

/**
 * NXENG-808 — keyboard focus on a header toolbar icon button before the journey scan.
 *
 * Focus visibility and 1.4.11 contrast verdicts belong to a11y-scout `focusChecks`
 * (`docs/accessibility.md`); this only proves the scan runs with Add to collection focused.
 */
async function enterDocumentDetailHeaderToolbarIconFocusState(page: Page): Promise<void> {
  const addToCollection = page.locator(DOCUMENT_DETAIL_TOOLBAR_ADD_TO_COLLECTION).first();
  await expect(
    addToCollection,
    'Add to collection must render on a non-trashed document detail header',
  ).toBeVisible();

  const back = page
    .locator('.detail-header > button.mat-mdc-icon-button, .detail-header > button.mat-icon-button')
    .first();
  await expect(back, 'detail header back button must be focusable').toBeVisible();
  await back.focus();

  const maxSteps = 120;
  for (let step = 0; step <= maxSteps; step++) {
    const onTarget = await page.evaluate((sel) => {
      const target = document.querySelector(sel);
      return target !== null && document.activeElement === target;
    }, DOCUMENT_DETAIL_TOOLBAR_ADD_TO_COLLECTION);
    if (onTarget) {
      return;
    }
    if (step === maxSteps) {
      throw new Error(`Tab did not reach Add to collection within ${maxSteps} steps`);
    }
    await page.keyboard.press('Tab');
  }
}

/**
 * NXSAT-535 — keyboard focus on the header **More actions** overflow trigger before a journey scan.
 *
 * Focus visibility and 1.4.11 contrast verdicts belong to a11y-scout `focusChecks`
 * (`docs/accessibility.md`); this only proves the scan runs with that control focused.
 */
async function enterDocumentDetailHeaderMoreActionsFocusState(page: Page): Promise<void> {
  const moreActions = page
    .locator('.detail-header .header-actions button.mat-mdc-icon-button')
    .filter({ has: page.locator('mat-icon[aria-hidden="true"]', { hasText: 'more_vert' }) })
    .first();
  await expect(
    moreActions,
    'More actions overflow trigger must render on a non-trashed document detail header',
  ).toBeVisible();

  const back = page
    .locator('.detail-header > button.mat-mdc-icon-button, .detail-header > button.mat-icon-button')
    .first();
  await expect(back, 'detail header back button must be focusable').toBeVisible();
  await back.focus();

  const maxSteps = 120;
  for (let step = 0; step <= maxSteps; step++) {
    const onTarget = await page.evaluate(() => {
      const buttons = document.querySelectorAll(
        '.detail-header .header-actions button.mat-mdc-icon-button',
      );
      for (const target of buttons) {
        const icon = target.querySelector('mat-icon[aria-hidden="true"]');
        if (icon?.textContent?.trim() !== 'more_vert') {
          continue;
        }
        return document.activeElement === target;
      }
      return false;
    });
    if (onTarget) {
      return;
    }
    if (step === maxSteps) {
      throw new Error(`Tab did not reach More actions within ${maxSteps} steps`);
    }
    await page.keyboard.press('Tab');
  }
}

async function enterDocumentDetailReplaceMainFileTooltipState(page: Page): Promise<void> {
  const replaceButtons = page
    .locator('lib-document-viewer .viewer-footer-actions button')
    .filter({ has: page.locator('mat-icon', { hasText: 'find_replace' }) });
  const replace = replaceButtons.first();
  await expect(
    replace,
    'replace main file must render on a writable File with a main blob',
  ).toBeVisible();
  const accessibleName = (await replace.getAttribute('aria-label')) ?? '';
  await replace.hover();
  await replace.focus();
  const tooltip = page.locator('.cdk-overlay-container').getByText(accessibleName, { exact: true });
  await expect(
    tooltip,
    'Replace main file tooltip must be visible and match the control accessible name',
  ).toBeVisible();
}

/**
 * Screen 4 — document detail, opened on a real document.
 */
journeyTest('document-detail', async ({ signedIn: page, a11y }) => {
  // Navigate first so `page.request` inherits the app origin and the dev-server proxy.
  await page.goto('/#/browse', { waitUntil: 'networkidle' });
  const { uid, title } = await firstFileWithMainBlob(page);

  await page.goto(`/#/doc/${uid}`, { waitUntil: 'networkidle' });

  await expect(
    page.locator('lib-document-detail'),
    'lib-document-detail must render',
  ).toBeVisible();
  await expect(
    page.locator('lib-document-detail'),
    `the detail view must show "${title}" — an error panel is visible too, and would scan clean`,
  ).toContainText(title);
  // Required: the drawer keeps the browse folder tree while a document is open, and this is
  // the screen whose findings were unstable because of it.
  await waitForScreenSettled(page, 'lib-document-detail', true);
  await expectSurfaceUsable(page, 'lib-document-detail', 'document detail');
  await enterDocumentDetailReplaceMainFileTooltipState(page);
  await enterDocumentDetailHeaderToolbarIconFocusState(page);

  await a11y.scanPage({ ...SCREEN_SCAN, extraWaitMs: 600 });
  await emitScreenReport(a11y, journeyReportName('document-detail'));
});

/**
 * Document detail — header **More actions** overflow trigger keyboard focus (NXSAT-535).
 *
 * Separate journey project so the a11y-scout accumulator stays one scan per worker/report
 * (`emitScreenReport` requires `pagesScanned.length === 1`). NXENG-808 keeps the Add to
 * collection pre-scan on `document-detail` above.
 */
journeyTest('document-detail-more-actions', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/browse', { waitUntil: 'networkidle' });
  const { uid, title } = await firstFileWithMainBlob(page);

  await page.goto(`/#/doc/${uid}`, { waitUntil: 'networkidle' });

  await expect(
    page.locator('lib-document-detail'),
    'lib-document-detail must render',
  ).toBeVisible();
  await expect(
    page.locator('lib-document-detail'),
    `the detail view must show "${title}" — an error panel is visible too, and would scan clean`,
  ).toContainText(title);
  await waitForScreenSettled(page, 'lib-document-detail', true);
  await expectSurfaceUsable(page, 'lib-document-detail', 'document detail');
  await enterDocumentDetailHeaderMoreActionsFocusState(page);

  await a11y.scanPage({ ...SCREEN_SCAN, extraWaitMs: 600 });
  await emitScreenReport(a11y, journeyReportName('document-detail-more-actions'));
});

// ─────────────────────────── core flows ───────────────────────────

/**
 * Screen 5 — search, with a query applied and results returned.
 *
 * ## Why the query is a quick filter and not typed text
 *
 * The obvious query — text in the drawer's Full Text box — cannot be scanned on a stock
 * server, and finding that out is the reason this comment exists. The page sends it as
 * `ecm_fulltext`, and Nuxeo answers **400 "Fulltext search disabled by configuration"** when
 * full-text search is not enabled, which is the default. The search page renders that failure
 * as an empty result list (it sets an `error` signal its template never shows), so a typed
 * query would have scanned an empty page under the label "search results". The drawer's
 * facet filters are no alternative on the same server: they are built from aggregations, and
 * `default_search` returns none.
 *
 * What does narrow the query everywhere is the URL: the "No Containers" quick filter and a
 * sort. It is a real query — on the instance this was written against it took 59 results to
 * 44 — and it is the state a shared or bookmarked search link opens in.
 */
journeyTest('search', async ({ signedIn: page, a11y }) => {
  // The drawer fires its own `default_search` for its counts, with the same quick filter and
  // the default sort. If it fails the drawer falls back to the page's narrowed counts rather
  // than showing an error, so both requests must succeed. `sortBy` then picks the page's: the
  // drawer's response is not the one the page renders.
  const responses = await captureEveryDataRequest(
    page,
    'search',
    (url) =>
      url.pathname.endsWith('/search/pp/default_search/execute') &&
      url.searchParams.get('quickFilters') === 'noFolder',
    () =>
      page.goto('/#/search?quickFilters=noFolder&sortBy=dc:title&sortOrder=asc', {
        waitUntil: 'networkidle',
      }),
    () => waitForScreenSettled(page, 'lib-search', false),
    2,
  );
  const first = requireEntry(
    entriesOf(pageResponse('search', responses, 'sortBy', 'dc:title')),
    'search: the "No Containers" query matched no document, so there are no results to scan',
  );

  await expect(
    page.locator('lib-search .list-row').filter({ hasText: first.title }).first(),
    `search must list "${first.title}", the first result its own request returned`,
  ).toBeVisible();
  await expectSurfaceUsable(page, 'lib-search', 'search');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('search'));
});

/** Screen 6 — documents, the asset search, as it opens with no filter applied. */
journeyTest('documents', async ({ signedIn: page, a11y }) => {
  // The drawer runs the same search with `pageSize: 200` for its facets and renders empty
  // facets if it fails, so both requests must succeed. `pageSize` then picks the page's: its
  // first entry need not be the drawer's. 40 is `AssetService.searchAssets`' default, which the
  // page does not override.
  const responses = await captureEveryDataRequest(
    page,
    'documents',
    (url) => url.pathname.endsWith('/search/pp/assets_search/execute'),
    () => page.goto('/#/documents', { waitUntil: 'networkidle' }),
    () => waitForScreenSettled(page, 'lib-asset-search-results', false),
    2,
  );
  const first = requireEntry(
    entriesOf(pageResponse('documents', responses, 'pageSize', '40')),
    'documents: the asset search returned nothing, so there is no result list to scan',
  );

  await expect(
    page.locator('lib-asset-search-results .list-row').filter({ hasText: first.title }).first(),
    `documents must list "${first.title}", the first result its own request returned`,
  ).toBeVisible();
  await expectSurfaceUsable(page, 'lib-asset-search-results', 'documents');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('documents'));
});

/**
 * Screen 7 — one collection, opened by uid, with members in it.
 *
 * `/#/collections` alone renders nothing — `collectionsRoutes` declares only `:uid` — which is
 * why `SURFACES` leaves it out and why phase-6's scan of it is a vacuous pass. A real uid is
 * the only way in. The collection is chosen by the same query the app's own collections panel
 * runs, and must have a member: an empty collection renders a one-line placeholder.
 *
 * Every page of that query is searched, not just the first. Looking at the 20 most recently
 * modified only meant a repository whose populated collections were older failed this screen
 * as "none has a member" while one existed. Flagged in review on PR #225. A failed members
 * request fails the screen with its status, rather than counting as an empty collection.
 *
 * `.collection-unavailable` is asserted absent here because it is not an error class — it is
 * the not-found/unavailable panel, rendered instead of the page rather than inside it.
 */
journeyTest('collection', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/dashboard', { waitUntil: 'networkidle' });
  const query =
    "SELECT * FROM Collection WHERE ecm:isTrashed = 0 AND ecm:currentLifeCycleState != 'deleted' " +
    'ORDER BY dc:modified DESC';
  let chosen: RepoEntry | undefined;
  let examined = 0;
  for (let pageIndex = 0; !chosen; pageIndex++) {
    const { entries, isNextPageAvailable } = await nxqlPage(
      page,
      query,
      20,
      pageIndex,
      'collection',
    );
    if (entries.length === 0 && isNextPageAvailable) {
      throw new Error(
        `collection: page ${pageIndex} of the collection query is empty but claims another ` +
          'follows, so paging it would never end',
      );
    }
    for (const candidate of entries) {
      examined++;
      const members = await page.request.get(
        '/nuxeo/api/v1/search/pp/default_content_collection/execute',
        { params: { queryParams: candidate.uid, pageSize: 1 } },
      );
      expect(
        members.ok(),
        `collection: the members of "${candidate.title}" could not be listed ` +
          `(${members.status()}), so whether it is empty is unknown`,
      ).toBeTruthy();
      if (entriesOf(await members.json()).length > 0) {
        chosen = candidate;
        break;
      }
    }
    if (!isNextPageAvailable) break;
  }
  const collection = requireEntry(
    chosen ? [chosen] : [],
    `collection: none of the ${examined} collection(s) in the repository has a ` +
      'member — add a document to one before running this screen',
  );

  const body = await captureDataRequest(
    page,
    'collection',
    (url) =>
      url.pathname.endsWith('/search/pp/default_content_collection/execute') &&
      url.searchParams.get('queryParams') === collection.uid,
    () => page.goto(`/#/collections/${collection.uid}`, { waitUntil: 'networkidle' }),
  );
  const member = requireEntry(
    entriesOf(body),
    `collection: "${collection.title}" had a member a moment ago and its page received none`,
  );

  const host = page.locator('lib-collection-detail');
  await expect(host.locator('.collection-unavailable')).toHaveCount(0);
  await expect(host, `the page must be "${collection.title}"`).toContainText(collection.title);
  await expect(
    host.locator('.member-row').filter({ hasText: member.title }).first(),
    `the collection must list its member "${member.title}"`,
  ).toBeVisible();
  await waitForScreenSettled(page, 'lib-collection-detail', false);
  await expectSurfaceUsable(page, 'lib-collection-detail', 'collection');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('collection'));
});

/**
 * Screen 8 — the favorites panel.
 *
 * The panel has no error state: a failed request renders the empty "no favorites" message. So
 * the members request is captured, and the precondition is checked first — when the user has
 * no Favorites collection the app makes no members request at all, and the capture would fail
 * as a timeout that says nothing useful.
 */
journeyTest('favorites', async ({ signedIn: page, a11y }) => {
  const { username } = requireNuxeoCredentials();
  await page.goto('/#/dashboard', { waitUntil: 'networkidle' });
  // The query FAVORITES_COLLECTION_QUERY in libs/shared/nuxeo-client/src/lib/queries/nxql-queries.ts
  // runs, with the username escaped as an NXQL literal, which the app's copy does not do.
  // `STARTSWITH` on `ecm:path` matches by path segment, so another user whose name begins
  // with this one's is not matched.
  const literal = username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const favoritesCollection = requireEntry(
    await nxqlEntries(
      page,
      "SELECT * FROM Document WHERE ecm:primaryType = 'Favorites' " +
        `AND ecm:path STARTSWITH '/default-domain/UserWorkspaces/${literal}'`,
      1,
      'favorites',
    ),
    'favorites: this user has never favorited a document, so the panel can only show its ' +
      'empty message — mark a document as a favorite before running this screen',
  );

  const body = await captureDataRequest(
    page,
    'favorites',
    (url) =>
      url.pathname.endsWith('/search/pp/default_content_collection/execute') &&
      url.searchParams.get('queryParams') === favoritesCollection.uid,
    () => page.goto('/#/favorites', { waitUntil: 'networkidle' }),
  );
  const first = requireEntry(
    entriesOf(body),
    'favorites: the Favorites collection is empty — mark a document as a favorite first',
  );

  await expect(
    page.locator(`${NAV_DRAWER} .favorite-card`).filter({ hasText: first.title }).first(),
    `the favorites panel must list "${first.title}"`,
  ).toBeVisible();
  await waitForScreenSettled(page, null, false);
  await expectDrawerPanelHealthy(page, 'favorites');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('favorites'));
});

/**
 * Screen 9 — the recently viewed panel.
 *
 * Named for views, but `RECENTLY_VIEWED_QUERY` lists documents the user created or last
 * modified; it reads no audit trail. The request is matched on that clause.
 */
journeyTest('recently-viewed', async ({ signedIn: page, a11y }) => {
  const body = await captureDataRequest(
    page,
    'recently viewed',
    (url) => isNxqlQuery(url, 'dc:lastContributor'),
    () => page.goto('/#/recently-viewed', { waitUntil: 'networkidle' }),
  );
  const first = requireEntry(
    entriesOf(body),
    'recently viewed: this user has created or edited no document, so the panel is empty',
  );

  await expect(
    page.locator(`${NAV_DRAWER} .rv-card`).filter({ hasText: first.title }).first(),
    `the recently viewed panel must list "${first.title}"`,
  ).toBeVisible();
  await waitForScreenSettled(page, null, false);
  await expectDrawerPanelHealthy(page, 'recently viewed');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('recently-viewed'));
});

/**
 * Screen 10 — personal space.
 *
 * `/#/personal-space` is a redirect: the page asks for the user's workspace and navigates to
 * `/#/browse<workspace path>`, so the screen a user lands on is browse, rooted in their own
 * workspace. The URL is asserted against the path the server returned, so a redirect to the
 * wrong folder — or none — cannot be scanned under this label.
 *
 * The drawer's personal space panel asks for the workspace too, with the identical request, so
 * every response to it must succeed and name the same path. The redirect ties that path to
 * the page: only the page's own answer navigates.
 */
journeyTest('personal-space', async ({ signedIn: page, a11y }) => {
  const responses = await captureEveryDataRequest(
    page,
    'personal space',
    (url, method) =>
      method === 'POST' && url.pathname.endsWith('/automation/User.GetUserWorkspace'),
    () => page.goto('/#/personal-space', { waitUntil: 'networkidle' }),
    () => page.waitForURL((url) => url.hash.startsWith('#/browse/'), { timeout: 15_000 }),
    2,
  );
  const paths = responses.map((r) => (r.body as { path?: unknown } | null)?.path);
  expect(
    new Set(paths).size,
    `personal space: the page and the drawer were given different workspaces (${paths.join(', ')})`,
  ).toBe(1);
  const workspacePath = paths[0];
  if (typeof workspacePath !== 'string' || workspacePath === '') {
    throw new Error('personal space: User.GetUserWorkspace returned no path to redirect to');
  }

  await page.waitForURL((url) => decodeURIComponent(url.hash) === `#/browse${workspacePath}`, {
    timeout: 15_000,
  });
  await expect(
    page.locator('lib-browse .browse-row').first(),
    `the workspace at ${workspacePath} must list something, or this scans an empty table`,
  ).toBeVisible();
  await waitForScreenSettled(page, 'lib-browse', true);
  await expectSurfaceUsable(page, 'lib-browse', 'personal space');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('personal-space'));
});

/**
 * Mirrors `CLIPBOARD_STORAGE_KEY` in `libs/shared/nuxeo-client/src/lib/utils/clipboard.utils.ts`.
 */
const CLIPBOARD_STORAGE_KEY = 'nuxeo_clipboard';

/**
 * Screen 11 — the clipboard panel.
 *
 * The clipboard lives in the browser, not on the server, so it is seeded rather than found:
 * one real document, written in the app's own storage shape. Nothing on the server changes,
 * and the browser context — and the seed with it — is discarded when the test ends.
 *
 * Written after the shell has loaded and before the deep link, which is a same-document
 * navigation: the panel re-reads storage when it opens, so no reload is needed, and an init
 * script would never run.
 */
journeyTest('clipboard', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/dashboard', { waitUntil: 'networkidle' });
  const doc = await firstOpenableDocument(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: CLIPBOARD_STORAGE_KEY,
    value: JSON.stringify([{ uid: doc.uid, title: doc.title, type: doc.type }]),
  });

  await page.goto('/#/clipboard', { waitUntil: 'networkidle' });

  await expect(
    page.locator(`${NAV_DRAWER} .clipboard-card`).filter({ hasText: doc.title }),
    `the clipboard panel must list exactly the seeded document "${doc.title}"`,
  ).toHaveCount(1);
  await waitForScreenSettled(page, null, false);
  await expectDrawerPanelHealthy(page, 'clipboard');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('clipboard'));
});

// ─────────────────────────── work screens ───────────────────────────

/**
 * What a screen showed when it was scanned, for screens where empty is a legitimate state.
 *
 * Only tasks and the expired queue use this. Both are commonly empty on a working server, and
 * creating data to fill them would mean starting workflows or rewriting `dc:expired` on shared
 * content from a test. So each scans what is actually there — but which state it scanned is
 * decided by the screen's own response, the matching element is required, and the state is
 * printed beside the report so an empty-state count is never read as the populated screen's.
 */
function describeState(count: number, noun: string): string {
  return count > 0
    ? `populated — ${count} ${noun}`
    : `EMPTY STATE scanned — the server returned no ${noun}, so the populated screen is unmeasured`;
}

/**
 * Screen 12 — tasks.
 *
 * With tasks, the page selects the first one and navigates to `/#/tasks/<id>`, so the screen
 * is the task form; without, it is a prompt to pick a task from the drawer. Both are required
 * explicitly rather than inferred. The task list itself is in the drawer, and the page's own
 * `listError` is never rendered, which is why the response decides.
 *
 * The page and the drawer make the identical request — `getUserTasks(user, 50)` — so no URL
 * tells the page's own apart. A failed page request with no tasks renders the same
 * `.empty-detail` a successful one does, so capturing only the first response could record a
 * successful empty-state scan while the page's request failed. Every response is captured
 * instead, both callers are required to have asked, all must succeed, and all must agree on
 * the count.
 */
journeyTest('tasks', async ({ signedIn: page, a11y }) => {
  const responses = await captureEveryDataRequest(
    page,
    'tasks',
    (url) => url.pathname.endsWith('/api/v1/task'),
    () => page.goto('/#/tasks', { waitUntil: 'networkidle' }),
    () => waitForScreenSettled(page, 'lib-tasks-page', false),
    2,
  );
  const counts = responses.map((r) => entriesOf(r.body).length);
  expect(
    new Set(counts).size,
    `tasks: the page and the drawer were given different task counts (${counts.join(', ')})`,
  ).toBe(1);
  const tasks = entriesOf(responses[0].body);

  if (tasks.length > 0) {
    const firstId = (tasks[0] as { id?: unknown }).id;
    if (typeof firstId !== 'string' || firstId === '') {
      throw new Error('tasks: the first task in the response has no id to open');
    }
    await expect(page, 'with tasks, the page opens the first one').toHaveURL(
      (url) => decodeURIComponent(url.hash) === `#/tasks/${firstId}`,
    );
    await expect(page.locator('lib-tasks-page .task-form-title')).toBeVisible();
    await expect(page.locator(`${NAV_DRAWER} button.task-item`).first()).toBeVisible();
  } else {
    await expect(page.locator('lib-tasks-page .empty-detail')).toBeVisible();
    await expect(
      page.locator(`${NAV_DRAWER} .tasks-panel-body .tree-empty`),
      'with no tasks, the drawer must show its empty inbox, not an error',
    ).toBeVisible();
  }
  await waitForScreenSettled(page, 'lib-tasks-page', false);
  await expectDrawerPanelHealthy(page, 'tasks');
  await expectSurfaceUsable(page, 'lib-tasks-page', 'tasks');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('tasks'), describeState(tasks.length, 'task(s)'));
});

/** Screen 13 — the expired queue panel: documents whose `dc:expired` date has passed. */
journeyTest('expired-queue', async ({ signedIn: page, a11y }) => {
  const body = await captureDataRequest(
    page,
    'expired queue',
    (url) => isNxqlQuery(url, 'dc:expired <'),
    () => page.goto('/#/expired-queue', { waitUntil: 'networkidle' }),
  );
  const expired = entriesOf(body);

  if (expired.length > 0) {
    const first = requireEntry(expired, 'expired queue: unreachable — the list is non-empty');
    await expect(
      page.locator(`${NAV_DRAWER} .expired-card`).filter({ hasText: first.title }).first(),
      `the expired queue must list "${first.title}"`,
    ).toBeVisible();
  } else {
    // The icon identifies the panel: every drawer panel's empty state is a `.tree-empty`.
    await expect(
      page.locator(`${NAV_DRAWER} .tree-empty .empty-icon`),
      'with nothing expired, the drawer must show the expired queue empty state',
    ).toHaveText('timer_off');
  }
  await waitForScreenSettled(page, null, false);
  await expectDrawerPanelHealthy(page, 'expired queue');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(
    a11y,
    journeyReportName('expired-queue'),
    describeState(expired.length, 'expired document(s)'),
  );
});

/** Screen 14 — trash, with something in it. */
journeyTest('trash', async ({ signedIn: page, a11y }) => {
  // The filters drawer runs the same query with `pageSize: 200` for its counts and shows zero
  // counts if it fails (`catchError` to an empty list), so both requests must succeed.
  // `pageSize` then picks the page's: its first entry need not be the drawer's.
  const responses = await captureEveryDataRequest(
    page,
    'trash',
    (url) => isNxqlQuery(url, 'ecm:isTrashed = 1'),
    () => page.goto('/#/trash', { waitUntil: 'networkidle' }),
    () => waitForScreenSettled(page, 'lib-trash', false),
    2,
  );
  const first = requireEntry(
    entriesOf(pageResponse('trash', responses, 'pageSize', '100')),
    'trash: nothing is in the trash, so the screen shows only "Trash is empty" — trash a ' +
      'document before running this screen',
  );

  await expect(
    page.locator('lib-trash .list-row').filter({ hasText: first.title }).first(),
    `trash must list "${first.title}", the first document its own request returned`,
  ).toBeVisible();
  await expectSurfaceUsable(page, 'lib-trash', 'trash');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('trash'));
});

/**
 * Screen 15 — administration, as an administrator lands on it.
 *
 * `/#/administration` redirects to `analytics`, whose first tab is Document Distribution. At
 * the domain root that tab deliberately shows a callout instead of counts — the query would
 * be too expensive — so the callout is the real landing state, not a failure.
 *
 * The evidence is weaker than on the other screens, and only the request carries it. The page
 * looks up the domain with `GET /path/default-domain` and fills the path field from the answer
 * — but the field starts at `/default-domain/`, which is also what a stock server returns, so on
 * such a server the field reads the same whether the lookup succeeded or failed, and the tab
 * beneath it shows a fixed callout either way. The lookup is captured and must succeed; that
 * is the proof the page reached the server. (`searchAuditLogs` can request the same URL through
 * its fallback, but this page never calls it.) The field is still checked, as
 * a consistency check that the page used what came back, not as evidence of the request.
 *
 * `run.mjs` gives the journey `needsAdmin`, so an identity `adminGuard` would turn away is
 * refused before any screen is scanned rather than measured as the dashboard.
 */
journeyTest('administration', async ({ signedIn: page, a11y }) => {
  const body = await captureDataRequest(
    page,
    'administration',
    (url) => url.pathname.endsWith('/api/v1/path/default-domain'),
    () => page.goto('/#/administration', { waitUntil: 'networkidle' }),
  );
  const domainPath = (body as { path?: unknown } | null)?.path;
  if (typeof domainPath !== 'string' || domainPath === '') {
    throw new Error('administration: the default domain request returned no path');
  }

  // A `powerusers` member is let in by `adminGuard` but redirected to users and groups by
  // `fullAdministratorGuard`, so this fails for one rather than scanning another page here.
  await expect(
    page,
    'an administrator lands on analytics — a powerusers member does not, and cannot run this screen',
  ).toHaveURL(/#\/administration\/analytics$/);
  await expect(
    page.locator('lib-admin-analytics-page input[name="distPath"]'),
    'the path field must hold the domain path the lookup returned',
  ).toHaveValue(domainPath.endsWith('/') ? domainPath : `${domainPath}/`);
  await waitForScreenSettled(page, 'lib-admin-analytics-page', false);
  await expectSurfaceUsable(page, 'lib-admin-analytics-page', 'administration');

  await a11y.scanPage(SCREEN_SCAN);
  await emitScreenReport(a11y, journeyReportName('administration'));
});

// Last, after every declaration. See the function's own note: a screen listed in
// journey.screens.ts with no test here would otherwise be scanned by nothing, silently.
assertEveryScreenDeclared();
