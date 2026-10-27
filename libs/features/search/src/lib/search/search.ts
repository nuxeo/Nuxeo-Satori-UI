import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  DescriptorLabelPipe,
  ExtensionOutletComponent,
  descriptorLabel,
} from '@nuxeo/satori-platform/extensions';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  type Observable,
  switchMap,
  catchError,
  of,
  map,
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
  ShareSavedSearchDialogComponent,
  type ConfirmDialogData,
} from '@nuxeo/satori-platform/ui';
import {
  SelectionService,
  DocumentDetailService,
  FOLDERISH_TYPES,
  NuxeoApiBase,
  NON_CONTENT_DOCUMENT_TYPES,
  type SearchResultItem,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  aiErrorMessage,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NXS_PRIMITIVE_IDS,
  NxsCardComponent,
  NxsColumnPickerComponent,
  NxsErrorStateComponent,
  NxsFavoriteToggleComponent,
  NxsPagerComponent,
  NxsSavedSearchActionsComponent,
  NxsSpinnerComponent,
  NxsThumbnailComponent,
  nxsErrorStatus,
  provideNxsThumbnailCache,
  type NxsErrorStatus,
  type NxsPickableColumn,
  NxsToastService,
  nxsVisibleText,
  provideNxsToast,
} from '@nuxeo/satori-platform/components';

