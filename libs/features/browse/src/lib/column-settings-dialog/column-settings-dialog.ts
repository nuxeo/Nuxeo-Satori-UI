import { Component, inject } from '@angular/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';

export interface ColumnDef {
  key: string;
  label: string;
  /** Translation key for `label`, carried from the descriptor so templates can prefer it. */
  labelKey?: string;
  visible: boolean;
}

/**
 * The packaged column set, kept only as the **fallback** for an injector where
 * Layer 1 registration has not run.
 *
 * `PACKAGED_BROWSE_COLUMNS` in `@nuxeo/satori-platform/extensions` is now the source
 * of truth, and `provide-app-extensions.ts` registers it into the `documentList`
 * slot. This list must mirror it. It survives because a component spec that
 * builds a bare `TestBed` has no `APP_INITIALIZER`, and resolving an empty slot
 * would render a document list with no columns — a silent regression far worse
 * than a stale duplicate. `packaged-columns.spec.ts` asserts the two agree, so
 * the duplication cannot drift unnoticed.
 */
export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'title', labelKey: 'browse.column.title', label: 'Title', visible: true },
  { key: 'type', labelKey: 'browse.column.type', label: 'Type', visible: false },
  { key: 'modified', labelKey: 'browse.column.modified', label: 'Modified', visible: true },
  {
    key: 'lastContributor',
    labelKey: 'browse.column.lastcontributor',
    label: 'Last Contributor',
    visible: true,
  },
  { key: 'state', labelKey: 'browse.column.state', label: 'State', visible: false },
  { key: 'version', labelKey: 'browse.column.version', label: 'Version', visible: false },
  { key: 'created', labelKey: 'browse.column.created', label: 'Created', visible: false },
  { key: 'author', labelKey: 'browse.column.author', label: 'Author', visible: false },
  { key: 'nature', labelKey: 'browse.column.nature', label: 'Nature', visible: false },
  { key: 'coverage', labelKey: 'browse.column.coverage', label: 'Coverage', visible: false },
  { key: 'subjects', labelKey: 'browse.column.subjects', label: 'Subjects', visible: false },
  { key: 'flags', labelKey: 'browse.column.flags', label: 'Flags', visible: false },
];

const STORAGE_KEY = 'browse_column_settings';

/**
 * The keys the user has switched on, or `null` when they have never chosen.
 *
 * `null` and `[]` are different: never-chosen means "use whatever the descriptors
 * default to", whereas an empty array means the user switched everything off.
 * Returning `[]` for both would silently override a manifest's `hiddenByDefault`
 * decisions with the packaged defaults on a fresh browser.
 */
export function loadColumnVisibility(): readonly string[] | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

export function loadColumnSettings(): ColumnDef[] {
  const keys = loadColumnVisibility();
  if (keys) return ALL_COLUMNS.map((col) => ({ ...col, visible: keys.includes(col.key) }));
  return ALL_COLUMNS.map((col) => ({ ...col }));
}

export function saveColumnSettings(columns: ColumnDef[]): void {
  const visibleKeys = columns.filter((c) => c.visible).map((c) => c.key);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleKeys));
}

@Component({
  selector: 'lib-column-settings-dialog',
  standalone: true,
  imports: [
    DescriptorLabelPipe,
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
  ],
  templateUrl: './column-settings-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 300px;
      }
      mat-dialog-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px 24px !important;
      }
      mat-dialog-actions {
        padding: 8px 24px 16px;
      }
    `,
  ],
})
export class ColumnSettingsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ColumnSettingsDialogComponent>);
  private readonly data = inject<ColumnDef[]>(MAT_DIALOG_DATA);

  columns: ColumnDef[] = this.data.map((c) => ({ ...c }));

  reset(): void {
    this.columns = ALL_COLUMNS.map((c) => ({ ...c }));
  }

  done(): void {
    saveColumnSettings(this.columns);
    this.dialogRef.close(this.columns);
  }
}
