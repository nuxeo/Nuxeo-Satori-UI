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
  /** One author's username, sent as `dc_creator_agg`. */
  readonly author: string;
  /** One collection's id, sent as `ecm_collections`. */
  readonly collection: string;
  /** One tag label, sent as `ecm_tags`. */
  readonly tag: string;
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
  author: '',
  collection: '',
  tag: '',
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
  put('author', filters.author);
  put('collection', filters.collection);
  put('tag', filters.tag);
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
  const values = (key: string, value: string | readonly string[]) => {
    params[key] = JSON.stringify(uniqueValues(typeof value === 'string' ? [value] : value));
  };
  if (filters.query.trim()) params['q'] = filters.query.trim();
  params['ecm_fulltext'] = filters.fulltext.trim();
  values('dc_modified_agg', filters.modified);
  values('dc_creator_agg', filters.author);
  values('ecm_collections', filters.collection);
  values('ecm_tags', filters.tag);
  values('dc_nature_agg', filters.nature);
  values('dc_subjects_agg', filters.subjects);
  values('dc_coverage_agg', filters.coverage);
  values('common_size_agg', filters.size);
  return params;
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
 * comma-separated string, a JSON array in a string, or an array; anything else is ignored. The
 * earlier `moreThan1YearAgo` range reads as `priorToLastYear`.
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
  const one = (...keys: string[]): string => list(...keys)[0] ?? '';
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
    author: one('dc_creator_agg', 'dc_creator', 'author'),
    collection: one('ecm_collections', 'collection_agg', 'collection'),
    tag: one('ecm_tags', 'tag'),
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

/** Whether two sets of filters ask for the same results: the order within a field does not count. */
export function nxsSameSearchFilters(a: NxsSearchFilters, b: NxsSearchFilters): boolean {
  const sorted = (values: readonly string[]) => uniqueValues(values).sort();
  const canonical = (filters: NxsSearchFilters) =>
    JSON.stringify([
      filters.query.trim(),
      filters.fulltext.trim(),
      filters.author.trim(),
      filters.collection.trim(),
      filters.tag.trim(),
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
    return value
      .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
      .map(String);
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
