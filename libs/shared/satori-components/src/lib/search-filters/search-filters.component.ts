import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { CdkOverlayOrigin, OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { MatRadioModule } from '@angular/material/radio';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import {
  SearchService,
  type SearchAggregations,
  type SearchCollectionOption,
} from '@nuxeo/satori-platform/nuxeo-client';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

import {
  NXS_EMPTY_SEARCH_FILTERS,
  NXS_MODIFIED_RANGES,
  NXS_SIZE_RANGES,
  nxsHasSearchFilters,
  nxsRangeOptions,
  nxsTermOptions,
  type NxsFacetLabels,
  type NxsFacetOption,
  type NxsSearchFilters,
} from './search-filters.model';
import { NxsChipSetComponent } from '../chip-set/chip-set.component';
import { NXS_PRIMITIVE_IDS, type NxsChipItem } from '../primitives';

/** A group of checkboxes, and which field of the filters it edits. */
type CheckboxField = 'modified' | 'nature' | 'subjects' | 'coverage' | 'size';
/** A typeahead whose choices collect as chips, as Web UI's multiple-choice fields do. */
type ChoiceField = 'authors' | 'collections' | 'tags';
type FilterMenu = CheckboxField | ChoiceField | 'scope' | 'logic' | 'properties';

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
 * aggregations do. Full text applies on Enter; a checkbox, or an author, collection or tag added or
 * removed, applies at once. Authors, collections and tags take several values, as in Web UI. It
 * looks up the user's collections and the tag suggestions itself.
 */
@Component({
  selector: 'nxs-search-filters',
  standalone: true,
  templateUrl: './search-filters.component.html',
  styleUrl: './search-filters.component.scss',
  imports: [
    A11yModule,
    OverlayModule,
    MatRadioModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    NxsChipSetComponent,
    MatIconModule,
    NgTemplateOutlet,
    TranslatePipe,
    ExtensionOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-search-filters', '[class.horizontal]': "layout() === 'horizontal'" },
})
export class NxsSearchFiltersComponent {
  protected readonly horizontalMenus: readonly FilterMenu[] = [
    'scope',
    'logic',
    'properties',
    'modified',
    'authors',
    'coverage',
    'subjects',
    'tags',
    'collections',
  ];
  protected readonly activeMenu = signal<FilterMenu | null>(null);
  protected readonly panelOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly scopeDraft = signal(false);
  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];
  protected readonly propertyGroups = computed(() =>
    this.groups().after.filter((group) => group.field === 'nature' || group.field === 'size'),
  );
  protected readonly activeGroup = computed(() =>
    [...this.groups().before, ...this.groups().after].find(
      (group) => group.field === this.activeMenu(),
    ),
  );

  protected menuLabel(menu: FilterMenu): string {
    const keys: Record<FilterMenu, string> = {
      scope: 'search.workspace.in',
      logic: 'search.workspace.logic',
      properties: 'search.workspace.properties',
      modified: 'search.workspace.date',
      authors: 'search.workspace.people',
      coverage: 'satori-components.search-filters.coverage',
      subjects: 'search.workspace.categories',
      tags: 'satori-components.search-filters.tags',
      collections: 'satori-components.search-filters.collections',
      nature: 'satori-components.search-filters.nature',
      size: 'satori-components.search-filters.size.title',
    };
    const label = this.translate.instant(keys[menu]);
    if (menu === 'scope')
      return `${label}: ${this.translate.instant(this.filters().filesOnly ? 'search.workspace.files' : 'search.workspace.files-folders')}`;
    if (menu === 'logic') return label;
    if (menu === 'properties') {
      const count = this.filters().nature.length + this.filters().size.length;
      return count ? `${label} (${count})` : label;
    }
    const values = this.filters()[menu];
    if (menu === 'modified' && !values.length)
      return `${label}: ${this.translate.instant('search.workspace.any-time')}`;
    if (!values.length) return label;
    if (values.length > 1) return `${label} (${values.length})`;
    const group = [...this.groups().before, ...this.groups().after].find(
      (entry) => entry.field === menu,
    );
    const value = group
      ? group.labelKeys?.[values[0]]
        ? this.translate.instant(group.labelKeys[values[0]])
        : this.optionText(group, values[0])
      : this.chipItems(menu as ChoiceField, values)[0]?.label;
    return `${label}: ${value ?? values[0]}`;
  }

  protected panelTitle(): string {
    return this.activeMenu() === 'scope'
      ? this.translate.instant('search.workspace.search-in')
      : this.menuLabel(this.activeMenu() ?? 'properties');
  }

  protected openPanel(menu: FilterMenu, origin: CdkOverlayOrigin): void {
    if (this.activeMenu() === menu) {
      this.closePanel();
      return;
    }
    this.panelOrigin.set(origin);
    this.scopeDraft.set(!!this.filters().filesOnly);
    this.activeMenu.set(menu);
    if (menu === 'collections') this.onCollectionsFocus();
  }

  protected closePanel(restoreFocus = true): void {
    const trigger = this.panelOrigin()?.elementRef.nativeElement as HTMLElement | undefined;
    this.activeMenu.set(null);
    // CDK restores the first opener when one overlay is reused across triggers.
    // Restore the current opener after the trap has finished detaching instead.
    if (restoreFocus) afterNextRender(() => trigger?.focus(), { injector: this.injector });
  }

  protected outsidePanel(event: MouseEvent): void {
    if (!event.composedPath().includes(this.hostElement.nativeElement)) {
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('input, button, a, [tabindex]')
          : null;
      this.closePanel(false);
      // Do not let the trap steal focus from a control clicked outside the panel.
      if (target) afterNextRender(() => target.focus(), { injector: this.injector });
    }
  }

  protected panelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
    }
  }

  protected applyScope(): void {
    this.update({ filesOnly: this.scopeDraft() });
    this.closePanel();
  }

  protected clearDate(): void {
    this.update({ modified: [] });
    this.closePanel();
  }
  /** Horizontal filter menus for the search workspace; the drawer keeps its vertical layout. */
  readonly layout = input<'vertical' | 'horizontal'>('vertical');
  /** The chip sets are rendered by ID, so a component registered under it replaces the built-in. */
  protected readonly chipSetId = NXS_PRIMITIVE_IDS.chipSet;
  private readonly chipRemovers = new Map<ChoiceField, (item: NxsChipItem) => void>();
  private readonly chipItemsByField = new Map<ChoiceField, NxsChipItem[]>();

  /** The filters shown. Two-way: every change the user makes is written back. */
  readonly filters = model<NxsSearchFilters>(NXS_EMPTY_SEARCH_FILTERS);
  /** The server's aggregates for the query the filters produce: each choice's count. */
  readonly aggregations = input<SearchAggregations>({});
  /**
   * The text shown for a choice, by field and bucket key: the vocabulary label of a nature, subject
   * or coverage id. A choice with no label shows its key. `filters` always keeps the key, so a
   * label never reaches a query or a saved search.
   */
  readonly optionLabels = input<NxsFacetLabels>({});
  /** Reset was pressed: the filters are now empty. A host clears what it keeps beside them. */
  readonly filtersReset = output<void>();
  /** Save as was pressed: the host asks for a name and saves the current filters. */
  readonly saveAs = output<void>();

  private readonly searchService = inject(SearchService);
  private readonly translate = inject(TranslateService);
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
  protected readonly horizontalExpanded: WritableSignal<
    CheckboxField | ChoiceField | 'properties' | null
  > = signal(null);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly propertiesOpen = computed(() =>
    ['properties', 'nature', 'size'].includes(this.horizontalExpanded() ?? ''),
  );

  protected toggleChoice(field: ChoiceField | 'properties', event: Event): void {
    if (this.layout() !== 'horizontal') return;
    event.preventDefault();
    const open =
      field === 'properties' ? this.propertiesOpen() : this.horizontalExpanded() === field;
    this.horizontalExpanded.set(open ? null : field);
  }

  @HostListener('document:click', ['$event'])
  protected closeOutside(event: Event): void {
    if (
      this.layout() === 'horizontal' &&
      !event.composedPath().includes(this.hostElement.nativeElement)
    ) {
      this.horizontalExpanded.set(null);
    }
  }

  @HostListener('keydown.escape')
  protected closeMenus(): void {
    this.horizontalExpanded.set(null);
  }

  protected readonly groups = computed<{ before: CheckboxGroup[]; after: CheckboxGroup[] }>(() => {
    const filters = this.filters();
    const aggregations = this.aggregations();
    return {
      before: [
        {
          field: 'modified',
          titleKey:
            this.layout() === 'horizontal'
              ? 'search.workspace.date'
              : 'satori-components.search-filters.modified.title',
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
          titleKey:
            this.layout() === 'horizontal'
              ? 'search.workspace.categories'
              : 'satori-components.search-filters.subjects',
          options: nxsTermOptions(aggregations.dc_subjects_agg, filters.subjects),
        },
        {
          field: 'coverage',
          titleKey:
            this.layout() === 'horizontal'
              ? 'search.workspace.location'
              : 'satori-components.search-filters.coverage',
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

  /** The authors the server counted for this query, not yet chosen, narrowed by what is typed. */
  protected readonly authorOptions = computed(() => {
    const term = this.authorText().trim().toLowerCase();
    const chosen = this.filters().authors;
    return nxsTermOptions(this.aggregations().dc_creator_agg, []).filter(
      (option) =>
        !chosen.includes(option.value) && (!term || option.value.toLowerCase().includes(term)),
    );
  });

  protected readonly collections = signal<readonly SearchCollectionOption[]>([]);
  protected readonly collectionsState = signal<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  protected readonly collectionOptions = computed(() => {
    const term = this.collectionText().trim().toLowerCase();
    const chosen = this.filters().collections;
    return this.collections().filter(
      (option) =>
        !chosen.includes(option.id) && (!term || option.title.toLowerCase().includes(term)),
    );
  });

  /** A choice leaves its box empty: it is shown as a chip below it. */
  protected readonly emptyDisplay = (): string => '';

  private readonly tagSuggestions = signal<readonly string[]>([]);
  protected readonly tagOptions = computed(() =>
    this.tagSuggestions().filter((label) => !this.filters().tags.includes(label)),
  );
  private readonly tagTerms = new Subject<string>();

  constructor() {
    // What the boxes show follows the filters whenever they change, from here or from the host.
    effect(() => {
      const filters = this.filters();
      untracked(() => {
        this.fulltextDraft.set(filters.fulltext);
        this.expandSelected(filters);
        // Chosen collections are shown by title, which needs the user's collections.
        if (filters.collections.length > 0 && this.collectionsState() === 'idle') {
          this.loadCollections();
        }
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
    if (this.layout() === 'horizontal') return this.horizontalExpanded() === field;
    return this.expanded().has(field);
  }

  protected selectedCount(field: CheckboxField): number {
    return this.filters()[field].length;
  }

  protected toggleGroup(field: CheckboxField): void {
    if (this.layout() === 'horizontal') {
      this.horizontalExpanded.update((current) => (current === field ? null : field));
      return;
    }
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

  protected optionText(group: CheckboxGroup, value: string): string {
    // An own key only: `constructor` or `__proto__` is a bucket key too, not an inherited property.
    const labels = this.optionLabels()[group.field];
    return labels && Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : value;
  }

  protected applyFulltext(): void {
    this.update({ fulltext: this.fulltextDraft().trim() });
  }

  protected clearFulltext(): void {
    this.fulltextDraft.set('');
    this.update({ fulltext: '' });
  }

  protected addChoice(field: ChoiceField, value: string): void {
    const text = { authors: this.authorText, collections: this.collectionText, tags: this.tagText };
    text[field].set('');
    if (field === 'tags') this.tagSuggestions.set([]);
    if (!value || this.filters()[field].includes(value)) return;
    this.update({ [field]: [...this.filters()[field], value] });
  }

  protected removeChoice(field: ChoiceField, value: string): void {
    this.update({ [field]: this.filters()[field].filter((entry) => entry !== value) });
  }

  /**
   * The handler a choice field's chips call when one is removed, built once per field: the outlet
   * that renders the chip set by ID binds no outputs, and a new function each check would reset it.
   */
  protected chipRemover(field: ChoiceField): (item: NxsChipItem) => void {
    let remove = this.chipRemovers.get(field);
    if (!remove) {
      remove = (item) => this.removeChoice(field, item.id);
      this.chipRemovers.set(field, remove);
    }
    return remove;
  }

  /** The chips for one field's chosen values: a collection shows its title, anything else its value. */
  protected chipItems(field: ChoiceField, values: readonly string[]): NxsChipItem[] {
    const items = values.map((value) => {
      const label = field === 'collections' ? this.collectionTitle(value) : value;
      return {
        id: value,
        label,
        removeLabel: this.translate.instant('satori-components.search-filters.remove', {
          value: label,
        }),
      };
    });
    // The overlay view is checked again when the outlet updates its component. Reuse unchanged
    // inputs so that check does not dirty the outlet again; still refresh translated labels.
    const previous = this.chipItemsByField.get(field);
    if (
      previous?.length === items.length &&
      items.every(
        (item, index) =>
          item.id === previous[index].id &&
          item.label === previous[index].label &&
          item.removeLabel === previous[index].removeLabel,
      )
    ) {
      return previous;
    }
    this.chipItemsByField.set(field, items);
    return items;
  }

  protected onCollectionsFocus(): void {
    if (this.collectionsState() === 'loading' || this.collectionsState() === 'loaded') return;
    this.loadCollections();
  }

  private loadCollections(): void {
    this.collectionsState.set('loading');
    this.searchService
      .getUserCollections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (collections) => {
          this.collections.set(collections);
          this.collectionsState.set('loaded');
        },
        error: () => this.collectionsState.set('failed'),
      });
  }

  protected onTagInput(value: string): void {
    this.tagText.set(value);
    this.tagTerms.next(value.trim());
    if (!value.trim()) this.tagSuggestions.set([]);
  }

  protected resetFilters(): void {
    this.filters.set(NXS_EMPTY_SEARCH_FILTERS);
    this.filtersReset.emit();
  }

  /** The title a collection id is shown with, once the user's collections are known. */
  protected collectionTitle(id: string): string {
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
