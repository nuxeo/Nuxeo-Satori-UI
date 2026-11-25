export interface NuxeoPaginatedList<T> {
  entries: T[];
  totalSize: number;
  resultsCount?: number;
  /**
   * A limit the server reports with its count, which means one thing or another by what serves the
   * list. A page provider the search index serves reports the index's `max_result_window`, 10,000
   * by default, and still counts past it; the repository reports `0` for none, or the limit it
   * counts to, past which `resultsCount` is `-2`. `resultWindow` reads which.
   */
  resultsCountLimit?: number;
  currentPageSize: number;
  currentPageIndex: number;
  numberOfPages: number;
  /**
   * Whether another page exists.
   *
   * The fact to build a pager on. For a document's children (`@children`), Nuxeo counts only within
   * `resultsCountLimit`, which it sets to the requested `pageSize`, so `resultsCount` is a real
   * total **only when the result set fits on one page**. That is not true of every provider:
   * `default_search` reports its exact total across pages (measured on 25 matches with page sizes
   * 10, 20 and 40, and on 50 with 40). Check the provider before assuming either. This flag is
   * accurate either way.
   */
  isNextPageAvailable?: boolean;
}
