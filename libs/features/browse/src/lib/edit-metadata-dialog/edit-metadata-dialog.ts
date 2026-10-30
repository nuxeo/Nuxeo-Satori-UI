import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BrowseService } from '@nuxeo/satori-platform/nuxeo-client';
import {
  NxsDateInputComponent,
  NxsVocabularySelectComponent,
  NxsToastService,
  provideNxsToast,
} from '@nuxeo/satori-platform/components';
import { calendarDayOf, utcMidnightOf } from '../calendar-day';

export interface EditMetadataDialogData {
  uid: string;
  title: string;
  description: string;
  nature: string;
  subjects: string[];
  coverage: string;
  expires: string | null;
}

@Component({
  selector: 'lib-edit-metadata-dialog',
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
  templateUrl: './edit-metadata-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    ':host { display: block; min-width: min(480px, 80vw); } mat-dialog-content { display: flex; flex-direction: column; gap: 8px; } .full-width { width: 100%; }',
  ],
})
export class EditMetadataDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EditMetadataDialogComponent>);
  private readonly data = inject<EditMetadataDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(BrowseService);
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
    this.title = this.data.title;
    this.description = this.data.description;
    this.nature = this.data.nature;
    this.subjects = [...this.data.subjects];
    this.coverage = this.data.coverage;
    // The UTC day the stored instant names, not its local day (NXSAT-727).
    this.expires = calendarDayOf(this.data.expires);
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
      'dc:description': this.description,
      'dc:nature': this.nature || null,
      'dc:subjects': this.subjects,
      'dc:coverage': this.coverage || null,
      // The picked day at UTC midnight, so the stored instant does not depend on the
      // editor's zone and every row showing it names the same day (NXSAT-727).
      'dc:expired': utcMidnightOf(this.expires),
    };
    this.service
      .updateDocument(this.data.uid, properties)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          this.saving.set(false);
          this.toast.show(this.translate.instant('browse.message.document-updated'));
          this.dialogRef.close(doc);
        },
        error: (_error) => {
          this.saving.set(false);
          this.toast.error(this.translate.instant('browse.message.failed-to-update-document'));
        },
      });
  }
}
