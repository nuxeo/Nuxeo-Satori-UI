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
import { of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';
import { NxsSavedSearchSelectComponent, NxsToastService } from '@nuxeo/satori-platform/components';
import {
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
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
        ]),
        { provide: SearchService, useValue: searchService },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: DocumentDetailService, useValue: { fetchThumbnail: () => of(null) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: SelectionService, useValue: { selectedCount: () => 0 } },
        { provide: AiGatewayService, useValue: {} },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        { provide: NuxeoApiBase, useValue: {} },
      ],
    })
      // Keep the actual routed component's constructor/effects and URL subscriptions; its
      // result-card presentation is outside this routing regression.
      .overrideComponent(SearchComponent, { set: { imports: [], template: '' } })
      .compileComponents();
    router = TestBed.inject(Router);
    session = TestBed.inject(SearchSession);
    harness = await RouterTestingHarness.create();
    drawer = TestBed.createComponent(SearchFiltersDrawerComponent);
    drawer.detectChanges();
    await drawer.whenStable();
  });

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
