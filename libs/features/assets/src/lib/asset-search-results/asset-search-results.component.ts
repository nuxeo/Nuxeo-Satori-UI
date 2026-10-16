import { Component, computed, inject, signal, DestroyRef, effect } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { switchMap, map, catchError, of, tap, finalize } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  AssetService,
  AssetAggregationService,
  SearchService,
  SelectionService,
  DocumentDetailService,
  docTypeIcon,
  type NuxeoDocument,
  type AssetAggregations,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  ConfirmDialogComponent,
  SavedSearchDialogComponent,
  ShareSavedSearchDialogComponent,
  type ConfirmDialogData,
} from '@nuxeo/satori-platform/ui';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export type SortDirection = 'asc' | 'desc' | null;
export type ViewMode = 'grid' | 'list';

export interface ColumnDef {
  key: string;
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  width: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', labelKey: 'assets.column.name', label: 'Title', width: '280px' },
  { key: 'type', labelKey: 'assets.column.type', label: 'Type', width: '120px' },
  { key: 'modified', labelKey: 'assets.column.modified', label: 'Modified', width: '140px' },
  {
    key: 'contributor',
    labelKey: 'assets.column.contributor',
    label: 'Last contributor',
    width: '180px',
  },
  { key: 'state', labelKey: 'assets.column.state', label: 'State', width: '120px' },
  { key: 'version', labelKey: 'assets.column.version', label: 'Version', width: '100px' },
  { key: 'created', labelKey: 'assets.column.created', label: 'Created', width: '140px' },
  { key: 'author', labelKey: 'assets.column.author', label: 'Author', width: '150px' },
  { key: 'nature', labelKey: 'assets.column.nature', label: 'Nature', width: '140px' },
  { key: 'coverage', labelKey: 'assets.column.coverage', label: 'Coverage', width: '140px' },
  { key: 'subjects', labelKey: 'assets.column.subjects', label: 'Subjects', width: '200px' },
  { key: 'flags', labelKey: 'assets.column.flags', label: 'Flags', width: '120px' },
];

export interface AssetResult {
  id: string;
  name: string;
  type: string;
  format: string;
  mimeType: string;
  modifiedDate: string;
  lastContributor: string;
  icon: string;
  widthPx?: number;
  heightPx?: number;
  videoDurationSec?: number;
  state?: string;
  version?: string;
  createdDate?: string;
  author?: string;
  nature?: string;
  coverage?: string;
  subjects?: string;
  flags?: string;
}

const GRID_SORT_TO_API_FIELD: Record<string, string> = {
  name: 'dc:title',
  createdDate: 'dc:created',
  modifiedDate: 'dc:modified',
  lastContributor: 'dc:lastContributor',
  state: 'ecm:currentLifeCycleState',
  nature: 'dc:nature',
  coverage: 'dc:coverage',
};

const API_FIELD_TO_GRID_SORT = Object.fromEntries(
  Object.entries(GRID_SORT_TO_API_FIELD).map(([ui, api]) => [api, ui]),
) as Record<string, string>;

function buildApiParams(params: ParamMap) {
  const get = (key: string) => params.get(key)?.split(',').filter(Boolean) ?? [];

  // Get primaryTypes from asset-type param - values are now the actual types (Picture, File, etc.)
  const primaryTypeValues = get('asset-type');

  // Get mimeTypes from asset-format param - values are now the full MIME types
  const mimeTypeValues = get('asset-format');

  const sortBy = params.get('sortBy') ?? undefined;
  const ecmFulltext = params.get('ecm_fulltext')?.trim() || undefined;
  const sortOrderRaw = params.get('sortOrder');
  const sortOrder: 'asc' | 'desc' | undefined =
    sortOrderRaw === 'asc' || sortOrderRaw === 'desc' ? sortOrderRaw : undefined;

  return {
    primaryTypes: primaryTypeValues,
    mimeTypes: mimeTypeValues,
    widths: get('asset-width'),
    heights: get('asset-height'),
    colorProfiles: get('color-profile'),
    colorDepths: get('color-depth'),
    videoDurations: get('video-duration'),
    ecmFulltext,
    sortBy,
    sortOrder,
  };
}

