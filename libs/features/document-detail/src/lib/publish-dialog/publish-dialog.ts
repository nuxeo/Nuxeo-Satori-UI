import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { NuxeoDocument, DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface PublishDialogData {
  documentUid: string;
  documentTitle: string;
  versionLabel: string;
  renditions: { name: string; label: string }[];
  versions: NuxeoDocument[];
}

interface FlatSection {
  uid: string;
  title: string;
  depth: number;
}

@Component({
  selector: 'lib-publish-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './publish-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .pub-dialog {
        display: flex;
        flex-direction: column;
        min-width: 540px;
      }

      .pub-header {
        text-align: center;
        font-size: 15px;
        font-weight: 400;
        color: #333;
        padding: 20px 24px 12px;
      }

      .pub-divider {
        height: 3px;
        background: #3f51b5;
        margin: 0 0 20px;
      }

      .pub-body {
        padding: 0 24px;
      }

      .pub-loading {
        display: flex;
        justify-content: center;
        padding: 32px 0;
      }

      /* Location field */
      .field-group {
        margin-bottom: 20px;
      }

      .field-label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: #555;
        margin-bottom: 4px;
      }

      .required {
        color: #d32f2f;
      }

      .select-wrapper {
        position: relative;
      }

      .native-select {
        width: 100%;
        padding: 10px 32px 10px 0;
        border: none;
        border-bottom: 1px solid #ccc;
        background: transparent;
        font-size: 14px;
        color: #333;
        appearance: none;
        outline: none;
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%23666' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 4px center;

        &:focus {
          border-bottom-color: #3f51b5;
          border-bottom-width: 2px;
        }
      }

      /* Options row */
      .options-row {
        display: flex;
        align-items: center;
        gap: 20px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }

      .checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: #333;
        cursor: pointer;
        white-space: nowrap;

        input[type='checkbox'] {
          width: 16px;
          height: 16px;
          accent-color: #3f51b5;
          cursor: pointer;
        }
      }

      .inline-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .inline-label {
        font-size: 13px;
        font-weight: 500;
        color: #555;
        white-space: nowrap;
      }

      .inline-select {
        padding: 4px 20px 4px 6px;
        border: 1px solid #ccc;
        border-radius: 3px;
        background: #fff;
        font-size: 13px;
        color: #333;
        appearance: none;
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24'%3E%3Cpath fill='%23666' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 4px center;
      }

      .version-select {
        width: 65px;
      }
      .rendition-select {
        width: 160px;
      }

      /* Actions */
      .pub-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px 20px;
      }

      .btn {
        padding: 8px 24px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid #ccc;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-cancel {
        background: #fff;
        color: #333;

        &:hover {
          background: #f5f5f5;
        }
      }

      .btn-publish {
        background: #3f51b5;
        color: #fff;
        border-color: #3f51b5;

        &:hover {
          background: #3949ab;
        }

        &:disabled {
          background: #e0e0e0;
          color: #999;
          border-color: #e0e0e0;
          cursor: default;
        }
      }
    `,
  ],
})
export class PublishDialogComponent implements OnInit {
  readonly data = inject<PublishDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PublishDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly snackBar = inject(MatSnackBar);

  readonly flatSections = signal<FlatSection[]>([]);
  readonly sectionsLoading = signal(true);
  readonly publishing = signal(false);

  selectedSectionId = '';
  selectedVersion = '';
  showRenditions = false;
  selectedRendition = '';
  overrideExisting = false;

  ngOnInit(): void {
    this.selectedVersion = this.data.versionLabel;

    this.detailService.getSectionTree().subscribe({
      next: (res) => {
        this.flatSections.set(this.flattenSections(res.entries));
        this.sectionsLoading.set(false);
      },
      error: () => this.sectionsLoading.set(false),
    });
  }

  private flattenSections(docs: NuxeoDocument[]): FlatSection[] {
    const pathMap = new Map<string, NuxeoDocument>();
    for (const doc of docs) pathMap.set(doc.path, doc);

    const childrenMap = new Map<string, NuxeoDocument[]>();
    const roots: NuxeoDocument[] = [];

    for (const doc of docs) {
      const parentPath = doc.path.split('/').slice(0, -1).join('/');
      if (pathMap.has(parentPath)) {
        const siblings = childrenMap.get(parentPath) ?? [];
        siblings.push(doc);
        childrenMap.set(parentPath, siblings);
      } else {
        roots.push(doc);
      }
    }

    const result: FlatSection[] = [];
    const walk = (nodes: NuxeoDocument[], depth: number) => {
      for (const doc of nodes) {
        result.push({ uid: doc.uid, title: doc.title, depth });
        const children = childrenMap.get(doc.path) ?? [];
        if (children.length > 0) walk(children, depth + 1);
      }
    };
    walk(roots, 0);
    return result;
  }

  sectionIndent(depth: number): string {
    return '\u00A0\u00A0'.repeat(depth);
  }

  versionStr(doc: NuxeoDocument): string {
    const major = Number(doc.properties['uid:major_version'] ?? 0);
    const minor = Number(doc.properties['uid:minor_version'] ?? 0);
    return `${major}.${minor}`;
  }

  close(): void {
    this.dialogRef.close();
  }

  publish(): void {
    if (!this.selectedSectionId || this.publishing()) return;
    this.publishing.set(true);

    const renditionName =
      this.showRenditions && this.selectedRendition && this.selectedRendition !== '__default__'
        ? this.selectedRendition
        : undefined;
    const defaultRendition = this.showRenditions && this.selectedRendition === '__default__';

    this.detailService
      .publishDocument(this.data.documentUid, this.selectedSectionId, {
        override: this.overrideExisting,
        renditionName,
        defaultRendition,
      })
      .subscribe({
        next: () => {
          this.publishing.set(false);
          this.snackBar.open(
            `"${this.data.documentTitle}" published successfully`,
            this.translate.instant('common.ok'),
            {
              duration: 3000,
            },
          );
          this.dialogRef.close(true);
        },
        error: () => {
          this.publishing.set(false);
          this.snackBar.open(
            this.translate.instant('document-detail.message.failed-to-publish-document'),
            this.translate.instant('common.ok'),
            { duration: 3000 },
          );
        },
      });
  }
}
