import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NuxeoAce, DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

export interface DeletePermissionDialogData {
  documentUid: string;
  ace: NuxeoAce;
  permissionLabel: string;
  timeFrameLabel: string;
}

@Component({
  selector: 'lib-delete-permission-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './delete-permission-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 460px;
      }

      .confirm-table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #e0e0e0;
        border-radius: 4px;

        th {
          text-align: left;
          padding: 10px 16px;
          font-size: 12px;
          font-weight: 600;
          color: #333;
          background: #fafafa;
          border-bottom: 1px solid #e0e0e0;
        }

        td {
          padding: 12px 16px;
          font-size: 13px;
          color: #333;
        }
      }

      mat-dialog-actions {
        display: flex;
        gap: 8px;
        padding: 12px 24px 16px;
      }

      .spacer {
        flex: 1;
      }
    `,
  ],
})
export class DeletePermissionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DeletePermissionDialogComponent>);
  readonly data = inject<DeletePermissionDialogData>(MAT_DIALOG_DATA);
  private readonly detailService = inject(DocumentDetailService);

  readonly deleting = signal(false);

  confirmDelete(): void {
    if (this.deleting()) return;
    this.deleting.set(true);

    this.detailService
      .removePermission(this.data.documentUid, {
        user: this.data.ace.username,
        permission: this.data.ace.permission,
        acl: 'local',
      })
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.dialogRef.close(true);
        },
        error: () => {
          this.deleting.set(false);
        },
      });
  }
}
