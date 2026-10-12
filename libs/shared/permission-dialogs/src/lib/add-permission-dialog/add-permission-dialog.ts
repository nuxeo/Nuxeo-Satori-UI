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
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';

import {
  DocumentDetailService,
  UserGroupSuggestion,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionCreateMailFailureMessage,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

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
    MatIconModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
  ],
  providers: [provideNativeDateAdapter(), provideTranslatedDatepickerIntl(), provideNxsToast()],
  templateUrl: './add-permission-dialog.html',
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

      .suggestion-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-right: 8px;
        vertical-align: middle;
        color: #666;
      }

      .suggestion-id {
        color: #999;
        font-size: 12px;
        margin-left: 4px;
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

      .create-another-btn {
        background: #3f51b5 !important;
      }
    `,
  ],
})
export class AddPermissionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AddPermissionDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<AddPermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly searchSubject = new Subject<string>();

  readonly suggestions = signal<UserGroupSuggestion[]>([]);
  readonly saving = signal(false);

  readonly permissionOptions = PERMISSION_OPTIONS;
  readonly mailHintKey = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;

  searchText = '';
  selectedUser: UserGroupSuggestion | null = null;
  permission = 'Read';
  timeFrame: 'permanent' | 'date-based' = 'permanent';
  beginDate: Date | null = null;
  endDate: Date | null = null;
  sendNotify = true;
  notifyComment = '';
  addAnother = false;

  constructor() {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.length >= 1 ? this.detailService.searchUsersGroups(term) : of([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => this.suggestions.set(results));
  }

  onSearchChange(value: string): void {
    this.searchText = value;
    this.selectedUser = null;
    this.searchSubject.next(value);
  }

  onUserSelected(suggestion: UserGroupSuggestion): void {
    this.selectedUser = suggestion;
    this.searchText = suggestion.displayLabel;
  }

  displayUser(suggestion: UserGroupSuggestion | string): string {
    if (!suggestion) return '';
    if (typeof suggestion === 'string') return suggestion;
    return suggestion.displayLabel;
  }

  create(andAddAnother: boolean): void {
    if (!this.selectedUser || this.saving()) return;
    this.addAnother = andAddAnother;
    this.saving.set(true);

    this.detailService
      .addPermissionWithNotification(this.data.documentUid, {
        username: this.selectedUser.id,
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
    this.searchText = '';
    this.selectedUser = null;
    this.permission = 'Read';
    this.timeFrame = 'permanent';
    this.beginDate = null;
    this.endDate = null;
    this.notifyComment = '';
    this.suggestions.set([]);
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
