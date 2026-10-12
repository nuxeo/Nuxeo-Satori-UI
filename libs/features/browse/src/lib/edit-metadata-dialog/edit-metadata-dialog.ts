import { Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgModel } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

import {
  BrowseService,
  DirectoryService,
  DirectoryEntry,
  directoryPickerLabel,
  filterDirectoryPickerEntries,
  L10nDirectoryEntry,
  formatHierarchicalL10nLabel,
  groupL10nChildrenByParent,
  createExpiresErrorStateMatcher,
  isExpiresFieldValid,
  shouldShowExpiresFieldError,
  l10nEntryLabel,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface EditMetadataDialogData {
  uid: string;
  title: string;
  description: string;
  nature: string;
  subjects: string[];
  coverage: string;
  expires: string | null;
}

@Component({
  selector: 'lib-edit-metadata-dialog',
  standalone: true,
  providers: [provideTranslatedDatepickerIntl(), provideNxsToast()],
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatIconModule,
  ],
  templateUrl: './edit-metadata-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 480px;
      }
      mat-dialog-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 24px !important;
      }
      .full-width {
        width: 100%;
      }
      mat-dialog-actions {
        padding: 8px 24px 16px;
      }

      .expires-field-invalid {
        ::ng-deep .mdc-notched-outline__leading,
        ::ng-deep .mdc-notched-outline__notch,
        ::ng-deep .mdc-notched-outline__trailing {
          border-color: var(--mat-sys-error, #b3261e);
        }
      }

      ::ng-deep .mat-mdc-select-panel.vocab-select-panel {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        max-height: 320px;
        padding-top: 0;
      }

      ::ng-deep .mat-mdc-select-panel.vocab-select-panel .vocab-panel__search {
        flex: 0 0 auto;
        padding: 8px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      ::ng-deep .mat-mdc-select-panel.vocab-select-panel .vocab-panel__search input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font: inherit;
        font-size: 0.875rem;
      }

      ::ng-deep .mat-mdc-select-panel.vocab-select-panel .vocab-panel__list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }

      ::ng-deep .vocab-grouped-select-panel .mat-mdc-optgroup-label,
      ::ng-deep .vocab-grouped-select-panel .mat-mdc-optgroup .mdc-list-group__subheader {
        font-weight: 700;
        font-size: 0.8125rem;
        background: #fafafa;
        padding: 10px 16px 6px;
        border-bottom: 1px solid #f0f0f0;
      }

      ::ng-deep .vocab-field .mat-mdc-select-trigger {
        height: auto;
        min-height: 24px;
        overflow: visible;
      }

      .vocab-trigger-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        width: 100%;
        padding: 6px 8px 6px 12px;
        box-sizing: border-box;
      }

      ::ng-deep .vocab-trigger-chips .mdc-evolution-chip {
        margin: 2px 4px 2px 0;
      }
    `,
  ],
})
export class EditMetadataDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<EditMetadataDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<EditMetadataDialogData>(MAT_DIALOG_DATA);
  private readonly browseService = inject(BrowseService);
  private readonly directoryService = inject(DirectoryService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  title = this.data.title;
  description = this.data.description;
  nature = this.data.nature;
  subjects: string[] = [...this.data.subjects];
  coverage = this.data.coverage;
  expires: Date | null = this.data.expires ? new Date(this.data.expires) : null;
  expiresRawText = '';
  readonly expiresErrorMatcher = createExpiresErrorStateMatcher(() =>
    shouldShowExpiresFieldError(this.expiresRawText, this.expires),
  );

  @ViewChild('expiresInput') expiresNgModel?: NgModel;

  readonly saving = signal(false);
  readonly natureOptions = signal<DirectoryEntry[]>([]);
  readonly subjectOptions = signal<L10nDirectoryEntry[]>([]);
  readonly coverageOptions = signal<L10nDirectoryEntry[]>([]);

  readonly l10nEntryLabel = l10nEntryLabel;
  protected readonly directoryPickerLabel = directoryPickerLabel;
  naturePanelSearch = '';
  subjectsPanelSearch = '';
  coveragePanelSearch = '';

  filteredNatureOptions(): DirectoryEntry[] {
    return filterDirectoryPickerEntries(this.natureOptions(), this.naturePanelSearch);
  }

  groupedSubjectOptions(): ReturnType<typeof groupL10nChildrenByParent> {
    return groupL10nChildrenByParent(this.subjectOptions(), this.subjectsPanelSearch);
  }

  groupedCoverageOptions(): ReturnType<typeof groupL10nChildrenByParent> {
    return groupL10nChildrenByParent(this.coverageOptions(), this.coveragePanelSearch);
  }

  constructor() {
    this.directoryService
      .getEntries('nature')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.natureOptions.set(entries),
      });
    this.directoryService
      .getAllL10nEntries('l10nsubjects')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.subjectOptions.set(entries),
      });
    this.directoryService
      .getAllL10nEntries('l10ncoverage')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.coverageOptions.set(entries),
      });
  }

  onNaturePanelOpen(open: boolean): void {
    if (!open) {
      this.naturePanelSearch = '';
      return;
    }
    this.directoryService
      .getEntries('nature')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.natureOptions.set(entries),
      });
  }

  naturePillLabel(id: string): string {
    const entry = this.natureOptions().find((item) => item.id === id);
    return entry ? directoryPickerLabel(entry) : id;
  }

  subjectPillLabel(id: string): string {
    return formatHierarchicalL10nLabel(id, this.subjectOptions());
  }

  coveragePillLabel(id: string): string {
    return formatHierarchicalL10nLabel(id, this.coverageOptions());
  }

  clearNature(): void {
    this.nature = '';
  }

  clearCoverage(): void {
    this.coverage = '';
  }

  removeSubject(id: string): void {
    this.subjects = this.subjects.filter((value) => value !== id);
  }

  onSubjectsPanelOpen(open: boolean): void {
    if (!open) {
      this.subjectsPanelSearch = '';
      return;
    }
    this.loadL10nEntries('l10nsubjects', this.subjectOptions);
  }

  onCoveragePanelOpen(open: boolean): void {
    if (!open) {
      this.coveragePanelSearch = '';
      return;
    }
    this.loadL10nEntries('l10ncoverage', this.coverageOptions);
  }

  private loadL10nEntries(
    directoryName: string,
    target: { set: (entries: L10nDirectoryEntry[]) => void },
  ): void {
    this.directoryService
      .getAllL10nEntries(directoryName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => target.set(entries),
      });
  }

  isExpiresValid(): boolean {
    return isExpiresFieldValid(this.expiresRawText, this.expires);
  }

  showExpiresError(): boolean {
    return shouldShowExpiresFieldError(this.expiresRawText, this.expires);
  }

  onExpiresInput(event: Event): void {
    this.expiresRawText = (event.target as HTMLInputElement).value;
    const ctrl = this.expiresNgModel?.control;
    if (ctrl) {
      ctrl.markAsDirty();
      ctrl.markAsTouched();
      ctrl.updateValueAndValidity({ emitEvent: false });
    }
  }

  onExpiresChange(value: Date | null): void {
    this.expires = value;
    if (value && !Number.isNaN(value.getTime())) {
      this.expiresRawText = '';
    }
  }

  save(): void {
    if (this.saving() || !this.isExpiresValid()) return;
    this.saving.set(true);

    const properties: Record<string, unknown> = {
      'dc:title': this.title.trim(),
      'dc:description': this.description,
      'dc:nature': this.nature || null,
      'dc:subjects': this.subjects,
      'dc:coverage': this.coverage || null,
      'dc:expired':
        this.expires && !Number.isNaN(this.expires.getTime()) ? this.expires.toISOString() : null,
    };

    this.browseService
      .updateDocument(this.data.uid, properties)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          this.saving.set(false);
          this.toast.show(this.translate.instant('browse.message.document-updated'));
          this.dialogRef.close(doc);
        },
        error: () => {
          this.saving.set(false);
          this.toast.error(this.translate.instant('browse.message.failed-to-update-document'));
        },
      });
  }
}