function mapToAssetResult(doc: NuxeoDocument): AssetResult {
  const props = doc.properties;
  const fileContent = props['file:content'] as { 'mime-type'?: string } | null;
  const mime = fileContent?.['mime-type'] ?? '';
  const format = mime.split('/')[1]?.split('+')[0] ?? '';
  const widthPx = Number((props['imd:pixel_xdimension'] as number | string | undefined) ?? NaN);
  const heightPx = Number((props['imd:pixel_ydimension'] as number | string | undefined) ?? NaN);
  const vidInfo = props['vid:info'] as
    { duration?: number; width?: number; height?: number } | undefined;
  const videoDurationSec = Number((vidInfo?.duration as number | string | undefined) ?? NaN);
  return {
    id: doc.uid,
    name: doc.title,
    type: doc.type,
    format,
    mimeType: mime,
    modifiedDate: doc.lastModified?.slice(0, 10) ?? '',
    lastContributor: (props['dc:lastContributor'] as string) ?? '',
    icon: docTypeIcon(doc.type),
    widthPx: Number.isFinite(widthPx)
      ? widthPx
      : Number.isFinite(Number(vidInfo?.width))
        ? Number(vidInfo?.width)
        : undefined,
    heightPx: Number.isFinite(heightPx)
      ? heightPx
      : Number.isFinite(Number(vidInfo?.height))
        ? Number(vidInfo?.height)
        : undefined,
    videoDurationSec: Number.isFinite(videoDurationSec) ? videoDurationSec : undefined,
    createdDate: ((props['dc:created'] as string) ?? '').slice(0, 10) || undefined,
    author: (props['dc:creator'] as string) ?? undefined,
    nature: (props['dc:nature'] as string) ?? undefined,
    coverage: (props['dc:coverage'] as string) ?? undefined,
    subjects: ((props['dc:subjects'] as string[]) ?? []).join(', ') || undefined,
  };
}

const DIMENSION_BUCKET_KEYS = [
  'to_500_px',
  'from_500_to_1500_px',
  'from_1500_to_2000_px',
  'from_2000_px',
] as const;

function mergeComputedAggregations(
  documents: NuxeoDocument[],
  mappedAssets: AssetResult[],
  apiAggregations: AssetAggregations | undefined,
): AssetAggregations {
  const aggregations: AssetAggregations = { ...(apiAggregations ?? {}) };

  // Fallback for dynamic groups when API aggregations are missing.
  if (!aggregations.system_primaryType_agg) {
    const typeMap = new Map<string, number>();
    documents.forEach((doc) => {
      typeMap.set(doc.type, (typeMap.get(doc.type) ?? 0) + 1);
    });
    aggregations.system_primaryType_agg = {
      buckets: Array.from(typeMap).map(([key, count]) => ({ key, docCount: count })),
    };
  }

  if (!aggregations.system_mimetype_agg) {
    const mimeMap = new Map<string, number>();
    documents.forEach((doc) => {
      const props = doc.properties;
      const fileContent = props['file:content'] as { 'mime-type'?: string } | null;
      const mime = fileContent?.['mime-type'];
      if (mime) {
        mimeMap.set(mime, (mimeMap.get(mime) ?? 0) + 1);
      }
    });
    aggregations.system_mimetype_agg = {
      buckets: Array.from(mimeMap).map(([key, count]) => ({ key, docCount: count })),
    };
  }

  // Always compute width/height buckets from returned assets so filter counts
  // reflect the current result set.
  const widthCounts = new Map<string, number>(DIMENSION_BUCKET_KEYS.map((key) => [key, 0]));
  const heightCounts = new Map<string, number>(DIMENSION_BUCKET_KEYS.map((key) => [key, 0]));

  mappedAssets.forEach((asset) => {
    const widthBucket = DIMENSION_BUCKET_KEYS.find((bucket) =>
      inWidthBucket(asset.widthPx, bucket),
    );
    if (widthBucket) {
      widthCounts.set(widthBucket, (widthCounts.get(widthBucket) ?? 0) + 1);
    }

    const heightBucket = DIMENSION_BUCKET_KEYS.find((bucket) =>
      inHeightBucket(asset.heightPx, bucket),
    );
    if (heightBucket) {
      heightCounts.set(heightBucket, (heightCounts.get(heightBucket) ?? 0) + 1);
    }
  });

  aggregations.asset_width_agg = {
    buckets: DIMENSION_BUCKET_KEYS.map((key) => ({ key, docCount: widthCounts.get(key) ?? 0 })),
  };

  aggregations.asset_height_agg = {
    buckets: DIMENSION_BUCKET_KEYS.map((key) => ({ key, docCount: heightCounts.get(key) ?? 0 })),
  };

  return aggregations;
}

