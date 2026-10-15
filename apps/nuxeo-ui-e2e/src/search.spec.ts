import { expect, expectSurfaceWithData, test } from './fixtures';
import { type Page, type Request } from '@playwright/test';

/**
 * Search — and the guard for the injection defect once found in the retired POC's search.
 *
 * `escapeNxqlLiteral` has unit specs for the escaping itself; what those cannot show is that a
 * real query reaches a real OpenSearch index and comes back. That is this file.
 */

/**
 * The drawer's full-text input: `nxs-search-filters`, rendered by `lib-search-filters-drawer` in the
 * app shell's navigation drawer, through an extension outlet — not inside `lib-search` — so a
 * locator scoped to `lib-search` finds nothing.
 */
function fullTextInput(page: Page) {
  return page.locator('lib-search-filters-drawer nxs-search-filters input[type="search"]').first();
}

const PAGE_PROVIDER = '/search/pp/default_search/execute';
const NXQL = '/search/lang/NXQL/execute';

/**
 * Long enough for a delayed duplicate to land inside it: the drawer once sent its own count search
 * 150 ms after the page's.
 */
const QUIET_MS = 1_000;

interface SentSearch {
  /** `page-provider`: Nuxeo binds the term into the query. `nxql`: the page wrote the query text. */
  readonly endpoint: 'page-provider' | 'nxql';
  readonly params: URLSearchParams;
  /** `null` when no response arrived at all — the request failed at the network level. */
  readonly status: number | null;
  readonly resultsCount: number | null;
  /** `search 2 of 3 (page-provider)`, for assertion messages. */
  readonly label: string;
}

/**
 * Type `term` into the drawer's full-text input, press Enter, and return **every** search request
 * that produced, once all of them have answered and nothing new has started for `QUIET_MS`.
 *
 * Every one, so a duplicate is counted rather than hidden. Enter used to send three identical
 * requests — `lib-search`'s results, the shell nav drawer's and the filters drawer's count search —
 * and judging only the first response to arrive let a test pass on a duplicate while the results
 * request failed. `SearchSession` now sends one, which `one Enter sends one search` asserts.
 *
 * Captured after the page has settled and before Enter, which is the only thing that makes the
 * drawer search. Matched on the endpoint rather than the term, so a term that was dropped, or moved
 * into hand-built NXQL, is judged by the assertions rather than waited for. A settled page cannot
 * be awaited with `waitForLoadState('networkidle')` here: the page reached that state on load, so
 * it resolves at once.
 */
