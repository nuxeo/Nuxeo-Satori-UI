import { describe, expect, it } from 'vitest';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  NXS_MODIFIED_RANGES,
  nxsHasSearchFilters,
  nxsRangeOptions,
  nxsSameSearchFilters,
  nxsSavedParamsToClear,
  nxsSearchFiltersFromParams,
  nxsSearchFiltersToQuery,
  nxsSearchFiltersToRecord,
  nxsSearchFiltersToSavedParams,
  nxsTermOptions,
  type NxsSearchFilters,
} from './search-filters.model';

/** A saved search's params with no filter set: every parameter written, empty. */
const EMPTY_SAVED_PARAMS: Record<string, string> = {
  ecm_fulltext: '',
  dc_modified_agg: '[]',
  dc_creator_agg: '[]',
  ecm_collections: '[]',
  ecm_tags: '[]',
  dc_nature_agg: '[]',
  dc_subjects_agg: '[]',
  dc_coverage_agg: '[]',
  common_size_agg: '[]',
};

const filters = (over: Partial<NxsSearchFilters>): NxsSearchFilters => ({
  ...NXS_EMPTY_SEARCH_FILTERS,
  ...over,
});

/** Every field set, with values a query builder gets wrong: quotes, wildcards, commas, slashes. */
const EVERYTHING = filters({
  query: 'ecm:primaryType = "File"',
  fulltext: `"exact phrase" o'brien te*t`,
  modified: ['last24h', 'priorToLastYear'],
  authors: ['o"brien', 'jdoe'],
  collections: ['col-1', 'col-2'],
  tags: ['q1 "draft"', 'legal'],
  nature: ['article', 'report'],
  subjects: ['art', 'art/cinema'],
  coverage: ['Paris, France', 'europe/France'],
  size: ['tiny', 'huge'],
});

describe('search filters — the record a host keeps', () => {
  it('leaves out every empty field', () => {
    expect(nxsSearchFiltersToRecord(NXS_EMPTY_SEARCH_FILTERS)).toEqual({});
    expect(
      nxsSearchFiltersToRecord(filters({ fulltext: '   ', nature: [' ', ''], tags: [' '] })),
    ).toEqual({});
  });

  it('writes each field under its key, trimmed, multi-value fields as JSON arrays once each', () => {
    expect(
      nxsSearchFiltersToRecord(
        filters({
          fulltext: ' contract ',
          nature: ['article', ' article', 'report'],
          authors: ['jdoe'],
        }),
      ),
    ).toEqual({ ecm_fulltext: 'contract', nature: '["article","report"]', author: '["jdoe"]' });
  });

  it('reads back what it wrote, for every field, a comma inside a value included', () => {
    expect(nxsSearchFiltersFromParams(nxsSearchFiltersToRecord(EVERYTHING))).toEqual(EVERYTHING);
  });
});

