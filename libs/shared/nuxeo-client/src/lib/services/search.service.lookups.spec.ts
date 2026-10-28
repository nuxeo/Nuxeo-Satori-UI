import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { SearchService, type GlobalSearchSuggestion } from './search.service';

const SUGGESTERS = '/nuxeo/api/v1/automation/Search.SuggestersLauncher';

/**
 * The lookups beside the search itself: collections, saved searches, the header's suggestions and
 * the note editor's picture picker. `search.service.spec.ts` covers the query and the saved-search
 * round trip; this file covers what the other callers read.
 */
describe('SearchService — lookups', () => {
  let service: SearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('getUserCollections', () => {
    it('asks User.GetCollections and maps each collection with its member count', async () => {
      const result = firstValueFrom(service.getUserCollections());
      const req = http.expectOne('/nuxeo/api/v1/automation/User.GetCollections');
      expect(req.request.body).toEqual({ params: { searchTerm: '' }, context: {} });
      expect(req.request.headers.get('properties')).toBe('dublincore,collection');
      req.flush({
        entries: [
          { uid: 'c1', title: 'Claims', properties: { 'collection:documentIds': ['a', 'b'] } },
          { uid: 'c2', properties: { 'dc:title': 'From dc:title' } },
          { uid: 'c3' },
        ],
      });
      expect(await result).toEqual([
        { id: 'c1', title: 'Claims', itemCount: 2 },
        { id: 'c2', title: 'From dc:title', itemCount: 0 },
        { id: 'c3', title: 'c3', itemCount: 0 },
      ]);
    });
  });

  describe('saved searches', () => {
    it('lists a page provider’s saved searches with their id, title and query', async () => {
      const result = firstValueFrom(service.getSavedSearches('assets_search'));
      const req = http.expectOne((r) => r.url === '/nuxeo/api/v1/search/saved');
      expect(req.request.params.get('pageProvider')).toBe('assets_search');
      req.flush({
        entries: [
          { id: 'ss-1', title: 'Mine', properties: { 'savedsearch:query': 'SELECT 1' } },
          { uid: 'ss-2', properties: { 'contentview:query': '  ' } },
          { title: 'no id' },
          { id: 'ss-3', title: 'Plain', query: 'SELECT 3' },
        ],
      });
      expect(await result).toEqual([
        { id: 'ss-1', title: 'Mine', query: 'SELECT 1' },
        { id: 'ss-2', title: 'ss-2', query: undefined },
        { id: 'ss-3', title: 'Plain', query: 'SELECT 3' },
      ]);
    });

    it('lists default_search by default, and nothing when the list fails', async () => {
      const result = firstValueFrom(service.getSavedSearches());
      const req = http.expectOne((r) => r.url === '/nuxeo/api/v1/search/saved');
      expect(req.request.params.get('pageProvider')).toBe('default_search');
      req.flush('no', { status: 500, statusText: 'Server Error' });
      expect(await result).toEqual([]);
    });

    it('reads named params when a saved search carries no params object', async () => {
      const result = firstValueFrom(service.getSavedSearchById('ss'));
      http.expectOne('/nuxeo/api/v1/search/saved/ss').flush({
        properties: {
          'savedsearch:namedParams': [
            { key: 'ecm_fulltext', value: 'x' },
            { key: 'highlight', value: 'dropped' },
            { key: 'empty', value: null },
            { value: 'no key' },
          ],
        },
      });
      expect(await result).toEqual({ ecm_fulltext: 'x' });
    });

    it('answers no params for a saved search with none, or one that cannot be read', async () => {
      const none = firstValueFrom(service.getSavedSearchById('ss'));
      http.expectOne('/nuxeo/api/v1/search/saved/ss').flush({ id: 'ss' });
      expect(await none).toEqual({});

      const failed = firstValueFrom(service.getSavedSearchById('gone'));
      http
        .expectOne('/nuxeo/api/v1/search/saved/gone')
        .flush('no', { status: 404, statusText: 'Not Found' });
      expect(await failed).toEqual({});
    });

    it('saves into an existing search with a PUT carrying the params and highlight', async () => {
      const result = firstValueFrom(
        service.updateSavedSearch('a b', { title: 'T', params: { ecm_fulltext: 'x' } }),
      );
      const req = http.expectOne('/nuxeo/api/v1/search/saved/a%20b');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toMatchObject({
        'entity-type': 'savedSearch',
        pageProviderName: 'default_search',
        title: 'T',
        params: { ecm_fulltext: 'x' },
      });
      expect(req.request.body.params.highlight).toContain('dc:title.fulltext');
      req.flush({});
      await result;
    });

    it('deletes by id, encoded', async () => {
      const result = firstValueFrom(service.deleteSavedSearch('a/b'));
      const req = http.expectOne('/nuxeo/api/v1/search/saved/a%2Fb');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await result;
    });
  });

  describe('suggest — the header search', () => {
    async function suggest(payload: unknown, term = 'con', pageSize?: number) {
      const result = firstValueFrom(service.suggest(term, pageSize));
      const req = http.expectOne(SUGGESTERS);
      expect(req.request.body).toEqual({ params: { searchTerm: term.trim() }, context: {} });
      req.flush(payload as object);
      return result;
    }

    it('sends nothing for a blank term', async () => {
      expect(await firstValueFrom(service.suggest('   '))).toEqual([]);
      expect(await firstValueFrom(service.suggestFromSuggestersLauncher(''))).toEqual([]);
      http.expectNone(SUGGESTERS);
    });

    it('maps documents, users and groups from a flat list, with highlights', async () => {
      const suggestions = await suggest([
        {
          'entity-type': 'document',
          id: 'doc-1',
          uid: 'doc-1',
          type: 'File',
          title: 'Contract',
          path: '/ws/Contract',
          highlights: [
            { field: 'dc:title', segments: ['<em>Con</em>tract'] },
            { field: 'ecm:path', segments: ['/ws/<em>Con</em>tract'] },
            { field: 'empty', segments: [] },
            null,
          ],
        },
        { username: 'jdoe', type: 'USER_TYPE', displayLabel: 'John Doe' },
        { groupname: 'legal', prefixed_id: 'group:legal' },
        { id: 'other-thing' },
      ]);
      expect(suggestions).toEqual<GlobalSearchSuggestion[]>([
        {
          id: 'doc-1',
          displayLabel: 'Contract',
          displayLabelHighlights: [
            { text: 'Con', matched: true },
            { text: 'tract', matched: false },
          ],
          kind: 'document',
          documentUid: 'doc-1',
          path: '/ws/Contract',
          pathHighlights: [
            { text: '/ws/', matched: false },
            { text: 'Con', matched: true },
            { text: 'tract', matched: false },
          ],
          prefixedId: undefined,
        },
        expect.objectContaining({ id: 'jdoe', displayLabel: 'John Doe', kind: 'user' }),
        expect.objectContaining({ id: 'legal', kind: 'group', prefixedId: 'group:legal' }),
        expect.objectContaining({ id: 'other-thing', kind: 'other' }),
      ]);
    });

    it('reads highlights given as an object, and a label from dc:title', async () => {
      const [suggestion] = await suggest({
        entries: [
          {
            uid: 'doc-2',
            properties: { 'dc:title': 'Board minutes', 'ecm:path': '/ws/Board' },
            highlights: { 'dc:title': ['<em>Board</em> minutes'], 'file:content.name': 'x' },
          },
        ],
      });
      expect(suggestion).toMatchObject({
        id: 'doc-2',
        displayLabel: 'Board minutes',
        path: '/ws/Board',
      });
      const [hit, rest] = suggestion.displayLabelHighlights ?? [];
      expect(hit).toEqual({ text: 'Board', matched: true });
      expect(rest).toEqual({ text: ' minutes', matched: false });
    });

    it('keeps the space between a match and the text that follows it', async () => {
      const [suggestion] = await suggest([
        {
          uid: 'd',
          title: 'D',
          highlights: [{ field: 'dc:title', segments: ['<em>Board</em> and <em>minutes</em>'] }],
        },
      ]);
      expect(suggestion.displayLabelHighlights?.map((part) => part.text).join('')).toBe(
        'Board and minutes',
      );
    });

    it('finds suggestions nested in containers, and caps them at the page size', async () => {
      const suggestions = await suggest(
        [{ documents: [{ uid: 'a' }, { uid: 'b' }] }, { users: [{ username: 'u' }] }],
        'x',
        2,
      );
      expect(suggestions.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('reads any array in an object answer, and ignores entries it cannot name', async () => {
      const suggestions = await suggest({ whatever: [{ uid: 'z' }, 'text', { nothing: 1 }] });
      expect(suggestions.map((s) => s.id)).toEqual(['z']);
      expect(await suggest('not a list')).toEqual([]);
    });

    it('keeps a highlight with no <em> as plain text', async () => {
      const [suggestion] = await suggest([
        { uid: 'd', title: 'D', highlights: [{ field: 'dc:title', segments: ['<b>plain</b>'] }] },
      ]);
      expect(suggestion.displayLabelHighlights).toEqual([{ text: 'plain', matched: false }]);
    });

    it('answers an empty list when the suggesters fail', async () => {
      const result = firstValueFrom(service.suggest('con'));
      http.expectOne(SUGGESTERS).flush('no', { status: 500, statusText: 'Server Error' });
      expect(await result).toEqual([]);
    });
  });

  describe('suggestFallback', () => {
    // Not wired to the header today; kept as the page-provider plus user/group fallback.
    const fallback = (term: string, size: number) =>
      (
        service as unknown as {
          suggestFallback(t: string, s: number): ReturnType<SearchService['suggest']>;
        }
      ).suggestFallback(term, size);

    it('merges default_search documents with users and groups, capped at the page size', async () => {
      const result = firstValueFrom(fallback('jo', 2));
      const docs = http.expectOne(
        (r) => r.url === '/nuxeo/api/v1/search/pp/default_search/execute',
      );
      expect(docs.request.params.get('query')).toBe('jo');
      docs.flush({
        entries: [
          { uid: 'd1', title: 'Doc', path: '/p' },
          { uid: 'd2', title: '' },
        ],
      });
      http
        .expectOne('/nuxeo/api/v1/automation/UserGroup.Suggestion')
        .flush([{ username: 'jo', type: 'USER_TYPE' }]);
      expect((await result).map((s) => [s.id, s.kind, s.displayLabel])).toEqual([
        ['d1', 'document', 'Doc'],
        ['d2', 'document', 'd2'],
      ]);
    });

    it('still answers when either half fails', async () => {
      const result = firstValueFrom(fallback('jo', 5));
      http
        .expectOne((r) => r.url === '/nuxeo/api/v1/search/pp/default_search/execute')
        .flush('no', { status: 500, statusText: 'Server Error' });
      http.expectOne('/nuxeo/api/v1/automation/UserGroup.Suggestion').flush({ not: 'a list' });
      expect(await result).toEqual([]);
    });
  });

  describe('searchDocumentPicker — the note editor’s picture picker', () => {
    const picture = (uid: string) => ({
      uid,
      type: 'Picture',
      title: uid,
      properties: { 'file:content': { data: `/blob/${uid}`, 'mime-type': 'image/png' } },
    });

    it('asks document_picker and keeps only pictures with a blob', async () => {
      const result = firstValueFrom(
        service.searchDocumentPicker({ fulltext: ' cat ', pageSize: 10, pageIndex: 1 }),
      );
      const req = http.expectOne(
        (r) => r.url === '/nuxeo/api/v1/search/pp/document_picker/execute',
      );
      expect(req.request.params.get('fulltext_all')).toBe('cat');
      expect(req.request.params.get('currentPageIndex')).toBe('1');
      req.flush({
        entries: [picture('p1'), { uid: 'f1', type: 'File', properties: {} }],
        resultsCount: 2,
      });
      const list = await result;
      expect(list.entries.map((d) => d.uid)).toEqual(['p1']);
      expect(list.currentPageIndex).toBe(1);
    });

    it('falls back to NXQL when the page provider fails', async () => {
      const result = firstValueFrom(service.searchDocumentPicker());
      http
        .expectOne((r) => r.url === '/nuxeo/api/v1/search/pp/document_picker/execute')
        .flush('no', { status: 500, statusText: 'Server Error' });
      const nxql = http.expectOne((r) => r.url === '/nuxeo/api/v1/search/lang/NXQL/execute');
      expect(nxql.request.params.get('query')).toContain("ecm:primaryType = 'Picture'");
      nxql.flush({ entries: [picture('p2')] });
      expect((await result).entries.map((d) => d.uid)).toEqual(['p2']);
    });
  });
});
