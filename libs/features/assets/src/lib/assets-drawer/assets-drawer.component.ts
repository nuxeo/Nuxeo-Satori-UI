import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  AssetAggregationService,
  SearchService,
  type AssetAggregations,
  type AssetQueueItem,
  type SavedSearchOption,
} from '@nuxeo/satori-platform/nuxeo-client';
import { SavedSearchDialogComponent } from '@nuxeo/satori-platform/ui';
import { AssetsQueueComponent } from '../assets-queue/assets-queue.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface FilterOption {
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  value: string;
  selected: boolean;
  aggKey?: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  options: FilterOption[];
}

interface SavedSearchSelectOption {
  key: string;
  value: string;
  label: string;
  query?: string;
}

const DYNAMIC_GROUPS = new Set(['asset-type', 'asset-format', 'color-profile', 'color-depth']);
type DrawerViewMode = 'filter' | 'queue';

function toMimeType(value: string): string {
  if (value.includes('/')) return value;

  const normalized = value.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
    zip: 'application/zip',
  };

  return map[normalized] ?? value;
}

@Component({
  selector: 'lib-assets-drawer',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    TranslatePipe,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
    AssetsQueueComponent,
  ],
  templateUrl: './assets-drawer.component.html',
  styleUrl: './assets-drawer.component.scss',
})
export class AssetsDrawerComponent {
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly aggregationService = inject(AssetAggregationService);
  private readonly searchService = inject(SearchService);
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  readonly dynamicGroups = DYNAMIC_GROUPS;
  readonly viewMode = signal<DrawerViewMode>(this.loadViewModeFromStorage());
  readonly selectedDocumentId = signal('');
  readonly filterSearchInput = signal('');
  readonly savedSearchFilter = signal('');
  readonly filterSearchOpen = signal(false);
  readonly availableSavedSearches = signal<SavedSearchSelectOption[]>([]);
  readonly selectedSavedSearch = signal('');
  readonly savedSearchesLoading = signal(false);
  readonly savedSearchesLoaded = signal(false);
  readonly secondarySearchInput = signal('');

  private readonly GROUP_AGG_KEY: Record<string, keyof AssetAggregations> = {
    'asset-type': 'system_primaryType_agg',
    'asset-format': 'system_mimetype_agg',
    'asset-width': 'asset_width_agg',
    'asset-height': 'asset_height_agg',
    'color-profile': 'color_profile_agg',
    'color-depth': 'color_depth_agg',
    'video-duration': 'video_duration_agg',
  };

  private readonly ALWAYS_SHOW_ZERO = new Set(['asset-width', 'asset-height', 'video-duration']);

  readonly hasActiveFilters = computed(
    () =>
      this.secondarySearchInput().trim().length > 0 ||
      this.filterGroups().some((group) => group.options.some((option) => option.selected)),
  );

  readonly filteredSavedSearches = computed(() => {
    const term = this.savedSearchFilter().trim().toLowerCase();
    if (!term) return this.availableSavedSearches();
    return this.availableSavedSearches().filter((option) =>
      option.label.toLowerCase().includes(term),
    );
  });

  getCountText(groupId: string, aggKey?: string): string {
    if (!aggKey) return '';
    const aggField = this.GROUP_AGG_KEY[groupId];
    if (!aggField) return '';
    const agg = this.aggregationService.aggregations()[aggField];
    if (!agg) return this.ALWAYS_SHOW_ZERO.has(groupId) ? ' (0)' : '';
    const bucket = agg.buckets.find((b) => b.key === aggKey);
    const count = bucket?.docCount ?? (this.ALWAYS_SHOW_ZERO.has(groupId) ? 0 : null);
    return count !== null ? ` (${count})` : '';
  }

  readonly expandedFilters = signal<Set<string>>(new Set());

