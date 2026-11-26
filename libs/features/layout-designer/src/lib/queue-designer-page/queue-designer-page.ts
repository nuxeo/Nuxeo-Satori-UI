import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  PACKAGED_REGISTRIES,
  publishable,
  validateQueue,
  withPackageActions,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import { QueuePageComponent, isQueueId, readQueue } from '@agentic-ui/shared/queues';
import {
  NxsBannerComponent,
  NxsButtonComponent,
  NxsConfirmDialogComponent,
  NxsIconButtonComponent,
  NxsSelectComponent,
  NxsSpinnerComponent,
  NxsTextFieldComponent,
  type NxsConfirmDialogData,
  type NxsSelectOption,
} from '@nuxeo/satori-platform/components';
import { type Observable, map, of, switchMap } from 'rxjs';

import { downloadJson } from '../download';
import { LayerPanelComponent } from '../layer/layer-panel';
import { LayoutDesignerService, type Reading } from '../layout-designer.service';
import { layoutFileText, type DesignerField, type LayoutJson } from '../layout-edits';
import {
  actionsOf,
  addAction,
  addColumn,
  addFacet,
  addSort,
  columnsOf,
  facetsOf,
  insertEntry,
  moveEntry,
  queueFileName,
  removeEntry,
  setFacetText,
  setQueueText,
  setSortOrder,
  sortsOf,
  type DesignerAction,
  type DesignerFacet,
  type DesignerSort,
  type QueueActionList,
  type QueueList,
  type QueueText,
} from '../queue-edits';

/** A column the designer has taken out of the queue, kept to be shown again. */
export interface HiddenColumn {
  /** Where it was among the columns, where it goes back. */
  readonly index: number;
  /** The entry as the file wrote it. */
  readonly entry: unknown;
  readonly name: string;
}

/**
 * Whether the queue may be saved: `checking` while the app's own actions are read, which the
 * validator is given as the pipeline gives them; `refused` when the validator has any finding at
 * all; `saveable` otherwise.
 */
export type QueueSaveState = 'nothing' | 'checking' | 'refused' | 'saveable';

/**
 * Where an action a queue names comes from: this build registers it, the platform's own included,
 * or it is the app's own, from its `actions.json`. `unknown` is neither, which the validator
 * refuses.
 */
export type ActionSource = 'registered' | 'app' | 'unknown';

/** One of the queue's row or bulk actions, or one offered to add, with where it comes from. */
export interface QueueAction extends DesignerAction {
  readonly source: ActionSource;
}

/** The registries with no row or bulk action, to read only those an `actions.json` adds. */
const NO_ACTIONS = {
  ...PACKAGED_REGISTRIES,
  rowActions: new Set<string>(),
  bulkActions: new Set<string>(),
};

const isObject = (value: unknown): value is LayoutJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The queue designer: an administrator opens a queue, `queues/<id>.json`, as the app reads it,
 * changes its name, its columns, its sort, its facets and its row and bulk actions, and sees the
 * queue page it draws against the server's page provider (docs/business-apps/app-definition-v2.md,
 * section 4; development-plan.md, phase 6).
 *
 * - **Actions are configuration only:** the queue names actions this build registers, or the
 *   app's own from its `actions.json`, as the validator knows them. The designer makes no action,
 *   binds nothing to an operation, and runs none.
 * - **The preview** is the queue page's own, `lib-queue-page`, given the file as edited and drawn
 *   read-only: the page provider is asked for its records as the person signed in, and no row can
 *   be selected, nor any action offered, so nothing on it changes a record.
 * - **Every change is validated** by the app definition's validator, with what this build
 *   registers, and a file with any finding cannot be saved.
 * - **Saving** is a download of the file, as a package holds it. Nothing is written to the server.
 *
 * Not a security control: the page provider returns only what the person may read, and the
 * server's permissions decide what anyone may change.
 */
