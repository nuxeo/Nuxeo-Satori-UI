import { Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogConfig,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

export interface SavedSearchDialogData {
  title?: string;
  placeholder?: string;
  initialValue?: string;
}

export const SAVED_SEARCH_DIALOG_OPTIONS: Partial<MatDialogConfig> = {
  autoFocus: true,
};

@Component({
  selector: 'lib-saved-search-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule, MatButtonModule],
  templateUrl: './saved-search-dialog.component.html',
  styles: [
    `
      :host {
        display: block;
        width: min(95vw, clamp(320px, 50vw, 520px));
        max-width: 95vw;
      }

      mat-dialog-content {
        padding: 8px clamp(12px, 4vw, 24px) 16px !important;
        overflow: visible !important;
      }

      .saved-search-input {
        display: block;
        width: 100%;
        min-width: 0;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        padding: 10px 12px;
        font: inherit;
        color: #101828;
        outline: none;
        box-sizing: border-box;

        &:focus {
          border-color: #5c6bc0;
        }
      }

      .saved-search-error {
        margin: 6px 0 0;
        color: var(--mat-sys-error, currentColor);
        font: var(--mat-sys-body-small, inherit);
      }

      mat-dialog-actions {
        padding: 16px 24px 20px;
        flex-wrap: wrap;
        row-gap: 8px;
      }
    `,
  ],
})
export class SavedSearchDialogComponent {
  readonly dialogRef = inject(MatDialogRef<SavedSearchDialogComponent, string | undefined>);
  readonly data = inject<SavedSearchDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {};
  readonly name = signal(this.data.initialValue ?? '');

  /**
   * A saved search is a document named after its title, and a document name cannot hold a `/` —
   * the server answers 400. Web UI's save dialog says so the same way (`searchForm.savePopup.error`).
   */
  readonly hasSlash = () => this.name().includes('/');
  readonly canSave = () => this.name().trim().length > 0 && !this.hasSlash();

  onInput(value: string): void {
    this.name.set(value);
  }

  save(): void {
    if (!this.canSave()) return;
    this.dialogRef.close(this.name().trim());
  }
}