  readonly filterGroups = signal<FilterGroup[]>([
    { id: 'asset-type', labelKey: 'assets.filter.asset-type', label: 'Asset Type', options: [] },
    {
      id: 'asset-format',
      labelKey: 'assets.filter.asset-format',
      label: 'Asset Format',
      options: [],
    },
    {
      id: 'asset-width',
      labelKey: 'assets.filter.asset-width',
      label: 'Asset Width',
      options: [
        {
          labelKey: 'assets.filter.option.less-than-500-px',
          label: 'Less than 500 px',
          value: 'to_500_px',
          selected: false,
          aggKey: 'to_500_px',
        },
        {
          labelKey: 'assets.filter.option.between-500-px-and-1500-px',
          label: 'Between 500 px and 1500 px',
          value: 'from_500_to_1500_px',
          selected: false,
          aggKey: 'from_500_to_1500_px',
        },
        {
          labelKey: 'assets.filter.option.between-1500-px-and-2000-px',
          label: 'Between 1500 px and 2000 px',
          value: 'from_1500_to_2000_px',
          selected: false,
          aggKey: 'from_1500_to_2000_px',
        },
        {
          labelKey: 'assets.filter.option.more-than-2000-px',
          label: 'More than 2000 px',
          value: 'from_2000_px',
          selected: false,
          aggKey: 'from_2000_px',
        },
      ],
    },
    {
      id: 'asset-height',
      labelKey: 'assets.filter.asset-height',
      label: 'Asset Height',
      options: [
        {
          labelKey: 'assets.filter.option.less-than-500-px',
          label: 'Less than 500 px',
          value: 'to_500_px',
          selected: false,
          aggKey: 'to_500_px',
        },
        {
          labelKey: 'assets.filter.option.between-500-px-and-1500-px',
          label: 'Between 500 px and 1500 px',
          value: 'from_500_to_1500_px',
          selected: false,
          aggKey: 'from_500_to_1500_px',
        },
        {
          labelKey: 'assets.filter.option.between-1500-px-and-2000-px',
          label: 'Between 1500 px and 2000 px',
          value: 'from_1500_to_2000_px',
          selected: false,
          aggKey: 'from_1500_to_2000_px',
        },
        {
          labelKey: 'assets.filter.option.more-than-2000-px',
          label: 'More than 2000 px',
          value: 'from_2000_px',
          selected: false,
          aggKey: 'from_2000_px',
        },
      ],
    },
    {
      id: 'color-profile',
      labelKey: 'assets.filter.color-profile',
      label: 'Color Profile',
      options: [],
    },
    {
      id: 'color-depth',
      labelKey: 'assets.filter.color-depth',
      label: 'Color Depth per Channel',
      options: [],
    },
    {
      id: 'video-duration',
      labelKey: 'assets.filter.video-duration',
      label: 'Video Duration',
      options: [
        {
          labelKey: 'assets.filter.option.less-than-30-s',
          label: 'Less than 30 s',
          value: 'to_30_s',
          selected: false,
          aggKey: 'to_30_s',
        },
        {
          labelKey: 'assets.filter.option.between-30-s-and-180-s',
          label: 'Between 30 s and 180 s',
          value: 'from_30_to_180_s',
          selected: false,
          aggKey: 'from_30_to_180_s',
        },
        {
          labelKey: 'assets.filter.option.between-180-s-and-600-s',
          label: 'Between 180 s and 600 s',
          value: 'from_180_to_600_s',
          selected: false,
          aggKey: 'from_180_to_600_s',
        },
        {
          labelKey: 'assets.filter.option.between-600-s-and-1800-s',
          label: 'Between 600 s and 1800 s',
          value: 'from_600_to_1800_s',
          selected: false,
          aggKey: 'from_600_to_1800_s',
        },
        {
          labelKey: 'assets.filter.option.more-than-1800-s',
          label: 'More than 1800 s',
          value: 'from_1800_s',
          selected: false,
          aggKey: 'from_1800_s',
        },
      ],
    },
  ]);

  readonly autoSearch = signal(true);

