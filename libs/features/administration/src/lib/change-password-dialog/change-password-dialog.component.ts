import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

export interface ChangePasswordDialogData {
  username: string;
}

@Component({
  selector: 'lib-change-password-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './change-password-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .pwd-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 320px;
        padding-top: 0.25rem;
      }
      .full {
        width: 100%;
      }
      .pwd-hint {
        margin: 0 0 0.25rem;
        font-size: 0.9rem;
        color: var(--mat-sys-on-surface-variant, rgba(0, 0, 0, 0.65));
      }
      .pwd-actions {
        gap: 0.5rem;
        padding: 0.75rem 1.5rem 1.25rem;
      }
    `,
  ],
})
export class ChangePasswordDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<ChangePasswordDialogComponent, string | undefined>,
  );
  readonly data = inject<ChangePasswordDialogData>(MAT_DIALOG_DATA);

  password = '';
  confirm = '';

  canSave(): boolean {
    const p = this.password.trim();
    return p.length > 0 && p === this.confirm.trim();
  }

  save(): void {
    if (!this.canSave()) return;
    this.dialogRef.close(this.password.trim());
  }
}
