import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { map } from 'rxjs';

import {
  DEFAULT_VOCABULARY_ORDERING,
  DirectoryMetadata,
  DirectoryService,
  ManagedDirectoryEntry,
  defaultVocabularyLabel,
  directoryEntryDisplayLabel,
  directoryUsesL10nLabel,
  resolveParentSourceName,
  vocabularyParentRequired,
  vocabularySupportsParent,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

export interface VocabularyEntryFormDialogData {
  mode: 'create' | 'edit';
  directoryName: string;
  directoryMeta?: DirectoryMetadata;
  entry?: ManagedDirectoryEntry;
  /** Top-level entries for l10n parent pickers within the same vocabulary. */
  siblingEntries?: ManagedDirectoryEntry[];
}

export interface VocabularyEntryFormDialogResult {
  mode: 'create' | 'edit';
  id: string;
  label: string;
  ordering: number;
  obsolete: boolean;
  parent?: string;
}

@Component({
  selector: 'lib-vocabulary-entry-form-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './vocabulary-entry-form-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
      }
      .dialog-title {
        padding: 0 1.5rem 0.75rem;
        margin: 0;
        font-size: 1.25rem;
        font-weight: 500;
        line-height: 1.4;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 420px;
        padding-top: 2.75rem;
        padding-bottom: 0.5rem;
        overflow-x: hidden;
      }
      .first-field {
        margin-top: 0.25rem;
      }
      .full {
        width: 100%;
      }
      .dialog-actions {
        gap: 0.5rem;
        padding: 0.75rem 1.5rem 1.25rem;
      }
      .obsolete-row {
        margin: 0.15rem 0 0.25rem;
      }
      .parent-loading {
        display: flex;
        justify-content: center;
        padding: 0.5rem 0;
      }
    `,
  ],
})
export class VocabularyEntryFormDialogComponent implements OnInit {
  private readonly dialogRef =
    inject<MatDialogRef<VocabularyEntryFormDialogComponent, VocabularyEntryFormDialogResult>>(
      MatDialogRef,
    );
  private readonly directoryService = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<VocabularyEntryFormDialogData>(MAT_DIALOG_DATA);

  showParentField = false;
  parentRequired = false;

  readonly usesL10nLabel = directoryUsesL10nLabel(this.data.directoryName);

  parentOptions = signal<ManagedDirectoryEntry[]>([]);
  loadingParents = signal(false);

  id = this.data.entry?.id ?? '';
  label = this.data.entry?.label ?? '';
  ordering = this.data.entry?.ordering ?? DEFAULT_VOCABULARY_ORDERING;
  obsolete = this.data.entry?.obsolete ?? false;
  parent = this.data.entry?.parent ?? '';

  private suggestedLabel = '';

  ngOnInit(): void {
    this.showParentField = this.resolveShowParentField();
    if (!this.showParentField) return;

    this.loadingParents.set(true);
    const sourceName = resolveParentSourceName(this.data.directoryName, this.data.directoryMeta);
    this.parentRequired = vocabularyParentRequired(
      this.data.directoryName,
      this.data.directoryMeta,
    );
    if (!sourceName) {
      this.loadingParents.set(false);
      return;
    }

    if (sourceName === this.data.directoryName) {
      const options = this.sortParentOptions(
        this.l10nParentOptions(this.data.siblingEntries ?? [], this.data.entry?.id),
      );
      this.parentOptions.set(options);
      this.loadingParents.set(false);
      return;
    }

    this.directoryService
      .getAdminEntries(sourceName)
      .pipe(
        map((entries) =>
          this.sortParentOptions(entries.filter((entry) => entry.id !== this.data.entry?.id)),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (options) => {
          this.parentOptions.set(options);
          this.loadingParents.set(false);
        },
        error: () => this.loadingParents.set(false),
      });
  }

  onIdChange(): void {
    if (this.data.mode !== 'create' || this.usesL10nLabel) return;
    const suggested = defaultVocabularyLabel(this.data.directoryName, this.id);
    if (!this.label.trim() || this.label === this.suggestedLabel) {
      this.label = suggested;
      this.suggestedLabel = suggested;
    }
  }

  parentOptionLabel(option: ManagedDirectoryEntry): string {
    return directoryEntryDisplayLabel(option);
  }

  canSubmit(): boolean {
    const trimmedId = this.id.trim();
    if (!trimmedId) return false;
    if (this.parentRequired && !this.parent.trim()) return false;
    if (this.usesL10nLabel && !this.label.trim()) return false;
    return true;
  }

  submit(): void {
    if (!this.canSubmit()) return;

    const trimmedId = this.id.trim();
    const resolvedLabel =
      this.label.trim() ||
      (this.usesL10nLabel ? '' : defaultVocabularyLabel(this.data.directoryName, trimmedId));

    this.dialogRef.close({
      mode: this.data.mode,
      id: trimmedId,
      label: resolvedLabel,
      ordering: this.ordering,
      obsolete: this.obsolete,
      parent: this.showParentField ? this.parent.trim() : undefined,
    });
  }

  private sortParentOptions(options: ManagedDirectoryEntry[]): ManagedDirectoryEntry[] {
    return [...options].sort((a, b) =>
      directoryEntryDisplayLabel(a).localeCompare(directoryEntryDisplayLabel(b)),
    );
  }

  private l10nParentOptions(
    entries: ManagedDirectoryEntry[],
    excludeId?: string,
  ): ManagedDirectoryEntry[] {
    return entries.filter((entry) => entry.id !== excludeId && !entry.parent);
  }

  private resolveShowParentField(): boolean {
    const { directoryName, directoryMeta, entry, siblingEntries } = this.data;
    const entries = entry ? [entry, ...(siblingEntries ?? [])] : (siblingEntries ?? []);
    return vocabularySupportsParent(directoryName, directoryMeta, entries);
  }
}
