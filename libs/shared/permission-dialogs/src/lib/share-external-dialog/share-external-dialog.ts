import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo-satori/platform/extensions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  DocumentDetailService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionCreateMailFailureMessage,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface ShareExternalDialogData {
  documentUid: string;
}

const PERMISSION_OPTIONS = [
  { value: 'Read', labelKey: 'permission.read', label: 'Read' },
  { value: 'ReadWrite', labelKey: 'permission.read-write', label: 'Edit' },
  { value: 'Everything', labelKey: 'permission.everything', label: 'Manage everything' },
  { value: 'ReadCanCollect', labelKey: 'permission.read-can-collect', label: 'Can collect' },
];

@Component({
  selector: 'lib-share-external-dialog',
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
    MatProgressSpinnerModule,
  ],
  providers: [provideNativeDateAdapter(), provideTranslatedDatepickerIntl(), provideNxsToast()],
  templateUrl: './share-external-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 480px;
      }

      mat-dialog-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-top: 8px !important;
      }

      .full-width {
        width: 100%;
      }

      .field-label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: #555;
        margin-bottom: 6px;
      }

      .date-fields {
        display: flex;
        gap: 16px;

        mat-form-field {
          flex: 1;
        }
      }

      .notify-section {
        margin-top: 4px;
      }

      .mail-hint {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.4;
      }

      mat-dialog-actions {
        display: flex;
        gap: 8px;
        padding: 8px 24px 16px;
      }

      .spacer {
        flex: 1;
      }

      .create-another-btn {
        background: #3f51b5 !important;
      }
    `,
  ],
})
export class ShareExternalDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ShareExternalDialogComponent, boolean>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<ShareExternalDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly saving = signal(false);
  readonly permissionOptions = PERMISSION_OPTIONS;
  readonly mailHintKey = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;

  email = '';
  permission = 'Read';
  beginDate: Date | null = null;
  endDate: Date | null = null;
  notifyComment = '';
  addAnother = false;
  private createdAny = false;

  cancel(): void {
    this.dialogRef.close(this.createdAny);
  }

  isValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()) && !!this.endDate;
  }

  create(andAddAnother: boolean): void {
    if (!this.isValid() || this.saving()) return;
    this.addAnother = andAddAnother;
    this.saving.set(true);
    const email = this.email.trim();

    this.detailService
      .addExternalPermissionWithNotification(this.data.documentUid, {
        email,
        permission: this.permission,
        notify: true,
        begin: this.beginDate ? this.formatDate(this.beginDate) : null,
        end: this.endDate ? this.formatDate(this.endDate) : null,
        comment: this.notifyComment.trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.createdAny = true;
          const message = this.successMessage(result.notificationSent, result.notificationErrorKey);
          if (message) {
            this.toast.show(message, { duration: 7000 });
          }
          if (andAddAnother) {
            this.resetForm();
          } else {
            this.dialogRef.close(true);
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(this.permissionErrorMessage(err), { duration: 7000 });
        },
      });
  }

  private successMessage(notificationSent: boolean, notificationErrorKey?: string): string | null {
    if (notificationErrorKey) {
      return this.translate.instant(notificationErrorKey);
    }
    if (notificationSent) {
      return this.translate.instant(
        'permission-dialogs.message.permission-added-notification-sent',
      );
    }
    return null;
  }

  private permissionErrorMessage(err: unknown): string {
    if (isMailSendError(err)) {
      return permissionCreateMailFailureMessage((key) => this.translate.instant(key));
    }
    const raw = (err as { error?: { message?: string } })?.error?.message?.trim();
    return raw || this.translate.instant('permission-dialogs.message.could-not-share-external');
  }

  private resetForm(): void {
    this.email = '';
    this.permission = 'Read';
    this.beginDate = null;
    this.endDate = null;
    this.notifyComment = '';
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
