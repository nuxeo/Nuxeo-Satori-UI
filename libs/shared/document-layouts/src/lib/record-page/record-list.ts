import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsBannerComponent,
  NxsDocumentListComponent,
  type NxsDocumentListColumn,
  type NxsDocumentListLink,
  type NxsDocumentListRowAction,
  type NxsDocumentListSort,
  type NxsErrorStatus,
  type NxsHeadingLevel,
  type NxsMenuAction,
  nxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  SURFACE_RULE_EVALUATORS,
  type ExtensionActionDescriptor,
  type ExtensionRuleContext,
  descriptorLabel,
} from '@nuxeo/satori-platform/extensions';
import {
  DocumentChangesService,
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
  type PageProviderResults,
  type PageProviderSort,
  type ResultWindow,
  documentNavigationUrl,
  resultWindow,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  type Observable,
  catchError,
  filter,
  forkJoin,
  map,
  merge,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText } from '../layout-label';
import type { LayoutFieldType } from '../layout.model';
import {
  type RecordValueContext,
  type RecordValueView,
  showLinkedProperty,
  showValue,
  viewText,
} from './record-field-view';
import type { LinkedProperty } from './linked-record';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import {
  type RecordListEntry,
  type RecordPropertyField,
  columnKey,
  linkedTypesOf,
  ruleRefusal,
  showKey,
  showOf,
  showWidgetOf,
} from './record-layout';
import {
  LookupCollector,
  NO_LABELS,
  NO_RECORDS,
  labelLookups,
  linkedRecordLookup,
  namesOf,
  readLabels,
  recordLookups,
  recordReadOf,
  type RecordRead,
  sameIds,
  sameLookups,
} from './record-lookups';
import { WIDGETS_SHOWN_AS_VERSION_1, widgetAccepts, widgetPropertyType } from './widget-support';

/** One page of a list, with what each row's properties are: `null` where its type was not read. */
interface LoadedPage {
  readonly status: 'loaded';
  readonly page: NuxeoDocumentList;
  readonly properties: ReadonlyMap<string, ReadonlyMap<string, LayoutFieldType> | null>;
}

type ListState =
  /** Not asked for: a parameter has no value. */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | LoadedPage
  | { readonly status: 'failed'; readonly error: NxsErrorStatus };

const IDLE: ListState = { status: 'idle' };
const LOADING: ListState = { status: 'loading' };

/**
 * What one page is asked with. Compared by value, so that one list never sends an equal request
 * twice in a row. A list drawn again, as a tab is when it is shown again, asks again.
 */
interface ListRequest {
  readonly pageProvider: string;
  readonly parameters: readonly string[];
  readonly pageSize: number;
  readonly pageIndex: number;
  readonly sort: readonly PageProviderSort[];
  /** The buckets chosen, by aggregate, in a stable order; none chosen is none sent. */
  readonly aggregates: Readonly<Record<string, readonly string[]>>;
  /** Not sent: a column that appears needs its rows' definitions read, which a response brings. */
  readonly columns: readonly string[];
  readonly attempt: number;
}

/** The property types a header sorts by: one value each. A list, a complex value or a file does not. */
const SORTABLE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'long',
  'integer',
  'double',
  'boolean',
  'date',
]);

const sameRequest = (a: ListRequest | null, b: ListRequest | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The aggregates with a bucket chosen, in the order of their ids, each one's keys sorted. */
function chosenBuckets(
  aggregates: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.keys(aggregates)
      .sort()
      .filter((aggregate) => aggregates[aggregate].length > 0)
      .map((aggregate) => [aggregate, [...new Set(aggregates[aggregate])].sort()]),
  );
}

/**
 * The rules that answer from what the page publishes about its own record, the one in focus
 * (`ExtensionRuleContext.flags`): whether it is a favourite, locked, subscribed, in the clipboard,
 * has a version, whether AI is on, whether an operation on it is in flight. A row is another
 * record, and nothing publishes that for it. `app.rules.isNote` is in the same map and reads the
 * document, which a row's context has. Known by ID: a customer's own evaluator registered under
 * one of these IDs is refused too.
 */
