import { figureOf, requestKey } from './figures';
import type { HomeKpi } from './home-file';

const kpi = (keys: Partial<HomeKpi> = {}): HomeKpi => ({
  pageProvider: 'payers_open_claims',
  parameters: [],
  aggregate: null,
  bucket: null,
  ...keys,
});

/** A page provider's results as Nuxeo writes them, measured on `default_search`: a terms aggregate. */
const results = {
  'entity-type': 'documents',
  resultsCount: 2249,
  totalSize: 2249,
  pageSize: 1,
  entries: [{ 'entity-type': 'document', uid: 'x' }],
  aggregations: {
    claim_state_agg: {
      'entity-type': 'aggregate',
      id: 'claim_state_agg',
      field: 'ecm:currentLifeCycleState',
      type: 'terms',
      buckets: [
        { key: 'pending', docCount: 12 },
        { key: 'approved', docCount: 5 },
      ],
    },
    common_size_agg: {
      'entity-type': 'aggregate',
      id: 'common_size_agg',
      type: 'range',
      buckets: [
        { key: 'tiny', docCount: 175, from: null, to: 102400.0 },
        { key: 'huge', docCount: 0, from: 104857601, to: null },
      ],
    },
  },
};

describe('what a KPI shows', () => {
  it('counts the results with no aggregate', () => {
    expect(figureOf(kpi(), results)).toEqual({ kind: 'count', value: 2249 });
  });

  it("counts one bucket's documents, and 0 for a bucket the server returns none for", () => {
    expect(figureOf(kpi({ aggregate: 'claim_state_agg', bucket: 'pending' }), results)).toEqual({
      kind: 'count',
      value: 12,
    });
    expect(figureOf(kpi({ aggregate: 'claim_state_agg', bucket: 'denied' }), results)).toEqual({
      kind: 'count',
      value: 0,
    });
  });

  it('lists the buckets, in the order the server gives them, with the results counted', () => {
    expect(figureOf(kpi({ aggregate: 'common_size_agg' }), results)).toEqual({
      kind: 'buckets',
      value: 2249,
      buckets: [
        { key: 'tiny', count: 175 },
        { key: 'huge', count: 0 },
      ],
    });
  });

  it('passes over a bucket it cannot read', () => {
    const odd = {
      resultsCount: 3,
      aggregations: {
        a: {
          buckets: [
            { key: 'x', docCount: 1 },
            'y',
            { key: {}, docCount: 1 },
            { key: 7, docCount: 2 },
            { key: 'z', docCount: -1 },
          ],
        },
      },
    };
    expect(figureOf(kpi({ aggregate: 'a' }), odd)).toEqual({
      kind: 'buckets',
      value: 3,
      buckets: [
        { key: 'x', count: 1 },
        { key: '7', count: 2 },
      ],
    });
  });

  const unavailable: readonly [string, Partial<HomeKpi>, unknown, string][] = [
    ['no results at all', {}, null, 'the server answered with no results'],
    [
      'a page provider that failed',
      {},
      { hasError: true, errorMessage: 'Syntax error', resultsCount: 0 },
      'the page provider "payers_open_claims" failed: Syntax error',
    ],
    [
      'a count the server did not make',
      {},
      { resultsCount: -1 },
      'the page provider "payers_open_claims" did not count its results',
    ],
    [
      'a count that is not a whole number',
      {},
      { resultsCount: '12' },
      'the page provider "payers_open_claims" did not count its results',
    ],
    [
      'no aggregates, from a page provider that queries the repository',
      { aggregate: 'claim_state_agg' },
      { resultsCount: 4, aggregations: {} },
      'the page provider "payers_open_claims" returns no aggregates: only one the search index serves has them',
    ],
    [
      'an aggregate the page provider does not have',
      { aggregate: 'claim_type_agg', bucket: 'auto' },
      results,
      'the page provider "payers_open_claims" has no aggregate "claim_type_agg"',
    ],
    [
      "an aggregate named after an object's own property",
      { aggregate: 'constructor' },
      results,
      'the page provider "payers_open_claims" has no aggregate "constructor"',
    ],
  ];
  it.each(unavailable)('is unavailable for %s', (_what, keys, body, reason) => {
    expect(figureOf(kpi(keys), body)).toEqual({ kind: 'unavailable', reason });
  });
});

describe('the requests', () => {
  it('are one per page provider and parameters, whatever is counted from them', () => {
    const a = requestKey(kpi({ aggregate: 'claim_state_agg', bucket: 'pending' }));
    expect(requestKey(kpi())).toBe(a);
    expect(requestKey(kpi({ parameters: ['Claim'] }))).not.toBe(a);
    expect(requestKey(kpi({ pageProvider: 'payers_unassigned_claims' }))).not.toBe(a);
  });
});
