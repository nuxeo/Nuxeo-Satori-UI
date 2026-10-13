import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import {
  SearchService,
  type SearchAggregations,
  type SearchCollectionOption,
} from '@nuxeo-satori/platform/nuxeo-client';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  NXS_MODIFIED_RANGES,
  NXS_SIZE_RANGES,
  nxsHasSearchFilters,
  nxsRangeOptions,
  nxsTermOptions,
  type NxsFacetOption,
  type NxsSearchFilters,
} from './search-filters.model';

/** A group of checkboxes, and which field of the filters it edits. */
type CheckboxField = 'modified' | 'nature' | 'subjects' | 'coverage' | 'size';

interface CheckboxGroup {
  readonly field: CheckboxField;
  readonly titleKey: string;
  readonly options: readonly NxsFacetOption[];
  /** Translation keys for range labels; a terms bucket shows its key. */
  readonly labelKeys?: Readonly<Record<string, string>>;
}

const MODIFIED_LABEL_KEYS: Readonly<Record<string, string>> = {
  last24h: 'satori-components.search-filters.modified.last24h',
  lastWeek: 'satori-components.search-filters.modified.last-week',
  lastMonth: 'satori-components.search-filters.modified.last-month',
  lastYear: 'satori-components.search-filters.modified.last-year',
  priorToLastYear: 'satori-components.search-filters.modified.prior-to-last-year',
};

const SIZE_LABEL_KEYS: Readonly<Record<string, string>> = {
  tiny: 'satori-components.search-filters.size.tiny',
  small: 'satori-components.search-filters.size.small',
  medium: 'satori-components.search-filters.size.medium',
  big: 'satori-components.search-filters.size.big',
  huge: 'satori-components.search-filters.size.huge',
};

let nextId = 0;

/**
 * The search filters — Web UI's default search form: full text, modification date, authors,
 * collections, tags, nature, subjects, coverage and size, with Reset and Save as.
 *
 * It edits `filters` and nothing else: the host turns them into a query and passes the server's
 * `aggregations` for that query back, which give each choice its count, as Web UI's checkbox
 * aggregations do. Full text applies on Enter; a checkbox or a chosen author, collection or tag
 * applies at once. It looks up the user's collections and the tag suggestions itself.
 */
@Component({
  selector: 'nxs-search-filters',
  standalone: true,
  templateUrl: './search-filters.component.html',
  styleUrl: './search-filters.component.scss',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-search-filters' },
})
export class NxsSearchFiltersComponent {
  /** The filters shown. Two-way: every change the user makes is written back. */
  readonly filters = model<NxsSearchFilters>(NXS_EMPTY_SEARCH_FILTERS);
  /** The server's aggregates for the query the filters produce: each choice's count. */
  readonly aggregations = input<SearchAggregations>({});
  /** Reset was pressed: the filters are now empty. A host clears what it keeps beside them. */
  readonly filtersReset = output<void>();
  /** Save as was pressed: the host asks for a name and saves the current filters. */
  readonly saveAs = output<void>();

