import { Component, computed, effect, inject, signal, untracked, DestroyRef } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { of, finalize, filter, switchMap, map } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { SatTagModule } from '@hylandsoftware/satori-ui/tag';
import {
  ConfirmDialogComponent,
  SAVED_SEARCH_DIALOG_OPTIONS,
  SavedSearchDialogComponent,
  ShareSavedSearchDialogComponent,
  type ConfirmDialogData,
} from '@nuxeo/satori-platform/ui';

import {
  TrashService,
  TrashFilterService,
  SelectionService,
  SearchService,
  DocumentDetailService,
  docTypeIcon,
  type NuxeoDocument,
  type NuxeoDocumentList,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export type ViewMode = 'grid' | 'table' | 'list';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  width: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'title', labelKey: 'trash.column.title', label: 'Title', width: '2fr' },
  { key: 'type', labelKey: 'trash.column.type', label: 'Type', width: '1fr' },
  { key: 'modified', labelKey: 'trash.column.modified', label: 'Modified', width: '1fr' },
  {
    key: 'contributor',
    labelKey: 'trash.column.contributor',
    label: 'Last contributor',
    width: '1.2fr',
  },
  { key: 'created', labelKey: 'trash.column.created', label: 'Created', width: '1fr' },
  { key: 'author', labelKey: 'trash.column.author', label: 'Author', width: '1fr' },
  { key: 'state', labelKey: 'trash.column.state', label: 'State', width: '1fr' },
];

const SORT_FIELD_MAP: Record<string, string> = {
  title: 'dc:title',
  type: 'dc:type',
  modified: 'dc:modified',
  contributor: 'dc:lastContributor',
  created: 'dc:created',
  author: 'dc:creator',
  state: 'ecm:currentLifeCycleState',
};

const SORTABLE_COLUMNS = new Set(['title', 'modified', 'contributor', 'created', 'author']);

@Component({
  selector: 'lib-trash',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    DescriptorLabelPipe,
    TranslatePipe,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatMenuModule,
    MatDialogModule,
    SatTagModule,
  ],
  templateUrl: './trash.component.html',
  styleUrl: './trash.component.scss',
})
export class TrashComponent {
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly trashService = inject(TrashService);
  private readonly searchService = inject(SearchService);
  private readonly detailService = inject(DocumentDetailService);
  readonly trashFilterService = inject(TrashFilterService);
  readonly selectionService = inject(SelectionService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly documents = signal<NuxeoDocument[]>([]);
  readonly totalResults = signal(0);

  readonly viewMode = signal<ViewMode>('table');
  readonly sortBy = signal<string>('created');
  readonly sortDir = signal<SortDirection>('desc');
  readonly visibleColumnKeys = signal<string[]>(['title', 'type', 'modified', 'contributor']);
  readonly columnPanelOpen = signal(false);
  readonly pendingColumnKeys = signal<string[]>(['title', 'type', 'modified', 'contributor']);

  readonly columnsForPanel = ALL_COLUMNS;
  readonly SORTABLE_COLUMNS = SORTABLE_COLUMNS;

  readonly visibleColumns = computed(() =>
    ALL_COLUMNS.filter((c) => this.visibleColumnKeys().includes(c.key)),
  );

  readonly gridTemplate = computed(() =>
    ['40px', ...this.visibleColumns().map((c) => c.width), '80px'].join(' '),
  );

  readonly resultCount = computed(() => this.documents().length);
  readonly selectedCount = computed(() => this.selectionService.selectedCount());

  readonly isAllSelected = computed(() =>
    this.selectionService.isAllSelected(this.documents().map((d) => d.uid)),
  );

  readonly isIndeterminate = computed(() =>
    this.selectionService.isIndeterminate(this.documents().map((d) => d.uid)),
  );

  readonly actionInProgress = signal<Set<string>>(new Set());
  readonly thumbnailMap = signal<Record<string, string | null>>({});
  private thumbnailGeneration = 0;
  /** Sequence for search requests, so a superseded response cannot write. See `search()`. */
  private searchGeneration = 0;
  readonly saving = signal(false);
  readonly deletingSavedSearch = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearThumbnails());

