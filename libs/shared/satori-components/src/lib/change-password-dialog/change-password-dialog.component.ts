import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

/** What the change-password dialog needs from the page that opens it. */
export interface NxsChangePasswordDialogData {
  /** The account whose password changes. Shown so the administrator can see whose it is. */
  readonly username: string;
}

/**
 * Sets a user's password, as a `MatDialog`: `dialog.open(NxsChangePasswordDialogComponent, { data })`.
 *
 * The dialog does not write anything. It closes with the new password, trimmed, and the caller
 * sends it to the server. Set password stays disabled until the two fields match and are not blank, so a
 * typo cannot be submitted. Nothing here is a permission check: the server decides whether the
 * administrator may change the password.
 */
@Component({
  selector: 'nxs-change-password-dialog',
  standalone: true,
  templateUrl: './change-password-dialog.component.html',
  styleUrl: './change-password-dialog.component.scss',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-change-password-dialog' },
})
export class NxsChangePasswordDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsChangePasswordDialogComponent, string>>(MatDialogRef);
  protected readonly data = inject<NxsChangePasswordDialogData>(MAT_DIALOG_DATA);

  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly trimmedPassword = computed(() => this.password().trim());
  protected readonly matches = computed(
    () => this.trimmedPassword().length > 0 && this.trimmedPassword() === this.confirm().trim(),
  );
  protected readonly mismatch = computed(
    () => this.confirm().length > 0 && this.trimmedPassword() !== this.confirm().trim(),
  );

  protected save(): void {
    if (!this.matches()) return;
    this.dialogRef.close(this.trimmedPassword());
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
