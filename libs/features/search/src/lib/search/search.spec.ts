import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
  signal,
  type EnvironmentProviders,
  type Provider,
  type TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { By } from '@angular/platform-browser';
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
import { SearchSession } from '../search-session/search-session';
import {
  DocumentDetailService,
  type SearchResultItem,
  NuxeoApiBase,
  SearchAggregationService,
  SearchService,
  SelectionService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import {
  NXS_PRIMITIVE_IDS,
  NxsToastService,
  provideNxsComponents,
  type NxsBannerAction,
  type NxsBannerAnnounce,
  type NxsBannerInputs,
  type NxsBannerTone,
  type NxsCardInputs,
} from '@nuxeo/satori-platform/components';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';

type SearchResponseLike = { items: SearchResultItem[]; aggregations: Record<string, unknown> };

/** A card registered under the packaged card's ID, which shows what the page passed it. */
@Component({
  standalone: true,
  selector: 'lib-test-probe-card',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [NgTemplateOutlet],
  template: `
    <p class="probe-heading">{{ heading() }}</p>
    <p class="probe-subheading">{{ subheading() }}</p>
    <p class="probe-selection-label">{{ selectionLabel() }}</p>
    <div class="probe-media"><ng-container [ngTemplateOutlet]="media()" /></div>
    <div class="probe-actions"><ng-container [ngTemplateOutlet]="actions()" /></div>
  `,
})
class ProbeCardComponent implements NxsCardInputs {
  readonly heading = input('');
  readonly subheading = input('');
  readonly selected = input(false, { transform: (value: unknown) => value === true });
  readonly selectionLabel = input('');
  readonly selectionHandler = input<((selected: boolean) => void) | null>(null);
  readonly openHandler = input<(() => void) | null>(null);
  readonly media = input<TemplateRef<unknown> | null>(null);
  readonly headerAction = input<TemplateRef<unknown> | null>(null);
  readonly actions = input<TemplateRef<unknown> | null>(null);
}

/** A banner registered under `nxs.primitives.banner`, which shows the message the page passed it. */
@Component({
  standalone: true,
  selector: 'lib-test-probe-banner',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<p class="probe-message">{{ message() }}</p>`,
})
class ProbeBannerComponent implements NxsBannerInputs {
  readonly message = input('');
  readonly tone = input<NxsBannerTone>('info');
  readonly announce = input<NxsBannerAnnounce>('none');
  readonly actions = input<readonly NxsBannerAction[]>([]);
}

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
  renameSavedSearch: vi.fn((): Observable<Record<string, unknown>> => of({ id: 'ss-1' })),
  deleteSavedSearch: vi.fn((): Observable<void> => of(undefined)),
  getSavedSearchById: vi.fn((): Observable<Record<string, string>> => of({})),
};

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

  /**
   * Rebuild the TestBed with a given query-param map. `rendered` keeps the real template, for a
   * test that asserts what the page shows rather than what the component holds; `providers` are
   * added after the page's own, as an application's registrations are.
   */
  async function configure(
    queryParams: Record<string, string> = {},
    {
      rendered = false,
      providers = [],
    }: { rendered?: boolean; providers?: (Provider | EnvironmentProviders)[] } = {},
  ): Promise<void> {
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    const bed = TestBed.configureTestingModule({
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
        ...providers,
      ],
    });
    if (!rendered) {
      bed.overrideComponent(SearchComponent, { set: { imports: [], template: '<div></div>' } });
    }
    await bed.compileComponents();
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

  describe('thumbnails', () => {
    /**
     * Thumbnails are `nxs-thumbnail`'s: the component fetches, shows and revokes them, so this page
     * must not mint an object URL of its own for a result — the blob-URL rule is held in one place.
     */
    it('mints no object URL for a result thumbnail, even when the rendition answers', () => {
      mockDocumentDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['thumb'])));
      mockNuxeoApiBase.nxqlSearch.mockReturnValue(
        of({ entries: [{ uid: 'doc1', title: 'Doc 1', type: 'Picture' }] }),
      );

      fixture.detectChanges();
      component['runNxqlQuery']('SELECT * FROM Document', ++component['aiRequestGeneration']);

      expect(mockDocumentDetailService.fetchThumbnail).not.toHaveBeenCalled();
      expect(created).toEqual([]);
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
      expect(mockSelectionService.toggle).toHaveBeenCalledWith('doc1', 'Test Doc');
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
      // No previews: the selection popup draws its own with nxs-thumbnail.
      expect(mockSelectionService.selectAll).toHaveBeenCalledWith(['doc1', 'doc2'], {
        doc1: 'Doc 1',
        doc2: 'Doc 2',
      });
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
    it('deletes through SelectionService and runs the same search again, so the rows leave', async () => {
      await fixture.whenStable();
      const before = mockSearchService.search.mock.calls.length;
      mockSelectionService.deleteSelected.mockReturnValue(of(undefined));

      component.deleteSelected();
      await fixture.whenStable();

      expect(mockSelectionService.deleteSelected).toHaveBeenCalled();
      expect(mockSearchService.search.mock.calls).toHaveLength(before + 1);
      expect(mockSearchService.search.mock.calls.at(-1)?.[0]).toEqual(
        mockSearchService.search.mock.calls[before - 1][0],
      );
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
          queryParams: { sortBy: 'dc:title', sortOrder: 'asc', page: null },
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

    // The add/remove request, its in-flight guard and the click's propagation are the star's own —
    // nxs-favorite-toggle — so the page only keeps its view of the state and reports a failure.
    it('marks a result a favorite once its star confirms it', () => {
      component.favoriteIds.set(new Set());
      component.onFavoriteChanged('doc1', true);
      expect(component.isFavorited('doc1')).toBe(true);
    });

    it('unmarks a result once its star confirms the removal, leaving the others', () => {
      component.favoriteIds.set(new Set(['doc1', 'doc2']));
      component.onFavoriteChanged('doc1', false);
      expect([...component.favoriteIds()]).toEqual(['doc2']);
    });

    it('reports the server’s message when a star’s request fails', () => {
      component.onFavoriteFailed({ error: { message: 'Not allowed' } });
      expect(toast.error).toHaveBeenCalledWith('Not allowed', { duration: 5000 });
    });

    it('falls back to its own message when the server sends none', () => {
      component.onFavoriteFailed(new Error(''));
      expect(toast.error).toHaveBeenCalledWith('Failed to update favorites.', { duration: 5000 });
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
       * `loading` belongs to the standard search `SearchSession` runs. When `runNxqlQuery` shared it,
       * `supersedeAiRequest` had to clear it — and that clear could land while a *standard* search was
       * still in flight. Every view mode is gated on `!busy()`, so the spinner disappeared and the
       * PREVIOUS results rendered as if they were current.
       */
      it('does not release loading owned by an in-flight standard search', async () => {
        // A standard search is running: the session sets loading on every route/filter change.
        const pending = new Subject<SearchResponseLike>();
        mockSearchService.search.mockReturnValue(pending.asObservable());
        mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'contract' });
        await fixture.whenStable();
        expect(component.loading()).toBe(true);

        // The user exits AI mode, or starts another AI search, while that request is still going.
        component.aiSearchMode.set(true);
        component.toggleAiSearch();

        expect(component.loading()).toBe(true);
        expect(component.busy()).toBe(true);
      });

      it('reports busy while either request is in flight', async () => {
        await fixture.whenStable();
        component.aiNxqlLoading.set(false);
        expect(component.loading()).toBe(false);
        expect(component.busy()).toBe(false);

        component.aiNxqlLoading.set(true);
        expect(component.busy()).toBe(true);

        component.aiNxqlLoading.set(false);
        const pending = new Subject<SearchResponseLike>();
        mockSearchService.search.mockReturnValue(pending.asObservable());
        mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'contract' });
        await fixture.whenStable();
        expect(component.busy()).toBe(true);
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
          queryParams: { sortBy: 'dc:modified', sortOrder: 'asc', page: null },
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

    it('ignores a pager page asked for while a page loads, and takes it once the page has loaded', () => {
      const session = component['session'];
      const resultsState = vi.spyOn(
        component as unknown as { resultsState: () => unknown },
        'resultsState',
      );
      const state = (status: string) => ({
        status,
        items: [],
        aggregations: {},
        totalSize: 50,
        hasNextPage: true,
        error: null,
      });

      resultsState.mockReturnValue(state('loading'));
      component.goToPage(2);
      expect(session.pageIndex()).toBe(0);

      // Control: the same request is taken once the page has loaded.
      resultsState.mockReturnValue(state('loaded'));
      component.goToPage(2);
      expect(session.pageIndex()).toBe(2);
    });

    it('counts the server total for a standard search, and the rows shown for an AI search', () => {
      vi.spyOn(component, 'displayResults').mockReturnValue([row({ id: '1' }), row({ id: '2' })]);
      vi.spyOn(
        component as unknown as { resultsState: () => unknown },
        'resultsState',
      ).mockReturnValue({
        status: 'loaded',
        items: [],
        aggregations: {},
        totalSize: 1772,
        hasNextPage: true,
        error: null,
      });
      // Control: the standard search's total is what the count shows.
      expect(component.totalCount()).toBe(1772);

      component.aiSearchMode.set(true);
      component.aiSearchExecuted.set(true);
      expect(component.totalCount()).toBe(2);
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
     * The page hands its URL's quick filters and sort to `SearchSession`, which combines them with
     * the drawer's filters, sends the one request and fans the response out into three places.
     * Driven through the real session rather than by setting `results` directly, because the
     * request-building and the fan-out are the parts that carry risk.
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
      // Aggregations and items are published to the shared service, which the drawer's queue
      // reads; the drawer's counts come from the same response, with no query of its own.
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

    /** The page with its real template, rebuilt so the stubbed one from `beforeEach` is gone. */
    async function renderPage(): Promise<void> {
      TestBed.resetTestingModule();
      await configure({}, { rendered: true });
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('shows a failed search as a failure, not as an empty result set', async () => {
      mockSearchService.search.mockReturnValue(throwError(() => ({ status: 500 })));

      await renderPage();

      const el = fixture.nativeElement as HTMLElement;
      const state = el.querySelector('nxs-error-state');
      expect(state?.getAttribute('data-status')).toBe('500');
      expect(state?.querySelector('.nxs-error-state__heading')?.textContent?.trim()).toBe(
        'Failed to load search results.',
      );
      expect(state?.querySelector('button')?.textContent).toContain('Retry');
      expect(el.querySelector('.results-empty')).toBeNull();
    });

    it('says a forbidden search is forbidden, without Retry', async () => {
      mockSearchService.search.mockReturnValue(throwError(() => ({ status: 403 })));

      await renderPage();

      const state = (fixture.nativeElement as HTMLElement).querySelector('nxs-error-state');
      expect(component.errorStatus()).toBe(403);
      expect(state?.getAttribute('data-status')).toBe('403');
      expect(state?.querySelector('button')).toBeNull();
    });

    it('runs the same search again on Retry, and shows the results it returns', async () => {
      mockSearchService.search.mockReturnValueOnce(throwError(() => ({ status: 500 })));

      await renderPage();
      const calls = mockSearchService.search.mock.calls.length;

      mockSearchService.search.mockReturnValue(
        of({ items: [resultItem({ id: 'found' })], aggregations: {} }),
      );
      component.retrySearch();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(mockSearchService.search.mock.calls).toHaveLength(calls + 1);
      expect(mockSearchService.search.mock.calls.at(-1)?.[0]).toEqual(
        mockSearchService.search.mock.calls[calls - 1][0],
      );
      expect(component.error()).toBeNull();
      expect(component.results().map((item) => item.id)).toEqual(['found']);
      expect((fixture.nativeElement as HTMLElement).querySelector('nxs-error-state')).toBeNull();
    });

    it("shows a successful AI search's results over the standard search that failed", async () => {
      mockSearchService.search.mockReturnValue(throwError(() => ({ status: 500 })));
      await renderPage();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('nxs-error-state')).not.toBeNull();

      mockAiGatewayService.nlToNxql.mockReturnValue(
        of({ nxql: 'SELECT * FROM Document', explanation: 'Every document' }),
      );
      mockNuxeoApiBase.nxqlSearch.mockReturnValue(
        of({ entries: [{ uid: 'ai-hit', title: 'Found by AI' }] }),
      );
      component.toggleAiSearch();
      component.aiQuery.set('every document');
      component.executeAiSearch();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.aiSearchExecuted()).toBe(true);
      expect(el.querySelector('nxs-error-state')).toBeNull();
      expect(el.textContent).toContain('Found by AI');

      // The standard results are still the ones that failed, so leaving AI mode shows that again.
      component.toggleAiSearch();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('500');
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
      expect(request['author']).toBe('["alice"]');
      expect(request['size']).toBe('["large"]');
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
      mockSearchService.saveSavedSearch.mockReturnValue(of({ id: 'ss-1' }));
      mockSearchService.updateSavedSearch.mockReturnValue(of({ id: 'ss-1' }));
      mockSearchService.renameSavedSearch.mockReturnValue(of({ id: 'ss-1' }));
      mockSearchService.deleteSavedSearch.mockReturnValue(of(undefined));
    });

    it('saves a new search under the entered name, in the parameters default_search reads', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('  My Search  ') });
      mockSearchService.saveSavedSearch.mockReturnValue(of({ id: 'ss-9', title: 'My Search' }));
      mockSearchAggregationService.drawerFilters.set({
        ecm_fulltext: 'contract',
        subjects: 'art,art/cinema',
        size: 'tiny',
      });

      component.onSaveAs();

      // Trimmed before it reaches the server, and under the page provider's own parameter names:
      // `subjects` and `size` are refused by the server, which maps them onto document fields.
      expect(mockSearchService.saveSavedSearch).toHaveBeenCalledWith({
        title: 'My Search',
        pageProviderName: 'default_search',
        params: {
          ...EMPTY_SAVED_PARAMS,
          ecm_fulltext: 'contract',
          dc_subjects_agg: '["art","art/cinema"]',
          common_size_agg: '["tiny"]',
        },
      });
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-9');
      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('My Search');
      expect(mockSearchAggregationService.markSavedSearchDirty).toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith('Search "My Search" saved.');
    });

    it('does not save when the dialog is dismissed or the name is blank', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('   ') });
      component.onSaveAs();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
      component.onSaveAs();
      expect(mockSearchService.saveSavedSearch).not.toHaveBeenCalled();
    });

    it('reports a failed save and opens nothing', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('Name') });
      mockSearchService.saveSavedSearch.mockReturnValue(throwError(() => ({ status: 500 })));

      component.onSaveAs();

      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('');
      expect(toast.error).toHaveBeenCalledWith('Failed to save search.', { duration: 5000 });
    });

    it('saves the changed filters into the open saved search', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Mine');
      mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'invoice' });

      component.onSave();

      expect(mockSearchService.updateSavedSearch).toHaveBeenCalledWith('ss-1', {
        title: 'Mine',
        params: { ...EMPTY_SAVED_PARAMS, ecm_fulltext: 'invoice' },
        pageProviderName: 'default_search',
      });
      expect(toast.show).toHaveBeenCalledWith('Search "Mine" updated.');
    });

    it('renames without sending filters, so the stored ones are kept', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Old');
      mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'unsaved change' });
      let initial: unknown;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        initial = (args[1] as { data?: { initialValue?: string } })?.data?.initialValue;
        return { afterClosed: () => of(' New ') };
      });

      component.onRename();

      expect(initial).toBe('Old');
      expect(mockSearchService.renameSavedSearch).toHaveBeenCalledWith(
        'ss-1',
        'New',
        'default_search',
      );
      expect(mockSearchService.updateSavedSearch).not.toHaveBeenCalled();
      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('New');
    });

    it('does nothing to rename with no saved search open', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of('New') });
      component.onRename();
      expect(mockSearchService.renameSavedSearch).not.toHaveBeenCalled();
    });

    it('keeps the old title and says so when the rename fails', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Old');
      mockDialog.open.mockReturnValue({ afterClosed: () => of('New') });
      mockSearchService.renameSavedSearch.mockReturnValue(throwError(() => ({ status: 403 })));

      component.onRename();

      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('Old');
      expect(toast.error).toHaveBeenCalledWith('Failed to update search.', { duration: 5000 });
    });

    it('opens the share dialog for the open saved search', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('  ');
      let captured: { title?: string; id?: string } | undefined;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        captured = (args[1] as { data?: typeof captured })?.data;
        return { afterClosed: () => of(undefined) };
      });

      component.onShare();

      // Falls back to a generic label rather than sharing a blank-titled search.
      expect(captured?.title).toBe('Saved Search');
      expect(captured?.id).toBe('ss-1');
    });

    it('does not open the share dialog with nothing open', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('   ');
      component.onShare();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('deletes the open saved search after confirmation, and clears its filters', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockSearchAggregationService.selectedSavedSearchTitle.set('Doomed');
      mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'doomed' });
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });

      component.onDelete();

      expect(mockSearchService.deleteSavedSearch).toHaveBeenCalledWith('ss-1');
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('');
      expect(mockSearchAggregationService.selectedSavedSearchTitle()).toBe('');
      expect(mockSearchAggregationService.drawerFilters()).toEqual({});
      expect(mockSearchAggregationService.markSavedSearchDirty).toHaveBeenCalled();
    });

    it('does not delete when the confirmation is dismissed', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });

      component.onDelete();

      expect(mockSearchService.deleteSavedSearch).not.toHaveBeenCalled();
      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-1');
    });

    it('keeps the selection and says so when the delete fails', () => {
      mockSearchAggregationService.selectedSavedSearchId.set('ss-1');
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockSearchService.deleteSavedSearch.mockReturnValue(throwError(() => ({ status: 500 })));

      component.onDelete();

      expect(mockSearchAggregationService.selectedSavedSearchId()).toBe('ss-1');
      expect(toast.error).toHaveBeenCalledWith('Could not delete the saved search.', {
        duration: 5000,
      });
    });

    it('offers Save only once the open saved search has changed', async () => {
      mockSearchService.getSavedSearchById.mockReturnValue(of({ ecm_fulltext: 'invoice' }));
      const session = TestBed.inject(SearchSession);
      session.openSavedSearch('ss-1', 'Mine').subscribe();
      expect(component.savedSearchDirty()).toBe(false);

      mockSearchAggregationService.drawerFilters.set({ ecm_fulltext: 'invoice', size: 'tiny' });
      expect(component.savedSearchDirty()).toBe(true);
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
  /**
   * The grid view renders each result's card by `nxs.primitives.card`, so whatever is registered
   * under it — the library's card, a customer's, Satori's later — is what the user sees.
   */
  describe('grid view', () => {
    const RESULTS = [
      resultItem({ id: 'a', title: 'Claim 42.pdf', type: 'File', icon: 'file' }),
      resultItem({ id: 'b', title: 'Claims', type: 'Folder', icon: 'folder' }),
    ];

    async function renderGrid(
      providers: (Provider | EnvironmentProviders)[] = [],
      items = RESULTS,
    ): Promise<void> {
      mockSearchService.search.mockReturnValue(of({ items, aggregations: {} }));
      // `beforeEach` does not reset it, and a saved-search test before this one leaves one open,
      // which the rendered page's saved-search actions would then read the permissions of.
      mockSearchAggregationService.selectedSavedSearchId.set('');
      mockSearchAggregationService.selectedSavedSearchTitle.set('');
      TestBed.resetTestingModule();
      await configure({}, { rendered: true, providers });
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      component.setViewMode('grid');
      await settle();
    }

    /** An outlet learns from a promise that its ID is unregistered, so it settles twice. */
    async function settle(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      await fixture.whenStable();
    }

    const el = () => fixture.nativeElement as HTMLElement;

    // The heading is the name of the control that opens the card, so it is never blank.
    it('names an untitled result by its ID, on the card and on its checkbox', async () => {
      await renderGrid(
        [provideNxsComponents()],
        [resultItem({ id: 'untitled-1', title: '', type: 'File', icon: 'file' })],
      );
      const card = el().querySelector('.result-grid nxs-card') as HTMLElement;
      expect(card.querySelector('button.nxs-card__open')?.textContent?.trim()).toBe('untitled-1');
      expect(card.querySelector('mat-checkbox input')?.getAttribute('aria-label')).toBe(
        'Select untitled-1',
      );
    });

    it('renders every card by its registered ID, with what the page passes it', async () => {
      await renderGrid([
        provideNxsComponents(),
        provideSatoriExtensions({ components: { [NXS_PRIMITIVE_IDS.card]: ProbeCardComponent } }),
      ]);
      const navigate = vi.spyOn(component['router'], 'navigateByUrl');

      const probes = el().querySelectorAll('.result-grid lib-extension-outlet lib-test-probe-card');
      expect(probes).toHaveLength(2);
      expect(el().querySelector('nxs-card')).toBeNull();
      const text = (selector: string) =>
        [...probes].map((probe) => probe.querySelector(selector)?.textContent?.trim());
      expect(text('.probe-heading')).toEqual(['Claim 42.pdf', 'Claims']);
      expect(text('.probe-subheading')).toEqual(['File', 'Folder']);
      expect(text('.probe-selection-label')).toEqual(['Select Claim 42.pdf', 'Select Claims']);
      // The templates render where the page declared them, so they read the page's own row.
      expect(probes[0].querySelector('.probe-media nxs-thumbnail mat-icon')).not.toBeNull();
      expect(probes[0].querySelector('.probe-actions nxs-favorite-toggle')).not.toBeNull();
      expect(
        probes[0].querySelector('.probe-actions button[aria-label="Download"]'),
      ).not.toBeNull();
      expect(probes[1].querySelector('.probe-actions button[aria-label="Download"]')).toBeNull();

      const [first, second] = fixture.debugElement
        .queryAll(By.directive(ProbeCardComponent))
        .map((probe) => probe.componentInstance as ProbeCardComponent);
      first.openHandler()?.();
      expect(navigate).toHaveBeenCalledWith('/doc/a');
      second.selectionHandler()?.(true);
      expect(mockSelectionService.toggle).toHaveBeenCalledWith('b', 'Claims');
    });

    it('renders the library card through the outlet, with no fallback beside it', async () => {
      await renderGrid([provideNxsComponents()]);

      const cards = el().querySelectorAll('.result-grid nxs-card');
      expect(cards).toHaveLength(2);
      expect(el().querySelectorAll('.result-grid lib-extension-outlet nxs-card')).toHaveLength(2);
      expect(cards[0].querySelector('button.nxs-card__open')?.textContent?.trim()).toBe(
        'Claim 42.pdf',
      );
      expect(cards[0].querySelector('.nxs-card__media nxs-thumbnail')).not.toBeNull();
      expect(cards[0].querySelector('.nxs-card__actions nxs-favorite-toggle')).not.toBeNull();
    });

    it('falls back to the built-in card when nothing is registered under the ID', async () => {
      await renderGrid();
      const navigate = vi.spyOn(component['router'], 'navigateByUrl');

      const cards = el().querySelectorAll<HTMLElement>('.result-grid nxs-card');
      expect(cards).toHaveLength(2);
      expect(el().querySelector('.result-grid lib-extension-outlet nxs-card')).toBeNull();
      cards[0].querySelector<HTMLElement>('button.nxs-card__open')?.click();
      expect(navigate).toHaveBeenCalledWith('/doc/a');
      cards[1].querySelector<HTMLInputElement>('.nxs-card__select input')?.click();
      expect(mockSelectionService.toggle).toHaveBeenCalledWith('b', 'Claims');
    });
  });

  describe('the AI error banner', () => {
    const el = () => fixture.nativeElement as HTMLElement;

    async function renderAiError(
      providers: (Provider | EnvironmentProviders)[] = [],
    ): Promise<void> {
      TestBed.resetTestingModule();
      await configure({}, { rendered: true, providers });
      fixture = TestBed.createComponent(SearchComponent);
      component = fixture.componentInstance;
      component.aiSearchMode.set(true);
      component.aiError.set('The AI search is unavailable');
      // An outlet learns from a promise that its ID is unregistered, so it settles twice.
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      await fixture.whenStable();
    }

    it('shows the message through the registered banner ID, with no built-in banner beside it', async () => {
      await renderAiError([
        provideNxsComponents(),
        provideSatoriExtensions({
          components: { [NXS_PRIMITIVE_IDS.banner]: ProbeBannerComponent },
        }),
      ]);

      expect(el().querySelectorAll('lib-extension-outlet lib-test-probe-banner')).toHaveLength(1);
      expect(el().querySelector('lib-test-probe-banner .probe-message')?.textContent?.trim()).toBe(
        'The AI search is unavailable',
      );
      expect(el().querySelector('.ai-error nxs-banner')).toBeNull();
    });

    // The app registers the built-in banner under the ID, so the outlet resolves to it and the
    // fallback never renders. The layout wrapper must hold it anyway, or the margin is lost.
    it('keeps the layout wrapper around the built-in banner the app registers under the ID', async () => {
      await renderAiError([provideNxsComponents()]);

      expect(el().querySelector('.ai-error lib-extension-outlet nxs-banner')).not.toBeNull();
      expect(el().querySelector('.ai-error nxs-banner')?.textContent).toContain(
        'The AI search is unavailable',
      );
    });

    it('falls back to the built-in banner when nothing is registered under the ID', async () => {
      await renderAiError();

      expect(el().querySelector('lib-test-probe-banner')).toBeNull();
      const banner = el().querySelector('.ai-error nxs-banner');
      expect(banner?.getAttribute('role')).toBe('alert');
      expect(banner?.textContent).toContain('The AI search is unavailable');
    });
  });
});
