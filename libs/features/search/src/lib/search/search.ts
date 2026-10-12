import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { DescriptorLabelPipe, descriptorLabel } from '@nuxeo-satori/platform/extensions';
import { toSignal, toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  switchMap,
  catchError,
  of,
  tap,
  map,
  combineLatest,
  finalize,
  Subject,
  debounceTime,
  distinctUntilChanged,
} from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import {
  ConfirmDialogComponent,
  SavedSearchDialogComponent,
  ShareSavedSearchDialogComponent,
  type ConfirmDialogData,
} from '@nuxeo-satori/platform/ui';
import {
  SearchService,
  SearchAggregationService,
  SelectionService,
  DocumentDetailService,
  FOLDERISH_TYPES,
  NuxeoApiBase,
  NON_CONTENT_DOCUMENT_TYPES,
  type SearchResultItem,
  type SearchResponse,
  type SearchQueryParams,
  DocTypeLabelPipe,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  aiErrorMessage,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsColumnPickerComponent,
  NxsSpinnerComponent,
  type NxsPickableColumn,
  NxsToastService,
  provideNxsToast,
} from '@nuxeo-satori/platform/components';

export type SortDirection = 'asc' | 'desc' | null;
export type ViewMode = 'grid' | 'table' | 'list';

interface ColumnDef {
  key: string;
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  width: string;
}

interface QuickFilterOption {
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  value: string;
}

/** The columns a search table starts with, and what the picker's Reset returns to. */
const DEFAULT_COLUMN_KEYS: readonly string[] = ['name', 'modified', 'contributor'];

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', labelKey: 'search.column.name', label: 'Title', width: '2fr' },
  { key: 'type', labelKey: 'search.column.type', label: 'Type', width: '1fr' },
  { key: 'modified', labelKey: 'search.column.modified', label: 'Modified', width: '1fr' },
  {
    key: 'contributor',
    labelKey: 'search.column.contributor',
    label: 'Last contributor',
    width: '1.2fr',
  },
  { key: 'state', labelKey: 'search.column.state', label: 'State', width: '1fr' },
  { key: 'version', labelKey: 'search.column.version', label: 'Version', width: '0.8fr' },
  { key: 'created', labelKey: 'search.column.created', label: 'Created', width: '1fr' },
  { key: 'author', labelKey: 'search.column.author', label: 'Author', width: '1fr' },
  { key: 'nature', labelKey: 'search.column.nature', label: 'Nature', width: '1fr' },
  { key: 'coverage', labelKey: 'search.column.coverage', label: 'Coverage', width: '1fr' },
  { key: 'subjects', labelKey: 'search.column.subjects', label: 'Subjects', width: '1fr' },
  { key: 'flags', labelKey: 'search.column.flags', label: 'Flags', width: '1fr' },
];

const QUICK_FILTER_OPTIONS: QuickFilterOption[] = [
  { labelKey: 'search.quick-filter.no-containers', label: 'No Containers', value: 'noFolder' },
  { labelKey: 'search.quick-filter.most-recent', label: 'Most Recent', value: 'mostRecent' },
  { labelKey: 'search.quick-filter.validated', label: 'Validated', value: 'onlyValidated' },
];

// Map display column keys to API field names
const COLUMN_TO_API_FIELD: Record<string, string> = {
  title: 'dc:title',
  name: 'dc:title',
  type: 'dc:type',
  modified: 'dc:modified',
  contributor: 'dc:lastContributor',
  state: 'ecm:currentLifeCycleState',
  version: 'dc:version',
  created: 'dc:created',
  author: 'dc:creator',
  nature: 'dc:nature',
  coverage: 'dc:coverage',
  subjects: 'dc:subjects',
  flags: 'dc:flag',
};

// Reverse map: API field names back to display column keys
const API_FIELD_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_TO_API_FIELD)
    .filter(([key]) => key !== 'title') // prefer 'name' over 'title' for dc:title
    .map(([key, value]) => [value, key]),
);

interface SearchResultViewModel {
  id: string;
  name: string;
  imageUrl: string;
  type: string;
  modifiedDate: string;
  lastContributor: string;
  state?: string;
  version?: string;
  createdDate?: string;
  author: string;
  nature?: string;
  coverage?: string;
  subjects?: string;
  flags?: string;
  icon: string;
}

/**
 * Relative, so it resolves against `<base href>`: the Marketplace package serves the app from
 * `/nuxeo/agentic-ui/`, where a root-absolute path 404s.
 */
const FALLBACK_ART_URL = 'images/Login-background.svg';

