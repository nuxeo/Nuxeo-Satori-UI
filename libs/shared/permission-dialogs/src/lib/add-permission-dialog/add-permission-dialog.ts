import {
  NxsDateInputComponent,
  NxsToastService,
  NxsUserGroupPickerComponent,
  provideNxsToast,
  type NxsPrincipal,
} from '@nuxeo/satori-platform/components';

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgModel } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  DocumentDetailService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionCreateMailFailureMessage,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';

export interface AddPermissionDialogData {
  documentUid: string;
}

const PERMISSION_OPTIONS = [
  { value: 'Read', labelKey: 'permission.read', label: 'Read' },
  { value: 'ReadWrite', labelKey: 'permission.read-write', label: 'Edit' },
  { value: 'Everything', labelKey: 'permission.everything', label: 'Manage everything' },
  { value: 'ReadCanCollect', labelKey: 'permission.read-can-collect', label: 'Can collect' },
];

@Component({
  selector: 'lib-add-permission-dialog',
  standalone: true,
  imports: [
    NxsDateInputComponent,
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
    MatIconModule,
    MatProgressSpinnerModule,
    NxsUserGroupPickerComponent,
  ],
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl(), provideNxsToast()],
  templateUrl: './add-permission-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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

        nxs-date-input {
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

      .create-another-btn {
        background: #3f51b5 !important;
      }
    `,
  ],
})
export class AddPermissionDialogComponent {
  private readonly beginDateControl = viewChild<NgModel>('beginDateControl');
  private readonly endDateControl = viewChild<NgModel>('endDateControl');
  protected datesValid(): boolean {
    return !this.beginDateControl()?.invalid && !this.endDateControl()?.invalid;
  }

  private readonly dialogRef = inject(MatDialogRef<AddPermissionDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<AddPermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedUser = signal<NxsPrincipal | null>(null);
  private readonly principalModel = viewChild('principal', { read: NgModel });
  readonly saving = signal(false);

  readonly permissionOptions = PERMISSION_OPTIONS;
  readonly mailHintKey = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;

  permission = 'Read';
  timeFrame: 'permanent' | 'date-based' = 'permanent';
  beginDate: Date | null = null;
  endDate: Date | null = null;
  sendNotify = true;
  notifyComment = '';
  addAnother = false;

  create(andAddAnother: boolean): void {
    if (!this.datesValid()) return;
    const principal = this.selectedUser();
    if (!principal || this.saving()) return;
    this.addAnother = andAddAnother;
    this.saving.set(true);

    this.detailService
      .addPermissionWithNotification(this.data.documentUid, {
        username: principal.id,
        permission: this.permission,
        notify: this.sendNotify,
        comment: this.sendNotify && this.notifyComment.trim() ? this.notifyComment.trim() : '',
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
          if (andAddAnother) {
            if (message) {
              this.toast.show(message, { duration: 7000 });
            }
            this.resetForm();
          } else {
            if (message) {
              this.toast.show(message, { duration: 7000 });
            }
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
    if (this.sendNotify && notificationSent) {
      return this.translate.instant(
        'permission-dialogs.message.permission-added-notification-sent',
      );
    }
    if (this.sendNotify) {
      return null;
    }
    return null;
  }

  private resetForm(): void {
    this.selectedUser.set(null);
    // Untouched again, or the emptied picker shows its `required` error before anyone types.
    this.principalModel()?.control.markAsUntouched();
    this.permission = 'Read';
    this.timeFrame = 'permanent';
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

  private permissionErrorMessage(err: unknown): string {
    if (isMailSendError(err)) {
      return permissionCreateMailFailureMessage((key) => this.translate.instant(key));
    }
    const raw = (err as { error?: { message?: string } })?.error?.message?.trim();
    return raw || this.translate.instant('permission-dialogs.message.could-not-add-permission');
  }
}
