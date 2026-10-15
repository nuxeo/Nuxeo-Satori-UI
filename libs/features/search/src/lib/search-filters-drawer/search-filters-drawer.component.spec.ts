import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  NxsSearchFiltersComponent,
  NxsToastService,
} from '@nuxeo-satori/platform/components';
import {
  DirectoryService,
  DocumentDetailService,
  SearchAggregationService,
  SearchService,
  type SearchResponse,
  type SearchResultItem,
} from '@nuxeo-satori/platform/nuxeo-client';

import { SearchSession } from '../search-session/search-session';
import { SearchFiltersDrawerComponent } from './search-filters-drawer.component';

@Component({ standalone: true, template: '' })
class BlankPage {}

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

const item = (over: Partial<SearchResultItem>): SearchResultItem =>
  ({
    id: 'doc-1',
    title: 'Doc',
    type: 'File',
    tags: [],
    icon: 'description',
    ...over,
  }) as SearchResultItem;

describe('SearchFiltersDrawerComponent', () => {
  let fixture: ComponentFixture<SearchFiltersDrawerComponent>;
  let component: SearchFiltersDrawerComponent;
  let router: Router;
  let session: SearchSession;
  const queryParamMap = new BehaviorSubject(convertToParamMap({}));
  const toast = { show: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn() };
  const directoryService = {
    getEntries: vi.fn(() => of([{ id: 'contract', displayLabel: 'Contract' }])),
    getAllL10nEntries: vi.fn(() => of([])),
  };
  const searchService = {
    search: vi.fn((): Observable<SearchResponse> =>
      of({ items: [], aggregations: {}, totalSize: -1, hasNextPage: false }),
    ),
    getSavedSearches: vi.fn(() => of([])),
    getSavedSearchById: vi.fn((): Observable<Record<string, string>> => of({ ecm_fulltext: 'x' })),
    saveSavedSearch: vi.fn((): Observable<unknown> => of({ id: 'ss-1', title: 'Mine' })),
    getUserCollections: vi.fn(() => of([])),
    getTagSuggestions: vi.fn(() => of([])),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    queryParamMap.next(convertToParamMap({}));
    dialog.open.mockReturnValue({ afterClosed: () => of('Mine') });
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    await TestBed.configureTestingModule({
      imports: [SearchFiltersDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([
          { path: 'search', component: BlankPage },
          { path: 'doc/:id', component: BlankPage },
          { path: 'collections/:id', component: BlankPage },
          { path: 'browse/**', component: BlankPage },
          { path: '**', component: BlankPage },
        ]),
        { provide: ActivatedRoute, useValue: { queryParamMap, parent: null } },
        { provide: SearchService, useValue: searchService },
        { provide: DocumentDetailService, useValue: { fetchThumbnail: () => of(null) } },
        { provide: MatDialog, useValue: dialog },
        { provide: DirectoryService, useValue: directoryService },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    session = TestBed.inject(SearchSession);
    TestBed.inject(SearchAggregationService).drawerFilters.set({});
    TestBed.inject(SearchAggregationService).items.set([]);
    fixture = TestBed.createComponent(SearchFiltersDrawerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const path = () => router.url.split('?')[0];

  it('shows the saved searches and the filters, and keeps the shared search running', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nxs-saved-search-select')).not.toBeNull();
    expect(el.querySelector('nxs-search-filters')).not.toBeNull();
    expect(searchService.search).toHaveBeenCalledTimes(1);
  });

  it('writes a change of the filters into the session and shows the results page', async () => {
    await router.navigateByUrl('/doc/abc');
    component.onFiltersChange({ ...NXS_EMPTY_SEARCH_FILTERS, fulltext: 'contract' });
    await fixture.whenStable();
    expect(session.filters().fulltext).toBe('contract');
    expect(path()).toBe('/search');
  });

  it('stays on the results page when already there', async () => {
    await router.navigateByUrl('/search?quickFilters=noFolder');
    const navigate = vi.spyOn(router, 'navigateByUrl');
    component.onFiltersChange(NXS_EMPTY_SEARCH_FILTERS);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('closes the saved search on Reset', () => {
    session.savedSearchId.set('ss-1');
    component.onReset();
    expect(session.savedSearchId()).toBe('');
  });

  it('opens a chosen saved search and shows its results', async () => {
    component.onSavedSearchChosen({ id: 'ss-1', title: 'Mine' });
    await fixture.whenStable();
    expect(searchService.getSavedSearchById).toHaveBeenCalledWith('ss-1');
    expect(session.filters().fulltext).toBe('x');
    expect(path()).toBe('/search');
  });

  it('says so when a chosen saved search cannot be opened', () => {
    searchService.getSavedSearchById.mockReturnValue(of({}));
    component.onSavedSearchChosen({ id: 'ss-1', title: 'Mine' });
    expect(toast.error).toHaveBeenCalledWith('Could not open the saved search.', {
      duration: 5000,
    });
  });

  it('saves the filters under the name given', () => {
    session.setFilters({ ...NXS_EMPTY_SEARCH_FILTERS, size: ['tiny'] });
    component.openSaveAsDialog();
    expect(searchService.saveSavedSearch).toHaveBeenCalledWith({
      title: 'Mine',
      params: { ...EMPTY_SAVED_PARAMS, common_size_agg: '["tiny"]' },
      pageProviderName: 'default_search',
    });
    expect(toast.show).toHaveBeenCalledWith('Search "Mine" saved.');
  });

  it('says so when saving fails', () => {
    searchService.saveSavedSearch.mockReturnValue(throwError(() => ({ status: 500 })));
    component.openSaveAsDialog();
    expect(toast.error).toHaveBeenCalledWith('Failed to save search.', { duration: 5000 });
  });

  it('saves nothing when the name dialog is dismissed', () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    component.openSaveAsDialog();
    expect(searchService.saveSavedSearch).not.toHaveBeenCalled();
  });

  it('hands the filters the vocabulary labels of the nature, subject and coverage facets', () => {
    const filters = fixture.debugElement.query(By.directive(NxsSearchFiltersComponent));
    expect(directoryService.getEntries).toHaveBeenCalledWith('nature', 'en');
    expect(filters.componentInstance.optionLabels()).toEqual({
      nature: { contract: 'Contract' },
      subjects: {},
      coverage: {},
    });
  });

  describe('the queue', () => {
    it('opens the first result when it is entered', async () => {
      TestBed.inject(SearchAggregationService).items.set([
        item({ id: 'first' }),
        item({ id: 'b' }),
      ]);
      component.switchToQueueView();
      await fixture.whenStable();
      expect(component.viewMode()).toBe('queue');
      expect(path()).toBe('/doc/first');
    });

    it('keeps the document already open when it is in the results', async () => {
      await router.navigateByUrl('/doc/b');
      expect(component.selectedDocumentId()).toBe('b');
      TestBed.inject(SearchAggregationService).items.set([item({ id: 'a' }), item({ id: 'b' })]);
      component.switchToQueueView();
      await fixture.whenStable();
      expect(path()).toBe('/doc/b');
    });

    it('opens a collection or a folder where it lives', async () => {
      component.onQueueItemSelected(item({ id: 'c1', type: 'Collection' }));
      await fixture.whenStable();
      expect(path()).toBe('/collections/c1');

      component.onQueueItemSelected(item({ id: 'f1', type: 'Folder', path: '/default-domain/ws' }));
      await fixture.whenStable();
      expect(decodeURIComponent(path())).toBe('/browse/default-domain/ws');
    });

    it('enters nothing with no result', async () => {
      const navigate = vi.spyOn(router, 'navigate');
      component.switchToQueueView();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('toggles a quick filter onto the results page, in a fixed order', async () => {
      component.toggleQueueQuickFilter('onlyValidated');
      component.toggleQueueQuickFilter('noFolder');
      await fixture.whenStable();
      expect(router.url).toBe('/search?quickFilters=noFolder,onlyValidated');
      expect(
        component
          .activeFiltersForQueue()
          .filter((f) => f.selected)
          .map((f) => f.value),
      ).toEqual(['noFolder', 'onlyValidated']);

      component.toggleQueueQuickFilter('noFolder');
      component.toggleQueueQuickFilter('onlyValidated');
      await fixture.whenStable();
      expect(router.url).toBe('/search');
    });

    it('starts the results from the first page when a quick filter is toggled', async () => {
      await router.navigateByUrl('/search?page=3');
      component.toggleQueueQuickFilter('noFolder');
      await fixture.whenStable();
      expect(router.url).toBe('/search?quickFilters=noFolder');
    });

    it('reads the quick filters from the URL, ignoring unknown ones', () => {
      queryParamMap.next(convertToParamMap({ quickFilters: 'mostRecent, bogus' }));
      expect([...component.selectedQueueQuickFilters()]).toEqual(['mostRecent']);
    });

    it('goes back to the filters on the results page', async () => {
      component.viewMode.set('queue');
      component.switchToFilterView();
      await fixture.whenStable();
      expect(component.viewMode()).toBe('filter');
      expect(path()).toBe('/search');
    });
  });
});
