import type { AggregateResult, SearchQueryParams } from '@nuxeo-satori/platform/nuxeo-client';

/**
 * The values of the search filters: what `nxs-search-filters` edits and a host turns into a query.
 *
 * Each field is one of `default_search`'s parameters. A multi-value field holds the bucket keys the
 * server's aggregate returns, and an empty string or list means "not filtered".
 */
export interface NxsSearchFilters {
  /** Full text, sent as `ecm_fulltext`. */
  readonly fulltext: string;
  /** Modification-date ranges, the `dc_modified_agg` buckets — see {@link NXS_MODIFIED_RANGES}. */
  readonly modified: readonly string[];
  /** Authors' usernames, the `dc_creator_agg` buckets. */
  readonly authors: readonly string[];
  /** Collection ids, sent as `ecm_collections`. */
  readonly collections: readonly string[];
  /** Tag labels, sent as `ecm_tags`. */
  readonly tags: readonly string[];
  /** Nature vocabulary ids, the `dc_nature_agg` buckets. */
  readonly nature: readonly string[];
  /** Subject vocabulary ids, the `dc_subjects_agg` buckets. */
  readonly subjects: readonly string[];
  /** Coverage vocabulary ids, the `dc_coverage_agg` buckets. */
  readonly coverage: readonly string[];
  /** File-size ranges, the `common_size_agg` buckets — see {@link NXS_SIZE_RANGES}. */
  readonly size: readonly string[];
  /**
   * The page provider's `query` parameter. No field edits it; it is kept so a saved search that
   * carries one keeps it when it is loaded and saved again.
   */
  readonly query: string;
}

/** No filter set. */
export const NXS_EMPTY_SEARCH_FILTERS: NxsSearchFilters = Object.freeze({
  fulltext: '',
  modified: [],
  authors: [],
  collections: [],
  tags: [],
  nature: [],
  subjects: [],
  coverage: [],
  size: [],
  query: '',
});

/** The `dc_modified_agg` buckets `default_search` defines, in the order they are offered. */
export const NXS_MODIFIED_RANGES = [
  'last24h',
  'lastWeek',
  'lastMonth',
  'lastYear',
  'priorToLastYear',
] as const;

/** The `common_size_agg` buckets `default_search` defines, in the order they are offered. */
export const NXS_SIZE_RANGES = ['tiny', 'small', 'medium', 'big', 'huge'] as const;

/** One choice in a filter group: a bucket key, and how many results fall in it. */
export interface NxsFacetOption {
  readonly value: string;
  /** Results in the bucket, as the server counted them; `null` when the server sent no bucket. */
  readonly count: number | null;
}

/**
 * The filters as the record a host keeps them in — `SearchAggregationService.drawerFilters` — with
 * a multi-value field as a JSON array, so a value containing a comma stays one value, and an empty
 * field left out.
 */
export function nxsSearchFiltersToRecord(filters: NxsSearchFilters): Record<string, string> {
  const record: Record<string, string> = {};
  const put = (key: string, value: string | readonly string[]) => {
    if (typeof value === 'string') {
      if (value.trim()) record[key] = value.trim();
      return;
    }
    const list = uniqueValues(value);
    if (list.length > 0) record[key] = JSON.stringify(list);
  };
  put('q', filters.query);
  put('ecm_fulltext', filters.fulltext);
  put('modifiedDate', filters.modified);
  put('nature', filters.nature);
  put('subjects', filters.subjects);
  put('coverage', filters.coverage);
  put('size', filters.size);
  put('author', filters.authors);
  put('collection', filters.collections);
  put('tag', filters.tags);
  return record;
}

/**
 * The filters as a saved search's `params`, under `default_search`'s own parameter names — the ones
 * Web UI writes, so either application opens a search the other saved. A multi-value field is a JSON
 * array, which the server stores as a list.
 *
 * Every parameter is written, an empty one as `""` or `[]`, as Web UI writes its whole form: the
 * server merges an update's `params` into the ones it holds, so a filter left out would stay saved.
 * `q`, which no field edits, is written only when set.
 *
 * Not {@link nxsSearchFiltersToRecord}'s names: the server maps a parameter onto the saved search's
 * own fields by name, and refuses `subjects` and `size`, which collide with `dc:subjects` and the
 * removed `common:size`.
 */
