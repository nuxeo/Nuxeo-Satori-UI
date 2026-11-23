import { DEFAULT_TERMS_SIZE, facetBuckets } from './facets';

/** An aggregate as `default_search` returns one on the local server. */
const creators = {
  type: 'terms',
  properties: { size: '3' },
  selection: ['nxsat332-writer'],
  buckets: [{ key: 'Administrator', docCount: 1 }],
  extendedBuckets: [
    { key: 'nxsat332-writer', docCount: 0 },
    { key: 'Administrator', docCount: 1 },
  ],
};

describe('facetBuckets', () => {
  it('reads the extended buckets, which keep a chosen bucket that now holds no record', () => {
    expect(
      facetBuckets({ dc_creator_agg: creators }, 'dc_creator_agg', ['nxsat332-writer']),
    ).toEqual({
      kind: 'buckets',
      buckets: [
        { key: 'nxsat332-writer', count: 0 },
        { key: 'Administrator', count: 1 },
      ],
      truncated: false,
    });
  });

  it('reads the buckets where there are no extended ones, and adds a chosen key the server left out, uncounted', () => {
    const aggregate = {
      type: 'terms',
      buckets: [
        { key: 'medical', doc_count: 4 },
        { key: 7, docCount: 2 },
      ],
    };
    expect(facetBuckets({ claim_type_agg: aggregate }, 'claim_type_agg', ['vision'])).toEqual({
      kind: 'buckets',
      buckets: [
        { key: 'medical', count: 4 },
        { key: '7', count: 2 },
        { key: 'vision', count: null },
      ],
      truncated: false,
    });
  });

  it('says a terms aggregate that returned its size may have more, and a range never does', () => {
    const terms = (size: unknown, returned: number) => ({
      type: 'terms',
      ...(size === undefined ? {} : { properties: { size } }),
      buckets: Array.from({ length: returned }, (_, i) => ({ key: `k${i}`, docCount: 1 })),
    });
    const truncated = (aggregate: unknown) => {
      const read = facetBuckets({ a: aggregate }, 'a', []);
      return read.kind === 'buckets' && read.truncated;
    };
    expect(truncated(terms('3', 3))).toBe(true);
    expect(truncated(terms('3', 2))).toBe(false);
    expect(truncated(terms(undefined, DEFAULT_TERMS_SIZE))).toBe(true);
    expect(truncated(terms(undefined, DEFAULT_TERMS_SIZE - 1))).toBe(false);
    // The chosen buckets the server adds to the extended list do not count towards the size.
    expect(truncated({ ...terms('3', 2), extendedBuckets: terms('3', 3).buckets })).toBe(false);
    expect(truncated({ type: 'range', buckets: terms('1', 5).buckets })).toBe(false);
  });

  it('has no buckets where the page provider returns no aggregates, as one on the repository does', () => {
    for (const aggregations of [undefined, null, {}]) {
      expect(facetBuckets(aggregations, 'dc_creator_agg', [])).toEqual({
        kind: 'none',
        reason: expect.stringContaining('returns no aggregates'),
      });
    }
  });

  it('has no buckets for an aggregate the page provider does not define', () => {
    expect(facetBuckets({ dc_creator_agg: creators }, 'claim_type_agg', [])).toEqual({
      kind: 'none',
      reason: 'the page provider returns no aggregate "claim_type_agg"',
    });
    // Not one inherited from Object.prototype either: `__proto__` is an object, so only the
    // own-property check keeps it from being read as an aggregate with no buckets.
    expect(facetBuckets({ dc_creator_agg: creators }, '__proto__', []).kind).toBe('none');
    expect(facetBuckets({ dc_creator_agg: creators }, 'toString', []).kind).toBe('none');
  });
});
