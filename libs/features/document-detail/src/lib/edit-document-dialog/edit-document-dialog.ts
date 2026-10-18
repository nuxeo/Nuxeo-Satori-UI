import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { Component, DestroyRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgModel } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';

import {
  BrowseService,
  DirectoryEntry,
  DirectoryService,
  directoryPickerLabel,
  filterDirectoryPickerEntries,
  L10nDirectoryEntry,
  NuxeoDocument,
  formatHierarchicalL10nLabel,
  groupL10nChildrenByParent,
  createExpiresErrorStateMatcher,
  isExpiresFieldValid,
  l10nEntryLabel,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DateMaskPipe,
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo-satori/platform/ui';

export interface EditDocumentDialogData {
  document: NuxeoDocument;
}

@Component({
  selector: 'lib-edit-document-dialog',
  standalone: true,
  imports: [
    DateMaskPipe,
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatIconModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideSatoriDateAdapter()],
  templateUrl: './edit-document-dialog.html',
  styles: [
    `
      :host {
        display: block;
        min-width: 480px;
      }

      mat-dialog-content {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding-top: 12px !important;
      }

      .full-width {
        width: 100%;
      }

      mat-dialog-actions {
        display: flex;
        padding: 8px 24px 16px;
      }

      .spacer {
        flex: 1;
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
export class EditDocumentDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<EditDocumentDialogComponent>);
  private readonly data = inject<EditDocumentDialogData>(MAT_DIALOG_DATA);
  private readonly browseService = inject(BrowseService);
  private readonly directoryService = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dateAdapter = inject<DateAdapter<Date>>(DateAdapter);
  private readonly dateFormats = inject(MAT_DATE_FORMATS);

  @ViewChild('expiresInput') expiresNgModel?: NgModel;

  readonly l10nEntryLabel = l10nEntryLabel;
  protected readonly directoryPickerLabel = directoryPickerLabel;
  readonly natureEntries = signal<DirectoryEntry[]>([]);
  readonly subjectEntries = signal<L10nDirectoryEntry[]>([]);
  readonly coverageEntries = signal<L10nDirectoryEntry[]>([]);
  readonly saving = signal(false);

  naturePanelSearch = '';
  subjectsPanelSearch = '';
  coveragePanelSearch = '';

  filteredNatureOptions(): DirectoryEntry[] {
    return filterDirectoryPickerEntries(this.natureEntries(), this.naturePanelSearch);
  }

  groupedSubjectOptions(): ReturnType<typeof groupL10nChildrenByParent> {
    return groupL10nChildrenByParent(this.subjectEntries(), this.subjectsPanelSearch);
  }

  groupedCoverageOptions(): ReturnType<typeof groupL10nChildrenByParent> {
    return groupL10nChildrenByParent(this.coverageEntries(), this.coveragePanelSearch);
  }

  title = '';
  description = '';
  nature: string | null = null;
  subjects: string[] = [];
  coverage: string | null = null;
  expires: Date | null = null;
  expiresRawText = '';
  readonly expiresErrorMatcher = createExpiresErrorStateMatcher(() => this.showExpiresError());

  ngOnInit(): void {
    const doc = this.data.document;
    const props = doc.properties ?? {};

    this.title = (props['dc:title'] as string) ?? doc.title ?? '';
    this.description = (props['dc:description'] as string) ?? '';
    this.nature = (props['dc:nature'] as string) ?? null;
    this.subjects = (props['dc:subjects'] as string[]) ?? [];
    this.coverage = (props['dc:coverage'] as string) ?? null;
    const rawExpires = props['dc:expired'] as string | null;
    this.expires = rawExpires ? new Date(rawExpires) : null;

    forkJoin({
      nature: this.directoryService.getEntries('nature'),
      subjects: this.directoryService.getAllL10nEntries('l10nsubjects'),
      coverage: this.directoryService.getAllL10nEntries('l10ncoverage'),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ nature, subjects, coverage }) => {
          this.natureEntries.set(nature);
          this.subjectEntries.set(subjects);
          this.coverageEntries.set(coverage);
        },
      });
  }

  onNaturePanelOpen(open: boolean): void {
    if (!open) {
      this.naturePanelSearch = '';
      return;
    }
    this.loadNatureEntries();
  }

  private loadNatureEntries(): void {
    this.directoryService
      .getEntries('nature')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.natureEntries.set(entries),
      });
  }

  naturePillLabel(id: string): string {
    const entry = this.natureEntries().find((item) => item.id === id);
    return entry ? directoryPickerLabel(entry) : id;
  }

  subjectPillLabel(id: string): string {
    return formatHierarchicalL10nLabel(id, this.subjectEntries());
  }

  coveragePillLabel(id: string): string {
    return formatHierarchicalL10nLabel(id, this.coverageEntries());
  }

  clearNature(): void {
    this.nature = null;
  }

  clearCoverage(): void {
    this.coverage = null;
  }

  removeSubject(id: string): void {
    this.subjects = this.subjects.filter((value) => value !== id);
  }

  onSubjectsPanelOpen(open: boolean): void {
    if (!open) {
      this.subjectsPanelSearch = '';
      return;
    }
    this.loadL10nEntries('l10nsubjects', this.subjectEntries);
  }

  onCoveragePanelOpen(open: boolean): void {
    if (!open) {
      this.coveragePanelSearch = '';
      return;
    }
    this.loadL10nEntries('l10ncoverage', this.coverageEntries);
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
    const parsed = this.expiresRawText.trim()
      ? this.dateAdapter.parse(this.expiresRawText, this.dateFormats.parse.dateInput)
      : this.expires;
    return isExpiresFieldValid(this.expiresRawText, parsed);
  }

  showExpiresError(): boolean {
    return !this.isExpiresValid();
  }

  onExpiresInput(event: Event): void {
    this.expiresRawText = (event.target as HTMLInputElement).value;
    // Parse synchronously so validation and the saved payload agree even before ngModel updates.
    const parsed = this.dateAdapter.getValidDateOrNull(
      this.dateAdapter.parse(this.expiresRawText.trim(), this.dateFormats.parse.dateInput),
    );
    // The datepicker already holds null or this instant; another value makes [ngModel] rewrite the text.
    if (parsed?.getTime() !== this.expires?.getTime()) this.expires = parsed;
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
    if (!this.title.trim() || this.saving() || !this.isExpiresValid()) return;
    this.saving.set(true);

    const properties: Record<string, unknown> = {
      'dc:title': this.title.trim(),
      'dc:description': this.description.trim() || null,
      'dc:nature': this.nature || null,
      'dc:subjects': this.subjects,
      'dc:coverage': this.coverage || null,
      'dc:expired':
        this.expires && !Number.isNaN(this.expires.getTime()) ? this.expires.toISOString() : null,
    };

    this.browseService
      .updateDocument(this.data.document.uid, properties)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedDoc) => {
          this.saving.set(false);
          this.dialogRef.close(updatedDoc);
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }
}