async function searchesSentFor(page: Page, term: string): Promise<readonly SentSearch[]> {
  await page.goto('/#/search', { waitUntil: 'networkidle' });

  const input = fullTextInput(page);
  await expect(input, 'the search drawer has no full-text input').toBeVisible();
  await input.fill(term);

  const captured: Promise<Omit<SentSearch, 'label'>>[] = [];
  let answered = 0;
  let lastActivity = Date.now();
  const onRequest = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (!path.endsWith(PAGE_PROVIDER) && !path.endsWith(NXQL)) return;
    lastActivity = Date.now();
    captured.push(
      describeSearch(request).finally(() => {
        answered += 1;
        lastActivity = Date.now();
      }),
    );
  };

  page.on('request', onRequest);
  try {
    await input.press('Enter');
    await expect
      .poll(
        () =>
          captured.length > 0 &&
          answered === captured.length &&
          Date.now() - lastActivity >= QUIET_MS,
        { message: 'Enter sent no search to Nuxeo, or one never answered', timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    page.off('request', onRequest);
  }

  const searches = await Promise.all(captured);
  return searches.map((s, i) => ({
    ...s,
    label: `search ${i + 1} of ${searches.length} (${s.endpoint})`,
  }));
}

async function describeSearch(request: Request): Promise<Omit<SentSearch, 'label'>> {
  const url = new URL(request.url());
  const response = await request.response();
  // A body that is not JSON — a proxy error page — becomes `resultsCount: null` rather than a throw
  // here, so the spec fails at its own status and count assertions, which name what went wrong.
  const body: { resultsCount?: unknown } | null = response
    ? await response.json().catch(() => null)
    : null;
  return {
    endpoint: url.pathname.endsWith(NXQL) ? 'nxql' : 'page-provider',
    params: url.searchParams,
    status: response?.status() ?? null,
    resultsCount: typeof body?.resultsCount === 'number' ? body.resultsCount : null,
  };
}

test.describe('search', () => {
  test('one Enter sends one search', async ({ signedIn: page }) => {
    const sent = await searchesSentFor(page, 'contract');
    expect(
      sent.map((s) => s.label),
      'the page and the drawer share one request',
    ).toHaveLength(1);
    expect(sent[0].params.get('ecm_fulltext')).toBe('contract');
  });

  test('returns results from the index', async ({ signedIn: page }) => {
    await page.goto('/#/search', { waitUntil: 'networkidle' });

    await expectSurfaceWithData(page, 'lib-search', /\d+\s+results?\b/);
    // A result count of zero would satisfy the pattern above, so assert a non-zero one. This
    // is the difference between "the page rendered" and "search worked".
    await expect(page.locator('lib-search .results-count')).toHaveText(/^[1-9]\d*\s+results?$/);
  });

  test('pages past the first page, and the count is the server total', async ({
    signedIn: page,
  }) => {
    // The count is the answer the server gave, not the rows on screen: 40 rows a page, so the
    // seeded data must run past one page or both halves of this are vacuous.
    const [first] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(PAGE_PROVIDER) && r.status() === 200),
      page.goto('/#/search', { waitUntil: 'networkidle' }),
    ]);
    const total = (await first.json()).resultsCount as number;
    expect(total, 'the seeded data runs past one page').toBeGreaterThan(40);
    await expect(page.locator('lib-search .results-count')).toHaveText(
      new RegExp(`^${total}\\s+results$`),
    );

    const next = page.locator('lib-search nxs-pager .nxs-pager__next');
    await expect(next, 'the pager offers a next page').toBeEnabled();
    const [second] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(PAGE_PROVIDER) && r.status() === 200),
      next.click(),
    ]);
    expect(new URL(second.url()).searchParams.get('currentPageIndex')).toBe('1');
    await expect(page).toHaveURL(/[?&]page=2\b/);
  });

  test('a term that cannot match returns zero results rather than an error', async ({
    signedIn: page,
  }) => {
    // The negative half. A search surface that renders results for everything is not
    // searching, and this is the assertion that would catch a query being dropped or a
    // filter being ignored. The term goes through the drawer filter input — not `?q=` in
    // the URL, which `search.ts` deliberately does not read for the query text.
    //
    // Asserted on the wire, not on the page: `/search` sets an `error()` signal when a search
    // fails and never renders it, so a 400 shows the same empty state as a genuine zero.
    for (const sent of await searchesSentFor(page, 'zzz-no-such-document-zzz')) {
      expect(sent.status, `${sent.label}: Nuxeo did not accept the search`).toBe(200);
      expect(sent.resultsCount, `${sent.label}: a term that cannot match returned documents`).toBe(
        0,
      );
    }
    await expect(page.locator('lib-search .results-empty').first()).toBeVisible();
  });
});

/**
 * The regression guard for NXQL injection through the search term.
 *
 * ## Why `/#/search`
 *
 * These two cases used to drive `/#/search-adf-hx`, which interpolated the term into a
 * `sys_fulltext = '<term>*'` literal through `escapeHxqlLiteral` — the path the original
 * adversarial review found the injection in. That route is retired with the rest of adf-hx and
 * now only redirects here, so the coverage lives on the search page that stays.
 *
 * `/#/search` writes no query text at all. `SearchService.search` sends the drawer's term to the
 * `default_search` page provider as the `ecm_fulltext` named parameter, and Nuxeo binds it into
 * the predicate server-side. There is no client-side escape to assert, so these assert the
 * property any implementation has to keep — **the term reaches Nuxeo as data, never as query
 * structure** — on whichever endpoint carries it:
 *
 *   - page provider: the bound `ecm_fulltext` value is the term verbatim, and no other parameter
 *     carries it. A client that pre-escapes, strips or rewrites the term fails here;
 *   - NXQL: the term sits inside an escaped literal, and stripping every literal leaves none of
 *     it behind. This branch is for a rewrite of the search page that builds NXQL itself, which
 *     the `nxs-` rebuild of search results could; it does not run against today's page.
 *
 * ## What is load-bearing
 *
 * The wire, not the page: as above, `/search` never renders its error signal, so a DOM "no error"
 * check would be vacuous, and there is none. The status Nuxeo answered and the `resultsCount` it
 * returned are what can fail. Measured on the shared instance on 2026-10-08: the payload below as
 * the bound value returns 0 documents; the same payload concatenated into an NXQL literal returns
 * 1,940 — every document — and an unescaped apostrophe in NXQL answers HTTP 400.
 */

