import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  LOCALE_ID,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsDocumentListComponent,
  type NxsDocumentListColumn,
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
  type ExtensionActionDescriptor,
  descriptorLabel,
} from '@nuxeo/satori-platform/extensions';
import {
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
  type PageProviderSort,
  documentNavigationUrl,
  resolvePaginatedListTotal,
} from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, forkJoin, map, merge, of, startWith, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText } from '../layout-label';
import type { LayoutFieldType } from '../layout.model';
import { type RecordValueContext, showValue, viewText } from './record-field-view';
import type { RecordListEntry, RecordPropertyField } from './record-layout';
import {
  LookupCollector,
  NO_LABELS,
  labelLookups,
  readLabels,
  sameLookups,
} from './record-lookups';
import { WIDGETS_SHOWN_AS_VERSION_1, widgetAccepts, widgetPropertyType } from './widget-support';

/** Today, for relative dates in a list's cells. A token, so that tests choose the day. */
export const RECORD_LIST_TODAY = new InjectionToken<() => Date>('RECORD_LIST_TODAY', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

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

/** What one page is asked with. Compared by value, so that an equal request is never sent twice. */
interface ListRequest {
  readonly pageProvider: string;
  readonly parameters: readonly string[];
  readonly pageSize: number;
  readonly pageIndex: number;
  readonly sort: readonly PageProviderSort[];
  readonly attempt: number;
}

const sameRequest = (a: ListRequest | null, b: ListRequest | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * A list of records: one page of a page provider's results at a time, one row per record, each
 * column a property shown through its widget (layout-v2.md, section 7). A related-records card
 * shows one, and a queue will.
 *
 * A row opens its record. The headers sort, on the server; the list opens in the file's order.
 * A row offers the row actions the file lists that are registered here, while their rules pass.
 * The page provider returns only what the user may read: nothing here is a security control.
 */
@Component({
  selector: 'lib-record-list',
  standalone: true,
  imports: [NxsDocumentListComponent, TranslatePipe],
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

  private readonly pages = inject(PageProviderService);
  private readonly layouts = inject(DocumentLayoutService);
  private readonly extensions = inject(AppExtensionsService);
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly today = inject(RECORD_LIST_TODAY);

  /** What the console has been told, so that a list redrawn for a label does not repeat it. */
  private readonly told = new Set<string>();

  /** Which list this is: another one, or the same for another record, starts on its first page. */
  private readonly identity = computed(() =>
    JSON.stringify([this.list().pageProvider, this.parameters(), this.list().sort]),
  );

  protected readonly pageIndex = linkedSignal({ source: this.identity, computation: () => 0 });

  /** The order chosen from a header; `null`, the file's. */
  private readonly chosenSort = linkedSignal<string, NxsDocumentListSort | null>({
    source: this.identity,
    computation: () => null,
  });

  private readonly attempt = signal(0);

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
              })
              .pipe(
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

  /** The vocabulary entries and the users and groups the cells name: only those are read. */
  private readonly lookups = computed(
    () => {
      const state = this.state();
      const collector = new LookupCollector();
      if (state.status !== 'loaded') return collector.lookups();
      for (const row of state.page.entries) {
        for (const column of this.list().columns) {
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
    toObservable(this.lookups).pipe(switchMap((lookups) => readLabels(this.layouts, lookups))),
    { initialValue: NO_LABELS },
  );

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
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

  protected readonly totalSize = computed(() => {
    const state = this.state();
    return state.status === 'loaded'
      ? resolvePaginatedListTotal(state.page, this.list().pageSize, this.pageIndex())
      : -1;
  });

  protected readonly hasNextPage = computed(() => {
    const state = this.state();
    if (state.status !== 'loaded') return false;
    const { page } = state;
    return page.isNextPageAvailable ?? page.currentPageIndex + 1 < page.numberOfPages;
  });

  /** The header that shows the order: the one chosen, or the file's first key while a column has it. */
  protected readonly shownSort = computed<NxsDocumentListSort | null>(() => {
    const chosen = this.chosenSort();
    if (chosen) return chosen;
    const [first] = this.list().sort;
    if (!first || !this.list().columns.some((column) => column.xpath === first.field)) return null;
    return { key: first.field, direction: first.order };
  });

  protected readonly columns = computed<readonly NxsDocumentListColumn[]>(() => {
    this.translations();
    const state = this.state();
    const context = this.valueContext();
    return this.list().columns.map((column) => ({
      key: column.xpath,
      label: layoutLabelText(this.translate, column.label) ?? column.xpath,
      sortable: true,
      text: (row: NuxeoDocument) =>
        state.status === 'loaded' ? this.cellText(state, row, column, context) : '',
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
      const context = { ...base, document: row };
      const entries = this.extensions
        .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
        .filter((action) => listed.has(action.id) && this.runnable(action))
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

  protected onSort(sort: NxsDocumentListSort | null): void {
    this.chosenSort.set(sort);
    this.pageIndex.set(0);
  }

  protected onPage(index: number): void {
    this.pageIndex.set(index);
  }

  protected onRetry(): void {
    this.attempt.update((n) => n + 1);
  }

  protected onOpen(row: NuxeoDocument): void {
    void this.router.navigateByUrl(documentNavigationUrl(row));
  }

  /** Runs the action with the row in focus, as its menu offered it: resolved again, rules and all. */
  protected onRowAction({ action, document }: NxsDocumentListRowAction): void {
    if (!this.list().rowActions.includes(action.id)) return;
    const context = { ...this.ruleContext.context(), document };
    const descriptor = this.extensions
      .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
      .find((candidate) => candidate.id === action.id);
    if (descriptor && this.runnable(descriptor)) this.actions.execute(descriptor, context);
  }

  /**
   * Whether something on this page runs the action. One with no handler here would do nothing
   * when chosen: it is not offered, and the console says so once. The platform's own row actions
   * are registered by the browse list, so a record page has none of them yet.
   */
  private runnable(action: ExtensionActionDescriptor): boolean {
    if (this.actions.has(action.action ?? action.id)) return true;
    this.tell(`the row action "${action.id}" has nothing to run it on this page; not offered`);
    return false;
  }

  private valueContext(): RecordValueContext {
    const labels = this.labels();
    return {
      locale: this.locale,
      today: this.today(),
      ...labelLookups(labels),
      // A widget parameter that names a property reads the row's own: `currency`'s code.
      property: () => undefined,
      label: (label) => layoutLabelText(this.translate, label),
      flagText: (flag) =>
        this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no'),
      // A table cell's columns: shown to everyone the list shows, since the list has no record
      // of its own to evaluate a rule against.
      rule: () => true,
    };
  }

  /** One cell: the row's value through the column's widget, as one line of text. */
  private cellText(
    state: LoadedPage,
    row: NuxeoDocument,
    column: RecordPropertyField,
    context: RecordValueContext,
  ): string {
    const definition = this.definitionOf(state, row, column);
    if (!definition) return '';
    const label = layoutLabelText(this.translate, column.label) ?? column.xpath;
    const view = showValue(
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
    return viewText(view, context.flagText);
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
    const xpaths = this.list().columns.map((column) => column.xpath);
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