function mapToView(item: SearchResultItem): SearchResultViewModel {
  return {
    id: item.id,
    name: item.title,
    imageUrl: FALLBACK_ART_URL,
    type: item.type,
    modifiedDate: item.modifiedDate,
    lastContributor: item.lastContributor,
    state: item.state,
    version: item.version,
    createdDate: item.createdDate,
    author: item.author,
    nature: item.nature,
    coverage: item.coverage,
    subjects: item.subjects ?? item.tags.join(', '),
    flags: item.flags,
    icon: item.icon,
  };
}

@Component({
  selector: 'lib-search',
  standalone: true,
  imports: [
    NxsColumnPickerComponent,
    NxsSpinnerComponent,
    DocTypeLabelPipe,
    DescriptorLabelPipe,
    TranslatePipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatMenuModule,
    MatAutocompleteModule,
    FormsModule,
  ],
  providers: [provideNxsToast()],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class SearchComponent {
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(NxsToastService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchService = inject(SearchService);
  private readonly searchAggregationService = inject(SearchAggregationService);
  private readonly documentDetailService = inject(DocumentDetailService);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);
  readonly selectionService = inject(SelectionService);

  readonly thumbnailMap = signal<Record<string, string | null>>({});
  private thumbnailGeneration = 0;
  /**
   * Sequence for the whole AI request lifecycle — `nlToNxql` *and* the `nxqlSearch` it triggers.
   *
   * One counter spanning both phases, not one per phase. Guarding only the second phase was not
   * enough: a stale `nlToNxql` response still wrote `aiGeneratedNxql`/`aiExplanation` and then
   * started a fresh query that minted its own generation, so the superseded request won. It is also
   * incremented when AI mode is switched off, so an in-flight response cannot re-enable
   * `aiSearchExecuted` or overwrite the restored standard-search thumbnails after the UI has left.
   */
  private aiRequestGeneration = 0;

  // AI Search state
  readonly aiSearchMode = signal(false);
  readonly aiQuery = signal('');
  readonly aiLoading = signal(false);
  readonly aiGeneratedNxql = signal('');
  readonly aiExplanation = signal('');
  readonly aiSuggestions = signal<string[]>([]);
  readonly showNxqlPanel = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly aiResults = signal<SearchResultItem[]>([]);
  readonly aiSearchExecuted = signal(false);
  private readonly aiSuggestSubject = new Subject<string>();

  readonly loading = signal(true);
  /**
   * Loading owned by the AI NXQL request specifically, kept separate from {@link loading}.
   *
   * `loading` belongs to the standard `results$` pipeline, which sets it on every route/filter change.
   * When `runNxqlQuery` also wrote to it, `supersedeAiRequest` had to clear it — and that clear could
   * land while a *standard* search was still in flight, hiding the spinner and rendering the previous
   * results, because every view mode below is gated on `!loading()`. Superseding AI work must only
   * release AI-owned loading, so the two are no longer the same flag.
   */
  readonly aiNxqlLoading = signal(false);
  /** Either request is in flight. What the template gates on, so neither can hide the other's spinner. */
  readonly busy = computed(() => this.loading() || this.aiNxqlLoading());
  readonly error = signal<string | null>(null);
  readonly quickFilterOptions = QUICK_FILTER_OPTIONS;
  readonly selectedQuickFilters = signal<Set<string>>(new Set());
  readonly gridGroupBy = signal<string>('created');
  readonly gridSortOrder = signal<SortDirection>('asc');
  readonly viewMode = signal<ViewMode>('table');
  readonly visibleColumnKeys = signal<string[]>([...DEFAULT_COLUMN_KEYS]);
  readonly columnPanelOpen = signal(false);
  readonly defaultColumnKeys = DEFAULT_COLUMN_KEYS;

  /**
   * The active language as a signal. `translate.instant` is not reactive, so the picker's
   * labels read this to follow a language change.
   */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.currentLang },
  );

  /** Every column as the picker offers it: names resolved for the active language. */
  readonly pickerColumns = computed<readonly NxsPickableColumn[]>(() => {
    this.currentLang();
    const visible = this.visibleColumnKeys();
    return ALL_COLUMNS.map((column) => ({
      key: column.key,
      label: descriptorLabel(column, (key) => this.translate.instant(key)),
      visible: visible.includes(column.key),
    }));
  });
  readonly sortColumn = signal<string | null>(null);
  readonly sortDirection = signal<SortDirection>(null);
  readonly favoriteIds = signal<Set<string>>(new Set());
  readonly favoritePendingIds = signal<Set<string>>(new Set());
  readonly selectedSavedSearchId = this.searchAggregationService.selectedSavedSearchId;
  readonly selectedSavedSearchTitle = this.searchAggregationService.selectedSavedSearchTitle;

  private readonly results$ = combineLatest([
    this.route.queryParamMap,
    toObservable(this.searchAggregationService.drawerFilters),
  ]).pipe(
    tap(() => {
      this.loading.set(true);
      this.error.set(null);
      // Only invalidate the thumbnail batch if the standard results are going to own the displayed
      // thumbnails. This was unconditional, and the response path below deliberately skips
      // `loadThumbnails` while AI results are on screen — so a query-param or drawer-filter change
      // during a completed AI search bumped the generation, killed every AI thumbnail request still in
      // flight, and then loaded nothing to replace them. The thumbnails simply disappeared.
      if (this.standardResultsOwnThumbnails()) this.beginThumbnailBatch();
    }),
    switchMap(([params, drawerFilters]) => {
      const quickFilters = params.get('quickFilters') ?? '';
      this.selectedQuickFilters.set(this.parseQuickFilters(quickFilters));

      // Update sort from query params only if they exist
      const querySortBy = params.get('sortBy');
      const querySortOrderRaw = params.get('sortOrder');
      const querySortOrder: 'asc' | 'desc' | null =
        querySortOrderRaw === 'asc' || querySortOrderRaw === 'desc' ? querySortOrderRaw : null;

      // Map API field name back to UI column key for in-memory sorting/indicators
      const uiSortColumn = querySortBy ? (API_FIELD_TO_COLUMN[querySortBy] ?? querySortBy) : null;
      this.sortColumn.set(uiSortColumn);
      this.sortDirection.set(querySortOrder);

      // Sync grid sort UI from query params so grid view stays in sync with table view
      if (uiSortColumn) {
        this.gridGroupBy.set(uiSortColumn);
      }
      if (querySortOrder) {
        this.gridSortOrder.set(querySortOrder);
      }

      const request: {
        q?: string;
        ecmFulltext?: string;
        quickFilters?: string;
        sortBy?: string | null;
        sortOrder?: ('asc' | 'desc') | null;
        modifiedDate?: string;
        author?: string;
        collection?: string;
        tag?: string;
        nature?: string;
        subjects?: string;
        coverage?: string;
        size?: string;
      } = {};

      // Sort and quick filters still come from URL params
      if (quickFilters.trim()) request.quickFilters = quickFilters;
      if (querySortBy) request.sortBy = querySortBy;
      if (querySortOrder) request.sortOrder = querySortOrder;

      // All drawer filters come from the shared service signal (not URL)
      const q = (drawerFilters['q'] ?? '').trim();
      const ecmFulltext = (drawerFilters['ecm_fulltext'] ?? '').trim();
      const modifiedDate = (drawerFilters['modifiedDate'] ?? '').trim();
      const author = (drawerFilters['author'] ?? '').trim();
      const collection = (drawerFilters['collection'] ?? '').trim();
      const tag = (drawerFilters['tag'] ?? '').trim();
      const nature = (drawerFilters['nature'] ?? '').trim();
      const subjects = (drawerFilters['subjects'] ?? '').trim();
      const coverage = (drawerFilters['coverage'] ?? '').trim();
      const size = (drawerFilters['size'] ?? '').trim();

      if (q) request.q = q;
      if (ecmFulltext) request.ecmFulltext = ecmFulltext;
      if (modifiedDate) request.modifiedDate = modifiedDate;
      if (author) request.author = author;
      if (collection) request.collection = collection;
      if (tag) request.tag = tag;
      if (nature) request.nature = nature;
      if (subjects) request.subjects = subjects;
      if (coverage) request.coverage = coverage;
      if (size) request.size = size;

      return this.searchService.search(request as SearchQueryParams).pipe(
        tap((response: SearchResponse) => {
          if (this.searchAggregationService?.aggregations?.set) {
            this.searchAggregationService.aggregations.set(response.aggregations);
          }
          if (this.searchAggregationService?.items?.set) {
            this.searchAggregationService.items.set(response.items);
          }
          this.favoriteIds.set(
            new Set(response.items.filter((item) => item.isFavorite).map((item) => item.id)),
          );
        }),
        map((response) => response.items),
        tap((items) => {
          this.loading.set(false);
          if (this.standardResultsOwnThumbnails()) {
            this.loadThumbnails(items);
          }
        }),
        catchError(() => {
          this.searchAggregationService.aggregations.set({});
          this.searchAggregationService.items.set([]);
          this.error.set(this.translate.instant('search.message.failed-to-load-search-results'));
          this.loading.set(false);
          return of<SearchResultItem[]>([]);
        }),
      );
    }),
  );

  readonly results = toSignal(this.results$, { initialValue: [] as SearchResultItem[] });

  readonly visibleColumns = computed(() =>
    ALL_COLUMNS.filter((c) => this.visibleColumnKeys().includes(c.key)),
  );

  readonly gridTemplate = computed(() =>
    ['40px', ...this.visibleColumns().map((c) => c.width), '40px'].join(' '),
  );

  readonly filteredResults = computed(() => {
    const source =
      this.aiSearchMode() && this.aiSearchExecuted() ? this.aiResults() : this.results();
    return source.map(mapToView);
  });

  readonly displayResults = computed(() => this.filteredResults());

  readonly sortedResults = computed(() => {
    const rows = [...this.displayResults()];
    const col = this.sortColumn();
    const dir = this.sortDirection();
    if (!col || !dir) return rows;
    return rows.sort((a, b) => {
      const aVal = this.getCellValue(a, col).toLowerCase();
      const bVal = this.getCellValue(b, col).toLowerCase();
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  });

  readonly resultCount = computed(() => this.displayResults().length);
  readonly selectedCount = computed(() => this.selectionService.selectedCount());
  readonly SORTABLE_COLUMNS = new Set(['name', 'modified', 'contributor', 'author', 'created']);

  readonly isAllSelected = computed(() => {
    const rows = this.displayResults();
    return this.selectionService.isAllSelected(rows.map((r) => r.id));
  });

  readonly isIndeterminate = computed(() => {
    const rows = this.displayResults();
    return this.selectionService.isIndeterminate(rows.map((r) => r.id));
  });

  isQuickFilterSelected(value: string): boolean {
    return this.selectedQuickFilters().has(value);
  }

  toggleQuickFilter(value: string): void {
    const next = new Set(this.selectedQuickFilters());
    if (next.has(value)) next.delete(value);
    else next.add(value);

    this.selectedQuickFilters.set(next);

    const orderedSelected = QUICK_FILTER_OPTIONS.map((filter) => filter.value).filter(
      (filterValue) => next.has(filterValue),
    );

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { quickFilters: orderedSelected.length > 0 ? orderedSelected.join(',') : null },
      queryParamsHandling: 'merge',
    });
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  openDocument(uid: string): void {
    if (!uid) return;
    const item = this.results().find((r) => r.id === uid);
    if (item?.type === 'Collection') {
      void this.router.navigateByUrl(`/collections/${uid}`);
      return;
    }
    if (item && FOLDERISH_TYPES.has(item.type) && item.path) {
      void this.router.navigateByUrl(`/browse${item.path}`);
      return;
    }
    void this.router.navigateByUrl(`/doc/${uid}`);
  }

  isSelected(id: string): boolean {
    return this.selectionService.isSelected(id);
  }

  toggleSelection(id: string): void {
    const row = this.displayResults().find((r) => r.id === id);
    this.selectionService.toggle(id, row?.name ?? id, this.thumbnailMap()[id] ?? null);
  }

  toggleAll(): void {
    if (this.isAllSelected()) {
      this.selectionService.clear();
    } else {
      const rows = this.displayResults();
      const labels: Record<string, string> = {};
      const previews: Record<string, string | null> = {};
      rows.forEach((row) => {
        labels[row.id] = row.name;
        previews[row.id] = this.thumbnailMap()[row.id] ?? null;
      });
      this.selectionService.selectAll(
        rows.map((r) => r.id),
        labels,
        previews,
      );
    }
  }

  deleteSelected(): void {
    this.selectionService
      .deleteSelected()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () =>
          this.router.navigate([], { relativeTo: this.route, queryParamsHandling: 'merge' }),
      });
  }

  clearSelection(): void {
    this.selectionService.clear();
  }

  openColumnPanel(): void {
    this.columnPanelOpen.set(true);
  }

  closeColumnPanel(): void {
    this.columnPanelOpen.set(false);
  }

  /** The picker's Done: the keys to show, in column order. */
  applyColumns(keys: readonly string[]): void {
    this.visibleColumnKeys.set([...keys]);
    this.columnPanelOpen.set(false);
  }

  sortBy(col: string): void {
    if (!this.SORTABLE_COLUMNS.has(col)) return;

    let newSortColumn: string | null = col;
    let newSortDirection: SortDirection = 'asc';

    if (this.sortColumn() === col) {
      if (this.sortDirection() === 'asc') {
        newSortDirection = 'desc';
      } else if (this.sortDirection() === 'desc') {
        newSortColumn = null;
        newSortDirection = null;
      }
    }

    this.sortColumn.set(newSortColumn);
    this.sortDirection.set(newSortDirection);

    // Map the display column key to API field name
    const apiFieldName = newSortColumn ? COLUMN_TO_API_FIELD[newSortColumn] : null;

    // Update route query parameters to trigger API call
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: apiFieldName || null,
        sortOrder: newSortDirection || null,
      },
      queryParamsHandling: 'merge',
    });
  }

  getCellValue(row: SearchResultViewModel, key: string): string {
    switch (key) {
      case 'name':
        return row.name;
      case 'type':
        return row.type;
      case 'modified':
        return row.modifiedDate;
      case 'contributor':
        return row.lastContributor;
      case 'author':
        return row.author;
      case 'state':
        return row.state ?? '—';
      case 'version':
        return row.version ?? '—';
      case 'created':
        return row.createdDate ?? '—';
      case 'nature':
        return row.nature ?? '—';
      case 'coverage':
        return row.coverage ?? '—';
      case 'subjects':
        return row.subjects ?? '—';
      case 'flags':
        return row.flags ?? '—';
      default:
        return '';
    }
  }

  exportCsv(): void {
    const headers = [
      'Title',
      'Type',
      'Modified',
      'Last Contributor',
      'State',
      'Version',
      'Created',
      'Author',
      'Nature',
      'Coverage',
      'Subjects',
      'Flags',
    ];
    const escape = (value: string): string => `"${value.replaceAll('"', '""')}"`;
    const rows = this.sortedResults().map((row) => [
      row.name,
      row.type,
      row.modifiedDate,
      row.lastContributor,
      row.state ?? '—',
      row.version ?? '—',
      row.createdDate ?? '—',
      row.author,
      row.nature ?? '—',
      row.coverage ?? '—',
      row.subjects ?? '—',
      row.flags ?? '—',
    ]);

    const csv = [headers, ...rows]
      .map((line) => line.map((cell) => escape(cell ?? '')).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'search-results.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    img.src = FALLBACK_ART_URL;
  }

  toggleFavorite(id: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (!id || this.favoritePendingIds().has(id)) return;

    const isCurrentlyFavorite = this.favoriteIds().has(id);
    this.favoritePendingIds.update((current) => new Set(current).add(id));

    const op = isCurrentlyFavorite
      ? this.documentDetailService.removeFromFavorites(id)
      : this.documentDetailService.addToFavorites(id);

    op.pipe(
      finalize(() => {
        this.favoritePendingIds.update((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.favoriteIds.update((current) => {
          const next = new Set(current);
          if (isCurrentlyFavorite) next.delete(id);
          else next.add(id);
          return next;
        });
        window.dispatchEvent(new Event('favorites-changed'));
      },
      error: (err) => {
        this.toast.error(
          this.getApiErrorMessage(
            err,
            this.translate.instant('search.message.failed-to-update-favorites'),
          ),
          { duration: 5000 },
        );
      },
    });
  }

  private getApiErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string' && err.trim().length > 0) return err;

    const maybeObj = err as { error?: { message?: string }; message?: string } | null;
    const apiMessage = maybeObj?.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) return apiMessage;

    const defaultMessage = maybeObj?.message;
    if (typeof defaultMessage === 'string' && defaultMessage.trim().length > 0)
      return defaultMessage;

    return fallback;
  }

  isFavorited(id: string): boolean {
    return this.favoriteIds().has(id);
  }

  downloadDocument(id: string, name: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (!id) return;

    const row = this.displayResults().find((r) => r.id === id);
    if (row && !this.isDownloadableType(row.type)) {
      return;
    }

    this.documentDetailService
      .fetchBlob(id, { clientReason: 'download' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = this.buildDownloadFileName(name, blob.type);
          anchor.click();
          URL.revokeObjectURL(objectUrl);
        },
        error: (err) => {
          this.toast.error(
            this.getApiErrorMessage(
              err,
              this.translate.instant('search.message.failed-to-download-document'),
            ),
            { duration: 5000 },
          );
        },
      });
  }

  isDownloadableType(type: string): boolean {
    const normalized = type.trim().toLowerCase();
    return normalized.length > 0 && !NON_CONTENT_DOCUMENT_TYPES.has(normalized);
  }

  private buildDownloadFileName(name: string, mimeType: string): string {
    const trimmed = name.trim() || 'document';
    // Keep existing extension if present.
    if (/\.[a-z0-9]+$/i.test(trimmed)) return trimmed;

    const extensionByMime: Record<string, string> = {
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'text/csv': 'csv',
      'application/json': 'json',
      'application/xml': 'xml',
      'text/xml': 'xml',
      'application/zip': 'zip',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
    };

    const ext = extensionByMime[mimeType.toLowerCase()];
    return ext ? `${trimmed}.${ext}` : trimmed;
  }

  setGridGroupBy(value: string): void {
    this.gridGroupBy.set(value);

    // Dropdown-triggered sorting should default to ascending.
    this.gridSortOrder.set('asc');

    const apiFieldName = COLUMN_TO_API_FIELD[value] ?? null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: apiFieldName,
        sortOrder: 'asc',
      },
      queryParamsHandling: 'merge',
    });
  }

  setGridSortOrder(direction: SortDirection): void {
    const effectiveDirection: 'asc' | 'desc' = direction === 'asc' ? 'asc' : 'desc';
    this.gridSortOrder.set(effectiveDirection);

    const apiFieldName = COLUMN_TO_API_FIELD[this.gridGroupBy()] ?? null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: apiFieldName,
        sortOrder: effectiveDirection,
      },
      queryParamsHandling: 'merge',
    });
  }

  private parseQuickFilters(value: string): Set<string> {
    const allowed = new Set(QUICK_FILTER_OPTIONS.map((f) => f.value));
    return new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => allowed.has(v)),
    );
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
            params: this.buildSavedSearchParamsFromFilters(),
            pageProviderName: 'default_search',
          })
          .subscribe({
            next: (saved) => {
              this.searchAggregationService.selectedSavedSearchId.set(
                this.readSavedSearchId(saved),
              );
              this.searchAggregationService.selectedSavedSearchTitle.set(
                this.readSavedSearchTitle(saved) || trimmedTitle,
              );
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

  hasSelectedSavedSearch(): boolean {
    return this.selectedSavedSearchId().trim().length > 0;
  }

  hasSavableFilters(): boolean {
    return Object.keys(this.buildSavedSearchParamsFromFilters()).length > 0;
  }

  onSaveSelectedSavedSearch(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    const currentTitle =
      this.selectedSavedSearchTitle().trim() || this.translate.instant('ui.saved-search');
    this.searchService
      .updateSavedSearch(id, {
        title: currentTitle,
        params: this.buildSavedSearchParamsFromFilters(),
        pageProviderName: 'default_search',
      })
      .subscribe({
        next: () => {
          this.searchAggregationService.selectedSavedSearchTitle.set(currentTitle);
          this.searchAggregationService.markSavedSearchDirty();
          this.toast.show(this.translate.instant('common.search-updated', { name: currentTitle }));
        },
        error: () => {
          this.toast.error(this.translate.instant('assets.message.failed-to-save-search'), {
            duration: 5000,
          });
        },
      });
  }

  onEditSelectedSavedSearch(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    this.dialog
      .open(SavedSearchDialogComponent, {
        data: {
          title: this.translate.instant('ui.edit-saved-search'),
          placeholder: this.translate.instant('saved-search.dialog.name-placeholder'),
          initialValue: this.selectedSavedSearchTitle(),
        },
      })
      .afterClosed()
      .subscribe((title) => {
        const trimmedTitle = title?.trim();
        if (!trimmedTitle) return;

        this.searchService
          .updateSavedSearch(id, {
            title: trimmedTitle,
            params: this.buildSavedSearchParamsFromFilters(),
            pageProviderName: 'default_search',
          })
          .subscribe({
            next: () => {
              this.searchAggregationService.selectedSavedSearchTitle.set(trimmedTitle);
              this.searchAggregationService.markSavedSearchDirty();
              this.toast.show(
                this.translate.instant('common.search-updated', { name: trimmedTitle }),
              );
            },
            error: () => {
              this.toast.error(this.translate.instant('assets.message.failed-to-update-search'), {
                duration: 5000,
              });
            },
          });
      });
  }

  onShareSelectedSavedSearch(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    this.dialog.open(ShareSavedSearchDialogComponent, {
      width: '95vw',
      maxWidth: '1080px',
      data: {
        title: this.selectedSavedSearchTitle().trim() || this.translate.instant('ui.saved-search'),
        id,
      },
    });
  }

  onDeleteSelectedSavedSearch(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    const title = this.selectedSavedSearchTitle().trim() || 'this saved search';
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.delete-saved-search'),
        message: this.translate.instant('confirm.delete-saved-search-named', { name: title }),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.searchService
          .deleteSavedSearch(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.searchAggregationService.selectedSavedSearchId.set('');
              this.searchAggregationService.selectedSavedSearchTitle.set('');
              this.searchAggregationService.drawerFilters.set({});
              this.searchAggregationService.markSavedSearchDirty();
            },
            error: (error) => {
              console.error('Failed to delete saved search.', error);
            },
          });
      });
  }

  private buildSavedSearchParamsFromFilters(): Record<string, string> {
    const drawerFilters = this.searchAggregationService.drawerFilters();
    const saved: Record<string, string> = {};

    for (const [key, value] of Object.entries(drawerFilters)) {
      const trimmed = value.trim();
      if (trimmed) saved[key] = trimmed;
    }

    return saved;
  }

  private readSavedSearchId(saved: unknown): string {
    if (!saved || typeof saved !== 'object') return '';
    const obj = saved as Record<string, unknown>;
    return typeof obj['id'] === 'string' ? obj['id'] : '';
  }

  private readSavedSearchTitle(saved: unknown): string {
    if (!saved || typeof saved !== 'object') return '';
    const obj = saved as Record<string, unknown>;
    return typeof obj['title'] === 'string' ? obj['title'] : '';
  }

  constructor() {
    this.destroyRef.onDestroy(() => this.clearThumbnails());

    this.aiSuggestSubject
      .pipe(
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.length < 3) return of({ suggestions: [] as string[] });
          return this.aiGateway
            .nlToNxqlSuggestions(q)
            .pipe(catchError(() => of({ suggestions: [] as string[] })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.aiSuggestions.set(res.suggestions));
  }

  toggleAiSearch(): void {
    const next = !this.aiSearchMode();
    this.aiSearchMode.set(next);
    if (!next) {
      // Invalidate any in-flight AI request before restoring standard state. Without this a late
      // `nlToNxql` or `nxqlSearch` response re-enabled `aiSearchExecuted` and overwrote the standard
      // thumbnail batch loaded just below, while the UI was already back in standard mode.
      //
      // Via `supersedeAiRequest` rather than a bare increment, because the invalidation alone left
      // `loading` set by a pending `runNxqlQuery` — so leaving AI mode restored the standard results
      // behind a spinner that would never clear.
      this.supersedeAiRequest();
      this.resetAiSearchState();
      this.beginThumbnailBatch();
      this.loadThumbnails(this.results());
    }
  }

  onAiQueryInput(value: string): void {
    this.aiQuery.set(value);
    this.aiSuggestSubject.next(value);
  }

  selectAiSuggestion(suggestion: string): void {
    this.aiQuery.set(suggestion);
    this.aiSuggestions.set([]);
    this.executeAiSearch();
  }

  /**
   * Mints a new AI request generation **and** releases the loading state the superseded work owned.
   *
   * The two halves are inseparable, which is why this is a function rather than two lines at each
   * call site. A generation guard makes the superseded callbacks `return` early — so everything they
   * would have cleared on the way out never gets cleared, and the page sits behind a spinner that no
   * longer has a request behind it.
   *
   * I have now made exactly this mistake three times in this PR: `taskLoading` in the tasks page, and
   * both of these call sites. Each time the guard was added and the release was not. Stating it once
   * here is the only version that stops the fourth.
   */
  /**
   * Whether the standard search results are what the user is looking at.
   *
   * One predicate for two sites that must agree: the `tap` that invalidates the thumbnail batch, and
   * the response handler that loads it. They were written as separate expressions — an unconditional
   * `beginThumbnailBatch()` and a guarded `loadThumbnails` — so a standard search fired while AI results
   * were displayed invalidated the AI thumbnails and then loaded no replacement. Invalidating a batch
   * nobody is going to refill is strictly worse than leaving it alone.
   */
  private standardResultsOwnThumbnails(): boolean {
    return !this.aiSearchMode() || !this.aiSearchExecuted();
  }

  private supersedeAiRequest(): number {
    const generation = ++this.aiRequestGeneration;
    // Only AI-owned flags. `loading` belongs to the standard pipeline; clearing it here hid the
    // spinner for a standard search that was still running — see `aiNxqlLoading`.
    this.aiNxqlLoading.set(false);
    this.aiLoading.set(false);
    return generation;
  }

  executeAiSearch(): void {
    const query = this.aiQuery().trim();
    if (!query) return;

    // Supersedes any in-flight AI request and releases its loading state: an NXQL request already
    // running had set `loading`, and its callbacks are about to start returning at the guard.
    const generation = this.supersedeAiRequest();
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiGeneratedNxql.set('');
    this.aiExplanation.set('');

    this.aiGateway
      .nlToNxql(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.aiRequestGeneration) return;
          this.aiGeneratedNxql.set(res.nxql);
          this.aiExplanation.set(res.explanation);
          this.showNxqlPanel.set(true);
          this.runNxqlQuery(res.nxql, generation);
        },
        error: (err) => {
          if (generation !== this.aiRequestGeneration) return;
          this.aiError.set(
            aiErrorMessage(
              err,
              this.translate.instant('search.message.ai-search-failed-try-again'),
            ),
          );
          this.aiLoading.set(false);
        },
      });
  }

  /**
   * `generation` is minted by the caller so one value covers both AI phases — see
   * {@link aiRequestGeneration}. The standard search path in this file is driven through `switchMap`
   * and cancels its predecessor; this one subscribes imperatively, so it needs the comparison.
   */
  private runNxqlQuery(nxql: string, generation: number): void {
    // `aiNxqlLoading`, not `loading` — this request does not own the standard pipeline's flag.
    this.aiNxqlLoading.set(true);
    // Deliberately does NOT claim the thumbnail batch. The standard results stay on screen until this
    // request succeeds, and `loadThumbnails` mints its own generation when it does — so claiming here
    // only mattered if the request FAILED, in which case every standard thumbnail response still in
    // flight was discarded by the generation check and the error path reloaded none of them. Permanent
    // missing thumbnails, from invalidating a batch this method might never refill.
    //
    // Same rule as the standard tap above: only invalidate a batch you are going to own.
    this.nuxeoApi
      .nxqlSearch(nxql, 40, {
        properties: 'dublincore,file,common',
        'enrichers.document': 'favorites',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (generation !== this.aiRequestGeneration) return;
          const items: SearchResultItem[] = (result.entries ?? []).map((doc) => ({
            id: doc.uid,
            title: doc.title,
            type: doc.type,
            modifiedDate: doc.lastModified ?? '',
            lastContributor: String(doc.properties?.['dc:lastContributor'] ?? ''),
            state: doc.state ?? '',
            version: String(doc.properties?.['uid:major_version'] ?? ''),
            createdDate: String(doc.properties?.['dc:created'] ?? ''),
            author: String(doc.properties?.['dc:creator'] ?? ''),
            authorKey: String(doc.properties?.['dc:creator'] ?? ''),
            nature: String(doc.properties?.['dc:nature'] ?? ''),
            coverage: String(doc.properties?.['dc:coverage'] ?? ''),
            subjects: ((doc.properties?.['dc:subjects'] as string[]) ?? []).join(', '),
            collection: '',
            collectionKey: '',
            tags: [],
            flags: '',
            icon: 'description',
            isFavorite: doc.contextParameters?.favorites?.isFavorite ?? false,
          }));
          this.aiResults.set(items);
          this.aiSearchExecuted.set(true);
          this.aiNxqlLoading.set(false);
          this.aiLoading.set(false);
          this.loadThumbnails(items);
        },
        error: () => {
          // Guarded too: a stale failure would otherwise replace a newer query's results with an
          // error banner and clear its loading state.
          if (generation !== this.aiRequestGeneration) return;
          this.aiError.set(
            this.translate.instant(
              'search.message.nxql-query-execution-failed-the-generated-query',
            ),
          );
          this.aiNxqlLoading.set(false);
          this.aiLoading.set(false);
        },
      });
  }

  private loadThumbnails(items: SearchResultItem[]): void {
    // Mint a new generation rather than reading the current one. Reading it let two loaders share
    // a generation — a standard search and an AI search can both resolve under the same
    // `beginThumbnailBatch()` — so the first load's in-flight callbacks still matched
    // `this.thumbnailGeneration` after the second call's `clearThumbnails()` and repopulated the
    // map with thumbnails belonging to the previous result set.
    const generation = ++this.thumbnailGeneration;
    this.clearThumbnails();
    for (const item of items) {
      this.documentDetailService
        .fetchThumbnail(item.id)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob || generation !== this.thumbnailGeneration) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((m) => {
            const previous = m[item.id];
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return {
              ...m,
              [item.id]: url,
            };
          });
        });
    }
  }

  private beginThumbnailBatch(): void {
    this.thumbnailGeneration += 1;
  }

  private clearThumbnails(): void {
    // Drop the selection layer's copies FIRST. It retains these exact strings and binds them into
    // `<img [src]>` in the shell topbar, and selection survives a new search — so revoking without
    // this leaves selected items pointing at revoked blob URLs. See `SelectionService.forgetPreviews`.
    this.selectionService.forgetPreviews();
    for (const url of Object.values(this.thumbnailMap())) if (url) URL.revokeObjectURL(url);
    this.thumbnailMap.set({});
  }

  private resetAiSearchState(): void {
    this.aiQuery.set('');
    this.aiGeneratedNxql.set('');
    this.aiExplanation.set('');
    this.aiSuggestions.set([]);
    this.aiError.set(null);
    this.showNxqlPanel.set(false);
    this.aiResults.set([]);
    this.aiSearchExecuted.set(false);
    this.aiLoading.set(false);
  }
}
