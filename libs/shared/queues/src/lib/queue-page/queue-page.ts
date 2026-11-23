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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RecordListComponent } from '@agentic-ui/shared/document-layouts';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
  type ExtensionActionDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import {
  SelectionService,
  type NuxeoDocument,
  type PageProviderResults,
} from '@nuxeo/satori-platform/nuxeo-client';
import { map, merge, startWith, switchMap } from 'rxjs';

import { facetBuckets } from '../facets';
import { readQueue, type QueueFile } from '../queue-file';
import { QueueService, type QueueLoad } from '../queue.service';

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
 *   `bulk-actions` slot resolves that have a handler here. A bulk action over every result of the
 *   query, rather than the rows selected, is phase 2's.
 * - **The queue shows** while its rule holds for the person signed in, with their groups and no
 *   record. Hiding a queue is not a security control: the address still answers, and the page
 *   provider returns only what the person may read.
 */
@Component({
  selector: 'lib-queue-page',
  standalone: true,
  imports: [MatCheckboxModule, RecordListComponent, TranslatePipe],
  templateUrl: './queue-page.html',
  styleUrl: './queue-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuePageComponent {
  /** The queue's id, from the address: `/queues/<id>`. */
  readonly id = input('');

  private readonly queues = inject(QueueService);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly slots = inject(ExtensionSlotRegistry);
  private readonly extensions = inject(AppExtensionsService);
  private readonly actions = inject(ExtensionActionRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly selection = inject(SelectionService);
  private readonly translate = inject(TranslateService);

  /** What the console has been told, so that a page drawn again does not repeat it. */
  private readonly told = new Set<string>();

  /** Bumped when the language or a catalogue changes, so names resolved with `instant` follow. */
  private readonly translations = signal(0);

  protected readonly state = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.queues.load(id).pipe(
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

  /** What the page shows: the queue, or why there is none. */
  protected readonly view = computed<State['kind'] | 'hidden'>(() => {
    const state = this.state();
    if (state.kind !== 'queue') return state.kind;
    const { queue } = state;
    if (queue.alwaysHidden || !this.rules.evaluate(queue.visibleWhen, this.context()))
      return 'hidden';
    return 'queue';
  });

  /** The queue, while the page shows it. */
  protected readonly shown = computed(() => {
    const state = this.state();
    return state.kind === 'queue' && this.view() === 'queue' ? state : null;
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
   * The queue's bulk actions that a selection offers: those the `bulk-actions` slot resolves with
   * a selection of at least one row, and that have a handler here. One with nothing to run it
   * would do nothing when chosen, so it is not offered, and the console says so once.
   */
  protected readonly bulkActions = computed<readonly string[]>(() => {
    const queue = this.queue();
    if (queue === null || queue.bulkActions.length === 0) return [];
    const context = {
      ...this.ruleContext.context(),
      document: null,
      selectionCount: Math.max(1, this.selection.selectedCount()),
    };
    const resolved = new Map(
      this.extensions
        .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS['bulk-actions'], context)
        .map((action) => [action.id, action]),
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

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));

    // The selection bar offers this queue's bulk actions while the page is shown, and every one
    // again once it goes.
    effect(() => {
      const offered = this.view() === 'queue' ? this.bulkActions() : [];
      untracked(() => this.selection.offeredBulkActions.set(offered));
    });
    inject(DestroyRef).onDestroy(() => this.selection.offeredBulkActions.set(null));
  }

  protected onLoaded(results: PageProviderResults): void {
    this.aggregations.set(results.aggregations ?? null);
    this.rows.set(results.entries ?? []);
  }

  /**
   * Chooses a bucket, or clears it. The list is another one then, so the selection is cleared too:
   * rows it held may no longer be in it.
   */
  protected toggle(aggregate: string, key: string): void {
    this.chosen.update((chosen) => {
      const keys = chosen[aggregate] ?? [];
      const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
      return { ...chosen, [aggregate]: next };
    });
    this.selection.clear();
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

  private read(id: string, load: QueueLoad): State {
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
      for (const problem of read.refused) warn(`${file} refused: ${problem}`);
      return { kind: 'refused' };
    }
    for (const problem of read.problems) warn(`${file} ${problem}`);
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
