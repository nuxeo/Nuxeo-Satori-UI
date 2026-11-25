import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';
import { NxsSavedSearchSelectComponent, NxsToastService } from '@nuxeo/satori-platform/components';
import {
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  SearchAggregationService,
  SearchService,
  SelectionService,
  type SearchResponse,
} from '@nuxeo/satori-platform/nuxeo-client';

import { SearchComponent } from '../search/search';
import { SearchSession } from '../search-session/search-session';
import { SearchFiltersDrawerComponent } from './search-filters-drawer.component';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class DocumentPage {}

describe('Search drawer route and session integration', () => {
  let harness: RouterTestingHarness;
  let drawer: ComponentFixture<SearchFiltersDrawerComponent>;
  let router: Router;
  let session: SearchSession;
  const selectionService = {
    selectedCount: () => 0,
    cleared$: new Subject<void>(),
    selectAll: vi.fn(),
  };
  const searchService = {
    search: vi.fn((): Observable<SearchResponse> =>
      of({ items: [], aggregations: {}, totalSize: 0, hasNextPage: false }),
    ),
    getSavedSearches: vi.fn(() => of([{ id: 'scope', title: 'Scope' }])),
    getSavedSearchById: vi.fn((): Observable<Record<string, string>> => of({})),
    getUserCollections: () => of([]),
    getTagSuggestions: () => of([]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.overrideProvider(NxsToastService, {
      useValue: { show: vi.fn(), error: vi.fn() },
    });
    await TestBed.configureTestingModule({
      imports: [SearchFiltersDrawerComponent, SearchComponent, MatIconTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([
          { path: 'search', component: SearchComponent },
          { path: 'doc/:id', component: DocumentPage },
          { path: 'collections/:id', component: DocumentPage },
          { path: 'browse/:id', component: DocumentPage },
        ]),
        { provide: SearchService, useValue: searchService },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: DocumentDetailService, useValue: { fetchThumbnail: () => of(null) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: SelectionService, useValue: selectionService },
        { provide: AiGatewayService, useValue: {} },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        { provide: NuxeoApiBase, useValue: {} },
      ],
    })
      // Keep the actual routed component's constructor/effects and URL subscriptions; its
      // result-card presentation is outside this routing regression.
      .overrideComponent(SearchComponent, {
        set: {
          imports: [],
          template:
            '<button type="button" [disabled]="!canReset()" (click)="resetSearch()">Reset</button>',
        },
      })
      .compileComponents();
    router = TestBed.inject(Router);
    session = TestBed.inject(SearchSession);
    harness = await RouterTestingHarness.create();
    drawer = TestBed.createComponent(SearchFiltersDrawerComponent);
    drawer.detectChanges();
    await drawer.whenStable();
  });

  it.each(['searchQueue=true', 'customerView=compact'])(
    'keeps the request and pending Select all when only %s changes',
    async (extraParam) => {
      const url = '/search?quickFilters=onlyValidated&page=3&pageSize=25';
      const page = await harness.navigateByUrl(url, SearchComponent);
      await drawer.whenStable();
      const request = session.request();
      const pending = new Subject<SearchResponse>();
      searchService.search.mockReturnValueOnce(pending);
      page.selectAllResults();
      const requestCount = searchService.search.mock.calls.length;
      expect(page.selectingAll()).toBe(true);

      await harness.navigateByUrl(`${url}&${extraParam}`, SearchComponent);
      await drawer.whenStable();

      expect(session.request()).toEqual(request);
      expect.soft(searchService.search).toHaveBeenCalledTimes(requestCount);
      expect.soft(page.selectingAll()).toBe(true);
      pending.next({ items: [], aggregations: {}, totalSize: 0, hasNextPage: false });
      pending.complete();
      expect(selectionService.selectAll).toHaveBeenCalledWith([], {});
      expect(page.selectingAll()).toBe(false);
    },
  );

  it.each([
    {
      query: 'quickFilters=mostRecent&page=3&pageSize=25',
      expected: { quickFilters: 'mostRecent', pageIndex: 2, pageSize: 25 },
    },
    {
      query: 'quickFilters=onlyValidated&page=4&pageSize=25',
      expected: { quickFilters: 'onlyValidated', pageIndex: 3, pageSize: 25 },
    },
    {
      query: 'quickFilters=onlyValidated&pageSize=50',
      expected: { quickFilters: 'onlyValidated', pageIndex: 0, pageSize: 50 },
    },
  ])('cancels pending Select all for a changed request: $query', async ({ query, expected }) => {
    const page = await harness.navigateByUrl(
      '/search?quickFilters=onlyValidated&page=3&pageSize=25',
      SearchComponent,
    );
    await drawer.whenStable();
    const pending = new Subject<SearchResponse>();
    searchService.search.mockReturnValueOnce(pending);
    page.selectAllResults();
    expect(page.selectingAll()).toBe(true);

    await harness.navigateByUrl(`/search?${query}`, SearchComponent);
    await drawer.whenStable();

    expect(session.request()).toEqual(expected);
    expect(page.selectingAll()).toBe(false);
    pending.next({ items: [], aggregations: {}, totalSize: 0, hasNextPage: false });
    pending.complete();
    expect(selectionService.selectAll).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'enables Reset for customer-only filters after removing packaged filter: %s',
    async (removePackaged) => {
      const filters = removePackaged ? 'noFolder,customerFilter' : 'customerFilter';
      const page = await harness.navigateByUrl(
        `/search?quickFilters=${filters}&page=3&pageSize=25&sortBy=dc:title&sortOrder=asc`,
        SearchComponent,
      );
      await drawer.whenStable();
      if (removePackaged) {
        page.toggleQuickFilter('noFolder');
        await drawer.whenStable();
      }
      harness.detectChanges();

      expect(session.request().quickFilters).toBe('customerFilter');
      expect(page.hasFilters()).toBe(false);
      expect(page.selectedQuickFilters().size).toBe(0);
      const resetButton = harness.routeNativeElement?.querySelector<HTMLButtonElement>('button');
      expect(resetButton).not.toBeNull();
      expect(resetButton?.disabled).toBe(false);
      resetButton?.click();
      await drawer.whenStable();
      harness.detectChanges();

      const query = router.parseUrl(router.url).queryParams;
      expect(query['quickFilters']).toBeUndefined();
      expect(query['page']).toBeUndefined();
      expect(query['pageSize']).toBe('25');
      expect(query['sortBy']).toBe('dc:title');
      expect(query['sortOrder']).toBe('asc');
      expect(session.request().quickFilters).toBeUndefined();
      expect(resetButton?.disabled).toBe(true);
      page.goToPage(1);
      await drawer.whenStable();
      expect(router.parseUrl(router.url).queryParams['quickFilters']).toBeUndefined();
      expect(session.request().quickFilters).toBeUndefined();
    },
  );

  it.each([false, true])(
    'preserves customer URL filters when changing Files from %s',
    async (filesOnly) => {
      const quickFilters = [
        'customerFirst',
        ...(filesOnly ? ['noFolder'] : []),
        'onlyValidated',
        'customerSecond',
        'customerFirst',
      ].join(',');
      await harness.navigateByUrl(
        `/search?quickFilters=${quickFilters}&page=3&pageSize=25&sortBy=dc:title&sortOrder=asc`,
        SearchComponent,
      );
      await drawer.whenStable();

      session.setFilters({ ...session.filters(), filesOnly: !filesOnly });
      await drawer.whenStable();
      const expectedFilters = filesOnly
        ? 'onlyValidated,customerFirst,customerSecond'
        : 'noFolder,onlyValidated,customerFirst,customerSecond';
      const query = router.parseUrl(router.url).queryParams;
      expect(query['quickFilters']).toBe(expectedFilters);
      expect(query['page']).toBeUndefined();
      expect(query['pageSize']).toBe('25');
      expect(query['sortBy']).toBe('dc:title');
      expect(query['sortOrder']).toBe('asc');
      expect(searchService.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          quickFilters: expectedFilters,
          pageIndex: 0,
          pageSize: 25,
          sortBy: 'dc:title',
          sortOrder: 'asc',
        }),
      );
    },
  );

  it('preserves customer URL filters when toggling a packaged quick filter', async () => {
    const page = await harness.navigateByUrl(
      '/search?quickFilters=customerFirst,onlyValidated,customerSecond&page=3&pageSize=25',
      SearchComponent,
    );
    await drawer.whenStable();
    page.toggleQuickFilter('mostRecent');
    await drawer.whenStable();
    const expectedFilters = 'mostRecent,onlyValidated,customerFirst,customerSecond';
    expect(router.parseUrl(router.url).queryParams['quickFilters']).toBe(expectedFilters);
    expect(searchService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ quickFilters: expectedFilters, pageIndex: 0, pageSize: 25 }),
    );
  });

  it('does not restore customer filters removed by a later URL when Files changes', async () => {
    await harness.navigateByUrl(
      '/search?quickFilters=customerFilter,onlyValidated',
      SearchComponent,
    );
    await drawer.whenStable();
    await harness.navigateByUrl('/search?quickFilters=onlyValidated', SearchComponent);
    await drawer.whenStable();

    session.setFilters({ ...session.filters(), filesOnly: true });
    await drawer.whenStable();
    expect(router.parseUrl(router.url).queryParams['quickFilters']).toBe('noFolder,onlyValidated');
    expect(searchService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ quickFilters: 'noFolder,onlyValidated' }),
    );
  });

  it('preserves customer URL filters when clicking a queue item without another search', async () => {
    await harness.navigateByUrl(
      '/doc/first?searchQueue=true&quickFilters=customerFilter,noFolder&page=3&pageSize=25',
      DocumentPage,
    );
    await drawer.whenStable();
    const callsBeforeClick = searchService.search.mock.calls.length;
    TestBed.inject(SearchAggregationService).items.set([
      {
        id: 'next',
        title: 'Next document',
        type: 'File',
        modifiedDate: '',
        lastContributor: '',
        author: '',
        authorKey: '',
        collection: '',
        collectionKey: '',
        tags: [],
        icon: 'page',
      },
    ]);
    drawer.detectChanges();
    const itemButton = drawer.nativeElement.querySelector('.queue-item') as HTMLButtonElement;
    expect(itemButton).not.toBeNull();
    itemButton.click();
    await drawer.whenStable();

    expect(router.url.split('?')[0]).toBe('/doc/next');
    expect(router.parseUrl(router.url).queryParams['quickFilters']).toBe('customerFilter,noFolder');
    expect(searchService.search).toHaveBeenCalledTimes(callsBeforeClick);
  });

  it('preserves customer URL filters when toggling a queue filter', async () => {
    await harness.navigateByUrl(
      '/doc/first?searchQueue=true&quickFilters=noFolder,customerFilter&page=3&pageSize=25',
      DocumentPage,
    );
    await drawer.whenStable();
    drawer.componentInstance.toggleQueueQuickFilter('noFolder');
    await drawer.whenStable();

    expect(router.url.split('?')[0]).toBe('/search');
    expect(router.parseUrl(router.url).queryParams['quickFilters']).toBe('customerFilter');
    expect(searchService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ quickFilters: 'customerFilter', pageIndex: 0, pageSize: 25 }),
    );
  });

  it.each(['/doc/first', '/collections/first', '/browse/first'])(
    'hydrates an initially mounted queue at %s before fetching its results',
    async (path) => {
      drawer.destroy();
      await harness.navigateByUrl(
        `${path}?searchQueue=true&quickFilters=noFolder,onlyValidated,customFilter&page=3&pageSize=25&sortBy=dc:title&sortOrder=asc`,
        DocumentPage,
      );
      drawer = TestBed.createComponent(SearchFiltersDrawerComponent);
      drawer.detectChanges();
      await drawer.whenStable();

      expect(drawer.componentInstance.viewMode()).toBe('queue');
      expect(drawer.componentInstance.selectedQueueQuickFilters()).toEqual(
        new Set(['noFolder', 'onlyValidated']),
      );
      expect(searchService.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          quickFilters: 'noFolder,onlyValidated,customFilter',
          pageIndex: 2,
          pageSize: 25,
          sortBy: 'dc:title',
          sortOrder: 'asc',
        }),
      );
    },
  );

  it('hydrates a direct document queue URL in an already mounted drawer', async () => {
    await harness.navigateByUrl(
      '/doc/first?searchQueue=true&quickFilters=noFolder,onlyValidated&page=3&pageSize=25&sortBy=dc:title&sortOrder=asc',
      DocumentPage,
    );
    await drawer.whenStable();

    expect(drawer.componentInstance.viewMode()).toBe('queue');
    expect(drawer.componentInstance.selectedQueueQuickFilters()).toEqual(
      new Set(['noFolder', 'onlyValidated']),
    );
    expect(searchService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quickFilters: 'noFolder,onlyValidated',
        pageIndex: 2,
        pageSize: 25,
        sortBy: 'dc:title',
        sortOrder: 'asc',
      }),
    );
  });

  it('updates the shared request when queue URL filters and pagination change', async () => {
    await harness.navigateByUrl(
      '/search?quickFilters=noFolder&page=2&pageSize=25&sortBy=dc:title&sortOrder=asc',
      SearchComponent,
    );
    await drawer.whenStable();
    const callsBeforeQueue = searchService.search.mock.calls.length;
    await harness.navigateByUrl(
      '/doc/first?searchQueue=true&quickFilters=noFolder&page=2&pageSize=25&sortBy=dc:title&sortOrder=asc',
      DocumentPage,
    );
    await drawer.whenStable();
    expect(searchService.search).toHaveBeenCalledTimes(callsBeforeQueue);
    await harness.navigateByUrl(
      '/doc/second?searchQueue=true&quickFilters=noFolder&page=2&pageSize=25&sortBy=dc:title&sortOrder=asc',
      DocumentPage,
    );
    await drawer.whenStable();
    expect(searchService.search).toHaveBeenCalledTimes(callsBeforeQueue);
    await harness.navigateByUrl(
      '/doc/next?searchQueue=true&quickFilters=onlyValidated&page=3&pageSize=50&sortBy=dc:modified&sortOrder=desc',
      DocumentPage,
    );
    await drawer.whenStable();

    expect(drawer.componentInstance.selectedQueueQuickFilters()).toEqual(
      new Set(['onlyValidated']),
    );
    expect(searchService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quickFilters: 'onlyValidated',
        pageIndex: 2,
        pageSize: 50,
        sortBy: 'dc:modified',
        sortOrder: 'desc',
      }),
    );
  });

  it.each([
    { pageQuery: '', pageIndex: 0, pageSize: 40 },
    { pageQuery: '&page=-3&pageSize=12&sortOrder=invalid', pageIndex: 0, pageSize: 40 },
    { pageQuery: '&page=invalid&pageSize=100', pageIndex: 0, pageSize: 100 },
  ])('validates queue pagination $pageQuery', async ({ pageQuery, pageIndex, pageSize }) => {
    await harness.navigateByUrl(`/doc/first?searchQueue=true${pageQuery}`, DocumentPage);
    await drawer.whenStable();

    expect(searchService.search).toHaveBeenLastCalledWith({ pageIndex, pageSize });
  });

  it('retains the shared search when visiting a document without a queue', async () => {
    await harness.navigateByUrl(
      '/search?quickFilters=onlyValidated&page=2&pageSize=25&sortBy=dc:title&sortOrder=asc',
      SearchComponent,
    );
    await drawer.whenStable();
    const callsBeforeDocument = searchService.search.mock.calls.length;
    await harness.navigateByUrl('/doc/first', DocumentPage);
    await drawer.whenStable();

    expect(searchService.search).toHaveBeenCalledTimes(callsBeforeDocument);
    expect(session.request()).toEqual({
      quickFilters: 'onlyValidated',
      pageIndex: 1,
      pageSize: 25,
      sortBy: 'dc:title',
      sortOrder: 'asc',
    });
  });

  it.each([
    { filesOnly: true, pageNumber: 1 },
    { filesOnly: true, pageNumber: 3 },
    { filesOnly: false, pageNumber: 1 },
    { filesOnly: false, pageNumber: 3 },
  ])(
    'clears every quick filter on Reset with Files=$filesOnly from page $pageNumber',
    async ({ filesOnly, pageNumber }) => {
      session.setFilters({ ...session.filters(), fulltext: 'applied' });
      const quickFilters = filesOnly
        ? 'noFolder,mostRecent,onlyValidated,customerFilter'
        : 'mostRecent,onlyValidated,customerFilter';
      const page = await harness.navigateByUrl(
        `/search?quickFilters=${quickFilters}&page=${pageNumber}&pageSize=25&sortBy=dc:title&sortOrder=asc`,
        SearchComponent,
      );
      await drawer.whenStable();
      expect(session.pageIndex()).toBe(pageNumber - 1);
      const resetButton = harness.routeNativeElement?.querySelector<HTMLButtonElement>('button');
      expect(resetButton).not.toBeNull();
      resetButton?.click();
      await drawer.whenStable();
      harness.detectChanges();

      const query = router.parseUrl(router.url).queryParams;
      expect(query['quickFilters']).toBeUndefined();
      expect(query['page']).toBeUndefined();
      expect(query['pageSize']).toBe('25');
      expect(query['sortBy']).toBe('dc:title');
      expect(query['sortOrder']).toBe('asc');
      expect(session.filters().fulltext).toBe('');
      expect(session.filters().filesOnly).toBeFalsy();
      expect(session.request().quickFilters).toBeUndefined();
      expect(session.pageIndex()).toBe(0);
      expect(session.dirty()).toBe(false);

      page.goToPage(1);
      await drawer.whenStable();
      expect(router.parseUrl(router.url).queryParams['quickFilters']).toBeUndefined();
      expect(session.request().quickFilters).toBeUndefined();
      expect(session.pageIndex()).toBe(1);
    },
  );

  it.each([
    { previousFiles: true, savedFiles: false },
    { previousFiles: false, savedFiles: true },
  ])(
    'keeps a saved scope and the page reset in the same navigation on page three: $previousFiles → $savedFiles',
    async ({ previousFiles, savedFiles }) => {
      const quickFilters = previousFiles ? 'noFolder,onlyValidated' : 'onlyValidated';
      const page = await harness.navigateByUrl(
        `/search?quickFilters=${quickFilters}&page=3&pageSize=25&sortBy=dc:title`,
        SearchComponent,
      );
      await drawer.whenStable();
      expect(session.pageIndex()).toBe(2);
      searchService.getSavedSearchById.mockReturnValueOnce(
        of({
          ecm_fulltext: 'saved',
          contentViewData: JSON.stringify({ nxsFilesOnly: savedFiles }),
        }),
      );
      page.selectFilterSet('scope', 'Scope');
      await drawer.whenStable();
      harness.detectChanges();
      const query = router.parseUrl(router.url).queryParams;
      expect(query['quickFilters']).toBe(savedFiles ? 'noFolder,onlyValidated' : 'onlyValidated');
      expect(query['page']).toBeUndefined();
      expect(query['pageSize']).toBe('25');
      expect(query['sortBy']).toBe('dc:title');
      expect(!!session.filters().filesOnly).toBe(savedFiles);
      expect(session.request().pageIndex).toBe(0);
      expect(session.dirty()).toBe(false);
    },
  );

  it.each([
    { previousFiles: true, savedFiles: true },
    { previousFiles: true, savedFiles: false },
    { previousFiles: false, savedFiles: true },
    { previousFiles: false, savedFiles: false },
  ])(
    'restores a saved scope from Queue: $previousFiles → $savedFiles',
    async ({ previousFiles, savedFiles }) => {
      const quickFilters = previousFiles ? 'noFolder,onlyValidated' : 'onlyValidated';
      await harness.navigateByUrl(`/search?quickFilters=${quickFilters}`, SearchComponent);
      await drawer.whenStable();
      expect(!!session.filters().filesOnly).toBe(previousFiles);
      await harness.navigateByUrl(
        `/doc/first?quickFilters=${quickFilters}&searchQueue=true&page=3&sortBy=dc:title`,
        DocumentPage,
      );
      await drawer.whenStable();
      expect(drawer.componentInstance.viewMode()).toBe('queue');
      searchService.getSavedSearchById.mockReturnValueOnce(
        of({
          ecm_fulltext: 'saved',
          contentViewData: JSON.stringify({ nxsFilesOnly: savedFiles }),
        }),
      );

      const picker = drawer.debugElement.query(By.directive(NxsSavedSearchSelectComponent));
      picker.componentInstance.selectedChange.emit({ id: 'scope', title: 'Scope' });
      await drawer.whenStable();
      harness.detectChanges();

      expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(SearchComponent);
      expect(router.url).toBe(savedFiles ? '/search?quickFilters=noFolder' : '/search');
      expect(!!session.filters().filesOnly).toBe(savedFiles);
      expect(session.request().quickFilters).toBe(savedFiles ? 'noFolder' : undefined);
      expect(session.request().pageIndex).toBe(0);
      expect(session.request().sortBy).toBeUndefined();
      expect(session.savedSearchId()).toBe('scope');
      expect(session.dirty()).toBe(false);

      // An explicit Queue chip action still takes ownership of the scope after saved hydration.
      await harness.navigateByUrl(
        savedFiles
          ? '/doc/next?searchQueue=true&quickFilters=noFolder'
          : '/doc/next?searchQueue=true',
        DocumentPage,
      );
      await drawer.whenStable();
      drawer.componentInstance.toggleQueueQuickFilter('noFolder');
      await drawer.whenStable();
      harness.detectChanges();
      expect(!!session.filters().filesOnly).toBe(!savedFiles);
      expect(session.request().quickFilters).toBe(savedFiles ? undefined : 'noFolder');
      expect(session.dirty()).toBe(true);
    },
  );
});
