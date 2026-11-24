import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DocumentLayoutFormComponent,
  readValidationFailure,
} from '@agentic-ui/shared/document-layouts';
import {
  NXS_PRIMITIVE_IDS,
  NxsBannerComponent,
  NxsChipSetComponent,
  type NxsChipItem,
  NxsDateInputComponent,
  NxsDocTypeIconComponent,
  NxsDropzoneComponent,
  NxsSpinnerComponent,
  NxsToastService,
  NxsUploadQueue,
  NxsUploadQueueComponent,
  provideNxsToast,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
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
  untracked,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { catchError, finalize, forkJoin, map, of } from 'rxjs';

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
  ContentModelService,
  isBlobHoldingDocType,
  isDomainParentType,
  isFolderishDocument,
  isRepositoryRootPath,
  isRestrictedImportParentPath,
  resolveCreatableSubtypes,
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
  documentNavigationUrl,
  isCollectionDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';
import { utcMidnightOf } from '../calendar-day';
import { type MainBlobContentModel, typeHoldsMainBlob } from './main-blob-type';
import { NO_CONTENT_MODEL, importDocTypeFor } from './import-doc-type';

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

/**
 * Which message a failed folder-context read should show.
 *
 * One branch used to serve every failure, so a permission outcome, a deleted folder and a dropped
 * connection all rendered as "Could not load creatable document types for this folder." — a
 * technical sentence with no next step, under an otherwise empty dialog. The reported case is a
 * guest at the repository root: Nuxeo answers `403 Privilege 'Read' is not granted to 'Anonymous'`,
 * which is a statement about permission, not about loading.
 *
 * Anything that is not recognisably one of those keeps the retryable wording, because a message
 * that guesses wrong about the cause is worse than one that admits it does not know.
 */
function folderContextErrorKey(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 401 || status === 403) {
    return 'browse.create-import.types-forbidden';
  }
  if (status === 404) {
    return 'browse.create-import.types-folder-missing';
  }
  return 'browse.create-import.types-load-failed';
}

const DIALOG_SIZE = {
  content: { width: '960px', height: '680px' },
  success: { width: '440px' },
} as const;

