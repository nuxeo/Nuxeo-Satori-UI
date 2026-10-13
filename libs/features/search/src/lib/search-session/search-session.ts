import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  type Observable,
  catchError,
  combineLatest,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  nxsHasSearchFilters,
  nxsSameSearchFilters,
  nxsSearchFiltersFromParams,
  nxsSearchFiltersToQuery,
  nxsSearchFiltersToRecord,
  nxsSearchFiltersToSavedParams,
  type NxsSearchFilters,
} from '@nuxeo-satori/platform/components';
import {
  SearchAggregationService,
  SearchService,
  type SearchAggregations,
  type SearchQueryParams,
  type SearchResultItem,
} from '@nuxeo-satori/platform/nuxeo-client';

/** The page provider every search here runs, and every saved search is saved against. */
export const SEARCH_PAGE_PROVIDER = 'default_search';

/** The part of the query the search page keeps in its URL. */
export interface SearchPageQuery {
  readonly quickFilters: string;
  readonly sortBy: string | null;
  readonly sortOrder: 'asc' | 'desc' | null;
}

/** Where the search for the current query is: running, answered, or failed. */
export interface SearchResultsState {
  readonly status: 'loading' | 'loaded' | 'failed';
  readonly items: readonly SearchResultItem[];
  readonly aggregations: SearchAggregations;
  /** The request's error, when it failed. */
  readonly error: unknown;
}

const LOADING: SearchResultsState = { status: 'loading', items: [], aggregations: {}, error: null };
const EMPTY_PAGE_QUERY: SearchPageQuery = { quickFilters: '', sortBy: null, sortOrder: null };

const samePageQuery = (a: SearchPageQuery, b: SearchPageQuery) =>
  a.quickFilters === b.quickFilters && a.sortBy === b.sortBy && a.sortOrder === b.sortOrder;

/**
 * The one search for the current query, and the saved search it came from.
 *
 * The search page, the filters drawer and its queue all show the same results, so they share this
 * rather than each sending the query: one change of the filters is one request. The results carry
 * the server's aggregates, which give the filters their counts, so the drawer sends no request of
 * its own. The request runs while something subscribes to {@link results$}, and is shared by
 * everything that does.
 */
@Injectable({ providedIn: 'root' })
export class SearchSession {
  private readonly searchService = inject(SearchService);
  private readonly shared = inject(SearchAggregationService);

  /** The filters, kept in `SearchAggregationService.drawerFilters` as before. */
  readonly filters = computed<NxsSearchFilters>(() =>
    nxsSearchFiltersFromParams(this.shared.drawerFilters()),
  );
  readonly hasFilters = computed(() => nxsHasSearchFilters(this.filters()));

  private readonly pageQuery = signal<SearchPageQuery>(EMPTY_PAGE_QUERY, { equal: samePageQuery });
  private readonly attempt = signal(0);

  /** The request the current filters, quick filters and sort make. */
  readonly request = computed<SearchQueryParams>(() =>
    nxsSearchFiltersToQuery(this.filters(), this.pageQuery()),
  );