    effect(
      () => {
        this.trashFilterService.filters();
        this.sortBy();
        this.sortDir();
        untracked(() => this.search());
      },
      { allowSignalWrites: true },
    );
  }

  search(): void {
    // Every response is checked against this before it is allowed to write anything.
    //
    // `beginThumbnailBatch()` alone did not make overlapping searches safe, because the request
    // never compared it: if A starts, B starts and completes, then A completes, A still overwrote
    // `documents`, `totalResults` and the shared filter-service results with its stale entries, and
    // its `loadThumbnails` then cleared B's thumbnails in favour of its own. The sibling components
    // avoid this structurally by driving search through `switchMap`, which cancels the previous
    // request; this one subscribes imperatively, so it needs the guard.
    const generation = ++this.searchGeneration;
    this.loading.set(true);
    this.error.set(null);
    this.trashFilterService.resultsLoading.set(true);
    this.beginThumbnailBatch();
    const f = this.trashFilterService.filters();
    const sortField = SORT_FIELD_MAP[this.sortBy()] ?? 'dc:created';
    this.trashService
      .searchTrash({
        fullText: f.fullText,
        path: f.path,
        author: f.author,
        sizeRanges: f.sizeRanges,
        sortBy: sortField,
        sortOrder: this.sortDir(),
        pageSize: 100,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: NuxeoDocumentList) => {
          if (generation !== this.searchGeneration) return;
          const entries = res.entries ?? [];
          this.documents.set(entries);
          this.totalResults.set(res.resultsCount ?? entries.length);
          this.loading.set(false);
          this.trashFilterService.resultsLoading.set(false);
          this.trashFilterService.results.set(
            entries.map((d) => ({ uid: d.uid, title: d.title, type: d.type })),
          );
          this.trashFilterService.totalResults.set(res.resultsCount ?? entries.length);
          this.loadThumbnails(entries);
        },
        error: () => {
          // Guarded too: a stale failure would otherwise show an error over a newer search's
          // successful results and clear its loading state.
          if (generation !== this.searchGeneration) return;
          this.error.set(this.translate.instant('trash.message.failed-to-load-trashed-documents'));
          this.loading.set(false);
          this.trashFilterService.resultsLoading.set(false);
        },
      });
  }

  docIcon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  saveAsSearch(): void {
    const dialogRef = this.dialog.open(SavedSearchDialogComponent, {
      ...SAVED_SEARCH_DIALOG_OPTIONS,
      data: {
        title: this.translate.instant('ui.saved-search'),
        placeholder: this.translate.instant('saved-search.dialog.name-placeholder'),
      },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((name): name is string => !!name?.trim()),
        switchMap((name) => {
          this.saving.set(true);
          return this.trashService.saveSearch(name.trim(), this.buildFilterParams()).pipe(
            finalize(() => this.saving.set(false)),
            catchError(() => {
              this.snackBar.open(
                this.translate.instant('assets.message.failed-to-save-search'),
                this.translate.instant('common.dismiss'),
                { duration: 5000 },
              );
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (!result) return;
        this.trashFilterService.activeSavedFilterUid.set(result.uid);
        this.trashFilterService.activeSavedFilterTitle.set(result.title);
        this.trashFilterService.markSavedSearchDirty();
        this.snackBar.open(
          this.translate.instant('common.search-saved', { name: result.title }),
          this.translate.instant('common.ok'),
          { duration: 3000 },
        );
      });
  }

  saveSearch(): void {
    const uid = this.trashFilterService.activeSavedFilterUid();
    const title = this.trashFilterService.activeSavedFilterTitle();
    if (!uid || !title) return;

    this.saving.set(true);
    this.trashService
      .updateSearch(uid, title, this.buildFilterParams())
      .pipe(
        finalize(() => this.saving.set(false)),
        catchError(() => {
          this.snackBar.open(
            this.translate.instant('assets.message.failed-to-save-search'),
            this.translate.instant('common.dismiss'),
            { duration: 5000 },
          );
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (!result) return;
        this.trashFilterService.markSavedSearchDirty();
        this.snackBar.open(
          this.translate.instant('common.search-updated', { name: title }),
          this.translate.instant('common.ok'),
          { duration: 3000 },
        );
      });
  }

  onEditSelectedSavedSearch(): void {
    const uid = this.trashFilterService.activeSavedFilterUid();
    const title = this.trashFilterService.activeSavedFilterTitle();
    if (!uid || !title) return;

    this.dialog
      .open(SavedSearchDialogComponent, {
        ...SAVED_SEARCH_DIALOG_OPTIONS,
        data: {
          title: this.translate.instant('ui.edit-saved-search'),
          placeholder: this.translate.instant('saved-search.dialog.name-placeholder'),
          initialValue: title.trim(),
        },
      })
      .afterClosed()
      .pipe(
        map((newTitle: unknown) => (typeof newTitle === 'string' ? newTitle.trim() : '')),
        filter((trimmedTitle): trimmedTitle is string => !!trimmedTitle),
        switchMap((trimmedTitle) =>
          this.trashService
            .updateSearch(uid, trimmedTitle, this.buildFilterParams())
            .pipe(map(() => trimmedTitle)),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (trimmedTitle) => {
          this.trashFilterService.activeSavedFilterTitle.set(trimmedTitle);
          this.trashFilterService.markSavedSearchDirty();
          this.snackBar.open(
            this.translate.instant('common.search-updated', { name: trimmedTitle }),
            this.translate.instant('common.ok'),
            { duration: 3000 },
          );
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('assets.message.failed-to-update-search'),
            this.translate.instant('common.dismiss'),
            { duration: 5000 },
          );
        },
      });
  }

  onShareSelectedSavedSearch(): void {
    const id = this.trashFilterService.activeSavedFilterUid()?.trim();
    if (!id) return;

    this.dialog.open(ShareSavedSearchDialogComponent, {
      width: '95vw',
      maxWidth: '1080px',
      data: {
        title:
          this.trashFilterService.activeSavedFilterTitle()?.trim() ||
          this.translate.instant('ui.saved-search'),
        id,
      },
    });
  }

  onDeleteSelectedSavedSearch(): void {
    const uid = this.trashFilterService.activeSavedFilterUid();
    const title = this.trashFilterService.activeSavedFilterTitle();
    if (!uid || !title || this.deletingSavedSearch()) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.delete-saved-search'),
        message: this.translate.instant('confirm.delete-saved-search-named', {
          name: title.trim(),
        }),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.deletingSavedSearch.set(true);
        this.searchService
          .deleteSavedSearch(uid)
          .pipe(
            takeUntilDestroyed(this.destroyRef),
            finalize(() => this.deletingSavedSearch.set(false)),
          )
          .subscribe({
            next: () => {
              this.trashFilterService.reset();
              this.trashFilterService.markSavedSearchDirty();
              this.snackBar.open(
                this.translate.instant('common.search-deleted', { name: title }),
                this.translate.instant('common.ok'),
                { duration: 3000 },
              );
            },
            error: () => {
              this.snackBar.open(
                this.translate.instant('trash.message.failed-to-delete-search'),
                this.translate.instant('common.dismiss'),
                { duration: 5000 },
              );
            },
          });
      });
  }

  private buildFilterParams(): Record<string, unknown> {
    const f = this.trashFilterService.filters();
    const params: Record<string, unknown> = {};
    if (f.fullText) params['ecm_fulltext'] = f.fullText;
    if (f.path && f.path !== '/') params['ecm_path'] = f.path;
    if (f.author) params['dc_creator'] = f.author;
    if (f.sizeRanges.length > 0) params['common_size'] = f.sizeRanges;
    return params;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  setSortBy(value: string): void {
    this.sortBy.set(value);
    this.search();
  }

  toggleSortDir(): void {
    this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    this.search();
  }

  sortByColumn(key: string): void {
    if (!SORTABLE_COLUMNS.has(key)) return;
    if (this.sortBy() === key) {
      this.toggleSortDir();
    } else {
      this.sortBy.set(key);
      this.sortDir.set('asc');
      this.search();
    }
  }

  openDocument(uid: string): void {
    if (!uid) return;
    void this.router.navigateByUrl(`/doc/${uid}`);
  }

  getCellValue(doc: NuxeoDocument, key: string): string {
    const props = doc.properties ?? {};
    switch (key) {
      case 'title':
        return doc.title ?? (props['dc:title'] as string | undefined) ?? '';
      case 'type':
        return doc.type ?? '';
      case 'modified':
        return (props['dc:modified'] as string | undefined) ?? '';
      case 'contributor':
        return (props['dc:lastContributor'] as string | undefined) ?? '';
      case 'created':
        return (props['dc:created'] as string | undefined) ?? '';
      case 'author':
        return (props['dc:creator'] as string | undefined) ?? '';
      case 'state':
        return doc.state ?? '';
      default:
        return '';
    }
  }

  isSelected(id: string): boolean {
    return this.selectionService.isSelected(id);
  }

  toggleSelection(id: string): void {
    const doc = this.documents().find((d) => d.uid === id);
    this.selectionService.toggle(id, doc?.title ?? id, this.thumbnailMap()[id] ?? null);
  }

  toggleAll(): void {
    if (this.isAllSelected()) {
      this.selectionService.clear();
    } else {
      const docs = this.documents();
      const labels: Record<string, string> = {};
      const previews: Record<string, string | null> = {};
      docs.forEach((doc) => {
        labels[doc.uid] = doc.title;
        previews[doc.uid] = this.thumbnailMap()[doc.uid] ?? null;
      });
      this.selectionService.selectAll(
        docs.map((d) => d.uid),
        labels,
        previews,
      );
    }
  }

  restoreSelected(): void {
    const ids = [...this.selectionService.selectedIds()];
    if (ids.length === 0) return;
    const inProgress = new Set(this.actionInProgress());
    ids.forEach((id) => inProgress.add(id));
    this.actionInProgress.set(inProgress);

    let completed = 0;
    for (const uid of ids) {
      this.trashService
        .restoreDocument(uid)
        .pipe(
          finalize(() => {
            this.markInProgress(uid, false);
            completed++;
            if (completed === ids.length) {
              this.selectionService.clear();
              this.snackBar.open(
                `${ids.length} document(s) restored.`,
                this.translate.instant('common.ok'),
                { duration: 3000 },
              );
            }
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: () => this.documents.update((docs) => docs.filter((d) => d.uid !== uid)),
          error: () =>
            this.snackBar.open(
              this.translate.instant('trash.message.failed-to-restore-a-document'),
              this.translate.instant('common.dismiss'),
              { duration: 3000 },
            ),
        });
    }
  }

  deleteSelected(): void {
    const ids = [...this.selectionService.selectedIds()];
    if (ids.length === 0) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.permanently-delete-documents'),
        message:
          ids.length === 1
            ? this.translate.instant('confirm.permanently-delete-warning')
            : this.translate.instant('confirm.permanently-delete-documents-count', {
                count: ids.length,
              }),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;

      const inProgress = new Set(this.actionInProgress());
      ids.forEach((id) => inProgress.add(id));
      this.actionInProgress.set(inProgress);

      let completed = 0;
      for (const uid of ids) {
        this.trashService
          .permanentlyDelete(uid)
          .pipe(
            finalize(() => {
              this.markInProgress(uid, false);
              completed++;
              if (completed === ids.length) {
                this.selectionService.clear();
                this.snackBar.open(
                  `${ids.length} document(s) permanently deleted.`,
                  this.translate.instant('common.ok'),
                  {
                    duration: 3000,
                  },
                );
              }
            }),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe({
            next: () => this.documents.update((docs) => docs.filter((d) => d.uid !== uid)),
            error: () =>
              this.snackBar.open(
                this.translate.instant('trash.message.failed-to-delete-a-document'),
                this.translate.instant('common.dismiss'),
                { duration: 3000 },
              ),
          });
      }
    });
  }

  restoreDocument(uid: string, event?: Event): void {
    event?.stopPropagation();
    if (this.actionInProgress().has(uid)) return;
    this.markInProgress(uid, true);
    this.trashService
      .restoreDocument(uid)
      .pipe(
        finalize(() => this.markInProgress(uid, false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translate.instant('trash.message.document-restored'),
            this.translate.instant('common.ok'),
            { duration: 3000 },
          );
          this.documents.update((docs) => docs.filter((d) => d.uid !== uid));
        },
        error: () =>
          this.snackBar.open(
            this.translate.instant('trash.message.failed-to-restore-document'),
            this.translate.instant('common.dismiss'),
            { duration: 5000 },
          ),
      });
  }

  permanentlyDelete(uid: string, event?: Event): void {
    event?.stopPropagation();
    if (this.actionInProgress().has(uid)) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.permanently-delete-document'),
        message: this.translate.instant('confirm.permanently-delete-warning'),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.markInProgress(uid, true);
      this.trashService
        .permanentlyDelete(uid)
        .pipe(
          finalize(() => this.markInProgress(uid, false)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.translate.instant('trash.message.document-permanently-deleted'),
              this.translate.instant('common.ok'),
              { duration: 3000 },
            );
            this.documents.update((docs) => docs.filter((d) => d.uid !== uid));
          },
          error: () =>
            this.snackBar.open(
              this.translate.instant('trash.message.failed-to-delete-document'),
              this.translate.instant('common.dismiss'),
              { duration: 5000 },
            ),
        });
    });
  }

  isPendingColumn(key: string): boolean {
    return this.pendingColumnKeys().includes(key);
  }

  togglePendingColumn(key: string): void {
    const current = this.pendingColumnKeys();
    if (current.includes(key)) {
      this.pendingColumnKeys.set(current.filter((k) => k !== key));
    } else {
      const ordered = ALL_COLUMNS.map((c) => c.key);
      this.pendingColumnKeys.set(ordered.filter((k) => [...current, key].includes(k)));
    }
  }

  openColumnPanel(): void {
    this.pendingColumnKeys.set(this.visibleColumnKeys());
    this.columnPanelOpen.set(true);
  }

  closeColumnPanel(): void {
    this.columnPanelOpen.set(false);
  }

  resetColumns(): void {
    this.pendingColumnKeys.set(['title', 'type', 'modified', 'contributor']);
  }

  applyColumns(): void {
    this.visibleColumnKeys.set(
      ALL_COLUMNS.map((c) => c.key).filter((k) => this.pendingColumnKeys().includes(k)),
    );
    this.columnPanelOpen.set(false);
  }

  exportCsv(): void {
    const escape = (v: string): string => `"${v.replaceAll('"', '""')}"`;
    const headers = ['Title', 'Type', 'Modified', 'Last Contributor', 'Created', 'Author', 'State'];
    const rows = this.documents().map((doc) =>
      [
        this.getCellValue(doc, 'title'),
        this.getCellValue(doc, 'type'),
        this.getCellValue(doc, 'modified'),
        this.getCellValue(doc, 'contributor'),
        this.getCellValue(doc, 'created'),
        this.getCellValue(doc, 'author'),
        this.getCellValue(doc, 'state'),
      ].map((c) => escape(c)),
    );
    const csv = [headers.map((h) => escape(h)), ...rows].map((l) => l.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trash-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  private markInProgress(uid: string, add: boolean): void {
    this.actionInProgress.update((s) => {
      const next = new Set(s);
      if (add) next.add(uid);
      else next.delete(uid);
      return next;
    });
  }

  private loadThumbnails(docs: NuxeoDocument[]): void {
    // Mint a new generation rather than reading the current one — two overlapping trash searches
    // could otherwise both capture the generation set by one `beginThumbnailBatch()`, letting the
    // first search's late callbacks pass the guard and reappear after the second cleared them.
    const generation = ++this.thumbnailGeneration;
    this.clearThumbnails();
    for (const doc of docs) {
      this.detailService
        .fetchThumbnail(doc.uid)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob || generation !== this.thumbnailGeneration) return;
          const url = URL.createObjectURL(blob);
          this.setThumbnail(doc.uid, url);
        });
    }
  }

  private beginThumbnailBatch(): void {
    this.thumbnailGeneration += 1;
  }

  private clearThumbnails(): void {
    // Drop the selection layer's copies FIRST. It retains these exact strings and binds them into
    // `<img [src]>` in the shell topbar, and selection survives a new search — so revoking without
    // this leaves selected items pointing at revoked blob URLs. See `SelectionService.forgetPreviews`.
    this.selectionService.forgetPreviews();
    const urls = new Set(
      [
        ...Object.values(this.thumbnailMap()),
        ...Object.values(this.trashFilterService.resultThumbnails()),
      ].filter((url): url is string => !!url),
    );
    for (const url of urls) URL.revokeObjectURL(url);
    this.thumbnailMap.set({});
    this.trashFilterService.resultThumbnails.set({});
  }

  private setThumbnail(uid: string, url: string): void {
    const previous = this.thumbnailMap()[uid] ?? this.trashFilterService.resultThumbnails()[uid];
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.thumbnailMap.update((m) => ({ ...m, [uid]: url }));
    this.trashFilterService.resultThumbnails.update((m) => ({ ...m, [uid]: url }));
  }
}
