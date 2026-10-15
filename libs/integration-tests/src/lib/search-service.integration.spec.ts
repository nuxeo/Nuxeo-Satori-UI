// @vitest-environment jsdom
/**
 * SearchService integration tests.
 *
 * Stage 5 of the integration-test plan: SearchService (839 lines) against live Nuxeo and
 * OpenSearch. The highest-risk gap per audit §6.1, §7.2.
 *
 * Tests:
 * - Fulltext search, quick filters, drawer filters
 * - Sorting, pagination
 * - Autocomplete suggestions
 * - Saved search CRUD
 * - Error handling
 *
 * ## Every assertion here is scoped to this run's own documents, deliberately
 *
 * Two measured properties of the deployment make an unscoped assertion worthless, and both
 * were what let ten of these tests pass while proving nothing:
 *
 * 1. **The search index on a shared instance is stale.** An unscoped `default_search` query
 *    reports `resultsCount` in the thousands and returns 0–7 resolvable rows, because the
 *    index still holds documents other worktrees have deleted. So `expect(items).toBeDefined()`
 *    and `expect(items.length).toBeGreaterThan(0)` are not the same assertion, and the first
 *    is satisfied by every broken query there is. Measured 2026-09-23: `sortBy=dc:created`
 *    `sortOrder=desc` → `resultsCount` 1026, `entries` 0.
 * 2. **`SearchQueryParams.q` does not filter.** It is sent as the `query` HTTP parameter, and
 *    `default_search` has no such predicate, so Nuxeo ignores it: `query=Searchable` and no
 *    query at all both answer `resultsCount` 1026 on the same repository. The page provider's
 *    fulltext parameter is `ecm_fulltext`, which `SearchQueryParams.ecmFulltext` sets. The
 *    tests below therefore scope with `ecmFulltext`. **`q` has no integration coverage here
 *    because there is no server behaviour to cover** — see the pull request; whether `q`
 *    should map to `ecm_fulltext` is a product decision, not a test fix.
 *
 * So `beforeAll` seeds five documents carrying a token unique to this run, waits for each to
 * be indexed, and every test asserts on *those* documents by UID. A test that can name the
 * rows it expects is a test that can fail.
 *
 * Acceptance criteria (from audit §11 Stage 5), and where each stands:
 * - Every public method exercised against the server — NOT met. `search`, `suggest`,
 *   `getUserCollections` and the four saved-search methods are; the rest of the service is not,
 *   and `q` cannot be (above).
 * - At least one 4xx and one 5xx tested — NOT met. See the note in `Error Handling` below.
 * - Reverting hxql-literal fix turns suite red — met, but **not here**. The guard lives in
 *   `apps/nuxeo-ui-e2e/src/search.spec.ts`, which drives the one page that composes HXQL.
 *   The block that used to stand in for it in this file could not fail; see below.
 */

import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  SearchService,
  type GlobalSearchSuggestion,
  type SearchCollectionOption,
  type SavedSearchOption,
  type SearchQueryParams,
  type SearchResponse,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  setupIntegrationHarness,
  createTestDocument,
  waitForIndexed,
  waitForNxqlMatch,
  tagDocument,
} from './integration-harness';

