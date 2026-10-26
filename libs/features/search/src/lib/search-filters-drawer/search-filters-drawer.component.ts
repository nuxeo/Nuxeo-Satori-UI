import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith, switchMap } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  NxsSavedSearchSelectComponent,
  NxsSearchFiltersComponent,
  NxsToastService,
  provideNxsToast,
  type NxsSavedSearchChoice,
  type NxsSearchFilters,
} from '@nuxeo/satori-platform/components';
import {
  DirectoryService,
  FOLDERISH_TYPES,
  SearchAggregationService,
  type SearchResultItem,
} from '@nuxeo/satori-platform/nuxeo-client';

import { SearchQueueComponent } from '../search-queue/search-queue.component';
import { loadFacetLabels } from './facet-labels';
import { askSavedSearchName } from '../search-session/saved-search-dialogs';
import { SEARCH_PAGE_PROVIDER, SearchSession } from '../search-session/search-session';

type DrawerViewMode = 'filter' | 'queue';

const QUEUE_QUICK_FILTER_OPTIONS = [
  { labelKey: 'search.filter.option.no-containers', label: 'No Containers', value: 'noFolder' },
  { labelKey: 'search.filter.option.most-recent', label: 'Most Recent', value: 'mostRecent' },
  { labelKey: 'search.filter.option.validated', label: 'Validated', value: 'onlyValidated' },
] as const;

/**
 * The search drawer: the saved searches, the filters and the queue — Web UI's search form.
 *
 * Registered as `app.sidebar.searchFilters`. It composes `nxs-saved-search-select` and
 * `nxs-search-filters` over {@link SearchSession}, which runs the one search the drawer, its queue
 * and the search page share; the drawer sends no search of its own.
 */
@Component({
  selector: 'lib-search-filters-drawer',
  standalone: true,
  imports: [
    NxsSavedSearchSelectComponent,
    NxsSearchFiltersComponent,
    SearchQueueComponent,
    TranslatePipe,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatTooltipModule,
  ],
  providers: [provideNxsToast()],
  templateUrl: './search-filters-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './search-filters-drawer.component.scss',
})
export class SearchFiltersDrawerComponent {
  private readonly session = inject(SearchSession);
  private readonly searchAggregationService = inject(SearchAggregationService);
  private readonly directoryService = inject(DirectoryService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageProvider = SEARCH_PAGE_PROVIDER;
  readonly viewMode = signal<DrawerViewMode>('filter');
  readonly selectedDocumentId = signal('');
  readonly selectedQueueQuickFilters = signal<ReadonlySet<string>>(new Set());

  readonly filters = this.session.filters;
  readonly savedSearchId = this.session.savedSearchId;
  readonly savedSearchTitle = this.session.savedSearchTitle;
  readonly savedSearchesVersion = this.session.savedSearchesVersion;
  /** The shared search's state. Subscribing keeps it running while the drawer is open. */
  private readonly results = toSignal(this.session.results$);
  readonly aggregations = computed(() => this.results()?.aggregations ?? {});
  /** The nature, subject and coverage labels, in the language the app is shown in. */
  readonly facetLabels = toSignal(
    this.translate.onLangChange.pipe(
      map((event) => event.lang),
      startWith(this.translate.getCurrentLang() ?? 'en'),
      switchMap((lang) => loadFacetLabels(this.directoryService, lang)),
    ),
    { initialValue: {} },
  );

  readonly activeFiltersForQueue = computed(() => {
    const selected = this.selectedQueueQuickFilters();
    return QUEUE_QUICK_FILTER_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value,
      selected: selected.has(option.value),
    }));
  });

  constructor() {
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
        this.selectedDocumentId.set(
          docIndex !== -1 && docIndex + 1 < urlParts.length
            ? urlParts[docIndex + 1].split('?')[0]
            : '',
        );
      });

    this.activatedRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedQueueQuickFilters.set(this.parseQuickFilters(params.get('quickFilters') ?? ''));
    });
  }

  onFiltersChange(filters: NxsSearchFilters): void {
    this.session.setFilters(filters);
    this.ensureSearchRoute();
  }

  onReset(): void {
    this.session.closeSavedSearch();
    this.ensureSearchRoute();
  }

  onSavedSearchChosen(choice: NxsSavedSearchChoice): void {
    this.session
      .openSavedSearch(choice.id, choice.title)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.ensureSearchRoute(),
        error: () =>
          this.toast.error(this.translate.instant('search.message.failed-to-open-saved-search'), {
            duration: 5000,
          }),
      });
  }

  openSaveAsDialog(): void {
    askSavedSearchName(this.dialog, this.translate, {
      heading: this.translate.instant('ui.saved-search'),
    })
      .pipe(
        switchMap((name) => this.session.saveAs(name).pipe(map(() => name))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (name) => this.toast.show(this.translate.instant('common.search-saved', { name })),
        error: () =>
          this.toast.error(this.translate.instant('assets.message.failed-to-save-search'), {
            duration: 5000,
          }),
      });
  }

  switchToQueueView(): void {
    this.viewMode.set('queue');
    // Open the selected document, or the first result, when the queue is entered.
    const items = this.searchAggregationService.items();
    const docId = this.selectedDocumentId();
    const selected = docId ? items.find((item) => item.id === docId) : undefined;
    if (selected) {
      this.navigateToItem(selected);
      return;
    }
    if (items.length > 0) this.navigateToItem(items[0]);
  }

  switchToFilterView(): void {
    this.viewMode.set('filter');
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
    // A different quick filter is a different result set, so the page starts again from the first.
    void this.router.navigate(['/search'], {
      queryParams: { quickFilters: this.toQuickFiltersQueryParam(), page: null },
      queryParamsHandling: 'merge',
    });
  }

  private navigateToItem(item: SearchResultItem): void {
    const extras = {
      queryParams: { quickFilters: this.toQuickFiltersQueryParam() },
      queryParamsHandling: 'merge' as const,
    };
    if (item.type === 'Collection') {
      void this.router.navigate(['/collections', item.id], extras);
    } else if (FOLDERISH_TYPES.has(item.type) && item.path) {
      void this.router.navigate(['/browse' + item.path], extras);
    } else {
      void this.router.navigate(['/doc', item.id], extras);
    }
  }

  /** A change made from another page shows its results on the search page. */
  private ensureSearchRoute(): void {
    if (this.router.url.split('?')[0] !== '/search') void this.router.navigateByUrl('/search');
  }

  private toQuickFiltersQueryParam(): string | null {
    const selected = this.selectedQueueQuickFilters();
    const ordered = QUEUE_QUICK_FILTER_OPTIONS.map((option) => option.value).filter((value) =>
      selected.has(value),
    );
    return ordered.length > 0 ? ordered.join(',') : null;
  }

  private parseQuickFilters(value: string): Set<string> {
    const allowed = new Set<string>(QUEUE_QUICK_FILTER_OPTIONS.map((option) => option.value));
    return new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => allowed.has(item)),
    );
  }
}