describe('search filters — a saved search’s params', () => {
  it('writes the page provider’s own names, lists as JSON arrays', () => {
    expect(nxsSearchFiltersToSavedParams(EVERYTHING)).toEqual({
      q: 'ecm:primaryType = "File"',
      ecm_fulltext: `"exact phrase" o'brien te*t`,
      dc_modified_agg: '["last24h","priorToLastYear"]',
      dc_creator_agg: '["o\\"brien","jdoe"]',
      ecm_collections: '["col-1","col-2"]',
      ecm_tags: '["q1 \\"draft\\"","legal"]',
      dc_nature_agg: '["article","report"]',
      dc_subjects_agg: '["art","art/cinema"]',
      dc_coverage_agg: '["Paris, France","europe/France"]',
      common_size_agg: '["tiny","huge"]',
    });
  });

  it('never writes the short names the server refuses', () => {
    const params = nxsSearchFiltersToSavedParams(EVERYTHING);
    for (const refused of ['subjects', 'size', 'nature', 'coverage', 'modifiedDate', 'author']) {
      expect(params).not.toHaveProperty(refused);
    }
  });

  it('writes every parameter, empty, for no filters — an update merges, so a left-out one stays saved', () => {
    expect(nxsSearchFiltersToSavedParams(NXS_EMPTY_SEARCH_FILTERS)).toEqual(EMPTY_SAVED_PARAMS);
  });

  it('clears a filter by writing it empty, and writes q only when set', () => {
    const params = nxsSearchFiltersToSavedParams(filters({ nature: ['article'] }));
    expect(params['dc_nature_agg']).toBe('["article"]');
    expect(params['common_size_agg']).toBe('[]');
    expect(params['ecm_fulltext']).toBe('');
    expect(params).not.toHaveProperty('q');
  });

  it('round-trips every field, a comma inside a value included', () => {
    expect(nxsSearchFiltersFromParams(nxsSearchFiltersToSavedParams(EVERYTHING))).toEqual(
      EVERYTHING,
    );
  });

  it('reads a search Web UI saved, with arrays, nulls and empty lists', () => {
    expect(
      nxsSearchFiltersFromParams({
        ecm_fulltext: 'newupload',
        dc_modified_agg: ['lastWeek'],
        dc_creator_agg: ['Administrator'],
        ecm_collections: [],
        ecm_tags: ['q1'],
        dc_nature_agg: [],
        dc_subjects_agg: ['art'],
        dc_coverage_agg: [],
        common_size_agg: ['small'],
        dc_modified_min: null,
        'cvd:contentViewName': 'default_search',
      }),
    ).toEqual(
      filters({
        fulltext: 'newupload',
        modified: ['lastWeek'],
        authors: ['Administrator'],
        tags: ['q1'],
        subjects: ['art'],
        size: ['small'],
      }),
    );
  });

  it('reads lists as getSavedSearchById returns them: JSON strings, or empty strings', () => {
    expect(
      nxsSearchFiltersFromParams({
        dc_coverage_agg: '["Paris, France"]',
        dc_nature_agg: '',
        ecm_collections: '["col-9"]',
      }),
    ).toEqual(filters({ coverage: ['Paris, France'], collections: ['col-9'] }));
  });

  it('reads a search saved earlier under the short names, comma-separated', () => {
    expect(
      nxsSearchFiltersFromParams({
        q: 'x',
        ecm_fulltext: 'probe',
        modifiedDate: 'last24h, lastWeek',
        nature: 'article',
        author: 'Administrator',
        collection: 'abc',
        tag: 't1',
        size: 'tiny',
        subjects: 'art',
        coverage: 'europe/France',
      }),
    ).toEqual(
      filters({
        query: 'x',
        fulltext: 'probe',
        modified: ['last24h', 'lastWeek'],
        nature: ['article'],
        authors: ['Administrator'],
        collections: ['abc'],
        tags: ['t1'],
        size: ['tiny'],
        subjects: ['art'],
        coverage: ['europe/France'],
      }),
    );
  });

  it('prefers the page provider’s key when both are present, as the server does', () => {
    expect(
      nxsSearchFiltersFromParams({ dc_nature_agg: ['report'], nature: 'article' }).nature,
    ).toEqual(['report']);
  });

  it('reads a `defaults:` key when the plain one is absent', () => {
    expect(nxsSearchFiltersFromParams({ 'defaults:dc_nature_agg': '["article"]' }).nature).toEqual([
      'article',
    ]);
  });

  it('reads the earlier "more than a year ago" range as the server’s bucket, once', () => {
    expect(
      nxsSearchFiltersFromParams({ modifiedDate: 'moreThan1YearAgo,priorToLastYear' }).modified,
    ).toEqual(['priorToLastYear']);
  });

  it('does not read the coverage aggregate as a collection', () => {
    // The old reader fell back to `dc_coverage_agg` for the collection, so a saved coverage choice
    // came back as a collection filter too.
    expect(
      nxsSearchFiltersFromParams({ dc_coverage_agg: '["europe/France"]' }).collections,
    ).toEqual([]);
  });

  it('keeps every author, collection and tag of a search Web UI saved with several', () => {
    // Web UI's Authors, Collections and Tags are multiple-choice (`multiple="true"`).
    expect(
      nxsSearchFiltersFromParams({
        dc_creator_agg: ['alice', 'bob'],
        ecm_collections: ['col-a', 'col-b'],
        ecm_tags: ['urgent', 'legal'],
      }),
    ).toEqual(
      filters({
        authors: ['alice', 'bob'],
        collections: ['col-a', 'col-b'],
        tags: ['urgent', 'legal'],
      }),
    );
  });

  it('reads collection entries Web UI keeps as objects, by their id or uid', () => {
    expect(
      nxsSearchFiltersFromParams({
        ecm_collections: [
          { id: 'col-a', displayLabel: 'Projects' },
          { uid: 'col-b' },
          { title: 'x' },
        ],
      }).collections,
    ).toEqual(['col-a', 'col-b']);
  });

  it('keeps full text that looks like JSON or has commas as it is', () => {
    expect(nxsSearchFiltersFromParams({ ecm_fulltext: ' [draft], final ' }).fulltext).toBe(
      '[draft], final',
    );
  });

  it('reads a list that is not valid JSON as comma-separated', () => {
    expect(nxsSearchFiltersFromParams({ dc_nature_agg: '[article' }).nature).toEqual(['[article']);
  });

  it('ignores values of the wrong kind, and no params at all', () => {
    expect(
      nxsSearchFiltersFromParams({
        ecm_fulltext: 42,
        dc_nature_agg: { key: 'article' },
        dc_subjects_agg: [{ label: 'art' }, 7, 'sciences', null],
      }),
    ).toEqual(filters({ subjects: ['7', 'sciences'] }));
    expect(nxsSearchFiltersFromParams(null)).toEqual(NXS_EMPTY_SEARCH_FILTERS);
    expect(nxsSearchFiltersFromParams(undefined)).toEqual(NXS_EMPTY_SEARCH_FILTERS);
  });
});

