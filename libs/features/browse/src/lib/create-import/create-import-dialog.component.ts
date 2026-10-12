import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule, NgModel } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';

import {
  BrowseService,
  DirectoryService,
  DocumentImportService,
  RESTRICTED_IMPORT_LOCATION_MESSAGE_KEY,
  DOMAIN_CONTAINER_GUIDANCE_KEY,
  defaultNoteContent,
  BLOB_NOT_ATTACHED_ERROR,
  docTypeLabel,
  directoryPickerLabel,
  filterDirectoryPickerEntries,
  isBlobHoldingDocType,
  isDomainParentType,
  isFolderishDocument,
  isRepositoryRootPath,
  isRestrictedImportParentPath,
  resolveCreatableSubtypes,
  resolveImportBlobDocType,
  titleFromFileName,
  type ImportFileEntry,
  NOTE_FORMAT_OPTIONS,
  sanitizeDocumentName,
  summarizeCsvImportReport,
  type DirectoryEntry,
  type ImportProgress,
  type L10nDirectoryEntry,
  type NuxeoDocument,
  formatHierarchicalL10nLabel,
  createExpiresErrorStateMatcher,
  isExpiresFieldValid,
  shouldShowExpiresFieldError,
  documentNavigationUrl,
  isCollectionDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';
import {
  NxsDocTypeIconComponent,
  NxsSpinnerComponent,
  NxsToastService,
  provideNxsToast,
} from '@nuxeo-satori/platform/components';

export interface CreateImportDialogData {
  /** Import target folder; if omitted, falls back to `DocumentImportService.getDefaultImportParentPath()`. */
  parentPath?: string | null;
  parentTitle?: string;
}

export interface CreateImportDialogResult {
  refreshed?: boolean;
  path?: string | null;
  /** When set, the opener should navigate to this app route (Web UI parity). */
  navigateToUrl?: string;
  /** When set, the opener should navigate to this document's detail page. */
  navigateToUid?: string;
  /** Nuxeo path of the created document (for browse navigation). */
  navigateToPath?: string;
  /** When true, the detail page should focus the note editor (Note documents only). */
  freshNote?: boolean;
}

export type DialogTab = 'create' | 'import' | 'csv';

export interface ImportPropertiesState {
  title: string;
  description: string;
  nature: string | null;
  subjects: string[];
  coverage: string | null;
  expires: Date | null;
  expiresRawText: string;
}

export interface StagedImportFile {
  file: File;
  checked: boolean;
  docType: string;
  visited: boolean;
  state: ImportPropertiesState;
}

export interface DocTypeDef {
  type: string;
  label: string;
}

function defaultImportPropertiesState(file: File): ImportPropertiesState {
  return {
    title: titleFromFileName(file.name),
    description: '',
    nature: null,
    subjects: [],
    coverage: null,
    expires: null,
    expiresRawText: '',
  };
}

function cloneImportPropertiesState(state: ImportPropertiesState): ImportPropertiesState {
  return {
    ...state,
    subjects: [...state.subjects],
    expires: state.expires ? new Date(state.expires.getTime()) : null,
  };
}

/** Web UI copies metadata to all files but keeps each destination file's own name as title. */
function applyImportPropertiesTemplate(
  template: ImportPropertiesState,
  file: File,
  keepTemplateTitle: boolean,
): ImportPropertiesState {
  const state = cloneImportPropertiesState(template);
  if (!keepTemplateTitle) {
    state.title = titleFromFileName(file.name);
  }
  return state;
}

function toDocTypeDefs(types: string[], translate: (key: string) => string): DocTypeDef[] {
  return types.map((type) => ({
    type,
    label: docTypeLabel(type, translate),
  }));
}

const DIALOG_SIZE = {
  content: { width: '960px', height: '680px' },
  success: { width: '440px' },
} as const;

@Component({
  selector: 'lib-create-import-dialog',
  standalone: true,
  imports: [
    NxsDocTypeIconComponent,
    NxsSpinnerComponent,
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    FormsModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideNativeDateAdapter(), provideNxsToast()],
  templateUrl: './create-import-dialog.component.html',
  styleUrl: './create-import-dialog.component.scss',
})
export class CreateImportDialogComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  @ViewChild('mainFileInput') mainFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('importFileInput') importFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('expiresInput') expiresNgModel?: NgModel;

  private readonly dialogRef = inject(
    MatDialogRef<CreateImportDialogComponent, CreateImportDialogResult>,
  );
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<CreateImportDialogData>(MAT_DIALOG_DATA);
  private readonly importService = inject(DocumentImportService);
  private readonly browse = inject(BrowseService);
  private readonly directoryService = inject(DirectoryService);
  private readonly toast = inject(NxsToastService);

  private folderContextRequestId = 0;
  private locationSuggestionsRequestId = 0;
  private mainFileUploadRequestId = 0;
  private mainFileBatchId: string | null = null;

  readonly noteFormatOptions = NOTE_FORMAT_OPTIONS;

  constructor() {
    effect(() => {
      const path = this.parentPath();
      if (!path) return;
      this.loadLocationSuggestions(path);
      if (isRestrictedImportParentPath(path)) {
        this.creatableTypes.set([]);
        this.loadingContext.set(false);
        this.typesLoadError.set(null);
        return;
      }
      this.loadFolderContext(path);
    });

    effect(() => {
      const v = this.view();
      if (v === 'success') {
        this.dialogRef.updateSize(DIALOG_SIZE.success.width);
      } else {
        this.dialogRef.updateSize(DIALOG_SIZE.content.width, DIALOG_SIZE.content.height);
      }
    });
  }

  readonly resolvingPath = signal(false);
  readonly parentPath = signal<string | null>(null);
  readonly pathError = signal<string | null>(null);

  readonly view = signal<'main' | 'templateForm' | 'importProperties' | 'success'>('main');
  readonly activeTab = signal<DialogTab>('create');

  readonly selectedDocType = signal<DocTypeDef | null>(null);
  readonly parentFolderType = signal<string | null>(null);
  readonly creatableTypes = signal<DocTypeDef[]>([]);
  readonly loadingContext = signal(false);
  readonly typesLoadError = signal<string | null>(null);

  locationInput = '';

  readonly locationSuggestions = signal<{ path: string; title: string }[]>([]);
  readonly locationDropdownOpen = signal(false);
  readonly locationHighlightIndex = signal(-1);
  readonly loadingLocationSuggestions = signal(false);

  readonly natureEntries = signal<DirectoryEntry[]>([]);
  protected readonly directoryPickerLabel = directoryPickerLabel;
  readonly subjectEntries = signal<L10nDirectoryEntry[]>([]);
  readonly coverageEntries = signal<L10nDirectoryEntry[]>([]);
  readonly directoriesLoaded = signal(false);

  docTitle = '';
  description = '';
  nature: string | null = null;
  subjects: string[] = [];
  coverage: string | null = null;
  naturePanelSearch = '';
  subjectsPanelSearch = '';
  coveragePanelSearch = '';
  expires: Date | null = null;
  expiresRawText = '';
  readonly expiresErrorMatcher = createExpiresErrorStateMatcher(() =>
    shouldShowExpiresFieldError(this.expiresRawText, this.expires),
  );
  noteFormat = 'text/html';
  readonly importDocType = signal('');

  readonly importEntries = signal<StagedImportFile[]>([]);
  readonly importFileIndex = signal(0);

  readonly mainFile = signal<File | null>(null);
  readonly mainFileUploading = signal(false);
  readonly mainFileUploadComplete = signal(false);
  readonly mainFileUploadPercent = signal(0);
  readonly dragOverContent = signal(false);

  readonly uploadFiles = signal<File[]>([]);
  readonly csvFile = signal<File | null>(null);
  readonly csvSendReport = signal(false);
  readonly csvDocumentMode = signal(false);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly contentError = signal<string | null>(null);
  readonly importError = signal<string | null>(null);
  readonly uploadProgress = signal<ImportProgress | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly dragOverUpload = signal(false);
  readonly dragOverCsv = signal(false);

  readonly hasContentField = computed(() => {
    const type = this.selectedDocType()?.type;
    return type ? isBlobHoldingDocType(type) : false;
  });

  readonly createMissingMainFile = computed(() => {
    const type = this.selectedDocType()?.type;
    return type ? isBlobHoldingDocType(type) && !this.mainFile() : false;
  });

  readonly mainFileUploadPending = computed(() => {
    const type = this.selectedDocType()?.type;
    if (!type || !isBlobHoldingDocType(type)) return false;
    const file = this.mainFile();
    if (!file) return false;
    return this.mainFileUploading() || !this.mainFileUploadComplete();
  });

  readonly isNoteType = computed(() => this.selectedDocType()?.type === 'Note');

  readonly importBlobTypeOptions = computed(() =>
    this.creatableTypes().filter((dt) => isBlobHoldingDocType(dt.type)),
  );

  readonly importBlobTypeNames = computed(() => this.importBlobTypeOptions().map((dt) => dt.type));

  /** Dublin Core metadata fields for blob-holding import types (File, Picture, Audio, Video). */
  readonly showImportBlobMetadataFields = computed(() => {
    const type = this.importDocType();
    return !!type && isBlobHoldingDocType(type);
  });

  readonly canEditImportPrevious = computed(() => this.importFileIndex() > 0);

  readonly canEditImportNext = computed(
    () => this.importFileIndex() < this.importEntries().length - 1,
  );

  readonly hasCheckedImportFiles = computed(() =>
    this.importEntries().some((entry) => entry.checked),
  );

  readonly canCreateImportWithProperties = computed(() => this.isImportBatchReadyToCreate());

  readonly currentImportFileLabel = computed(() => {
    const entry = this.importEntries()[this.importFileIndex()];
    return entry?.file.name ?? '';
  });

  readonly locationRestricted = computed(
    () =>
      isRestrictedImportParentPath(this.parentPath()) ||
      isDomainParentType(this.parentFolderType()),
  );

  readonly importRestricted = computed(
    () => this.locationRestricted() || isRepositoryRootPath(this.parentPath()),
  );

  /** CSV import matches Nuxeo Web UI: allowed at repository root, blocked on domain containers. */
  readonly csvImportRestricted = computed(() => this.locationRestricted());

  readonly isAtRepositoryRoot = computed(() => isRepositoryRootPath(this.parentPath()));

  readonly importLocationHint = computed(() => {
    if (isDomainParentType(this.parentFolderType())) {
      return DOMAIN_CONTAINER_GUIDANCE_KEY;
    }
    return RESTRICTED_IMPORT_LOCATION_MESSAGE_KEY;
  });

  ngOnInit(): void {
    this.loadDirectories();

    const p = this.data.parentPath;
    if (p && p.trim()) {
      this.parentPath.set(this.normalizePath(p));
      this.syncLocationInputFromPath();
    } else {
      this.resolvingPath.set(true);
      this.importService
        .getDefaultImportParentPath()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (path) => {
            this.parentPath.set(this.normalizePath(path));
            this.syncLocationInputFromPath();
            this.resolvingPath.set(false);
          },
          error: () => {
            this.pathError.set(
              this.translate.instant('browse.message.could-not-resolve-a-default-folder-open'),
            );
            this.resolvingPath.set(false);
          },
        });
    }
  }

  private loadDirectories(): void {
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
          this.directoriesLoaded.set(true);
        },
        error: () => {
          this.directoriesLoaded.set(true);
        },
      });
  }

  private loadFolderContext(path: string): void {
    const requestId = this.folderContextRequestId + 1;
    this.folderContextRequestId = requestId;
    this.loadingContext.set(true);
    this.typesLoadError.set(null);
    this.browse
      .getFolderContext(path)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (requestId !== this.folderContextRequestId) {
            return;
          }
          this.parentFolderType.set(doc.type);
          this.creatableTypes.set(
            toDocTypeDefs(resolveCreatableSubtypes(doc), (key) => this.translate.instant(key)),
          );
          this.loadingContext.set(false);
        },
        error: () => {
          if (requestId !== this.folderContextRequestId) {
            return;
          }
          this.parentFolderType.set(null);
          this.creatableTypes.set([]);
          this.typesLoadError.set(this.translate.instant('browse.create-import.types-load-failed'));
          this.loadingContext.set(false);
        },
      });
  }

  private loadLocationSuggestions(path: string): void {
    const requestId = this.locationSuggestionsRequestId + 1;
    this.locationSuggestionsRequestId = requestId;
    this.loadingLocationSuggestions.set(true);
    this.browse
      .getChildren(path, 50, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          if (requestId !== this.locationSuggestionsRequestId) {
            return;
          }
          const folders = (list.entries ?? []).filter((d) => isFolderishDocument(d));
          this.locationSuggestions.set(
            folders.map((f) => ({
              path: this.normalizePath(f.path ?? path),
              title: f.title ?? f.path?.split('/').pop() ?? '',
            })),
          );
          this.locationHighlightIndex.set(folders.length > 0 ? 0 : -1);
          this.loadingLocationSuggestions.set(false);
        },
        error: () => {
          if (requestId !== this.locationSuggestionsRequestId) {
            return;
          }
          this.locationSuggestions.set([]);
          this.locationHighlightIndex.set(-1);
          this.loadingLocationSuggestions.set(false);
        },
      });
  }

  private normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) return '/';
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.replace(/\/+$/, '') || '/';
  }

  private syncLocationInputFromPath(): void {
    const path = this.parentPath();
    if (path) {
      this.locationInput = this.normalizePath(path);
    }
  }

  commitLocationInput(): void {
    const raw = this.locationInput.trim();
    if (!raw) return;
    const normalized = this.normalizePath(raw);
    this.parentPath.set(normalized);
    this.locationInput = normalized;
    this.locationDropdownOpen.set(false);
    this.locationHighlightIndex.set(-1);
  }

  onLocationFocus(): void {
    if (this.locationInput.endsWith('/')) {
      this.locationDropdownOpen.set(true);
      this.loadLocationSuggestions(this.pathForLocationSuggestions());
    }
  }

  /** Show child folders when the input ends with `/`. */
  onLocationInput(): void {
    if (!this.locationInput.endsWith('/')) {
      this.locationDropdownOpen.set(false);
      this.locationHighlightIndex.set(-1);
      return;
    }
    this.locationDropdownOpen.set(true);
    this.loadLocationSuggestions(this.pathForLocationSuggestions());
  }

  onLocationKeydown(event: KeyboardEvent): void {
    const suggestions = this.locationSuggestions();
    const navigable = this.isLocationDropdownNavigable();

    switch (event.key) {
      case 'ArrowDown':
        if (!navigable) {
          if (this.locationInput.endsWith('/')) {
            this.locationDropdownOpen.set(true);
            this.loadLocationSuggestions(this.pathForLocationSuggestions());
          }
          return;
        }
        event.preventDefault();
        this.locationHighlightIndex.update((i) => (i < suggestions.length - 1 ? i + 1 : 0));
        this.scrollLocationHighlightIntoView();
        break;
      case 'ArrowUp':
        if (!navigable) return;
        event.preventDefault();
        this.locationHighlightIndex.update((i) => (i > 0 ? i - 1 : suggestions.length - 1));
        this.scrollLocationHighlightIntoView();
        break;
      case 'Enter':
        event.preventDefault();
        if (navigable) {
          const idx = this.locationHighlightIndex();
          if (idx >= 0 && idx < suggestions.length) {
            this.selectLocationSuggestion(suggestions[idx].path);
            return;
          }
        }
        this.commitLocationInput();
        break;
      case 'Escape':
        if (this.locationDropdownOpen()) {
          event.preventDefault();
          this.locationDropdownOpen.set(false);
          this.locationHighlightIndex.set(-1);
        }
        break;
    }
  }

  private isLocationDropdownNavigable(): boolean {
    return (
      this.locationDropdownOpen() &&
      !this.loadingLocationSuggestions() &&
      this.locationSuggestions().length > 0
    );
  }

  private scrollLocationHighlightIntoView(): void {
    setTimeout(() => {
      document.querySelector('.location-option--active')?.scrollIntoView({ block: 'nearest' });
    });
  }

  private pathForLocationSuggestions(): string {
    const raw = this.locationInput.trim();
    if (raw.endsWith('/')) {
      return this.normalizePath(raw);
    }
    return this.parentPath() ?? '/';
  }

  onLocationBlur(): void {
    setTimeout(() => {
      this.locationDropdownOpen.set(false);
      this.commitLocationInput();
    }, 150);
  }

  selectLocationSuggestion(path: string): void {
    const normalized = this.normalizePath(path);
    this.parentPath.set(normalized);
    this.locationInput = normalized;
    this.locationDropdownOpen.set(false);
    this.locationHighlightIndex.set(-1);
  }

  setActiveTab(tab: DialogTab): void {
    if (this.view() === 'templateForm' || this.view() === 'importProperties') {
      this.resetFormState();
      this.resetImportPropertiesState();
      this.view.set('main');
    }
    this.activeTab.set(tab);
    this.error.set(null);
    this.importError.set(null);
    if (tab === 'import') {
      this.csvFile.set(null);
      this.dragOverCsv.set(false);
    } else if (tab === 'csv') {
      this.uploadFiles.set([]);
      this.dragOverUpload.set(false);
    } else if (tab === 'create') {
      this.csvFile.set(null);
      this.uploadFiles.set([]);
    }
  }

  startCreateFromType(docType: DocTypeDef): void {
    if (this.locationRestricted()) return;
    this.resetFormState();
    this.selectedDocType.set(docType);
    this.error.set(null);
    this.contentError.set(null);
    this.view.set('templateForm');
  }

  private resetFormState(): void {
    this.selectedDocType.set(null);
    this.docTitle = '';
    this.description = '';
    this.nature = null;
    this.subjects = [];
    this.coverage = null;
    this.naturePanelSearch = '';
    this.subjectsPanelSearch = '';
    this.coveragePanelSearch = '';
    this.expires = null;
    this.expiresRawText = '';
    this.noteFormat = 'text/html';
    this.mainFile.set(null);
    this.mainFileUploading.set(false);
    this.mainFileUploadComplete.set(false);
    this.mainFileUploadPercent.set(0);
    this.mainFileBatchId = null;
    this.mainFileUploadRequestId++;
    this.dragOverContent.set(false);
    this.contentError.set(null);
    this.uploadProgress.set(null);
  }

  isExpiresValid(): boolean {
    return isExpiresFieldValid(this.expiresRawText, this.expires);
  }

  showExpiresError(): boolean {
    return shouldShowExpiresFieldError(this.expiresRawText, this.expires);
  }

  /** Type selected and required Dublin Core fields are valid on the current form. */
  isImportFormComplete(): boolean {
    return this.showImportBlobMetadataFields() && !!this.docTitle.trim() && this.isExpiresValid();
  }

  /** Checked batch is ready for Create (form complete and on last file or all checked visited). */
  isImportBatchReadyToCreate(): boolean {
    if (!this.hasCheckedImportFiles() || !this.isImportFormComplete()) {
      return false;
    }
    const entries = this.importEntries();
    const onLast = this.importFileIndex() >= entries.length - 1;
    const allCheckedVisited = entries
      .filter((entry) => entry.checked)
      .every((entry) => entry.visited);
    return onLast || allCheckedVisited;
  }

  /** Apply To All is only available on the first file while metadata is still being configured. */
  canApplyImportToAll(): boolean {
    if (!this.hasCheckedImportFiles()) return false;
    if (this.importEntries().length <= 1) return false;
    if (this.importFileIndex() !== 0) return false;
    return !this.isImportBatchReadyToCreate();
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

  uploadProgressLabel(progress: ImportProgress): string {
    if (progress.phase === 'creating') {
      return this.translate.instant('browse.message.creating-document');
    }
    if (progress.fileCount && progress.fileCount > 1 && progress.fileIndex !== undefined) {
      return this.translate.instant('browse.message.uploading-file-of', {
        index: progress.fileIndex + 1,
        count: progress.fileCount,
      });
    }
    return this.translate.instant('browse.message.uploading');
  }

  formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  openImportFilePicker(): void {
    this.importFileInput?.nativeElement.click();
  }

  subjectPillLabel(id: string): string {
    const entry = this.subjectEntries().find((e) => e.id === id);
    if (!entry) return id;
    const label = entry.properties.label_en ?? id;
    const parentId = entry.properties.parent;
    if (!parentId || label.includes('/')) return label;
    const parent = this.subjectEntries().find((e) => e.id === parentId);
    const parentLabel = parent?.properties.label_en ?? parentId;
    return `${parentLabel}/${label}`;
  }

  naturePillLabel(id: string): string {
    const entry = this.natureEntries().find((e) => e.id === id);
    return entry ? directoryPickerLabel(entry) : id;
  }

  coveragePillLabel(id: string): string {
    const entry = this.coverageEntries().find((e) => e.id === id);
    if (!entry) return id;
    const label = entry.properties.label_en ?? id;
    const parentId = entry.properties.parent;
    if (!parentId || label.includes('/')) return label;
    const parent = this.coverageEntries().find((e) => e.id === parentId);
    const parentLabel = parent?.properties.label_en ?? parentId;
    return `${parentLabel}/${label}`;
  }

  clearNature(): void {
    this.nature = null;
  }

  clearCoverage(): void {
    this.coverage = null;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.locationDropdownOpen()) {
      this.locationDropdownOpen.set(false);
      this.locationHighlightIndex.set(-1);
    }
  }

  onNaturePanelOpen(opened: boolean): void {
    if (opened) {
      this.naturePanelSearch = '';
      this.loadNatureEntries();
    }
  }

  private loadNatureEntries(): void {
    this.directoryService
      .getEntries('nature')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.natureEntries.set(entries),
      });
  }

  onSubjectsPanelOpen(opened: boolean): void {
    if (opened) {
      this.subjectsPanelSearch = '';
      this.loadL10nEntries('l10nsubjects', this.subjectEntries);
    }
  }

  onCoveragePanelOpen(opened: boolean): void {
    if (opened) {
      this.coveragePanelSearch = '';
      this.loadL10nEntries('l10ncoverage', this.coverageEntries);
    }
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

  filteredNatureOptions(): DirectoryEntry[] {
    return filterDirectoryPickerEntries(this.natureEntries(), this.naturePanelSearch);
  }

  groupedSubjectOptions(): { parentLabel: string; entries: L10nDirectoryEntry[] }[] {
    return this.groupL10nEntries(this.subjectEntries(), this.subjectsPanelSearch);
  }

  groupedCoverageOptions(): { parentLabel: string; entries: L10nDirectoryEntry[] }[] {
    return this.groupL10nEntries(this.coverageEntries(), this.coveragePanelSearch);
  }

  coverageDisplayLabel(): string {
    return formatHierarchicalL10nLabel(this.coverage, this.coverageEntries());
  }

  private groupL10nEntries(
    entries: L10nDirectoryEntry[],
    query: string,
  ): { parentLabel: string; entries: L10nDirectoryEntry[] }[] {
    if (!entries.length) return [];

    const parentLabels = new Map(entries.map((e) => [e.id, e.properties.label_en ?? e.id]));
    const q = query.trim().toLowerCase();

    const filtered = entries.filter((e) => {
      if (e.properties.obsolete) return false;
      if (!e.properties.parent) return false;
      if (!q) return true;
      const label = (e.properties.label_en ?? e.id).toLowerCase();
      const parentLabel = (parentLabels.get(e.properties.parent) ?? '').toLowerCase();
      return label.includes(q) || e.id.toLowerCase().includes(q) || parentLabel.includes(q);
    });

    const groups = new Map<string, L10nDirectoryEntry[]>();
    for (const entry of filtered) {
      const parent = entry.properties.parent;
      const list = groups.get(parent) ?? [];
      list.push(entry);
      groups.set(parent, list);
    }

    return [...groups.entries()]
      .map(([parentId, groupEntries]) => ({
        parentLabel: parentLabels.get(parentId) ?? parentId,
        entries: groupEntries.sort(
          (a, b) => (a.properties.ordering ?? 0) - (b.properties.ordering ?? 0),
        ),
      }))
      .sort((a, b) => a.parentLabel.localeCompare(b.parentLabel));
  }

  addSubject(id: string): void {
    if (!id || this.subjects.includes(id)) return;
    this.subjects = [...this.subjects, id];
  }

  removeSubject(id: string): void {
    this.subjects = this.subjects.filter((v) => v !== id);
  }

  goMain(): void {
    this.resetFormState();
    this.resetImportPropertiesState();
    this.view.set('main');
    this.error.set(null);
    this.contentError.set(null);
  }

  startImportProperties(): void {
    if (this.importRestricted()) return;
    const files = this.uploadFiles();
    if (files.length === 0) return;

    const allowedTypes = this.importBlobTypeNames();
    const entries: StagedImportFile[] = files.map((file) => ({
      file,
      checked: true,
      docType: resolveImportBlobDocType(file, allowedTypes),
      visited: false,
      state: defaultImportPropertiesState(file),
    }));

    this.importEntries.set(entries);
    this.importFileIndex.set(0);
    this.error.set(null);
    this.importError.set(null);
    this.loadImportEntryToForm(0);
    this.view.set('importProperties');
  }

  toggleImportFileChecked(index: number, checked: boolean): void {
    this.importEntries.update((entries) =>
      entries.map((entry, i) => (i === index ? { ...entry, checked } : entry)),
    );
  }

  selectImportFile(index: number): void {
    if (index === this.importFileIndex()) return;
    this.saveImportFormToCurrentEntry();
    this.importFileIndex.set(index);
    this.loadImportEntryToForm(index);
  }

  editImportPrevious(): void {
    if (!this.canEditImportPrevious()) return;
    this.saveImportFormToCurrentEntry();
    const nextIndex = this.importFileIndex() - 1;
    this.importFileIndex.set(nextIndex);
    this.loadImportEntryToForm(nextIndex);
  }

  editImportNext(): void {
    if (!this.canEditImportNext()) return;
    this.saveImportFormToCurrentEntry();
    const nextIndex = this.importFileIndex() + 1;
    this.importFileIndex.set(nextIndex);
    this.loadImportEntryToForm(nextIndex);
  }

  applyImportToAll(): void {
    if (!this.canApplyImportToAll()) return;
    this.saveImportFormToCurrentEntry();
    const template = cloneImportPropertiesState(this.readImportFormState());
    const docType = this.importDocType();
    this.importEntries.update((entries) =>
      entries.map((entry, index) =>
        entry.checked
          ? {
              ...entry,
              docType: docType || entry.docType,
              visited: true,
              state: applyImportPropertiesTemplate(template, entry.file, index === 0),
            }
          : entry,
      ),
    );

    const lastIndex = this.importEntries().length - 1;
    this.importFileIndex.set(lastIndex);
    this.loadImportEntryToForm(lastIndex);
  }

  runImportWithProperties(): void {
    this.commitLocationInput();
    if (this.importRestricted()) return;
    if (!this.canCreateImportWithProperties()) return;

    const path = this.parentPath();
    if (!path) return;

    this.saveImportFormToCurrentEntry();

    const apiEntries: ImportFileEntry[] = this.importEntries()
      .filter((entry) => entry.checked)
      .map((entry) => ({
        file: entry.file,
        docType: entry.docType,
        properties: this.buildPropertiesFromImportState(entry.state),
      }));

    if (apiEntries.length === 0) return;

    this.busy.set(true);
    this.error.set(null);
    this.importError.set(null);
    this.uploadProgress.set(null);

    this.importService
      .importFilesWithProperties(path, apiEntries, {
        onProgress: (progress) => this.uploadProgress.set(progress),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.busy.set(false);
          this.uploadProgress.set(null);
        }),
      )
      .subscribe({
        next: (docs) => {
          this.toast.show(
            this.translate.instant(
              docs.length === 1
                ? 'common.count.created-document-one'
                : 'common.count.created-document-many',
              { count: docs.length },
            ),
          );
          this.dialogRef.close({
            refreshed: true,
            path,
            navigateToUid: docs.length === 1 ? docs[0].uid : undefined,
          });
        },
        error: (err: { error?: { message?: string }; message?: string }) => {
          this.importError.set(
            err?.error?.message ??
              err?.message ??
              this.translate.instant('admin.message.create-failed'),
          );
        },
      });
  }

  private resetImportPropertiesState(): void {
    this.importEntries.set([]);
    this.importFileIndex.set(0);
    this.importDocType.set('');
  }

  private readImportFormState(): ImportPropertiesState {
    return {
      title: this.docTitle,
      description: this.description,
      nature: this.nature,
      subjects: [...this.subjects],
      coverage: this.coverage,
      expires: this.expires,
      expiresRawText: this.expiresRawText,
    };
  }

  private saveImportFormToCurrentEntry(): void {
    const index = this.importFileIndex();
    const state = this.readImportFormState();
    this.importEntries.update((entries) => {
      if (!entries[index]) return entries;
      const next = [...entries];
      next[index] = {
        ...next[index],
        docType: this.importDocType() || next[index].docType,
        visited: true,
        state,
      };
      return next;
    });
  }

  private loadImportEntryToForm(index: number): void {
    const entry = this.importEntries()[index];
    if (!entry) return;
    this.importDocType.set(entry.docType);
    this.docTitle = entry.state.title;
    this.description = entry.state.description;
    this.nature = entry.state.nature;
    this.subjects = [...entry.state.subjects];
    this.coverage = entry.state.coverage;
    this.expires = entry.state.expires;
    this.expiresRawText = entry.state.expiresRawText;
    this.naturePanelSearch = '';
    this.subjectsPanelSearch = '';
    this.coveragePanelSearch = '';
  }

  private buildPropertiesFromImportState(state: ImportPropertiesState): Record<string, unknown> {
    return {
      'dc:title': state.title.trim(),
      'dc:description': state.description.trim() || null,
      'dc:nature': state.nature || null,
      'dc:subjects': [...state.subjects],
      'dc:coverage': state.coverage || null,
      'dc:expired':
        state.expires && !Number.isNaN(state.expires.getTime())
          ? state.expires.toISOString()
          : null,
    };
  }

  private buildDocumentProperties(title: string): Record<string, unknown> {
    const docType = this.selectedDocType();
    const props: Record<string, unknown> = {
      'dc:title': title,
      'dc:description': this.description.trim() || null,
      'dc:nature': this.nature || null,
      'dc:subjects': this.subjects,
      'dc:coverage': this.coverage || null,
      'dc:expired':
        this.expires && !Number.isNaN(this.expires.getTime()) ? this.expires.toISOString() : null,
    };

    if (docType?.type === 'Note') {
      props['note:note'] = defaultNoteContent(this.noteFormat);
      props['note:mime_type'] = this.noteFormat;
    }

    return props;
  }

  createDocument(): void {
    this.commitLocationInput();
    if (this.locationRestricted()) return;
    const path = this.parentPath();
    const docType = this.selectedDocType();
    if (!path || !docType || !this.docTitle.trim()) return;

    if (!this.isExpiresValid()) return;

    const title = this.docTitle.trim();
    const name = sanitizeDocumentName(title);
    const properties = this.buildDocumentProperties(title);
    const mainFile = this.mainFile();
    const hasBlob = isBlobHoldingDocType(docType.type);

    if (hasBlob && !mainFile) {
      this.contentError.set(
        this.translate.instant('browse.message.a-file-is-required-for-this-document'),
      );
      return;
    }

    if (hasBlob && mainFile && this.mainFileUploadPending()) {
      this.contentError.set(
        this.translate.instant('browse.message.please-wait-for-the-file-upload-to'),
      );
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.contentError.set(null);

    const create$ =
      mainFile && hasBlob
        ? this.importService.createBlobHoldingDocumentReliable(
            path,
            name,
            docType.type,
            properties,
            mainFile,
            this.mainFileBatchId && this.mainFileUploadComplete()
              ? { batchId: this.mainFileBatchId, fileIndex: 0 }
              : null,
            {
              onProgress: (progress) => this.uploadProgress.set(progress),
            },
          )
        : this.importService.createChildDocument(path, name, docType.type, properties);

    create$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.busy.set(false);
          if (!this.mainFileUploading()) {
            this.uploadProgress.set(null);
          }
        }),
      )
      .subscribe({
        next: (doc) => this.finishCreateAndNavigate(doc, title, docType.type, !!mainFile),
        error: (err: { error?: { message?: string }; message?: string }) => {
          const raw = err?.error?.message ?? err?.message;
          const message =
            raw === BLOB_NOT_ATTACHED_ERROR
              ? this.translate.instant('browse.message.file-not-attached')
              : (raw ?? this.translate.instant('browse.message.create-failed'));
          if (hasBlob && mainFile) {
            this.contentError.set(message);
          } else {
            this.error.set(message);
          }
        },
      });
  }

  private finishCreateAndNavigate(
    doc: NuxeoDocument,
    title: string,
    docTypeName: string,
    hadFile: boolean,
  ): void {
    this.mainFile.set(null);
    if (!hadFile) {
      this.toast.show(
        this.translate.instant('browse.create-import-dialog.created-named', {
          type: docTypeName,
          title,
        }),
      );
    }
    this.dialogRef.close({
      refreshed: true,
      path: this.parentPath(),
      navigateToUrl: documentNavigationUrl(doc, docTypeName),
      navigateToUid:
        isCollectionDocument(doc, docTypeName) || doc.type === 'Domain' ? undefined : doc.uid,
      navigateToPath: doc.type === 'Domain' ? doc.path : undefined,
      freshNote: docTypeName === 'Note',
    });
  }

  onMainFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.stageMainFile(file);
    }
    input.value = '';
  }

  onContentDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverContent.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) {
      this.stageMainFile(file);
    }
  }

  onContentDragOver(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.dragOverContent.set(true);
  }

  onContentDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverContent.set(false);
  }

  clearMainFile(): void {
    this.mainFileUploadRequestId++;
    this.mainFile.set(null);
    this.mainFileUploading.set(false);
    this.mainFileUploadComplete.set(false);
    this.mainFileUploadPercent.set(0);
    this.mainFileBatchId = null;
    this.contentError.set(null);
    if (this.mainFileInput?.nativeElement) {
      this.mainFileInput.nativeElement.value = '';
    }
  }

  private stageMainFile(file: File): void {
    const requestId = ++this.mainFileUploadRequestId;
    this.mainFile.set(file);
    this.mainFileUploading.set(true);
    this.mainFileUploadComplete.set(false);
    this.mainFileUploadPercent.set(0);
    this.mainFileBatchId = null;
    this.contentError.set(null);

    this.importService
      .stageFileInBatch(file, {
        onProgress: (percent) => {
          if (requestId !== this.mainFileUploadRequestId) return;
          this.mainFileUploadPercent.set(percent);
        },
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestId !== this.mainFileUploadRequestId) return;
          this.mainFileUploading.set(false);
        }),
      )
      .subscribe({
        next: ({ batchId }) => {
          if (requestId !== this.mainFileUploadRequestId) return;
          this.mainFileBatchId = batchId;
          this.mainFileUploadComplete.set(true);
          this.mainFileUploadPercent.set(100);
        },
        error: (err: { error?: { message?: string }; message?: string }) => {
          if (requestId !== this.mainFileUploadRequestId) return;
          this.mainFile.set(null);
          this.mainFileBatchId = null;
          this.mainFileUploadPercent.set(0);
          this.contentError.set(
            err?.error?.message ??
              err?.message ??
              this.translate.instant('browse.message.file-upload-failed'),
          );
        },
      });
  }

  onUploadInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const list = input.files;
    if (!list?.length) return;
    this.addFiles(Array.from(list));
    this.importError.set(null);
    input.value = '';
  }

  onUploadDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverUpload.set(false);
    const list = ev.dataTransfer?.files;
    if (list?.length) {
      this.addFiles(Array.from(list));
      this.importError.set(null);
    }
  }

  onUploadDragOver(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.dragOverUpload.set(true);
  }

  onUploadDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverUpload.set(false);
  }

  private addFiles(files: File[]): void {
    this.uploadFiles.update((cur) => [...cur, ...files]);
  }

  removeUploadAt(i: number): void {
    this.uploadFiles.update((files) => files.filter((_, j) => j !== i));
  }

  onCsvInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.selectCsvFile(file);
  }

  onCsvDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverCsv.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    this.selectCsvFile(file);
  }

  private selectCsvFile(file: File): void {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.csvFile.set(null);
      this.error.set(this.translate.instant('browse.message.please-select-a-csv-file'));
      return;
    }
    this.csvFile.set(file);
    this.error.set(null);
  }

  onCsvDragOver(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.dragOverCsv.set(true);
  }

  onCsvDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOverCsv.set(false);
  }

  clearCsvFile(): void {
    this.csvFile.set(null);
  }

  runUpload(): void {
    this.commitLocationInput();
    if (this.importRestricted()) return;
    const path = this.parentPath();
    const files = this.uploadFiles();
    if (!path || files.length === 0) return;
    this.busy.set(true);
    this.error.set(null);
    this.importError.set(null);
    this.uploadProgress.set(null);
    this.importService
      .importFiles(path, files, {
        onProgress: (progress) => this.uploadProgress.set(progress),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.busy.set(false);
          this.uploadProgress.set(null);
        }),
      )
      .subscribe({
        next: (docs) => {
          this.toast.show(
            this.translate.instant(
              docs.length === 1
                ? 'common.count.created-file-one'
                : 'common.count.created-file-many',
              { count: docs.length },
            ),
          );
          this.dialogRef.close({
            refreshed: true,
            path,
            navigateToUid: docs.length === 1 ? docs[0].uid : undefined,
          });
        },
        error: (err: { error?: { message?: string }; message?: string }) => {
          this.importError.set(
            err?.error?.message ??
              err?.message ??
              this.translate.instant('browse.message.upload-failed'),
          );
        },
      });
  }

  runCsvImport(): void {
    this.commitLocationInput();
    if (this.csvImportRestricted()) return;
    const path = this.parentPath();
    const file = this.csvFile();
    if (!path || !file) return;

    this.busy.set(true);
    this.error.set(null);

    this.importService
      .importCsvFile({
        path,
        file,
        sendReport: this.csvSendReport(),
        documentMode: this.csvDocumentMode(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.busy.set(false);
          this.csvFile.set(null);
          const summary =
            summarizeCsvImportReport(report) ||
            this.translate.instant('browse.message.csv-import-completed');
          this.successMessage.set(summary);
          this.view.set('success');
        },
        error: (err: { status?: number; error?: { message?: string }; message?: string }) => {
          this.busy.set(false);
          if (err?.status === 404) {
            this.error.set(
              this.translate.instant('browse.message.csv-import-is-not-available-install-the'),
            );
            return;
          }
          this.error.set(
            err?.error?.message ??
              err?.message ??
              this.translate.instant('browse.message.csv-import-failed'),
          );
        },
      });
  }

  close(): void {
    this.dialogRef.close();
  }

  doneNavigateBrowse(): void {
    const p = this.parentPath();
    this.dialogRef.close({ refreshed: true, path: p });
  }
}
