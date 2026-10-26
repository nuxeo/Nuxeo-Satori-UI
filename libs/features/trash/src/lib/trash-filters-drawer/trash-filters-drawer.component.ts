import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  TrashFilterService,
  TrashService,
  DocumentDetailService,
  docTypeIcon,
  type NuxeoDocument,
  type UserGroupSuggestion,
  type SavedSearch,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

interface SizeOption {
  key: string;
  value: string;
  label: string;
  /** Translation key for `label`; the five buckets are shared with the search drawer. */
  labelKey?: string;
  count: number;
}

interface AuthorOption {
  id: string;
  label: string;
  count: number;
}

const SIZE_LABEL_KEYS: Record<string, string> = {
  tiny: 'search.filter.option.less-than-100-kb',
  small: 'search.filter.option.between-100-kb-and-1-mb',
  medium: 'search.filter.option.between-1-mb-and-10-mb',
  large: 'search.filter.option.between-10-mb-and-100-mb',
  huge: 'search.filter.option.more-than-100-mb',
};

const SIZE_LABELS: Record<string, string> = {
  tiny: 'Less than 100 KB',
  small: 'Between 100 KB and 1 MB',
  medium: 'Between 1 MB and 10 MB',
  large: 'Between 10 MB and 100 MB',
  huge: 'More than 100 MB',
};

@Component({
  selector: 'lib-trash-filters-drawer',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    DescriptorLabelPipe,
    TranslatePipe,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './trash-filters-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './trash-filters-drawer.component.scss',
})
export class TrashFiltersDrawerComponent implements OnInit {
  private readonly router = inject(Router);
  readonly trashFilterService = inject(TrashFilterService);
  private readonly trashService = inject(TrashService);
  private readonly detailService = inject(DocumentDetailService);

  readonly sizeOptions = signal<SizeOption[]>([]);
  readonly authorOptions = signal<AuthorOption[]>([]);

  readonly fullText = signal('');
  readonly pathInput = signal('/');
  readonly authorInput = signal('');
  readonly selectedSizes = signal<Set<string>>(new Set());

  readonly pathOpen = signal(false);
  readonly pathSuggestions = signal<NuxeoDocument[]>([]);
  readonly pathLoading = signal(false);

  readonly authorOpen = signal(false);
  readonly authorSuggestions = signal<UserGroupSuggestion[]>([]);

  readonly sizeExpanded = signal(true);

  readonly savedFilterDropdownOpen = signal(false);
  readonly savedFilterSearch = signal('');
  readonly savedFilters = signal<SavedSearch[]>([]);

  readonly filteredSavedFilters = computed(() => {
    const q = this.savedFilterSearch().toLowerCase();
    return this.savedFilters().filter((f) => f.title.toLowerCase().includes(q));
  });

  readonly hasActiveFilters = computed(() => {
    const f = this.trashFilterService.filters();
    return f.fullText !== '' || f.path !== '/' || f.author !== '' || f.sizeRanges.length > 0;
  });

  constructor() {
    effect(() => {
      const version = this.trashFilterService.savedSearchVersion();
      if (version === 0) return;
      untracked(() => this.loadSavedSearches());
    });

    effect(() => {
      const filters = this.trashFilterService.filters();
      const activeUid = this.trashFilterService.activeSavedFilterUid() ?? '';

      this.fullText.set(filters.fullText ?? '');
      this.pathInput.set(filters.path || '/');
      this.authorInput.set(filters.author ?? '');
      this.selectedSizes.set(new Set(filters.sizeRanges ?? []));

      if (activeUid) return;

      this.savedFilterSearch.set('');
      this.savedFilterDropdownOpen.set(false);
    });
  }

  ngOnInit(): void {
    this.ensureTrashRoute();
    this.loadAggregatedCounts();
    this.loadSavedSearches();
  }

