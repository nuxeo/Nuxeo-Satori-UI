/**
 * What a KPI card shows, from a page provider's results (docs/business-apps/app-definition-v2.md,
 * section 10). The results are the body of `GET /api/v1/search/pp/<pageProvider>/execute`:
 *
 * - `resultsCount`, how many records the page provider returns to the person signed in;
 * - `aggregations`, by aggregate id, each with its `buckets`: `{ key, docCount }`. Only a page
 *   provider served by the search index has them.
 *
 * A terms aggregate returns only its largest buckets, as many as its `size` (10 when it sets
 * none), so a key missing from a full list may be one more bucket the server did not return, not
 * one no record has.
 */
import type { HomeKpi } from './home-file';

export interface Bucket {
  readonly key: string;
  readonly count: number;
}

export type Figure =
  | { readonly kind: 'count'; readonly value: number }
  | {
      readonly kind: 'buckets';
      readonly value: number;
      readonly buckets: readonly Bucket[];
      /** Whether the server may have more buckets than these: a terms aggregate returned its size. */
      readonly truncated: boolean;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The terms aggregates' default size, when the page provider's aggregate sets none. */
export const DEFAULT_TERMS_SIZE = 10;

const TERMS = new Set(['terms', 'significant_terms']);

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

/** The cards that read the same page provider with the same parameters share one request. */
export function requestKey(kpi: HomeKpi): string {
  return JSON.stringify([kpi.pageProvider, kpi.parameters]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const unavailable = (reason: string): Figure => ({ kind: 'unavailable', reason });

export function figureOf(kpi: HomeKpi, results: unknown): Figure {
  if (!isRecord(results)) return unavailable('the server answered with no results');
  if (results['hasError'] === true) {
    const message =
      typeof results['errorMessage'] === 'string' ? `: ${results['errorMessage']}` : '';
    return unavailable(`the page provider "${kpi.pageProvider}" failed${message}`);
  }
  const total = results['resultsCount'];
  if (!isCount(total))
    return unavailable(`the page provider "${kpi.pageProvider}" did not count its results`);
  if (kpi.aggregate === null) return { kind: 'count', value: total };

  const aggregations = results['aggregations'];
  if (!isRecord(aggregations) || Object.keys(aggregations).length === 0)
    return unavailable(
      `the page provider "${kpi.pageProvider}" returns no aggregates: it has them only if it defines them and the search index serves it`,
    );
  const aggregate = Object.hasOwn(aggregations, kpi.aggregate)
    ? aggregations[kpi.aggregate]
    : undefined;
  if (!isRecord(aggregate) || !Array.isArray(aggregate['buckets']))
    return unavailable(
      `the page provider "${kpi.pageProvider}" has no aggregate "${kpi.aggregate}"`,
    );
  const buckets: Bucket[] = [];
  for (const bucket of aggregate['buckets'] as unknown[]) {
    if (!isRecord(bucket)) continue;
    const key = bucket['key'];
    const count = bucket['docCount'];
    if ((typeof key === 'string' || typeof key === 'number') && isCount(count))
      buckets.push({ key: String(key), count });
  }
  const returned = (aggregate['buckets'] as unknown[]).length;
  const truncated = mayHaveMore(aggregate, returned);
  if (kpi.bucket === null) return { kind: 'buckets', value: total, buckets, truncated };
  const found = buckets.find((bucket) => bucket.key === kpi.bucket);
  if (found) return { kind: 'count', value: found.count };
  // A terms aggregate returns no bucket for a key no record has: that is a count of 0, unless the
  // list is full, and the bucket may be one the server left out.
  if (truncated)
    return unavailable(
      `the bucket "${kpi.bucket}" is not among the ${returned} largest the aggregate "${kpi.aggregate}" returns`,
    );
  return { kind: 'count', value: 0 };
}
