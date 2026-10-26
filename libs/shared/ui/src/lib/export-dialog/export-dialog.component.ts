import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';

export interface ExportDialogData {
  documentUid: string;
  documentTitle: string;
  /** Callback that performs the actual download; returns an Observable<Blob>. */
  exportFn: (type: ExportType, uid: string) => import('rxjs').Observable<Blob>;
}

export type ExportType = 'thumbnail' | 'pdf' | 'zip' | 'xml';

interface ExportOption {
  type: ExportType;
  label: string;
  /** Translation key for `label`, preferred by the template when it resolves. */
  labelKey?: string;
  icon: string;
}

@Component({
  selector: 'lib-export-dialog',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './export-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
        min-width: 400px;
      }

      mat-dialog-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px 24px !important;
      }

      .export-option {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 14px 16px;
        border: none;
        background: none;
        cursor: pointer;
        border-radius: 6px;
        transition: background 0.15s;
        width: 100%;
        text-align: left;

        &:hover:not(:disabled) {
          background: var(--mat-sys-surface-container-low);
        }

        &:disabled {
          opacity: 0.6;
          cursor: default;
        }
      }

      .export-option-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: var(--mat-sys-on-surface-variant);
      }

      .export-option-label {
        font-size: 14px;
        color: var(--mat-sys-primary);
        font-weight: 500;
      }

      .export-spinner {
        margin-left: auto;
      }

      mat-dialog-actions {
        padding: 8px 24px 16px;
      }
    `,
  ],
})
export class ExportDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ExportDialogComponent>);
  private readonly data = inject<ExportDialogData>(MAT_DIALOG_DATA);

  readonly exporting = signal<ExportType | null>(null);

  readonly options: ExportOption[] = [
    { type: 'thumbnail', labelKey: 'rendition.thumbnail', label: 'Thumbnail', icon: 'image' },
    { type: 'pdf', labelKey: 'rendition.pdf', label: 'PDF', icon: 'picture_as_pdf' },
    { type: 'zip', labelKey: 'rendition.zip', label: 'ZIP Export', icon: 'folder_zip' },
    { type: 'xml', labelKey: 'rendition.xml', label: 'XML Export', icon: 'code' },
  ];

  onExport(type: ExportType): void {
    if (this.exporting()) return;
    this.exporting.set(type);

    const extMap: Record<ExportType, string> = {
      thumbnail: 'png',
      pdf: 'pdf',
      zip: 'zip',
      xml: 'xml',
    };
    const ext = extMap[type];
    const filename = `${this.data.documentTitle}.${ext}`;

    this.data.exportFn(type, this.data.documentUid).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting.set(null);
        this.dialogRef.close(true);
      },
      error: () => {
        this.exporting.set(null);
      },
    });
  }
}
