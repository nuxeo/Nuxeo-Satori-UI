/**
 * What a KPI card shows, from a page provider's results (docs/business-apps/app-definition-v2.md,
 * section 10). The results are the body of `GET /api/v1/search/pp/<pageProvider>/execute`:
 *
 * - `resultsCount`, how many records the page provider returns to the person signed in;
 * - `aggregations`, by aggregate id, each with its `buckets`: `{ key, docCount }`. Only a page
 *   provider served by the search index has them.
 */
import type { HomeKpi } from './home-file';

export interface Bucket {
  readonly key: string;
  readonly count: number;
}

export type Figure =
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'buckets'; readonly value: number; readonly buckets: readonly Bucket[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

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
  if (kpi.bucket === null) return { kind: 'buckets', value: total, buckets };
  // A terms aggregate returns no bucket for a key no record has: that is a count of 0.
  return { kind: 'count', value: buckets.find((bucket) => bucket.key === kpi.bucket)?.count ?? 0 };
}