function inWidthBucket(width: number | undefined, bucket: string): boolean {
  if (width === undefined) return false;
  switch (bucket) {
    case 'to_500_px':
      return width < 500;
    case 'from_500_to_1500_px':
      return width >= 500 && width <= 1500;
    case 'from_1500_to_2000_px':
      return width >= 1500 && width <= 2000;
    case 'from_2000_px':
      return width > 2000;
    default:
      return false;
  }
}

function inHeightBucket(height: number | undefined, bucket: string): boolean {
  if (height === undefined) return false;
  switch (bucket) {
    case 'to_500_px':
      return height < 500;
    case 'from_500_to_1500_px':
      return height >= 500 && height <= 1500;
    case 'from_1500_to_2000_px':
      return height >= 1500 && height <= 2000;
    case 'from_2000_px':
      return height > 2000;
    default:
      return false;
  }
}

function inVideoDurationBucket(durationSec: number | undefined, bucket: string): boolean {
  if (durationSec === undefined) return false;
  switch (bucket) {
    case 'to_30_s':
      return durationSec < 30;
    case 'from_30_to_180_s':
      return durationSec >= 30 && durationSec <= 180;
    case 'from_180_to_600_s':
      return durationSec > 180 && durationSec <= 600;
    case 'from_600_to_1800_s':
      return durationSec > 600 && durationSec <= 1800;
    case 'from_1800_s':
      return durationSec > 1800;
    default:
      return false;
  }
}

@Component({
  selector: 'lib-asset-search-results',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    DescriptorLabelPipe,
    TranslatePipe,
    MatButtonModule,
    MatMenuModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './asset-search-results.component.html',
  styleUrl: './asset-search-results.component.scss',
})
export class AssetSearchResultsComponent {
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly assetService = inject(AssetService);
  private readonly aggregationService = inject(AssetAggregationService);
  private readonly documentDetailService = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly searchService = inject(SearchService);
  readonly selectionService = inject(SelectionService);

  readonly thumbnailMap = signal<Record<string, string | null>>({});
  private thumbnailGeneration = 0;
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedSavedSearchId = this.aggregationService.selectedSavedSearchId;
  readonly selectedSavedSearchTitle = this.aggregationService.selectedSavedSearchTitle;
  readonly deletingSavedSearch = signal(false);

  private readonly assets$ = this.route.queryParamMap.pipe(
    tap(() => {
      this.loading.set(true);
      this.error.set(null);
      this.beginThumbnailBatch();
    }),
    switchMap((params) =>
      this.assetService.searchAssets(buildApiParams(params)).pipe(
        map((result) => {
          const mapped = result.entries.map(mapToAssetResult);
          const aggs = mergeComputedAggregations(result.entries, mapped, result.aggregations);
          this.aggregationService.aggregations.set(aggs);
          this.aggregationService.items.set(
            mapped.map((asset) => ({
              id: asset.id,
              title: asset.name,
              type: asset.type,
              icon: asset.icon,
            })),
          );
          this.loadThumbnails(mapped);
          return mapped;
        }),
        catchError(() => {
          this.error.set(this.translate.instant('assets.message.failed-to-load-assets'));
          return of<AssetResult[]>([]);
        }),
        tap(() => this.loading.set(false)),
      ),
    ),
  );

  readonly assets = toSignal(this.assets$, { initialValue: [] as AssetResult[] });

  readonly viewMode = signal<ViewMode>('list');
  readonly allColumns = ALL_COLUMNS;
  readonly visibleColumnKeys = signal<string[]>(['name', 'modified', 'contributor']);
  readonly sortColumn = signal<string | null>(null);
  readonly sortDirection = signal<SortDirection>(null);
  readonly gridGroupBy = signal<string>('createdDate');
  readonly gridSortOrder = signal<'asc' | 'desc'>('asc');

  constructor() {
    this.destroyRef.onDestroy(() => this.clearThumbnails());

    effect(() => {
      const params = this.queryParams();
      const apiSortBy = params.get('sortBy') ?? 'dc:created';
      const uiSortBy = API_FIELD_TO_GRID_SORT[apiSortBy] ?? 'createdDate';
      const sortOrder = params.get('sortOrder') === 'desc' ? 'desc' : 'asc';

      this.gridGroupBy.set(uiSortBy);
      this.gridSortOrder.set(sortOrder);
    });
  }

