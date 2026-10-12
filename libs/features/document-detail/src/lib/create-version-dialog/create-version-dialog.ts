import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import {
  DocumentDetailService,
  isPermissionDeniedError,
  PERMISSION_DENIED_KEY,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface CreateVersionDialogData {
  documentUid: string;
  documentTitle: string;
  currentMajor: number;
  currentMinor: number;
}

@Component({
  selector: 'lib-create-version-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    FormsModule,
  ],
  providers: [provideNxsToast()],
  templateUrl: './create-version-dialog.html',
  styles: [
    `
      h2[mat-dialog-title] {
        font-size: 20px;
        font-weight: 500;
        line-height: 1.4;
        margin: 0;
        padding: 24px 24px 0;
        word-break: break-word;
      }

      :host {
        display: block;
        width: 100%;
        max-width: 100%;
      }

      mat-dialog-content {
        overflow: visible;
        max-height: none;
        padding: 16px 24px !important;
      }

      .version-options {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .version-option {
        display: flex;
        align-items: center;
        min-height: 48px;
      }

      .version-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 40px;
        padding: 4px 10px;
        border-radius: 4px;
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        font-size: 14px;
        font-weight: 600;
        margin-right: 12px;
      }

      mat-dialog-actions {
        display: flex;
        align-items: center;
        padding: 8px 24px 24px;
        gap: 12px;
        margin: 0;
        min-height: auto;
      }

      .spacer {
        flex: 1;
      }
    `,
  ],
})
export class CreateVersionDialogComponent {
  readonly data = inject<CreateVersionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CreateVersionDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  increment: 'Major' | 'Minor' = 'Major';
  readonly saving = signal(false);

  create(): void {
    if (this.saving()) return;
    this.saving.set(true);

    this.detailService
      .createVersion(this.data.documentUid, this.increment)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          this.saving.set(false);
          const label =
            this.increment === 'Major'
              ? `${this.data.currentMajor + 1}.0`
              : `${this.data.currentMajor}.${this.data.currentMinor + 1}`;
          this.toast.show(
            this.translate.instant('document-detail.create-version-dialog.created', {
              version: label,
            }),
          );
          this.dialogRef.close(doc);
        },
        error: (err) => {
          this.saving.set(false);
          const message = isPermissionDeniedError(err)
            ? this.translate.instant(PERMISSION_DENIED_KEY)
            : this.translate.instant('document-detail.message.failed-to-create-version');
          this.toast.error(message);
        },
      });
  }
}
