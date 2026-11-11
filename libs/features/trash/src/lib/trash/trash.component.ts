import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { of, finalize, filter, switchMap, map } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  NXS_TRASH_LIST_ID,
  NxsTrashListComponent,
  type NxsTrashListResults,
} from '@nuxeo/satori-platform/components';
import { SatHeaderBar } from '@hylandsoftware/satori-ui/header-bar';
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
  SearchService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/**
 * The `/trash` route: the page header with the saved-search actions, and the trash list.
 *
 * The list is rendered through its registered ID, `nxs.components.trashList`, so a customer library
 * can replace it, and the packaged `nxs-trash-list` is the fallback when nothing resolves. It is
 * searched with the filters the trash drawer sets in `TrashFilterService`, and what it shows is
 * mirrored back there for the drawer's result list.
 */
@Component({
  selector: 'lib-trash',
  standalone: true,
  imports: [
    TranslatePipe,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatMenuModule,
    MatDialogModule,
    ExtensionOutletComponent,
    NxsTrashListComponent,
    SatHeaderBar,
  ],
  templateUrl: './trash.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  readonly trashFilterService = inject(TrashFilterService);

  protected readonly listId = NXS_TRASH_LIST_ID;
  readonly saving = signal(false);
  readonly deletingSavedSearch = signal(false);

  /** The list's inputs: the drawer's filters, and the two callbacks the outlet cannot bind as outputs. */
  protected readonly listInputs = computed(() => ({
    filters: this.trashFilterService.filters(),
    openHandler: this.openDocument,
    resultsHandler: this.mirrorResults,
  }));

  private readonly openDocument = (doc: NuxeoDocument): void => {
    void this.router.navigateByUrl(`/doc/${doc.uid}`);
  };

  /** The drawer's "results" layout lists what the page shows. */
  private readonly mirrorResults = (results: NxsTrashListResults): void => {
    this.trashFilterService.resultsLoading.set(results.loading);
    if (results.loading) return;
    this.trashFilterService.results.set(
      results.documents.map((d) => ({ uid: d.uid, title: d.title, type: d.type })),
    );
    this.trashFilterService.totalResults.set(results.totalSize);
  };

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
}