@Component({
  selector: 'lib-create-import-dialog',
  standalone: true,
  imports: [
    DocumentLayoutFormComponent,
    NxsDateInputComponent,
    NgTemplateOutlet,
    ExtensionOutletComponent,
    NxsBannerComponent,
    NxsChipSetComponent,
    NxsDocTypeIconComponent,
    NxsDropzoneComponent,
    NxsSpinnerComponent,
    NxsUploadQueueComponent,
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    FormsModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideSatoriDateAdapter(), provideNxsToast()],
  templateUrl: './create-import-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './create-import-dialog.component.scss',
})
export class CreateImportDialogComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  @ViewChild('mainFileInput') mainFileInput?: ElementRef<HTMLInputElement>;

  private readonly dialogRef = inject(
    MatDialogRef<CreateImportDialogComponent, CreateImportDialogResult>,
  );
  private readonly destroyRef = inject(DestroyRef);
  private readonly dateAdapter = inject<DateAdapter<Date>>(DateAdapter);
  private readonly dateFormats = inject(MAT_DATE_FORMATS);
  readonly data = inject<CreateImportDialogData>(MAT_DIALOG_DATA);
  private readonly importService = inject(DocumentImportService);
  private readonly browse = inject(BrowseService);
  private readonly directoryService = inject(DirectoryService);
  private readonly toast = inject(NxsToastService);
  private readonly contentModel = inject(ContentModelService);

  /**
   * Nuxeo's doctypes and facet definitions, to tell which types keep a main file
   * (`typeHoldsMainBlob`), which reads a type's facets against the facet definitions as well as
   * its own schemas. The content model — `/config/types`, `/config/facets` and `/config/schemas`
   * — is read once and cached for the application's lifetime. `null` until it has answered; empty
   * if the server refused it, when the check falls back to the stock type names.
   */
  private readonly answeredContentModel = toSignal(
    this.contentModel.getContentModel().pipe(
      map(({ doctypes, facets }): MainBlobContentModel => ({ doctypes, facets })),
      catchError(() => of(NO_CONTENT_MODEL)),
    ),
    { initialValue: null },
  );

  /**
   * The selected type is none of the stock four, and the content model that says whether it
   * extends one, or carries the `file` schema itself or through a facet, has not answered yet —
   * which happens only in the session's first dialog, until its three cached reads return. Create
   * waits rather than guess, so a type that extends File is never created without its file. File,
   * Picture, Audio and Video never wait; any other type, Folder included, can, since only the
   * content model rules it out.
   */
  readonly mainFileUnsettled = computed(() => {
    const type = this.selectedDocType()?.type;
    return !!type && !isBlobHoldingDocType(type) && this.answeredContentModel() === null;
  });

  /**
   * The Import tab cannot yet choose each file's starting type, for plain Create or Add
   * properties: this folder allows none of the stock four, and the content model that names the
   * types extending them has not answered. Where a stock type is allowed, files start as one and
   * do not wait.
   */
  readonly importTypesUnsettled = computed(
    () =>
      this.answeredContentModel() === null &&
      !this.creatableTypes().some((dt) => isBlobHoldingDocType(dt.type)),
  );

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

    // The properties step's Location can move its files to another folder. Once that folder's
    // types are known, each file whose type it does not allow starts again as Add properties would
    // start it there; a type it allows is kept. Nuxeo would create the old type regardless.
    effect(() => {
      const importTypes = this.importBlobTypeNames();
      if (this.view() !== 'importProperties' || this.importTypesUnavailable()) return;
      untracked(() => this.reresolveImportEntryTypes(importTypes));
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
  readonly expiresErrorMatcher = createExpiresErrorStateMatcher(() => this.showExpiresError());
  noteFormat = 'text/html';
  readonly importDocType = signal('');

  readonly importEntries = signal<StagedImportFile[]>([]);
  readonly importFileIndex = signal(0);

  readonly mainFile = signal<File | null>(null);
  readonly mainFileUploading = signal(false);
  readonly mainFileUploadComplete = signal(false);
  readonly mainFileUploadPercent = signal(0);
  readonly dragOverContent = signal(false);

  /**
   * The import tab's files: chosen, then each one's progress and outcome while they upload. What is
   * still pending in it is what Create uploads.
   */
  readonly uploads = new NxsUploadQueue();
  readonly csvFile = signal<File | null>(null);
  readonly csvSendReport = signal(false);
  readonly csvDocumentMode = signal(false);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly contentError = signal<string | null>(null);
  readonly importError = signal<string | null>(null);
  readonly uploadProgress = signal<ImportProgress | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly dragOverCsv = signal(false);

  readonly hasContentField = computed(() => {
    const type = this.selectedDocType()?.type;
    return type ? this.holdsMainBlob(type) : false;
  });

  readonly createMissingMainFile = computed(() => {
    const type = this.selectedDocType()?.type;
    return type ? this.holdsMainBlob(type) && !this.mainFile() : false;
  });

  readonly mainFileUploadPending = computed(() => {
    const type = this.selectedDocType()?.type;
    if (!type || !this.holdsMainBlob(type)) return false;
    const file = this.mainFile();
    if (!file) return false;
    return this.mainFileUploading() || !this.mainFileUploadComplete();
  });

  readonly isNoteType = computed(() => this.selectedDocType()?.type === 'Note');

  /** The selected type's create form: its create layout, or a `documentCreate` component. */
  private readonly layoutForm = viewChild(DocumentLayoutFormComponent);

  /** Create waits for the form to be on screen; until then there is nothing to send. */
  readonly createFormReady = computed(() => this.layoutForm()?.ready() ?? false);

  readonly importBlobTypeOptions = computed(() =>
    this.creatableTypes().filter((dt) => this.holdsMainBlob(dt.type)),
  );

  readonly importBlobTypeNames = computed(() => this.importBlobTypeOptions().map((dt) => dt.type));

  /**
   * The Import tab has no type to start the files as: this folder allows none that keeps a main
   * file — a Section, or one that takes only Workspace and Folder. Each file would otherwise start
   * as `File`, `resolveImportBlobDocType`'s fallback, which the folder does not allow. Nuxeo does
   * not refuse it either: measured on the local server, a `File` posted into a Section or into
   * WorkspaceRoot is created. So `importTypesUnavailable` disables plain Create, Add properties,
   * and the properties step's Create once its Location moves the files to such a folder.
   */
  readonly noImportBlobTypes = computed(() => this.importBlobTypeNames().length === 0);

  /**
   * Plain Create, Add properties and the properties step's Create all wait while the staged files
   * cannot be given a type the folder allows: its allowed types are loading (after a location
   * change, the previous folder's are still held), the content model has not answered
   * (`importTypesUnsettled`), or it allows none that keeps a main file (`noImportBlobTypes`).
   */
  readonly importTypesUnavailable = computed(
    () => this.loadingContext() || this.importTypesUnsettled() || this.noImportBlobTypes(),
  );

  /**
   * A checked file on the properties step is of a type this folder does not allow. Each file's type
   * was chosen for the folder the step opened on; when the step's Location moves them,
   * `reresolveImportEntryTypes` starts each one the new folder does not allow again, once its types
   * load. Until it has, Create waits, and `runImportWithProperties` refuses. The file on screen is
   * judged on the type its form shows, which it saves on leaving.
   */
  readonly importEntryTypeDisallowed = computed(() => {
    const importTypes = this.importBlobTypeNames();
    const current = this.importFileIndex();
    const shown = this.importDocType();
    return this.importEntries().some(
      (entry, index) =>
        entry.checked &&
        !importTypes.includes(index === current ? shown || entry.docType : entry.docType),
    );
  });

  /**
   * The properties step's Create waits as plain Create does — a restricted location, or no type
   * yet that the folder allows — and while a checked file's type is not allowed here.
   */
  readonly importPropertiesTypesBlocked = computed(
    () =>
      this.importRestricted() || this.importTypesUnavailable() || this.importEntryTypeDisallowed(),
  );

  /**
   * The Import tab says why Create is disabled: this folder allows no type that keeps a main file.
   * Not while its types or the content model are still loading, and not when the folder's types
   * could not be read, which `typesLoadError` says instead.
   */
  readonly importAllowsNoFiles = computed(
    () =>
      this.noImportBlobTypes() &&
      !this.loadingContext() &&
      !this.importTypesUnsettled() &&
      !this.typesLoadError() &&
      !this.contentModelRefused(),
  );

  /**
   * The server refused the content model, so only the four stock names count, and a folder that
   * allows only a type extending one looks as if it allowed none. The dialog cannot tell which,
   * so the Import tab says the types could not be read rather than that the folder takes no file.
   * Reopening the dialog reads the content model again: `ContentModelService` does not keep a
   * refusal.
   */
  readonly importTypesUnreadable = computed(
    () =>
      this.noImportBlobTypes() &&
      !this.loadingContext() &&
      !this.typesLoadError() &&
      this.contentModelRefused(),
  );

  /** The content model's read failed: `answeredContentModel` fell back to `NO_CONTENT_MODEL`. */
  private readonly contentModelRefused = computed(
    () => this.answeredContentModel() === NO_CONTENT_MODEL,
  );

  /**
   * Dublin Core metadata fields for blob-holding import types: File, Picture, Audio, Video and
   * any type that extends one of them, or carries the `file` schema, itself or through a facet,
   * and is not folderish.
   */
  readonly showImportBlobMetadataFields = computed(() => {
    const type = this.importDocType();
    return !!type && this.holdsMainBlob(type);
  });

  /** Whether `type` keeps a main file, by its ancestry and facets in Nuxeo's content model. */
  private holdsMainBlob(type: string): boolean {
    return typeHoldsMainBlob(type, this.answeredContentModel() ?? NO_CONTENT_MODEL);
  }

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
        error: (error: unknown) => {
          if (requestId !== this.folderContextRequestId) {
            return;
          }
          this.parentFolderType.set(null);
          this.creatableTypes.set([]);
          this.typesLoadError.set(this.translate.instant(folderContextErrorKey(error)));
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
    // The same location again, after its types could not be read: read them again. Setting the
    // path to the value it already holds changes nothing, so the effect that reads them would not
    // run, and the Import tab's Create, which waits for them, would stay disabled until the dialog
    // was reopened.
    if (normalized === this.parentPath() && this.typesLoadError()) {
      this.loadFolderContext(normalized);
    }
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
      this.uploads.clear();
    } else if (tab === 'create') {
      this.csvFile.set(null);
      this.uploads.clear();
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
    return this.isExpiresStateValid(this.expiresRawText, this.expires);
  }

  /**
   * One Expires check for the live form and for an entry's saved state alike.
   *
   * Next saves the form without validating it, so `isImportFormComplete()` alone only ever
   * described the file on screen: an invalid expiry typed on file 1 was serialized as
   * `dc:expired: null` and sent when the batch was submitted from file 3.
   */
  private isExpiresStateValid(expiresRawText: string, expires: Date | null): boolean {
    const parsed = expiresRawText.trim()
      ? this.dateAdapter.parse(expiresRawText, this.dateFormats.parse.dateInput)
      : expires;
    return isExpiresFieldValid(expiresRawText, parsed);
  }

  showExpiresError(): boolean {
    return !this.isExpiresValid();
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
    if (!onLast && !allCheckedVisited) return false;
    // The entry on screen is covered by `isImportFormComplete()` above; its own saved state is
    // a navigation behind. Every other checked entry is judged on what Next stored for it.
    const current = this.importFileIndex();
    return entries.every(
      (entry, index) =>
        !entry.checked ||
        index === current ||
        this.isExpiresStateValid(entry.state.expiresRawText, entry.state.expires),
    );
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
    // Parse synchronously so validation and the saved payload agree even before ngModel updates.
    const parsed = this.dateAdapter.getValidDateOrNull(
      this.dateAdapter.parse(this.expiresRawText.trim(), this.dateFormats.parse.dateInput),
    );
    // The datepicker already holds null or this instant; another value makes [ngModel] rewrite the text.
    if (parsed?.getTime() !== this.expires?.getTime()) this.expires = parsed;
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

  /** The subject chips, one per subject the file holds, in the order it holds them. */
  subjectChips(): NxsChipItem[] {
    return this.subjects.map((id) => {
      const label = this.subjectPillLabel(id);
      return {
        id,
        label,
        removeLabel: this.translate.instant('shared.remove-item', { name: label }),
      };
    });
  }

  /** The nature chip: one when the file has a nature, shown as its pill label. */
  natureChips(): NxsChipItem[] {
    return this.nature ? [this.chipFor(this.nature, this.naturePillLabel(this.nature))] : [];
  }

  /** The coverage chip: one when the file has a coverage, shown as its pill label. */
  coverageChips(): NxsChipItem[] {
    return this.coverage
      ? [this.chipFor(this.coverage, this.coveragePillLabel(this.coverage))]
      : [];
  }

  private chipFor(id: string, label: string): NxsChipItem {
    return {
      id,
      label,
      removeLabel: this.translate.instant('shared.remove-item', { name: label }),
    };
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

  /** The banner and chip set are rendered by ID, so a component registered under one replaces the built-in. */
  readonly bannerId = NXS_PRIMITIVE_IDS.banner;
  readonly chipSetId = NXS_PRIMITIVE_IDS.chipSet;

  /** A chip set rendered by ID binds no outputs, so each removal reaches the page as a handler. */
  readonly removeNatureChip = (): void => this.clearNature();
  readonly removeCoverageChip = (): void => this.clearCoverage();
  readonly removeSubjectChip = (item: NxsChipItem): void => this.removeSubject(item.id);

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

  /**
   * Opens the properties step, each file starting as plain Create would start it
   * (`importDocTypeFor`). A location typed and not yet committed is committed first, as plain
   * Create does: the blur commits it only after a delay, so a quick click would otherwise start
   * the files as types the previous folder allows. When that commit changes the folder, whose
   * types have not been read yet, this stops; Add properties is offered again once they load.
   */
  startImportProperties(): void {
    const folderBeforeCommit = this.parentPath();
    this.commitLocationInput();
    if (this.importRestricted() || this.importTypesUnavailable()) return;
    if (this.parentPath() !== folderBeforeCommit) return;
    const files = this.uploads.pending();
    if (files.length === 0) return;

    const allowedTypes = this.importBlobTypeNames();
    const entries: StagedImportFile[] = files.map((file) => ({
      file,
      checked: true,
      docType: importDocTypeFor(file, allowedTypes),
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

  /**
   * Starts each staged file whose type `importTypes`, this folder's, does not include again, as
   * Add properties would start it here (`importDocTypeFor`). A type the folder allows is kept, the
   * one the form shows included; a form showing no type is left for the user to choose.
   */
  private reresolveImportEntryTypes(importTypes: readonly string[]): void {
    const entries = this.importEntries();
    if (entries.some((entry) => !importTypes.includes(entry.docType))) {
      this.importEntries.set(
        entries.map((entry) =>
          importTypes.includes(entry.docType)
            ? entry
            : { ...entry, docType: importDocTypeFor(entry.file, importTypes) },
        ),
      );
    }
    const shown = this.importDocType();
    const current = this.importEntries()[this.importFileIndex()];
    if (shown && !importTypes.includes(shown) && current) {
      this.importDocType.set(importDocTypeFor(current.file, importTypes));
    }
  }

  /**
   * Creates the checked files with their properties. As plain Create does, it commits a location
   * typed on this step and stops when that changes the folder, whose types have not been read
   * yet; and it refuses while `importPropertiesTypesBlocked` holds, the button aside, so no file
   * is created as a type the folder does not allow.
   */
  runImportWithProperties(): void {
    const folderBeforeCommit = this.parentPath();
    this.commitLocationInput();
    if (this.importPropertiesTypesBlocked()) return;
    if (this.parentPath() !== folderBeforeCommit) return;
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
      // The picked day at UTC midnight, as the edit dialogs write it (NXSAT-727).
      'dc:expired': utcMidnightOf(state.expires),
    };
  }

  /**
   * The create form's values. A Note gets an empty body in the chosen format unless the form
   * filled one in — a create layout or a `documentCreate` component may offer `note:note`.
   */
  private buildDocumentProperties(
    docType: string,
    formProperties: Record<string, unknown>,
  ): Record<string, unknown> {
    const props: Record<string, unknown> = { ...formProperties };
    if (docType === 'Note') {
      const body = props['note:note'];
      if (typeof body !== 'string' || body.trim() === '') {
        props['note:note'] = defaultNoteContent(this.noteFormat);
        props['note:mime_type'] = this.noteFormat;
      } else {
        props['note:mime_type'] ??= this.noteFormat;
      }
    }
    return props;
  }

  /**
   * Creates the document from the type's create form. The form checks its fields first and
   * shows each error on its field; Nuxeo's constraint messages go back to the fields they name.
   */
  createDocument(): void {
    this.commitLocationInput();
    if (this.locationRestricted()) return;
    const path = this.parentPath();
    const docType = this.selectedDocType();
    const form = this.layoutForm();
    if (!path || !docType || !form?.ready() || this.mainFileUnsettled()) return;

    this.error.set(null);
    if (!form.validate()) return;

    const properties = this.buildDocumentProperties(docType.type, form.changedProperties());
    const rawTitle = properties['dc:title'];
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    const name = sanitizeDocumentName(title);
    const mainFile = this.mainFile();
    const hasBlob = this.holdsMainBlob(docType.type);

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
        next: (doc) =>
          this.finishCreateAndNavigate(doc, title || doc.title, docType.type, !!mainFile),
        error: (err: { error?: { message?: string }; message?: string }) => {
          const refused = readValidationFailure(
            err,
            this.translate.instant('browse.create-import-dialog.not-accepted'),
          );
          if (refused) {
            const unplaced = form.showServerErrors(refused);
            if (unplaced.length) this.error.set(unplaced.join(' '));
            return;
          }
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

  /** Files dropped on the import tab's zone, or chosen with its button. */
  stageImportFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    this.uploads.stage(files);
    this.importError.set(null);
  }

  removeUploadAt(i: number): void {
    const item = this.uploads.items()[i];
    if (item) this.uploads.remove(item.id);
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

  /**
   * Uploads the pending files in one batch, each file followed in the queue. A failure keeps the
   * files already created, says which one was refused, and leaves it and the rest for another try.
   *
   * Each file starts as Add properties would start it (`importDocTypeFor`): the stock type its
   * MIME type suggests if the folder allows it, else the first allowed type that keeps a main
   * file. `DocumentImportService.importFiles` would send `File` whatever the folder allows, and
   * Nuxeo creates it anyway, so this resolves the type here and calls `importFilesWithProperties`.
   */
  runUpload(): void {
    const folderBeforeCommit = this.parentPath();
    this.commitLocationInput();
    if (this.importRestricted() || this.importTypesUnavailable()) return;
    // A location typed and not yet committed — the blur commits it only after a delay. Its
    // folder's types have not been read, so the files would start as types the previous folder
    // allows. Stop here; Create is offered again once the new folder's types load.
    if (this.parentPath() !== folderBeforeCommit) return;
    const path = this.parentPath();
    const files = this.uploads.pending();
    if (!path || files.length === 0) return;
    const allowedTypes = this.importBlobTypeNames();
    const entries: ImportFileEntry[] = files.map((file) => ({
      file,
      docType: importDocTypeFor(file, allowedTypes),
      properties: { 'dc:title': titleFromFileName(file.name) },
    }));
    this.busy.set(true);
    this.error.set(null);
    this.importError.set(null);
    this.uploadProgress.set(null);
    this.uploads.start();
    this.importService
      .importFilesWithProperties(path, entries, {
        onProgress: (progress) => {
          this.uploadProgress.set(progress);
          this.uploads.progress(progress);
        },
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
          this.uploads.complete(docs);
          const created = this.uploads.done();
          this.toast.show(
            this.translate.instant(
              created.length === 1
                ? 'common.count.created-file-one'
                : 'common.count.created-file-many',
              { count: created.length },
            ),
          );
          this.dialogRef.close({
            refreshed: true,
            path,
            navigateToUid: created.length === 1 ? created[0].document?.uid : undefined,
          });
        },
        error: (err: { error?: { message?: string }; message?: string }) => {
          this.uploads.fail(err);
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

  /** Closes; after a partly failed upload the folder already holds the files created, so it refreshes. */
  close(): void {
    if (this.uploads.done().length > 0) {
      this.dialogRef.close({ refreshed: true, path: this.parentPath() });
      return;
    }
    this.dialogRef.close();
  }

  doneNavigateBrowse(): void {
    const p = this.parentPath();
    this.dialogRef.close({ refreshed: true, path: p });
  }
}
