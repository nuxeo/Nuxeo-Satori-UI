export interface NuxeoPaginatedList<T> {
  entries: T[];
  totalSize: number;
  resultsCount?: number;
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