  private loadSavedSearches(): void {
    this.trashService
      .getSavedSearches()
      .pipe(catchError(() => of([] as SavedSearch[])))
      .subscribe((results) => {
        this.savedFilters.set(results);

        const activeUid = this.trashFilterService.activeSavedFilterUid();
        if (!activeUid) return;

        // Preserve current filters during save/edit refresh; only hydrate from saved search
        // when local filter state is empty (e.g., after navigation or explicit reset).
        if (this.hasActiveFilters()) return;

        const active = results.find((r) => r.uid === activeUid);
        if (!active) return;

        this.selectSavedFilter(active);
      });
  }

  private loadAggregatedCounts(): void {
    this.trashService
      .searchTrash({ pageSize: 200 })
      .pipe(catchError(() => of({ entries: [] as NuxeoDocument[] })))
      .subscribe((res) => {
        const entries = (res as { entries: NuxeoDocument[] }).entries ?? [];
        this.computeSizeCounts(entries);
        this.computeAuthorCounts(entries);
      });
  }

  private computeSizeCounts(entries: NuxeoDocument[]): void {
    const counts: Record<string, number> = { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 };
    for (const doc of entries) {
      const fileContent = doc.properties?.['file:content'] as { length?: number } | null;
      const size = fileContent?.length ?? 0;
      if (size < 102400) counts['tiny']++;
      else if (size < 1048576) counts['small']++;
      else if (size < 10485760) counts['medium']++;
      else if (size < 104857600) counts['large']++;
      else counts['huge']++;
    }
    this.sizeOptions.set(
      Object.entries(SIZE_LABELS).map(([key, label]) => ({
        key,
        value: key,
        labelKey: SIZE_LABEL_KEYS[key],
        label,
        count: counts[key] ?? 0,
      })),
    );
  }