const PAGE_STATE_RULES: ReadonlySet<string> = new Set(
  Object.keys(SURFACE_RULE_EVALUATORS).filter((id) => id !== 'app.rules.isNote'),
);

const refusePageState = (id: string): string | null =>
  PAGE_STATE_RULES.has(id)
    ? `names the rule "${id}", which is refused for a row: as packaged, it answers for the page's own record`
    : null;

/**
 * A row's rule context, for its menu and for running a choice from it: the row in focus, and none
 * of the state the page publishes about its own record. A rule of a customer's own that reads
 * `flags` finds none for a row.
 */
const rowContext = (base: ExtensionRuleContext, row: NuxeoDocument): ExtensionRuleContext => ({
  ...base,
  document: row,
  flags: {},
});

/**
 * A list of records: one page of a page provider's results at a time, one row per record, each
 * column a property shown through its widget (layout-v2.md, section 7). A related-records card
 * shows one, and so does a queue (app-definition-v2.md, section 4).
 *
 * A row opens its record, and a `document-link` cell opens the record it names, by its title. The
 * headers sort, on the server; the list opens in the file's order.
 * A row offers the row actions the file lists that are registered here, while their rules pass.
 * A queue also filters the list by the buckets chosen in its facets, and lets rows be selected.
 * The page provider returns only what the user may read: nothing here is a security control.
 *
 * **The search index's window.** A page provider the search index serves refuses a page that ends
 * past its `max_result_window`, 10,000 results by default (`resultWindow`). The list never asks for
 * one: past the last page within the window it offers no next page, whatever the server says of
 * one, and refuses a page asked for beyond it (`onPage`, the only way to another page but the
 * first, to which other results, another order and another page size return). It still shows the
 * server's whole count, and says, above the rows, how many of them the pages reach and how to find
 * the rest.
 */
