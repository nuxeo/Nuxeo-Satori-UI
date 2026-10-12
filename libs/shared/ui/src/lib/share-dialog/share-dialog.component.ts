import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface ShareDialogData {
  title: string;
  url: string;
}

@Component({
  selector: 'lib-share-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule, MatButtonModule, MatIconModule],
  providers: [provideNxsToast()],
  templateUrl: './share-dialog.component.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 420px;
      }

      .share-subtitle {
        margin: 0 0 16px;
        font-size: 14px;
        color: #555;
      }

      .share-link-row {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 4px 4px 4px 12px;
        background: #fafafa;
      }

      .share-link-input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 13px;
        color: var(--mat-sys-on-surface);
        outline: none;
        min-width: 0;
        font-family: inherit;
      }

      .copy-btn {
        flex-shrink: 0;
        color: var(--mat-sys-primary);
      }

      mat-dialog-actions {
        padding: 8px 24px 16px;
      }
    `,
  ],
})
export class ShareDialogComponent {
  readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ShareDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);

  copyLink(): void {
    navigator.clipboard.writeText(this.data.url).then(
      () => this.toast.show(this.translate.instant('shared-ui.message.link-copied-to-clipboard')),
      () => this.toast.error(this.translate.instant('shared-ui.message.failed-to-copy-link')),
    );
  }
}
