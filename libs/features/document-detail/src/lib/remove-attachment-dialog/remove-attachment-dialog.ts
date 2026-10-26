import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'lib-remove-attachment-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule],
  templateUrl: './remove-attachment-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .remove-dialog {
        padding: 28px 32px;
        width: min(95vw, 340px);
        max-width: 95vw;
        box-sizing: border-box;
      }

      h2 {
        margin: 0 0 16px;
        font-size: 20px;
        font-weight: 600;
        color: #1a1a1a;
      }

      p {
        margin: 0 0 28px;
        font-size: 14px;
        color: #555;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-start;
        gap: 12px;
      }

      .btn-no {
        padding: 8px 24px;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        color: #3f51b5;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;

        &:hover {
          background: #f5f5f5;
        }
      }

      .btn-yes {
        padding: 8px 24px;
        border: none;
        border-radius: 4px;
        background: #3f51b5;
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;

        &:hover {
          background: #3949ab;
        }
      }
    `,
  ],
})
export class RemoveAttachmentDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RemoveAttachmentDialogComponent>);

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    this.dialogRef.close(true);
  }
}
