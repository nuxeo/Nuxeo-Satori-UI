import { Component, inject, signal } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { catchError, of } from 'rxjs';

import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '../datepicker-intl/translated-datepicker-intl';
import { provideSatoriDateAdapter } from '../date-adapter/satori-date-adapter';

export interface ShareSavedSearchExternalDialogData {
  savedSearchId: string;
  initialData?: {
    id: string;
    email: string;
    right: string;
    begin?: string | null;
    end?: string | null;
  };
}

const RIGHT_OPTIONS = [
  { value: 'Read', labelKey: 'permission.read', label: 'Read' },
  { value: 'ReadWrite', labelKey: 'permission.read-write', label: 'Edit' },
  { value: 'Everything', labelKey: 'permission.everything', label: 'Manage everything' },
  { value: 'ReadCanCollect', labelKey: 'permission.read-can-collect', label: 'Can collect' },
];

@Component({
  selector: 'lib-share-saved-search-external-dialog',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
  ],
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl()],
  templateUrl: './share-saved-search-external-dialog.component.html',
  styleUrl: './share-saved-search-external-dialog.component.scss',
})
export class ShareSavedSearchExternalDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<ShareSavedSearchExternalDialogComponent, boolean>,
  );
  private readonly data = inject<ShareSavedSearchExternalDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);

  readonly saving = signal(false);
  readonly rightOptions = RIGHT_OPTIONS;
  readonly isEditMode = !!this.data.initialData;

  email = '';
  right = 'Read';
  beginDate: Date | null = null;
  endDate: Date | null = null;
  notifyComment = '';

  private createdAny = false;

  constructor() {
    if (this.data.initialData) {
      this.email = this.data.initialData.email;
      this.right = this.data.initialData.right || 'Read';
      this.beginDate = this.parseDate(this.data.initialData.begin);
      this.endDate = this.parseDate(this.data.initialData.end);
    }
  }

  cancel(): void {
    this.dialogRef.close(this.createdAny);
  }

  create(andAddAnother: boolean): void {
    if (!this.isValid() || this.saving()) return;

    this.saving.set(true);

    const request = this.isEditMode
      ? this.detailService.replacePermission(this.data.savedSearchId, {
          id: this.data.initialData?.id,
          email: this.email.trim(),
          permission: this.right,
          begin: this.beginDate ? this.formatDate(this.beginDate) : null,
          end: this.endDate ? this.formatDate(this.endDate) : null,
          notify: false,
          comment: this.notifyComment,
        })
      : this.detailService.addPermission(this.data.savedSearchId, {
          email: this.email.trim(),
          permission: this.right,
          begin: this.beginDate ? this.formatDate(this.beginDate) : null,
          end: this.endDate ? this.formatDate(this.endDate) : null,
          notify: false,
          comment: this.notifyComment,
        });

    request
      .pipe(
        catchError((error) => {
          console.error('Error adding external permission:', error);
          this.saving.set(false);
          return of(null);
        }),
      )
      .subscribe((result) => {
        this.saving.set(false);
        if (!result) return;

        this.createdAny = true;

        if (andAddAnother && !this.isEditMode) {
          this.resetForm();
          return;
        }

        this.dialogRef.close(true);
      });
  }

  isValid(): boolean {
    const hasEmail = this.isEditMode ? true : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim());
    const hasToDate = !!this.endDate;
    return hasEmail && hasToDate;
  }

  private resetForm(): void {
    this.email = '';
    this.right = 'Read';
    this.beginDate = null;
    this.endDate = null;
    this.notifyComment = '';
  }

  private formatDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;

    // MM/DD/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [mm, dd, yyyy] = value.split('/');
      return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    // ISO or date-like strings
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
