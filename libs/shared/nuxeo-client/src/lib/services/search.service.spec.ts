import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { SearchService, type SearchQueryParams } from './search.service';

const EXECUTE = '/nuxeo/api/v1/search/pp/default_search/execute';

/** A `default_search` answer with one document and the aggregates the server returns. */
const executeResponse = {
  'entity-type': 'documents',
  resultsCount: 1772,
  entries: [
    {
      'entity-type': 'document',
      uid: 'doc-1',
      title: 'Contract',
      type: 'File',
      path: '/default-domain/workspaces/ws/Contract',
      lastModified: '2026-10-12T08:00:00.000Z',
      properties: {
        'dc:creator': 'Administrator',
        'dc:lastContributor': { 'entity-type': 'user', id: 'jdoe', properties: {} },
        'dc:created': '2026-10-01T08:00:00.000Z',
        'dc:subjects': ['art', 'art/cinema'],
        'dc:nature': 'contract',
        'file:content': { length: '2048' },
      },
      contextParameters: { favorites: { isFavorite: true } },
    },
  ],
  aggregations: {
    dc_modified_agg: { buckets: [{ key: 'priorToLastYear', docCount: 3 }] },
    dc_creator_agg: { buckets: [{ key: 'Administrator', doc_count: 1750 }, { docCount: 2 }] },
    dc_nature_agg: { buckets: [] },
  },
};

