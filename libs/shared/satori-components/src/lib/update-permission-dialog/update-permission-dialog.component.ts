import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { DateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionRightLabel,
  permissionUpdateMailFailureMessage,
  type NuxeoAce,
} from '@nuxeo/satori-platform/nuxeo-client';

import { nxsDateFromAdapter, nxsDateToAdapter } from '../date-input/adapter-date';
import { provideNxsDateAdapter } from '../date-input/locale-date';
import { failureKey, nxsOfferedRights, principalLabel } from '../permission-dialog-support';
import { dateToWrite, dayToDate, toDay } from '../permissions-panel/permissions-model';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';

/** What the update-permission dialog needs from the page that opens it. */
export interface NxsUpdatePermissionDialogData {
  /** The document the entry is on. */
  readonly documentUid: string;
  /** The entry to change, as the `acls` enricher returned it. */
  readonly ace: NuxeoAce;
  /**
   * The document type's `userVisiblePermissions`, the rights the dialog offers, plus the entry's
   * own. Nuxeo's default three (Read, ReadWrite, Everything) when absent.
   */
  readonly permissions?: readonly string[] | null;
}

let nextId = 0;

/**
 * Changes one permission entry's right, time frame or both, as a `MatDialog`:
 * `dialog.open(NxsUpdatePermissionDialogComponent, { data })`.
 *
 * It replaces the entry in one call, as Web UI does, so a failure leaves the entry as it was. An
 * external user's share keeps its required end date and always emails the person again. A date the
 * user did not change is written back as the instant Nuxeo holds, so editing the right alone never
 * moves an entry written from another time zone. It closes with `true` once Nuxeo has saved it.
 */
@Component({
  selector: 'nxs-update-permission-dialog',
  standalone: true,
  templateUrl: './update-permission-dialog.component.html',
  styleUrl: './update-permission-dialog.component.scss',
  imports: [
    MatButton,
    MatCheckbox,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioButton,
    MatRadioGroup,
    MatSelectModule,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  providers: [provideNxsDateAdapter(), provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-update-permission-dialog' },
})
export class NxsUpdatePermissionDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsUpdatePermissionDialogComponent, boolean>>(MatDialogRef);
  private readonly data = inject<NxsUpdatePermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detail = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);
  /** The date fields' adapter, from `provideNxsDateAdapter()`: a host's may not hold JS dates. */
  private readonly dateAdapter = inject<DateAdapter<unknown>>(DateAdapter);

  private readonly ace = this.data.ace;
  protected readonly id = `nxs-update-permission-dialog-${nextId++}`;
  protected readonly external = this.ace.externalUser;
  protected readonly principal = principalLabel(this.ace);
  protected readonly rights = nxsOfferedRights(this.data.permissions, this.ace.permission);
  protected readonly mailHint = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;

  protected readonly right = signal(this.ace.permission);
  protected readonly dated = signal(this.external || !!this.ace.begin || !!this.ace.end);
  /** The entry's days, at local midnight. */
  protected readonly begin = signal<Date | null>(dayToDate(this.ace.begin));
  protected readonly end = signal<Date | null>(dayToDate(this.ace.end));
  /** The same days as the date fields hold them, in their adapter's own representation. */
  protected readonly beginField = computed(() => nxsDateToAdapter(this.dateAdapter, this.begin()));
  protected readonly endField = computed(() => nxsDateToAdapter(this.dateAdapter, this.end()));
  protected readonly notify = signal(this.external);
  protected readonly comment = signal('');
  protected readonly saving = signal(false);

  protected readonly endBeforeBegin = computed(() => {
    if (!this.dated()) return false;
    const begin = toDay(this.begin());
    const end = toDay(this.end());
    return !!begin && !!end && end < begin;
  });
  protected readonly valid = computed(
    () => !this.endBeforeBegin() && (!this.external || !!this.end()),
  );

  protected label(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  /** The day a date field holds, whatever its adapter holds dates as. */
  protected fieldDay(value: unknown): Date | null {
    return nxsDateFromAdapter(this.dateAdapter, value);
  }

  protected update(): void {
    if (!this.valid() || this.saving()) return;
    this.saving.set(true);
    const notify = this.notify();
    this.detail
      .replacePermissionWithNotification(this.data.documentUid, {
        id: this.ace.id,
        username: this.ace.username,
        permission: this.right(),
        begin: this.dated() ? dateToWrite(toDay(this.begin()), this.ace.begin) : null,
        end: this.dated() ? dateToWrite(toDay(this.end()), this.ace.end) : null,
        notify,
        comment: notify ? this.comment().trim() || null : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.toast.show(
            this.translate.instant(
              result.notificationErrorKey ??
                (result.notificationSent
                  ? 'satori-components.permission-dialogs.update.updated-notified'
                  : 'satori-components.permission-dialogs.update.updated'),
            ),
            { duration: 7000 },
          );
          this.dialogRef.close(true);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(
            isMailSendError(error)
              ? permissionUpdateMailFailureMessage((key) => this.translate.instant(key))
              : this.translate.instant(
                  failureKey(error, 'satori-components.permission-dialogs.error.update'),
                ),
            { duration: 7000 },
          );
        },
      });
  }
}
