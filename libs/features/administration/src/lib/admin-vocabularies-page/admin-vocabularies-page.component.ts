import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter, forkJoin, switchMap } from 'rxjs';

import {
  DirectoryMetadata,
  DirectoryService,
  ManagedDirectoryEntry,
  VocabularyEntryFormValues,
  directoryAdminTableLabel,
  getDirectoryMetadata,
  vocabularyTableColumns,
} from '@nuxeo/satori-platform/nuxeo-client';
import { ConfirmDialogComponent, ConfirmDialogData } from '@nuxeo/satori-platform/ui';

import {
  VocabularyEntryFormDialogComponent,
  VocabularyEntryFormDialogData,
  VocabularyEntryFormDialogResult,
} from '../vocabulary-entry-form-dialog/vocabulary-entry-form-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'lib-admin-vocabularies-page',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-vocabularies-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-vocabularies-page.component.scss',
})
export class AdminVocabulariesPageComponent implements OnInit {
  private readonly directoryService = inject(DirectoryService);
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  directoryNames = signal<string[]>([]);
  directoryCatalog = signal<Map<string, DirectoryMetadata>>(new Map());
  selectedDirectory = signal<string>('');
  entries = signal<ManagedDirectoryEntry[]>([]);
  loading = signal(false);
  loadingList = signal(false);
  mutating = signal(false);

  private loadRequestId = 0;

  readonly selectedDirectoryMeta = computed(() =>
    getDirectoryMetadata(this.directoryCatalog(), this.selectedDirectory()),
  );

  readonly columns = computed(() =>
    vocabularyTableColumns(this.selectedDirectory(), this.selectedDirectoryMeta(), this.entries()),
  );

  ngOnInit(): void {
    this.loadingList.set(true);
    forkJoin({
      catalog: this.directoryService.getDirectoryCatalog(),
      names: this.directoryService.listDirectoryNames(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ catalog, names }) => {
          this.directoryNames.set(names);
          this.directoryCatalog.set(catalog);
          this.loadingList.set(false);
          if (names.length && !this.selectedDirectory()) {
            const preferred = names.find((name) => name.toLowerCase() === 'country') ?? names[0];
            this.selectedDirectory.set(preferred);
            this.loadEntries(preferred);
          }
        },
        error: () => this.loadingList.set(false),
      });
  }

  onDirectoryChange(name: string): void {
    this.selectedDirectory.set(name);
    this.loadEntries(name);
  }

  parentCellValue(row: ManagedDirectoryEntry): string {
    return row.parent ?? '—';
  }

  entryTableLabel(row: ManagedDirectoryEntry): string {
    return directoryAdminTableLabel(row);
  }

  loadEntries(directoryName: string): void {
    if (!directoryName) {
      this.entries.set([]);
      return;
    }
    const requestId = ++this.loadRequestId;
    this.loading.set(true);
    this.directoryService
      .getAdminEntries(directoryName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          if (requestId !== this.loadRequestId) return;
          this.entries.set(rows);
          this.loading.set(false);
        },
        error: () => {
          if (requestId !== this.loadRequestId) return;
          this.entries.set([]);
          this.loading.set(false);
          this.snackBar.open(
            this.translate.instant('admin.message.failed-to-load-vocabulary-entries'),
            this.translate.instant('common.dismiss'),
            { duration: 4000 },
          );
        },
      });
  }

  openCreateEntry(): void {
    const directoryName = this.selectedDirectory();
    if (!directoryName) return;
    this.openEntryDialog({
      mode: 'create',
      directoryName,
      directoryMeta: this.selectedDirectoryMeta(),
      siblingEntries: this.entries(),
    });
  }

  openEditEntry(entry: ManagedDirectoryEntry): void {
    const directoryName = this.selectedDirectory();
    if (!directoryName) return;
    this.openEntryDialog({
      mode: 'edit',
      directoryName,
      directoryMeta: this.selectedDirectoryMeta(),
      entry,
      siblingEntries: this.entries(),
    });
  }

  confirmDeleteEntry(entry: ManagedDirectoryEntry): void {
    const directoryName = this.selectedDirectory();
    if (!directoryName) return;

    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean | undefined>(
        ConfirmDialogComponent,
        {
          data: {
            title: this.translate.instant('confirm.delete-vocabulary-entry'),
            message: this.translate.instant('confirm.delete-vocabulary-entry-named', {
              name: entry.id,
              directory: directoryName,
            }),
            confirmLabel: this.translate.instant('confirm.delete'),
          },
        },
      )
      .afterClosed()
      .pipe(
        filter((confirmed) => confirmed === true),
        switchMap(() => {
          this.mutating.set(true);
          return this.directoryService.deleteEntry(directoryName, entry.id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.snackBar.open(
            this.translate.instant('admin.message.entry-deleted'),
            this.translate.instant('common.dismiss'),
            { duration: 3000 },
          );
          this.loadEntries(directoryName);
        },
        error: () => {
          this.mutating.set(false);
          this.snackBar.open(
            this.translate.instant('admin.message.failed-to-delete-entry'),
            this.translate.instant('common.dismiss'),
            { duration: 4000 },
          );
        },
      });
  }

  private openEntryDialog(data: VocabularyEntryFormDialogData): void {
    this.dialog
      .open<
        VocabularyEntryFormDialogComponent,
        VocabularyEntryFormDialogData,
        VocabularyEntryFormDialogResult
      >(VocabularyEntryFormDialogComponent, { data, width: '480px' })
      .afterClosed()
      .pipe(
        filter((result): result is VocabularyEntryFormDialogResult => !!result),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.saveEntry(data, result));
  }

  private saveEntry(
    dialogData: VocabularyEntryFormDialogData,
    result: VocabularyEntryFormDialogResult,
  ): void {
    const directoryName = dialogData.directoryName;
    const directoryMeta = getDirectoryMetadata(this.directoryCatalog(), directoryName);
    const values: VocabularyEntryFormValues = {
      id: result.id,
      label: result.label,
      ordering: result.ordering,
      obsolete: result.obsolete,
      parent: result.parent,
    };

    this.mutating.set(true);
    const request$ =
      result.mode === 'create'
        ? this.directoryService.createEntry(directoryName, values, directoryMeta)
        : this.directoryService.updateEntry(
            directoryName,
            dialogData.entry?.id ?? result.id,
            values,
            directoryMeta,
          );

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.mutating.set(false);
        const action = result.mode === 'create' ? 'created' : 'updated';
        this.snackBar.open(
          this.translate.instant(
            action === 'created'
              ? 'admin.vocabularies.entry-created'
              : 'admin.vocabularies.entry-updated',
          ),
          this.translate.instant('common.dismiss'),
          { duration: 3000 },
        );
        this.loadEntries(directoryName);
      },
      error: () => {
        this.mutating.set(false);
        this.snackBar.open(
          this.translate.instant('admin.message.failed-to-save-entry'),
          this.translate.instant('common.dismiss'),
          { duration: 4000 },
        );
      },
    });
  }
}