  private computeAuthorCounts(entries: NuxeoDocument[]): void {
    const map = new Map<string, number>();
    for (const doc of entries) {
      const creator = (doc.properties?.['dc:creator'] as string) ?? '';
      if (creator) {
        map.set(creator, (map.get(creator) ?? 0) + 1);
      }
    }
    this.authorOptions.set(
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, label: id, count })),
    );
  }

  toggleLayout(): void {
    this.trashFilterService.toggleLayout();
  }

  docIcon(type: string): string {
    return docTypeIcon(type);
  }

  openDocument(uid: string): void {
    void this.router.navigateByUrl(`/doc/${uid}`);
  }

  toggleSavedFilterDropdown(): void {
    this.savedFilterDropdownOpen.update((v) => !v);
  }

  closeSavedFilterDropdown(): void {
    setTimeout(() => this.savedFilterDropdownOpen.set(false), 200);
  }

  onSavedFilterFocusOut(event: FocusEvent): void {
    const host = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (!host || (next && host.contains(next))) return;
    this.savedFilterDropdownOpen.set(false);
  }

  selectSavedFilter(filter: SavedSearch): void {
    this.savedFilterDropdownOpen.set(false);
    this.trashFilterService.activeSavedFilterUid.set(filter.uid);
    this.trashFilterService.activeSavedFilterTitle.set(filter.title);

    const p = filter.params ?? {};

    const fullText = this.extractParam(p, 'ecm_fulltext', '');
    const path = this.extractParam(p, 'ecm_path', '/') || '/';
    const author = this.extractParam(p, 'dc_creator', '');
    const sizeRaw = this.extractParamArray(p, 'common_size');

    this.fullText.set(fullText);
    this.pathInput.set(path);
    this.authorInput.set(author);
    this.selectedSizes.set(new Set(sizeRaw));

    this.trashFilterService.filters.set({
      fullText,
      path,
      author,
      sizeRanges: sizeRaw,
    });
    this.ensureTrashRoute();
  }

  private extractParam(params: Record<string, unknown>, key: string, fallback: string): string {
    for (const prefix of ['', 'defaults:']) {
      const val = params[`${prefix}${key}`];
      if (typeof val === 'string' && val.trim()) return val.trim();
      if (Array.isArray(val) && val.length > 0) {
        const first = String(val[0] ?? '').trim();
        if (first) return first;
      }
    }
    return fallback;
  }

  private extractParamArray(params: Record<string, unknown>, key: string): string[] {
    for (const prefix of ['', 'defaults:']) {
      const val = params[`${prefix}${key}`];
      if (Array.isArray(val)) {
        return val.map((item) => String(item ?? '').trim()).filter(Boolean);
      }
      if (typeof val === 'string' && val.trim()) {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
          }
        } catch {
          return val
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        }
      }
    }
    return [];
  }

  onFullTextChange(value: string): void {
    this.fullText.set(value);
    this.updateFilters();
  }

  onFullTextClear(): void {
    this.fullText.set('');
    this.updateFilters();
  }

  onPathInput(value: string): void {
    this.pathInput.set(value);
    if (value.length >= 1) {
      this.pathLoading.set(true);
      this.trashService
        .getPathSuggestions(value)
        .pipe(catchError(() => of({ entries: [] as NuxeoDocument[] })))
        .subscribe((res) => {
          this.pathSuggestions.set(res.entries);
          this.pathLoading.set(false);
          this.pathOpen.set(true);
        });
    } else {
      this.pathSuggestions.set([]);
    }
  }

  onPathFocus(): void {
    const current = this.pathInput() || '/';
    this.onPathInput(current);
  }

  selectPath(doc: NuxeoDocument): void {
    this.pathInput.set(doc.path + '/');
    this.pathOpen.set(false);
    this.updateFilters();
    setTimeout(() => this.onPathInput(doc.path + '/'), 100);
  }

  closePathDropdown(): void {
    setTimeout(() => this.pathOpen.set(false), 200);
  }

  onPathKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.pathOpen.set(false);
      this.updateFilters();
    }
  }

  readonly filteredAuthorOptions = computed(() => {
    const q = this.authorInput().toLowerCase();
    if (!q) return this.authorOptions();
    return this.authorOptions().filter((a) => a.label.toLowerCase().includes(q));
  });

  onAuthorFocus(): void {
    this.authorOpen.set(true);
  }

  onAuthorInput(value: string): void {
    this.authorInput.set(value);
    this.authorOpen.set(true);
  }

  selectAuthorOption(option: AuthorOption): void {
    this.authorInput.set(option.id);
    this.authorOpen.set(false);
    this.updateFilters();
  }

  selectAuthor(suggestion: UserGroupSuggestion): void {
    this.authorInput.set(suggestion.id);
    this.authorOpen.set(false);
    this.updateFilters();
  }

  closeAuthorDropdown(): void {
    setTimeout(() => {
      this.authorOpen.set(false);
      this.updateFilters();
    }, 200);
  }

  isSizeSelected(value: string): boolean {
    return this.selectedSizes().has(value);
  }

  toggleSize(value: string): void {
    const next = new Set(this.selectedSizes());
    if (next.has(value)) next.delete(value);
    else next.add(value);
    this.selectedSizes.set(next);
    this.updateFilters();
  }

  toggleSizeExpanded(): void {
    this.sizeExpanded.update((v) => !v);
  }

  resetFilters(): void {
    this.fullText.set('');
    this.pathInput.set('/');
    this.authorInput.set('');
    this.selectedSizes.set(new Set());
    this.trashFilterService.reset();
    this.ensureTrashRoute();
  }

  private updateFilters(): void {
    this.trashFilterService.filters.set({
      fullText: this.fullText(),
      path: this.pathInput() || '/',
      author: this.authorInput(),
      sizeRanges: [...this.selectedSizes()],
    });
    this.ensureTrashRoute();
  }

  private ensureTrashRoute(): void {
    if (!this.router.url.startsWith('/trash')) {
      void this.router.navigateByUrl('/trash');
    }
  }
}
