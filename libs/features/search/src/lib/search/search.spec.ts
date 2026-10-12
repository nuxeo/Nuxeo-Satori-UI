import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { SearchComponent } from './search';
import {
  DocumentDetailService,
  type SearchResultItem,
  NuxeoApiBase,
  SearchAggregationService,
  SearchService,
  SelectionService,
} from '@nuxeo-satori/platform/nuxeo-client';
import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { NxsToastService } from '@nuxeo-satori/platform/components';

type SearchResponseLike = { items: SearchResultItem[]; aggregations: Record<string, unknown> };

const mockSearchService = {
  search: vi.fn((_request?: Record<string, unknown>): Observable<SearchResponseLike> =>
    of({ items: [], aggregations: {} }),
  ),
  // The parameter is declared even though the stub ignores it: a zero-arg signature types
  // `mock.calls[0]` as an empty tuple, so `calls[0][0]` — which the save assertions read — does not
  // typecheck.
  saveSavedSearch: vi.fn(
    (_request?: Record<string, unknown>): Observable<Record<string, unknown>> => of({ id: 'ss-1' }),
  ),
  updateSavedSearch: vi.fn((): Observable<Record<string, unknown>> => of({ id: 'ss-1' })),
  deleteSavedSearch: vi.fn((): Observable<void> => of(undefined)),
};

const mockSearchAggregationService = {
  drawerFilters: signal<Record<string, string>>({}),
  aggregations: signal<Record<string, unknown>>({}),
  items: signal<SearchResultItem[]>([]),
  selectedSavedSearchId: signal(''),
  selectedSavedSearchTitle: signal(''),
  markSavedSearchDirty: vi.fn(),
};

const mockDocumentDetailService = {
  fetchThumbnail: vi.fn((): Observable<Blob | null> => of(null)),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob())),
  addToFavorites: vi.fn((): Observable<void> => of(undefined)),
  removeFromFavorites: vi.fn((): Observable<void> => of(undefined)),
};

// Full surface declared up front, with explicit return types. `vi.fn(() => of(null))`
// infers `Observable<null>`, and TypeScript fixes an object literal's shape at declaration —
// so both `mockReturnValue(of(aDocument))` and a later `mock.someMethod = vi.fn()` fail to
// typecheck. Neither shows up under `nx test`, which strips types through esbuild.
const mockSelectionService = {
  selectedCount: vi.fn(() => 0),
  isAllSelected: vi.fn(() => false),
  isIndeterminate: vi.fn(() => false),
  isSelected: vi.fn(() => false),
  toggle: vi.fn(),
  clear: vi.fn(),
  forgetPreviews: vi.fn(),
  selectAll: vi.fn(),
  deleteSelected: vi.fn((): Observable<void> => of(undefined)),
};

const mockAiGatewayService = {
  nlToNxqlSuggestions: vi.fn(() => of({ suggestions: [] })),
  nlToNxql: vi.fn(),
};

const mockAiFeatureFlagService = {
  aiEnabled: signal(true),
};

/**
 * The return type is annotated rather than inferred. `of({ entries: [] })` infers
 * `Observable<{ entries: never[] }>`, so every test that feeds the mock a real entry failed
 * to typecheck — and Vitest strips types, so the suite stayed green while `spec-typecheck`
 * was red and blocked the gate for unrelated pull requests.
 */
const mockNuxeoApiBase = {
  nxqlSearch: vi.fn((): Observable<{ entries: { uid: string; title: string }[] }> =>
    of({ entries: [] }),
  ),
};

/**
 * Complete fixtures, not partial objects cast into place.
 *
 * `{ id, type, title } as SearchResultItem` does not compile without `as unknown as`, and
 * forcing it through would defeat the point: the cast would keep compiling if the type gained
 * a required field, so the fixture would drift away from what the component is really handed.
 * Filling every field costs a few lines once and keeps these tests honest.
 */
function resultItem(over: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    id: 'doc1',
    title: 'Test Doc',
    type: 'File',
    modifiedDate: '2026-08-24',
    lastContributor: 'admin',
    state: 'project',
    version: '1.0',
    createdDate: '2026-08-20',
    author: 'admin',
    authorKey: 'admin',
    nature: 'article',
    coverage: 'global',
    subjects: 'test',
    collection: '',
    collectionKey: '',
    tags: [],
    flags: '',
    icon: 'description',
    isFavorite: false,
    ...over,
  } as SearchResultItem;
}

const mockDialog = {
  open: vi.fn((..._args: unknown[]): { afterClosed: () => Observable<unknown> } => ({
    afterClosed: () => of(undefined),
  })),
};

