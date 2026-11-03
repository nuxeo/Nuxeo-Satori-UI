import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  type Observable,
  Subject,
  catchError,
  filter,
  finalize,
  forkJoin,
  map,
  merge,
  of,
  switchMap,
} from 'rxjs';

import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  DocTypeLabelPipe,
  TrashService,
  docTypeIcon,
  type NuxeoDocument,
  type TrashFilters,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsCardComponent } from '../card/card.component';
import {
  NxsColumnPickerComponent,
  type NxsPickableColumn,
} from '../column-picker/column-picker.component';
import {
  NxsConfirmDialogComponent,
  type NxsConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';
import { type NxsMenuAction } from '../action-menu/action-menu.component';
import {
  NxsDocumentListComponent,
  type NxsDocumentListColumn,
  type NxsDocumentListRowAction,
  type NxsDocumentListSort,
} from '../document-list/document-list.component';
import { NxsEmptyStateComponent } from '../empty-state/empty-state.component';
import { NxsErrorStateComponent } from '../error-state/error-state.component';
import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';
import { NxsPagerComponent } from '../pager/pager.component';
import { NXS_PRIMITIVE_IDS } from '../primitives';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsTagComponent } from '../tag/tag.component';
import { provideNxsThumbnailCache } from '../thumbnail/thumbnail-cache';
import { NxsThumbnailComponent } from '../thumbnail/thumbnail.component';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';
import { nxsVisibleText } from '../visible-text';

/** The ID the host renders the trash list under, through `lib-extension-outlet`. */
export const NXS_TRASH_LIST_ID = 'nxs.components.trashList';

/** How the trash list lays its documents out. */
export type NxsTrashListView = 'table' | 'grid' | 'list';

/** What the trash list is showing, reported to `resultsHandler` whenever it changes. */
export interface NxsTrashListResults {
  /** Whether a page is being fetched. */
  readonly loading: boolean;
  /** The page on screen. Empty while loading and after a failure. */
  readonly documents: readonly NuxeoDocument[];
  /** Every trashed document matching the filters, across pages. */
  readonly totalSize: number;
}

/** Which documents an action ran on, and which of them it failed for. */
interface Outcome {
  readonly done: readonly NuxeoDocument[];
  readonly failed: readonly NuxeoDocument[];
}

const NO_FILTERS: TrashFilters = { fullText: '', path: '/', author: '', sizeRanges: [] };

/** Each column's key in `nxs-document-list`, its NXQL sort field, and its label's key. */
const COLUMNS: readonly { key: string; field: string | null; labelKey: string }[] = [
  { key: 'title', field: 'dc:title', labelKey: 'satori-components.trash-list.column.title' },
  { key: 'type', field: null, labelKey: 'satori-components.trash-list.column.type' },
  {
    key: 'modified',
    field: 'dc:modified',
    labelKey: 'satori-components.trash-list.column.modified',
  },
  {
    key: 'lastContributor',
    field: 'dc:lastContributor',
    labelKey: 'satori-components.trash-list.column.last-contributor',
  },
  { key: 'created', field: 'dc:created', labelKey: 'satori-components.trash-list.column.created' },
  { key: 'author', field: 'dc:creator', labelKey: 'satori-components.trash-list.column.author' },
];
const DEFAULT_COLUMNS: readonly string[] = ['title', 'type', 'modified', 'lastContributor'];
const REQUIRED_COLUMNS: readonly string[] = ['title'];
const DEFAULT_SORT: NxsDocumentListSort = { key: 'created', direction: 'desc' };
const RESTORE = 'restore';
const PURGE = 'purge';

/**
 * The trash: the documents moved to it, with restore and permanent delete for one document or for a
 * selection, in a table, a grid of cards or a list.
 *
 * It searches through `TrashService` with the `filters` it is given, a page at a time in the
 * server's order, and restores with `Document.Untrash` and purges with a `DELETE`. A permanent
 * delete asks first. Outcomes are toasts; a document an action succeeded for leaves the page, and
 * one it failed for stays listed and stays selected, so it can be tried again.
 *
 * It does not navigate. Opening a document calls `openHandler`, and every change to what is shown
 * is reported to `resultsHandler`, so a host can mirror it elsewhere — a drawer's result list.
 * Nuxeo checks each permission on the request: a user who may not restore or delete a document is
 * refused by the server, and the refusal is reported.
 */