describe('search filters — clearing the names a saved search was read with', () => {
  it('clears every fallback key the search carried, and only those', () => {
    expect(
      nxsSavedParamsToClear({
        author: 'alice',
        nature: 'contract',
        modifiedDate: 'last24h',
        dc_nature: ['report'],
        collection_agg: '["col-1"]',
        'defaults:tag': 't1',
        coverage: '',
        dc_creator: [],
        dc_coverage: '[]',
        ecm_fulltext: 'kept',
        dc_creator_agg: '["alice"]',
      }),
    ).toEqual({
      author: '',
      nature: '',
      modifiedDate: '',
      dc_nature: '[]',
      collection_agg: '[]',
      'defaults:tag': '',
    });
  });

  it('clears nothing for a search saved under the page provider’s names, or none at all', () => {
    expect(nxsSavedParamsToClear({ dc_creator_agg: '["alice"]', ecm_fulltext: 'x' })).toEqual({});
    expect(nxsSavedParamsToClear(null)).toEqual({});
  });

  it('reads back with a removed author gone once the old key is cleared', () => {
    const loaded = { author: 'alice', ecm_fulltext: 'x' };
    const saved = {
      ...loaded,
      ...nxsSavedParamsToClear(loaded),
      ...nxsSearchFiltersToSavedParams(filters({ fulltext: 'x' })),
    };
    expect(nxsSearchFiltersFromParams(saved).authors).toEqual([]);
    // Without the clearing, the merge keeps `author` and the removed author comes back.
    expect(
      nxsSearchFiltersFromParams({
        ...loaded,
        ...nxsSearchFiltersToSavedParams(filters({ fulltext: 'x' })),
      }).authors,
    ).toEqual(['alice']);
  });
});

