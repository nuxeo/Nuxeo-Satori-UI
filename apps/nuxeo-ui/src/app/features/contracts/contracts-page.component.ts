import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { of } from 'rxjs';

// Import from @nuxeo/satori-platform/ui - what customers have access to
import {
  WidgetContainerComponent,
  WidgetGridComponent,
  ConfirmDialogComponent,
  ShareDialogComponent,
  ExportDialogComponent,
  SavedSearchDialogComponent,
  SelectionTopbarComponent,
  type ConfirmDialogData,
  type ShareDialogData,
  type ExportDialogData,
  type SavedSearchDialogData,
} from '@nuxeo/satori-platform/ui';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-contracts-page',
  standalone: true,
  imports: [
    TranslatePipe,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    SAT_BANNER_IMPORTS,
    WidgetContainerComponent,
    WidgetGridComponent,
    SelectionTopbarComponent,
  ],
  templateUrl: './contracts-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './contracts-page.component.scss',
})
export class ContractsPageComponent {
  private dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  // Selection topbar demo state
  readonly showSelection = signal(false);
  readonly mockSelectedItems = signal([
    { id: '1', name: 'Contract ABC-123.pdf', preview: null },
    { id: '2', name: 'Contract XYZ-789.pdf', preview: null },
    { id: '3', name: 'Contract DEF-456.pdf', preview: null },
  ]);

  openConfirmDialog() {
    const data: ConfirmDialogData = {
      title: this.translate.instant('contracts.showcase-dialog-title'),
      message: this.translate.instant('contracts.showcase-dialog-message'),
      confirmLabel: this.translate.instant('confirm.got-it'),
    };

    this.dialog.open(ConfirmDialogComponent, {
      data,
      width: '500px',
    });
  }

  openShareDialog() {
    const data: ShareDialogData = {
      title: this.translate.instant('contracts.sample-document-title'),
      url: 'https://example.com/nuxeo/ui/#/doc/contract-abc-123',
    };

    this.dialog.open(ShareDialogComponent, {
      data,
      width: '500px',
    });
  }

  openExportDialog() {
    const data: ExportDialogData = {
      documentUid: 'contract-abc-123',
      documentTitle: 'Contract ABC-123.pdf',
      exportFn: (type, uid) => {
        // Mock export function - returns a fake blob
        console.log(`Exporting ${uid} as ${type}`);
        return of(new Blob(['Mock export data'], { type: 'application/octet-stream' }));
      },
    };

    this.dialog.open(ExportDialogComponent, {
      data,
      width: '400px',
    });
  }

  openSavedSearchDialog() {
    const data: SavedSearchDialogData = {
      title: this.translate.instant('ui.save-current-search'),
      placeholder: this.translate.instant('contracts.saved-search-placeholder'),
      initialValue: '',
    };

    this.dialog.open(SavedSearchDialogComponent, {
      data,
      width: '450px',
    });
  }

  toggleSelection() {
    this.showSelection.update((v) => !v);
  }

  clearSelection() {
    this.showSelection.set(false);
  }
}
