import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RecordListComponent, type RecordListEntry } from '@agentic-ui/shared/document-layouts';
import {
  NxsBannerComponent,
  NxsConfirmDialogComponent,
  type NxsBannerAction,
  type NxsBannerAnnounce,
  type NxsBannerTone,
  type NxsConfirmDialogData,
} from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
  descriptorLabel,
  wholeQueryBulkAction,
  type ExtensionActionDescriptor,
  type ExtensionRule,
  type ExtensionRuleContext,
  type WholeQueryBulkAction,
} from '@nuxeo/satori-platform/extensions';
import {
  BulkCommandService,
  DocumentChangesService,
  SelectionService,
  type BulkCommandStatus,
  type NuxeoDocument,
  type PageProviderResults,
  resultWindow,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  Subject,
  type Subscription,
  filter,
  map,
  merge,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';

import { facetBuckets } from '../facets';
import { readQueue, type QueueFile } from '../queue-file';
import { QueueService, type QueueLoad } from '../queue.service';
import {
  QUEUE_WHOLE_QUERY_TIMING,
  runWholeQuery,
  type WholeQueryOutcome,
} from '../whole-query-run';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'queue'; readonly id: string; readonly queue: QueueFile };

const LOADING: State = { kind: 'loading' };

/** A facet as the page draws it: its buckets, each with its count written for the person. */
interface DrawnFacet {
  readonly aggregate: string;
  readonly label: string;
  readonly buckets: readonly {
    readonly key: string;
    readonly count: string | null;
    readonly chosen: boolean;
  }[];
  readonly truncated: boolean;
}

type Chosen = Readonly<Record<string, readonly string[]>>;

/** A bulk action the queue offers over every result of its query, as the person sees it. */
interface WholeQueryAction {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly mapped: WholeQueryBulkAction;
}

/** A bulk action over the whole query, from the moment it is confirmed. */
interface WholeQueryRun {
  readonly label: string;
  /** The count the confirmation named. */
  readonly confirmed: number;
  /** The last status read; `null` until the server has taken the command. */
  readonly status: BulkCommandStatus | null;
  readonly outcome: WholeQueryOutcome | null;
  /** Whether the person has asked for it to stop. */
  readonly stopping: boolean;
}

/** A notice the page shows above the list, for the whole query. */
interface WholeQueryNotice {
  readonly message: string;
  readonly tone: NxsBannerTone;
  readonly announce: NxsBannerAnnounce;
  readonly actions: readonly NxsBannerAction[];
  /** While a command runs: its progress, with `max` `null` until the server has counted. */
  readonly progress: {
    readonly value: number;
    readonly max: number | null;
    readonly label: string;
  } | null;
}

function warn(message: string): void {
  console.warn(`[agentic-ui-queues] ${message}`);
}

/**
 * A queue: an app's `queues/<id>.json` drawn as a list of records under its name
 * (docs/business-apps/app-definition-v2.md, section 4), at `/queues/<id>`.
 *
 * - **The list** is the record page's: the page provider's results, page by page, with the file's
 *   columns, order and row actions, sorted on the server from a header, and each row opening its
 *   record.
 * - **The facets** are the page provider's aggregates, from the results. Choosing a bucket sends
 *   it back as the search page sends its filters, and the list starts again on its first page.
 * - **Selecting rows** offers the queue's bulk actions in the app's selection bar: those the
 *   `bulk-actions` slot resolves that have a handler here.
 * - **Every result of the query** can be selected instead, for the queue's bulk actions that the
 *   platform maps to an action of the Bulk Action Framework. The page confirms, naming the number,
 *   runs the action on the server, follows it, and reads the list again (`runWholeQuery`).
 * - **Past the search index's window**, 10,000 results by default, the list's pages stop, and it
 *   says so and points to the facets (`RecordListComponent`). The count it names, and the command
 *   an action over every result sends, still cover the whole query: the framework reads the query
 *   on the server rather than page by page, which is not expected to meet the window, though it
 *   was not run past 10,000 records here (docs/api-integrations.md, section 33).
 * - **The queue shows** while its rule holds for the person signed in, with their groups and no
 *   record. Hiding a queue is not a security control: the address still answers, and the page
 *   provider returns only what the person may read.
 */
