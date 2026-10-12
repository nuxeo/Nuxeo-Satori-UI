import { Component, DestroyRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, NgModel } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';

import {
  NuxeoDocument,
  DirectoryEntry,
  L10nDirectoryEntry,
  CollectionService,
  DirectoryService,
  directoryPickerLabel,
  filterDirectoryPickerEntries,
  formatHierarchicalL10nLabel,
  groupL10nChildrenByParent,
  createExpiresErrorStateMatcher,
  isExpiresFieldValid,
  shouldShowExpiresFieldError,
  l10nEntryLabel,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '../datepicker-intl/translated-datepicker-intl';
import { NxsToastService, provideNxsToast } from '@nuxeo-satori/platform/components';

export interface EditCollectionDialogData {
  document: NuxeoDocument;
}

@Component({
  selector: 'lib-edit-collection-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatIconModule,
  ],
  providers: [provideNativeDateAdapter(), provideTranslatedDatepickerIntl(), provideNxsToast()],
  templateUrl: './edit-collection-dialog.html',
  styleUrl: './edit-collection-dialog.scss',
})
export class EditCollectionDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<EditCollectionDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<EditCollectionDialogData>(MAT_DIALOG_DATA);
  private readonly collectionService = inject(CollectionService);
  private readonly directoryService = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(NxsToastService);

  readonly l10nEntryLabel = l10nEntryLabel;
  protected readonly directoryPickerLabel = directoryPickerLabel;
  @ViewChild('expiresInput') expiresNgModel?: NgModel;
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
  readonly expiresErrorMatcher = createExpiresErrorStateMatcher(() =>
    shouldShowExpiresFieldError(this.expiresRawText, this.expires),
  );

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
        error: () => {
          this.toast.error(
            this.translate.instant('shared-ui.message.failed-to-load-vocabulary-options'),
          );
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

    this.collectionService
      .updateProperties(this.data.document.uid, properties)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedDoc) => {
          this.saving.set(false);
          this.dialogRef.close(updatedDoc);
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(
            isPermissionDeniedError(err)
              ? this.translate.instant(PERMISSION_DENIED_KEY)
              : this.translate.instant('shared-ui.message.failed-to-update-collection'),
          );
        },
      });
  }
}
