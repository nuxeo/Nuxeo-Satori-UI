import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

/** What the confirm dialog says, already translated. */
export interface NxsConfirmDialogData {
  /** The heading, such as "Delete user". */
  readonly title: string;
  /** The question, such as `Delete user "jdoe"?`. */
  readonly message: string;
  /** The button that confirms, such as "Delete". */
  readonly confirmLabel: string;
}

/**
 * Asks the user to confirm an action that cannot be undone, as a `MatDialog`. It closes with `true`
 * when the user confirms and with nothing when they cancel, so `afterClosed()` tests for `true`.
 * The dialog does nothing else: the caller performs the action.
 */
@Component({
  selector: 'nxs-confirm-dialog',
  standalone: true,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  imports: [MatButtonModule, MatDialogModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-confirm-dialog' },
})
export class NxsConfirmDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<NxsConfirmDialogComponent, true>>(MatDialogRef);
  /** Cancel closes with nothing: undefined, so a caller checking for a result sees no confirmation. */
  protected readonly cancelResult = undefined;
  protected readonly data = inject<NxsConfirmDialogData>(MAT_DIALOG_DATA);

  protected confirm(): void {
    this.dialogRef.close(true);
  }
}
