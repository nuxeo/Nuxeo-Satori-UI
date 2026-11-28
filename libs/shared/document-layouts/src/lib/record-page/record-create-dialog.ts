import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsBannerComponent,
  NxsButtonComponent,
  NxsDialogComponent,
} from '@nuxeo/satori-platform/components';
import {
  DocumentImportService,
  type NuxeoDocument,
  sanitizeDocumentName,
} from '@nuxeo/satori-platform/nuxeo-client';
import { finalize } from 'rxjs';

import {
  DocumentLayoutFormComponent,
  type FixedFormValue,
} from '../document-layout-form/document-layout-form';
import { readServerRefusal, readValidationFailure } from '../validation-failure';

let nextDialogId = 0;

export interface RecordCreateDialogData {
  /** The document type created. */
  readonly type: string;
  /** The dialog's title and its Create button's words: the list's "New", in the reader's words. */
  readonly title: string;
  /** The folder the new record is filed in, by its path, and its title for the person. */
  readonly folder: { readonly path: string; readonly title: string };
  /** The open record, whose id the new record's `field` is given, read-only. */
  readonly reference: {
    readonly field: string;
    readonly id: string;
    /** The open record's title, which the form shows for the reference. */
    readonly title: string;
  };
}

/**
 * The create form of a related list's New (layout-v2.md, section 7): the type's create form, with
 * the property that refers to the open record given its id and shown read-only, filed in the
 * folder the page found. The person creates it with their own permissions, as Create in Browse
 * does, `POST` under the folder: the server decides whether it takes it, and its reason for
 * refusing, its constraint messages on the fields they name, any other in the dialog, which stays
 * open with what was entered.
 *
 * Closes with the record created, or with nothing when cancelled.
 */
@Component({
  selector: 'lib-record-create-dialog',
  standalone: true,
  imports: [
    DocumentLayoutFormComponent,
    NxsBannerComponent,
    NxsButtonComponent,
    NxsDialogComponent,
    TranslatePipe,
  ],
  templateUrl: './record-create-dialog.html',
  styleUrl: './record-create-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordCreateDialogComponent {
  protected readonly data = inject<RecordCreateDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<RecordCreateDialogComponent, NuxeoDocument>>(MatDialogRef);
  private readonly imports = inject(DocumentImportService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly form = viewChild(DocumentLayoutFormComponent);

  /** The line saying where it is filed and what it refers to. */
  protected readonly contextId = `lib-record-create-context-${nextDialogId++}`;

  /** The reference, fixed: the open record's id, shown as its title. */
  protected readonly fixed: Readonly<Record<string, FixedFormValue>> = {
    [this.data.reference.field]: { value: this.data.reference.id, text: this.data.reference.title },
  };

  protected readonly saving = signal(false);
  /** Why the last create failed, when no field could say so. */
  protected readonly failure = signal<string | null>(null);

  protected cancel(): void {
    if (!this.saving()) this.dialogRef.close();
  }

  protected save(): void {
    const form = this.form();
    if (this.saving() || !form?.ready()) return;
    this.failure.set(null);
    if (!form.validate()) return;
    // The reference last, so that nothing entered can change what the new record refers to.
    const properties: Record<string, unknown> = {
      ...form.changedProperties(),
      [this.data.reference.field]: this.data.reference.id,
    };
    const title = typeof properties['dc:title'] === 'string' ? properties['dc:title'].trim() : '';
    this.saving.set(true);
    this.imports
      .createChildDocument(
        this.data.folder.path,
        sanitizeDocumentName(title || this.data.type),
        this.data.type,
        properties,
      )
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (created) => this.dialogRef.close(created),
        error: (error: unknown) => this.failure.set(this.failureMessage(form, error)),
      });
  }

  private failureMessage(form: DocumentLayoutFormComponent, error: unknown): string | null {
    const errors = readValidationFailure(
      error,
      this.translate.instant('document-layouts.create.not-accepted'),
    );
    if (errors) {
      const unplaced = form.showServerErrors(errors);
      return unplaced.length > 0 ? unplaced.join(' ') : null;
    }
    return readServerRefusal(error) ?? this.translate.instant('document-layouts.create.failed');
  }
}