  private readonly searchService = inject(SearchService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ids = (() => {
    const base = `nxs-search-filters-${nextId++}`;
    return {
      fulltext: `${base}-fulltext`,
      authors: `${base}-authors`,
      collections: `${base}-collections`,
      tags: `${base}-tags`,
      group: (field: string) => `${base}-${field}`,
    };
  })();

  protected readonly hasFilters = computed(() => nxsHasSearchFilters(this.filters()));

  /** What the full-text box holds; it reaches `filters` on Enter. */
  protected readonly fulltextDraft = signal('');
  protected readonly authorText = signal('');
  protected readonly collectionText = signal('');
  protected readonly tagText = signal('');

  /** Which collapsible groups are open. Modification date starts open, as in Web UI. */
  private readonly expanded = signal<ReadonlySet<CheckboxField>>(new Set(['modified']));

  protected readonly groups = computed<{ before: CheckboxGroup[]; after: CheckboxGroup[] }>(() => {
    const filters = this.filters();
    const aggregations = this.aggregations();
    return {
      before: [
        {
          field: 'modified',
          titleKey: 'satori-components.search-filters.modified.title',
          options: nxsRangeOptions(NXS_MODIFIED_RANGES, aggregations.dc_modified_agg),
          labelKeys: MODIFIED_LABEL_KEYS,
        },
      ],
      after: [
        {
          field: 'nature',
          titleKey: 'satori-components.search-filters.nature',
          options: nxsTermOptions(aggregations.dc_nature_agg, filters.nature),
        },
        {
          field: 'subjects',
          titleKey: 'satori-components.search-filters.subjects',
          options: nxsTermOptions(aggregations.dc_subjects_agg, filters.subjects),
        },
        {
          field: 'coverage',
          titleKey: 'satori-components.search-filters.coverage',
          options: nxsTermOptions(aggregations.dc_coverage_agg, filters.coverage),
        },
        {
          field: 'size',
          titleKey: 'satori-components.search-filters.size.title',
          options: nxsRangeOptions(NXS_SIZE_RANGES, aggregations.common_size_agg),
          labelKeys: SIZE_LABEL_KEYS,
        },
      ],
    };
  });

  /** The authors the server counted for this query, narrowed by what is typed. */
  protected readonly authorOptions = computed(() => {
    const term = this.authorText().trim().toLowerCase();
    const options = nxsTermOptions(this.aggregations().dc_creator_agg, []);
    return term ? options.filter((option) => option.value.toLowerCase().includes(term)) : options;
  });

  protected readonly collections = signal<readonly SearchCollectionOption[]>([]);
  protected readonly collectionsState = signal<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  protected readonly collectionOptions = computed(() => {
    const term = this.collectionText().trim().toLowerCase();
    const all = this.collections();
    return term ? all.filter((option) => option.title.toLowerCase().includes(term)) : all;
  });

  /** What the collections box shows for a chosen id: its title once the collections are known. */
  protected readonly collectionDisplay = (id: string | null): string =>
    this.collectionTitle(id ?? '');

  protected readonly tagSuggestions = signal<readonly string[]>([]);
  private readonly tagTerms = new Subject<string>();

  constructor() {
    // What the boxes show follows the filters whenever they change, from here or from the host.
    effect(() => {
      const filters = this.filters();
      untracked(() => {
        this.fulltextDraft.set(filters.fulltext);
        this.authorText.set(filters.author);
        this.collectionText.set(this.collectionTitle(filters.collection));
        this.tagText.set(filters.tag);
        this.expandSelected(filters);
      });
    });

    this.tagTerms
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((term) => this.searchService.getTagSuggestions(term)),
        takeUntilDestroyed(),
      )
      .subscribe((labels) => this.tagSuggestions.set(labels));
  }

  protected isExpanded(field: CheckboxField): boolean {
    return this.expanded().has(field);
  }

  protected toggleGroup(field: CheckboxField): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  protected isChecked(field: CheckboxField, value: string): boolean {
    return this.filters()[field].includes(value);
  }

  protected toggleOption(field: CheckboxField, value: string): void {
    const current = this.filters()[field];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    this.update({ [field]: next });
  }

  protected optionLabelKey(group: CheckboxGroup, value: string): string | null {
    return group.labelKeys?.[value] ?? null;
  }

  protected applyFulltext(): void {
    this.update({ fulltext: this.fulltextDraft().trim() });
  }

  protected clearFulltext(): void {
    this.fulltextDraft.set('');
    this.update({ fulltext: '' });
  }

  protected onAuthorInput(value: string): void {
    this.authorText.set(value);
    if (!value.trim() && this.filters().author) this.update({ author: '' });
  }

  protected selectAuthor(value: string): void {
    this.update({ author: value });
  }

  protected onCollectionsFocus(): void {
    if (this.collectionsState() === 'loading' || this.collectionsState() === 'loaded') return;
    this.collectionsState.set('loading');
    this.searchService
      .getUserCollections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (collections) => {
          this.collections.set(collections);
          this.collectionsState.set('loaded');
          this.collectionText.set(this.collectionTitle(this.filters().collection));
        },
        error: () => this.collectionsState.set('failed'),
      });
  }

  protected onCollectionInput(value: string): void {
    this.collectionText.set(value);
    if (!value.trim() && this.filters().collection) this.update({ collection: '' });
  }

  protected selectCollection(id: string): void {
    this.update({ collection: id });
  }

  protected onTagInput(value: string): void {
    this.tagText.set(value);
    this.tagTerms.next(value.trim());
    if (!value.trim()) {
      this.tagSuggestions.set([]);
      if (this.filters().tag) this.update({ tag: '' });
    }
  }

  protected selectTag(label: string): void {
    this.update({ tag: label });
  }

  protected resetFilters(): void {
    this.filters.set(NXS_EMPTY_SEARCH_FILTERS);
    this.filtersReset.emit();
  }

  /** The title a collection id is shown with, once the user's collections are known. */
  private collectionTitle(id: string): string {
    if (!id) return '';
    return this.collections().find((option) => option.id === id)?.title ?? id;
  }

  private update(change: Partial<NxsSearchFilters>): void {
    this.filters.set({ ...this.filters(), ...change });
  }

  /** Opens every group that has a selection, so a loaded saved search shows what it filters on. */
  private expandSelected(filters: NxsSearchFilters): void {
    const selected = (['modified', 'nature', 'subjects', 'coverage', 'size'] as const).filter(
      (field) => filters[field].length > 0,
    );
    if (selected.every((field) => this.expanded().has(field))) return;
    this.expanded.update((current) => new Set([...current, ...selected]));
  }
}
