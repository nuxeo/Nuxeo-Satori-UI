import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { of } from 'rxjs';

// Import UI components from the published platform package
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

/**
 * Demonstrates all available UI components from `@nuxeo/satori-platform/ui`.
 *
 * This page serves as both documentation and a working example for customers
 * building their own Layer 2 extensions. Every component shown here is imported
 * from the published package and can be used directly in customer code.
 */
@Component({
  selector: 'app-components',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    WidgetContainerComponent,
    WidgetGridComponent,
    SelectionTopbarComponent,
  ],
  templateUrl: './components.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './components.scss',
})
export class ComponentsShowcaseComponent {
  private readonly dialog = inject(MatDialog);

  // Selection demo state
  protected readonly showSelection = signal(false);
  protected readonly mockSelectedItems = signal([
    { id: '1', name: 'Report_Q3_2025.pdf', preview: null },
    { id: '2', name: 'Analysis_Summary.xlsx', preview: null },
  ]);

  protected openConfirmDialog(): void {
    const data: ConfirmDialogData = {
      title: 'Delete Selected Items?',
      message: 'This will permanently delete 2 items. This action cannot be undone.',
      confirmLabel: 'Delete',
    };

    this.dialog.open(ConfirmDialogComponent, {
      data,
      width: '500px',
    });
  }

  protected openShareDialog(): void {
    const data: ShareDialogData = {
      title: 'Report_Q3_2025.pdf',
      url: 'https://example.com/nuxeo/ui/#/doc/report-q3-2025',
    };

    this.dialog.open(ShareDialogComponent, {
      data,
      width: '500px',
    });
  }

  protected openExportDialog(): void {
    const data: ExportDialogData = {
      documentUid: 'report-q3-2025',
      documentTitle: 'Report_Q3_2025.pdf',
      exportFn: (type, uid) => {
        console.log(`[template] Export ${uid} as ${type}`);
        return of(new Blob(['Mock export'], { type: 'application/octet-stream' }));
      },
    };

    this.dialog.open(ExportDialogComponent, {
      data,
      width: '400px',
    });
  }

  protected openSavedSearchDialog(): void {
    const data: SavedSearchDialogData = {
      title: 'Save This Search',
      placeholder: 'e.g., "Contracts awaiting signature"',
      initialValue: '',
    };

    this.dialog.open(SavedSearchDialogComponent, {
      data,
      width: '450px',
    });
  }

  protected toggleSelection(): void {
    this.showSelection.update((v) => !v);
  }

  protected clearSelection(): void {
    this.showSelection.set(false);
  }
}