@Component({
  selector: 'lib-queue-page',
  standalone: true,
  imports: [MatCheckboxModule, NxsBannerComponent, RecordListComponent, TranslatePipe],
  templateUrl: './queue-page.html',
  styleUrl: './queue-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuePageComponent {
  /** The queue's id, from the address: `/queues/<id>`. */
  readonly id = input('');
  /**
   * A queue file to draw in place of the one served at `id`: the layout designer's preview of a
   * file it edits, read as a served one is. With one, nothing is read for `id`, and the console is
   * not told what the file leaves out: the designer lists that itself, with `readQueue`.
   */
  readonly content = input<unknown>(undefined);
  /**
   * Draws the queue for reading only, as the layout designer's preview does: no row can be
   * selected, and no row action, bulk action or action over the whole query is offered, so nothing
   * on the page can change a record. The page provider is still asked for its records, and a facet
   * still filters them. The app's selection, and what its selection bar offers, are left as the
   * page around it has them.
   */
  readonly readOnly = input(false);

  private readonly queues = inject(QueueService);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly slots = inject(ExtensionSlotRegistry);
  private readonly extensions = inject(AppExtensionsService);
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly selection = inject(SelectionService);
  private readonly translate = inject(TranslateService);
  private readonly bulk = inject(BulkCommandService);
  private readonly dialog = inject(MatDialog);
  private readonly documentChanges = inject(DocumentChangesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timing = inject(QUEUE_WHOLE_QUERY_TIMING);

  /** What the console has been told, so that a page drawn again does not repeat it. */
  private readonly told = new Set<string>();

  /** Bumped when the language or a catalogue changes, so names resolved with `instant` follow. */
  private readonly translations = signal(0);

  /** What the page draws: the file served at `id`, or the one it is given. */
  private readonly source = computed(() => ({ id: this.id(), content: this.content() }));

  protected readonly state = toSignal(
    toObservable(this.source).pipe(
      switchMap(({ id, content }) =>
        content !== undefined
          ? of(this.read(id, { kind: 'file', content }, false))
          : this.queues.load(id).pipe(
              map((load) => this.read(id, load)),
              startWith(LOADING),
            ),
      ),
    ),
    { initialValue: LOADING },
  );

  private readonly queue = computed(() => {
    const state = this.state();
    return state.kind === 'queue' ? state.queue : null;
  });

  /** The context the queue's rule sees: the person and their groups, and no record. */
  private readonly context = computed<ExtensionRuleContext>(() => ({
    ...this.ruleContext.context(),
    document: null,
    selection: [],
    selectionCount: 0,
  }));

  /**
   * The queue's list as this person sees it: each column's rule answered, as the record page
   * answers a related list's, with the same context as the queue's own. The list draws no column
   * whose rule it was not given an answer for. Read-only, it offers no row action.
   */
  private readonly list = computed<RecordListEntry | null>(() => {
    const queue = this.queue();
    if (queue === null) return null;
    const context = this.context();
    return {
      ...queue.list,
      rowActions: this.readOnly() ? [] : queue.list.rowActions,
      columns: queue.list.columns
        .filter(
          (column) =>
            column.visibleWhen === null ||
            this.rules.evaluate(column.visibleWhen as ExtensionRule, context),
        )
        .map((column) => ({ ...column, visibleWhen: null })),
    };
  });

  /**
   * What the page shows: the queue, or why there is none. A queue none of whose columns is for
   * this person is hidden, as one whose own rule does not pass is: there is no list to draw.
   */
  protected readonly view = computed<State['kind'] | 'hidden'>(() => {
    const state = this.state();
    if (state.kind !== 'queue') return state.kind;
    const { queue } = state;
    if (queue.alwaysHidden || !this.rules.evaluate(queue.visibleWhen, this.context()))
      return 'hidden';
    if ((this.list()?.columns.length ?? 0) === 0) return 'hidden';
    return 'queue';
  });

  /** The queue and its list as this person sees it, while the page shows it. */
  protected readonly shown = computed(() => {
    const state = this.state();
    const list = this.list();
    return state.kind === 'queue' && list !== null && this.view() === 'queue'
      ? { ...state, list }
      : null;
  });

  /** The queue's name, or the page's own while there is no queue to show. */
  protected readonly title = computed(() => {
    this.translations();
    const shown = this.shown();
    return shown && (this.text(shown.queue.label, shown.queue.labelKey) || shown.id);
  });

  /** The buckets chosen, by aggregate. Another queue starts with none. */
  protected readonly chosen = linkedSignal<QueueFile | null, Chosen>({
    source: this.queue,
    computation: () => ({}),
  });

  /** The last results' aggregates, kept while the next page loads so the facets do not flicker. */
  private readonly aggregations = linkedSignal<QueueFile | null, unknown>({
    source: this.queue,
    computation: () => undefined,
  });

  /** The rows of the page on screen, for the selection bar's names. */
  private readonly rows = linkedSignal<QueueFile | null, readonly NuxeoDocument[]>({
    source: this.queue,
    computation: () => [],
  });

  protected readonly facets = computed<readonly DrawnFacet[]>(() => {
    this.translations();
    const queue = this.queue();
    const aggregations = this.aggregations();
    if (queue === null || aggregations === undefined) return [];
    const chosen = this.chosen();
    const drawn: DrawnFacet[] = [];
    queue.facets.forEach((facet, index) => {
      const keys = chosen[facet.aggregate] ?? [];
      const read = facetBuckets(aggregations, facet.aggregate, keys);
      if (read.kind === 'none') {
        this.tell(`facets[${index}] not drawn: ${read.reason}`);
        return;
      }
      drawn.push({
        aggregate: facet.aggregate,
        label: this.text(facet.label, facet.labelKey) || facet.labelKey || facet.aggregate,
        buckets: read.buckets.map((bucket) => ({
          key: bucket.key,
          count: bucket.count === null ? null : this.format(bucket.count),
          chosen: keys.includes(bucket.key),
        })),
        truncated: read.truncated,
      });
    });
    return drawn;
  });

  /**
   * The queue's bulk actions that a selection may offer: those the `bulk-actions` slot resolves for
   * a selection of one row or of several, and that have a handler here. The selection bar then
   * offers those of them whose rules pass for the rows actually selected. One with nothing to run
   * it would do nothing when chosen, so it is not offered, and the console says so once. None
   * while the page is read-only.
   */
  protected readonly bulkActions = computed<readonly string[]>(() => {
    const queue = this.queue();
    if (queue === null || queue.bulkActions.length === 0 || this.readOnly()) return [];
    const base = this.ruleContext.context();
    const count = this.selection.selectedCount();
    // Both: a rule may ask for a single row, or for several, and rows must be selectable for
    // either to be reached.
    const resolved = new Map(
      [Math.max(1, count), Math.max(2, count)].flatMap((selectionCount) =>
        this.extensions
          .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS['bulk-actions'], {
            ...base,
            document: null,
            selectionCount,
          })
          .map((action): [string, ExtensionActionDescriptor] => [action.id, action]),
      ),
    );
    return queue.bulkActions.filter((id, index) => {
      const action = resolved.get(id);
      if (action === undefined) {
        this.tell(
          `bulkActions[${index}] "${id}" is not offered here: the bulk-actions slot does not resolve it, so it is not registered in this build, or a manifest or its rule hides it`,
        );
        return false;
      }
      if (this.actions.has(action.action ?? id)) return true;
      this.tell(`bulkActions[${index}] "${id}" has nothing to run it on this page; not offered`);
      return false;
    });
  });

  protected readonly selectedIds = computed(() => [...this.selection.selectedIds()]);

  /**
   * How many records the queue's query holds, from the last page read: the server's count, or `-1`
   * where it gave none, as the list reads it. Never an estimate: a confirmation names it.
   */
  private readonly total = linkedSignal<QueueFile | null, number>({
    source: this.queue,
    computation: () => -1,
  });

  /** Whether a bucket is chosen: the server would not keep it in a command over the whole query. */
  protected readonly filtered = computed(() =>
    Object.values(this.chosen()).some((keys) => keys.length > 0),
  );

  /**
   * The queue's bulk actions that can run over every result of its query: those the `bulk-actions`
   * slot resolves for a selection of every result, whose id the platform maps to an action of the
   * Bulk Action Framework (`wholeQueryBulkAction`). The queue file names an action by id only; what
   * runs on the server is the platform's. One is not offered over the whole query when what it
   * maps to would not be what it does on a selection: its descriptor hands its work to another
   * action's handler, or the handler that answers for it does not declare the mapping its own
   * (`ExtensionActionHandler.wholeQuery`), as a customer's replacing the platform's does not.
   * None while the page is read-only.
   */
  protected readonly wholeQueryActions = computed<readonly WholeQueryAction[]>(() => {
    this.translations();
    const queue = this.queue();
    const total = this.total();
    if (queue === null || queue.bulkActions.length === 0 || total <= 0 || this.readOnly())
      return [];
    const context: ExtensionRuleContext = {
      ...this.ruleContext.context(),
      document: null,
      selection: [],
      selectionCount: total,
    };
    const resolved = new Map(
      this.extensions
        .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS['bulk-actions'], context)
        .map((action): [string, ExtensionActionDescriptor] => [action.id, action]),
    );
    const offered: WholeQueryAction[] = [];
    for (const id of queue.bulkActions) {
      const action = resolved.get(id);
      const mapped = wholeQueryBulkAction(id);
      if (action === undefined || mapped === null) continue;
      if ((action.action ?? id) !== id) {
        this.tell(
          `bulkActions "${id}" is not offered over the whole query: its descriptor runs "${action.action}", and only "${id}" itself maps to a bulk action on the server`,
        );
        continue;
      }
      if (!this.actions.runsOverWholeQuery(id)) {
        this.tell(
          `bulkActions "${id}" is not offered over the whole query: the handler that runs it on a selection does not declare that it does what "${mapped.action}" does on the server`,
        );
        continue;
      }
      offered.push({
        id,
        label: descriptorLabel(action, (key) => this.translate.instant(key)),
        enabled: this.extensions.evaluateRule(action.enabledRule, context),
        mapped,
      });
    }
    return offered;
  });

  /** Whether every result of the query is selected, rather than rows. Another queue starts with none. */
  protected readonly allResults = linkedSignal<QueueFile | null, boolean>({
    source: this.queue,
    computation: () => false,
  });

  /** The bulk action over the whole query that is running or has just ended, for this queue. */
  private readonly run = linkedSignal<QueueFile | null, WholeQueryRun | null>({
    source: this.queue,
    computation: () => null,
  });

  private following: Subscription | null = null;
  private stops = new Subject<void>();
  /** The list's second read after a command, for the search index: the run's own, not the page's. */
  private reindexing: Subscription | null = null;
  /** While the second read is still to come: the count the first read brings is not named. */
  private awaitingReindex = false;

  /**
   * Whether every result is selected and can still be acted on: while an action can run over the
   * whole query. When none can any more, such as when the list no longer gives a count, the rows can
   * be selected again rather than every result staying selected with nothing to do with it.
   */
  private readonly selectingAll = computed(
    () => this.allResults() && this.wholeQueryActions().length > 0,
  );

  /**
   * Whether the rows of the page can be selected: not while every result is, or an action runs,
   * nor while the page is read-only, which offers no bulk action.
   */
  protected readonly rowsSelectable = computed(
    () => this.bulkActions().length > 0 && !this.selectingAll() && this.running() === false,
  );

  private readonly running = computed(() => {
    const run = this.run();
    return run !== null && run.outcome === null;
  });

  /**
   * What the page says about the whole query, above the list: the offer to select every result,
   * the selection of every result and its actions, a command's progress, or how it ended.
   */
  protected readonly notice = computed<WholeQueryNotice | null>(() => {
    this.translations();
    if (this.view() !== 'queue') return null;
    const run = this.run();
    if (run !== null)
      return run.outcome === null ? this.progressNotice(run) : this.outcomeNotice(run);
    const actions = this.wholeQueryActions();
    if (actions.length === 0) return null;
    const count = this.format(this.total());
    if (this.selectingAll()) {
      return {
        message: this.translate.instant('queues.whole-query.all-selected', { count }),
        tone: 'warning',
        announce: 'status',
        progress: null,
        actions: [
          ...actions.map((action): NxsBannerAction => ({
            label: action.label,
            emphasis: 'filled',
            danger: action.mapped.refresh,
            disabled: !action.enabled,
            cssClass: 'queue-whole-query__run',
            press: () => this.confirmRun(action),
          })),
          {
            label: this.translate.instant('queues.whole-query.clear'),
            emphasis: 'text',
            cssClass: 'queue-whole-query__clear',
            press: () => this.allResults.set(false),
          },
        ],
      };
    }
    if (this.selection.selectedCount() === 0) return null;
    if (this.filtered()) {
      return {
        message: this.translate.instant('queues.whole-query.filtered'),
        tone: 'info',
        announce: 'none',
        progress: null,
        actions: [],
      };
    }
    return {
      message: this.translate.instant('queues.whole-query.offer', { count }),
      tone: 'info',
      announce: 'none',
      progress: null,
      actions: [
        {
          label: this.translate.instant('queues.whole-query.select-all', { count }),
          emphasis: 'outlined',
          cssClass: 'queue-whole-query__select-all',
          press: () => this.selectAllResults(),
        },
      ],
    };
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));

    // The selection bar offers this queue's bulk actions while the page is shown, and every one
    // again once it goes. A read-only page, a preview inside another page, leaves the app's
    // selection bar as that page has it: it selects nothing, so it has nothing to offer there.
    effect(() => {
      if (this.readOnly()) return;
      const offered = this.view() === 'queue' ? this.bulkActions() : [];
      untracked(() => this.selection.offeredBulkActions.set(offered));
    });
    this.destroyRef.onDestroy(() => {
      if (!this.readOnly()) this.selection.offeredBulkActions.set(null);
      // Following the command stops with the page; the command goes on on the server.
      this.following?.unsubscribe();
      this.reindexing?.unsubscribe();
    });

    // Another queue: its command, if one runs, is no longer this page's to follow, nor its list's
    // second read this page's to ask for.
    toObservable(this.queue)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.following?.unsubscribe();
        this.following = null;
        this.reindexing?.unsubscribe();
        this.reindexing = null;
        this.awaitingReindex = false;
      });

    // Every result selected, and no action can run over them any more, such as when the list no
    // longer gives a count: the selection goes, rather than coming back on its own once the count
    // does, over rows selected meanwhile.
    effect(() => {
      if (this.allResults() && this.wholeQueryActions().length === 0) {
        untracked(() => this.allResults.set(false));
      }
    });
  }

  /**
   * The count is the query's whole one, also past the search index's window, which the list's
   * pages do not reach: a command over the whole query is the framework's, which reads the query
   * on the server rather than page by page, so the page does not hold it to the window.
   */
  protected onLoaded(results: PageProviderResults): void {
    this.aggregations.set(results.aggregations ?? null);
    this.rows.set(results.entries ?? []);
    // The page size bears on the reach only, which this does not read.
    const total = resultWindow(results, 1).total ?? -1;
    // After a command, the first read may still come from an index that has not caught up.
    this.total.set(this.awaitingReindex ? -1 : total);
    if (total < 0 && this.queue()?.bulkActions.some((id) => wholeQueryBulkAction(id) !== null)) {
      this.tell(
        'every result cannot be selected: the page provider does not say how many records it holds, and a confirmation must name the number',
      );
    }
  }

  /** Selects every result of the query in place of rows: the app's selection of rows is cleared. */
  protected selectAllResults(): void {
    if (this.filtered() || this.total() <= 0) return;
    this.selection.clear();
    this.allResults.set(true);
  }

  /** Asks the person to agree, naming the number of records, then runs the action on the server. */
  private confirmRun(action: WholeQueryAction): void {
    const queue = this.queue();
    const confirmed = this.total();
    if (queue === null || confirmed <= 0 || this.filtered() || this.running()) return;
    const count = this.format(confirmed);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('queues.whole-query.confirm-title', {
        action: action.label,
        count,
      }),
      message: this.translate.instant('queues.whole-query.confirm-message', {
        action: action.label,
        count,
      }),
      confirmLabel: this.translate.instant('queues.whole-query.confirm', {
        action: action.label,
        count,
      }),
    };
    this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(
        filter((agreed) => agreed === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // The queue or its filters may have changed while the dialog was open.
        if (this.queue() !== queue || this.filtered() || !this.selectingAll()) return;
        this.start(queue, action, confirmed);
      });
  }

  private start(queue: QueueFile, action: WholeQueryAction, confirmed: number): void {
    this.following?.unsubscribe();
    this.stops = new Subject<void>();
    this.run.set({ label: action.label, confirmed, status: null, outcome: null, stopping: false });
    this.following = runWholeQuery(
      this.bulk,
      {
        pageProvider: queue.list.pageProvider,
        parameters: queue.parameters,
        action: action.mapped,
        confirmed,
      },
      this.stops,
      this.timing,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.kind === 'progress') {
          this.run.update((run) => run && { ...run, status: event.status });
          return;
        }
        this.run.update(
          (run) =>
            run && {
              ...run,
              status: 'status' in event ? event.status : run.status,
              outcome: event,
            },
        );
        this.report(event);
        this.allResults.set(false);
        // Nothing ran when the server refused it; otherwise records may have changed.
        if (event.kind !== 'refused' && action.mapped.refresh) this.refresh();
      });
  }

  /**
   * Reads the list again, now and once more a little later: a list the search index serves may
   * still hold the records the action changed when the command completes. Until the second read
   * answers, there is no count, so a stale one from the first is never named. The second read is
   * the run's: another queue opened meanwhile does not get it.
   */
  private refresh(): void {
    this.reindexing?.unsubscribe();
    this.total.set(-1);
    this.awaitingReindex = true;
    this.documentChanges.notify();
    this.reindexing = timer(this.timing.reindexMs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.awaitingReindex = false;
        this.reindexing = null;
        this.documentChanges.notify();
      });
  }

  private stop(): void {
    this.run.update((run) => run && { ...run, stopping: true });
    this.stops.next();
  }

  private report(outcome: WholeQueryOutcome): void {
    if (outcome.kind === 'refused') {
      warn(`queues/${this.id()}.json: the bulk command was not taken: ${outcome.detail}`);
    } else if (outcome.kind === 'unconfirmed') {
      warn(
        `queues/${this.id()}.json: the bulk command's answer could not be read: ${outcome.detail}`,
      );
    } else if (outcome.kind === 'lost') {
      warn(
        `queues/${this.id()}.json: bulk command ${outcome.status.commandId} no longer followed: ${outcome.detail}`,
      );
    } else if (outcome.status.errorMessage !== null && outcome.status.errorCount > 0) {
      warn(
        `queues/${this.id()}.json: bulk command ${outcome.status.commandId}: ${outcome.status.errorCount} failed; the first: ${outcome.status.errorMessage}`,
      );
    }
  }

  private progressNotice(run: WholeQueryRun): WholeQueryNotice {
    const status = run.status;
    const counted = status !== null && status.total > 0;
    const values = {
      action: run.label,
      processed: this.format(status?.processed ?? 0),
      total: this.format(status?.total ?? 0),
    };
    const message = counted
      ? this.translate.instant('queues.whole-query.progress', values)
      : this.translate.instant('queues.whole-query.starting', values);
    return {
      message,
      tone: 'info',
      announce: 'none',
      progress: {
        value: status?.processed ?? 0,
        max: counted ? status.total : null,
        label: message,
      },
      actions: [
        {
          label: this.translate.instant(
            run.stopping ? 'queues.whole-query.stopping' : 'queues.whole-query.stop',
          ),
          emphasis: 'outlined',
          disabled: run.stopping || status === null,
          cssClass: 'queue-whole-query__stop',
          press: () => this.stop(),
        },
      ],
    };
  }

  private outcomeNotice(run: WholeQueryRun): WholeQueryNotice {
    const outcome = run.outcome as WholeQueryOutcome;
    const dismiss: NxsBannerAction = {
      label: this.translate.instant('queues.whole-query.dismiss'),
      emphasis: 'text',
      cssClass: 'queue-whole-query__dismiss',
      press: () => this.run.set(null),
    };
    const notice = (key: string, tone: NxsBannerTone, values: Record<string, string>) => ({
      message: this.translate.instant(key, { action: run.label, ...values }),
      tone,
      announce: (tone === 'info' ? 'status' : 'alert') as NxsBannerAnnounce,
      progress: null,
      actions: [dismiss],
    });
    if (outcome.kind === 'refused') {
      return notice(`queues.whole-query.refused.${outcome.reason}`, 'error', {});
    }
    if (outcome.kind === 'unconfirmed')
      return notice('queues.whole-query.unconfirmed', 'error', {});
    const { status } = outcome;
    const values = {
      processed: this.format(status.processed),
      total: this.format(status.total),
      errors: this.format(status.errorCount),
      count: this.format(run.confirmed),
    };
    switch (outcome.kind) {
      case 'done':
        return status.errorCount > 0
          ? notice('queues.whole-query.done-errors', 'warning', values)
          : notice('queues.whole-query.done', 'info', values);
      case 'lost':
        return notice('queues.whole-query.lost', 'error', values);
      case 'too-many': {
        // Above one more than agreed: the server did not keep to the limit the page sent.
        const limited = status.total <= run.confirmed + 1 ? '' : '-unlimited';
        return notice(
          `queues.whole-query.too-many${limited}${outcome.ended ? '' : '-unsettled'}`,
          'error',
          values,
        );
      }
      case 'aborted':
        return notice('queues.whole-query.aborted', 'warning', values);
      case 'stopped':
        // Stopped before the server had read the query: it has no count, and processed nothing.
        if (outcome.ended && status.total === 0 && status.processed === 0)
          return notice('queues.whole-query.stopped-early', 'warning', values);
        return notice(
          outcome.ended ? 'queues.whole-query.stopped' : 'queues.whole-query.stopped-unsettled',
          'warning',
          values,
        );
    }
  }

  /**
   * Chooses a bucket, or clears it. The list is another one then, so the selection is cleared too:
   * rows it held may no longer be in it. Not on a read-only page, whose rows cannot be selected:
   * the app's selection is another page's.
   */
  protected toggle(aggregate: string, key: string): void {
    this.chosen.update((chosen) => {
      const keys = chosen[aggregate] ?? [];
      const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
      return { ...chosen, [aggregate]: next };
    });
    if (!this.readOnly()) this.selection.clear();
    this.allResults.set(false);
    // The count is the last page's, for the buckets it was read with: none until the next page.
    this.total.set(-1);
  }

  /** The list's selection, kept in the app's, as the browse list keeps its own. */
  protected onSelection(ids: readonly string[]): void {
    const next = new Set(ids);
    const current = this.selection.selectedIds();
    for (const id of current) {
      if (!next.has(id)) this.selection.toggle(id);
    }
    for (const id of ids) {
      if (current.has(id)) continue;
      const row = this.rows().find((entry) => entry.uid === id);
      this.selection.toggle(id, row?.title ?? id, null, row?.type);
    }
  }

  /** The file read, refused or not. `tell`: whether the console is told what it leaves out. */
  private read(id: string, load: QueueLoad, tell = true): State {
    const file = `queues/${id}.json`;
    if (load.kind === 'none') {
      warn(`${file}: no queue is served there`);
      return { kind: 'none' };
    }
    if (load.kind === 'unreadable') {
      warn(`${file} not loaded: ${load.reason}`);
      return { kind: 'refused' };
    }
    const read = readQueue(load.content, {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
      bulkActions: this.slots.registeredIds(EXTENSION_SLOTS['bulk-actions']),
    });
    if ('refused' in read) {
      if (tell) for (const problem of read.refused) warn(`${file} refused: ${problem}`);
      return { kind: 'refused' };
    }
    if (tell) for (const problem of read.problems) warn(`${file} ${problem}`);
    return { kind: 'queue', id, queue: read.queue };
  }

  private format(value: number): string {
    try {
      return new Intl.NumberFormat(this.translate.getCurrentLang() || undefined).format(value);
    } catch {
      return String(value);
    }
  }

  /** The literal, which wins, else the key's translation, else `null`. */
  private text(label: string | null, labelKey: string | null): string | null {
    if (label !== null && label !== '') return label;
    if (labelKey === null) return null;
    const translated: unknown = this.translate.instant(labelKey);
    return typeof translated === 'string' && translated !== labelKey ? translated : null;
  }

  /** Once per queue: the facets and the actions are worked out again as results arrive. */
  private tell(message: string): void {
    const whole = `queues/${this.id()}.json ${message}`;
    if (this.told.has(whole)) return;
    this.told.add(whole);
    warn(whole);
  }
}