const toast = { show: vi.fn(), error: vi.fn() };

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;
  /** The component's own row view-model, kept tied to the component rather than restated. */
  type Row = ReturnType<typeof SearchComponent.prototype.displayResults>[number];

  function row(over: Partial<Row> = {}): Row {
    return {
      id: 'doc1',
      name: 'Test Doc',
      imageUrl: 'images/Login-background.svg',
      type: 'File',
      modifiedDate: '2026-08-24',
      lastContributor: 'admin',
      state: 'project',
      version: '1.0',
      createdDate: '2026-08-20',
      author: 'admin',
      nature: 'article',
      coverage: 'global',
      subjects: 'test,demo',
      flags: 'urgent',
      icon: 'description',
      ...over,
    } as Row;
  }

  /**
   * jsdom implements neither `URL.createObjectURL` nor `revokeObjectURL`, and both the CSV
   * export and the download path use them. Left unstubbed those paths throw as *unhandled*
   * errors, which Vitest flags as possible false positives — the test passes while the code
   * under it blows up.
   *
   * Installed once at describe scope and never restored: TestBed's fixture cleanup runs after an
   * `afterEach` hook, so putting `undefined` back makes destruction throw. The counters let
   * create/revoke be asserted as a PAIR, which is the only way to catch a leak.
   */
  const created: string[] = [];
  const revoked: string[] = [];
  let lastBlob: Blob | null = null;
  let blobSeq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:mock/${(blobSeq += 1)}`;
    created.push(url);
    // The Blob is stashed because `exportCsv` builds it, hands it straight to
    // `createObjectURL` and drops the reference — this is the only seam to read the generated
    // CSV from. Its contents are readable only asynchronously, hence `await blob.text()` in the
    // tests rather than a synchronous capture here.
    lastBlob = blob;
    return url;
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });

  /** Rebuild the TestBed with a given query-param map. */
  async function configure(queryParams: Record<string, string> = {}): Promise<void> {
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    await TestBed.configureTestingModule({
      // `resetTestingModule()` in three of these tests discards what test-setup.ts provides
      // globally, and the component now injects TranslateService for the saved-search dialog
      // placeholder.
      imports: [SearchComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(queryParams)) },
        },
        { provide: SearchService, useValue: mockSearchService },
        { provide: SearchAggregationService, useValue: mockSearchAggregationService },
        { provide: DocumentDetailService, useValue: mockDocumentDetailService },
        { provide: SelectionService, useValue: mockSelectionService },
        { provide: AiGatewayService, useValue: mockAiGatewayService },
        { provide: AiFeatureFlagService, useValue: mockAiFeatureFlagService },
        { provide: NuxeoApiBase, useValue: mockNuxeoApiBase },
        { provide: MatDialog, useValue: mockDialog },
      ],
    })
      .overrideComponent(SearchComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    created.length = 0;
    revoked.length = 0;
    lastBlob = null;
    // `clearAllMocks` clears call history but NOT a `mockReturnValue` implementation, so every
    // override a test installs must be reset here or it leaks into later tests.
    mockSearchService.search.mockReturnValue(of({ items: [], aggregations: {} }));
    mockDocumentDetailService.fetchThumbnail.mockReturnValue(of(null));
    mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
    mockSearchAggregationService.drawerFilters.set({});
    mockSearchAggregationService.aggregations.set({});
    mockSearchAggregationService.items.set([]);

    TestBed.overrideProvider(NxsToastService, { useValue: toast });

    await TestBed.configureTestingModule({
      // `resetTestingModule()` in three of these tests discards what test-setup.ts provides
      // globally, and the component now injects TranslateService for the saved-search dialog
      // placeholder.
      imports: [SearchComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: SearchService, useValue: mockSearchService },
        { provide: SearchAggregationService, useValue: mockSearchAggregationService },
        { provide: DocumentDetailService, useValue: mockDocumentDetailService },
        { provide: SelectionService, useValue: mockSelectionService },
        { provide: AiGatewayService, useValue: mockAiGatewayService },
        { provide: AiFeatureFlagService, useValue: mockAiFeatureFlagService },
        { provide: NuxeoApiBase, useValue: mockNuxeoApiBase },
        { provide: MatDialog, useValue: mockDialog },
      ],
    })
      .overrideComponent(SearchComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('thumbnail lifecycle', () => {
    it('revokes the previous batch before loading a new one', () => {
      mockDocumentDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['thumb'])));

      component['beginThumbnailBatch']();
      component['loadThumbnails']([resultItem({ id: 'doc1' })]);
      // Same reason as the destroy test below: `blobSeq` is not reset between tests, so the URLs are
      // read back rather than named. This one passed only because it runs first.
      const first = created[0];
      expect(component.thumbnailMap()['doc1']).toBe(first);

      component['beginThumbnailBatch']();
      component['loadThumbnails']([resultItem({ id: 'doc2' })]);

      const second = created[1];
      expect(revoked).toContain(first);
      expect(component.thumbnailMap()).toEqual({ doc2: second });
    });

    it('ignores stale thumbnail responses from an older batch', () => {
      const thumbs = new Subject<Blob | null>();
      mockDocumentDetailService.fetchThumbnail.mockReturnValue(thumbs.asObservable());

      component['beginThumbnailBatch']();
      component['loadThumbnails']([resultItem({ id: 'doc1' })]);
      component['beginThumbnailBatch']();
      component['loadThumbnails']([]);

      thumbs.next(new Blob(['late']));
      thumbs.complete();

      expect(created).toHaveLength(0);
      expect(component.thumbnailMap()).toEqual({});
    });

    /**
     * The regression test for the shared-generation race. `loadThumbnails` used to read
     * `this.thumbnailGeneration` instead of incrementing it, so two loaders invoked under a single
     * `beginThumbnailBatch()` — which happens when a standard search and an AI search both resolve —
     * captured the same value. The first loader's in-flight callbacks then still matched the current
     * generation after the second loader's `clearThumbnails()`, and repopulated the map from the
     * abandoned result set.
     *
     * Verified by reverting the `++` and watching this go red, per the repo rule that a guard is not
     * evidence until it has been seen to fail.
     */
    it('drops a late response from an earlier loader in the same batch', () => {
      const firstThumbs = new Subject<Blob | null>();
      const secondThumbs = new Subject<Blob | null>();
      mockDocumentDetailService.fetchThumbnail
        .mockReturnValueOnce(firstThumbs.asObservable())
        .mockReturnValueOnce(secondThumbs.asObservable());

      component['beginThumbnailBatch']();
      component['loadThumbnails']([resultItem({ id: 'doc1' })]);
      component['loadThumbnails']([resultItem({ id: 'doc2' })]);

      firstThumbs.next(new Blob(['stale']));
      firstThumbs.complete();
      expect(created).toHaveLength(0);
      expect(component.thumbnailMap()).toEqual({});

      // The positive control: the current loader is still honoured, so the guard is discriminating
      // rather than rejecting everything — which is how this test would pass for the wrong reason.
      secondThumbs.next(new Blob(['fresh']));
      secondThumbs.complete();
      expect(created).toHaveLength(1);
      expect(component.thumbnailMap()).toEqual({ doc2: created[0] });
    });

    it('revokes tracked thumbnails on destroy', () => {
      mockDocumentDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['thumb'])));

      component['beginThumbnailBatch']();
      component['loadThumbnails']([resultItem({ id: 'doc1' })]);

      // Read the minted URL back rather than naming `blob:mock/1`. `created` and `revoked` are
      // cleared in `beforeEach` but `blobSeq` is not, so the sequence number depends on how many
      // URLs earlier tests minted — hardcoding it made this test pass only while it happened to run
      // first, and it was already failing on arrival for exactly that reason.
      expect(created).toHaveLength(1);
      const url = created[0];
      expect(component.thumbnailMap()['doc1']).toBe(url);

      fixture.destroy();

      expect(revoked).toContain(url);
    });
  });

  describe('toggleQuickFilter', () => {
    it('should add a filter when not present', () => {
      component.selectedQuickFilters.set(new Set());
      component.toggleQuickFilter('noFolder');
      expect(component.selectedQuickFilters()).toContain('noFolder');
    });

    it('should remove a filter when present', () => {
      component.selectedQuickFilters.set(new Set(['noFolder']));
      component.toggleQuickFilter('noFolder');
      expect(component.selectedQuickFilters()).not.toContain('noFolder');
    });

    it('should update query params with selected filters', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      component.toggleQuickFilter('mostRecent');
      expect(navigateSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ quickFilters: 'mostRecent' }),
        }),
      );
    });
  });

  describe('setViewMode', () => {
    it('should update view mode signal', () => {
      component.setViewMode('grid');
      expect(component.viewMode()).toBe('grid');
      component.setViewMode('list');
      expect(component.viewMode()).toBe('list');
    });
  });

  describe('openDocument', () => {
    beforeEach(() => {
      vi.spyOn(component, 'results').mockReturnValue([
        resultItem({ id: 'doc1', path: '/default-domain/workspaces' }),
        resultItem({ id: 'coll1', type: 'Collection', title: 'Test Collection', path: undefined }),
        resultItem({
          id: 'fold1',
          type: 'Workspace',
          title: 'Test Folder',
          path: '/default-domain/workspaces/test',
        }),
      ] as ReturnType<typeof component.results>);
    });

    it('should navigate to /doc/:uid for regular documents', async () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigateByUrl');
      component.openDocument('doc1');
      expect(navigateSpy).toHaveBeenCalledWith('/doc/doc1');
    });

    it('should navigate to /collections/:uid for Collections', async () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigateByUrl');
      component.openDocument('coll1');
      expect(navigateSpy).toHaveBeenCalledWith('/collections/coll1');
    });

    it('should navigate to /browse/path for folderish documents', async () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigateByUrl');
      component.openDocument('fold1');
      expect(navigateSpy).toHaveBeenCalledWith('/browse/default-domain/workspaces/test');
    });

    it('should do nothing when uid is empty', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigateByUrl');
      component.openDocument('');
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('selection', () => {
    it('should toggle individual selection', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row()]);
      component.toggleSelection('doc1');
      expect(mockSelectionService.toggle).toHaveBeenCalledWith('doc1', 'Test Doc', null);
    });

    it('should check if item is selected', () => {
      mockSelectionService.isSelected.mockReturnValue(true);
      expect(component.isSelected('doc1')).toBe(true);
      expect(mockSelectionService.isSelected).toHaveBeenCalledWith('doc1');
    });

    it('should select all when none selected', () => {
      mockSelectionService.isAllSelected.mockReturnValue(false);
      vi.spyOn(component, 'displayResults').mockReturnValue([
        row({ id: 'doc1', name: 'Doc 1' }),
        row({ id: 'doc2', name: 'Doc 2' }),
      ]);
      component.toggleAll();
      expect(mockSelectionService.selectAll).toHaveBeenCalledWith(
        ['doc1', 'doc2'],
        { doc1: 'Doc 1', doc2: 'Doc 2' },
        expect.any(Object),
      );
    });

    it('should clear selection when all selected', () => {
      mockSelectionService.isAllSelected.mockReturnValue(true);
      component.toggleAll();
      expect(mockSelectionService.clear).toHaveBeenCalled();
    });

    it('should call clear on clearSelection', () => {
      component.clearSelection();
      expect(mockSelectionService.clear).toHaveBeenCalled();
    });
  });

  describe('deleteSelected', () => {
    it('should call SelectionService.deleteSelected and navigate on success', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      mockSelectionService.deleteSelected.mockReturnValue(of(undefined));

      component.deleteSelected();

      expect(mockSelectionService.deleteSelected).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalled();
    });
  });

  describe('column management', () => {
    it('offers every column to the picker, ticked as it is shown now', () => {
      component.visibleColumnKeys.set(['name', 'type']);
      const columns = component.pickerColumns();
      expect(columns.map((c) => c.key)).toContain('author');
      expect(columns.find((c) => c.key === 'type')?.visible).toBe(true);
      expect(columns.find((c) => c.key === 'author')?.visible).toBe(false);
    });

    it('gives the picker translated labels, not keys', () => {
      expect(component.pickerColumns().find((c) => c.key === 'name')?.label).toBe('Title');
    });

    it('should open column panel', () => {
      component.openColumnPanel();
      expect(component.columnPanelOpen()).toBe(true);
    });

    it('should close column panel', () => {
      component.columnPanelOpen.set(true);
      component.closeColumnPanel();
      expect(component.columnPanelOpen()).toBe(false);
    });

    it('resets to the default columns', () => {
      expect(component.defaultColumnKeys).toEqual(['name', 'modified', 'contributor']);
    });

    it('should apply column changes and close the panel', () => {
      component.columnPanelOpen.set(true);
      component.applyColumns(['name', 'modified', 'state']);
      expect(component.visibleColumnKeys()).toEqual(['name', 'modified', 'state']);
      expect(component.columnPanelOpen()).toBe(false);
    });
  });

  describe('sortBy', () => {
    it('should set sort to ascending on first click', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      component.sortBy('name');
      expect(component.sortColumn()).toBe('name');
      expect(component.sortDirection()).toBe('asc');
      expect(navigateSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { sortBy: 'dc:title', sortOrder: 'asc' },
        }),
      );
    });

    it('should toggle to descending on second click', () => {
      component.sortColumn.set('name');
      component.sortDirection.set('asc');
      component.sortBy('name');
      expect(component.sortDirection()).toBe('desc');
    });

    it('should clear sort on third click', () => {
      component.sortColumn.set('name');
      component.sortDirection.set('desc');
      component.sortBy('name');
      expect(component.sortColumn()).toBeNull();
      expect(component.sortDirection()).toBeNull();
    });

    it('should do nothing for non-sortable columns', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      component.sortBy('flags');
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('getCellValue', () => {
    const mockRow = row();

    it('should return correct values for each column', () => {
      expect(component.getCellValue(mockRow, 'name')).toBe('Test Doc');
      expect(component.getCellValue(mockRow, 'type')).toBe('File');
      expect(component.getCellValue(mockRow, 'modified')).toBe('2026-08-24');
      expect(component.getCellValue(mockRow, 'contributor')).toBe('admin');
      expect(component.getCellValue(mockRow, 'author')).toBe('admin');
    });

    it('should return em dash for missing optional fields', () => {
      const rowWithNulls = row({
        state: undefined,
        version: undefined,
        createdDate: undefined,
        nature: undefined,
        coverage: undefined,
        subjects: undefined,
        flags: undefined,
      });
      expect(component.getCellValue(rowWithNulls, 'state')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'version')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'created')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'nature')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'coverage')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'subjects')).toBe('—');
      expect(component.getCellValue(rowWithNulls, 'flags')).toBe('—');
    });

    it('should return empty string for unknown columns', () => {
      expect(component.getCellValue(mockRow, 'unknown')).toBe('');
    });
  });

  describe('isQuickFilterSelected', () => {
    it('should return true for selected filter', () => {
      component.selectedQuickFilters.set(new Set(['noFolder']));
      expect(component.isQuickFilterSelected('noFolder')).toBe(true);
    });

    it('should return false for unselected filter', () => {
      component.selectedQuickFilters.set(new Set(['noFolder']));
      expect(component.isQuickFilterSelected('mostRecent')).toBe(false);
    });
  });

  describe('favorites', () => {
    it('should check if document is favorited', () => {
      component.favoriteIds.set(new Set(['doc1']));
      expect(component.isFavorited('doc1')).toBe(true);
      expect(component.isFavorited('doc2')).toBe(false);
    });

    it('should add to favorites when not favorited', () => {
      mockDocumentDetailService.addToFavorites.mockReturnValue(of(undefined));
      component.favoriteIds.set(new Set());
      component.toggleFavorite('doc1');
      expect(mockDocumentDetailService.addToFavorites).toHaveBeenCalledWith('doc1');
    });

    it('should remove from favorites when favorited', () => {
      mockDocumentDetailService.removeFromFavorites.mockReturnValue(of(undefined));
      component.favoriteIds.set(new Set(['doc1']));
      component.toggleFavorite('doc1');
      expect(mockDocumentDetailService.removeFromFavorites).toHaveBeenCalledWith('doc1');
    });

    it('should do nothing when id is empty', () => {
      mockDocumentDetailService.addToFavorites.mockClear();
      component.toggleFavorite('');
      expect(mockDocumentDetailService.addToFavorites).not.toHaveBeenCalled();
    });

    it('should do nothing when operation is pending', () => {
      component.favoritePendingIds.set(new Set(['doc1']));
      mockDocumentDetailService.addToFavorites.mockClear();
      component.toggleFavorite('doc1');
      expect(mockDocumentDetailService.addToFavorites).not.toHaveBeenCalled();
    });

    it('should stop event propagation', () => {
      mockDocumentDetailService.addToFavorites.mockReturnValue(of(undefined));
      const event = { stopPropagation: vi.fn() } as unknown as Event;
      component.toggleFavorite('doc1', event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('onImageError', () => {
    // NXSAT-318: the packaged app is served from /nuxeo/agentic-ui/, so the fallback must
    // resolve against the base href rather than the server root.
    it('should replace image src with the fallback, resolved against the base href', () => {
      const mockImg = { src: '' } as HTMLImageElement;
      const event = { target: mockImg } as unknown as Event;

      component.onImageError(event);

      expect(new URL(mockImg.src, 'http://nuxeo.test/nuxeo/agentic-ui/').pathname).toBe(
        '/nuxeo/agentic-ui/images/Login-background.svg',
      );
    });

    it('should do nothing when target is not an image', () => {
      const event = { target: null } as Event;

      // Should not throw
      expect(() => component.onImageError(event)).not.toThrow();
    });
  });

  describe('download', () => {
    it('should check if type is downloadable', () => {
      expect(component.isDownloadableType('File')).toBe(true);
      expect(component.isDownloadableType('Document')).toBe(true);
      expect(component.isDownloadableType('')).toBe(false);
    });

    it('should not download when id is empty', () => {
      mockDocumentDetailService.fetchBlob.mockClear();
      component.downloadDocument('', 'test.pdf');
      expect(mockDocumentDetailService.fetchBlob).not.toHaveBeenCalled();
    });
  });

  describe('AI search', () => {
    it('should toggle AI search mode on', () => {
      component.aiSearchMode.set(false);
      component.toggleAiSearch();
      expect(component.aiSearchMode()).toBe(true);
    });

    it('should toggle AI search mode off and reset state', () => {
      component.aiSearchMode.set(true);
      component.aiQuery.set('test query');
      component.toggleAiSearch();
      expect(component.aiSearchMode()).toBe(false);
      expect(component.aiQuery()).toBe('');
    });

    it('should update AI query on input', () => {
      component.onAiQueryInput('natural language query');
      expect(component.aiQuery()).toBe('natural language query');
    });

    it('should select AI suggestion', () => {
      mockAiGatewayService.nlToNxql.mockReturnValue(
        of({ nxql: 'SELECT * FROM Document', explanation: 'test' }),
      );
      component.selectAiSuggestion('find all documents');
      expect(component.aiQuery()).toBe('find all documents');
      expect(component.aiSuggestions()).toEqual([]);
    });

    it('should execute AI search with valid query', () => {
      mockAiGatewayService.nlToNxql.mockReturnValue(
        of({ nxql: 'SELECT * FROM Document', explanation: 'Finds all documents' }),
      );
      mockNuxeoApiBase.nxqlSearch.mockReturnValue(of({ entries: [] }));
      component.aiQuery.set('test query');
      component.executeAiSearch();
      expect(mockAiGatewayService.nlToNxql).toHaveBeenCalledWith('test query');
    });

    /**
     * The regression test for a stale NXQL response overwriting a newer one.
     *
     * The standard search path in this component is driven through `switchMap`, so it cancels its
     * predecessor. `runNxqlQuery` subscribes imperatively and did not compare a generation, so a slow
     * first query landing after a fast second one replaced the second's results — the same defect
     * Copilot reported in `TrashComponent.search()`.
     *
     * Verified by reverting the `++this.nxqlGeneration` guard and watching this go red.
     */
    it('ignores an NXQL response superseded by a later query', () => {
      const first = new Subject<{ entries: { uid: string; title: string }[] }>();
      const second = new Subject<{ entries: { uid: string; title: string }[] }>();
      mockNuxeoApiBase.nxqlSearch
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(second.asObservable());

      // Mint generations the way `executeAiSearch` does, one per request.
      component['runNxqlQuery'](
        'SELECT * FROM Document WHERE a',
        ++component['aiRequestGeneration'],
      );
      component['runNxqlQuery'](
        'SELECT * FROM Document WHERE b',
        ++component['aiRequestGeneration'],
      );

      // The later query resolves first, as the faster one.
      second.next({ entries: [{ uid: 'b', title: 'From B' }] });
      second.complete();
      expect(component.aiResults().map((r) => r.id)).toEqual(['b']);

      // The earlier one lands afterwards and must be discarded rather than replacing B.
      first.next({ entries: [{ uid: 'a', title: 'From A' }] });
      first.complete();
      expect(component.aiResults().map((r) => r.id)).toEqual(['b']);
    });

    it('ignores an NXQL failure superseded by a later query', () => {
      const first = new Subject<{ entries: never[] }>();
      const second = new Subject<{ entries: { uid: string; title: string }[] }>();
      mockNuxeoApiBase.nxqlSearch
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(second.asObservable());

      // Mint generations the way `executeAiSearch` does, one per request.
      component['runNxqlQuery'](
        'SELECT * FROM Document WHERE a',
        ++component['aiRequestGeneration'],
      );
      component['runNxqlQuery'](
        'SELECT * FROM Document WHERE b',
        ++component['aiRequestGeneration'],
      );

      second.next({ entries: [{ uid: 'b', title: 'From B' }] });
      second.complete();

      // A stale failure must not put an error banner over the newer query's results.
      first.error(new Error('boom'));
      expect(component.aiError()).toBeNull();
      expect(component.aiResults().map((r) => r.id)).toEqual(['b']);
    });

    /**
     * The generation has to span BOTH async phases, not just the second one.
     *
     * When only `runNxqlQuery` minted a generation, a superseded `nlToNxql` response still wrote
     * `aiGeneratedNxql`/`aiExplanation` and then started a fresh query that minted its own
     * generation — so the stale request won outright, which is the opposite of the intent.
     */
    it('ignores an nlToNxql response superseded by a later AI search', () => {
      const first = new Subject<{ nxql: string; explanation: string }>();
      const second = new Subject<{ nxql: string; explanation: string }>();
      mockAiGatewayService.nlToNxql
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(second.asObservable());
      mockNuxeoApiBase.nxqlSearch.mockReturnValue(of({ entries: [] }));

      component.aiQuery.set('query one');
      component.executeAiSearch();
      component.aiQuery.set('query two');
      component.executeAiSearch();

      second.next({ nxql: 'SELECT * FROM B', explanation: 'from B' });
      second.complete();
      expect(component.aiGeneratedNxql()).toBe('SELECT * FROM B');

      // The earlier translation lands afterwards and must not replace B's, nor run its own query.
      const queriesBefore = mockNuxeoApiBase.nxqlSearch.mock.calls.length;
      first.next({ nxql: 'SELECT * FROM A', explanation: 'from A' });
      first.complete();
      expect(component.aiGeneratedNxql()).toBe('SELECT * FROM B');
      expect(component.aiExplanation()).toBe('from B');
      expect(mockNuxeoApiBase.nxqlSearch.mock.calls).toHaveLength(queriesBefore);
    });

    it('ignores an AI response that arrives after AI mode is switched off', () => {
      const pending = new Subject<{ nxql: string; explanation: string }>();
      mockAiGatewayService.nlToNxql.mockReturnValue(pending.asObservable());

      component.aiSearchMode.set(true);
      component.aiQuery.set('query one');
      component.executeAiSearch();

      // Leaving AI mode must invalidate the in-flight request, or its late response re-enables AI
      // state and overwrites the standard thumbnail batch restored on the way out.
      component.toggleAiSearch();
      expect(component.aiSearchMode()).toBe(false);

      pending.next({ nxql: 'SELECT * FROM Late', explanation: 'late' });
      pending.complete();

      expect(component.aiGeneratedNxql()).toBe('');
      expect(component.aiSearchExecuted()).toBe(false);
    });

    /**
     * A generation guard makes superseded callbacks return early, so whatever they would have cleared
     * on the way out has to be cleared at supersede time instead. Miss that and the page sits behind a
     * spinner with no request behind it. These two cover both supersede paths.
     */
    describe('superseding an AI request releases its loading state', () => {
      it('clears AI loading when the user leaves AI mode mid-request', () => {
        const pending = new Subject<{ entries: never[] }>();
        mockNuxeoApiBase.nxqlSearch.mockReturnValue(pending.asObservable());

        component.aiSearchMode.set(true);
        component['runNxqlQuery']('SELECT * FROM Document', ++component['aiRequestGeneration']);
        expect(component.aiNxqlLoading()).toBe(true);

        component.toggleAiSearch();

        // The pending callbacks will now return at the guard, so leaving AI mode has to release this.
        expect(component.aiNxqlLoading()).toBe(false);
        expect(component.aiLoading()).toBe(false);
      });

      it('clears AI loading when a new AI search supersedes a running NXQL request', () => {
        const pendingNxql = new Subject<{ entries: never[] }>();
        mockNuxeoApiBase.nxqlSearch.mockReturnValue(pendingNxql.asObservable());
        component['runNxqlQuery']('SELECT * FROM Document', ++component['aiRequestGeneration']);
        expect(component.aiNxqlLoading()).toBe(true);

        // A new AI search starts. If its `nlToNxql` phase fails before `runNxqlQuery` runs, nothing
        // else would ever reset the flag.
        mockAiGatewayService.nlToNxql.mockReturnValue(throwError(() => new Error('nl failed')));
        component.aiQuery.set('another query');
        component.executeAiSearch();

        expect(component.aiNxqlLoading()).toBe(false);
      });

      /**
       * The other half, and the reason the two flags are separate.
       *
       * `loading` belongs to the standard `results$` pipeline. When `runNxqlQuery` shared it,
       * `supersedeAiRequest` had to clear it — and that clear could land while a *standard* search was
       * still in flight. Every view mode is gated on `!busy()`, so the spinner disappeared and the
       * PREVIOUS results rendered as if they were current.
       */
      it('does not release loading owned by an in-flight standard search', () => {
        // A standard search is running: the `results$` pipeline sets this on every route/filter change.
        component.loading.set(true);

        // The user exits AI mode, or starts another AI search, while that request is still going.
        component.aiSearchMode.set(true);
        component.toggleAiSearch();

        expect(component.loading()).toBe(true);
        expect(component.busy()).toBe(true);
      });

      it('reports busy while either request is in flight', () => {
        component.loading.set(false);
        component.aiNxqlLoading.set(false);
        expect(component.busy()).toBe(false);

        component.aiNxqlLoading.set(true);
        expect(component.busy()).toBe(true);

        component.aiNxqlLoading.set(false);
        component.loading.set(true);
        expect(component.busy()).toBe(true);
      });
    });

    /**
     * A standard search must not invalidate thumbnails it is not going to reload.
     *
     * `beginThumbnailBatch()` ran on every query-param/drawer-filter change, while the response path
     * deliberately skips `loadThumbnails` when AI results are displayed. So a filter change during a
     * completed AI search killed every AI thumbnail request still in flight and loaded nothing to
     * replace them — the thumbnails just vanished.
     */
    describe('thumbnail batch ownership', () => {
      it('leaves the batch alone while AI results are displayed', () => {
        component.aiSearchMode.set(true);
        component.aiSearchExecuted.set(true);

        const before = component['thumbnailGeneration'];
        expect(component['standardResultsOwnThumbnails']()).toBe(false);
        // Invalidating here would strand the AI thumbnails, because nothing reloads them.
        if (component['standardResultsOwnThumbnails']()) component['beginThumbnailBatch']();

        expect(component['thumbnailGeneration']).toBe(before);
      });

      it('does not claim the batch when starting an AI NXQL request', () => {
        /**
         * The standard results stay on screen until the AI request succeeds, and `loadThumbnails`
         * mints its own generation when it does. Claiming here only mattered if the request FAILED:
         * every standard thumbnail response still in flight was then discarded by the generation
         * check, and the error path reloaded none of them — permanently missing thumbnails from
         * invalidating a batch this method might never refill.
         */
        const pending = new Subject<{ entries: never[] }>();
        mockNuxeoApiBase.nxqlSearch.mockReturnValue(pending.asObservable());

        const before = component['thumbnailGeneration'];
        component['runNxqlQuery']('SELECT * FROM Document', ++component['aiRequestGeneration']);

        expect(component['thumbnailGeneration']).toBe(before);
      });

      it('claims the batch when the standard results are what is on screen', () => {
        // The positive control, in both of the ways standard results can own the display.
        component.aiSearchMode.set(false);
        component.aiSearchExecuted.set(true);
        expect(component['standardResultsOwnThumbnails']()).toBe(true);

        component.aiSearchMode.set(true);
        component.aiSearchExecuted.set(false);
        expect(component['standardResultsOwnThumbnails']()).toBe(true);
      });
    });

    it('should not execute AI search with empty query', () => {
      component.aiQuery.set('');
      component.executeAiSearch();
      expect(mockAiGatewayService.nlToNxql).not.toHaveBeenCalled();
    });

    it('should not execute AI search with whitespace-only query', () => {
      component.aiQuery.set('   ');
      component.executeAiSearch();
      expect(mockAiGatewayService.nlToNxql).not.toHaveBeenCalled();
    });
  });

  describe('grid sorting', () => {
    it('should set grid group by and update route', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      component.setGridGroupBy('modified');
      expect(component.gridGroupBy()).toBe('modified');
      expect(component.gridSortOrder()).toBe('asc');
      expect(navigateSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { sortBy: 'dc:modified', sortOrder: 'asc' },
        }),
      );
    });

    it('should set grid sort order', () => {
      const navigateSpy = vi.spyOn(component['router'], 'navigate');
      component.gridGroupBy.set('name');
      component.setGridSortOrder('desc');
      expect(component.gridSortOrder()).toBe('desc');
      expect(navigateSpy).toHaveBeenCalled();
    });

    it('should default to asc for invalid sort direction', () => {
      component.gridGroupBy.set('name');
      component.setGridSortOrder(null);
      expect(component.gridSortOrder()).toBe('desc');
    });
  });

  describe('parseQuickFilters', () => {
    it('should parse comma-separated filter string', () => {
      const result = component['parseQuickFilters']('noFolder,mostRecent');
      expect(result).toEqual(new Set(['noFolder', 'mostRecent']));
    });

    it('should filter out invalid values', () => {
      const result = component['parseQuickFilters']('noFolder,invalid,mostRecent');
      expect(result).toEqual(new Set(['noFolder', 'mostRecent']));
    });

    it('should trim whitespace', () => {
      const result = component['parseQuickFilters']('noFolder , mostRecent ');
      expect(result).toEqual(new Set(['noFolder', 'mostRecent']));
    });

    it('should return empty set for empty string', () => {
      const result = component['parseQuickFilters']('');
      expect(result).toEqual(new Set());
    });
  });

  describe('buildDownloadFileName', () => {
    it('should keep existing extension', () => {
      const result = component['buildDownloadFileName']('test.pdf', 'application/pdf');
      expect(result).toBe('test.pdf');
    });

    it('should add extension from MIME type', () => {
      const result = component['buildDownloadFileName']('document', 'application/pdf');
      expect(result).toBe('document.pdf');
    });

    it('should handle unknown MIME type', () => {
      const result = component['buildDownloadFileName']('file', 'application/unknown');
      expect(result).toBe('file');
    });

    it('should use "document" for empty name', () => {
      const result = component['buildDownloadFileName']('', 'application/pdf');
      expect(result).toBe('document.pdf');
    });

    it('should handle various Office formats', () => {
      expect(
        component['buildDownloadFileName'](
          'doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).toBe('doc.docx');
      expect(
        component['buildDownloadFileName'](
          'sheet',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe('sheet.xlsx');
    });
  });

  describe('computed signals', () => {
    it('should compute resultCount', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: '1' }), row({ id: '2' })]);
      expect(component.resultCount()).toBe(2);
    });

    it('should compute selectedCount', () => {
      mockSelectionService.selectedCount.mockReturnValue(3);
      expect(component.selectedCount()).toBe(3);
    });

    it('should compute isIndeterminate from selection service and displayResults', () => {
      const displaySpy = vi.spyOn(component, 'displayResults');
      displaySpy.mockReturnValue([row({ id: '1' }), row({ id: '2' })]);
      mockSelectionService.isIndeterminate.mockReturnValue(true);

      // Call isIndeterminate which will call displayResults and isIndeterminate
      const result = component.isIndeterminate();
      expect(result).toBe(true);
      expect(mockSelectionService.isIndeterminate).toHaveBeenCalledWith(['1', '2']);
    });
  });
  describe('the results pipeline', () => {
    /**
     * `results$` combines the route's query params with the drawer's filter signal, builds a
     * request, and fans the response out into three places. Driven through the real pipeline
     * rather than by setting `results` directly, because the request-building and the fan-out
     * are the parts that carry risk.
     */
    it('publishes items, aggregations and favourites from one response', async () => {
      const items = [resultItem({ id: 'a', isFavorite: true }), resultItem({ id: 'b' })];
      mockSearchService.search.mockReturnValue(
        of({ items, aggregations: { dc_creator: { buckets: [] } } }),
      );

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.results().map((i) => i.id)).toEqual(['a', 'b']);
      // Aggregations and items are pushed to the shared service so the filters drawer can
      // render facet counts without issuing its own query.
      expect(mockSearchAggregationService.aggregations()).toEqual({
        dc_creator: { buckets: [] },
      });
      expect(mockSearchAggregationService.items().map((i) => i.id)).toEqual(['a', 'b']);
      // Only the favourited item is recorded.
      expect([...component.favoriteIds()]).toEqual(['a']);
      expect(component.loading()).toBe(false);
    });

    it('clears the shared state and reports an error when the query fails', async () => {
      mockSearchAggregationService.aggregations.set({ stale: true });
      mockSearchAggregationService.items.set([resultItem({ id: 'stale' })]);
      mockSearchService.search.mockReturnValue(throwError(() => new Error('500')));

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.error()).toBe('Failed to load search results.');
      expect(component.loading()).toBe(false);
      // Leaving the previous response in the shared signals would show facet counts and rows
      // belonging to a query that failed.
      expect(mockSearchAggregationService.aggregations()).toEqual({});
      expect(mockSearchAggregationService.items()).toEqual([]);
      expect(component.results()).toEqual([]);
    });

    it('sends only the drawer filters that have a value', async () => {
      mockSearchAggregationService.drawerFilters.set({
        q: '  hello  ',
        author: 'alice',
        tag: '',
        nature: '   ',
        size: 'large',
      });
      mockSearchService.search.mockReturnValue(of({ items: [], aggregations: {} }));

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      const request = mockSearchService.search.mock.calls.at(-1)?.[0] ?? {};
      // Trimmed, and empty/whitespace-only filters omitted entirely rather than sent as ''.
      // An empty string is a value the server would filter on.
      expect(request['q']).toBe('hello');
      expect(request['author']).toBe('alice');
      expect(request['size']).toBe('large');
      expect('tag' in request).toBe(false);
      expect('nature' in request).toBe(false);
    });

    it('maps a sortBy query param back to the UI column key', async () => {
      TestBed.resetTestingModule();
      await configure({ sortBy: 'dc:modified', sortOrder: 'desc' });
      mockSearchService.search.mockReturnValue(of({ items: [], aggregations: {} }));

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      // The API field name round-trips to the display key so the sort indicator lands on the
      // right column header.
      expect(component.sortColumn()).toBe('modified');
      expect(component.sortDirection()).toBe('desc');
      // Grid view is kept in step with table view.
      expect(component.gridGroupBy()).toBe('modified');
      expect(component.gridSortOrder()).toBe('desc');
    });

    it('ignores a sortOrder that is neither asc nor desc', async () => {
      TestBed.resetTestingModule();
      await configure({ sortBy: 'dc:title', sortOrder: 'sideways' });
      mockSearchService.search.mockReturnValue(of({ items: [], aggregations: {} }));

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.sortDirection()).toBeNull();
    });

    it('parses quick filters from the query string', async () => {
      TestBed.resetTestingModule();
      await configure({ quickFilters: 'noFolder,mostRecent' });
      mockSearchService.search.mockReturnValue(of({ items: [], aggregations: {} }));

      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect([...component.selectedQuickFilters()].sort()).toEqual(['mostRecent', 'noFolder']);
      const request = mockSearchService.search.mock.calls.at(-1)?.[0] ?? {};
      expect(request['quickFilters']).toBe('noFolder,mostRecent');
    });

    it('sorts the rendered rows by the active column, in both directions', async () => {
      mockSearchService.search.mockReturnValue(
        of({
          items: [
            resultItem({ id: '1', title: 'Beta' }),
            resultItem({ id: '2', title: 'alpha' }),
            resultItem({ id: '3', title: 'Gamma' }),
          ],
          aggregations: {},
        }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.sortColumn.set('name');
      component.sortDirection.set('asc');
      // Comparison is case-insensitive, so 'alpha' sorts before 'Beta'.
      expect(component.sortedResults().map((r) => r.name)).toEqual(['alpha', 'Beta', 'Gamma']);

      component.sortDirection.set('desc');
      expect(component.sortedResults().map((r) => r.name)).toEqual(['Gamma', 'Beta', 'alpha']);
    });

    it('returns rows unsorted when no sort is active', async () => {
      mockSearchService.search.mockReturnValue(
        of({
          items: [resultItem({ id: '1', title: 'Zed' }), resultItem({ id: '2', title: 'Ay' })],
          aggregations: {},
        }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.sortColumn.set(null);
      component.sortDirection.set(null);
      expect(component.sortedResults().map((r) => r.name)).toEqual(['Zed', 'Ay']);
    });

    it('shows AI results instead of query results once an AI search has run', async () => {
      mockSearchService.search.mockReturnValue(
        of({ items: [resultItem({ id: 'normal', title: 'Normal' })], aggregations: {} }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.displayResults().map((r) => r.name)).toEqual(['Normal']);

      component.aiSearchMode.set(true);
      component.aiSearchExecuted.set(true);
      component.aiResults.set([resultItem({ id: 'ai', title: 'From AI' })]);

      expect(component.displayResults().map((r) => r.name)).toEqual(['From AI']);
    });

    it('gives each row fallback art that resolves against the base href (NXSAT-318)', async () => {
      mockSearchService.search.mockReturnValue(
        of({ items: [resultItem({ id: 'doc', title: 'Doc' })], aggregations: {} }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      const [view] = component.displayResults();
      expect(new URL(view.imageUrl, 'http://nuxeo.test/nuxeo/agentic-ui/').pathname).toBe(
        '/nuxeo/agentic-ui/images/Login-background.svg',
      );
    });
  });

  describe('exportCsv', () => {
    it('writes a header row plus one row per result, and revokes the blob URL', async () => {
      mockSearchService.search.mockReturnValue(
        of({
          items: [resultItem({ id: '1', title: 'Report', type: 'File' })],
          aggregations: {},
        }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.exportCsv();

      if (!lastBlob) throw new Error('exportCsv created no Blob');
      expect(lastBlob.type).toContain('text/csv');
      const lines = (await lastBlob.text()).split('\n');
      expect(lines[0]).toContain('"Title"');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('"Report"');
      // The object URL must be released; an export that leaks one per click is a slow leak in
      // a screen users export from repeatedly.
      expect(revoked).toEqual(created);
    });

    it('doubles embedded quotes so a title cannot break out of its CSV field', async () => {
      mockSearchService.search.mockReturnValue(
        of({ items: [resultItem({ id: '1', title: 'He said "hi"' })], aggregations: {} }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.exportCsv();

      // RFC 4180 escaping. Without it a quote in a document title corrupts every following
      // column of that row.
      if (!lastBlob) throw new Error('exportCsv created no Blob');
      expect(await lastBlob.text()).toContain('"He said ""hi"""');
    });

    it('renders an em dash for the optional columns that are absent', async () => {
      mockSearchService.search.mockReturnValue(
        of({
          items: [resultItem({ id: '1', state: undefined, version: undefined, flags: undefined })],
          aggregations: {},
        }),
      );
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.exportCsv();

      if (!lastBlob) throw new Error('exportCsv created no Blob');
      expect(await lastBlob.text()).toContain('"—"');
    });
  });

  describe('saved searches', () => {
    beforeEach(() => {
      mockSearchAggregationService.selectedSavedSearchId.set('');
      mockSearchAggregationService.selectedSavedSearchTitle.set('');
    });

    it('saves a new search under the entered title', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('  My Search  ') });
      // `readSavedSearchId` reads `id`, not `uid`: a saved search is a directory entry rather
      // than a document, so it carries no `uid`.
      mockSearchService.saveSavedSearch.mockReturnValue(of({ id: 'ss-9', title: 'My Search' }));

      component.openSaveAsDialog();

      // Trimmed before it reaches the server.
      expect(mockSearchService.saveSavedSearch).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My Search', pageProviderName: 'default_search' }),
      );
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-9');
      expect(mockSearchAggregationService.markSavedSearchDirty).toHaveBeenCalled();
    });

    it('trims filter values and excludes empty ones when saving search', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('Test Search') });
      mockSearchService.saveSavedSearch.mockReturnValue(of({ id: 'ss-10', title: 'Test Search' }));
      mockSearchAggregationService.drawerFilters.set({
        dc_creator: '  admin  ',
        dc_title: '',
        path: '   ',
        dc_modified: 'today',
      });

      component.openSaveAsDialog();

      // saveSavedSearch is called with params that have been trimmed
      expect(mockSearchService.saveSavedSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Search',
          params: expect.objectContaining({
            dc_creator: 'admin',
            dc_modified: 'today',
          }),
        }),
      );
      // Verify empty/whitespace values were excluded
      const savedCall = mockSearchService.saveSavedSearch.mock.calls[0][0] as unknown as Record<
        string,
        Record<string, unknown>
      >;
      expect(savedCall['params']['dc_title']).toBeUndefined();
      expect(savedCall['params']['path']).toBeUndefined();
    });

    it('does not save when the dialog is dismissed or the title is blank', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('   ') });
      component.openSaveAsDialog();
      expect(mockSearchService.saveSavedSearch).not.toHaveBeenCalled();

      mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
      component.openSaveAsDialog();
      expect(mockSearchService.saveSavedSearch).not.toHaveBeenCalled();
    });

    it('warns and keeps the selection when saving fails', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('Name') });
      mockSearchService.saveSavedSearch.mockReturnValue(throwError(() => new Error('409')));

      component.openSaveAsDialog();

      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('');
    });

    it('reports whether a saved search is selected', () => {
      expect(component.hasSelectedSavedSearch()).toBe(false);
      mockSearchAggregationService.selectedSavedSearchId.set('  ss-1  ');
      expect(component.hasSelectedSavedSearch()).toBe(true);
    });

    it('renames the selected saved search', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Old');
      mockDialog.open.mockReturnValue({ afterClosed: () => of('New') });
      mockSearchService.updateSavedSearch.mockReturnValue(of({ id: 'ss-1' }));

      component.onEditSelectedSavedSearch();

      expect(mockSearchService.updateSavedSearch).toHaveBeenCalledWith(
        'ss-1',
        expect.objectContaining({ title: 'New' }),
      );
      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('New');
    });

    it('does not rename when nothing is selected', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('');
      component.onEditSelectedSavedSearch();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('keeps the old title when the rename request fails', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Old');
      mockDialog.open.mockReturnValue({ afterClosed: () => of('New') });
      mockSearchService.updateSavedSearch.mockReturnValue(throwError(() => new Error('500')));

      component.onEditSelectedSavedSearch();

      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('Old');
    });

    it('opens the share dialog for the selected saved search', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('  ');
      let captured: { title?: string; id?: string } | undefined;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        captured = (args[1] as { data?: typeof captured })?.data;
        return { afterClosed: () => of(undefined) };
      });

      component.onShareSelectedSavedSearch();

      // Falls back to a generic label rather than sharing a blank-titled search.
      expect(captured?.title).toBe('Saved Search');
      expect(captured?.id).toBe('ss-1');
    });

    it('does not open the share dialog with nothing selected', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('   ');
      component.onShareSelectedSavedSearch();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('deletes the selected saved search after confirmation and clears the selection', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Doomed');
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockSearchService.deleteSavedSearch.mockReturnValue(of(undefined));

      component.onDeleteSelectedSavedSearch();

      expect(mockSearchService.deleteSavedSearch).toHaveBeenCalledWith('ss-1');
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('');
      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('');
    });

    it('does not delete when the confirmation is dismissed', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });

      component.onDeleteSelectedSavedSearch();

      expect(mockSearchService.deleteSavedSearch).not.toHaveBeenCalled();
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-1');
    });

    it('keeps the selection when the delete request fails', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockSearchService.deleteSavedSearch.mockReturnValue(throwError(() => new Error('500')));

      component.onDeleteSelectedSavedSearch();

      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-1');
    });
  });

  describe('downloadDocument', () => {
    it('downloads a blob and revokes its object URL', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: 'd1', type: 'File' })]);
      mockDocumentDetailService.fetchBlob.mockReturnValue(
        of(new Blob(['x'], { type: 'application/pdf' })),
      );

      component.downloadDocument('d1', 'report');

      expect(mockDocumentDetailService.fetchBlob).toHaveBeenCalledWith('d1', {
        clientReason: 'download',
      });
      expect(created.length).toBeGreaterThan(0);
      expect(revoked).toEqual(created);
    });

    it('refuses to download a type that carries no content', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: 'd1', type: 'Folder' })]);
      component.downloadDocument('d1', 'folder');
      expect(mockDocumentDetailService.fetchBlob).not.toHaveBeenCalled();
    });

    it('surfaces the API message when the download fails', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: 'd1', type: 'File' })]);
      mockDocumentDetailService.fetchBlob.mockReturnValue(
        throwError(() => ({ error: { message: 'Blob is gone' } })),
      );

      component.downloadDocument('d1', 'report');

      expect(toast.error).toHaveBeenCalledWith('Blob is gone', { duration: 5000 });
    });

    it('falls back to a generic message when the error carries none', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: 'd1', type: 'File' })]);
      mockDocumentDetailService.fetchBlob.mockReturnValue(throwError(() => ({})));

      component.downloadDocument('d1', 'report');

      expect(toast.error).toHaveBeenCalledWith('Failed to download document.', { duration: 5000 });
    });

    it('stops the click from also opening the document', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: 'd1', type: 'File' })]);
      const event = { stopPropagation: vi.fn() } as unknown as Event;

      component.downloadDocument('d1', 'report', event);

      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });
});