describe('search filters — the query', () => {
  it('sends only what is set', () => {
    expect(nxsSearchFiltersToQuery(NXS_EMPTY_SEARCH_FILTERS)).toEqual({});
  });

  it('maps every field to SearchService.search’s parameters', () => {
    expect(nxsSearchFiltersToQuery(EVERYTHING)).toEqual({
      q: 'ecm:primaryType = "File"',
      ecmFulltext: `"exact phrase" o'brien te*t`,
      modifiedDate: '["last24h","priorToLastYear"]',
      author: '["o\\"brien","jdoe"]',
      collection: '["col-1","col-2"]',
      tag: '["q1 \\"draft\\"","legal"]',
      nature: '["article","report"]',
      subjects: '["art","art/cinema"]',
      coverage: '["Paris, France","europe/France"]',
      size: '["tiny","huge"]',
    });
  });

  it('adds the page’s quick filters and sort', () => {
    expect(
      nxsSearchFiltersToQuery(filters({ fulltext: 'x' }), {
        quickFilters: ' noFolder ',
        sortBy: 'dc:title',
        sortOrder: 'asc',
      }),
    ).toEqual({ ecmFulltext: 'x', quickFilters: 'noFolder', sortBy: 'dc:title', sortOrder: 'asc' });
    expect(
      nxsSearchFiltersToQuery(NXS_EMPTY_SEARCH_FILTERS, {
        quickFilters: '  ',
        sortBy: null,
        sortOrder: null,
      }),
    ).toEqual({});
  });
});

describe('search filters — comparing', () => {
  it('has filters once any field is set', () => {
    expect(nxsHasSearchFilters(NXS_EMPTY_SEARCH_FILTERS)).toBe(false);
    expect(nxsHasSearchFilters(filters({ size: ['tiny'] }))).toBe(true);
    expect(nxsHasSearchFilters(filters({ fulltext: '  ' }))).toBe(false);
  });

  it('treats the order within a field and surrounding spaces as the same search', () => {
    expect(
      nxsSameSearchFilters(
        filters({ nature: ['a', 'b'], fulltext: 'x ' }),
        filters({ nature: ['b', 'a'], fulltext: ' x' }),
      ),
    ).toBe(true);
  });

  it('tells apart any difference in any field', () => {
    for (const change of [
      { query: 'q' },
      { fulltext: 'y' },
      { authors: ['a'] },
      { collections: ['c'] },
      { tags: ['t'] },
      { modified: ['last24h'] },
      { nature: ['n'] },
      { subjects: ['s'] },
      { coverage: ['c'] },
      { size: ['tiny'] },
    ] satisfies Partial<NxsSearchFilters>[]) {
      expect(nxsSameSearchFilters(NXS_EMPTY_SEARCH_FILTERS, filters(change))).toBe(false);
    }
  });

  it('compares full text starting with a bracket without failing', () => {
    expect(nxsSameSearchFilters(filters({ fulltext: '[x' }), filters({ fulltext: '[x' }))).toBe(
      true,
    );
  });
});

describe('search filters — choices', () => {
  it('lists every range in order, with the server’s count or none', () => {
    expect(
      nxsRangeOptions(NXS_MODIFIED_RANGES, {
        buckets: [
          { key: 'lastWeek', docCount: 4 },
          { key: 'last24h', docCount: 0 },
          { key: 'unknown', docCount: 9 },
        ],
      }),
    ).toEqual([
      { value: 'last24h', count: 0 },
      { value: 'lastWeek', count: 4 },
      { value: 'lastMonth', count: null },
      { value: 'lastYear', count: null },
      { value: 'priorToLastYear', count: null },
    ]);
    expect(nxsRangeOptions(['a'], undefined)).toEqual([{ value: 'a', count: null }]);
  });

  it('lists the terms with results, then a selected value the server no longer returns', () => {
    expect(
      nxsTermOptions(
        {
          buckets: [
            { key: 'art', docCount: 10 },
            { key: 'empty', docCount: 0 },
            { key: 'art', docCount: 3 },
            { key: '', docCount: 5 },
          ],
        },
        ['gone', 'art', 'gone'],
      ),
    ).toEqual([
      { value: 'art', count: 10 },
      { value: 'gone', count: null },
    ]);
    expect(nxsTermOptions(undefined, [])).toEqual([]);
  });
});