export function nxsSearchFiltersToSavedParams(filters: NxsSearchFilters): Record<string, string> {
  const params: Record<string, string> = {};
  const values = (key: string, value: readonly string[]) => {
    params[key] = JSON.stringify(uniqueValues(value));
  };
  if (filters.query.trim()) params['q'] = filters.query.trim();
  params['ecm_fulltext'] = filters.fulltext.trim();
  values('dc_modified_agg', filters.modified);
  values('dc_creator_agg', filters.authors);
  values('ecm_collections', filters.collections);
  values('ecm_tags', filters.tags);
  values('dc_nature_agg', filters.nature);
  values('dc_subjects_agg', filters.subjects);
  values('dc_coverage_agg', filters.coverage);
  values('common_size_agg', filters.size);
  return params;
}

/**
 * The keys {@link nxsSearchFiltersFromParams} falls back to when the page provider's own is empty —
 * the names earlier saved searches were written under, and `default_search`'s other parameters for
 * the same fields — each with the value that clears it.
 */
const FALLBACK_PARAMS: Readonly<Record<string, string>> = {
  ecmFulltext: '',
  modifiedDate: '',
  dc_modified: '[]',
  author: '',
  dc_creator: '[]',
  collection: '',
  collection_agg: '[]',
  tag: '',
  nature: '',
  dc_nature: '[]',
  dc_subjects: '[]',
  coverage: '',
  dc_coverage: '[]',
  common_size: '[]',
};

/**
 * The params that clear every fallback key a saved search was read with, to send beside
 * {@link nxsSearchFiltersToSavedParams} when it is saved again.
 *
 * The server merges an update into the stored params, so a search saved under an earlier name
 * (`author: "alice"`) kept that key: with its author removed and saved, it read back from the old key
 * and the author returned. Once saved, the page provider's own key holds the value.
 */