@Component({
  selector: 'lib-record-list',
  standalone: true,
  imports: [NxsBannerComponent, NxsDocumentListComponent, TranslatePipe],
  templateUrl: './record-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordListComponent {
  readonly list = input.required<RecordListEntry>();
  /**
   * The page provider's parameters, already read: from the open record, for a card. `null` when
   * one has no value, and the list is then not asked for.
   */
  readonly parameters = input.required<readonly string[] | null>();
  /** The list's name, for assistive technology: the card's heading. */
  readonly label = input.required<string>();
  /** The level of the heading of an empty or failed list: one below the card's. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(4);
  /** Where the list is written, for the console: `Member/view layout: cards[2]`. */
  readonly source = input('');
  /**
   * The buckets chosen in the page provider's aggregates, by aggregate id: a queue's facets. The
   * list keeps the records in any chosen bucket of an aggregate, and starts again on its first
   * page when they change.
   */
  readonly aggregates = input<Readonly<Record<string, readonly string[]>>>({});
  /** Whether rows can be selected, for a queue's bulk actions. */
  readonly selectable = input(false);
  /** The selected rows' ids, on every page. Two-way: `[(selectedIds)]`. */
  readonly selectedIds = model<readonly string[]>([]);
  /** What an empty list says; the related-records card's text when `null`. */
  readonly emptyHeading = input<string | null>(null);
  /**
   * Whether filters beside the list narrow it, as a queue's facets do: what the list says of
   * results past the search index's window then names them.
   */
  readonly filterable = input(false);
  /** Each page as the server returned it, with its aggregates: what a queue's facets show. */
  readonly loaded = output<PageProviderResults>();

  private readonly pages = inject(PageProviderService);
  private readonly documentChanges = inject(DocumentChangesService);
  private readonly layouts = inject(DocumentLayoutService);
  /** The record page's, for one of its cards, so the page and its lists read a record once. */
  private readonly linkedRecords = linkedRecordLookup();
  private readonly extensions = inject(AppExtensionsService);
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);

  /** What the console has been told, so that a list redrawn for a label does not repeat it. */
  private readonly told = new Set<string>();

  /** Which list this is: another one, or the same for another record, starts on its first page. */
  private readonly identity = computed(() =>
    JSON.stringify([this.list().pageProvider, this.parameters(), this.list().sort]),
  );

  /** The buckets chosen, written the same way for the same choice. */
  private readonly chosen = computed(() => chosenBuckets(this.aggregates()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /** Which results these are: another list, or other buckets chosen. Not the order. */
  private readonly results = computed(() =>
    // The page size too: a page index, and a window's reach, are counted in pages of it.
    JSON.stringify([this.identity(), this.chosen(), this.list().pageSize]),
  );

  /**
   * Another list, other buckets chosen, or another page size, starts on the first page; the order
   * chosen stays.
   */
  protected readonly pageIndex = linkedSignal({
    source: this.results,
    computation: () => 0,
  });

  /**
   * The window the last page read reported, kept while the next one loads, so that no page past
   * it is asked for in between. Other results start with none: their first page is always within it.
   */
  private readonly window = linkedSignal<string, ResultWindow | null>({
    source: this.results,
    computation: () => null,
  });

  /** The order chosen from a header; `null`, the file's. */
  protected readonly chosenSort = linkedSignal<string, NxsDocumentListSort | null>({
    source: this.identity,
    computation: () => null,
  });

  private readonly attempt = signal(0);

  /**
   * The columns drawn. One whose rule is still to answer is not: the caller answers each column's
   * rule for the record and the user, as the record page does, and hands over those that pass.
   * Drawn, an unanswered rule's column would show to everyone.
   */
  private readonly shownColumns = computed<readonly RecordPropertyField[]>(() =>
    this.list().columns.filter((column) => {
      if (column.visibleWhen === null) return true;
      this.tell(`${column.place} has a rule the list was not given an answer for; not drawn`);
      return false;
    }),
  );

  /**
   * What each column with a `show` reads of the records it links to, by the column's place, from
   * its types' definitions (layout-v2.md, section 12): `null` until they are read, which a list
   * with none has at once.
   */
  private readonly shows = toSignal(
    toObservable(this.shownColumns).pipe(
      switchMap((columns): Observable<ReadonlyMap<string, LinkedProperty | null>> => {
        const linked = columns.filter((column) => showOf(column) !== null);
        if (linked.length === 0) return of(new Map());
        return forkJoin(
          linked.map((column) =>
            this.layouts.linkedProperty(linkedTypesOf(column), showOf(column) as string),
          ),
        ).pipe(
          map((read) => new Map(linked.map((column, index) => [showKey(column), read[index]]))),
        );
      }),
    ),
    { initialValue: null },
  );

  /**
   * What a column with a `show` shows, once its types are read: `undefined` until then, and `null`
   * where none of them has the property, or it is itself a reference, and the column is left out.
   */
  private linkedOf(column: RecordPropertyField): LinkedProperty | null | undefined {
    const linked = this.shows()?.get(showKey(column));
    if (linked === undefined) return undefined;
    if (linked === null) {
      this.tell(
        `${column.place}: none of the types it links to has ${showOf(column)}, or their schemas could not be read; that column left out`,
      );
      return null;
    }
    if (linked.definition.documentReference) {
      this.tell(
        `${column.place}: ${showOf(column)} is itself a reference, and would show another record's stored id; that column left out`,
      );
      return null;
    }
    return linked;
  }

  /** The columns drawn: those shown, but a `show` that cannot be. */
  private readonly drawnColumns = computed(() =>
    this.shownColumns().filter(
      (column) => showOf(column) === null || this.linkedOf(column) !== null,
    ),
  );

  private readonly request = computed<ListRequest | null>(
    () => {
      const parameters = this.parameters();
      if (parameters === null) return null;
      const list = this.list();
      const chosen = this.chosenSort();
      return {
        pageProvider: list.pageProvider,
        parameters,
        pageSize: list.pageSize,
        pageIndex: this.pageIndex(),
        sort: chosen ? [{ field: chosen.key, order: chosen.direction }] : list.sort,
        aggregates: this.chosen(),
        columns: this.shownColumns().map((column) => column.xpath),
        attempt: this.attempt(),
      };
    },
    { equal: sameRequest },
  );

  /**
   * The page on screen. Loading as soon as another is asked for, so that one record's rows never
   * show under the next one's heading.
   */
  private readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap((request) =>
        request === null
          ? of(IDLE)
          : this.pages
              .execute(request.pageProvider, {
                parameters: request.parameters,
                pageSize: request.pageSize,
                pageIndex: request.pageIndex,
                sort: request.sort,
                ...(Object.keys(request.aggregates).length > 0
                  ? { aggregates: request.aggregates }
                  : {}),
              })
              .pipe(
                tap((page) => {
                  this.window.set(resultWindow(page, request.pageSize));
                  this.loaded.emit(page);
                }),
                switchMap((page) => this.withProperties(page)),
                startWith(LOADING),
                catchError((error: unknown) => {
                  this.tell(`${this.list().pageProvider} not read: ${describe(error)}`);
                  return of<ListState>({ status: 'failed', error: nxsErrorStatus(error) });
                }),
              ),
      ),
    ),
    { initialValue: LOADING },
  );

  /**
   * The vocabulary entries, the users and groups, and the linked records the cells name: only
   * those are read, for the whole page at once, never cell by cell.
   */
  private readonly lookups = computed(
    () => {
      const state = this.state();
      const collector = new LookupCollector();
      if (state.status !== 'loaded') return collector.lookups();
      const columns = this.drawnColumns();
      for (const column of columns) {
        const linked = showOf(column) === null ? null : this.linkedOf(column);
        if (linked) collector.schema(linked.schema);
      }
      for (const row of state.page.entries) {
        for (const column of columns) {
          const definition = this.definitionOf(state, row, column);
          if (!definition) continue;
          collector.value(
            this.widgetFor(column, definition),
            column.parameters,
            definition,
            row.properties[column.xpath],
          );
        }
      }
      return collector.lookups();
    },
    { equal: sameLookups },
  );

  private readonly labels = toSignal(
    toObservable(namesOf(this.lookups)).pipe(
      switchMap((lookups) => readLabels(this.layouts, lookups)),
    ),
    { initialValue: NO_LABELS },
  );

  /**
   * The records the page's `document-link` cells name: one request for the ids each page adds, so
   * a page read before, or another order of the same rows, asks for nothing. With the schemas its
   * columns' `show` read, once those are known, so that a record is read once with them.
   */
  private readonly recordRead = recordReadOf(this.lookups);

  /** Whether every column's `show` is known: its types read for these columns. */
  private readonly showsKnown = computed(() => {
    const shows = this.shows();
    return (
      shows !== null &&
      this.shownColumns().every((column) => showOf(column) === null || shows.has(showKey(column)))
    );
  });

  private readonly records = toSignal(
    toObservable(
      computed(() => (this.showsKnown() ? this.recordRead() : null), {
        equal: (a, b) =>
          a === b ||
          (a !== null && b !== null && sameIds(a.ids, b.ids) && sameIds(a.schemas, b.schemas)),
      }),
    ).pipe(
      // Until they are, the records read so far stay shown, and nothing is asked for.
      filter((read): read is RecordRead => read !== null),
      switchMap((read) => this.linkedRecords.records(read.ids, read.schemas)),
    ),
    { initialValue: NO_RECORDS },
  );

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
    // A row action, here or on another list, may have renamed, moved or trashed one of these rows,
    // or copied a record into this list: the page on screen is asked for again.
    this.documentChanges.changes
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.attempt.update((n) => n + 1));
  }

  protected readonly documents = computed<readonly NuxeoDocument[]>(() => {
    const state = this.state();
    return state.status === 'loaded' ? state.page.entries : [];
  });

  protected readonly loading = computed(() => this.state().status === 'loading');

  protected readonly error = computed<NxsErrorStatus | null>(() => {
    const state = this.state();
    return state.status === 'failed' ? state.error : null;
  });

  /** The window of the page on screen; `null` while none is. */
  private readonly shownWindow = computed<ResultWindow | null>(() => {
    const state = this.state();
    return state.status === 'loaded' ? resultWindow(state.page, this.list().pageSize) : null;
  });

  /**
   * How many records the list holds: the server's whole count, also past the search index's
   * window, or `-1`, unknown, where it gave none, as Nuxeo's `-2` past `resultsCountLimit` is.
   * Never an estimate, nor the window: the list shows it, and tells assistive technology it is the
   * number of rows.
   */
  protected readonly totalSize = computed(() => this.shownWindow()?.total ?? -1);

  /** Where the server stopped counting, for "of more than N"; `-1` for none. */
  protected readonly totalMoreThan = computed(() => this.shownWindow()?.moreThan ?? -1);

  /** Another page, by the server's word, unless it would end past the window. */
  protected readonly hasNextPage = computed(() => {
    const state = this.state();
    if (state.status !== 'loaded') return false;
    const { page } = state;
    const more = page.isNextPageAvailable ?? page.currentPageIndex + 1 < page.numberOfPages;
    return more && this.servable(this.pageIndex() + 1);
  });

  /**
   * What the list says above its rows when the query holds more than its pages reach: how many
   * they reach, of how many, and to narrow the list to find the others. Kept while the next page
   * loads; not over a failure, which says what failed instead.
   */
  protected readonly windowNotice = computed<string | null>(() => {
    this.translations();
    const known = this.window();
    // A reach is always below the total: some results are out of the pages' reach. At a count
    // within the window it is known on its last served page only, so the notice shows there.
    if (known === null || known.reach === null || known.total === null) return null;
    if (this.state().status === 'failed') return null;
    return this.translate.instant(
      this.filterable()
        ? 'document-layouts.list.past-window-filters'
        : 'document-layouts.list.past-window',
      { reach: this.format(known.reach), total: this.format(known.total) },
    );
  });

  /**
   * The file's order, by its first key, for the list's header while a column shows that property:
   * it shows it while no other is chosen, and turns it round rather than clearing it.
   */
  protected readonly defaultSort = computed<NxsDocumentListSort | null>(() => {
    const [first] = this.list().sort;
    if (!first || !this.shownColumns().some((column) => column.xpath === first.field)) return null;
    return { key: first.field, direction: first.order };
  });

  protected readonly columns = computed<readonly NxsDocumentListColumn[]>(() => {
    this.translations();
    const state = this.state();
    const context = this.valueContext();
    return this.drawnColumns().map((column) => ({
      key: columnKey(column),
      label: layoutLabelText(this.translate, column.label) ?? column.xpath,
      // A linked record's property is not this list's to sort by (layout-v2.md, section 12).
      sortable:
        state.status === 'loaded' && showOf(column) === null && this.sortable(state, column),
      text: (row: NuxeoDocument) =>
        state.status === 'loaded'
          ? viewText(this.cell(state, row, column, context), context.flagText)
          : '',
      // A record the cell names opens through the router, as the row does.
      ...(column.widget === 'document-link'
        ? {
            links: (row: NuxeoDocument): readonly NxsDocumentListLink[] | null => {
              if (state.status !== 'loaded') return null;
              const view = this.cell(state, row, column, context);
              return view.kind === 'records'
                ? view.records.map((record) => ({ text: record.text, routerLink: record.url }))
                : null;
            },
          }
        : {}),
    }));
  });

  /** Each row's menu: the listed row actions registered here whose rules pass for that row. */
  protected readonly rowMenus = computed<Readonly<Record<string, readonly NxsMenuAction[]>>>(() => {
    this.translations();
    const listed = new Set(this.list().rowActions);
    if (listed.size === 0) return {};
    const base = this.ruleContext.context();
    const menus: Record<string, NxsMenuAction[]> = {};
    for (const row of this.documents()) {
      const context = rowContext(base, row);
      const entries = this.extensions
        .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
        .filter((action) => listed.has(action.id) && this.offered(action))
        .map((action): NxsMenuAction => ({
          id: action.id,
          label: descriptorLabel(action, (key) => this.translate.instant(key)),
          icon: action.icon,
          disabled: !this.extensions.evaluateRule(action.enabledRule, context),
        }));
      if (entries.length > 0) menus[row.uid] = entries;
    }
    return menus;
  });

  /**
   * `null` goes back to the file's order, and so does the header of that order turned back to its
   * own direction: the file's order whole, with every key it sorts by, not its first alone.
   */
  protected onSort(sort: NxsDocumentListSort | null): void {
    const own = this.defaultSort();
    const isOwn = sort !== null && own?.key === sort.key && own.direction === sort.direction;
    this.chosenSort.set(isOwn ? null : sort);
    this.pageIndex.set(0);
  }

  /** A page past the window is refused, never asked for: the server would answer HTTP 500. */
  protected onPage(index: number): void {
    if (!this.servable(index)) return;
    this.pageIndex.set(index);
  }

  /**
   * Whether the server can serve the page `index`: a page from the first, which ends within the
   * window the last page read reported, where one cuts the results short.
   */
  private servable(index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    const reach = this.window()?.reach ?? null;
    // As `resultWindow` counts a page size that is not a whole number from 1.
    const { pageSize } = this.list();
    const size = Number.isInteger(pageSize) && pageSize >= 1 ? pageSize : 1;
    return reach === null || (index + 1) * size <= reach;
  }

  /**
   * Asks again. After a failure under an order chosen from a header, the order may be what failed:
   * Nuxeo refuses some sorts, such as a text field in OpenSearch. Retrying then goes back to the
   * file's order, rather than sending the same refusal again. Every retry counts an attempt, so it
   * is always sent.
   */
  protected onRetry(): void {
    if (this.state().status === 'failed' && this.chosenSort() !== null) {
      this.chosenSort.set(null);
      this.pageIndex.set(0);
    }
    this.attempt.update((n) => n + 1);
  }

  protected onOpen(row: NuxeoDocument): void {
    void this.router.navigateByUrl(documentNavigationUrl(row));
  }

  /**
   * Runs the action with the row in focus, as its menu offered it: resolved again with its rule,
   * and run only while its `enabledRule` passes too.
   */
  protected onRowAction({ action, document }: NxsDocumentListRowAction): void {
    if (!this.list().rowActions.includes(action.id)) return;
    const context = rowContext(this.ruleContext.context(), document);
    const descriptor = this.extensions
      .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
      .find((candidate) => candidate.id === action.id);
    if (!descriptor || !this.offered(descriptor)) return;
    if (!this.extensions.evaluateRule(descriptor.enabledRule, context)) return;
    this.actions.execute(descriptor, context);
  }

  /**
   * Whether a row offers the action, its rules aside: something on this page runs it, and a row
   * can answer its rules. Otherwise it is not offered, and the console says why once.
   *
   * - One with no handler here would do nothing when chosen. The platform's own row actions are
   *   registered once for the whole app, by `providePackagedRowActions()`.
   * - One whose `rule` or `enabledRule` names a rule that answers for the page's own record
   *   ({@link PAGE_STATE_RULES}), itself or inside `core.every`, `core.some` or `core.not`, would
   *   show or run on that record's state, not the row's. A customer's own composite is not looked
   *   into: the rules inside it see the row's context, which has no page flags. One whose rule has
   *   already answered no for the row is not offered either way.
   * - One whose rule nests deeper than the rule registry answers, as a field's does.
   */
  private offered(action: ExtensionActionDescriptor): boolean {
    if (!this.actions.has(action.action ?? action.id)) {
      this.tell(`the row action "${action.id}" has nothing to run it on this page; not offered`);
      return false;
    }
    const refused =
      ruleRefusal(action.rule, refusePageState) ?? ruleRefusal(action.enabledRule, refusePageState);
    if (refused) {
      this.tell(`the row action "${action.id}" ${refused}; not offered`);
      return false;
    }
    return true;
  }

  private valueContext(): RecordValueContext {
    const labels = this.labels();
    return {
      locale: this.locale,
      today: this.today(),
      ...labelLookups(labels),
      ...recordLookups(
        this.records(),
        this.translate.instant('document-layouts.record.unavailable'),
      ),
      // Set for each cell to the row's own: `currency`'s code may name a property.
      property: () => undefined,
      label: (label) => layoutLabelText(this.translate, label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
      // Only a table's columns have rules, and a table is never drawn in a cell: the reader leaves
      // such a column out. Were one to reach here, its rule-gated columns would stay hidden.
      rule: () => false,
      timeZone: this.timeZone,
    };
  }

  /** One cell: the row's value through the column's widget. */
  private cell(
    state: LoadedPage,
    row: NuxeoDocument,
    column: RecordPropertyField,
    context: RecordValueContext,
  ): RecordValueView {
    const definition = this.definitionOf(state, row, column);
    if (!definition) return { kind: 'empty' };
    const show = showOf(column);
    if (show !== null) {
      const linked = this.linkedOf(column);
      if (linked === undefined) return { kind: 'records', records: [] };
      if (linked === null) return { kind: 'empty' };
      const { widget, parameters } = showWidgetOf(column);
      // A widget that does not show the linked property's type leaves the cell to its type's view.
      return showLinkedProperty(
        row.properties[column.xpath],
        {
          xpath: show,
          definition: linked.definition,
          widget: widget !== null && widgetAccepts(widget, linked.definition) ? widget : null,
          parameters,
        },
        context,
      );
    }
    const label = layoutLabelText(this.translate, column.label) ?? column.xpath;
    return showValue(
      {
        key: column.xpath,
        label,
        value: row.properties[column.xpath],
        parameters: column.parameters,
        definition,
      },
      this.widgetFor(column, definition),
      { ...context, property: (xpath) => row.properties[xpath] },
    );
  }

  /**
   * What the row's property is: its schema's definition; text where the row's type could not be
   * read; `null` where its type has no such property, and the cell is empty.
   */
  private definitionOf(
    state: LoadedPage,
    row: NuxeoDocument,
    column: RecordPropertyField,
  ): LayoutFieldType | null {
    const properties = state.properties.get(row.uid);
    if (properties === undefined || properties === null) return { type: 'string' };
    return properties.get(column.xpath) ?? null;
  }

  /**
   * Whether the column's header sorts: while the rows' type gives its property a single value.
   * Read from the first row that has it, since a page provider's rows are usually of one type.
   */
  private sortable(state: LoadedPage, column: RecordPropertyField): boolean {
    for (const row of state.page.entries) {
      const definition = state.properties.get(row.uid)?.get(column.xpath);
      if (definition) return SORTABLE_TYPES.has(definition.type);
    }
    return false;
  }

  /** The column's widget, held to the row's property type: one that does not show it gives way. */
  private widgetFor(column: RecordPropertyField, definition: LayoutFieldType): string | null {
    const { widget } = column;
    if (widget === null) return null;
    if (WIDGETS_SHOWN_AS_VERSION_1.has(widget)) {
      this.tell(
        `${column.place}: the widget "${widget}" shows the property's own value in this build`,
      );
      return widget;
    }
    if (widgetAccepts(widget, definition)) return widget;
    this.tell(
      `${column.place}: the widget "${widget}" does not show ${column.xpath}, a ${widgetPropertyType(definition)} value on these records, so the cell shows the value itself`,
    );
    return null;
  }

  /** The page, with each row's property definitions read: one read per type, shared. */
  private withProperties(page: NuxeoDocumentList) {
    const rows = page.entries ?? [];
    const xpaths = this.shownColumns().map((column) => column.xpath);
    if (rows.length === 0) {
      return of<ListState>({
        status: 'loaded',
        page: { ...page, entries: [] },
        properties: new Map(),
      });
    }
    return forkJoin(rows.map((row) => this.layouts.rowPropertiesOf(row, xpaths))).pipe(
      map((read): ListState => ({
        status: 'loaded',
        page,
        properties: new Map(rows.map((row, index) => [row.uid, read[index]])),
      })),
    );
  }

  /** A count written for the person, in the language shown, as the queue writes its own. */
  private format(value: number): string {
    try {
      return new Intl.NumberFormat(this.translate.getCurrentLang() || this.locale).format(value);
    } catch {
      return String(value);
    }
  }

  /** Once per list: the cells are redrawn as labels arrive, and the console need not hear it twice. */
  private tell(message: string): void {
    const source = this.source();
    const whole = source ? `${source}: ${message}` : message;
    if (this.told.has(whole)) return;
    this.told.add(whole);
    console.warn(`[agentic-ui-layouts] ${whole}`);
  }
}

function describe(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status !== 0) return `HTTP ${status}`;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'the request failed';
}