  readonly visibleColumns = computed(() =>
    ALL_COLUMNS.filter((c) => this.visibleColumnKeys().includes(c.key)),
  );

  readonly gridTemplate = computed(() =>
    ['40px', ...this.visibleColumns().map((c) => `minmax(${c.width}, 1fr)`), '40px'].join(' '),
  );

  openAsset(asset: AssetResult): void {
    void this.router.navigate(['/doc', asset.id]);
  }

  getCellValue(asset: AssetResult, key: string): string {
    switch (key) {
      case 'type':
        return asset.type;
      case 'modified':
        return asset.modifiedDate;
      case 'contributor':
        return asset.lastContributor;
      case 'state':
        return asset.state ?? '—';
      case 'version':
        return asset.version ?? '—';
      case 'created':
        return asset.createdDate ?? '—';
      case 'author':
        return asset.author ?? '—';
      case 'nature':
        return asset.nature ?? '—';
      case 'coverage':
        return asset.coverage ?? '—';
      case 'subjects':
        return asset.subjects ?? '—';
      case 'flags':
        return asset.flags ?? '—';
      default:
        return '';
    }
  }

  isAssetSelected(id: string): boolean {
    return this.selectionService.isSelected(id);
  }

  toggleAssetSelection(id: string): void {
    const asset = this.filteredAssets().find((a) => a.id === id);
    this.selectionService.toggle(id, asset?.name ?? id, this.thumbnailMap()[id] ?? null);
  }