export function nxsSavedParamsToClear(
  loaded: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> {
  const clear: Record<string, string> = {};
  for (const [key, cleared] of Object.entries(FALLBACK_PARAMS)) {
    for (const candidate of [key, `defaults:${key}`]) {
      const value = loaded?.[candidate];
      const empty =
        value === undefined ||
        value === null ||
        value === '' ||
        value === '[]' ||
        (Array.isArray(value) && value.length === 0);
      if (!empty) clear[candidate] = cleared;
    }
  }
  return clear;
}

/** The filters as `SearchService.search`'s parameters, with the page's quick filters and sort. */
export function nxsSearchFiltersToQuery(
  filters: NxsSearchFilters,
  page: { quickFilters?: string; sortBy?: string | null; sortOrder?: 'asc' | 'desc' | null } = {},
): SearchQueryParams {
  const query: SearchQueryParams = {};
  const record = nxsSearchFiltersToRecord(filters);
  if (record['q']) query.q = record['q'];
  if (record['ecm_fulltext']) query.ecmFulltext = record['ecm_fulltext'];
  if (record['modifiedDate']) query.modifiedDate = record['modifiedDate'];
  if (record['author']) query.author = record['author'];
  if (record['collection']) query.collection = record['collection'];
  if (record['tag']) query.tag = record['tag'];
  if (record['nature']) query.nature = record['nature'];
  if (record['subjects']) query.subjects = record['subjects'];
  if (record['coverage']) query.coverage = record['coverage'];
  if (record['size']) query.size = record['size'];
  if (page.quickFilters?.trim()) query.quickFilters = page.quickFilters.trim();
  if (page.sortBy) query.sortBy = page.sortBy;
  if (page.sortOrder) query.sortOrder = page.sortOrder;
  return query;
}

/**
 * Filters read back from a saved search's parameters, or from the record a host keeps them in.
 *
 * Reads the page-provider keys {@link nxsSearchFiltersToSavedParams} and Web UI write
 * (`dc_modified_agg`, `ecm_collections`, …) and the record keys {@link nxsSearchFiltersToRecord}
 * writes, which earlier saved searches also carry, with or without a `defaults:` prefix. Where both
 * are present the page-provider key wins, as the server applies it. A value may be a string, a
 * comma-separated string, a JSON array in a string, or an array, whose entries may be strings,
 * numbers, or objects with a string `id` or `uid` — the collection entries Web UI keeps; anything else
 * is ignored. The earlier `moreThan1YearAgo` range reads as `priorToLastYear`.
 */
export function nxsSearchFiltersFromParams(
  params: Readonly<Record<string, unknown>> | null | undefined,
): NxsSearchFilters {
  const source = params ?? {};
  const raw = (key: string): unknown => {
    for (const candidate of [key, `defaults:${key}`]) {
      const value = source[candidate];
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  };
  const list = (...keys: string[]): string[] => {
    for (const key of keys) {
      const values = toValues(raw(key));
      if (values.length > 0) return uniqueValues(values);
    }
    return [];
  };
  const text = (...keys: string[]): string => {
    for (const key of keys) {
      const value = raw(key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  return {
    query: text('q', 'query'),
    fulltext: text('ecm_fulltext', 'ecmFulltext'),
    modified: uniqueValues(
      list('dc_modified_agg', 'modifiedDate', 'dc_modified').map(
        (value) => MODIFIED_ALIASES[value] ?? value,
      ),
    ),
    authors: list('dc_creator_agg', 'dc_creator', 'author'),
    collections: list('ecm_collections', 'collection_agg', 'collection'),
    tags: list('ecm_tags', 'tag'),
    nature: list('dc_nature_agg', 'nature', 'dc_nature'),
    subjects: list('dc_subjects_agg', 'subjects', 'dc_subjects'),
    coverage: list('dc_coverage_agg', 'coverage', 'dc_coverage'),
    size: list('common_size_agg', 'common_size', 'size'),
  };
}

/** Whether any filter is set. */
export function nxsHasSearchFilters(filters: NxsSearchFilters): boolean {
  return Object.keys(nxsSearchFiltersToRecord(filters)).length > 0;
}

/**
 * Code-unit order, for a key that compares two sets of values rather than an order anyone reads.
 * A locale's collation ties different values (`é` as one character, or as `e` and a combining
 * accent), and a tie keeps the input order, so one set given in two orders would not match.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

/** Whether two sets of filters ask for the same results: the order within a field does not count. */
export function nxsSameSearchFilters(a: NxsSearchFilters, b: NxsSearchFilters): boolean {
  const sorted = (values: readonly string[]) => uniqueValues(values).sort(byCodeUnit);
  const canonical = (filters: NxsSearchFilters) =>
    JSON.stringify([
      filters.query.trim(),
      filters.fulltext.trim(),
      sorted(filters.authors),
      sorted(filters.collections),
      sorted(filters.tags),
      sorted(filters.modified),
      sorted(filters.nature),
      sorted(filters.subjects),
      sorted(filters.coverage),
      sorted(filters.size),
    ]);
  return canonical(a) === canonical(b);
}

/**
 * The choices for a range filter: every range, in order, with the server's count for it.
 *
 * Every range is offered whatever the counts, as Web UI's checkbox aggregation does, so a range that
 * is selected but now empty can still be cleared.
 */
export function nxsRangeOptions(
  ranges: readonly string[],
  aggregation: AggregateResult | undefined,
): NxsFacetOption[] {
  const counts = bucketCounts(aggregation);
  return ranges.map((value) => ({ value, count: counts.get(value) ?? null }));
}

/**
 * The choices for a terms filter: the server's buckets with results, then any selected value the
 * server no longer returns, so it can be cleared.
 */
export function nxsTermOptions(
  aggregation: AggregateResult | undefined,
  selected: readonly string[],
): NxsFacetOption[] {
  const options: NxsFacetOption[] = [];
  const seen = new Set<string>();
  for (const bucket of aggregation?.buckets ?? []) {
    if (!bucket.key || seen.has(bucket.key) || bucket.docCount <= 0) continue;
    seen.add(bucket.key);
    options.push({ value: bucket.key, count: bucket.docCount });
  }
  for (const value of selected) {
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, count: null });
  }
  return options;
}

const MODIFIED_ALIASES: Readonly<Record<string, string>> = { moreThan1YearAgo: 'priorToLastYear' };

function bucketCounts(aggregation: AggregateResult | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bucket of aggregation?.buckets ?? []) counts.set(bucket.key, bucket.docCount);
  return counts;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** The values in a saved parameter: an array, a JSON array in a string, or a comma-separated string. */
function toValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry): string[] => {
      if (typeof entry === 'string' || typeof entry === 'number') return [String(entry)];
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const id = typeof record['id'] === 'string' ? record['id'] : record['uid'];
        if (typeof id === 'string') return [id];
      }
      return [];
    });
  }
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return toValues(parsed);
    } catch {
      // Not JSON: read it as a comma-separated list below.
    }
  }
  return text.split(',');
}
