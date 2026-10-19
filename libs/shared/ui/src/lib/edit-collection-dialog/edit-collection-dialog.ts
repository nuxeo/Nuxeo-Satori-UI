import { Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  CollectionService,
  NuxeoDocument,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  NxsDateInputComponent,
  NxsVocabularySelectComponent,
  NxsToastService,
  provideNxsToast,
} from '@nuxeo/satori-platform/components';

export interface EditCollectionDialogData {
  document: NuxeoDocument;
}

@Component({
  selector: 'lib-edit-collection-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    NxsDateInputComponent,
    NxsVocabularySelectComponent,
  ],
  providers: [provideNxsToast()],
  templateUrl: './edit-collection-dialog.html',
  styleUrl: './edit-collection-dialog.scss',
})
export class EditCollectionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EditCollectionDialogComponent>);
  private readonly data = inject<EditCollectionDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(CollectionService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('metadataForm') protected form?: NgForm;
  readonly saving = signal(false);
  title = '';
  description = '';
  nature: string | null = null;
  subjects: string[] = [];
  coverage: string | null = null;
  expires: Date | null = null;
  constructor() {
    const doc = this.data.document;
    const props = doc.properties ?? {};
    this.title = (props['dc:title'] as string) ?? doc.title ?? '';
    this.description = (props['dc:description'] as string) ?? '';
    this.nature = (props['dc:nature'] as string) ?? null;
    this.subjects = [...((props['dc:subjects'] as string[]) ?? [])];
    this.coverage = (props['dc:coverage'] as string) ?? null;
    const expires = props['dc:expired'] as string | null;
    this.expires = expires ? new Date(expires) : null;
  }
  isExpiresValid(): boolean {
    return (
      !this.form?.controls['expires']?.invalid &&
      (!this.expires || !Number.isNaN(this.expires.getTime()))
    );
  }
  save(): void {
    if (this.saving() || !this.title.trim() || this.form?.invalid || !this.isExpiresValid()) return;
    this.saving.set(true);
    const properties: Record<string, unknown> = {
      'dc:title': this.title.trim(),
      'dc:description': this.description.trim() || null,
      'dc:nature': this.nature || null,
      'dc:subjects': this.subjects,
      'dc:coverage': this.coverage || null,
      'dc:expired': this.expires ? this.expires.toISOString() : null,
    };
    this.service
      .updateProperties(this.data.document.uid, properties)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          this.saving.set(false);
          this.dialogRef.close(doc);
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(
            isPermissionDeniedError(error)
              ? this.translate.instant(PERMISSION_DENIED_KEY)
              : this.translate.instant('shared-ui.message.failed-to-update-collection'),
          );
        },
      });
  }
}
