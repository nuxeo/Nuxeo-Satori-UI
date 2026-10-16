import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { NXS_EMPTY_SEARCH_FILTERS } from '@nuxeo/satori-platform/components';
import {
  SearchAggregationService,
  SearchService,
  type SearchResponse,
  type SearchResultItem,
} from '@nuxeo/satori-platform/nuxeo-client';

import { SearchSession, type SearchResultsState } from './search-session';

/** A saved search's params with no filter set: every parameter written, empty. */
const EMPTY_SAVED_PARAMS: Record<string, string> = {
  ecm_fulltext: '',
  dc_modified_agg: '[]',
  dc_creator_agg: '[]',
  ecm_collections: '[]',
  ecm_tags: '[]',
  dc_nature_agg: '[]',
  dc_subjects_agg: '[]',
  dc_coverage_agg: '[]',
  common_size_agg: '[]',
};

const item = (id: string): SearchResultItem =>
  ({ id, title: id, type: 'File', tags: [], icon: 'description' }) as unknown as SearchResultItem;

describe('SearchSession', () => {
  let session: SearchSession;
  const search = vi.fn((_request?: unknown): Observable<SearchResponse> =>
    of({ items: [], aggregations: {}, totalSize: -1, hasNextPage: false }),
  );
  const searchService = {
    search,
    getSavedSearchById: vi.fn((_id?: string): Observable<Record<string, string>> => of({})),
    saveSavedSearch: vi.fn((_request?: unknown): Observable<unknown> => of({ id: 'ss-new' })),
    updateSavedSearch: vi.fn((_id?: string, _request?: unknown): Observable<unknown> => of({})),
    renameSavedSearch: vi.fn((_id?: string, _title?: string): Observable<unknown> => of({})),
    deleteSavedSearch: vi.fn((_id?: string): Observable<unknown> => of(undefined)),
  };
  const shared = {
    drawerFilters: signal<Record<string, string>>({}),
    items: signal<SearchResultItem[]>([]),
    aggregations: signal({}),
    selectedSavedSearchId: signal(''),
    selectedSavedSearchTitle: signal(''),
    savedSearchVersion: signal(0),
    markSavedSearchDirty: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    search.mockReturnValue(of({ items: [], aggregations: {}, totalSize: -1, hasNextPage: false }));
    shared.drawerFilters.set({});
    shared.items.set([]);
    shared.selectedSavedSearchId.set('');
    shared.selectedSavedSearchTitle.set('');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SearchService, useValue: searchService },
        { provide: SearchAggregationService, useValue: shared },
      ],
    });
    session = TestBed.inject(SearchSession);
  });

  /** Subscribes to the results and collects every state, until `stop` is called. */
  function watch(): { states: SearchResultsState[]; stop: () => void } {
    const states: SearchResultsState[] = [];
    const subscription = session.results$.subscribe((state) => states.push(state));
    return { states, stop: () => subscription.unsubscribe() };
  }

  const flush = () => TestBed.tick();

  describe('the one search', () => {
    it('sends nothing until something subscribes, then one request shared by every subscriber', () => {
      flush();
      expect(search).not.toHaveBeenCalled();

      const first = watch();
      const second = watch();
      flush();

      expect(search).toHaveBeenCalledTimes(1);
      expect(second.states.at(-1)?.status).toBe('loaded');
      first.stop();
      second.stop();
    });

    it('builds the request from the filters and the page’s quick filters and sort', () => {
      const { stop } = watch();
      session.setFilters({ ...NXS_EMPTY_SEARCH_FILTERS, fulltext: 'contract', size: ['tiny'] });
      session.setPageQuery({ quickFilters: 'noFolder', sortBy: 'dc:title', sortOrder: 'asc' });
      flush();

      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][0]).toEqual({
        ecmFulltext: 'contract',
        size: '["tiny"]',
        quickFilters: 'noFolder',
        sortBy: 'dc:title',
        sortOrder: 'asc',
        pageIndex: 0,
        pageSize: 40,
      });
      stop();
    });

    it('sends nothing more for the same page query set again', () => {
      const { stop } = watch();
      session.setPageQuery({ quickFilters: '', sortBy: null, sortOrder: null });
      flush();
      session.setPageQuery({ quickFilters: '', sortBy: null, sortOrder: null });
      flush();
      expect(search).toHaveBeenCalledTimes(1);
      stop();
    });

    it('runs the search again for each change of the filters, Enter on the same term included', () => {
      const { stop } = watch();
      flush();
      session.setFilters({ ...NXS_EMPTY_SEARCH_FILTERS, fulltext: 'a' });
      flush();
      session.setFilters({ ...NXS_EMPTY_SEARCH_FILTERS, fulltext: 'a' });
      flush();
      expect(search).toHaveBeenCalledTimes(3);
      stop();
    });

    it('reports loading, then the answer, and publishes it to the shared state', () => {
      const answer = new Subject<SearchResponse>();
      search.mockReturnValue(answer.asObservable());
      const { states, stop } = watch();
      flush();
      expect(states.at(-1)?.status).toBe('loading');

      answer.next({
        items: [item('a')],
        aggregations: { dc_nature_agg: { buckets: [{ key: 'x', docCount: 1 }] } },
        totalSize: 25,
        hasNextPage: true,
      });
      expect(states.at(-1)).toMatchObject({
        status: 'loaded',
        error: null,
        totalSize: 25,
        hasNextPage: true,
      });
      expect(shared.items().map((entry) => entry.id)).toEqual(['a']);
      expect(shared.aggregations()).toEqual({
        dc_nature_agg: { buckets: [{ key: 'x', docCount: 1 }] },
      });
      stop();
    });

    it('reports a failure with its error, and clears the shared state', () => {
      shared.items.set([item('stale')]);
      search.mockReturnValue(throwError(() => ({ status: 403 })));
      const { states, stop } = watch();
      flush();
      expect(states.at(-1)).toEqual({
        status: 'failed',
        items: [],
        aggregations: {},
        totalSize: -1,
        hasNextPage: false,
        error: { status: 403 },
      });
      expect(shared.items()).toEqual([]);
      stop();
    });

    it('runs the same request again on retry', () => {
      const { stop } = watch();
      flush();
      session.retry();
      flush();
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1][0]).toEqual(search.mock.calls[0][0]);
      stop();
    });
  });

  describe('saved searches', () => {
    it('opens one: reads its filters, applies them, and is not dirty', async () => {
      searchService.getSavedSearchById.mockReturnValue(
        of({ ecm_fulltext: 'invoice', dc_nature_agg: '["contract"]' }),
      );
      await firstValueFrom(session.openSavedSearch('ss-1', 'Mine'), { defaultValue: undefined });

      expect(session.savedSearchId()).toBe('ss-1');
      expect(session.savedSearchTitle()).toBe('Mine');
      expect(session.filters()).toMatchObject({ fulltext: 'invoice', nature: ['contract'] });
      expect(session.dirty()).toBe(false);

      session.setFilters({ ...session.filters(), nature: [] });
      expect(session.dirty()).toBe(true);
    });

    it('starts an open saved search from the first page, even when its filters already match', async () => {
      const params = { ecm_fulltext: 'invoice', dc_nature_agg: '["contract"]' };
      searchService.getSavedSearchById.mockReturnValue(of(params));
      await firstValueFrom(session.openSavedSearch('ss-1', 'Mine'), { defaultValue: undefined });
      session.setPageIndex(2);

      // The filters on screen already match the saved search: `setFilters` alone would keep page 3.
      shared.drawerFilters.set(params);
      await firstValueFrom(session.openSavedSearch('ss-1', 'Mine'), { defaultValue: undefined });

      expect(session.pageIndex()).toBe(0);
    });

    it('is not dirty while the saved search is still being read', () => {
      searchService.getSavedSearchById.mockReturnValue(new Subject<Record<string, string>>());
      session.openSavedSearch('ss-1', 'Mine').subscribe();
      shared.drawerFilters.set({ ecm_fulltext: 'anything' });
      expect(session.dirty()).toBe(false);
    });

    it('fails, closing the saved search and keeping the filters, when it cannot be read', async () => {
      shared.drawerFilters.set({ ecm_fulltext: 'kept' });
      searchService.getSavedSearchById.mockReturnValue(of({}));

      await expect(firstValueFrom(session.openSavedSearch('ss-1', 'Mine'))).rejects.toThrow();
      expect(session.savedSearchId()).toBe('');
      expect(session.filters().fulltext).toBe('kept');
    });

    it('drops a late answer for a search the user has left', () => {
      const late = new Subject<Record<string, string>>();
      searchService.getSavedSearchById.mockReturnValueOnce(late.asObservable());
      session.openSavedSearch('ss-1', 'First').subscribe();
      searchService.getSavedSearchById.mockReturnValueOnce(of({ ecm_fulltext: 'second' }));
      session.openSavedSearch('ss-2', 'Second').subscribe();

      late.next({ ecm_fulltext: 'first' });
      expect(session.savedSearchId()).toBe('ss-2');
      expect(session.filters().fulltext).toBe('second');
    });

    it('with none open, is dirty exactly when a filter is set', () => {
      expect(session.dirty()).toBe(false);
      shared.drawerFilters.set({ size: 'tiny' });
      expect(session.dirty()).toBe(true);
    });

    it('saves as: writes the page provider’s names, opens the new search, refreshes the list', async () => {
      shared.drawerFilters.set({ subjects: '["art"]' });
      searchService.saveSavedSearch.mockReturnValue(of({ id: 'ss-9', title: 'Kept title' }));

      await firstValueFrom(session.saveAs('Typed title'));

      expect(searchService.saveSavedSearch).toHaveBeenCalledWith({
        title: 'Typed title',
        params: { ...EMPTY_SAVED_PARAMS, dc_subjects_agg: '["art"]' },
        pageProviderName: 'default_search',
      });
      expect(session.savedSearchId()).toBe('ss-9');
      expect(session.savedSearchTitle()).toBe('Kept title');
      expect(session.dirty()).toBe(false);
      expect(shared.markSavedSearchDirty).toHaveBeenCalled();
    });

    it('saves as with the typed title when the answer has none, and opens nothing without an id', async () => {
      searchService.saveSavedSearch.mockReturnValue(of('created'));
      shared.drawerFilters.set({ ecm_fulltext: 'x' });
      await firstValueFrom(session.saveAs('Typed'));
      expect(session.savedSearchId()).toBe('');
      expect(session.savedSearchTitle()).toBe('Typed');
      // No id to compare against, so whether to offer Save falls back to "is anything set".
      expect(session.dirty()).toBe(true);
    });

    it('saves into the open search, then is not dirty', async () => {
      shared.selectedSavedSearchId.set('ss-1');
      shared.selectedSavedSearchTitle.set('Mine');
      shared.drawerFilters.set({ ecm_fulltext: 'new' });

      await firstValueFrom(session.save());

      expect(searchService.updateSavedSearch).toHaveBeenCalledWith('ss-1', {
        title: 'Mine',
        params: { ...EMPTY_SAVED_PARAMS, ecm_fulltext: 'new' },
        pageProviderName: 'default_search',
      });
      expect(session.dirty()).toBe(false);
    });

    it('clears the old names a search was saved under, so a removed author stays removed', async () => {
      searchService.getSavedSearchById.mockReturnValue(
        of({ author: 'alice', ecm_fulltext: 'x', dc_creator_agg: '' }),
      );
      await firstValueFrom(session.openSavedSearch('ss-1', 'Old'), { defaultValue: undefined });
      expect(session.filters().authors).toEqual(['alice']);

      session.setFilters({ ...session.filters(), authors: [] });
      await firstValueFrom(session.save());

      const sent = searchService.updateSavedSearch.mock.calls.at(-1)?.[1] as {
        params: Record<string, string>;
      };
      expect(sent.params['dc_creator_agg']).toBe('[]');
      expect(sent.params['author']).toBe('');
      expect(session.dirty()).toBe(false);
    });

    it('renames, deletes and saves nothing with no search open', async () => {
      await firstValueFrom(session.save(), { defaultValue: undefined });
      await firstValueFrom(session.rename('x'), { defaultValue: undefined });
      await firstValueFrom(session.deleteSavedSearch(), { defaultValue: undefined });
      expect(searchService.updateSavedSearch).not.toHaveBeenCalled();
      expect(searchService.renameSavedSearch).not.toHaveBeenCalled();
      expect(searchService.deleteSavedSearch).not.toHaveBeenCalled();
    });

    it('renames without touching the stored filters, and refreshes the list', async () => {
      shared.selectedSavedSearchId.set('ss-1');
      shared.selectedSavedSearchTitle.set('Old');

      await firstValueFrom(session.rename('New'));

      expect(searchService.renameSavedSearch).toHaveBeenCalledWith('ss-1', 'New', 'default_search');
      expect(session.savedSearchTitle()).toBe('New');
      expect(shared.markSavedSearchDirty).toHaveBeenCalled();
    });

    it('deletes the open search and clears its filters', async () => {
      shared.selectedSavedSearchId.set('ss-1');
      shared.drawerFilters.set({ ecm_fulltext: 'x' });

      await firstValueFrom(session.deleteSavedSearch());

      expect(searchService.deleteSavedSearch).toHaveBeenCalledWith('ss-1');
      expect(session.savedSearchId()).toBe('');
      expect(shared.drawerFilters()).toEqual({});
    });

    it('keeps the search the user moved to when an earlier delete answers', () => {
      const answer = new Subject<unknown>();
      searchService.deleteSavedSearch.mockReturnValue(answer.asObservable());
      shared.selectedSavedSearchId.set('ss-1');
      session.deleteSavedSearch().subscribe();
      shared.selectedSavedSearchId.set('ss-2');
      shared.drawerFilters.set({ ecm_fulltext: 'other' });

      answer.next(undefined);
      expect(session.savedSearchId()).toBe('ss-2');
      expect(session.filters().fulltext).toBe('other');
    });

    it('resets: no saved search, no filter', () => {
      shared.selectedSavedSearchId.set('ss-1');
      shared.drawerFilters.set({ ecm_fulltext: 'x' });
      session.reset();
      expect(session.savedSearchId()).toBe('');
      expect(shared.drawerFilters()).toEqual({});
    });
  });
});