import { askSavedSearchName } from '../search-session/saved-search-dialogs';
import {
  SEARCH_PAGE_SIZE,
  SearchSession,
  type SearchResultsState,
} from '../search-session/search-session';

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
    ExtensionOutletComponent,
    NxsCardComponent,
    NxsColumnPickerComponent,
    NxsErrorStateComponent,
    NxsFavoriteToggleComponent,
    NxsPagerComponent,
    NxsSavedSearchActionsComponent,
    NxsSpinnerComponent,
    NxsThumbnailComponent,
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
  providers: [provideNxsToast(), provideNxsThumbnailCache()],
  templateUrl: './search.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './search.scss',
})
export class SearchComponent {
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(NxsToastService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SearchSession);
  private readonly documentDetailService = inject(DocumentDetailService);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);
  readonly selectionService = inject(SelectionService);

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

  /** The shared search's state: `SearchSession` runs the one request this page and the drawer show. */
  private readonly resultsState = toSignal(this.session.results$, {
    initialValue: {
      status: 'loading',
      items: [],
      aggregations: {},
      totalSize: -1,
      hasNextPage: false,
      error: null,
    } as SearchResultsState,
  });
  readonly loading = computed(() => this.resultsState().status === 'loading');
  /**
   * Loading owned by the AI NXQL request specifically, kept separate from {@link loading}.
   *
   * `loading` belongs to the standard search, which `SearchSession` runs on every route/filter
   * change. When `runNxqlQuery` also wrote to it, `supersedeAiRequest` had to clear it — and that
   * clear could land while a *standard* search was still in flight, hiding the spinner and rendering
   * the previous results, because every view mode below is gated on `!loading()`. Superseding AI work
   * must only release AI-owned loading, so the two are no longer the same flag.
   */
  readonly aiNxqlLoading = signal(false);
  /** Either request is in flight. What the template gates on, so neither can hide the other's spinner. */
  readonly busy = computed(() => this.loading() || this.aiNxqlLoading());
  readonly error = computed(() =>
    this.resultsState().status === 'failed'
      ? this.translate.instant('search.message.failed-to-load-search-results')
      : null,
  );
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
    { initialValue: this.translate.getCurrentLang() ?? 'en' },
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
  readonly selectedSavedSearchId = this.session.savedSearchId;
  readonly selectedSavedSearchTitle = this.session.savedSearchTitle;
  /** Whether the filters differ from the open saved search's: Save is offered only then. */
  readonly savedSearchDirty = this.session.dirty;
  readonly hasFilters = this.session.hasFilters;

  /** Which error state `error` shows: the status of the search request that failed. */
  readonly errorStatus = computed<NxsErrorStatus>(() => nxsErrorStatus(this.resultsState().error));
  /**
   * The standard search's failure, while its results are the ones on screen. `error` belongs to the
   * standard search and outlives an AI search, whose results must not be hidden behind it.
   */
  readonly resultsError = computed(() =>
    this.aiSearchMode() && this.aiSearchExecuted() ? null : this.error(),
  );

  readonly results = computed(() => this.resultsState().items as SearchResultItem[]);

  /** Run the failed search again, with the same query and filters. */
  retrySearch(): void {
    this.session.retry();
  }

  /**
   * The URL's quick filters and sort: shown here, and handed to the session as part of the query.
   */
  private applyPageQuery(params: { get(name: string): string | null }): void {
    const quickFilters = params.get('quickFilters') ?? '';
    this.selectedQuickFilters.set(this.parseQuickFilters(quickFilters));

    const sortBy = params.get('sortBy');
    const sortOrderRaw = params.get('sortOrder');
    const sortOrder: 'asc' | 'desc' | null =
      sortOrderRaw === 'asc' || sortOrderRaw === 'desc' ? sortOrderRaw : null;

    // Map API field name back to UI column key for in-memory sorting/indicators
    const uiSortColumn = sortBy ? (API_FIELD_TO_COLUMN[sortBy] ?? sortBy) : null;
    this.sortColumn.set(uiSortColumn);
    this.sortDirection.set(sortOrder);

    // Sync grid sort UI from query params so grid view stays in sync with table view
    if (uiSortColumn) this.gridGroupBy.set(uiSortColumn);
    if (sortOrder) this.gridSortOrder.set(sortOrder);

    this.session.setPageQuery({ quickFilters: quickFilters.trim(), sortBy, sortOrder });

    // The URL counts pages from one; the session from zero. No `page` means the first.
    const page = Number.parseInt(params.get('page') ?? '', 10);
    this.urlPageIndex = Number.isFinite(page) && page > 1 ? page - 1 : 0;
    this.session.setPageIndex(this.urlPageIndex);
  }

  /**
   * The pager asked for another page. The request and the URL both follow the session.
   *
   * Ignored while a page loads. The pager still shows the last answer then, so the page it names
   * can be out of date: after a filter change it would ask for a page of the new query that the
   * reset has already moved past. The control stays enabled, so it keeps keyboard focus.
   */
  goToPage(pageIndex: number): void {
    if (this.resultsState().status === 'loading') return;
    this.session.setPageIndex(pageIndex);
  }

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

  /** Each card in the grid view is rendered by ID, so a component registered under it replaces them. */
  readonly cardId = NXS_PRIMITIVE_IDS.card;

  /**
   * The grid view's cards, each with its own open and selection callbacks.
   *
   * The outlet that renders a card by ID binds no outputs, so the callbacks reach the card as
   * inputs. They are made here, once per result set, rather than in the template, so a card's inputs
   * keep their identity from one change detection to the next and the outlet does not re-set them.
   */
  readonly gridCards = computed(() =>
    this.displayResults().map((row) => ({
      row,
      // Never blank, so the card's controls are never unnamed: a result with no title by its ID.
      name: nxsVisibleText(row.name) || row.id,
      open: () => this.openDocument(row.id),
      select: () => this.toggleSelection(row.id),
    })),
  );

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
  /** Every match the server counted, or the rows on screen when it counted none. */
  readonly totalCount = computed(() => {
    // An AI search's rows are not the standard search's results, so its total is not theirs.
    // An AI search's rows are not the standard search's results, so its total is not theirs.
    if (this.aiSearchMode() && this.aiSearchExecuted()) return this.resultCount();
    const total = this.resultsState().totalSize;
    return total >= 0 ? total : this.resultCount();
  });
  readonly pageSize = SEARCH_PAGE_SIZE;
  /**
   * The paging of the last answer, which the pager reads. It stays on screen while the next page
   * loads: a control removed while focused loses the keyboard user's place.
   */
  readonly pager = signal({ pageIndex: 0, itemCount: 0, totalSize: -1, hasNextPage: false });
  /** The page the URL asked for, as the last applied URL; the URL follows the pager through it. */
  private urlPageIndex = 0;
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
      queryParams: {
        quickFilters: orderedSelected.length > 0 ? orderedSelected.join(',') : null,
        page: null,
      },
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
    this.selectionService.toggle(id, row?.name ?? id);
  }

  toggleAll(): void {
    if (this.isAllSelected()) {
      this.selectionService.clear();
    } else {
      const rows = this.displayResults();
      const labels: Record<string, string> = {};
      rows.forEach((row) => {
        labels[row.id] = row.name;
      });
      this.selectionService.selectAll(
        rows.map((r) => r.id),
        labels,
      );
    }
  }

  deleteSelected(): void {
    this.selectionService
      .deleteSelected()
      .pipe(takeUntilDestroyed(this.destroyRef))
      // The same query again, so the deleted documents leave the results.
      .subscribe({ next: () => this.session.retry() });
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
        page: null,
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

  /** A result's star confirmed a change: keep the page's view of it in step. */
  onFavoriteChanged(id: string, favorite: boolean): void {
    this.favoriteIds.update((current) => {
      const next = new Set(current);
      if (favorite) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  onFavoriteFailed(error: unknown): void {
    this.toast.error(
      this.getApiErrorMessage(
        error,
        this.translate.instant('search.message.failed-to-update-favorites'),
      ),
      { duration: 5000 },
    );
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
        page: null,
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
        page: null,
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

  /** Save the filters as a new saved search, under a name the user gives. */
  onSaveAs(): void {
    this.withSavedSearchName({ heading: this.translate.instant('ui.saved-search') }, (name) =>
      this.session.saveAs(name).pipe(map(() => name)),
    ).subscribe({
      next: (name) => this.toast.show(this.translate.instant('common.search-saved', { name })),
      error: () => this.savedSearchFailed('assets.message.failed-to-save-search'),
    });
  }

  /** Save the filters into the open saved search. */
  onSave(): void {
    const name = this.selectedSavedSearchTitle().trim();
    this.session
      .save()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toast.show(this.translate.instant('common.search-updated', { name })),
        error: () => this.savedSearchFailed('assets.message.failed-to-save-search'),
      });
  }

  /** Rename the open saved search. Its stored filters stay as they are, as in Web UI. */
  onRename(): void {
    this.withSavedSearchName(
      {
        heading: this.translate.instant('ui.edit-saved-search'),
        initial: this.selectedSavedSearchTitle(),
      },
      (name) => this.session.rename(name).pipe(map(() => name)),
    ).subscribe({
      next: (name) => this.toast.show(this.translate.instant('common.search-updated', { name })),
      error: () => this.savedSearchFailed('assets.message.failed-to-update-search'),
    });
  }

  onShare(): void {
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

  /** Delete the open saved search, once the user confirms. */
  onDelete(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    const title =
      this.selectedSavedSearchTitle().trim() || this.translate.instant('ui.saved-search');
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: this.translate.instant('confirm.delete-saved-search'),
          message: this.translate.instant('confirm.delete-saved-search-named', { name: title }),
          confirmLabel: this.translate.instant('confirm.delete'),
        } as ConfirmDialogData,
      })
      .afterClosed()
      .pipe(
        switchMap((confirmed) => (confirmed ? this.session.deleteSavedSearch() : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: () => this.savedSearchFailed('search.message.failed-to-delete-saved-search'),
      });
  }

  /** Asks for a name, then runs `run` with it; nothing happens when the dialog is dismissed. */
  private withSavedSearchName<T>(
    options: { heading: string; initial?: string },
    run: (name: string) => Observable<T>,
  ): Observable<T> {
    return askSavedSearchName(this.dialog, this.translate, options).pipe(
      switchMap(run),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  private savedSearchFailed(key: string): void {
    this.toast.error(this.translate.instant(key), { duration: 5000 });
  }

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.applyPageQuery(params));

    // Each answer's paging, for the pager. Only an answer moves it: a page being loaded does not.
    effect(() => {
      const state = this.resultsState();
      if (state.status !== 'loaded') return;
      untracked(() =>
        this.pager.set({
          pageIndex: this.session.pageIndex(),
          itemCount: state.items.length,
          totalSize: state.totalSize,
          hasNextPage: state.hasNextPage,
        }),
      );
    });

    // The page on screen is kept in the URL, so a deep link reopens it. A page the pager or a
    // filter change moved to is written back, replacing the history entry rather than adding one.
    effect(() => {
      const pageIndex = this.session.pageIndex();
      untracked(() => {
        if (pageIndex === this.urlPageIndex) return;
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { page: pageIndex > 0 ? pageIndex + 1 : null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    // The favourites enricher says which results are favourites; a star's own change is then kept
    // in `favoriteIds` until the next answer.
    effect(() => {
      const state = this.resultsState();
      if (state.status === 'loading') return;
      untracked(() =>
        this.favoriteIds.set(
          new Set(state.items.filter((item) => item.isFavorite).map((item) => item.id)),
        ),
      );
    });

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
      // `nlToNxql` or `nxqlSearch` response re-enabled `aiSearchExecuted` and put AI results back on
      // screen while the UI was already back in standard mode.
      //
      // Via `supersedeAiRequest` rather than a bare increment, because the invalidation alone left
      // `loading` set by a pending `runNxqlQuery` — so leaving AI mode restored the standard results
      // behind a spinner that would never clear.
      this.supersedeAiRequest();
      this.resetAiSearchState();
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
            icon: 'page',
            isFavorite: doc.contextParameters?.favorites?.isFavorite ?? false,
          }));
          this.aiResults.set(items);
          this.aiSearchExecuted.set(true);
          this.aiNxqlLoading.set(false);
          this.aiLoading.set(false);
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
