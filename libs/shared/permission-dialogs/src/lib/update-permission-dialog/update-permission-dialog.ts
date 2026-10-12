import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo-satori/platform/extensions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { switchMap } from 'rxjs';
import {
  DocumentDetailService,
  NuxeoAce,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionUpdateMailFailureMessage,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface UpdatePermissionDialogData {
  documentUid: string;
  ace: NuxeoAce;
  isExternal?: boolean;
}

const PERMISSION_OPTIONS = [
  { value: 'Read', labelKey: 'permission.read', label: 'Read' },
  { value: 'ReadWrite', labelKey: 'permission.read-write', label: 'Edit' },
  { value: 'Everything', labelKey: 'permission.everything', label: 'Manage everything' },
  { value: 'ReadCanCollect', labelKey: 'permission.read-can-collect', label: 'Can collect' },
];

@Component({
  selector: 'lib-update-permission-dialog',
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
    MatRadioModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatProgressSpinnerModule,
  ],
  providers: [provideNativeDateAdapter(), provideTranslatedDatepickerIntl(), provideNxsToast()],
  templateUrl: './update-permission-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 440px;
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

      .time-frame-section {
        margin-bottom: 8px;
      }

      .time-frame-radios {
        display: flex;
        gap: 24px;
      }

      .date-fields {
        display: flex;
        gap: 16px;

        mat-form-field {
          flex: 1;
        }
      }

      .notify-checkbox {
        margin: 4px 0 8px;
      }

      .mail-hint {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.4;
      }

      .notify-section {
        margin-top: 4px;
      }

      mat-dialog-actions {
        display: flex;
        gap: 8px;
        padding: 8px 24px 16px;
      }

      .spacer {
        flex: 1;
      }
    `,
  ],
})
export class UpdatePermissionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<UpdatePermissionDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<UpdatePermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly saving = signal(false);
  readonly permissionOptions = PERMISSION_OPTIONS;
  readonly mailHintKey = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;
  readonly isExternal: boolean;

  permission: string;
  timeFrame: 'permanent' | 'date-based';
  beginDate: Date | null;
  endDate: Date | null;
  sendNotify = false;
  notifyComment = '';

  constructor() {
    const ace = this.data.ace;
    this.isExternal = this.data.isExternal ?? false;
    this.permission = ace.permission;
    this.timeFrame = ace.begin || ace.end ? 'date-based' : 'permanent';
    this.beginDate = ace.begin ? new Date(ace.begin) : null;
    this.endDate = ace.end ? new Date(ace.end) : null;
  }

  update(): void {
    if (this.saving()) return;
    this.saving.set(true);

    if (this.isExternal) {
      this.updateExternal();
    } else {
      this.updateLocal();
    }
  }

  private updateLocal(): void {
    this.detailService
      .replacePermissionWithNotification(this.data.documentUid, {
        id: this.data.ace.id,
        username: this.data.ace.username,
        permission: this.permission,
        notify: this.sendNotify,
        comment: this.sendNotify && this.notifyComment.trim() ? this.notifyComment.trim() : null,
        begin:
          this.timeFrame === 'date-based' && this.beginDate
            ? this.formatDate(this.beginDate)
            : null,
        end: this.timeFrame === 'date-based' && this.endDate ? this.formatDate(this.endDate) : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          const message = this.successMessage(result.notificationSent, result.notificationErrorKey);
          if (message) {
            this.toast.show(message, { duration: 7000 });
          }
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(this.permissionErrorMessage(err), { duration: 7000 });
        },
      });
  }

  private updateExternal(): void {
    const ace = this.data.ace;
    const email = ace.username.replace(/^transient\//, '');

    this.detailService
      .removePermission(this.data.documentUid, {
        user: ace.username,
        permission: ace.permission,
        acl: 'local',
      })
      .pipe(
        switchMap(() =>
          this.detailService.addExternalPermissionWithNotification(this.data.documentUid, {
            email,
            permission: this.permission,
            begin: this.beginDate ? this.formatDate(this.beginDate) : null,
            end: this.endDate ? this.formatDate(this.endDate) : null,
            notify: true,
            comment: this.notifyComment.trim() || undefined,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          const message = this.successMessage(result.notificationSent, result.notificationErrorKey);
          if (message) {
            this.toast.show(message, { duration: 7000 });
          }
          this.dialogRef.close(true);
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
    if (this.sendNotify && notificationSent) {
      return this.translate.instant(
        'permission-dialogs.message.permission-updated-notification-sent',
      );
    }
    if (this.isExternal && notificationSent) {
      return this.translate.instant(
        'permission-dialogs.message.permission-updated-notification-sent',
      );
    }
    return null;
  }

  private permissionErrorMessage(err: unknown): string {
    if (isMailSendError(err)) {
      return permissionUpdateMailFailureMessage((key) => this.translate.instant(key));
    }
    const raw = (err as { error?: { message?: string } })?.error?.message?.trim();
    return raw || this.translate.instant('permission-dialogs.message.could-not-update-permission');
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