@Component({
  selector: 'lib-queue-designer-page',
  standalone: true,
  imports: [
    LayerPanelComponent,
    NxsBannerComponent,
    NxsButtonComponent,
    NxsIconButtonComponent,
    NxsSelectComponent,
    NxsSpinnerComponent,
    NxsTextFieldComponent,
    QueuePageComponent,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './queue-designer-page.html',
  styleUrl: '../layout-designer-page/layout-designer-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'holdUnload($event)' },
})
export class QueueDesignerPageComponent {
  private readonly service = inject(LayoutDesignerService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  /** What a queue may name, read once: the rules and actions register before a page shows. */
  private readonly registered = this.service.queueRegistered();

  /**
   * The orders a sort may have: ascending or descending, and, for a sort that has none yet, none,
   * which the page provider's own order then decides. `instant` in a `computed` follows the
   * language and the catalogue, as ngx-translate's own `translate()` signal does.
   */
  protected readonly orderOptions = computed<{
    readonly unset: readonly NxsSelectOption[];
    readonly set: readonly NxsSelectOption[];
  }>(() => {
    const option = (value: string, key: string): NxsSelectOption => ({
      value,
      label: this.translate.instant(`layout-designer.queue.order-${key}`),
    });
    const set = [option('asc', 'asc'), option('desc', 'desc')];
    return { unset: [option('', 'none'), ...set], set };
  });

  /** The queues the app's menu opens, offered as the id is typed. */
  readonly menuQueues = toSignal(this.service.queueIds(), { initialValue: { state: 'reading' } });
  readonly model = toSignal(this.service.model(), { initialValue: { state: 'reading' } });

  /** The app's own actions, its `actions.json`, when the app registry serves it; else `null`. */
  readonly packageActions = toSignal(this.service.packageActions(), {
    initialValue: { state: 'reading' },
  });

  /** The platform's registries with what this build registers: what is known without the app's. */
  private readonly registeredRegistries = withRegistered(PACKAGED_REGISTRIES, {
    rules: this.registered.rules,
    rowActions: this.registered.rowActions,
    bulkActions: this.registered.bulkActions,
  });

  /**
   * What the validator knows a queue may name: the platform's registries, what this build
   * registers, and the app's own actions when they can be read, as the pipeline adds them.
   */
  private readonly registries = computed(() => {
    const actions = this.packageActions();
    return actions.state === 'read'
      ? withPackageActions(this.registeredRegistries, actions.value)
      : this.registeredRegistries;
  });

  /**
   * The app's own row and bulk actions, from its `actions.json` once it is read, each where its
   * `on` shows it, as the pipeline reads them (`withPackageActions`); none when none is served.
   */
  private readonly appActions = computed<Readonly<Record<QueueActionList, ReadonlySet<string>>>>(
    () => {
      const actions = this.packageActions();
      const own = actions.state === 'read' ? withPackageActions(NO_ACTIONS, actions.value) : null;
      return {
        rowActions: own?.rowActions ?? new Set<string>(),
        bulkActions: own?.bulkActions ?? new Set<string>(),
      };
    },
  );

  readonly menuQueueList = computed<readonly string[]>(() => {
    const queues = this.menuQueues();
    return queues.state === 'read' ? queues.value : [];
  });

  /**
   * The queue open, or being opened, by its id. Set again to the same id, it is read again: so
   * that a queue that could not be read can be opened anew.
   */
  readonly current = signal<string | null>(null, { equal: () => false });

  /** The id typed, which its button opens: the open one until another is typed. */
  readonly idChosen = linkedSignal<string>(() => this.current() ?? '');

  /** Whether the id typed can name a queue, as a package names its file. */
  readonly idValid = computed(() => isQueueId(this.idChosen().trim()));

  private readonly opening = toSignal(
    toObservable(this.current).pipe(
      switchMap((id) =>
        id ? this.service.queueSource(id).pipe(map((source) => ({ id, source }))) : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** The id of the queue open. */
  readonly id = computed(() => this.opening()?.id ?? null);

  readonly source = computed<Reading<unknown> | null>(() => this.opening()?.source ?? null);

  /**
   * Why the queue could not be opened: it could not be read, the server's words, or what came is no
   * queue, a key the page translates as it draws, so that it follows the reader's language.
   */
  readonly sourceProblem = computed<
    | { readonly text: string; readonly key?: never }
    | { readonly key: string; readonly text?: never }
    | null
  >(() => {
    const source = this.source();
    if (source?.state === 'failed') return { text: source.problem };
    if (source?.state === 'read' && !isObject(source.value)) {
      return { key: 'layout-designer.queue.not-an-object' };
    }
    return null;
  });

  /**
   * Whether the app registry serves the open app's `actions.json` with a list of actions, which the
   * validator is given. A file without one adds none.
   */
  readonly hasPackageActions = computed(() => {
    const actions = this.packageActions();
    return (
      actions.state === 'read' &&
      isObject(actions.value) &&
      Array.isArray((actions.value as LayoutJson)['actions'])
    );
  });

  /** Whether the queue has a rule of its own: the queue page then draws it only for its people. */
  readonly hasRule = computed(() => this.file()?.['visibleWhen'] !== undefined);

  /** The file as it was opened, to go back to. */
  readonly opened = computed<LayoutJson | null>(() => {
    const source = this.source();
    return source?.state === 'read' && isObject(source.value) ? source.value : null;
  });

  /** The file as it is now, with every change made to it. Opened anew with each queue. */
  readonly file = linkedSignal<LayoutJson | null>(() => this.opened());

  /** The columns taken out of the file, to show again. None once another queue is opened. */
  readonly hidden = linkedSignal<LayoutJson | null, readonly HiddenColumn[]>({
    source: this.opened,
    computation: () => [],
  });

  readonly changed = computed(() => {
    const file = this.file();
    const opened = this.opened();
    return file !== null && opened !== null && layoutFileText(file) !== layoutFileText(opened);
  });

  /** Whether leaving the queue would lose something: a change to it, or a column to show again. */
  readonly unsaved = computed(() => this.changed() || this.hidden().length > 0);

  readonly columns = computed<readonly DesignerField[]>(() => columnsOf(this.file()));
  readonly sorts = computed<readonly DesignerSort[]>(() => sortsOf(this.file()));
  readonly facets = computed<readonly DesignerFacet[]>(() => facetsOf(this.file()));

  /** The queue's row and bulk actions, in their order, each with where it comes from. */
  readonly actions = computed<Readonly<Record<QueueActionList, readonly QueueAction[]>>>(() => {
    const file = this.file();
    const read = (list: QueueActionList): readonly QueueAction[] =>
      actionsOf(file, list).map((action) => ({
        ...action,
        source: this.sourceOf(list, action.id),
      }));
    return { rowActions: read('rowActions'), bulkActions: read('bulkActions') };
  });

  /**
   * What may be added to each list: what the validator knows, this build's registered actions
   * first and then the app's own, less those the list names already. Without the app's
   * `actions.json`, the registered ones alone.
   */
  readonly offered = computed<Readonly<Record<QueueActionList, readonly QueueAction[]>>>(() => {
    const actions = this.actions();
    const offer = (list: QueueActionList): readonly QueueAction[] => {
      const named = new Set(actions[list].map((action) => action.id));
      const registered = [...this.registeredRegistries[list]];
      const own = [...this.appActions()[list]].filter((id) => !registered.includes(id));
      return [
        ...registered.map((id): QueueAction => ({ index: -1, id, source: 'registered' })),
        ...own.map((id): QueueAction => ({ index: -1, id, source: 'app' })),
      ].filter((action) => !named.has(action.id));
    };
    return { rowActions: offer('rowActions'), bulkActions: offer('bulkActions') };
  });

  /**
   * The pickers' choices: each action offered by its ID and where it comes from. `instant` in a
   * `computed` follows the language and the catalogue, as the order picker's choices do.
   */
  protected readonly offeredOptions = computed<
    Readonly<Record<QueueActionList, readonly NxsSelectOption[]>>
  >(() => {
    const offered = this.offered();
    const options = (list: QueueActionList): readonly NxsSelectOption[] =>
      offered[list].map((action) => ({
        value: action.id ?? '',
        label: this.translate.instant(
          action.source === 'app'
            ? 'layout-designer.queue.offered-app'
            : 'layout-designer.queue.offered-registered',
          { id: action.id },
        ),
      }));
    return { rowActions: options('rowActions'), bulkActions: options('bulkActions') };
  });

  /**
   * What each list offers, as its note says: `reading` while the app's `actions.json` is read;
   * `all` when some of the app's own actions show in the list; `none-here` when the app has actions
   * and none shows there, its `on` naming neither `row` nor `bulk` as the list is; and `registered`
   * when no `actions.json` with actions is read, served or not, or one could not be read.
   */
  readonly offeredFrom = computed<
    Readonly<Record<QueueActionList, 'reading' | 'all' | 'none-here' | 'registered'>>
  >(() => {
    const reading = this.packageActions().state === 'reading';
    const from = (list: QueueActionList): 'reading' | 'all' | 'none-here' | 'registered' => {
      if (reading) return 'reading';
      if (this.appActions()[list].size > 0) return 'all';
      return this.hasPackageActions() ? 'none-here' : 'registered';
    };
    return { rowActions: from('rowActions'), bulkActions: from('bulkActions') };
  });

  readonly label = computed(() => this.text('label'));
  readonly labelKey = computed(() => this.text('labelKey'));

  /** Every finding of the validator, with what this build registers and the app's own actions. */
  readonly findings = computed<readonly Finding[]>(() => {
    const file = this.file();
    return file ? validateQueue(file, { registries: this.registries() }) : [];
  });

  readonly saveState = computed<QueueSaveState>(() => {
    if (!this.file()) return 'nothing';
    if (this.packageActions().state === 'reading') return 'checking';
    return publishable(this.findings()) ? 'saveable' : 'refused';
  });

  /**
   * What the queue page leaves out of the file, and why, in the words the console would have, or
   * what refuses it: the page reads it with `readQueue`, as here.
   */
  readonly pageNotes = computed<{ readonly refused: boolean; readonly notes: readonly string[] }>(
    () => {
      const file = this.file();
      if (!file) return { refused: false, notes: [] };
      const read = readQueue(file, this.registered);
      return 'refused' in read
        ? { refused: true, notes: read.refused }
        : { refused: false, notes: read.problems };
    },
  );

  /**
   * Every property of the server's content model, by `<prefix>:<name>`: what a column may show. A
   * queue's rows may be of any type the page provider returns, so no one type's properties are
   * enough.
   */
  readonly properties = computed<readonly string[]>(() => {
    const model = this.model();
    if (model.state !== 'read') return [];
    return [...model.value.schemas.values()]
      .flatMap((schema) => [...schema.properties.keys()].map((name) => `${schema.prefix}:${name}`))
      .sort();
  });

  /** The columns' properties, which the queue may be sorted on. */
  readonly sortable = computed<readonly string[]>(() => [
    ...new Set(
      this.columns().flatMap((column) =>
        column.kind === 'property' && column.name ? [column.name] : [],
      ),
    ),
  ]);

  /** What is typed or chosen to add, by list. */
  readonly toAdd = linkedSignal<LayoutJson | null, Readonly<Record<QueueList, string>>>({
    source: this.opened,
    computation: () => ({ columns: '', sort: '', facets: '', rowActions: '', bulkActions: '' }),
  });

  /** Opens the queue `id`, once the person agrees to lose the changes to the one open, if any. */
  open(id: string): void {
    const wanted = id.trim();
    // The queue open is not opened again, but one that could not be read is read again.
    if (!isQueueId(wanted) || (wanted === this.current() && this.sourceProblem() === null)) return;
    this.discard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((agreed) => {
        if (agreed) this.current.set(wanted);
        else this.idChosen.set(this.current() ?? '');
      });
  }

  /** Whether the page may be left: at once with nothing to lose, else once the person agrees. */
  leave(): Observable<boolean> {
    return this.discard();
  }

  protected holdUnload(event: BeforeUnloadEvent): void {
    if (this.unsaved()) event.preventDefault();
  }

  private discard(): Observable<boolean> {
    const id = this.id();
    if (!this.unsaved() || !id) return of(true);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('layout-designer.discard-title'),
      message: this.translate.instant('layout-designer.queue.discard-message', { id }),
      confirmLabel: this.translate.instant('layout-designer.discard'),
    };
    return this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(map((agreed) => agreed === true));
  }

  setName(key: QueueText, value: string): void {
    this.edit((file) => setQueueText(file, key, value));
  }

  /** Moves an entry of `list` by `by` places, the focus going with it. */
  move(list: QueueList, index: number, by: -1 | 1): void {
    this.edit((file) => moveEntry(file, list, index, index + by));
    this.focusEntry(list, index + by, by < 0 ? ['up', 'down'] : ['down', 'up']);
  }

  /** Takes the column out of the file, to show again. The focus goes to the next column, or the last. */
  hideColumn(column: DesignerField): void {
    const file = this.file();
    if (!file) return;
    const { file: next, entry } = removeEntry(file, 'columns', column.index);
    if (entry === undefined) return;
    this.file.set(next);
    this.hidden.update((hidden) => [
      ...hidden,
      { index: column.index, entry, name: this.columnName(column) },
    ]);
    const left = this.columns().length;
    if (left > 0) this.focusEntry('columns', Math.min(column.index, left - 1), ['hide']);
    else this.focusIn('.layout-designer__hidden li:last-child', '[data-action="show"] button');
  }

  /** Puts the column back where it was, the focus on it. */
  showColumn(column: HiddenColumn): void {
    this.edit((file) => insertEntry(file, 'columns', column.index, column.entry));
    this.hidden.update((hidden) => hidden.filter((each) => each !== column));
    this.focusEntry('columns', Math.min(column.index, this.columns().length - 1), ['hide']);
  }

  /**
   * Takes a sort, a facet or an action out of the file. The focus goes to the next one's Remove, or
   * the last one's, or to what adds one once none is left, rather than to the page.
   */
  remove(list: Exclude<QueueList, 'columns'>, index: number): void {
    this.edit((file) => removeEntry(file, list, index).file);
    const left =
      list === 'sort'
        ? this.sorts().length
        : list === 'facets'
          ? this.facets().length
          : this.actions()[list].length;
    if (left > 0) this.focusEntry(list, Math.min(index, left - 1), ['remove']);
    else
      this.focusIn(
        `[data-part="${list}"]`,
        list === 'facets'
          ? '[data-picker="add-facet"] input'
          : `[data-picker="add-${list}"] select`,
      );
  }

  setOrder(sort: DesignerSort, order: string): void {
    if (order === 'asc' || order === 'desc') {
      this.edit((file) => setSortOrder(file, sort.index, order));
    }
  }

  setFacet(facet: DesignerFacet, key: QueueText, value: string): void {
    this.edit((file) => setFacetText(file, facet.index, key, value));
  }

  choose(list: QueueList, value: string): void {
    this.toAdd.update((chosen) => ({ ...chosen, [list]: value }));
  }

  /** The column's properties not yet sorted on. */
  unsorted(): readonly string[] {
    const sorted = new Set(this.sorts().map((sort) => sort.field));
    return this.sortable().filter((xpath) => !sorted.has(xpath));
  }

  /** The sort picker's choices: the properties not yet sorted on, by their xpaths. */
  protected unsortedOptions(): readonly NxsSelectOption[] {
    return this.unsorted().map((xpath) => ({ value: xpath, label: xpath }));
  }

  /**
   * Adds what is typed or chosen to `list`, last, the focus on it. An action is added only if it is
   * offered: one this build registers, or one of the app's own, that the list does not name yet.
   */
  add(list: QueueList): void {
    const value = this.toAdd()[list].trim();
    if (value === '') return;
    if (list === 'rowActions' || list === 'bulkActions') {
      if (!this.offered()[list].some((action) => action.id === value)) return;
      this.edit((file) => addAction(file, list, value));
    } else if (list === 'columns') this.edit((file) => addColumn(file, value));
    else if (list === 'sort') this.edit((file) => addSort(file, value));
    else this.edit((file) => addFacet(file, value));
    this.toAdd.update((chosen) => ({ ...chosen, [list]: '' }));
    const added =
      list === 'columns'
        ? this.columns().length
        : list === 'sort'
          ? this.sorts().length
          : list === 'facets'
            ? this.facets().length
            : this.actions()[list].length;
    this.focusEntry(list, added - 1, ['up', 'hide', 'remove']);
  }

  /** An action as the page names it: its ID, or its place for an entry that names none. */
  actionName(list: QueueActionList, action: DesignerAction): string {
    return action.id ?? `${list}[${action.index}]`;
  }

  /** Back to the queue as it was opened, the focus on the editor's heading. */
  reset(): void {
    this.file.set(this.opened());
    this.hidden.set([]);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#queue-designer-editor')?.focus(),
      { injector: this.injector },
    );
  }

  /** The name the download and a package give the file: `<id>.json`. */
  readonly fileName = computed(() => queueFileName(this.id() ?? 'queue'));

  /** Where the app's deployment layer holds the queue open: `queues/<id>.json`. */
  readonly layerPath = computed(() => {
    const id = this.id();
    return id ? `queues/${this.fileName()}` : null;
  });

  /**
   * Saves the queue to the browser's downloads, as a package holds it. Refused, whatever the button
   * shows, unless the validator finds nothing.
   */
  download(): void {
    const file = this.file();
    if (!file || this.saveState() !== 'saveable') return;
    downloadJson(this.fileName(), layoutFileText(file), this.document);
  }

  /**
   * Opens a version of the queue from the app's deployment layer, its draft or its live version, as
   * the file being edited, which the page then checks and previews as any other change.
   */
  openFromLayer(content: unknown): void {
    if (typeof content === 'object' && content !== null && !Array.isArray(content))
      this.file.set(content as LayoutJson);
  }

  readonly fileText = computed(() => {
    const file = this.file();
    return file ? layoutFileText(file) : '';
  });

  columnName(column: DesignerField): string {
    return column.name ?? `columns[${column.index}]`;
  }

  protected failed<T>(reading: Reading<T> | null): string | null {
    return reading?.state === 'failed' ? reading.problem : null;
  }

  /** Where an action the queue names comes from: registered, the app's own, or neither. */
  private sourceOf(list: QueueActionList, id: string | null): ActionSource {
    if (id === null) return 'unknown';
    if (this.registeredRegistries[list].has(id)) return 'registered';
    return this.appActions()[list].has(id) ? 'app' : 'unknown';
  }

  private text(key: QueueText): string {
    const value = this.file()?.[key];
    return typeof value === 'string' ? value : '';
  }

  private edit(change: (file: LayoutJson) => LayoutJson): void {
    const file = this.file();
    if (file) this.file.set(change(file));
  }

  private focusEntry(list: QueueList, index: number, actions: readonly string[]): void {
    this.focusIn(
      `[data-list="${list}"] > li:nth-child(${index + 1})`,
      ...actions.map((action) => `[data-action="${action}"] button`),
    );
  }

  /**
   * Once the page is drawn again, the focus on the first control `controls` names in `container`
   * that is offered. Each names the native control inside an `nxs-` element — its `button`,
   * `select` or `input` — since that, not the element, is what takes the focus.
   */
  private focusIn(container: string, ...controls: readonly string[]): void {
    afterNextRender(
      () => {
        const within = this.host.nativeElement.querySelector(container);
        for (const selector of controls) {
          const control = within?.querySelector<
            HTMLButtonElement | HTMLSelectElement | HTMLInputElement
          >(selector);
          if (control && !control.disabled) {
            control.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }
}
