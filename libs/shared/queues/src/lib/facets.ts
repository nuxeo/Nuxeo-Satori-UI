/**
 * A queue's facets, from the page provider's results (docs/business-apps/app-definition-v2.md,
 * section 4): `aggregations`, by aggregate id, as `GET /api/v1/search/pp/<pageProvider>/execute`
 * returns them. Only a page provider the search index serves has them.
 *
 * Each aggregate has its `buckets`, `{ key, docCount }`, and its `extendedBuckets`: the same, with
 * the buckets chosen in it that hold no record now, at 0. Those are read first, so a chosen bucket
 * stays on screen to be cleared. Nuxeo counts an aggregate's buckets with the other aggregates'
 * choices applied and not its own, so choosing a second bucket of one aggregate widens the list.
 *
 * A terms aggregate returns only its largest buckets, as many as its `size` (10 when it sets
 * none), so a facet that shows that many may have more the server did not return.
 */

export interface FacetBucket {
  /** The bucket's key, as the server returns it and as a choice sends it back. */
  readonly key: string;
  /** The records in it, or `null` when the server returned no such bucket. */
  readonly count: number | null;
}

export type FacetBuckets =
  | {
      readonly kind: 'buckets';
      readonly buckets: readonly FacetBucket[];
      /** Whether the server may have more buckets than these: a terms aggregate returned its size. */
      readonly truncated: boolean;
    }
  /** Why the facet has no buckets to show: the results have no such aggregate. */
  | { readonly kind: 'none'; readonly reason: string };

/** The terms aggregates' default size, when the page provider's aggregate sets none. */
export const DEFAULT_TERMS_SIZE = 10;

const TERMS = new Set(['terms', 'significant_terms']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** One bucket as the server writes it, or `null` for one with no key. */
function bucketOf(raw: unknown): FacetBucket | null {
  if (!isRecord(raw)) return null;
  const key = raw['key'];
  if (typeof key !== 'string' && typeof key !== 'number') return null;
  const count = isCount(raw['docCount'])
    ? raw['docCount']
    : isCount(raw['doc_count'])
      ? raw['doc_count']
      : null;
  return { key: String(key), count };
}

/**
 * The buckets to show for `aggregate`, with each bucket in `chosen` among them: one the server
 * returned no bucket for is shown with no count, so that it can still be cleared.
 */
export function facetBuckets(
  aggregations: unknown,
  aggregate: string,
  chosen: readonly string[],
): FacetBuckets {
  if (!isRecord(aggregations) || Object.keys(aggregations).length === 0) {
    return {
      kind: 'none',
      reason:
        'the page provider returns no aggregates: it has them only if it defines them and the search index serves it',
    };
  }
  const raw = Object.hasOwn(aggregations, aggregate) ? aggregations[aggregate] : undefined;
  if (!isRecord(raw)) {
    return { kind: 'none', reason: `the page provider returns no aggregate "${aggregate}"` };
  }
  const returned = Array.isArray(raw['buckets']) ? raw['buckets'] : [];
  const listed = Array.isArray(raw['extendedBuckets']) ? raw['extendedBuckets'] : returned;
  const buckets: FacetBucket[] = [];
  const seen = new Set<string>();
  for (const entry of listed) {
    const bucket = bucketOf(entry);
    if (bucket === null || seen.has(bucket.key)) continue;
    seen.add(bucket.key);
    buckets.push(bucket);
  }
  for (const key of chosen) {
    if (seen.has(key)) continue;
    seen.add(key);
    buckets.push({ key, count: null });
  }
  return { kind: 'buckets', buckets, truncated: mayHaveMore(raw, returned.length) };
}

/**
 * Whether `aggregate` may hold more buckets than the `returned` the server gave: a terms aggregate
 * returns only its `size` largest. Range and histogram aggregates return every bucket they define.
 */
function mayHaveMore(aggregate: Record<string, unknown>, returned: number): boolean {
  if (!TERMS.has(aggregate['type'] as string)) return false;
  const properties = aggregate['properties'];
  const written = isRecord(properties) ? Number(properties['size']) : NaN;
  const size = Number.isSafeInteger(written) && written > 0 ? written : DEFAULT_TERMS_SIZE;
  return returned >= size;
}
