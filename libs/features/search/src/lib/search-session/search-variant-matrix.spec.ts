import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  nxsSearchFiltersFromParams,
  nxsSearchFiltersToQuery,
  nxsSearchFiltersToRecord,
  nxsSearchFiltersToSavedParams,
  type NxsSearchFilters,
} from '@nuxeo/satori-platform/components';
import { NUXEO_API_ORIGIN, SearchService } from '@nuxeo/satori-platform/nuxeo-client';

const EXECUTE = '/nuxeo/api/v1/search/pp/default_search/execute';
const PAGING = ['currentPageIndex', 'offset', 'pageSize', 'quickFilters', 'sortBy', 'sortOrder'];

interface Variant {
  readonly name: string;
  readonly filters: Partial<NxsSearchFilters>;
  /** Every filter parameter on the wire, beyond paging and sort. */
  readonly wire: Readonly<Record<string, string>>;
  /** What the filters read back as after a saved-search round trip, when not the same. */
  readonly roundTrip?: Partial<NxsSearchFilters>;
}

/**
 * The variant matrix for query building and filter serialisation: each row is one set of filters,
 * taken through the whole client path — the drawer's record, the request `SearchService` sends,
 * and a saved search written, stored as the server stores it (lists as arrays) and read back.
 */
const VARIANTS: readonly Variant[] = [
  { name: 'empty', filters: {}, wire: {} },
  {
    name: 'whitespace only',
    filters: { fulltext: '   ', authors: [' '], nature: [' '] },
    wire: {},
    roundTrip: { fulltext: '', authors: [], nature: [] },
  },
  { name: 'plain term', filters: { fulltext: 'contract' }, wire: { ecm_fulltext: 'contract' } },
  {
    name: 'double quotes (phrase)',
    filters: { fulltext: '"exact phrase"' },
    wire: { ecm_fulltext: '"exact phrase"' },
  },
  { name: 'apostrophe', filters: { fulltext: "O'Brien" }, wire: { ecm_fulltext: "O'Brien" } },
  { name: 'trailing wildcard', filters: { fulltext: 'contr*' }, wire: { ecm_fulltext: 'contr*' } },
  { name: 'inner wildcard', filters: { fulltext: 'te?t' }, wire: { ecm_fulltext: 'te?t' } },
  {
    name: 'dashes (Web UI formatFulltext)',
    filters: { fulltext: 'nxsat-308 -draft' },
    wire: { ecm_fulltext: 'nxsat 308  draft' },
    // Stored as typed: the dash rule applies to the request, as in Web UI.
    roundTrip: { fulltext: 'nxsat-308 -draft' },
  },
  {
    name: 'query-shaped term',
    filters: { fulltext: "zzz') OR (ecm:uuid IS NOT NULL" },
    wire: { ecm_fulltext: "zzz') OR (ecm:uuid IS NOT NULL" },
  },
  { name: 'ampersand and hash', filters: { fulltext: 'a&b #1' }, wire: { ecm_fulltext: 'a&b #1' } },
  {
    name: 'non-Latin',
    filters: { fulltext: '契約 Vertrag' },
    wire: { ecm_fulltext: '契約 Vertrag' },
  },
  { name: 'brackets', filters: { fulltext: '[draft]' }, wire: { ecm_fulltext: '[draft]' } },
  {
    name: 'every date range, in order',
    filters: { modified: ['last24h', 'lastWeek', 'lastMonth', 'lastYear', 'priorToLastYear'] },
    wire: { dc_modified_agg: '["last24h","lastWeek","lastMonth","lastYear","priorToLastYear"]' },
  },
  {
    name: 'legacy "more than a year" range',
    filters: { modified: ['moreThan1YearAgo'] },
    wire: { dc_modified_agg: '["priorToLastYear"]' },
    roundTrip: { modified: ['priorToLastYear'] },
  },
  {
    name: 'multi-value facets, duplicates dropped',
    filters: { nature: ['article', 'report', 'article'], subjects: ['art', 'art/cinema'] },
    wire: { dc_nature_agg: '["article","report"]', dc_subjects_agg: '["art","art/cinema"]' },
    roundTrip: { nature: ['article', 'report'], subjects: ['art', 'art/cinema'] },
  },
  {
    name: 'a facet value with a comma',
    filters: { coverage: ['Paris, France', 'europe/Spain'] },
    wire: { dc_coverage_agg: '["Paris, France","europe/Spain"]' },
  },
  {
    name: 'a facet value with quotes',
    filters: { nature: ['the "best" one'] },
    wire: { dc_nature_agg: '["the \\"best\\" one"]' },
  },
  {
    name: 'every size',
    filters: { size: ['tiny', 'small', 'medium', 'big', 'huge'] },
    wire: { common_size_agg: '["tiny","small","medium","big","huge"]' },
  },
  {
    name: 'author with a quote',
    filters: { authors: ['o"neil'] },
    wire: { dc_creator_agg: '["o\\"neil"]' },
  },
  {
    name: 'collection',
    filters: { collections: ['col-1'] },
    wire: { ecm_collections: '["col-1"]' },
  },
  { name: 'tag with spaces', filters: { tags: ['q1 draft'] }, wire: { ecm_tags: '["q1 draft"]' } },
  {
    name: 'everything at once',
    filters: {
      fulltext: 'invoice*',
      modified: ['lastMonth'],
      authors: ['jdoe', 'asmith'],
      collections: ['col-2', 'col-3'],
      tags: ['finance', 'q1'],
      nature: ['invoice'],
      subjects: ['economy'],
      coverage: ['europe/France'],
      size: ['small'],
    },
    wire: {
      ecm_fulltext: 'invoice*',
      dc_modified_agg: '["lastMonth"]',
      dc_creator_agg: '["jdoe","asmith"]',
      ecm_collections: '["col-2","col-3"]',
      ecm_tags: '["finance","q1"]',
      dc_nature_agg: '["invoice"]',
      dc_subjects_agg: '["economy"]',
      dc_coverage_agg: '["europe/France"]',
      common_size_agg: '["small"]',
    },
  },
];

