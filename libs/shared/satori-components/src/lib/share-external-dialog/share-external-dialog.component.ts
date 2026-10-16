import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, merge } from 'rxjs';
import { MatButton } from '@angular/material/button';
import { type ErrorStateMatcher } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput, MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  isMailSendError,
  permissionCreateMailFailureMessage,
  permissionRightLabel,
} from '@nuxeo/satori-platform/nuxeo-client';

import { provideNxsDateAdapter } from '../date-input/locale-date';
import { failureKey, offeredRights } from '../permission-dialog-support';
import { toDay } from '../permissions-panel/permissions-model';
import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';

/** What the share-with-external-user dialog needs from the page that opens it. */
export interface NxsShareExternalDialogData {
  /** The document to share. */
  readonly documentUid: string;
  /**
   * The document type's `userVisiblePermissions`, the rights the dialog offers. Nuxeo's default
   * three (Read, ReadWrite, Everything) when absent.
   */
  readonly permissions?: readonly string[] | null;
}

/**
 * A local part, then dot-separated domain labels that hold no dot. A domain splits into labels
 * only one way, so a failed match ends in linear time.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Shares a document with someone outside the organisation, as a `MatDialog`:
 * `dialog.open(NxsShareExternalDialogComponent, { data })`.
 *
 * As in Web UI, the share needs an end date and always emails the person a link; Nuxeo creates no
 * account for them. **Create and add another** keeps the dialog open for the next person. The
 * dialog closes with `true` when it shared the document with anyone, `false` otherwise.
 */
@Component({
  selector: 'nxs-share-external-dialog',
  standalone: true,
  templateUrl: './share-external-dialog.component.html',
  styleUrl: './share-external-dialog.component.scss',
  imports: [
    MatButton,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  providers: [provideNxsDateAdapter(), provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-share-external-dialog' },
})
export class NxsShareExternalDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsShareExternalDialogComponent, boolean>>(MatDialogRef);
  private readonly data = inject<NxsShareExternalDialogData>(MAT_DIALOG_DATA);
  private readonly detail = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rights = offeredRights(this.data.permissions);
  protected readonly mailHint = PERMISSION_NOTIFICATION_MAIL_HINT_KEY;

  protected readonly email = signal('');
  protected readonly emailLeft = signal(false);
  protected readonly right = signal(this.rights[0]);
  protected readonly begin = signal<Date | null>(null);
  protected readonly end = signal<Date | null>(null);
  protected readonly comment = signal('');
  /** Which button is saving, so only that one shows the spinner. */
  protected readonly saving = signal<'create' | 'another' | null>(null);
  private shared = false;

  protected readonly emailValid = computed(() => EMAIL.test(this.email().trim()));
  /**
   * Puts the email box in Material's error state once the user has left it invalid, so the input
   * sets `aria-invalid` and points `aria-describedby` at the `mat-error` itself.
   */
  protected readonly emailError: ErrorStateMatcher = {
    isErrorState: () => this.emailLeft() && !this.emailValid(),
  };
  private readonly emailBox = viewChild.required('emailBox', { read: MatInput });
  protected readonly endBeforeBegin = computed(() => {
    const begin = toDay(this.begin());
    const end = toDay(this.end());
    return !!begin && !!end && end < begin;
  });
  protected readonly valid = computed(
    () => this.emailValid() && !!this.end() && !this.endBeforeBegin(),
  );

  constructor() {
    // MatInput consults its matcher only for a form control's input; this one has none.
    effect(() => {
      this.emailError.isErrorState(null, null);
      this.emailBox().updateErrorState();
    });
    // Escape and the backdrop must report a share made with "Create and add another" too.
    this.dialogRef.disableClose = true;
    merge(
      this.dialogRef.backdropClick(),
      this.dialogRef.keydownEvents().pipe(filter((event) => event.key === 'Escape')),
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (!this.saving()) this.cancel();
      });
  }

  protected label(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  protected cancel(): void {
    this.dialogRef.close(this.shared);
  }

  protected create(another: boolean): void {
    if (!this.valid() || this.saving()) return;
    this.saving.set(another ? 'another' : 'create');
    const email = this.email().trim();
    this.detail
      .addExternalPermissionWithNotification(this.data.documentUid, {
        email,
        permission: this.right(),
        begin: toDay(this.begin()),
        end: toDay(this.end()),
        notify: true,
        comment: this.comment().trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(null);
          this.shared = true;
          this.toast.show(
            this.translate.instant(
              result.notificationErrorKey ?? 'satori-components.permission-dialogs.share.shared',
              { email },
            ),
            { duration: 7000 },
          );
          if (another) {
            this.reset();
          } else {
            this.dialogRef.close(true);
          }
        },
        error: (error: unknown) => {
          this.saving.set(null);
          this.toast.error(
            isMailSendError(error)
              ? permissionCreateMailFailureMessage((key) => this.translate.instant(key))
              : this.translate.instant(
                  failureKey(error, 'satori-components.permission-dialogs.error.share'),
                ),
            { duration: 7000 },
          );
        },
      });
  }

  private reset(): void {
    this.email.set('');
    this.emailLeft.set(false);
    this.right.set(this.rights[0]);
    this.begin.set(null);
    this.end.set(null);
    this.comment.set('');
  }
}