  toggleAll(): void {
    if (this.isAllSelected()) {
      this.selectionService.clear();
    } else {
      const assets = this.filteredAssets();
      const labels: Record<string, string> = {};
      const previews: Record<string, any> = {};
      assets.forEach((asset) => {
        labels[asset.id] = asset.name;
        previews[asset.id] = this.thumbnailMap()[asset.id] ?? null;
      });
      this.selectionService.selectAll(
        assets.map((a) => a.id),
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

  readonly columnPanelOpen = signal(false);
  readonly pendingColumnKeys = signal<string[]>(['name', 'modified', 'contributor']);
  readonly columnsForPanel = ALL_COLUMNS;

  isPendingColumn(key: string): boolean {
    return this.pendingColumnKeys().includes(key);
  }

  togglePendingColumn(key: string): void {
    const current = this.pendingColumnKeys();
    if (current.includes(key)) {
      this.pendingColumnKeys.set(current.filter((k) => k !== key));
    } else {
      const ordered = ALL_COLUMNS.map((c) => c.key);
      this.pendingColumnKeys.set(ordered.filter((k) => [...current, key].includes(k)));
    }
  }

  openColumnPanel(): void {
    this.pendingColumnKeys.set(this.visibleColumnKeys());
    this.columnPanelOpen.set(true);
  }

  closeColumnPanel(): void {
    this.columnPanelOpen.set(false);
  }

  resetColumns(): void {
    this.pendingColumnKeys.set(['name', 'modified', 'contributor']);
  }

  applyColumns(): void {
    this.visibleColumnKeys.set(
      ALL_COLUMNS.map((c) => c.key).filter((k) => this.pendingColumnKeys().includes(k)),
    );
    this.columnPanelOpen.set(false);
  }

  readonly filteredAssets = computed(() => {
    const params = this.queryParams();
    const getSelected = (key: string) => new Set(params.get(key)?.split(',').filter(Boolean) ?? []);

    const selectedTypes = getSelected('asset-type');
    const selectedFormats = getSelected('asset-format');
    const selectedWidths = getSelected('asset-width');
    const selectedHeights = getSelected('asset-height');
    const selectedVideoDurations = getSelected('video-duration');

    return this.assets().filter((asset) => {
      if (selectedTypes.size > 0 && !selectedTypes.has(asset.type)) {
        return false;
      }

      if (selectedFormats.size > 0 && !selectedFormats.has(asset.mimeType)) {
        return false;
      }

      if (
        selectedWidths.size > 0 &&
        !Array.from(selectedWidths).some((bucket) => inWidthBucket(asset.widthPx, bucket))
      ) {
        return false;
      }

      if (
        selectedHeights.size > 0 &&
        !Array.from(selectedHeights).some((bucket) => inHeightBucket(asset.heightPx, bucket))
      ) {
        return false;
      }

      if (
        selectedVideoDurations.size > 0 &&
        !Array.from(selectedVideoDurations).some((bucket) =>
          inVideoDurationBucket(asset.videoDurationSec, bucket),
        )
      ) {
        return false;
      }

      return true;
    });
  });

  readonly sortedAssets = computed(() => {
    const assets = [...this.filteredAssets()];
    const col = this.sortColumn();
    const dir = this.sortDirection();
    if (!col || !dir) return assets;
    return assets.sort((a, b) => {
      let aVal = '';
      let bVal = '';
      switch (col) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'modified':
          aVal = a.modifiedDate;
          bVal = b.modifiedDate;
          break;
        case 'contributor':
          aVal = a.lastContributor;
          bVal = b.lastContributor;
          break;
      }
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  });

  readonly gridAssets = computed(() => {
    const assets = [...this.filteredAssets()];
    const col = this.gridGroupBy();
    const dir = this.gridSortOrder();

    return assets.sort((a, b) => {
      let aVal = '';
      let bVal = '';

      switch (col) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'createdDate':
          aVal = a.createdDate ?? '';
          bVal = b.createdDate ?? '';
          break;
        case 'modifiedDate':
          aVal = a.modifiedDate;
          bVal = b.modifiedDate;
          break;
        case 'lastContributor':
          aVal = a.lastContributor;
          bVal = b.lastContributor;
          break;
        case 'state':
          aVal = a.state ?? '';
          bVal = b.state ?? '';
          break;
        case 'nature':
          aVal = a.nature ?? '';
          bVal = b.nature ?? '';
          break;
        case 'coverage':
          aVal = a.coverage ?? '';
          bVal = b.coverage ?? '';
          break;
      }

      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  });

  setGridGroupBy(value: string): void {
    this.gridGroupBy.set(value);
    this.gridSortOrder.set('asc');

    const apiFieldName = GRID_SORT_TO_API_FIELD[value] ?? null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: apiFieldName,
        sortOrder: 'asc',
      },
      queryParamsHandling: 'merge',
    });
  }

  setGridSortOrder(direction: 'asc' | 'desc'): void {
    this.gridSortOrder.set(direction);

    const apiFieldName = GRID_SORT_TO_API_FIELD[this.gridGroupBy()] ?? null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sortBy: apiFieldName,
        sortOrder: direction,
      },
      queryParamsHandling: 'merge',
    });
  }

  readonly SORTABLE_COLUMNS = new Set(['name', 'modified', 'contributor']);

  sortBy(col: string): void {
    if (!this.SORTABLE_COLUMNS.has(col)) return;
    if (this.sortColumn() === col) {
      if (this.sortDirection() === 'asc') this.sortDirection.set('desc');
      else if (this.sortDirection() === 'desc') {
        this.sortColumn.set(null);
        this.sortDirection.set(null);
      }
    } else {
      this.sortColumn.set(col);
      this.sortDirection.set('asc');
    }
  }

  readonly resultCount = computed(() => this.filteredAssets().length);
  readonly selectedCount = computed(() => this.selectionService.selectedCount());

  readonly isAllSelected = computed(() => {
    const assets = this.filteredAssets();
    return this.selectionService.isAllSelected(assets.map((a) => a.id));
  });

  readonly isIndeterminate = computed(() => {
    const assets = this.filteredAssets();
    return this.selectionService.isIndeterminate(assets.map((a) => a.id));
  });

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
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
    const rows = this.filteredAssets().map((a) => [
      a.name,
      a.type,
      a.modifiedDate,
      a.lastContributor,
      a.state ?? '',
      a.version ?? '',
      a.createdDate ?? '',
      a.author ?? '',
      a.nature ?? '',
      a.coverage ?? '',
      a.subjects ?? '',
      a.flags ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => escape(cell ?? '')).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'assets.csv';
    anchor.click();
    URL.revokeObjectURL(url);
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
            params: this.buildSavedSearchParamsFromQuery(),
            pageProviderName: 'assets_search',
          })
          .subscribe({
            next: (saved) => {
              this.aggregationService.selectedSavedSearchId.set(this.readSavedSearchId(saved));
              this.aggregationService.selectedSavedSearchTitle.set(
                this.readSavedSearchTitle(saved) || trimmedTitle,
              );
              this.aggregationService.markSavedSearchDirty();
              this.snackBar.open(
                this.translate.instant('common.search-saved', { name: trimmedTitle }),
                this.translate.instant('common.ok'),
                { duration: 3000 },
              );
            },
            error: () => {
              this.snackBar.open(
                this.translate.instant('assets.message.failed-to-save-search'),
                this.translate.instant('common.dismiss'),
                { duration: 5000 },
              );
            },
          });
      });
  }

  hasSelectedSavedSearch(): boolean {
    return this.selectedSavedSearchId().trim().length > 0;
  }

  hasSavableFilters(): boolean {
    return Object.keys(this.buildSavedSearchParamsFromQuery()).length > 0;
  }

  onSaveSelectedSavedSearch(): void {
    const id = this.selectedSavedSearchId().trim();
    if (!id) return;

    const currentTitle =
      this.selectedSavedSearchTitle().trim() || this.translate.instant('ui.saved-search');
    this.searchService
      .updateSavedSearch(id, {
        title: currentTitle,
        params: this.buildSavedSearchParamsFromQuery(),
        pageProviderName: 'assets_search',
      })
      .subscribe({
        next: () => {
          this.aggregationService.selectedSavedSearchTitle.set(currentTitle);
          this.aggregationService.markSavedSearchDirty();
          this.snackBar.open(
            this.translate.instant('common.search-updated', { name: currentTitle }),
            this.translate.instant('common.ok'),
            { duration: 3000 },
          );
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('assets.message.failed-to-save-search'),
            this.translate.instant('common.dismiss'),
            { duration: 5000 },
          );
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
            params: this.buildSavedSearchParamsFromQuery(),
            pageProviderName: 'assets_search',
          })
          .subscribe({
            next: () => {
              this.aggregationService.selectedSavedSearchTitle.set(trimmedTitle);
              this.aggregationService.markSavedSearchDirty();
              this.snackBar.open(
                this.translate.instant('common.search-updated', { name: trimmedTitle }),
                this.translate.instant('common.ok'),
                {
                  duration: 3000,
                },
              );
            },
            error: () => {
              this.snackBar.open(
                this.translate.instant('assets.message.failed-to-update-search'),
                this.translate.instant('common.dismiss'),
                { duration: 5000 },
              );
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
    if (!id || this.deletingSavedSearch()) return;

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

        this.deletingSavedSearch.set(true);
        this.searchService
          .deleteSavedSearch(id)
          .pipe(
            takeUntilDestroyed(this.destroyRef),
            finalize(() => this.deletingSavedSearch.set(false)),
          )
          .subscribe({
            next: () => {
              this.aggregationService.selectedSavedSearchId.set('');
              this.aggregationService.selectedSavedSearchTitle.set('');
              this.aggregationService.markSavedSearchDirty();

              void this.router.navigate(['/documents'], {
                queryParams: {
                  'asset-type': null,
                  'asset-format': null,
                  'asset-width': null,
                  'asset-height': null,
                  'color-profile': null,
                  'color-depth': null,
                  'video-duration': null,
                  ecm_fulltext: null,
                },
              });
            },
            error: (error) => {
              console.error('Failed to delete saved search.', error);
            },
          });
      });
  }

  private buildSavedSearchParamsFromQuery(): Record<string, string> {
    const params = this.queryParams();
    const keys = [
      'asset-type',
      'asset-format',
      'asset-width',
      'asset-height',
      'color-profile',
      'color-depth',
      'video-duration',
      'ecm_fulltext',
    ];

    const saved: Record<string, string> = {};
    for (const key of keys) {
      const value = params.get(key)?.trim();
      if (value) saved[key] = value;
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

  private loadThumbnails(assets: AssetResult[]): void {
    // Mint a new generation rather than reading the current one — two overlapping asset searches
    // could otherwise both capture the generation set by one `beginThumbnailBatch()`, letting the
    // first search's late callbacks pass the guard and reappear after the second cleared them.
    const generation = ++this.thumbnailGeneration;
    this.clearThumbnails();
    for (const asset of assets) {
      this.documentDetailService
        .fetchThumbnail(asset.id)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob || generation !== this.thumbnailGeneration) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((m) => {
            const previous = m[asset.id];
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return {
              ...m,
              [asset.id]: url,
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
}
