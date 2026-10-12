import { Component, computed, effect, inject, signal, untracked, DestroyRef } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo-satori/platform/extensions';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, filter, map, of, switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  SearchAggregationService,
  SearchService,
  FOLDERISH_TYPES,
  type AggregateResult,
  type SearchQueryParams,
  type SearchAggregations,
  type SavedSearchOption,
  type SearchResultItem,
} from '@nuxeo-satori/platform/nuxeo-client';
import { SavedSearchDialogComponent } from '@nuxeo-satori/platform/ui';
import { SearchQueueComponent } from '../search-queue/search-queue.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

interface CountOption {
  key: string;
  label: string;
  /** Set only when the label came from a static definition in this file, never from an aggregation. */
  labelKey?: string;
  value: string;
  count: number;
}

interface SavedSearchSelectOption {
  key: string;
  value: string;
  label: string;
  query?: string;
}

type DrawerViewMode = 'filter' | 'queue';

@Component({
  selector: 'lib-search-filters-drawer',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    TranslatePipe,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatTooltipModule,
    SearchQueueComponent,
  ],
  providers: [provideNxsToast()],
  templateUrl: './search-filters-drawer.component.html',
  styleUrl: './search-filters-drawer.component.scss',
})
export class SearchFiltersDrawerComponent {
  private readonly translate = inject(TranslateService);
  private readonly searchAggregationService = inject(SearchAggregationService);
  private readonly searchService = inject(SearchService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(NxsToastService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly viewMode = signal<DrawerViewMode>(this.loadViewModeFromStorage());
  readonly selectedDocumentId = signal<string>('');
  readonly query = signal('');
  readonly availableSavedSearches = signal<SavedSearchSelectOption[]>([]);
  readonly selectedSavedSearch = signal('');
  readonly savedSearchInput = signal('');
  readonly savedSearchFilter = signal('');
  readonly secondarySearchInput = signal('');
  readonly savedSearchOpen = signal(false);
  readonly restoringSavedSearchFilters = signal(false);
  readonly savedSearchesLoading = signal(false);
  readonly savedSearchesLoaded = signal(false);
  readonly expandedFilters = signal<Set<string>>(new Set(['modification-date']));

  readonly modificationDateOptions = signal<CountOption[]>([]);
  readonly selectedModificationDates = signal<Set<string>>(new Set());

  readonly natureOptions = signal<CountOption[]>([]);
  readonly selectedNatures = signal<Set<string>>(new Set());

  readonly subjectsOptions = signal<CountOption[]>([]);
  readonly selectedSubjects = signal<Set<string>>(new Set());

  readonly coverageOptions = signal<CountOption[]>([]);
  readonly selectedCoverage = signal<Set<string>>(new Set());

  readonly sizeOptions = signal<CountOption[]>([]);
  readonly selectedSizes = signal<Set<string>>(new Set());

  readonly availableAuthors = signal<CountOption[]>([]);
  readonly selectedAuthor = signal('');
  readonly authorInput = signal('');
  readonly authorOpen = signal(false);

  readonly availableCollections = signal<CountOption[]>([]);
  readonly selectedCollection = signal('');
  readonly collectionInput = signal('');
  readonly collectionOpen = signal(false);
  readonly collectionsLoading = signal(false);
  readonly collectionsLoaded = signal(false);

  readonly availableTags = signal<CountOption[]>([]);
  readonly selectedTag = signal('');
  readonly tagInput = signal('');
  readonly tagOpen = signal(false);
  readonly selectedQueueQuickFilters = signal<Set<string>>(new Set());
  readonly baselineItemsForCounts = signal<SearchResultItem[]>([]);
  readonly baselineAggregationsForCounts = signal<SearchAggregations>({});
  readonly baselineCountsReady = signal(false);

  private baselineRequestSeq = 0;
  private baselineSignature = '';
  private readonly baselineRequests$ = new Subject<{
    params: SearchQueryParams;
    requestSeq: number;
  }>();

  readonly hasActiveFilters = computed(
    () =>
      this.selectedSavedSearch().trim().length > 0 ||
      this.query().trim().length > 0 ||
      this.secondarySearchInput().trim().length > 0 ||
      this.selectedModificationDates().size > 0 ||
      this.selectedNatures().size > 0 ||
      this.selectedSubjects().size > 0 ||
      this.selectedCoverage().size > 0 ||
      this.selectedSizes().size > 0 ||
      this.selectedAuthor().trim().length > 0 ||
      this.selectedCollection().trim().length > 0 ||
      this.selectedTag().trim().length > 0,
  );

  readonly filteredSavedSearches = computed(() => {
    const term = this.savedSearchFilter().trim().toLowerCase();
    if (!term) return this.availableSavedSearches();
    return this.availableSavedSearches().filter((option) =>
      option.label.toLowerCase().includes(term),
    );
  });

  readonly activeFiltersForQueue = computed(() => {
    const selected = this.selectedQueueQuickFilters();
    return QUEUE_QUICK_FILTER_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value,
      selected: selected.has(option.value),
    }));
  });

  constructor() {
    // Reload the saved searches list whenever any component signals a new save.
    effect(() => {
      const version = this.searchAggregationService.savedSearchVersion();
      if (version === 0) return;
      untracked(() => {
        this.savedSearchesLoaded.set(false);
        this.loadSavedSearchesFromApi();
      });
    });

    this.baselineRequests$
      .pipe(
        debounceTime(150),
        switchMap(({ params, requestSeq }) =>
          this.searchService.search(params).pipe(
            map((response) => ({ response, requestSeq, failed: false })),
            catchError(() => of({ response: null, requestSeq, failed: true })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ response, requestSeq, failed }) => {
        if (requestSeq !== this.baselineRequestSeq) return;
        if (failed || !response) {
          this.baselineCountsReady.set(false);
          return;
        }
        this.baselineItemsForCounts.set(response.items);
        this.baselineAggregationsForCounts.set(response.aggregations);
        this.baselineCountsReady.set(true);
      });

    effect(() => {
      const drawerFilters = this.searchAggregationService.drawerFilters();
      const quickFilters = this.toQuickFiltersQueryParam();
      this.refreshBaselineCounts(drawerFilters, quickFilters);
    });

    effect(() => {
      const fallbackAggregations = this.searchAggregationService.aggregations();
      const fallbackItems = this.searchAggregationService.items();
      const hasBaseline = this.baselineCountsReady();
      const aggregations = hasBaseline
        ? this.baselineAggregationsForCounts()
        : fallbackAggregations;
      const items = hasBaseline ? this.baselineItemsForCounts() : fallbackItems;

      this.modificationDateOptions.set(this.toModifiedDateOptionsFromResults(items));
      this.availableAuthors.set(this.toAuthorOptionsFromResults(items));
      if (!this.collectionsLoaded()) {
        this.availableCollections.set(
          this.toCountOptions(
            this.pickAggregation(aggregations.collection_agg, aggregations.dc_coverage_agg),
            {},
          ),
        );
      }
      this.availableTags.set(this.toTagsOptionsFromResults(items));
      this.natureOptions.set(this.toFieldOptionsFromResults(items, (item) => item.nature));
      this.subjectsOptions.set(this.toSubjectsOptionsFromResults(items));
      this.coverageOptions.set(this.toFieldOptionsFromResults(items, (item) => item.coverage));
      this.sizeOptions.set(this.toSizeOptionsFromResults(items));
    });

    effect(() => {
      const drawerFilters = this.searchAggregationService.drawerFilters();

      this.query.set((drawerFilters['q'] ?? '').trim());
      this.secondarySearchInput.set((drawerFilters['ecm_fulltext'] ?? '').trim());
      this.selectedModificationDates.set(this.parseCsvSet(drawerFilters['modifiedDate']));
      this.selectedNatures.set(this.parseCsvSet(drawerFilters['nature']));
      this.selectedSubjects.set(this.parseCsvSet(drawerFilters['subjects']));
      this.selectedCoverage.set(this.parseCsvSet(drawerFilters['coverage']));
      this.selectedSizes.set(this.parseCsvSet(drawerFilters['size']));

      const author = (drawerFilters['author'] ?? '').trim();
      this.selectedAuthor.set(author);
      this.authorInput.set(author);

      const collection = (drawerFilters['collection'] ?? '').trim();
      this.selectedCollection.set(collection);
      this.collectionInput.set(collection);

      const tag = (drawerFilters['tag'] ?? '').trim();
      this.selectedTag.set(tag);
      this.tagInput.set(tag);
    });

    effect(() => {
      const savedSearchId = this.searchAggregationService.selectedSavedSearchId().trim();
      const savedSearchTitle = this.searchAggregationService.selectedSavedSearchTitle().trim();
      const drawerFilters = this.searchAggregationService.drawerFilters();
      const hasDrawerFilters = Object.keys(drawerFilters).length > 0;

      if (savedSearchId) {
        this.selectedSavedSearch.set(savedSearchId);
        this.savedSearchInput.set(savedSearchTitle);

        if (!hasDrawerFilters && !this.restoringSavedSearchFilters()) {
          this.restoringSavedSearchFilters.set(true);
          this.searchService
            .getSavedSearchById(savedSearchId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (params) => {
                const currentSavedSearchId = this.searchAggregationService
                  .selectedSavedSearchId()
                  .trim();
                if (currentSavedSearchId !== savedSearchId) {
                  return;
                }

                this.applySavedSearchParams(params);
                this.restoringSavedSearchFilters.set(false);
              },
              error: () => {
                const currentSavedSearchId = this.searchAggregationService
                  .selectedSavedSearchId()
                  .trim();
                if (currentSavedSearchId !== savedSearchId) {
                  return;
                }

                this.restoringSavedSearchFilters.set(false);
              },
            });
        }

        return;
      }

      this.selectedSavedSearch.set('');
      this.savedSearchInput.set('');
      this.savedSearchFilter.set('');
      this.savedSearchOpen.set(false);

      if (hasDrawerFilters) return;

      this.query.set('');
      this.secondarySearchInput.set('');
      this.selectedModificationDates.set(new Set());
      this.selectedNatures.set(new Set());
      this.selectedSubjects.set(new Set());
      this.selectedCoverage.set(new Set());
      this.selectedSizes.set(new Set());
      this.selectedAuthor.set('');
      this.authorInput.set('');
      this.authorOpen.set(false);
      this.selectedCollection.set('');
      this.collectionInput.set('');
      this.collectionOpen.set(false);
      this.selectedTag.set('');
      this.tagInput.set('');
      this.tagOpen.set(false);
    });

    this.activatedRoute.parent?.params.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedDocumentId.set(params['id'] ?? '');
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const urlParts = event.urlAfterRedirects.split('/');
        const docIndex = urlParts.indexOf('doc');
        if (docIndex !== -1 && docIndex + 1 < urlParts.length) {
          const docId = urlParts[docIndex + 1].split('?')[0]; // Remove query params
          this.selectedDocumentId.set(docId);
        } else {
          this.selectedDocumentId.set('');
        }
      });

    this.activatedRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const quickFilters = params.get('quickFilters') ?? '';
      this.selectedQueueQuickFilters.set(this.parseQuickFilters(quickFilters));
    });

    effect(() => {
      const mode = this.viewMode();
      localStorage.setItem('search_drawer_view_mode', mode);
    });
  }

  switchToQueueView(): void {
    this.viewMode.set('queue');
    // Navigate to selected document (or first search result) when entering queue view.
    const items = this.searchAggregationService.items();
    const docId = this.selectedDocumentId();
    const selectedInResults = !!docId && items.some((item) => item.id === docId);

    if (selectedInResults) {
      const selectedItem = items.find((item) => item.id === docId);
      if (selectedItem) {
        this.navigateToItem(selectedItem);
      }
      return;
    }

    if (items.length > 0) {
      this.navigateToItem(items[0]);
    }
  }

  private navigateToItem(item: SearchResultItem): void {
    if (item.type === 'Collection') {
      void this.router.navigate(['/collections', item.id], {
        queryParams: { quickFilters: this.toQuickFiltersQueryParam() },
        queryParamsHandling: 'merge',
      });
      return;
    }

    if (FOLDERISH_TYPES.has(item.type) && item.path) {
      void this.router.navigate(['/browse' + item.path], {
        queryParams: { quickFilters: this.toQuickFiltersQueryParam() },
        queryParamsHandling: 'merge',
      });
      return;
    }

    void this.router.navigate(['/doc', item.id], {
      queryParams: { quickFilters: this.toQuickFiltersQueryParam() },
      queryParamsHandling: 'merge',
    });
  }

  switchToFilterView(): void {
    this.viewMode.set('filter');
    // Navigate back to search/filter view
    void this.router.navigate(['/search'], {
      queryParams: { quickFilters: this.toQuickFiltersQueryParam() },
      queryParamsHandling: 'merge',
    });
  }

  onQueueItemSelected(item: SearchResultItem): void {
    this.navigateToItem(item);
  }

  toggleQueueQuickFilter(value: string): void {
    const next = new Set(this.selectedQueueQuickFilters());
    if (next.has(value)) next.delete(value);
    else next.add(value);

    this.selectedQueueQuickFilters.set(next);

    const orderedSelected = QUEUE_QUICK_FILTER_OPTIONS.map((filter) => filter.value).filter(
      (filterValue) => next.has(filterValue),
    );

    void this.router.navigate(['/search'], {
      queryParams: { quickFilters: orderedSelected.length > 0 ? orderedSelected.join(',') : null },
      queryParamsHandling: 'merge',
    });
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    this.updateDrawerFilters();
  }

  onSecondarySearchInput(value: string): void {
    this.secondarySearchInput.set(value);
  }

  onSecondarySearchEnter(): void {
    this.updateDrawerFilters();
  }

  onSecondarySearchClear(): void {
    this.secondarySearchInput.set('');
    this.updateDrawerFilters();
  }

  openSaveAsDialog(): void {
    this.dialog
      .open(SavedSearchDialogComponent, {
        data: {
          title: this.translate.instant('ui.saved-search'),
          placeholder: this.translate.instant('saved-search.dialog.name-placeholder'),
        },
      })
      .afterClosed()
      .subscribe((title) => {
        const trimmedTitle = title?.trim();
        if (!trimmedTitle) return;

        this.searchService
          .saveSavedSearch({
            title: trimmedTitle,
            params: this.buildFilters(),
            pageProviderName: 'default_search',
          })
          .subscribe({
            next: () => {
              this.searchAggregationService.markSavedSearchDirty();
              this.toast.show(
                this.translate.instant('common.search-saved', { name: trimmedTitle }),
              );
            },
            error: () => {
              this.toast.error(this.translate.instant('assets.message.failed-to-save-search'), {
                duration: 5000,
              });
            },
          });
      });
  }

  isExpanded(id: string): boolean {
    return this.expandedFilters().has(id);
  }

  toggleFilter(id: string): void {
    this.expandedFilters.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleModificationDate(value: string): void {
    this.selectedModificationDates.update((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    this.updateDrawerFilters();
  }

  isModificationDateSelected(value: string): boolean {
    return this.selectedModificationDates().has(value);
  }

  toggleNature(value: string): void {
    this.selectedNatures.update((current) => this.toggleInSet(current, value));
    this.updateDrawerFilters();
  }

  isNatureSelected(value: string): boolean {
    return this.selectedNatures().has(value);
  }

  toggleSubject(value: string): void {
    this.selectedSubjects.update((current) => this.toggleInSet(current, value));
    this.updateDrawerFilters();
  }

  isSubjectSelected(value: string): boolean {
    return this.selectedSubjects().has(value);
  }

  toggleCoverage(value: string): void {
    this.selectedCoverage.update((current) => this.toggleInSet(current, value));
    this.updateDrawerFilters();
  }

  isCoverageSelected(value: string): boolean {
    return this.selectedCoverage().has(value);
  }

  toggleSize(value: string): void {
    this.selectedSizes.update((current) => this.toggleInSet(current, value));
    this.updateDrawerFilters();
  }

  isSizeSelected(value: string): boolean {
    return this.selectedSizes().has(value);
  }

  onAuthorChange(value: string): void {
    this.selectedAuthor.set(value);
    this.updateDrawerFilters();
  }

  onCollectionChange(value: string): void {
    this.selectedCollection.set(value);
    this.updateDrawerFilters();
  }

  onTagChange(value: string): void {
    this.selectedTag.set(value);
    this.updateDrawerFilters();
  }

  onAuthorInput(value: string): void {
    this.authorInput.set(value);
    this.authorOpen.set(true);
    if (!value.trim() && this.selectedAuthor()) {
      this.onAuthorChange('');
    }
  }

  onSavedSearchFocus(): void {
    this.savedSearchOpen.set(true);
    this.loadSavedSearchesFromApi();
  }

  onSavedSearchToggle(): void {
    if (this.savedSearchOpen()) {
      this.savedSearchOpen.set(false);
      return;
    }
    this.onSavedSearchFocus();
  }

  onCollectionInput(value: string): void {
    this.collectionInput.set(value);
    this.collectionOpen.set(true);
    if (!value.trim() && this.selectedCollection()) {
      this.onCollectionChange('');
    }
  }

  onCollectionFocus(): void {
    this.collectionOpen.set(true);
    this.loadCollectionsFromApi();
  }

  onTagInput(value: string): void {
    this.tagInput.set(value);
    this.tagOpen.set(true);
    if (!value.trim() && this.selectedTag()) {
      this.onTagChange('');
    }
  }

  selectAuthor(option: CountOption): void {
    this.authorInput.set(option.label);
    this.authorOpen.set(false);
    this.onAuthorChange(option.value);
  }

  selectSavedSearch(option: SavedSearchSelectOption): void {
    this.savedSearchInput.set(option.label);
    this.savedSearchFilter.set('');
    this.selectedSavedSearch.set(option.value);
    this.savedSearchOpen.set(false);
    this.searchAggregationService.selectedSavedSearchId.set(option.value);
    this.searchAggregationService.selectedSavedSearchTitle.set(option.label);

    this.searchService.getSavedSearchById(option.value).subscribe({
      next: (params) => {
        this.applySavedSearchParams(params);
      },
    });
  }

  private applySavedSearchParams(params: Record<string, unknown>): void {
    const getRaw = (key: string): unknown => {
      const direct = params[key];
      if (direct !== undefined && direct !== null) return direct;

      const defaults = params[`defaults:${key}`];
      if (defaults !== undefined && defaults !== null) return defaults;

      return undefined;
    };
    const toStringValue = (raw: unknown): string => {
      if (typeof raw === 'string') return raw.trim();
      if (Array.isArray(raw) && raw.length > 0) return String(raw[0] ?? '').trim();
      return '';
    };
    const parseJsonArray = (raw: string): string[] | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map(String)
            .map((v) => v.trim())
            .filter(Boolean);
        }
      } catch {
        // not JSON
      }
      return null;
    };
    const getSet = (key: string): Set<string> => {
      const rawValue = getRaw(key);

      if (Array.isArray(rawValue)) {
        return new Set(rawValue.map((value) => String(value ?? '').trim()).filter(Boolean));
      }

      const raw = toStringValue(rawValue);
      if (!raw) return new Set();

      // Values may be stored as a JSON array string (e.g. '["val1","val2"]') or comma-separated
      const parsed = parseJsonArray(raw);
      if (parsed) return new Set(parsed);
      return new Set(
        raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      );
    };
    const getScalar = (key: string): string => {
      const raw = toStringValue(getRaw(key));
      if (!raw) return '';

      const parsed = parseJsonArray(raw);
      if (parsed && parsed.length > 0) return parsed[0];

      return raw;
    };
    const fallbackSet = (...keys: string[]): Set<string> => {
      for (const key of keys) {
        const s = getSet(key);
        if (s.size > 0) return s;
      }
      return new Set();
    };
    const fallback = (...keys: string[]): string => {
      for (const key of keys) {
        const v = getScalar(key);
        if (v) return v;
      }
      return '';
    };

    // Support both drawer-style keys and API-style keys from persisted saved searches.
    this.query.set(fallback('q', 'query'));
    this.secondarySearchInput.set(fallback('ecm_fulltext', 'ecmFulltext'));

    // Aggregation keys (dc_modified_agg etc.) take priority over URL-style keys (modifiedDate etc.)
    this.selectedModificationDates.set(
      fallbackSet('dc_modified_agg', 'modifiedDate', 'dc_modified'),
    );
    this.selectedNatures.set(fallbackSet('dc_nature_agg', 'nature', 'dc_nature'));
    this.selectedSubjects.set(fallbackSet('dc_subjects_agg', 'subjects', 'dc_subjects'));
    this.selectedCoverage.set(fallbackSet('dc_coverage_agg', 'coverage', 'dc_coverage'));
    this.selectedSizes.set(fallbackSet('common_size_agg', 'common_size', 'size'));

    const author = fallback('dc_creator_agg', 'dc_creator', 'author');
    this.selectedAuthor.set(author);
    this.authorInput.set(author);

    const collection = fallback('collection_agg', 'dc_coverage_agg', 'collection');
    this.selectedCollection.set(collection);
    this.collectionInput.set(collection);

    const tag = fallback('ecm_tags', 'tag');
    this.selectedTag.set(tag);
    this.tagInput.set(tag);

    // Expand filter groups that have active selections so the user can see them
    this.expandedFilters.update((set) => {
      const next = new Set(set);
      if (this.selectedModificationDates().size > 0) next.add('modification-date');
      if (this.selectedNatures().size > 0) next.add('nature');
      if (this.selectedSubjects().size > 0) next.add('subjects');
      if (this.selectedCoverage().size > 0) next.add('coverage');
      if (this.selectedSizes().size > 0) next.add('size');
      return next;
    });

    this.updateDrawerFilters();
  }

  selectCollection(option: CountOption): void {
    this.collectionInput.set(option.label);
    this.collectionOpen.set(false);
    this.onCollectionChange(option.value);
  }

  selectTag(option: CountOption): void {
    this.tagInput.set(option.label);
    this.tagOpen.set(false);
    this.onTagChange(option.value);
  }

  closeAuthorDropdown(): void {
    setTimeout(() => this.authorOpen.set(false), 120);
  }

  onSavedSearchFocusOut(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    // If focus moved to another element still inside the dropdown, keep it open.
    if (relatedTarget && container.contains(relatedTarget)) return;
    // Small delay so (mousedown) on options fires before we close.
    setTimeout(() => this.savedSearchOpen.set(false), 120);
  }

  closeCollectionDropdown(): void {
    setTimeout(() => this.collectionOpen.set(false), 120);
  }

  closeTagDropdown(): void {
    setTimeout(() => this.tagOpen.set(false), 120);
  }

  filteredAuthors(): CountOption[] {
    const term = this.authorInput().trim().toLowerCase();
    if (!term) return this.availableAuthorsWithData();
    return this.availableAuthorsWithData().filter(
      (o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term),
    );
  }

  filteredCollections(): CountOption[] {
    const term = this.collectionInput().trim().toLowerCase();
    if (!term) return this.availableCollectionsWithData();
    return this.availableCollectionsWithData().filter(
      (o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term),
    );
  }

  filteredTags(): CountOption[] {
    const term = this.tagInput().trim().toLowerCase();
    if (!term) return [];
    return this.availableTagsWithData().filter(
      (o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term),
    );
  }

  availableModificationDateWithData(): CountOption[] {
    return this.modificationDateOptions();
  }

  availableNatureWithData(): CountOption[] {
    return this.natureOptions().filter((option) => option.count > 0);
  }

  availableSubjectsWithData(): CountOption[] {
    return this.subjectsOptions().filter((option) => option.count > 0);
  }

  availableCoverageWithData(): CountOption[] {
    return this.coverageOptions().filter((option) => option.count > 0);
  }

  availableSizesWithData(): CountOption[] {
    return this.sizeOptions();
  }

  availableAuthorsWithData(): CountOption[] {
    return this.availableAuthors().filter((option) => option.count > 0);
  }

  availableCollectionsWithData(): CountOption[] {
    if (this.collectionsLoaded()) {
      return this.availableCollections();
    }
    return this.availableCollections().filter((option) => option.count > 0);
  }

  availableTagsWithData(): CountOption[] {
    return this.availableTags().filter((option) => option.count > 0);
  }

  getCountText(count: number): string {
    return ` (${count})`;
  }

  resetFilters(): void {
    this.selectedSavedSearch.set('');
    this.savedSearchInput.set('');
    this.savedSearchFilter.set('');
    this.savedSearchOpen.set(false);
    this.searchAggregationService.selectedSavedSearchId.set('');
    this.searchAggregationService.selectedSavedSearchTitle.set('');
    this.query.set('');
    this.secondarySearchInput.set('');
    this.selectedModificationDates.set(new Set());
    this.selectedNatures.set(new Set());
    this.selectedSubjects.set(new Set());
    this.selectedCoverage.set(new Set());
    this.selectedSizes.set(new Set());
    this.selectedAuthor.set('');
    this.authorInput.set('');
    this.authorOpen.set(false);
    this.selectedCollection.set('');
    this.collectionInput.set('');
    this.collectionOpen.set(false);
    this.selectedTag.set('');
    this.tagInput.set('');
    this.tagOpen.set(false);

    this.updateDrawerFilters();
  }

  private updateDrawerFilters(): void {
    this.ensureSearchRoute();
    this.searchAggregationService.drawerFilters.set(this.buildFilters());
  }

  private ensureSearchRoute(): void {
    const currentPath = this.router.url.split('?')[0];
    if (currentPath !== '/search') {
      void this.router.navigateByUrl('/search');
    }
  }

  private buildFilters(): Record<string, string> {
    const filters: Record<string, string> = {};

    const q = this.query().trim();
    if (q) filters['q'] = q;

    const ecmFulltext = this.secondarySearchInput().trim();
    if (ecmFulltext) filters['ecm_fulltext'] = ecmFulltext;

    const modificationDates = [...this.selectedModificationDates()];
    if (modificationDates.length > 0) filters['modifiedDate'] = modificationDates.join(',');

    const nature = [...this.selectedNatures()];
    if (nature.length > 0) filters['nature'] = nature.join(',');

    const subjects = [...this.selectedSubjects()];
    if (subjects.length > 0) filters['subjects'] = subjects.join(',');

    const coverage = [...this.selectedCoverage()];
    if (coverage.length > 0) filters['coverage'] = coverage.join(',');

    const size = [...this.selectedSizes()];
    if (size.length > 0) filters['size'] = size.join(',');

    const author = this.selectedAuthor().trim();
    if (author) filters['author'] = author;

    const collection = this.selectedCollection().trim();
    if (collection) filters['collection'] = collection;

    const tag = this.selectedTag().trim();
    if (tag) filters['tag'] = tag;

    return filters;
  }

  private pickAggregation(
    ...candidates: Array<AggregateResult | undefined>
  ): AggregateResult | undefined {
    return candidates.find((agg) => (agg?.buckets?.length ?? 0) > 0);
  }

  private toCountOptions(
    aggregation: AggregateResult | undefined,
    labelMap: Record<string, string>,
  ): CountOption[] {
    return (aggregation?.buckets ?? [])
      .map((bucket) => {
        const key = bucket.key;
        return {
          key,
          value: key,
          label: labelMap[key] ?? this.humanize(key),
          count: bucket.docCount,
        } satisfies CountOption;
      })
      .filter((option) => option.count > 0);
  }

  private toModifiedDateOptionsFromResults(items: SearchResultItem[]): CountOption[] {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const counts = {
      last24h: 0,
      lastWeek: 0,
      lastMonth: 0,
      lastYear: 0,
      moreThan1YearAgo: 0,
    } as Record<ModifiedDateId, number>;

    for (const item of items) {
      const modifiedMs = this.parseModifiedDate(item.modifiedDate);
      if (!Number.isFinite(modifiedMs)) continue;

      const diffMs = Math.max(0, nowMs - modifiedMs);

      if (diffMs <= dayMs) {
        counts.last24h += 1;
      } else if (diffMs <= 7 * dayMs) {
        counts.lastWeek += 1;
      } else if (diffMs <= 30 * dayMs) {
        counts.lastMonth += 1;
      } else if (diffMs <= 365 * dayMs) {
        counts.lastYear += 1;
      } else {
        counts.moreThan1YearAgo += 1;
      }
    }

    return MODIFIED_DATE_OPTION_DEFS.map((option) => ({
      key: option.id,
      value: option.id,
      labelKey: option.labelKey,
      label: option.label,
      count: counts[option.id],
    }));
  }

  private toAuthorOptionsFromResults(items: SearchResultItem[]): CountOption[] {
    if (items.length === 0) return [];

    const byAuthor = new Map<string, { value: string; count: number }>();

    for (const item of items) {
      const value = (item.author ?? '').trim();
      if (!value) continue;

      const key = value.toLowerCase();
      const existing = byAuthor.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byAuthor.set(key, { value, count: 1 });
      }
    }

    return [...byAuthor.entries()]
      .map(([key, info]) => ({
        key,
        value: info.value,
        label: info.value,
        count: info.count,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  private toFieldOptionsFromResults(
    items: SearchResultItem[],
    pickValue: (item: SearchResultItem) => string | undefined,
  ): CountOption[] {
    if (items.length === 0) return [];

    const byKey = new Map<string, { value: string; count: number }>();

    for (const item of items) {
      const value = (pickValue(item) ?? '').trim();
      if (!value) continue;

      const key = value.toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, { value, count: 1 });
      }
    }

    return [...byKey.entries()]
      .map(([key, info]) => ({
        key,
        value: info.value,
        label: info.value,
        count: info.count,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  private toSubjectsOptionsFromResults(items: SearchResultItem[]): CountOption[] {
    if (items.length === 0) return [];

    const byKey = new Map<string, { value: string; count: number }>();

    for (const item of items) {
      const rawValues = [
        ...(item.tags ?? []),
        ...(item.subjects ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ];

      for (const rawValue of rawValues) {
        const value = rawValue.trim();
        if (!value) continue;

        const key = value.toLowerCase();
        const existing = byKey.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          byKey.set(key, { value, count: 1 });
        }
      }
    }

    return [...byKey.entries()]
      .map(([key, info]) => ({
        key,
        value: info.value,
        label: info.value,
        count: info.count,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  private toTagsOptionsFromResults(items: SearchResultItem[]): CountOption[] {
    if (items.length === 0) return [];

    const byKey = new Map<string, { value: string; count: number }>();

    for (const item of items) {
      for (const rawTag of item.tags ?? []) {
        const value = rawTag.trim();
        if (!value) continue;

        const key = value.toLowerCase();
        const existing = byKey.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          byKey.set(key, { value, count: 1 });
        }
      }
    }

    return [...byKey.entries()]
      .map(([key, info]) => ({
        key,
        value: info.value,
        label: info.value,
        count: info.count,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
  }

  private parseModifiedDate(value: string): number {
    if (!value) return NaN;

    // Prefer ISO-like formats from API (e.g. 2026-04-02 or 2026-04-02T12:34:56Z).
    const isoMs = Date.parse(value);
    if (Number.isFinite(isoMs)) return isoMs;

    // Fallback: try YYYY-MM-DD extracted prefix.
    const prefix = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) {
      const ms = Date.parse(`${prefix}T00:00:00`);
      if (Number.isFinite(ms)) return ms;
    }

    return NaN;
  }

  private toSizeOptionsFromResults(items: SearchResultItem[]): CountOption[] {
    if (items.length === 0) return [];

    const oneKb = 1024;
    const oneMb = 1024 * 1024;

    const counts = {
      tiny: 0,
      small: 0,
      medium: 0,
      big: 0,
      huge: 0,
    } as Record<SizeBucketId, number>;

    for (const item of items) {
      const sizeInBytes = item.sizeInBytes;
      if (!Number.isFinite(sizeInBytes) || sizeInBytes === undefined || sizeInBytes < 0) continue;

      if (sizeInBytes < 100 * oneKb) {
        counts.tiny += 1;
      } else if (sizeInBytes < oneMb) {
        counts.small += 1;
      } else if (sizeInBytes < 10 * oneMb) {
        counts.medium += 1;
      } else if (sizeInBytes < 100 * oneMb) {
        counts.big += 1;
      } else {
        counts.huge += 1;
      }
    }

    return SIZE_OPTION_DEFS.map((def) => ({
      key: def.value,
      value: def.value,
      labelKey: def.labelKey,
      label: def.label,
      count: counts[def.value],
    }));
  }

  private loadCollectionsFromApi(): void {
    if (this.collectionsLoaded() || this.collectionsLoading()) return;

    this.collectionsLoading.set(true);
    this.searchService.getUserCollections().subscribe({
      next: (collections) => {
        this.availableCollections.set(
          collections.map((collection) => ({
            key: collection.id,
            value: collection.id,
            label: collection.title,
            count: collection.itemCount,
          })),
        );
        this.collectionsLoaded.set(true);
        this.collectionsLoading.set(false);
      },
      error: () => {
        this.collectionsLoading.set(false);
      },
    });
  }

  private loadSavedSearchesFromApi(): void {
    if (this.savedSearchesLoaded() || this.savedSearchesLoading()) return;

    this.savedSearchesLoading.set(true);
    this.searchService.getSavedSearches('default_search').subscribe({
      next: (items) => {
        this.availableSavedSearches.set(items.map((item) => this.toSavedSearchOption(item)));
        this.savedSearchesLoaded.set(true);
        this.savedSearchesLoading.set(false);
      },
      error: () => {
        this.savedSearchesLoading.set(false);
      },
    });
  }

  private toSavedSearchOption(item: SavedSearchOption): SavedSearchSelectOption {
    return {
      key: item.id,
      value: item.id,
      label: item.title,
      query: item.query,
    };
  }

  private toggleInSet(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  private parseCsvSet(value: string | undefined): Set<string> {
    if (!value) return new Set();
    return new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  private humanize(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private loadViewModeFromStorage(): DrawerViewMode {
    return 'filter';
  }

  private toQuickFiltersQueryParam(): string | null {
    const selected = this.selectedQueueQuickFilters();
    const orderedSelected = QUEUE_QUICK_FILTER_OPTIONS.map((filter) => filter.value).filter(
      (filterValue) => selected.has(filterValue),
    );
    return orderedSelected.length > 0 ? orderedSelected.join(',') : null;
  }

  private parseQuickFilters(value: string): Set<string> {
    const allowed = new Set<string>(QUEUE_QUICK_FILTER_OPTIONS.map((f) => f.value));
    return new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && allowed.has(item)),
    );
  }

  private refreshBaselineCounts(
    drawerFilters: Record<string, string>,
    quickFilters: string | null,
  ): void {
    const params: SearchQueryParams = {};
    const q = (drawerFilters['q'] ?? '').trim();
    const ecmFulltext = (drawerFilters['ecm_fulltext'] ?? '').trim();

    if (q) params.q = q;
    if (ecmFulltext) params.ecmFulltext = ecmFulltext;
    if (quickFilters?.trim()) params.quickFilters = quickFilters;

    const signature = JSON.stringify(params);
    if (signature === this.baselineSignature) {
      return;
    }

    this.baselineSignature = signature;
    const requestSeq = ++this.baselineRequestSeq;
    this.baselineCountsReady.set(false);
    this.baselineRequests$.next({ params, requestSeq });
  }
}

type ModifiedDateId = 'last24h' | 'lastWeek' | 'lastMonth' | 'lastYear' | 'moreThan1YearAgo';
type SizeBucketId = 'tiny' | 'small' | 'medium' | 'big' | 'huge';

const MODIFIED_DATE_OPTION_DEFS: Array<{ id: ModifiedDateId; labelKey: string; label: string }> = [
  { id: 'last24h', labelKey: 'search.filter.last24h', label: 'Last 24h' },
  { id: 'lastWeek', labelKey: 'search.filter.last-week', label: 'Last week' },
  { id: 'lastMonth', labelKey: 'search.filter.last-month', label: 'Last month' },
  { id: 'lastYear', labelKey: 'search.filter.last-year', label: 'Last year' },
  {
    id: 'moreThan1YearAgo',
    labelKey: 'search.filter.more-than1-year-ago',
    label: 'More than a year ago',
  },
];

const SIZE_OPTION_DEFS: Array<{ value: SizeBucketId; labelKey: string; label: string }> = [
  {
    value: 'tiny',
    labelKey: 'search.filter.option.less-than-100-kb',
    label: 'Less than 100 KB',
  },
  {
    value: 'small',
    labelKey: 'search.filter.option.between-100-kb-and-1-mb',
    label: 'Between 100 KB and 1 MB',
  },
  {
    value: 'medium',
    labelKey: 'search.filter.option.between-1-mb-and-10-mb',
    label: 'Between 1 MB and 10 MB',
  },
  {
    value: 'big',
    labelKey: 'search.filter.option.between-10-mb-and-100-mb',
    label: 'Between 10 MB and 100 MB',
  },
  {
    value: 'huge',
    labelKey: 'search.filter.option.more-than-100-mb',
    label: 'More than 100 MB',
  },
];

const QUEUE_QUICK_FILTER_OPTIONS = [
  { labelKey: 'search.filter.option.no-containers', label: 'No Containers', value: 'noFolder' },
  { labelKey: 'search.filter.option.most-recent', label: 'Most Recent', value: 'mostRecent' },
  { labelKey: 'search.filter.option.validated', label: 'Validated', value: 'onlyValidated' },
] as const;
