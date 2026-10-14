import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  DocumentLayoutFormComponent,
  readValidationFailure,
} from '@agentic-ui/shared/document-layouts';
import { BrowseService, NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';

export interface EditDocumentDialogData {
  document: NuxeoDocument;
}

/**
 * Edits a document's properties: its type's edit layout — contributed, or generated from its
 * schemas and its dynamic facets' — or the form a `documentEdit` entry contributes.
 *
 * Save sends only what changed, and closes without a request when nothing did. Nuxeo's
 * constraint messages go on the fields they name; anything else is reported in the dialog,
 * which stays open with the user's input intact.
 */
@Component({
  selector: 'lib-edit-document-dialog',
  standalone: true,
  imports: [
    DocumentLayoutFormComponent,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  providers: [provideTranslatedDatepickerIntl()],
  templateUrl: './edit-document-dialog.html',
  styleUrl: './edit-document-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditDocumentDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EditDocumentDialogComponent>);
  protected readonly data = inject<EditDocumentDialogData>(MAT_DIALOG_DATA);
  private readonly browseService = inject(BrowseService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly form = viewChild(DocumentLayoutFormComponent);

  readonly saving = signal(false);
  /** Why the last save failed, when no field could say so. */
  readonly saveError = signal<string | null>(null);

  save(): void {
    const form = this.form();
    if (this.saving() || !form?.ready()) return;
    this.saveError.set(null);
    if (!form.validate()) return;

    const changes = form.changedProperties();
    if (Object.keys(changes).length === 0) {
      this.dialogRef.close();
      return;
    }

    this.saving.set(true);
    this.browseService
      .updateDocument(this.data.document.uid, changes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.dialogRef.close(updated);
        },
        error: (failure: unknown) => {
          this.saving.set(false);
          this.saveError.set(this.failureMessage(form, failure));
        },
      });
  }

  private failureMessage(form: DocumentLayoutFormComponent, failure: unknown): string | null {
    const errors = readValidationFailure(
      failure,
      this.translate.instant('document-detail.edit-document-dialog.not-accepted'),
    );
    if (errors) {
      const unplaced = form.showServerErrors(errors);
      return unplaced.length ? unplaced.join(' ') : null;
    }
    const forbidden = failure instanceof HttpErrorResponse && failure.status === 403;
    return this.translate.instant(
      forbidden
        ? 'document-detail.edit-document-dialog.save-forbidden'
        : 'document-detail.edit-document-dialog.save-failed',
    );
  }
}