describe('search variant matrix — filters in, request and saved search out', () => {
  let service: SearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(SearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  for (const variant of VARIANTS) {
    describe(variant.name, () => {
      const filters: NxsSearchFilters = { ...NXS_EMPTY_SEARCH_FILTERS, ...variant.filters };

      it('sends exactly these filter parameters, by way of the record the drawer keeps', async () => {
        // The path the app takes: the drawer writes the record, the session reads it back.
        const kept = nxsSearchFiltersFromParams(nxsSearchFiltersToRecord(filters));
        const result = firstValueFrom(service.search(nxsSearchFiltersToQuery(kept)));
        const req = http.expectOne((r) => r.url === EXECUTE);
        req.flush({ entries: [] });
        await result;

        const sent: Record<string, string> = {};
        for (const key of req.request.params.keys()) {
          if (!PAGING.includes(key)) sent[key] = req.request.params.get(key) ?? '';
        }
        expect(sent).toEqual(variant.wire);
      });

      it('reads back the same filters from a saved search, stored as the server stores it', async () => {
        // The server stores a JSON-array string as a list and drops an empty full text.
        const stored: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(nxsSearchFiltersToSavedParams(filters))) {
          if (key !== 'ecm_fulltext' && key !== 'q') stored[key] = JSON.parse(value);
          else if (value) stored[key] = value;
        }
        const read = firstValueFrom(service.getSavedSearchById('ss'));
        http.expectOne('/nuxeo/api/v1/search/saved/ss').flush({ id: 'ss', params: stored });

        expect(nxsSearchFiltersFromParams(await read)).toEqual({
          ...filters,
          ...(variant.roundTrip ?? variant.filters),
        });
      });
    });
  }
});