  readonly results$: Observable<SearchResultsState> = combineLatest([
    toObservable(this.request),
    toObservable(this.attempt),
  ]).pipe(
    switchMap(([request]) =>
      this.searchService.search(request).pipe(
        map((response): SearchResultsState => ({
          status: 'loaded',
          items: response.items,
          aggregations: response.aggregations,
          error: null,
        })),
        catchError((error: unknown) =>
          of<SearchResultsState>({ status: 'failed', items: [], aggregations: {}, error }),
        ),
        startWith(LOADING),
      ),
    ),
    tap((state) => {
      if (state.status === 'loading') return;
      this.shared.items.set([...state.items]);
      this.shared.aggregations.set(state.aggregations);
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly savedSearchId = this.shared.selectedSavedSearchId;
  readonly savedSearchTitle = this.shared.selectedSavedSearchTitle;
  /** Bumped whenever the list of saved searches changes. */
  readonly savedSearchesVersion = this.shared.savedSearchVersion;
  /** The open saved search's filters as the server holds them. */
  private readonly savedFilters = signal<NxsSearchFilters | null>(null);

  /**
   * Whether the filters differ from the open saved search's — or, with none open, whether any is
   * set. What Web UI calls dirty: it decides whether Save is offered.
   */
  readonly dirty = computed(() => {
    const saved = this.savedFilters();
    if (!this.savedSearchId().trim()) return this.hasFilters();
    // Still being read: nothing to compare against yet.
    return saved !== null && !nxsSameSearchFilters(saved, this.filters());
  });

  setFilters(filters: NxsSearchFilters): void {
    this.shared.drawerFilters.set(nxsSearchFiltersToRecord(filters));
  }

  /** The search page's URL changed: its quick filters and sort are part of the query. */
  setPageQuery(query: SearchPageQuery): void {
    this.pageQuery.set(query);
  }

  /** Runs the current query again. */
  retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  /** Clears the filters and closes the open saved search. */
  reset(): void {
    this.closeSavedSearch();
    this.setFilters(NXS_EMPTY_SEARCH_FILTERS);
  }

  /** Forgets the open saved search, keeping the filters. */
  closeSavedSearch(): void {
    this.savedSearchId.set('');
    this.savedSearchTitle.set('');
    this.savedFilters.set(null);
  }

  /**
   * Opens a saved search: reads its filters from the server and applies them. Fails, leaving the
   * filters as they were and no saved search open, when the search cannot be read.
   */
  openSavedSearch(id: string, title: string): Observable<void> {
    this.savedSearchId.set(id);
    this.savedSearchTitle.set(title);
    this.savedFilters.set(null);
    return this.searchService.getSavedSearchById(id).pipe(
      map((params) => {
        // `getSavedSearchById` answers a failed read with no parameters at all; a saved search
        // always has some, since none is saved without a filter and Web UI writes every key.
        if (Object.keys(params).length === 0)
          throw new Error(`Saved search ${id} could not be read`);
        return params;
      }),
      map((params) => {
        // A late answer for a search the user has already left is dropped.
        if (this.savedSearchId() !== id) return;
        const filters = nxsSearchFiltersFromParams(params);
        this.savedFilters.set(filters);
        this.setFilters(filters);
      }),
      catchError((error: unknown) => {
        if (this.savedSearchId() === id) this.closeSavedSearch();
        throw error;
      }),
    );
  }

  /** Saves the filters as a new saved search, and opens it. */
  saveAs(title: string): Observable<void> {
    const filters = this.filters();
    return this.searchService
      .saveSavedSearch({
        title,
        params: nxsSearchFiltersToSavedParams(filters),
        pageProviderName: SEARCH_PAGE_PROVIDER,
      })
      .pipe(
        map((saved) => {
          const record = (saved ?? {}) as Record<string, unknown>;
          const id = typeof record['id'] === 'string' ? record['id'] : '';
          this.savedSearchId.set(id);
          this.savedSearchTitle.set(
            typeof record['title'] === 'string' && record['title'] ? record['title'] : title,
          );
          this.savedFilters.set(id ? filters : null);
          this.shared.markSavedSearchDirty();
        }),
      );
  }

  /** Saves the filters into the open saved search. */
  save(): Observable<void> {
    const id = this.savedSearchId().trim();
    if (!id) return of(undefined);
    const filters = this.filters();
    return this.searchService
      .updateSavedSearch(id, {
        title: this.savedSearchTitle(),
        params: nxsSearchFiltersToSavedParams(filters),
        pageProviderName: SEARCH_PAGE_PROVIDER,
      })
      .pipe(
        map(() => {
          if (this.savedSearchId() === id) this.savedFilters.set(filters);
        }),
      );
  }

  /** Renames the open saved search; its stored filters are left as they are. */
  rename(title: string): Observable<void> {
    const id = this.savedSearchId().trim();
    if (!id) return of(undefined);
    return this.searchService.renameSavedSearch(id, title, SEARCH_PAGE_PROVIDER).pipe(
      map(() => {
        if (this.savedSearchId() === id) this.savedSearchTitle.set(title);
        this.shared.markSavedSearchDirty();
      }),
    );
  }

  /** Deletes the open saved search, and clears the filters it had applied. */
  deleteSavedSearch(): Observable<void> {
    const id = this.savedSearchId().trim();
    if (!id) return of(undefined);
    return this.searchService.deleteSavedSearch(id).pipe(
      map(() => {
        if (this.savedSearchId() === id) this.reset();
        this.shared.markSavedSearchDirty();
      }),
    );
  }
}