describe('SearchService Integration Tests', () => {
  const harness = setupIntegrationHarness();
  let searchService: SearchService;

  /**
   * A single fulltext token that matches this run's fixtures and nothing else.
   *
   * The dashes come out of the run ID so it stays one analyser token, and the `sfx` prefix
   * keeps it from colliding with the data-root workspace's own title (`Integration Test
   * <runId>`), which would otherwise turn up in every fixture query as a sixth row.
   */
  const token = `sfx${harness.runId.replace(/[^a-z0-9]/gi, '')}`;
  const tagLabel = `tag-${token}`;

  /** Created in this order, so `dc:created`/`dc:modified` ordering is known, not assumed. */
  const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta'] as const;
  const fileUids: Record<(typeof titles)[number], string> = {
    Alpha: '',
    Bravo: '',
    Charlie: '',
    Delta: '',
  };
  let folderUid = '';

  const fileTitles = titles.map((name) => `${name} ${token}`);

  beforeAll(async () => {
    for (const name of titles) {
      const doc = await createTestDocument(harness, {
        type: 'File',
        name: `search-fixture-${name.toLowerCase()}`,
        title: `${name} ${token}`,
        properties: { 'dc:description': `search fixture ${token}` },
      });
      fileUids[name] = doc.uid;
    }

    // Folderish, so `quickFilters: 'noFolder'` has something to exclude. Without it that
    // test would compare a set against itself.
    const folder = await createTestDocument(harness, {
      type: 'Folder',
      name: 'search-fixture-folder',
      title: `Folder ${token}`,
      properties: { 'dc:description': `search fixture ${token}` },
    });
    folderUid = folder.uid;

    for (const uid of [...Object.values(fileUids), folderUid]) {
      await waitForIndexed(harness, uid);
    }

    // The tag relation is indexed separately from the document, so `waitForIndexed` returning
    // is not evidence `ecm_tags` can find it. Established through `ecm:tag` in NXQL — a
    // different surface from the page provider the test then drives.
    await tagDocument(harness, fileUids.Delta, tagLabel);
    await waitForNxqlMatch(
      harness,
      `SELECT * FROM Document WHERE ecm:tag = '${tagLabel}'`,
      fileUids.Delta,
      `tag '${tagLabel}' searchable`,
    );

    console.log(
      `[search-integration] Fixture ready: 4 File(s) + 1 Folder under ${harness.dataRoot}, ` +
        `token '${token}', tag '${tagLabel}' on ${fileUids.Delta}`,
    );
  }, 90000);

  // `beforeEach`, not `beforeAll`. The setup file resets the TestBed between tests, so a
  // service injected once was reached through a destroyed injector from the second test
  // onward — `NG0205: Injector has already been destroyed`, which is what surfaced as soon
  // as the DOM problem above it was fixed.
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // The app authenticates through an interceptor, and there is none in a bare
        // TestBed. Without this every request here runs as Anonymous — and this Nuxeo
        // answers an unauthenticated query with HTTP 200 and no rows rather than a 401,
        // so the suite would look like it was working while testing a different principal.
        provideHttpClient(
          withInterceptors([
            (req, next) => next(req.clone({ setHeaders: { Authorization: harness.auth } })),
          ]),
        ),
        SearchService,
      ],
    });

    searchService = TestBed.inject(SearchService);
  });

  const search = (params: SearchQueryParams): Promise<SearchResponse> =>
    new Promise<SearchResponse>((resolve, reject) => {
      searchService.search(params).subscribe({ next: resolve, error: reject });
    });

  const idsOf = (result: SearchResponse): string[] => result.items.map((item) => item.id);

  describe('Basic Search', () => {
    it('returns the seeded documents for a fulltext term that matches them', async () => {
      const result = await search({ ecmFulltext: token, pageSize: 20 });

      // The exact set, not "at least one". An extra row means the token is not unique to this
      // run and every other test in the file is measuring the wrong documents.
      expect(new Set(idsOf(result))).toEqual(new Set([...Object.values(fileUids), folderUid]));
      console.log(`[search-integration] Fulltext '${token}' found ${result.items.length} row(s)`);
    });

    it('returns empty results for a term that cannot match', async () => {
      const result = await search({ ecmFulltext: `${token}-no-such-document`, pageSize: 10 });

      expect(result.items).toHaveLength(0);
      console.log('[search-integration] Zero results handled correctly');
    });
  });

  // The `HXQL Injection Guard` block that stood here is deleted rather than repaired.
  //
  // It tested the wrong service. `escapeHxqlLiteral` had exactly one production call site, the
  // retired POC search page, which interpolated a term into
  // `SELECT * FROM SysContent WHERE sys_fulltext = '<term>*'`; both have since been removed. The
  // platform `SearchService` injected here composes no query string at all; it builds
  // `HttpParams`. Reverting `escapeHxqlLiteral` to the identity function could not turn these
  // two tests red, and their only assertions were `toBeDefined()` on the response.
  //
  // So the block could not meet the acceptance criterion in this file's header, and left
  // looking like coverage it made the criterion appear met. The guard moved to
  // `apps/nuxeo-ui-e2e/src/search.spec.ts`, which asserts *on the wire* that the term reaches
  // Nuxeo as data from `/#/search`.

  describe('Filters', () => {
    it('excludes folderish documents when the noFolder quick filter is applied', async () => {
      // `quickFilters: 'File'` is what this test used to send. `default_search` advertises
      // exactly three quick filters — `noFolder`, `mostRecent`, `onlyValidated` — so `'File'`
      // named nothing and was discarded by the server: measured, `'File'`, `'Picture'` and no
      // quick filter at all returned byte-identical result sets including a Workspace.
      const unfiltered = await search({ ecmFulltext: token, pageSize: 20 });
      expect(idsOf(unfiltered)).toContain(folderUid);

      const filtered = await search({ ecmFulltext: token, quickFilters: 'noFolder', pageSize: 20 });

      expect(idsOf(filtered)).not.toContain(folderUid);
      expect(new Set(idsOf(filtered))).toEqual(new Set(Object.values(fileUids)));
      console.log(
        `[search-integration] noFolder: ${unfiltered.items.length} row(s) -> ${filtered.items.length}`,
      );
    });

    it('can filter by author', async () => {
      const mine = await search({ ecmFulltext: token, author: harness.user, pageSize: 20 });

      expect(new Set(idsOf(mine))).toEqual(new Set([...Object.values(fileUids), folderUid]));
      expect(mine.items.map((item) => item.author)).toEqual(
        mine.items.map(() => harness.user), // every row, not `some`
      );

      // The negative half is what makes the parameter load-bearing: without it, dropping
      // `author` entirely leaves the positive half passing, because everything this run
      // created was created by the same principal.
      const someoneElse = await search({
        ecmFulltext: token,
        author: `no-such-user-${token}`,
        pageSize: 20,
      });

      expect(someoneElse.items).toHaveLength(0);
      console.log(
        `[search-integration] Author '${harness.user}' -> ${mine.items.length} row(s); ` +
          `unknown author -> ${someoneElse.items.length}`,
      );
    });

    it('can filter by tag', async () => {
      // This test used to set `dc:subjects` and then filter by `tag`. Those are different
      // fields: `tag` sets the `ecm_tags` page-provider parameter, which filters on the tag
      // *relation*, so the filter was applied to something the fixture never set and the
      // empty result was indistinguishable from a broken filter. The fixture now applies a
      // real tag with `Services.TagDocument` — see `tagDocument`.
      const tagged = await search({ ecmFulltext: token, tag: tagLabel, pageSize: 20 });

      expect(idsOf(tagged)).toEqual([fileUids.Delta]);

      const otherTag = await search({
        ecmFulltext: token,
        tag: `no-such-${tagLabel}`,
        pageSize: 20,
      });

      expect(otherTag.items).toHaveLength(0);
      console.log(
        `[search-integration] Tag '${tagLabel}' -> ${tagged.items.length} row(s); ` +
          `unknown tag -> ${otherTag.items.length}`,
      );
    });
  });

  describe('Sorting and Pagination', () => {
    it('can sort results by title ascending', async () => {
      const result = await search({
        ecmFulltext: token,
        quickFilters: 'noFolder',
        sortBy: 'dc:title',
        sortOrder: 'asc',
        pageSize: 20,
      });

      // Titles, in full, in order. The fixture is created Alpha→Delta, so the default sort
      // (`dc:created` desc, applied whenever `sortBy` is absent) is the exact reverse of this
      // — which is what makes dropping the two parameters fail rather than pass.
      expect(result.items.map((item) => item.title)).toEqual(fileTitles);
      console.log(`[search-integration] Title asc: ${result.items.map((i) => i.title).join(', ')}`);
    });

    it('can sort results by modified date descending', async () => {
      const descending = await search({
        ecmFulltext: token,
        quickFilters: 'noFolder',
        sortBy: 'dc:modified',
        sortOrder: 'desc',
        pageSize: 20,
      });
      const ascending = await search({
        ecmFulltext: token,
        quickFilters: 'noFolder',
        sortBy: 'dc:modified',
        sortOrder: 'asc',
        pageSize: 20,
      });

      // `SearchResultItem.modifiedDate` is `lastModified.slice(0, 10)` — a date, not a
      // timestamp — so four documents created in one run all carry the same value and
      // "adjacent timestamps are non-increasing" is satisfied by any order at all. The
      // orderable fact is identity: nothing touches these documents after creation, so
      // `dc:modified` descending is creation order reversed.
      expect(idsOf(descending)).toEqual([
        fileUids.Delta,
        fileUids.Charlie,
        fileUids.Bravo,
        fileUids.Alpha,
      ]);
      expect(idsOf(ascending)).toEqual([...idsOf(descending)].reverse());
      console.log(
        `[search-integration] Modified desc: ${descending.items.map((i) => i.title).join(', ')}`,
      );
    });

    it('can paginate results', async () => {
      const common = {
        ecmFulltext: token,
        quickFilters: 'noFolder',
        sortBy: 'dc:title',
        sortOrder: 'asc' as const,
        pageSize: 2,
      };

      const page0 = await search({ ...common, pageIndex: 0 });
      const page1 = await search({ ...common, pageIndex: 1 });

      // Unconditional. The previous version wrapped its only assertion in
      // `if (page0.items.length > 0 && page1.items.length > 0)`, and both pages were empty on
      // every run — so the test passed without ever comparing anything. Four fixture files at
      // `pageSize: 2` guarantee two full pages.
      expect(idsOf(page0)).toEqual([fileUids.Alpha, fileUids.Bravo]);
      expect(idsOf(page1)).toEqual([fileUids.Charlie, fileUids.Delta]);
      console.log(
        `[search-integration] Page 0: ${page0.items.length}, Page 1: ${page1.items.length}, no overlap`,
      );
    });
  });

  describe('Autocomplete Suggestions', () => {
    it('can get autocomplete suggestions', async () => {
      const suggestions = await new Promise<GlobalSearchSuggestion[]>((resolve, reject) => {
        searchService.suggest(token, 10).subscribe({ next: resolve, error: reject });
      });

      // `Search.SuggestersLauncher` answers with `label`, which `mapSuggestion` does not read,
      // so `displayLabel` falls through to the UID. `documentUid` is the field that carries
      // the identity, and it is the one worth asserting: a suggester that returned users, or
      // the wrong documents, or nothing, all fail here.
      const suggestedUids = suggestions.map((s) => s.documentUid);
      for (const name of titles) {
        expect(suggestedUids).toContain(fileUids[name]);
      }
      expect(suggestions.every((s) => s.kind === 'document')).toBe(true);
      console.log(`[search-integration] Got ${suggestions.length} suggestion(s) for '${token}'`);
    });

    it('returns empty suggestions for empty query', async () => {
      const suggestions = await new Promise<GlobalSearchSuggestion[]>((resolve, reject) => {
        searchService.suggest('', 5).subscribe({ next: resolve, error: reject });
      });

      expect(suggestions).toHaveLength(0);
      console.log('[search-integration] Empty query returns no suggestions');
    });
  });

  describe('Collections', () => {
    /**
     * A collection this run owns, so the assertion below can name the row it expects.
     *
     * It used to assert `Array.isArray(collections)` and nothing else, which an
     * implementation permanently returning `[]` satisfies without contacting Nuxeo at all —
     * the vacuous shape this branch exists to remove. Reported on the pull request.
     *
     * Collections do not live under `harness.dataRoot`. `Collection.Create` puts them in the
     * calling user's personal workspace, `/default-domain/UserWorkspaces/<user>/Collections`,
     * so the harness's teardown cannot reach this one and `afterAll` below must — the same
     * situation as the saved search above, and handled the same way.
     */
    const collectionName = `collection-${token}`;
    let collectionUid = '';

    /** A `${harness.nuxeoUrl}` automation call with this run's credentials. */
    const automation = (operation: string, body: Record<string, unknown>): Promise<Response> =>
      fetch(`${harness.nuxeoUrl}/nuxeo/api/v1/automation/${operation}`, {
        method: 'POST',
        headers: { Authorization: harness.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: {}, ...body }),
      });

    beforeAll(async () => {
      const created = await automation('Collection.Create', {
        params: { name: collectionName, description: `search fixture ${token}` },
      });
      expect(created.status, 'Collection.Create must succeed or the test below is vacuous').toBe(
        200,
      );
      collectionUid = ((await created.json()) as { uid: string }).uid;
      expect(collectionUid).toBeTruthy();

      // A member, so `itemCount` is derived from something rather than being zero for a
      // collection and zero for a mapping that never reads `collection:documentIds`.
      const added = await automation('Document.AddToCollection', {
        input: fileUids.Alpha,
        params: { collection: collectionUid },
      });
      expect(added.status, 'Document.AddToCollection must succeed').toBe(200);

      console.log(
        `[search-integration] Seeded collection ${collectionUid} (${collectionName}) ` +
          `holding ${fileUids.Alpha}`,
      );
    }, 30000);

    /**
     * Remove the collection, and **throw** if it is still there.
     *
     * Same reasoning as the saved-search teardown above, and the same evidence for it: this
     * user's collection list is shared state that a later run reads, and a leak reported as a
     * log line is a leak that stays. The `Collections` folder that `Collection.Create` makes
     * on first use is left alone — it is the user's workspace, not this run's fixture.
     */
    afterAll(async () => {
      if (!collectionUid) return;

      const url = `${harness.nuxeoUrl}/nuxeo/api/v1/id/${collectionUid}`;
      const headers = { Authorization: harness.auth };
      const leaked = (detail: string) =>
        new Error(
          `[search-integration] collection ${collectionUid} (${collectionName}) was not ` +
            `removed: ${detail}\n` +
            `  It lives in the user's personal workspace, outside the data root, so the\n` +
            `  harness cannot reclaim it and a later run's collection list will hold it.\n` +
            `  Delete it by hand before the next run.`,
        );

      let after: number;
      try {
        await fetch(url, { method: 'DELETE', headers });
        // A DELETE answering 2xx is Nuxeo accepting the call, not evidence it is gone.
        after = (await fetch(url, { headers })).status;
      } catch (error) {
        throw leaked(
          `the cleanup request itself failed (${error instanceof Error ? error.message : String(error)})`,
        );
      }

      if (after !== 404) {
        throw leaked(`it is still readable after the DELETE (HTTP ${after})`);
      }
      console.log(`[search-integration] teardown removed collection ${collectionUid}`);
    }, 30000);

    it('returns this run\'s collection, with the member count read off "collection:documentIds"', async () => {
      const collections = await new Promise<SearchCollectionOption[]>((resolve, reject) => {
        searchService.getUserCollections().subscribe({ next: resolve, error: reject });
      });

      // By id, not by count: this Nuxeo is shared, so the total is other runs' business.
      // What this run can assert is that the collection it seeded came back, which no
      // implementation returning a constant empty list can satisfy.
      const seeded = collections.find((collection) => collection.id === collectionUid);
      expect(
        seeded,
        `getUserCollections() did not return ${collectionUid}; got ${collections
          .map((collection) => collection.id)
          .join(', ')}`,
      ).toBeDefined();
      expect(seeded?.title).toBe(collectionName);
      // The one document added in `beforeAll`. `itemCount` is `collection:documentIds.length`,
      // so this is the only assertion here that reaches the mapping rather than the entity.
      expect(seeded?.itemCount).toBe(1);
      console.log(
        `[search-integration] Found ${collections.length} collection(s), including ` +
          `${collectionUid} with ${seeded?.itemCount} member(s)`,
      );
    });
  });

  describe('Saved Searches', () => {
    let savedSearchId: string;

    const listSavedSearches = (): Promise<SavedSearchOption[]> =>
      new Promise((resolve, reject) => {
        searchService.getSavedSearches().subscribe({ next: resolve, error: reject });
      });

    const readSavedSearch = (id: string): Promise<Record<string, string>> =>
      new Promise((resolve, reject) => {
        searchService.getSavedSearchById(id).subscribe({ next: resolve, error: reject });
      });

    /**
     * Best-effort removal of the saved search, whatever happened to the tests.
     *
     * A saved search is per-USER state and lives outside `harness.dataRoot`, so the harness's
     * own teardown cannot reach it. Until now the only thing that removed it was the
     * `can delete a saved search` test at the end of this block — so any earlier failure, or a
     * failure of that assertion itself, left it on a shared instance for good, where the
     * `can list saved searches` test of a later run reads the same user's list.
     *
     * The delete test stays exactly as it was: it is a behaviour check, and this is
     * housekeeping. By the time this runs on a fully passing suite the search is already gone,
     * which is why an absent one is a normal outcome here and not an error.
     */
    afterAll(async () => {
      if (!savedSearchId) return;

      // Raw `fetch` and a direct `/id/:uid` read, NOT `searchService`.
      //
      // The first version of this teardown went through `getSavedSearches()` to decide whether
      // the search was still there, and it silently did nothing. Two reasons compound: the
      // TestBed that provided the service is torn down by the time `afterAll` runs, and
      // `getSavedSearches` swallows a failure into an EMPTY LIST — so the presence check read
      // "already gone" and returned quietly. Measured, by making the delete test target the
      // wrong id: the run failed as intended and left `Updated Test Search …` on the server,
      // with this teardown printing nothing at all. A cleanup that cannot tell "absent" from
      // "could not look" is the same defect as the guards this branch exists to remove.
      const url = `${harness.nuxeoUrl}/nuxeo/api/v1/id/${savedSearchId}`;
      const headers = { Authorization: harness.auth };

      /**
       * A leak THROWS from here, rather than being reported and left green.
       *
       * The first version of this logged the failure and returned, reasoning that an exception
       * in teardown would replace the real failure with a secondary one. Review pointed out
       * that it converts a detected cleanup failure into a green run, and it is right — and it
       * is also inconsistent with `deleteDataRoot` in the harness, which throws for this exact
       * situation and whose docblock says why: "A cleanup failure is therefore the loudest thing
       * in the file, not the quietest." The masking worry does not survive contact with Vitest
       * either; a failing `afterAll` is reported as a suite error *beside* the failing test, not
       * instead of it.
       */
      const leaked = (detail: string) =>
        new Error(
          `[search-integration] saved search ${savedSearchId} was not removed: ${detail}\n` +
            `  It is per-user state outside the data root, so the harness cannot reclaim it and\n` +
            `  a later run's "can list saved searches" reads the same user's list. Delete it by\n` +
            `  hand before the next run.`,
        );

      let after: number;
      try {
        // 404 here is the normal outcome on a fully passing suite: the delete test removed it.
        if ((await fetch(url, { headers })).status === 404) return;
        await fetch(url, { method: 'DELETE', headers });
        // A DELETE answering 2xx is Nuxeo accepting the call, not evidence it is gone.
        after = (await fetch(url, { headers })).status;
      } catch (error) {
        throw leaked(
          `the cleanup request itself failed (${error instanceof Error ? error.message : String(error)})`,
        );
      }

      if (after !== 404) {
        throw leaked(`it is still readable after the DELETE (HTTP ${after})`);
      }
      console.log(`[search-integration] teardown removed saved search ${savedSearchId}`);
    });

    it('can create a saved search', async () => {
      // `saveSavedSearch` is typed `Observable<unknown>`, so the identity of the created
      // document is narrowed here rather than asserted by the type system.
      const created = (await new Promise<unknown>((resolve, reject) => {
        searchService
          .saveSavedSearch({
            title: `Integration Test Search ${harness.runId}`,
            params: {
              // `ecm_fulltext`, not `query`. `saveSavedSearch` always sends
              // `pageProviderName: 'default_search'`, and Nuxeo rejects a `query` parameter
              // beside it: HTTP 400 "query and page provider parameters are mutually
              // exclusive (query, queryLanguage, pageProviderName)". The free-text parameter
              // of the `default_search` page provider is `ecm_fulltext`.
              ecm_fulltext: 'test',
              pageSize: '10',
            },
          })
          .subscribe({ next: resolve, error: reject });
      })) as { uid?: string; id?: string };

      savedSearchId = created.uid ?? created.id ?? '';
      expect(savedSearchId).toBeTruthy();
      console.log(`[search-integration] Created saved search: ${savedSearchId}`);
    });

    it('can list saved searches', async () => {
      const searches = await listSavedSearches();

      const ourSearch = searches.find((s) => s.title?.includes(harness.runId));
      expect(ourSearch?.id).toBe(savedSearchId);
      console.log(`[search-integration] Found ${searches.length} saved search(es)`);
    });

    // The three tests below opened with `if (!savedSearchId) { log; return }`. That guard
    // is why the review counted them among six tests that "passed" without issuing any
    // HTTP: creation was failing, so `savedSearchId` was never set and each of them
    // returned before doing anything. A test that silently returns is a test that cannot
    // report. `expect` instead, so a broken creation fails them rather than skipping them.

    it('can get a saved search by ID', async () => {
      expect(savedSearchId, 'the creating test must have run and succeeded').toBeTruthy();

      const params = await readSavedSearch(savedSearchId);

      expect(params['ecm_fulltext']).toBe('test');
      console.log(`[search-integration] Retrieved saved search params: ${JSON.stringify(params)}`);
    });

    it('can update a saved search', async () => {
      expect(savedSearchId, 'the creating test must have run and succeeded').toBeTruthy();

      const updatedTitle = `Updated Test Search ${harness.runId}`;

      await new Promise((resolve, reject) => {
        searchService
          .updateSavedSearch(savedSearchId, {
            title: updatedTitle,
            params: {
              // `ecm_fulltext`, for the same reason as the creating test above: a `query`
              // parameter beside `pageProviderName` is a 400.
              ecm_fulltext: 'updated-test',
              pageSize: '20',
            },
          })
          .subscribe({ next: resolve, error: reject });
      });

      // Read back, rather than `expect(updated).toBeDefined()` on whatever the PUT echoed.
      // The service can return an object while persisting nothing, and it did: replacing the
      // `updateSavedSearch` call with a plain read left the old assertion green.
      const params = await readSavedSearch(savedSearchId);
      expect(params['ecm_fulltext']).toBe('updated-test');

      const searches = await listSavedSearches();
      expect(searches.find((s) => s.id === savedSearchId)?.title).toBe(updatedTitle);

      // `pageSize` is deliberately not asserted: Nuxeo does not return it among a saved
      // search's params (measured — the read-back carries the aggregate and fulltext
      // predicates only), so an assertion on it would be testing this client's own request.
      console.log(`[search-integration] Updated saved search to '${updatedTitle}'`);
    });

    it('can delete a saved search', async () => {
      expect(savedSearchId, 'the creating test must have run and succeeded').toBeTruthy();

      // Present before. This is what stops the "absent after" assertion from passing on an
      // error: `getSavedSearches` swallows failures into an empty list, so absence alone
      // cannot tell a deletion from a broken request.
      expect((await listSavedSearches()).map((s) => s.id)).toContain(savedSearchId);

      await new Promise((resolve, reject) => {
        searchService.deleteSavedSearch(savedSearchId).subscribe({ next: resolve, error: reject });
      });

      expect((await listSavedSearches()).map((s) => s.id)).not.toContain(savedSearchId);
      console.log(`[search-integration] Deleted saved search ${savedSearchId} (confirmed absent)`);
    });
  });

  describe('Error Handling', () => {
    // This test used to `try`/`catch` around the call and assert `toBeDefined()` in both
    // arms — success and failure were equally acceptable, so it could not distinguish
    // correct 4xx handling from an arbitrary exception from the field being ignored
    // outright. It asserted that something happened.
    //
    // The behaviour is determinate, so it is asserted. Measured against this Nuxeo:
    //
    //   GET /nuxeo/api/v1/search/pp/default_search/execute
    //       ?sortBy=invalid_field_that_does_not_exist&sortOrder=desc&pageSize=10
    //   -> HTTP 200, "hasError": false, results still returned
    //
    // The page provider tolerates an unknown sort field rather than rejecting it, so the
    // contract is "results still arrive", and reverting that would turn this red.
    it('ignores an unknown sort field and still returns results', async () => {
      const result = await search({
        ecmFulltext: token,
        sortBy: 'invalid_field_that_does_not_exist',
        pageSize: 20,
      });

      // Scoped to this run's fixtures, so "results still arrive" is checked against rows that
      // are known to exist. The previous version asserted `length > 0` against the whole
      // repository, where a stale index answers with resolvable rows or none depending on
      // which sort window it lands in — green or red for reasons unrelated to the sort field.
      expect(new Set(idsOf(result))).toEqual(new Set([...Object.values(fileUids), folderUid]));
      console.log(
        `[search-integration] Unknown sort field ignored; ${result.items.length} fixture row(s)`,
      );
    });

    // NOT COVERED, and named rather than implied: the stage's acceptance criterion asks for
    // "at least one 4xx and one 5xx tested". `SearchService.search` reaches Nuxeo only
    // through page-provider parameters, and none of them makes it answer 4xx — an unknown
    // sort field is ignored, as above. Meeting that criterion needs a method that can be
    // driven to an error status, not a wider `catch` around this one.
  });
});