describe('SearchService', () => {
  let service: SearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Runs one search and returns the request it sent, answered with `executeResponse`. */
  async function send(params: SearchQueryParams): Promise<TestRequest> {
    const result = firstValueFrom(service.search(params));
    const req = http.expectOne((r) => r.url === EXECUTE);
    req.flush(executeResponse);
    await result;
    return req;
  }

  describe('search — the query it sends', () => {
    it('sends paging, the default sort and an empty quick-filter list for an empty query', async () => {
      const { request } = await send({});
      expect(request.method).toBe('GET');
      expect(request.params.keys().sort()).toEqual(
        ['currentPageIndex', 'offset', 'pageSize', 'quickFilters', 'sortBy', 'sortOrder'].sort(),
      );
      expect(request.params.get('sortBy')).toBe('dc:created');
      expect(request.params.get('sortOrder')).toBe('desc');
      expect(request.params.get('pageSize')).toBe('40');
      expect(request.params.get('quickFilters')).toBe('');
      expect(request.headers.get('enrichers.document')).toBe('favorites');
    });

    it('filters collection membership on ecm_collections, the parameter default_search reads', async () => {
      const { request } = await send({ collection: ' col-1 ' });
      expect(request.params.get('ecm_collections')).toBe('["col-1"]');
      // The old mapping also wrote the collection id into the coverage aggregate, which the server
      // applied as a coverage filter and answered with no results.
      expect(request.params.has('dc_coverage_agg')).toBe(false);
      expect(request.params.has('collection_agg')).toBe(false);
    });

    it('keeps a coverage selection on dc_coverage_agg alongside a collection', async () => {
      const { request } = await send({ collection: 'col-1', coverage: 'europe/France' });
      expect(request.params.get('ecm_collections')).toBe('["col-1"]');
      expect(request.params.get('dc_coverage_agg')).toBe('["europe/France"]');
    });

    it('maps the legacy "more than a year ago" range to the bucket the server defines', async () => {
      const { request } = await send({ modifiedDate: 'moreThan1YearAgo,lastWeek' });
      expect(JSON.parse(request.params.get('dc_modified_agg') ?? '[]')).toEqual([
        'priorToLastYear',
        'lastWeek',
      ]);
    });

    it('sends a range once when its old and new names are both selected', async () => {
      const { request } = await send({ modifiedDate: 'moreThan1YearAgo, priorToLastYear' });
      expect(request.params.get('dc_modified_agg')).toBe('["priorToLastYear"]');
    });

    it('sends every multi-value facet as a JSON array, trimmed and without blanks', async () => {
      const { request } = await send({
        nature: 'article, report,',
        subjects: 'art,art,sciences',
        coverage: ' africa/Burkina_Faso ',
        size: 'tiny,huge',
      });
      expect(request.params.get('dc_nature_agg')).toBe('["article","report"]');
      expect(request.params.get('dc_subjects_agg')).toBe('["art","sciences"]');
      expect(request.params.get('dc_coverage_agg')).toBe('["africa/Burkina_Faso"]');
      expect(request.params.get('common_size_agg')).toBe('["tiny","huge"]');
    });

    it('takes a list as a JSON array, so a value containing a comma stays one value', async () => {
      const { request } = await send({
        coverage: '["Paris, France","europe/Spain"," "]',
        modifiedDate: '["moreThan1YearAgo"]',
        nature: '[not json',
      });
      expect(JSON.parse(request.params.get('dc_coverage_agg') ?? '[]')).toEqual([
        'Paris, France',
        'europe/Spain',
      ]);
      expect(request.params.get('dc_modified_agg')).toBe('["priorToLastYear"]');
      // Not a JSON array, so read as comma-separated, as before.
      expect(request.params.get('dc_nature_agg')).toBe('["[not json"]');
    });

    it('sends the author and tag as one-value arrays, JSON-encoded so quotes survive', async () => {
      const { request } = await send({ author: 'o"brien', tag: 'q1 "draft"' });
      expect(JSON.parse(request.params.get('dc_creator_agg') ?? '[]')).toEqual(['o"brien']);
      expect(JSON.parse(request.params.get('ecm_tags') ?? '[]')).toEqual(['q1 "draft"']);
    });

    it('turns dashes in the full-text term into spaces, as Web UI does', async () => {
      const { request } = await send({ ecmFulltext: ' nxsat-308 -draft ' });
      expect(request.params.get('ecm_fulltext')).toBe('nxsat 308  draft');
    });

    it('passes quotes, wildcards and other characters in the full-text term through unchanged', async () => {
      const { request } = await send({ ecmFulltext: `"exact phrase" o'brien te*t a&b` });
      expect(request.params.get('ecm_fulltext')).toBe(`"exact phrase" o'brien te*t a&b`);
    });

    it('sends no full-text term when it is only dashes and spaces', async () => {
      const { request } = await send({ ecmFulltext: ' - -- ' });
      expect(request.params.has('ecm_fulltext')).toBe(false);
    });

    it('sends the sort, quick filters and page asked for', async () => {
      const { request } = await send({
        sortBy: 'dc:title',
        sortOrder: 'asc',
        quickFilters: ' noFolder,mostRecent ',
        pageIndex: 2,
        pageSize: 10,
      });
      expect(request.params.get('sortBy')).toBe('dc:title');
      expect(request.params.get('sortOrder')).toBe('asc');
      expect(request.params.get('quickFilters')).toBe('noFolder,mostRecent');
      expect(request.params.get('currentPageIndex')).toBe('2');
      expect(request.params.get('offset')).toBe('20');
    });
  });

  describe('search — the answer it returns', () => {
    it('maps each document to a result row', async () => {
      const result = firstValueFrom(service.search({}));
      http.expectOne((r) => r.url === EXECUTE).flush(executeResponse);
      const { items } = await result;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'doc-1',
        title: 'Contract',
        author: 'Administrator',
        lastContributor: 'jdoe',
        modifiedDate: '2026-10-12',
        createdDate: '2026-10-01',
        sizeInBytes: 2048,
        nature: 'contract',
        subjects: 'art, art/cinema',
        isFavorite: true,
      });
    });

    it('keeps every row the server returns for a date range, rather than filtering the page again', async () => {
      const result = firstValueFrom(service.search({ modifiedDate: 'last24h' }));
      // Modified well over a day ago: the server is the one that decides the range.
      http.expectOne((r) => r.url === EXECUTE).flush(executeResponse);
      const { items } = await result;
      expect(items.map((item) => item.id)).toEqual(['doc-1']);
    });

    it('normalises the server aggregates, dropping buckets without a key', async () => {
      const result = firstValueFrom(service.search({}));
      http.expectOne((r) => r.url === EXECUTE).flush(executeResponse);
      const { aggregations } = await result;
      expect(aggregations.dc_modified_agg?.buckets).toEqual([
        { key: 'priorToLastYear', docCount: 3 },
      ]);
      expect(aggregations.dc_creator_agg?.buckets).toEqual([
        { key: 'Administrator', docCount: 1750 },
      ]);
      expect(aggregations.dc_nature_agg).toBeUndefined();
    });

    it('reports a server error to the caller', async () => {
      const result = firstValueFrom(service.search({})).catch((err: { status: number }) => err);
      http
        .expectOne((r) => r.url === EXECUTE)
        .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
      expect(((await result) as { status: number }).status).toBe(500);
    });
  });

  describe('saved searches', () => {
    it('reads a list parameter back as JSON, so a value containing a comma stays one value', async () => {
      const result = firstValueFrom(service.getSavedSearchById('ss/1'));
      const req = http.expectOne('/nuxeo/api/v1/search/saved/ss%2F1');
      req.flush({
        'entity-type': 'savedSearch',
        id: 'ss/1',
        params: {
          ecm_fulltext: 'contract',
          dc_coverage_agg: ['Paris, France', 'europe/Spain'],
          dc_nature_agg: [],
          dc_modified_max: null,
          highlight: 'dc:title.fulltext',
        },
      });
      expect(await result).toEqual({
        ecm_fulltext: 'contract',
        dc_coverage_agg: '["Paris, France","europe/Spain"]',
        dc_nature_agg: '',
      });
    });

    it('renames with the title and page provider only, so the stored filters are kept', async () => {
      const result = firstValueFrom(service.renameSavedSearch('ss 1', 'Q3 contracts'));
      const req = http.expectOne('/nuxeo/api/v1/search/saved/ss%201');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({
        'entity-type': 'savedSearch',
        pageProviderName: 'default_search',
        title: 'Q3 contracts',
      });
      req.flush({ id: 'ss 1', title: 'Q3 contracts' });
      await result;
    });

    it('saves the params given, with the highlight fields Web UI asks for', async () => {
      const result = firstValueFrom(
        service.saveSavedSearch({ title: 'Mine', params: { dc_subjects_agg: '["art"]' } }),
      );
      const req = http.expectOne('/nuxeo/api/v1/search/saved');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.params).toEqual({
        dc_subjects_agg: '["art"]',
        highlight:
          'dc:title.fulltext,ecm:binarytext,dc:description.fulltext,ecm:tag,note:note.fulltext,file:content.name',
      });
      expect(req.request.body.pageProviderName).toBe('default_search');
      req.flush({ id: 'ss-2', title: 'Mine' });
      await result;
    });
  });

  describe('getTagSuggestions', () => {
    const SUGGESTION = '/nuxeo/api/v1/automation/Tag.Suggestion';

    it('asks Tag.Suggestion for the trimmed term and returns the labels', async () => {
      const result = firstValueFrom(service.getTagSuggestions(' an '));
      const req = http.expectOne(SUGGESTION);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ params: { searchTerm: 'an' }, context: {} });
      req.flush([
        { id: 'angular', displayLabel: 'angular' },
        { id: 'annual-report' },
        { other: true },
        null,
      ]);
      expect(await result).toEqual(['angular', 'annual-report']);
    });

    it('sends nothing for a blank term', async () => {
      expect(await firstValueFrom(service.getTagSuggestions('   '))).toEqual([]);
      http.expectNone(SUGGESTION);
    });

    it('answers an empty list when the operation fails', async () => {
      const result = firstValueFrom(service.getTagSuggestions('a'));
      http.expectOne(SUGGESTION).flush('no', { status: 500, statusText: 'Server Error' });
      expect(await result).toEqual([]);
    });

    it('answers an empty list for a response that is not a list', async () => {
      const result = firstValueFrom(service.getTagSuggestions('a'));
      http.expectOne(SUGGESTION).flush({ entries: [] });
      expect(await result).toEqual([]);
    });
  });
});