@Component({
  selector: 'nxs-trash-list',
  standalone: true,
  templateUrl: './trash-list.component.html',
  styleUrl: './trash-list.component.scss',
  imports: [
    DatePipe,
    DocTypeLabelPipe,
    ExtensionOutletComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    NxsCardComponent,
    NxsColumnPickerComponent,
    NxsDocumentListComponent,
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsPagerComponent,
    NxsSpinnerComponent,
    NxsTagComponent,
    NxsThumbnailComponent,
    TranslatePipe,
  ],
  providers: [provideNxsToast(), provideNxsThumbnailCache()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-trash-list' },
})
export class NxsTrashListComponent {
  private readonly trash = inject(TrashService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(NxsToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  /** What to search the trash for. A new value goes back to the first page. */
  readonly filters = input<TrashFilters>(NO_FILTERS);
  /** How many documents a page holds. */
  readonly pageSize = input(50, { transform: numberAttribute });
  /** The layout shown first; the user can switch. */
  readonly initialView = input<NxsTrashListView>('table');
  /** Called with a document when the user opens it. Without it, documents do not open. */
  readonly openHandler = input<((document: NuxeoDocument) => void) | null>(null);
  /** Called with what is shown whenever it changes: loading, then the page and the total. */
  readonly resultsHandler = input<((results: NxsTrashListResults) => void) | null>(null);

  protected readonly tagId = NXS_PRIMITIVE_IDS.tag;
  protected readonly cardId = NXS_PRIMITIVE_IDS.card;
  protected readonly views: readonly NxsTrashListView[] = ['table', 'grid', 'list'];
  protected readonly sortChoices = COLUMNS.filter((column) => column.field !== null);

  protected readonly view = linkedSignal(() => this.initialView());
  protected readonly sort = signal<NxsDocumentListSort>(DEFAULT_SORT);
  /** Back to the first page whenever the filters or the order change. */
  protected readonly pageIndex = linkedSignal<unknown, number>({
    source: () => [this.filters(), this.sort()],
    computation: () => 0,
  });
  protected readonly documents = signal<readonly NuxeoDocument[]>([]);
  protected readonly totalSize = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<NxsErrorStatus | null>(null);
  protected readonly selectedIds = signal<readonly string[]>([]);
  /** Documents with a request in flight; their actions are disabled until it answers. */
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly visibleColumns = signal<readonly string[]>(DEFAULT_COLUMNS);
  protected readonly pickerOpen = signal(false);
  protected readonly requiredColumns = REQUIRED_COLUMNS;
  protected readonly defaultColumns = DEFAULT_COLUMNS;

  protected readonly hasNextPage = computed(
    () => (this.pageIndex() + 1) * this.pageSize() < this.totalSize(),
  );
  protected readonly selectedCount = computed(() => this.selectedIds().length);
  protected readonly selected = computed(() => new Set(this.selectedIds()));
  protected readonly selectionBusy = computed(() =>
    this.selectedIds().some((id) => this.busy().has(id)),
  );
  protected readonly columns = computed<readonly NxsDocumentListColumn[]>(() =>
    COLUMNS.filter((column) => this.visibleColumns().includes(column.key)).map((column) => ({
      key: column.key,
      label: this.translate.instant(column.labelKey),
      sortable: column.field !== null,
    })),
  );
  protected readonly pickerColumns = computed<readonly NxsPickableColumn[]>(() =>
    COLUMNS.map((column) => ({
      key: column.key,
      label: this.translate.instant(column.labelKey),
      visible: this.visibleColumns().includes(column.key),
    })),
  );
  protected readonly rowActions = computed(() => {
    const busy = this.busy();
    const actions: Record<string, readonly NxsMenuAction[]> = {};
    for (const doc of this.documents()) {
      const disabled = busy.has(doc.uid);
      actions[doc.uid] = [
        {
          id: RESTORE,
          label: this.translate.instant('satori-components.trash-list.restore'),
          icon: 'restore',
          disabled,
        },
        {
          id: PURGE,
          label: this.translate.instant('satori-components.trash-list.purge'),
          icon: 'trash_x',
          disabled,
        },
      ];
    }
    return actions;
  });
  /** Each card's callbacks, made once per page so the outlet is not handed new ones every check. */
  protected readonly cardHandlers = computed(() => {
    const handlers = new Map<
      string,
      { open: (() => void) | null; select: (on: boolean) => void }
    >();
    const opener = this.openHandler();
    for (const doc of this.documents()) {
      handlers.set(doc.uid, {
        open: opener ? () => opener(doc) : null,
        select: (on: boolean) => this.setSelected(doc.uid, on),
      });
    }
    return handlers;
  });

  private readonly reload$ = new Subject<void>();
  private readonly request = computed(() => ({
    filters: this.filters(),
    sort: this.sort(),
    pageIndex: this.pageIndex(),
    pageSize: this.pageSize(),
  }));

  constructor() {
    merge(toObservable(this.request), this.reload$.pipe(map(() => this.request())))
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.error.set(null);
          this.report();
          const field = COLUMNS.find((column) => column.key === request.sort.key)?.field;
          return this.trash
            .searchTrash({
              fullText: request.filters.fullText,
              path: request.filters.path,
              author: request.filters.author,
              sizeRanges: request.filters.sizeRanges,
              sortBy: field ?? 'dc:created',
              sortOrder: request.sort.direction,
              pageSize: request.pageSize,
              currentPageIndex: request.pageIndex,
            })
            .pipe(
              map((list) => ({ list, failure: null as NxsErrorStatus | null })),
              catchError((error: unknown) => of({ list: null, failure: nxsErrorStatus(error) })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ list, failure }) => {
        this.loading.set(false);
        if (!list) {
          this.documents.set([]);
          this.totalSize.set(0);
          this.error.set(failure);
          this.report();
          return;
        }
        const entries = list.entries ?? [];
        const total = list.resultsCount ?? entries.length;
        // A page past the end — its documents restored or deleted elsewhere since — shows the one
        // before it rather than an empty page.
        if (entries.length === 0 && this.pageIndex() > 0 && total > 0) {
          this.pageIndex.update((index) => index - 1);
          return;
        }
        this.documents.set(entries);
        this.totalSize.set(total);
        const shown = new Set(entries.map((doc) => doc.uid));
        this.selectedIds.update((ids) => ids.filter((id) => shown.has(id)));
        this.report();
      });
  }

  /** Fetches the page on screen again. */
  reload(): void {
    this.reload$.next();
  }

  protected setView(view: NxsTrashListView): void {
    this.view.set(view);
    this.pickerOpen.set(false);
  }

  protected viewLabel(view: NxsTrashListView): string {
    return this.translate.instant(`satori-components.trash-list.view.${view}`);
  }

  protected viewIcon(view: NxsTrashListView): string {
    return view === 'grid' ? 'grid_view' : 'bullet_list';
  }

  protected onSortChange(sort: NxsDocumentListSort | null): void {
    this.sort.set(sort ?? DEFAULT_SORT);
  }

  protected onSortKey(key: string): void {
    this.sort.update((sort) => ({ key, direction: sort.direction }));
  }

  protected toggleDirection(): void {
    this.sort.update((sort) => ({
      key: sort.key,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  protected goToPage(index: number): void {
    this.pageIndex.set(index);
  }

  protected applyColumns(keys: readonly string[]): void {
    this.visibleColumns.set(keys);
    this.pickerOpen.set(false);
  }

  protected open(doc: NuxeoDocument): void {
    this.openHandler()?.(doc);
  }

  protected title(doc: NuxeoDocument): string {
    return nxsVisibleText(doc.title) || doc.path || doc.uid;
  }

  protected icon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  protected isSelected(uid: string): boolean {
    return this.selected().has(uid);
  }

  protected setSelected(uid: string, on: boolean): void {
    this.selectedIds.update((ids) =>
      on ? (ids.includes(uid) ? ids : [...ids, uid]) : ids.filter((id) => id !== uid),
    );
  }

  protected allSelected(): boolean {
    const docs = this.documents();
    return docs.length > 0 && docs.every((doc) => this.selected().has(doc.uid));
  }

  protected toggleAll(on: boolean): void {
    this.selectedIds.set(on ? this.documents().map((doc) => doc.uid) : []);
  }

  protected clearSelection(): void {
    this.selectedIds.set([]);
  }

  protected onRowAction({ action, document }: NxsDocumentListRowAction): void {
    if (action.id === RESTORE) this.restore([document]);
    else if (action.id === PURGE) this.purge([document]);
  }

  protected restoreSelected(): void {
    this.restore(this.selectedDocuments());
  }

  protected purgeSelected(): void {
    this.purge(this.selectedDocuments());
  }

  /** Puts the documents back where they were deleted from. */
  protected restore(docs: readonly NuxeoDocument[]): void {
    const ready = docs.filter((doc) => !this.busy().has(doc.uid));
    if (ready.length === 0) return;
    this.run(ready, (doc) => this.trash.restoreDocument(doc.uid)).subscribe((outcome) =>
      this.announce(outcome, 'restored', 'restore-failed'),
    );
  }

  /** Deletes the documents for good, once the user confirms. */
  protected purge(docs: readonly NuxeoDocument[]): void {
    const ready = docs.filter((doc) => !this.busy().has(doc.uid));
    if (ready.length === 0) return;
    const one = ready.length === 1;
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('satori-components.trash-list.confirm-purge-title'),
      message: one
        ? this.translate.instant('satori-components.trash-list.confirm-purge-one', {
            title: this.title(ready[0]),
          })
        : this.translate.instant('satori-components.trash-list.confirm-purge-many', {
            count: ready.length,
          }),
      confirmLabel: this.translate.instant('satori-components.trash-list.purge'),
    };
    this.dialog
      .open<NxsConfirmDialogComponent, NxsConfirmDialogData, true | undefined>(
        NxsConfirmDialogComponent,
        { data },
      )
      .afterClosed()
      .pipe(
        filter((confirmed) => confirmed === true),
        switchMap(() => this.run(ready, (doc) => this.trash.permanentlyDelete(doc.uid))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome) => this.announce(outcome, 'purged', 'purge-failed'));
  }

  /** Writes the page on screen as CSV, with the columns shown, and downloads it. */
  protected exportCsv(): void {
    const columns = this.columns();
    const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
    const lines = [
      columns.map((column) => quote(column.label)).join(','),
      ...this.documents().map((doc) =>
        columns.map((column) => quote(this.cellText(doc, column.key))).join(','),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }),
    );
    try {
      const link = this.document.createElement('a');
      link.href = url;
      link.download = 'trash.csv';
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  protected cellText(doc: NuxeoDocument, key: string): string {
    const properties = doc.properties ?? {};
    const read = (name: string): string => {
      const value = properties[name];
      return typeof value === 'string' ? value : '';
    };
    switch (key) {
      case 'title':
        return this.title(doc);
      case 'type':
        return doc.type ?? '';
      case 'modified':
        return read('dc:modified');
      case 'lastContributor':
        return read('dc:lastContributor');
      case 'created':
        return read('dc:created');
      case 'author':
        return read('dc:creator');
      default:
        return '';
    }
  }

  private selectedDocuments(): NuxeoDocument[] {
    const selected = this.selected();
    return this.documents().filter((doc) => selected.has(doc.uid));
  }

  /** Runs `step` for every document at once and reports which succeeded, never failing itself. */
  private run(
    docs: readonly NuxeoDocument[],
    step: (doc: NuxeoDocument) => Observable<unknown>,
  ): Observable<Outcome> {
    const ids = docs.map((doc) => doc.uid);
    this.busy.update((busy) => new Set([...busy, ...ids]));
    return forkJoin(
      docs.map((doc) =>
        step(doc).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      ),
    ).pipe(
      map((results) => ({
        done: docs.filter((_, index) => results[index]),
        failed: docs.filter((_, index) => !results[index]),
      })),
      finalize(() =>
        this.busy.update((busy) => new Set([...busy].filter((id) => !ids.includes(id)))),
      ),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  private announce(outcome: Outcome, done: string, failed: string): void {
    const total = outcome.done.length + outcome.failed.length;
    const key = (base: string) =>
      `satori-components.trash-list.${base}-${total === 1 ? 'one' : 'many'}`;
    const removed = new Set(outcome.done.map((doc) => doc.uid));
    this.selectedIds.update((ids) => ids.filter((id) => !removed.has(id)));
    if (outcome.failed.length === 0) {
      this.toast.show(
        this.translate.instant(key(done), { title: this.title(outcome.done[0]), count: total }),
      );
    } else {
      this.toast.error(
        this.translate.instant(key(failed), {
          title: this.title(outcome.failed[0]),
          count: total,
          failed: outcome.failed.length,
        }),
      );
    }
    if (outcome.done.length > 0) this.remove(removed);
  }

  /**
   * Takes restored and deleted documents off the page without searching again: the trash search
   * reads the index, which still lists a document as trashed for a moment after it is restored, so
   * an immediate search would put it back. A page left empty fetches the one before it, or the
   * first page again.
   */
  private remove(uids: ReadonlySet<string>): void {
    const before = this.documents().length;
    this.documents.update((docs) => docs.filter((doc) => !uids.has(doc.uid)));
    const gone = before - this.documents().length;
    this.totalSize.update((total) => Math.max(0, total - gone));
    this.report();
    if (this.documents().length > 0 || this.totalSize() === 0) return;
    if (this.pageIndex() > 0) this.pageIndex.update((index) => index - 1);
    else this.reload();
  }

  private report(): void {
    this.resultsHandler()?.({
      loading: this.loading(),
      documents: this.documents(),
      totalSize: this.totalSize(),
    });
  }
}
