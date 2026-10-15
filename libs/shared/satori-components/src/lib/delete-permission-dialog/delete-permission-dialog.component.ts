import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import {
  DocumentDetailService,
  permissionRightLabel,
  resolveAcePrincipal,
  type NuxeoAce,
} from '@nuxeo-satori/platform/nuxeo-client';

import { failureKey, nxsAceTimeFrame, principalLabel } from '../permission-dialog-support';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';

/** What the delete-permission dialog needs from the page that opens it. */
export interface NxsDeletePermissionDialogData {
  /** The document the entry is on. */
  readonly documentUid: string;
  /** The entry to delete, as the `acls` enricher returned it. */
  readonly ace: NuxeoAce;
  /** The ACL holding the entry. `local` when absent. */
  readonly acl?: string;
}

/**
 * Confirms, then deletes, one permission entry, as a `MatDialog`:
 * `dialog.open(NxsDeletePermissionDialogComponent, { data, role: 'alertdialog' })`.
 *
 * It deletes the entry by its id, as Web UI does, so the user's other entries on the document stay.
 * It closes with `true` once Nuxeo has deleted it; a failure is reported and the dialog stays open.
 */
@Component({
  selector: 'nxs-delete-permission-dialog',
  standalone: true,
  templateUrl: './delete-permission-dialog.component.html',
  styleUrl: './delete-permission-dialog.component.scss',
  imports: [MatButton, MatDialogModule, MatIcon, TranslatePipe],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-delete-permission-dialog' },
})
export class NxsDeletePermissionDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsDeletePermissionDialogComponent, boolean>>(MatDialogRef);
  private readonly data = inject<NxsDeletePermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detail = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly deleting = signal(false);
  protected readonly principal = principalLabel(this.data.ace);
  protected readonly right = permissionRightLabel(this.data.ace.permission, (key) =>
    this.translate.instant(key),
  );
  protected readonly timeFrame = nxsAceTimeFrame(
    this.data.ace,
    (key, params) => this.translate.instant(key, params),
    this.locale,
  );
  protected readonly grantedBy = this.data.ace.creator
    ? resolveAcePrincipal(this.data.ace.creator)
    : '—';
  /** The entry's four fields, under the labels of the Permissions tab's columns. */
  protected readonly fields = [
    { label: 'satori-components.permission-dialogs.user-group', value: this.principal },
    { label: 'satori-components.permission-dialogs.right', value: this.right },
    { label: 'satori-components.permission-dialogs.time-frame', value: this.timeFrame },
    { label: 'satori-components.permission-dialogs.granted-by', value: this.grantedBy },
  ];
  /**
   * Below Material's small-screen breakpoint, where MatDialog narrows to the screen, the four
   * columns do not fit, so the entry shows as one label and value row per field instead.
   */
  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(Breakpoints.XSmall)
      .pipe(map((state) => state.matches)),
    { requireSync: true },
  );

  protected confirm(): void {
    if (this.deleting()) return;
    this.deleting.set(true);
    this.detail
      .removePermissionById(this.data.documentUid, this.data.ace.id, this.data.acl ?? 'local')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.dialogRef.close(true),
        error: (error: unknown) => {
          this.deleting.set(false);
          this.toast.error(
            this.translate.instant(
              failureKey(error, 'satori-components.permission-dialogs.error.delete'),
            ),
          );
        },
      });
  }
}