  constructor() {
    this.expandedFilters.set(new Set(['asset-type']));

    effect(() => {
      const version = this.aggregationService.savedSearchVersion();
      if (version === 0) return;
      untracked(() => {
        this.savedSearchesLoaded.set(false);
        this.loadSavedSearchesFromApi();
      });
    });

    effect(() => {
      const savedSearchId = this.aggregationService.selectedSavedSearchId().trim();
      const savedSearchTitle = this.aggregationService.selectedSavedSearchTitle().trim();

      if (savedSearchId) {
        this.selectedSavedSearch.set(savedSearchId);
        this.filterSearchInput.set(savedSearchTitle);
        return;
      }

      this.selectedSavedSearch.set('');
      this.filterSearchInput.set('');
      this.savedSearchFilter.set('');
      this.filterSearchOpen.set(false);
    });

    this.syncSelectedDocumentFromUrl(this.router.url);

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      this.syncSelectedDocumentFromUrl(event.urlAfterRedirects);
    });

    effect(() => {
      const params = this.queryParams();
      const getSelected = (id: string) => new Set(params.get(id)?.split(',').filter(Boolean) ?? []);
      const fulltext = params.get('ecm_fulltext') ?? '';
      this.secondarySearchInput.set(fulltext);
      const aggs = this.aggregationService.aggregations();
      this.filterGroups.update((groups) =>
        groups.map((g) => {
          const selectedFromUrl = getSelected(g.id);

          if (!DYNAMIC_GROUPS.has(g.id)) {
            return {
              ...g,
              options: g.options.map((o) => ({
                ...o,
                selected: selectedFromUrl.has(o.value),
              })),
            };
          }

          const aggField = this.GROUP_AGG_KEY[g.id];
          const buckets = aggs[aggField]?.buckets ?? [];

          const options: FilterOption[] = buckets.map((b) => {
            const label = g.id === 'asset-format' ? toMimeType(b.key) : b.key;
            const value = g.id === 'asset-format' ? toMimeType(b.key) : b.key;
            return { label, value, selected: selectedFromUrl.has(value), aggKey: b.key };
          });

          return { ...g, options };
        }),
      );
    });

    effect(() => {
      localStorage.setItem('assets_drawer_view_mode', this.viewMode());
    });
  }

  switchToQueueView(): void {
    this.viewMode.set('queue');

    const items = this.aggregationService.items();
    const docId = this.selectedDocumentId();
    const selectedInResults = !!docId && items.some((item) => item.id === docId);

    if (selectedInResults) {
      void this.router.navigate(['/doc', docId], {
        queryParams: this.buildFilterQueryParams(),
      });
      return;
    }

    if (items.length > 0) {
      void this.router.navigate(['/doc', items[0].id], {
        queryParams: this.buildFilterQueryParams(),
      });
    }
  }

  switchToFilterView(): void {
    this.viewMode.set('filter');
    void this.router.navigate(['/documents'], {
      queryParams: this.buildFilterQueryParams(),
    });
  }

  onQueueItemSelected(item: AssetQueueItem): void {
    void this.router.navigate(['/doc', item.id], {
      queryParams: this.buildFilterQueryParams(),
    });
  }

  onFilterSearchFocus(): void {
    this.filterSearchOpen.set(true);
    this.loadSavedSearchesFromApi();
  }

  closeFilterSearchDropdown(): void {
    setTimeout(() => this.filterSearchOpen.set(false), 120);
  }

  selectFilterOption(option: SavedSearchSelectOption): void {
    this.filterSearchInput.set(option.label);
    this.savedSearchFilter.set('');
    this.selectedSavedSearch.set(option.value);
    this.filterSearchOpen.set(false);
    this.aggregationService.selectedSavedSearchId.set(option.value);
    this.aggregationService.selectedSavedSearchTitle.set(option.label);

    this.searchService.getSavedSearchById(option.value).subscribe({
      next: (params) => {
        this.applySavedSearchParams(params);
      },
    });
  }

  onSecondarySearchInput(value: string): void {
    this.secondarySearchInput.set(value);
  }

  onSecondarySearchEnter(): void {
    const value = this.secondarySearchInput().trim();
    void this.router.navigate(['/documents'], {
      queryParams: {
        ecm_fulltext: value ? value : null,
      },
      queryParamsHandling: 'merge',
    });
  }

  onSecondarySearchClear(): void {
    this.secondarySearchInput.set('');
    this.onSecondarySearchEnter();
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
            params: this.buildSavedSearchParams(),
            pageProviderName: 'assets_search',
          })
          .subscribe({
            next: () => {
              this.savedSearchesLoaded.set(false);
              this.loadSavedSearchesFromApi();
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

  resetFilters(): void {
    this.secondarySearchInput.set('');
    this.filterGroups.update((groups) =>
      groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, selected: false })) })),
    );
    this.filterSearchInput.set('');
    this.savedSearchFilter.set('');
    this.selectedSavedSearch.set('');
    this.aggregationService.selectedSavedSearchId.set('');
    this.aggregationService.selectedSavedSearchTitle.set('');

    const clearedParams: Record<string, null> = { ecm_fulltext: null };
    for (const group of this.filterGroups()) {
      clearedParams[group.id] = null;
    }

    void this.router.navigate(['/documents'], {
      queryParams: clearedParams,
    });
  }

  applySearch(): void {
    void this.router.navigate(['/documents'], {
      queryParams: this.buildFilterQueryParams(),
    });
  }

  private buildFilterQueryParams(): Record<string, string> {
    const queryParams: Record<string, string> = {};
    for (const group of this.filterGroups()) {
      const selected = group.options.filter((o) => o.selected).map((o) => o.value);
      if (selected.length > 0) {
        queryParams[group.id] = selected.join(',');
      }
    }
    return queryParams;
  }

  private buildSavedSearchParams(): Record<string, string> {
    const params = this.buildFilterQueryParams();
    const ecmFulltext = this.secondarySearchInput().trim();
    if (ecmFulltext) {
      params['ecm_fulltext'] = ecmFulltext;
    }
    return params;
  }

  toggleOption(groupId: string, value: string): void {
    this.filterGroups.update((groups) =>
      groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              options: g.options.map((o) =>
                o.value === value ? { ...o, selected: !o.selected } : o,
              ),
            }
          : g,
      ),
    );
    if (this.autoSearch()) {
      void this.router.navigate(['/documents'], {
        queryParams: this.buildFilterQueryParams(),
      });
    }
  }

  private applySavedSearchParams(params: Record<string, string>): void {
    const get = (key: string) => params[key]?.trim() ?? '';
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
    const getValues = (...keys: string[]): string[] => {
      for (const key of keys) {
        const raw = get(key);
        if (!raw) continue;

        const parsed = parseJsonArray(raw);
        if (parsed && parsed.length > 0) return parsed;

        const split = raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        if (split.length > 0) return split;
      }
      return [];
    };
    const firstValue = (...keys: string[]): string => getValues(...keys)[0] ?? '';

    const queryParams: Record<string, string | null> = {};
    for (const group of this.filterGroups()) {
      const keys = DYNAMIC_GROUPS.has(group.id)
        ? [group.id]
        : [group.id, this.GROUP_AGG_KEY[group.id] ?? ''];
      const values = getValues(...keys);
      queryParams[group.id] = values.length > 0 ? values.join(',') : null;
    }

    const ecmFulltext = firstValue('ecm_fulltext', 'ecmFulltext');
    queryParams['ecm_fulltext'] = ecmFulltext || null;

    // Navigate with normalized saved params and clear missing filters to avoid stale state.
    void this.router.navigate(['/documents'], { queryParams });
  }

  private syncSelectedDocumentFromUrl(url: string): void {
    const urlParts = url.split('/');
    const docIndex = urlParts.indexOf('doc');
    if (docIndex !== -1 && docIndex + 1 < urlParts.length) {
      this.selectedDocumentId.set(urlParts[docIndex + 1].split('?')[0]);
      return;
    }

    this.selectedDocumentId.set('');
  }

  private loadViewModeFromStorage(): DrawerViewMode {
    return 'filter';
  }

  private loadSavedSearchesFromApi(): void {
    if (this.savedSearchesLoaded() || this.savedSearchesLoading()) return;

    this.savedSearchesLoading.set(true);
    this.searchService.getSavedSearches('assets_search').subscribe({
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
}