/** Everything in the request that is not data: the NXQL with every literal stripped, or every page-provider parameter but the bound term. */
function structureOf(sent: SentSearch): string {
  if (sent.endpoint === 'nxql') {
    return (sent.params.get('query') ?? '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  }
  return [...sent.params]
    .filter(([name]) => name !== 'ecm_fulltext')
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** On the page provider, the term must be the bound value exactly as typed. */
function expectBoundVerbatim(sent: SentSearch, term: string) {
  expect(
    sent.params.get('ecm_fulltext'),
    `${sent.label}: the term did not reach Nuxeo as the bound ecm_fulltext value, verbatim`,
  ).toBe(term);
}

/**
 * In hand-built NXQL, one literal must hold the whole term — decoded here rather than compared with
 * the production escaper's output, so a broken escaper cannot vouch for itself — optionally followed
 * by the `*` wildcard a builder appends. The structure checks alone pass a builder that truncates or
 * replaces the term, as long as what is left matches nothing.
 */
function expectWholeTermInALiteral(sent: SentSearch, term: string) {
  const literals = [...(sent.params.get('query') ?? '').matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1].replace(/\\(.)/g, '$1'),
  );
  expect(
    literals.some((literal) => literal === term || literal === `${term}*`),
    `${sent.label}: no literal in the query holds the whole term; literals were ${JSON.stringify(literals)}`,
  ).toBe(true);
}

test.describe('NXQL injection guard', () => {
  test('an apostrophe travels as data and Nuxeo accepts the query', async ({ signedIn: page }) => {
    for (const sent of await searchesSentFor(page, "O'Brien")) {
      if (sent.endpoint === 'page-provider') {
        expectBoundVerbatim(sent, "O'Brien");
      } else {
        // Unescaped this reads `'O'Brien*'`, which closes the literal after `O` and leaves `Brien`
        // as a bare token.
        expect(
          sent.params.get('query'),
          `${sent.label}: the apostrophe was not escaped on its way into the literal`,
        ).toContain("'O\\'Brien");
        expectWholeTermInALiteral(sent, "O'Brien");
      }
      expect(
        structureOf(sent),
        `${sent.label}: part of the term is outside its literal`,
      ).not.toContain('Brien');
      // And Nuxeo agrees it is well-formed. Unescaped in NXQL it answers 400.
      expect(
        sent.status,
        `${sent.label}: Nuxeo rejected the query, so the literal was not closed correctly`,
      ).toBe(200);
    }
  });

  test('a term shaped like a query cannot become query structure', async ({ signedIn: page }) => {
    // The payload from the original adversarial review, recorded in `hxql-literal.ts`: it
    // closed the literal and the enclosing parenthesis to reach a top-level `OR`, defeating
    // both hygiene filters the binding adds unconditionally and returning 155 documents where
    // the plain term returned 0.
    const payload = `zzznope') OR (ecm:uuid IS NOT NULL) OR (ecm:fulltext = 'q`;

    for (const sent of await searchesSentFor(page, payload)) {
      expect(sent.status, `${sent.label}: Nuxeo rejected the query`).toBe(200);

      if (sent.endpoint === 'page-provider') {
        expectBoundVerbatim(sent, payload);
      } else {
        expectWholeTermInALiteral(sent, payload);
        expect(
          structureOf(sent),
          `${sent.label}: the version and trash hygiene filters are no longer ANDed onto the query`,
        ).toContain('ecm:isVersion = 0 AND ecm:isTrashed = 0');
      }
      // None of the payload may appear in the query's own structure — the property, stated
      // without reference to how many rows came back.
      const structure = structureOf(sent);
      expect(structure, `${sent.label}: the term lifted a clause out of the literal`).not.toContain(
        'ecm:uuid',
      );
      expect(structure, `${sent.label}: the term introduced a top-level OR`).not.toMatch(/\bOR\b/);

      // And the outcome Nuxeo reports. As data the payload matches nothing; as structure it
      // matched every document on this instance.
      expect(
        sent.resultsCount,
        `${sent.label}: the payload matched documents, so it ran as a query`,
      ).toBe(0);
    }
    await expect(
      page.locator('lib-search .results-count'),
      'the page shows a result count for a term that matches nothing',
    ).toHaveCount(0);
  });
});
