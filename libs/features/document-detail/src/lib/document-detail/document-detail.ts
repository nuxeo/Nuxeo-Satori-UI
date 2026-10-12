import {
  Component,
  DestroyRef,
  LOCALE_ID,
  OnInit,
  OnDestroy,
  inject,
  isDevMode,
  signal,
  computed,
  effect,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AppExtensionsService,
  DescriptorLabelPipe,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  type ExtensionActionDescriptor,
  type ExtensionDocumentViewDescriptor,
  type ExtensionTabDescriptor,
} from '@nuxeo-satori/platform/extensions';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CdkAriaLive } from '@angular/cdk/a11y';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule, MatTabGroup } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';

import {
  NuxeoDocument,
  NuxeoAce,
  NuxeoAcl,
  AuditEntry,
  BrowseService,
  DirectoryEntry,
  DocumentDetailService,
  DirectoryService,
  L10nDirectoryEntry,
  formatHierarchicalL10nLabel,
  resolveNatureLabel,
  NuxeoComment,
  NuxeoApiBase,
  TaskService,
  NuxeoTask,
  WorkflowService,
  NuxeoWorkflow,
  NuxeoWorkflowModel,
  CURRENT_USERNAME,
  avatarColor,
  ARenderService,
  NUXEO_API_ORIGIN,
  navigableUrlOrNull,
  insecureAllowedForHost,
  originOf,
  TagService,
  ContentLakeIngestService,
  buildContentLakeIngestMarker,
  isContentLakeIngestCurrent,
  needsContentLakeIngest,
  readBlobDigest,
  resolveIngestMarkerWriteProperty,
  shouldProbeContentLakeIngestStatus,
  supportsContentLakeIngest,
  canManageDocumentPermissions,
  canWriteDocument,
  canRemoveDocument,
  canViewDocumentAuditLog,
  mergeDocumentPermissionsContext,
  auditActivityLabel,
  resolveAcePrincipal,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
  isBlobHoldingDocType,
  isFolderishDocument,
  isCollectionDocument,
  BrowseContextService,
  BROWSE_RETURN_MODE_PARAM,
  decodeNuxeoPathSegment,
  documentHasPersistedMainBlob,
  noteFormatLabel,
  normalizeNuxeoPath,
  parentNuxeoFolderPath,
  parseBrowseReturnMode,
  renderNoteMarkdown,
  isMailSendError,
  mailSendFailureMessage,
  readClipboardDocs,
  writeClipboardDocs,
  renderTrustedHtml,
  toBrowseRouterUrlForReturnMode,
  trustObjectUrl,
  type BrowseReturnMode,
  type ClipboardDoc,
  formatRelativeTime,
  formatAceDateRange,
  permissionRightLabel,
} from '@nuxeo-satori/platform/nuxeo-client';
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import { SatBreadcrumbsComponent, SatBreadcrumbsItem } from '@hylandsoftware/satori-ui/breadcrumbs';
import { SatTagModule, SatTagCategory } from '@hylandsoftware/satori-ui/tag';
import {
  AiGatewayService,
  AiChatService,
  AiFeatureFlagService,
  aiErrorMessage,
  type SummarizeResponse,
  type SuggestedTag,
  type ClassifyResponse,
  type SimilarDoc,
  type SentimentItem,
  type SentimentResponse,
} from '@agentic-ui/shared/ai-client';
import {
  KeClientService,
  KeEnrichmentError,
  type KeEnrichRequest,
  type KeEnrichmentResult,
} from '@agentic-ui/shared/ke-client';
import { DocumentLayoutComponent } from '@agentic-ui/shared/document-layouts';
import { KdClientService } from '@agentic-ui/shared/kd-client';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  map,
  Observable,
  of,
  Subject,
  switchMap,
  throwError,
  timer,
} from 'rxjs';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
  DocumentViewerComponent,
  ExportDialogComponent,
  ExportDialogData,
  ExportType,
  ShareDialogComponent,
  ShareDialogData,
  type ExifData,
  type IptcData,
  type PictureInfo,
  type PictureView,
  type StoryboardItem,
  type VideoInfo,
  type VideoSource,
  provideTranslatedDatepickerIntl,
  MatTabListKeydownDirective,
} from '@nuxeo-satori/platform/ui';
import { AddToCollectionDialogComponent } from '../add-to-collection-dialog/add-to-collection-dialog';
import {
  CreateVersionDialogComponent,
  CreateVersionDialogData,
} from '../create-version-dialog/create-version-dialog';
import { PublishDialogComponent, PublishDialogData } from '../publish-dialog/publish-dialog';
import { DriveDialogComponent, type DriveDialogData } from '../drive-dialog/drive-dialog';
import { AttachmentPreviewDialogComponent } from '../attachment-preview-dialog/attachment-preview-dialog';
import { ReplaceAttachmentDialogComponent } from '../replace-attachment-dialog/replace-attachment-dialog';
import { RemoveAttachmentDialogComponent } from '../remove-attachment-dialog/remove-attachment-dialog';
import { EditDocumentDialogComponent } from '../edit-document-dialog/edit-document-dialog';
import { NoteEditorComponent } from '../note-editor/note-editor';
import { documentTypeTraits, type PackagedDocumentView } from './document-type-traits';
import {
  AddPermissionDialogComponent,
  AddPermissionDialogData,
  DeletePermissionDialogComponent,
  DeletePermissionDialogData,
  ShareExternalDialogComponent,
  ShareExternalDialogData,
  UpdatePermissionDialogComponent,
  UpdatePermissionDialogData,
} from '@agentic-ui/shared-permission-dialogs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface SectionNode {
  doc: NuxeoDocument;
  children: SectionNode[];
  expanded: boolean;
}

const TAG_CATEGORIES: SatTagCategory[] = [
  'yellow',
  'blue',
  'teal',
  'purple',
  'red',
  'pink',
  'orange',
];

/**
 * Sentinel value the Hyland Knowledge Enrichment `text-classification` action returns
 * when the model cannot match the document to any of the supplied candidate classes.
 * We must never write this to `dc:nature` — it is not a valid vocabulary id and Nuxeo
 * will reject the PUT with HTTP 422 ("Cannot find vocabulary value").
 *
 * See AGENTS/08-bug-patterns.md ("AI free-form output written to a vocabulary field").
 */
const KE_NO_MATCH_SENTINEL = 'not_from_provided_classes';

type KeUiAction =
  | 'text-classification'
  | 'named-entity-recognition-text'
  | 'text-summarization'
  | 'image-enrichment';

/** Catalogue keys for the progress, success and failure message of each enrichment action. */
const KE_MESSAGE_KEYS: Record<KeUiAction, { start: string; success: string; failed: string }> = {
  'text-classification': {
    start: 'document-detail.message.ke-start-classification',
    success: 'document-detail.message.ke-success-classification',
    failed: 'document-detail.message.ke-failed-classification',
  },
  'named-entity-recognition-text': {
    start: 'document-detail.message.ke-start-entity-extraction',
    success: 'document-detail.message.ke-success-entity-extraction',
    failed: 'document-detail.message.ke-failed-entity-extraction',
  },
  'text-summarization': {
    start: 'document-detail.message.ke-start-summarization',
    success: 'document-detail.message.ke-success-summarization',
    failed: 'document-detail.message.ke-failed-summarization',
  },
  'image-enrichment': {
    start: 'document-detail.message.ke-start-image-enrichment',
    success: 'document-detail.message.ke-success-image-enrichment',
    failed: 'document-detail.message.ke-failed-image-enrichment',
  },
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  xml: 'text/xml',
  json: 'application/json',
  md: 'text/markdown',
};

@Component({
  selector: 'lib-document-detail',
  standalone: true,
  imports: [
    CdkAriaLive,
    DescriptorLabelPipe,
    TranslatePipe,
    DatePipe,
    NgTemplateOutlet,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTabListKeydownDirective,
    MatTooltipModule,
    MatMenuModule,
    MatSnackBarModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatSortModule,
    MatTableModule,
    MatPaginatorModule,
    MatChipsModule,
    MatAutocompleteModule,
    DocumentLayoutComponent,
    DocumentViewerComponent,
    ExtensionOutletComponent,
    NoteEditorComponent,
    SatAvatarModule,
    SatBreadcrumbsComponent,
    SatTagModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideNativeDateAdapter()],
  templateUrl: './document-detail.html',
  styleUrls: [
    './document-detail.scss',
    './document-detail-go-back-icon.scss',
    './document-detail-panel-close-focus.scss',
  ],
})
export class DocumentDetailComponent implements OnInit, OnDestroy {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly extensionRuleContext = inject(ExtensionRuleContextService);
  private readonly extensions = inject(AppExtensionsService);
  private readonly actionRegistry = inject(ExtensionActionRegistry);
  private readonly componentRegistry = inject(ExtensionComponentRegistry);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly browseService = inject(BrowseService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly browseContext = inject(BrowseContextService);
  private readonly directoryService = inject(DirectoryService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly taskService = inject(TaskService);
  private readonly workflowService = inject(WorkflowService);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly arenderService = inject(ARenderService);
  private readonly sanitizer = inject(DomSanitizer);
  /** `''` when the dev proxy is in use, in which case preview URLs arrive same-origin. */
  private readonly nuxeoApiOrigin = inject(NUXEO_API_ORIGIN);
  private readonly tagService = inject(TagService);
  private readonly aiGateway = inject(AiGatewayService);
  private readonly keClient = inject(KeClientService);
  private readonly contentLakeIngestService = inject(ContentLakeIngestService);
  private readonly kdClient = inject(KdClientService);
  private readonly aiChatService = inject(AiChatService);
  readonly featureFlags = inject(AiFeatureFlagService);

  /** Programmatic tab switches (e.g. Publishing link). */
  private readonly detailTabGroup = viewChild<MatTabGroup>('detailTabGroup');

  readonly doc = signal<NuxeoDocument | null>(null);

  /**
   * Publish the focused document to the extension rule context.
   *
   * `app.rules.canWrite`, `canRemove`, `canAddChildren`, `canManagePermissions`,
   * `hasDocument`, `isType`, `hasFacet`, `isNote` and the two trash rules all read
   * `ExtensionRuleContext.document`. Nothing populated it before, so every one
   * of them answered `false` while the reference doc described them as working.
   * This page is the only surface with a single document in focus, so it is the
   * one that owns the write; `ngOnDestroy` clears it again.
   */
  private readonly publishDocumentToRuleContext = effect(() =>
    this.extensionRuleContext.document.set(this.doc()),
  );

  /**
   * Publish this page's interface state, which the toolbar rules read.
   *
   * None of it is derivable from the document: favourite and subscription state
   * are separate fetches, clipboard membership is local storage, and "an
   * operation is in flight" is not a fact about the document at all. Without it
   * a toggle could not be two descriptors gated by opposite rules, and the
   * label a manifest sets for "Notify Me" would be overwritten by the component
   * whenever the user happened to be subscribed.
   *
   * Cleared in `ngOnDestroy` alongside the document, for the same reason.
   */
  private readonly publishFlagsToRuleContext = effect(() => {
    const busy = this.actionInProgress();
    this.extensionRuleContext.flags.set({
      favorite: this.isFavorite(),
      locked: this.isLocked(),
      subscribed: this.isSubscribed(),
      inClipboard: this.isInClipboard(),
      hasVersion: this.hasVersion(),
      aiEnabled: this.featureFlags.aiEnabled(),
      ...(busy ? { [`busy.${busy}`]: true } : {}),
    });
  });

  private readonly toolbarDescriptors = computed<readonly ExtensionActionDescriptor[]>(() =>
    this.extensions.resolve<ExtensionActionDescriptor>(
      EXTENSION_SLOTS.toolbar,
      this.extensionRuleContext.context(),
    ),
  );

  /** Inline toolbar controls — everything the descriptor list does not send to overflow. */
  readonly toolbarActions = computed(() =>
    this.toolbarDescriptors().filter((action) => !action.overflow),
  );

  /** The "More actions" menu. `overflow: false` in a manifest promotes an entry out of it. */
  readonly overflowActions = computed(() =>
    this.toolbarDescriptors().filter((action) => action.overflow),
  );

  /**
   * The tab strip, resolved through Layer 1.
   *
   * The five packaged bodies are still markup in this template and are matched
   * by id; a tab a manifest adds renders through `ExtensionOutletComponent`. So
   * hiding, reordering, relabelling and gating work for every tab, and adding
   * one works without touching this file.
   */
  readonly detailTabs = computed<readonly ExtensionTabDescriptor[]>(() =>
    this.extensions.resolve<ExtensionTabDescriptor>(
      EXTENSION_SLOTS.tabs,
      this.extensionRuleContext.context(),
    ),
  );

  /**
   * The View tab body contributed for this document, or `null` for the packaged view.
   *
   * The first `documentView` entry, by order, whose rule admits the focused document and
   * whose component is registered. An entry naming a component this build lacks is skipped
   * rather than chosen, so the manifest can precede the library that backs it. The registry
   * is not a signal; components register in environment initializers, before this page.
   */
  readonly documentView = computed<ExtensionDocumentViewDescriptor | null>(
    () =>
      this.extensions
        .resolve<ExtensionDocumentViewDescriptor>(
          EXTENSION_SLOTS.documentView,
          this.extensionRuleContext.context(),
        )
        .find((view) => this.componentRegistry.has(view.componentId ?? view.id)) ?? null,
  );

  /** What this page does differently for the focused document's type. See `document-type-traits.ts`. */
  private readonly typeTraits = computed(() => documentTypeTraits(this.doc()?.type));

  /**
   * The packaged View tab body for the focused document's type: what renders when no
   * `documentView` entry takes the tab, and when the entry that did fails to load.
   */
  readonly packagedDocumentView = computed<PackagedDocumentView>(() => this.typeTraits().view);

  /** `document` last, so a manifest `inputs.document` cannot stand in for the one on screen. */
  readonly documentViewInputs = computed<Readonly<Record<string, unknown>>>(() => ({
    ...this.documentView()?.inputs,
    document: this.doc(),
  }));

  /**
   * The id of the selected tab.
   *
   * The lazy loads behind Permissions, History and Publishing used to key off
   * the literal indices 2, 3 and 4. Once a manifest can hide or reorder a tab
   * those indices address a different tab, so they key off the id instead.
   */
  readonly activeTabId = computed<string | null>(
    () => this.detailTabs()[this.activeTabIndex()]?.id ?? null,
  );

  readonly loading = signal(true);
  readonly blobLoading = signal(false);
  readonly viewerLoading = computed(
    () =>
      this.loading() || (this.blobLoading() && !this.blobUrl() && this.videoSources().length === 0),
  );
  readonly error = signal<string | null>(null);
  readonly blobUrl = signal<SafeResourceUrl | null>(null);
  readonly noteContent = signal<string | null>(null);
  readonly noteHtml = signal<SafeHtml | null>(null);
  readonly noteSaving = signal(false);
  readonly focusNoteEditor = signal(false);
  readonly videoSources = signal<VideoSource[]>([]);
  readonly storyboard = signal<StoryboardItem[]>([]);
  /** Raw string: `video[poster]` is SecurityContext.NONE. See `DocumentViewerComponent.rawBlobUrl`. */
  readonly posterUrl = signal<string | null>(null);
  readonly hasPdfRendition = signal(false);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly pictureInfo = signal<PictureInfo | null>(null);
  readonly pictureViews = signal<PictureView[]>([]);
  readonly exifData = signal<ExifData | null>(null);
  readonly iptcData = signal<IptcData | null>(null);
  readonly videoInfo = signal<VideoInfo | null>(null);
  readonly arenderUrl = signal<SafeResourceUrl | null>(null);
  /** Bumped when the ARender previewer URL changes so the iframe is recreated (avoids stale session / wrong doc). */
  readonly arenderReloadId = signal(0);
  readonly propertiesPanelOpen = signal(true);
  readonly panelSubTab = signal<'properties' | 'comments' | 'activity'>('properties');
  /**
   * The unwrapped object URL behind `blobUrl`. Public and a signal because the template forwards
   * it to `lib-document-viewer[rawBlobUrl]` for the three `SecurityContext.NONE` bindings
   * (`source[src]`, `audio[src]`, `video[poster]`), where a `SafeResourceUrl` stringifies instead
   * of being unwrapped. `blobUrl` remains the wrapped value for `iframe[src]`.
   */
  readonly rawBlobUrl = signal<string | null>(null);
  /**
   * `Blob.type` of the main blob, i.e. the served `Content-Type`.
   *
   * Read by the template, so not private: it gates both the attachment dialog and the embedded
   * viewer's iframe branches, which must decide on what was served rather than on metadata.
   */
  readonly mainBlobType = signal<string>('');
  private videoObjectUrls: string[] = [];
  private storyboardObjectUrls: string[] = [];
  /** A storyboard load is already running for the current document. */
  private storyboardInFlight = false;
  private docUid = '';
  private metadataRefreshAttempt = 0;
  private blobLoadGeneration = 0;
  /** Set when navigating here immediately after create/import with a main blob. */
  private freshBlobDocument = false;
  /** Set when navigating here immediately after creating a Note. */
  private freshNoteDocument = false;
  private breadcrumbPathCache: string | null = null;
  private breadcrumbItemsCache: SatBreadcrumbsItem[] = [];

  // AI Insights state
  readonly aiSummary = signal<SummarizeResponse | null>(null);
  readonly aiSummaryLoading = signal(false);
  readonly aiSuggestedTags = signal<SuggestedTag[]>([]);
  readonly aiTagsLoading = signal(false);
  readonly aiClassification = signal<ClassifyResponse | null>(null);
  readonly aiClassifyLoading = signal(false);
  readonly aiSimilarDocs = signal<SimilarDoc[]>([]);
  readonly aiSimilarLoading = signal(false);
  readonly aiError = signal<string | null>(null);

  readonly aiSentimentMap = signal<Record<string, SentimentItem>>({});
  readonly aiThreadSummary = signal<string | null>(null);
  readonly aiSentimentLoading = signal(false);
  readonly keActionInFlight = signal<KeUiAction | null>(null);
  readonly keStatus = signal<string | null>(null);
  readonly keError = signal<string | null>(null);
  readonly contentLakeIngestInFlight = signal(false);
  readonly contentLakeIngestStatus = signal<string | null>(null);
  readonly contentLakeIngestError = signal<string | null>(null);
  /** Set after a successful ingest or CheckDigest probe when the marker cannot be persisted. */
  readonly contentLakePresenceVerified = signal(false);
  readonly contentLakePresenceChecking = signal(false);

  // Loaded from the Nuxeo `nature` directory and supplied as candidate classes to the
  // KE text-classification model. Sourcing live ids guarantees the value we write back
  // to `dc:nature` is in the vocabulary (Nuxeo enforces this and returns 422 otherwise).
  // Refreshed on each document navigation (Nuxeo Web UI parity).
  readonly natureVocabulary = signal<DirectoryEntry[]>([]);
  readonly coverageVocabulary = signal<L10nDirectoryEntry[]>([]);
  readonly subjectVocabulary = signal<L10nDirectoryEntry[]>([]);

  // Tag management state (nuxeo-tag-suggestion style)
  tagInput = '';
  readonly tagSearchResults = signal<string[]>([]);
  readonly showCreateTagOption = signal(false);
  readonly tagAdding = signal(false);
  private readonly tagSearch$ = new Subject<string>();
  /** Autocomplete selection also fires matChipInputTokenEnd — skip the duplicate add. */
  private skipNextChipInput = false;

  // Comments state
  readonly comments = signal<NuxeoComment[]>([]);
  readonly commentsLoading = signal(false);
  readonly newCommentText = signal('');
  readonly editingCommentId = signal<string | null>(null);
  readonly editingCommentText = signal('');
  readonly commentSaving = signal(false);
  readonly repliesMap = signal<Record<string, NuxeoComment[]>>({});
  readonly replyingToId = signal<string | null>(null);
  readonly replyText = signal('');
  private commentsLoaded = false;

  // Panel activity state (recent activity for the side panel)
  readonly panelActivity = signal<AuditEntry[]>([]);
  readonly panelActivityLoading = signal(false);
  private panelActivityLoaded = false;

  // Version state
  readonly versions = signal<NuxeoDocument[]>([]);
  readonly versionsLoading = signal(false);
  readonly versionDropdownOpen = signal(false);
  private versionsLoaded = false;

  readonly currentMajor = computed(() => {
    const d = this.doc();
    return Number(d?.properties['uid:major_version'] ?? 0);
  });

  readonly currentMinor = computed(() => {
    const d = this.doc();
    return Number(d?.properties['uid:minor_version'] ?? 0);
  });

  readonly hasVersion = computed(() => {
    return this.currentMajor() > 0 || this.currentMinor() > 0;
  });

  // Workflow / Task state
  readonly documentTasks = signal<NuxeoTask[]>([]);
  readonly documentTasksLoading = signal(false);
  readonly documentWorkflows = signal<NuxeoWorkflow[]>([]);
  readonly abandoningWorkflow = signal(false);
  readonly availableWorkflows = signal<NuxeoWorkflowModel[]>([]);
  readonly workflowsLoading = signal(false);
  readonly startingWorkflow = signal(false);
  readonly showStartProcessPanel = signal(false);
  readonly selectedWorkflowModel = signal('');

  // Document action states
  readonly isLocked = signal(false);
  readonly lockOwner = signal<string | null>(null);
  readonly lockCreated = signal<string | null>(null);
  /** Token of the lock request that owns `actionInProgress`; navigation invalidates it. */
  private lockRequest = 0;
  readonly isFavorite = signal(false);
  readonly isSubscribed = signal(false);
  readonly actionInProgress = signal<string | null>(null);
  readonly clipboardDocs = signal<ClipboardDoc[]>(readClipboardDocs());
  readonly isInClipboard = computed(() => this.clipboardDocs().some((d) => d.uid === this.docUid));

  // History tab state
  readonly auditEntries = signal<AuditEntry[]>([]);
  readonly auditLoading = signal(false);
  readonly auditTotalSize = signal(0);
  readonly auditPageSize = signal(20);
  readonly auditPageIndex = signal(0);
  readonly historyDisplayedColumns = [
    'eventId',
    'eventDate',
    'principalName',
    'category',
    'comment',
    'docLifeCycle',
  ];
  private historyLoaded = false;
  private permissionsTabLoaded = false;
  private activeTabIndex = signal(0);
  readonly permissionsLoading = signal(false);

  // History filters (signals so computed() reacts)
  readonly filterUsername = signal('');
  readonly filterDateFrom = signal<Date | null>(null);
  readonly filterDateTo = signal<Date | null>(null);
  readonly filterAction = signal('');
  readonly filterCategory = signal('');

  readonly availableActions = signal<DirectoryEntry[]>([]);
  readonly availableCategories = signal<DirectoryEntry[]>([]);
  private eventTypeLabelMap = new Map<string, string>();
  private eventCategoryLabelMap = new Map<string, string>();

  // Sort state
  private sortActive = signal('');
  private sortDirection = signal<'asc' | 'desc' | ''>('');

  // Publishing tab state
  readonly publishedDocs = signal<NuxeoDocument[]>([]);
  readonly publishLoading = signal(false);
  readonly sectionTree = signal<SectionNode[]>([]);
  readonly sectionsLoading = signal(false);
  readonly selectedSectionId = signal<string | null>(null);
  readonly publishing = signal(false);
  private publishTabLoaded = false;

  readonly mimeType = computed(() => {
    const d = this.doc();
    if (!d) return '';
    const noteMime = d.properties['note:mime_type'] as string | undefined;
    if (noteMime) return noteMime;
    const fc = d.properties['file:content'] as Record<string, unknown> | null;
    return this.resolveMainContentMime(fc, d);
  });

  /** A document whose body is note text, edited in the note editor, with no main file. */
  readonly isNoteDocument = computed(() => this.packagedDocumentView() === 'noteEditor');
  readonly hasPersistedMainBlob = computed(() => {
    const d = this.doc();
    return d ? documentHasPersistedMainBlob(d) : false;
  });
  readonly noteFormatDisplay = computed(() => noteFormatLabel(this.mimeType()));
  readonly noteEditorBody = computed(() => this.noteContent() ?? '');
  /** Parent folder for note RTE image uploads (Web UI stores uploaded pictures in the repository). */
  readonly noteImageUploadParentPath = computed(() => {
    const path = this.doc()?.path;
    if (!path) return null;
    const slash = path.lastIndexOf('/');
    return slash > 0 ? path.slice(0, slash) : '/';
  });

  readonly isImage = computed(() => this.mimeType().startsWith('image/'));
  readonly isPdf = computed(() => this.mimeType() === 'application/pdf');

  readonly fileName = computed(() => {
    const d = this.doc();
    if (!d) return '';
    const fc = d.properties['file:content'] as Record<string, unknown> | null;
    return (fc?.['name'] as string) ?? d.title;
  });

  readonly fileSize = computed(() => {
    const d = this.doc();
    if (!d) return '';
    const fc = d.properties['file:content'] as Record<string, unknown> | null;
    const len = Number(fc?.['length'] ?? 0);
    if (len === 0) return '';
    if (len < 1024) return `${len} B`;
    if (len < 1024 * 1024) return `${(len / 1024).toFixed(2)} KB`;
    return `${(len / (1024 * 1024)).toFixed(2)} MB`;
  });

  readonly breadcrumbItems = computed<SatBreadcrumbsItem[]>(() => {
    const d = this.doc();
    if (!d) return [];

    const path = d.path ?? '';
    const returnMode = this.browseReturnMode();
    const cacheKey = `${path}\0${d.title}\0${returnMode}`;
    if (cacheKey === this.breadcrumbPathCache) {
      return this.breadcrumbItemsCache;
    }

    const parts = path.split('/').filter(Boolean);
    parts.pop();
    this.breadcrumbPathCache = cacheKey;
    let accumulated = '/';
    this.breadcrumbItemsCache = parts.map((s) => {
      accumulated = normalizeNuxeoPath(`${accumulated}/${s}`);
      return {
        label: decodeNuxeoPathSegment(s),
        href: toBrowseRouterUrlForReturnMode(returnMode, accumulated),
      };
    });
    return this.breadcrumbItemsCache;
  });

  private browseReturnMode(): BrowseReturnMode {
    return parseBrowseReturnMode(this.route.snapshot.queryParamMap.get(BROWSE_RETURN_MODE_PARAM));
  }

  private browseUrlForPath(nuxeoPath: string): string {
    return toBrowseRouterUrlForReturnMode(this.browseReturnMode(), nuxeoPath);
  }

  onBreadcrumbClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (href) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  readonly versionLabel = computed(() => {
    const d = this.doc();
    if (!d) return '';
    const label = `${this.currentMajor()}.${this.currentMinor()}`;
    return d.isCheckedOut ? `${label}+` : label;
  });

  readonly docState = computed(() => {
    const d = this.doc();
    if (!d) return '';
    return d.state ?? '';
  });

  readonly publicationCount = computed(() => this.publishedDocs().length);

  readonly contributors = computed(() => {
    const d = this.doc();
    if (!d) return [];
    return (d.properties['dc:contributors'] as string[]) ?? [];
  });

  readonly tags = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const raw = d.properties['nxtag:tags'] as Array<{ label: string }> | string[] | null;
    if (!raw) return [];
    return raw.map((t) => (typeof t === 'string' ? t : t.label));
  });

  readonly description = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:description'] as string) ?? '';
  });

  readonly documentCategory = computed(() => {
    const d = this.doc();
    const id = (d?.properties['dc:nature'] as string) ?? '';
    if (!id) return '';
    return resolveNatureLabel(id, this.natureVocabulary());
  });

  readonly documentCoverage = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:coverage'] as string) ?? '';
  });

  readonly documentCoverageDisplay = computed(() =>
    formatHierarchicalL10nLabel(this.documentCoverage(), this.coverageVocabulary()),
  );

  readonly documentSubjects = computed(() => {
    const d = this.doc();
    const subjects = d?.properties['dc:subjects'] as string[] | undefined;
    return subjects ?? [];
  });

  readonly documentSubjectsDisplay = computed(() =>
    this.documentSubjects()
      .map((id) => formatHierarchicalL10nLabel(id, this.subjectVocabulary()))
      .join(', '),
  );

  readonly fileMimeType = computed(() => {
    const d = this.doc();
    if (!d) return '';
    const fileContent = d.properties['file:content'] as Record<string, unknown> | null;
    const directMime = (fileContent?.['mime-type'] as string) ?? '';
    if (directMime) return directMime;

    const pictureViews = d.properties['picture:views'] as
      Array<Record<string, unknown>> | undefined;
    const pictureContent = pictureViews?.[0]?.['content'] as Record<string, unknown> | undefined;
    return (pictureContent?.['mime-type'] as string) ?? '';
  });

  readonly supportsTextKnowledgeEnrichment = computed(
    () => this.fileMimeType() === 'application/pdf',
  );
  readonly supportsImageKnowledgeEnrichment = computed(() => {
    const mime = this.fileMimeType();
    return mime.startsWith('image/') || this.typeTraits().picture;
  });
  readonly canIngestToContentLake = computed(() => needsContentLakeIngest(this.doc()));
  readonly showsContentLakeIngested = computed(
    () => isContentLakeIngestCurrent(this.doc()) || this.contentLakePresenceVerified(),
  );
  readonly showsContentLakeIngestAction = computed(() => supportsContentLakeIngest(this.doc()));

  readonly attachments = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const files = d.properties['files:files'] as Array<{ file: Record<string, unknown> }> | null;
    if (!files) return [];
    return files
      .filter((f) => f.file)
      .map((f, i) => ({
        index: i,
        name: (f.file['name'] as string) ?? 'Untitled',
        size: Number(f.file['length'] ?? 0),
        mimeType: (f.file['mime-type'] as string) ?? '',
        url: (f.file['data'] as string) ?? '',
      }));
  });

  /** Mirrors nuxeo-web-ui `nuxeo-document-collections`: shows each entry's `title`. */
  readonly collections = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const cols = d.contextParameters?.['collections'] as
      Array<{ uid: string; title: string; path: string; type?: string }> | undefined;
    // Web UI uses contextParameters.favorites for the star; collections enricher
    // also lists the Favorites folder (type Favorites) — exclude it here.
    return (cols ?? []).filter((col) => col.type !== 'Favorites');
  });

  /** Mirrors nuxeo-ui-elements FiltersBehavior.hasCollections (section hidden when false). */
  readonly hasCollections = computed(() => this.collections().length > 0);

  readonly creator = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:creator'] as string) ?? '';
  });

  readonly created = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:created'] as string) ?? '';
  });

  readonly modified = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:modified'] as string) ?? d?.lastModified ?? '';
  });

  readonly expires = computed(() => {
    const d = this.doc();
    return (d?.properties['dc:expired'] as string) ?? '';
  });

  // Permissions tab computed
  readonly localAces = computed<NuxeoAce[]>(() => {
    const d = this.doc();
    const acls = d?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    const local = acls.find((a) => a.name === 'local');
    return local?.aces.filter((ace) => ace.granted && !ace.externalUser) ?? [];
  });

  readonly inheritedAces = computed<NuxeoAce[]>(() => {
    const d = this.doc();
    const acls = d?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    const inherited = acls.find((a) => a.name === 'inherited');
    return inherited?.aces.filter((ace) => ace.granted) ?? [];
  });

  readonly externalAces = computed<NuxeoAce[]>(() => {
    const d = this.doc();
    const acls = d?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    return acls.flatMap((a) => a.aces).filter((ace) => ace.externalUser && ace.granted);
  });

  readonly isInheritanceBlocked = computed<boolean>(() => {
    const d = this.doc();
    const acls = d?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return false;
    return !acls.some((a) => a.name === 'inherited');
  });

  readonly canManagePermissions = computed(() => canManageDocumentPermissions(this.doc()));
  readonly canWriteDoc = computed(() => canWriteDocument(this.doc()));
  readonly canRemoveDoc = computed(() => canRemoveDocument(this.doc()));

  permissionLabel(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  aceTimeFrame(ace: NuxeoAce): string {
    return formatAceDateRange(
      ace.begin,
      ace.end,
      (key, params) => this.translate.instant(key, params),
      this.locale,
    );
  }

  displayUsername(ace: NuxeoAce): string {
    return resolveAcePrincipal(ace.username).replace(/^transient\//, '');
  }

  aceGrantedBy(ace: NuxeoAce): string {
    const creator = ace.creator ? resolveAcePrincipal(ace.creator) : '';
    return creator || '—';
  }

  readonly filteredAuditEntries = computed(() => {
    let entries = this.auditEntries();
    const username = this.filterUsername();
    const dateFrom = this.filterDateFrom();
    const dateTo = this.filterDateTo();
    const action = this.filterAction();
    const category = this.filterCategory();
    const active = this.sortActive();
    const direction = this.sortDirection();

    if (username) {
      const lower = username.toLowerCase();
      entries = entries.filter((e) => e.principalName.toLowerCase().includes(lower));
    }
    if (dateFrom) {
      const from = dateFrom.getTime();
      entries = entries.filter((e) => new Date(e.eventDate).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      entries = entries.filter((e) => new Date(e.eventDate).getTime() <= to.getTime());
    }
    if (action) {
      entries = entries.filter((e) => e.eventId === action);
    }
    if (category) {
      entries = entries.filter((e) => e.category === category);
    }

    if (active && direction) {
      const dir = direction === 'asc' ? 1 : -1;
      const key = active as keyof AuditEntry;
      entries = [...entries].sort((a, b) => {
        const va = a[key] ?? '';
        const vb = b[key] ?? '';
        return va < vb ? -dir : va > vb ? dir : 0;
      });
    }

    return entries;
  });

  /** `enabledRule` renders a control disabled rather than hiding it. */
  isToolbarActionEnabled(action: ExtensionActionDescriptor): boolean {
    return this.extensions.evaluateRule(action.enabledRule, this.extensionRuleContext.context());
  }

  /**
   * Inline toolbar buttons are `disabledInteractive` so a disabled one still shows its tooltip,
   * which means a click reaches here and has to be refused here.
   */
  runToolbarAction(action: ExtensionActionDescriptor): void {
    if (!this.isToolbarActionEnabled(action)) return;
    this.actionRegistry.execute(action, this.extensionRuleContext.context());
  }

  /** A manifest's `tooltip` wins; otherwise Unlock names who holds the lock. Null falls back to the label. */
  toolbarTooltip(action: ExtensionActionDescriptor): string | null {
    if (action.tooltip !== undefined) return action.tooltip;
    return action.id === 'app.toolbar.unlock' ? this.lockedByLabel() : null;
  }

  /** The highlighted padlock Web UI shows on a locked document. */
  isToolbarActionActive(action: ExtensionActionDescriptor): boolean {
    return action.id === 'app.toolbar.unlock' && this.isLocked();
  }

  private lockedByLabel(): string | null {
    const owner = this.lockOwner();
    const created = this.lockCreated();
    if (!this.isLocked() || !owner || !created) return null;
    const date = new Date(created).toLocaleDateString(this.locale, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return this.translate.instant('common.lock.locked-by', { owner, date });
  }

  /**
   * The behaviour behind the packaged toolbar ids.
   *
   * Registered from the component because every handler closes over this
   * instance, and withdrawn on destroy for the same reason — a handler left
   * registered keeps a destroyed component reachable and the next invocation
   * runs against dead state. Withdrawing the registration rather than the ids
   * is what leaves a customer's handler for the same id untouched.
   *
   * The two halves of each toggle share one method, exactly as the single
   * `(click)` binding did before: which half is *offered* is the rules' job.
   */
  private registerToolbarHandlers(): void {
    const handlers: Readonly<Record<string, () => void>> = {
      'app.toolbar.edit': () => this.onEditClick(),
      'app.toolbar.editProperties': () => this.onEditClick(),
      'app.toolbar.addToCollection': () => this.openAddToCollectionDialog(),
      'app.toolbar.delete': () => this.trashDocument(),
      'app.toolbar.lock': () => this.toggleLock(),
      'app.toolbar.unlock': () => this.toggleLock(),
      'app.toolbar.addToFavorites': () => this.toggleFavorite(),
      'app.toolbar.removeFromFavorites': () => this.toggleFavorite(),
      'app.toolbar.share': () => this.shareDocument(),
      'app.toolbar.publish': () => this.openPublishDialog(),
      'app.toolbar.subscribe': () => this.toggleSubscription(),
      'app.toolbar.unsubscribe': () => this.toggleSubscription(),
      'app.toolbar.addToClipboard': () => this.toggleClipboard(),
      'app.toolbar.removeFromClipboard': () => this.toggleClipboard(),
      'app.toolbar.export': () => this.exportDocument(),
      'app.toolbar.startProcess': () => this.openStartProcess(),
    };

    const registration = this.actionRegistry.registerPackaged(
      Object.fromEntries(
        Object.entries(handlers).map(([id, run]) => [id, { execute: () => run() }]),
      ),
    );
    this.destroyRef.onDestroy(() => registration.unregister());
  }

  ngOnInit(): void {
    this.registerToolbarHandlers();
    this.tagSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) =>
          term.length > 0
            ? this.tagService.searchTags(term).pipe(catchError(() => of([])))
            : of([]),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        const existing = this.tags();
        const filtered = results.filter((r) => !existing.includes(r));
        this.tagSearchResults.set(filtered);
        const exactMatch = results.some((r) => r.toLowerCase() === this.tagInput.toLowerCase());
        this.showCreateTagOption.set(this.tagInput.trim().length > 0 && !exactMatch);
      });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const uid = params.get('uid');
      if (!uid) {
        this.error.set(this.translate.instant('document-detail.message.no-document-id-provided'));
        this.loading.set(false);
        return;
      }
      this.freshBlobDocument =
        this.route.snapshot.queryParamMap.get('fresh') === '1' ||
        this.readFreshBlobNavigationState();
      this.freshNoteDocument = this.readFreshNoteNavigationState();
      this.resetState();
      this.releaseLockRequest();
      this.docUid = uid;
      this.loadVocabularies();
      this.loadDocument(uid);
    });
  }

  private readFreshBlobNavigationState(): boolean {
    const fromCurrent = this.router.getCurrentNavigation()?.extras?.state as
      { freshBlobDocument?: boolean } | undefined;
    if (fromCurrent?.freshBlobDocument === true) {
      return true;
    }
    const historyState = history.state as { freshBlobDocument?: boolean } | undefined;
    return historyState?.freshBlobDocument === true;
  }

  private readFreshNoteNavigationState(): boolean {
    const fromCurrent = this.router.getCurrentNavigation()?.extras?.state as
      { freshNote?: boolean } | undefined;
    if (fromCurrent?.freshNote === true) {
      return true;
    }
    const historyState = history.state as { freshNote?: boolean } | undefined;
    return historyState?.freshNote === true;
  }

  /** Pre-loads vocabulary data for metadata display and KE classification (live queries). */
  private loadVocabularies(): void {
    this.directoryService
      .getEntries('nature')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => this.natureVocabulary.set(entries),
        error: () => this.natureVocabulary.set([]),
      });

    forkJoin({
      coverage: this.directoryService.getAllL10nEntries('l10ncoverage'),
      subjects: this.directoryService.getAllL10nEntries('l10nsubjects'),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ coverage, subjects }) => {
          this.coverageVocabulary.set(coverage);
          this.subjectVocabulary.set(subjects);
        },
        error: () => {
          this.coverageVocabulary.set([]);
          this.subjectVocabulary.set([]);
        },
      });
  }

  private resetState(): void {
    this.metadataRefreshAttempt = 0;
    this.blobLoadGeneration += 1;
    // `resetViewerState()` above now revokes and clears `rawBlobUrl`, so the block that used to
    // repeat it here is gone. Two places doing the same cleanup is how they drift apart.
    this.resetViewerState();
    this.doc.set(null);
    this.blobUrl.set(null);
    this.blobLoading.set(false);
    this.arenderUrl.set(null);
    this.error.set(null);
    this.comments.set([]);
    this.repliesMap.set({});
    this.commentsLoaded = false;
    this.panelActivity.set([]);
    this.panelActivityLoaded = false;
    this.versions.set([]);
    this.versionsLoaded = false;
    this.versionDropdownOpen.set(false);
    this.documentTasks.set([]);
    this.documentWorkflows.set([]);
    this.keActionInFlight.set(null);
    this.keStatus.set(null);
    this.keError.set(null);
    this.contentLakeIngestInFlight.set(false);
    this.contentLakeIngestStatus.set(null);
    this.contentLakeIngestError.set(null);
    this.contentLakePresenceVerified.set(false);
    this.contentLakePresenceChecking.set(false);
    this.panelSubTab.set('properties');
    this.historyLoaded = false;
    this.permissionsTabLoaded = false;
    this.publishTabLoaded = false;
  }

  generateSummary(): void {
    if (!this.docUid) return;
    this.aiSummaryLoading.set(true);
    this.aiError.set(null);
    this.aiGateway.summarize(this.docUid).subscribe({
      next: (res) => {
        this.aiSummary.set(res);
        this.aiSummaryLoading.set(false);
      },
      error: (err) => {
        this.aiError.set(
          aiErrorMessage(
            err,
            this.translate.instant('document-detail.message.summary-generation-failed'),
          ),
        );
        this.aiSummaryLoading.set(false);
      },
    });
  }

  suggestTags(): void {
    if (!this.docUid) return;
    this.aiTagsLoading.set(true);
    this.aiError.set(null);
    this.aiGateway.suggestTags(this.docUid).subscribe({
      next: (res) => {
        this.aiSuggestedTags.set(res.tags);
        this.aiTagsLoading.set(false);
      },
      error: (err) => {
        this.aiError.set(
          aiErrorMessage(
            err,
            this.translate.instant('document-detail.message.tag-suggestion-failed'),
          ),
        );
        this.aiTagsLoading.set(false);
      },
    });
  }

  applyAiTag(tagLabel: string): void {
    if (!this.docUid) return;
    this.tagService.addTag(this.docUid, tagLabel).subscribe({
      next: () => {
        this.aiSuggestedTags.update((tags) => tags.filter((t) => t.label !== tagLabel));
        this.snackBar.open(
          this.translate.instant('common.tag-applied', { name: tagLabel }),
          this.translate.instant('common.ok'),
          { duration: 3000 },
        );
      },
      error: () =>
        this.snackBar.open(
          this.translate.instant('document-detail.message.failed-to-apply-tag'),
          this.translate.instant('common.dismiss'),
          { duration: 3000 },
        ),
    });
  }

  onTagSearch(term: string): void {
    this.tagSearch$.next(term);
  }

  selectTag(event: MatAutocompleteSelectedEvent): void {
    const label = String(event.option.value ?? '').trim();
    if (!label) return;
    this.skipNextChipInput = true;
    this.clearTagInput();
    event.option.deselect();
    this.applyInlineTag(label);
  }

  addInlineTagFromChip(event: MatChipInputEvent): void {
    if (this.skipNextChipInput) {
      this.skipNextChipInput = false;
      event.chipInput.clear();
      this.clearTagInput();
      return;
    }
    const label = (event.value ?? '').trim();
    event.chipInput.clear();
    this.clearTagInput();
    if (label) this.applyInlineTag(label);
  }

  private clearTagInput(): void {
    this.tagInput = '';
    this.tagSearchResults.set([]);
    this.showCreateTagOption.set(false);
    this.tagSearch$.next('');
  }

  private applyInlineTag(label: string): void {
    if (!label || !this.docUid || this.tagAdding()) return;
    this.tagAdding.set(true);
    this.tagService
      .addTag(this.docUid, label)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.doc.update((d) => {
            if (!d) return d;
            const raw = (d.properties['nxtag:tags'] as Array<{ label: string } | string>) ?? [];
            const normalized: Array<{ label: string }> = raw.map((t) =>
              typeof t === 'string' ? { label: t } : t,
            );
            const alreadyExists = normalized.some((t) => t.label === label);
            return {
              ...d,
              properties: {
                ...d.properties,
                'nxtag:tags': alreadyExists ? normalized : [...normalized, { label }],
              },
            };
          });
          this.clearTagInput();
          this.tagAdding.set(false);
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('browse.message.failed-to-add-tag'),
            this.translate.instant('common.dismiss'),
            { duration: 3000 },
          );
          this.tagAdding.set(false);
        },
      });
  }

  removeInlineTag(tagLabel: string): void {
    if (!this.docUid) return;
    this.tagService
      .removeTag(this.docUid, tagLabel)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.doc.update((d) => {
            if (!d) return d;
            const raw = (d.properties['nxtag:tags'] as Array<{ label: string } | string>) ?? [];
            const normalized: Array<{ label: string }> = raw.map((t) =>
              typeof t === 'string' ? { label: t } : t,
            );
            return {
              ...d,
              properties: {
                ...d.properties,
                'nxtag:tags': normalized.filter((t) => t.label !== tagLabel),
              },
            };
          });
        },
        error: () =>
          this.snackBar.open(
            this.translate.instant('browse.message.failed-to-remove-tag'),
            this.translate.instant('common.dismiss'),
            { duration: 3000 },
          ),
      });
  }

  classifyDocument(): void {
    if (!this.docUid) return;
    this.aiClassifyLoading.set(true);
    this.aiError.set(null);
    this.aiGateway.classify(this.docUid).subscribe({
      next: (res) => {
        this.aiClassification.set(res);
        this.aiClassifyLoading.set(false);
      },
      error: (err) => {
        this.aiError.set(
          aiErrorMessage(
            err,
            this.translate.instant('document-detail.message.classification-failed'),
          ),
        );
        this.aiClassifyLoading.set(false);
      },
    });
  }

  findSimilar(): void {
    if (!this.docUid) return;
    this.aiSimilarLoading.set(true);
    this.aiError.set(null);
    this.aiGateway.findSimilar(this.docUid).subscribe({
      next: (res) => {
        this.aiSimilarDocs.set(res.documents);
        this.aiSimilarLoading.set(false);
      },
      error: (err) => {
        this.aiError.set(
          aiErrorMessage(
            err,
            this.translate.instant('document-detail.message.similar-doc-search-failed'),
          ),
        );
        this.aiSimilarLoading.set(false);
      },
    });
  }

  runTextClassification(): void {
    const candidates = this.natureVocabulary().map((entry) => entry.id);
    if (candidates.length === 0) {
      const message = this.translate.instant(
        'document-detail.message.classification-unavailable-vocabulary',
      );
      this.keError.set(message);
      this.toast(message);
      return;
    }
    this.runKnowledgeEnrichment('text-classification', {
      actions: ['text-classification'],
      classes: candidates,
    });
  }

  runTextEntityExtraction(): void {
    this.runKnowledgeEnrichment('named-entity-recognition-text', {
      actions: ['named-entity-recognition-text'],
    });
  }

  runTextSummarization(): void {
    this.runKnowledgeEnrichment('text-summarization', {
      actions: ['text-summarization'],
      maxWordCount: 150,
    });
  }

  runImageEnrichment(): void {
    this.runKnowledgeEnrichment('image-enrichment', {
      actions: ['image-description', 'named-entity-recognition-image'],
      maxWordCount: 100,
    });
  }

  ingestToContentLake(): void {
    const uid = this.docUid;
    if (!uid || !this.canIngestToContentLake() || this.contentLakeIngestInFlight()) {
      return;
    }

    this.contentLakeIngestInFlight.set(true);
    this.contentLakeIngestError.set(null);
    this.contentLakeIngestStatus.set(null);

    this.contentLakeIngestService
      .startIngest([uid])
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((command) => this.contentLakeIngestService.waitUntilComplete(command.commandId)),
        switchMap((status) =>
          this.contentLakeIngestService
            .markIngested([uid])
            .pipe(map((updatedDocs) => ({ status, updatedDoc: updatedDocs[0] ?? null }))),
        ),
        finalize(() => this.contentLakeIngestInFlight.set(false)),
      )
      .subscribe({
        next: ({ status, updatedDoc }) => {
          if (status.error || status.errorCount > 0) {
            const message = this.translate.instant(
              'document-detail.message.content-lake-ingest-finished-with-errors',
              { count: status.errorCount },
            );
            this.contentLakeIngestError.set(message);
            this.contentLakeIngestStatus.set(null);
            this.toast(message);
            return;
          }

          const message = this.translate.instant(
            'document-detail.message.ingested-to-content-lake',
          );
          this.contentLakeIngestStatus.set(message);
          this.contentLakePresenceVerified.set(true);
          if (updatedDoc) {
            this.doc.set(updatedDoc);
          } else {
            this.applyContentLakeIngestMarkerLocally();
          }
          this.toast(message);
        },
        error: (err: Error) => {
          const message =
            err.message ||
            this.translate.instant('document-detail.message.content-lake-ingest-failed');
          this.contentLakeIngestError.set(message);
          this.contentLakeIngestStatus.set(null);
          this.toast(message);
        },
      });
  }

  isKeActionRunning(action: KeUiAction): boolean {
    return this.keActionInFlight() === action;
  }

  navigateToDoc(uid: string): void {
    void this.router.navigateByUrl(`/doc/${uid}`);
  }

  openAiAssistant(): void {
    this.aiChatService.openPanel({ docId: this.docUid ?? undefined, page: this.router.url });
  }

  analyzeCommentSentiment(): void {
    const allComments = this.comments();
    if (!allComments.length) return;
    this.aiSentimentLoading.set(true);
    this.aiSentimentMap.set({});
    this.aiThreadSummary.set(null);

    const payload = allComments.map((c) => ({ id: c.id, text: c.text }));
    this.aiGateway.analyzeSentiment(payload).subscribe({
      next: (res: SentimentResponse) => {
        const map: Record<string, SentimentItem> = {};
        for (const item of res.sentiments) {
          map[item.id] = item;
        }
        this.aiSentimentMap.set(map);
        this.aiThreadSummary.set(res.threadSummary);
        this.aiSentimentLoading.set(false);
      },
      error: () => {
        this.aiSentimentLoading.set(false);
      },
    });
  }

  private runKnowledgeEnrichment(uiAction: KeUiAction, request: KeEnrichRequest): void {
    if (!this.docUid || this.keActionInFlight()) return;

    this.keActionInFlight.set(uiAction);
    this.keError.set(null);
    this.keStatus.set(this.keStartMessage(uiAction));

    this.detailService
      .fetchBlob(this.docUid)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((blob) =>
          this.keClient.enrich(blob, {
            ...request,
            sourceId: this.docUid,
          }),
        ),
        switchMap((result) => this.persistKnowledgeEnrichment(uiAction, result)),
        finalize(() => this.keActionInFlight.set(null)),
      )
      .subscribe({
        next: (updatedDoc) => {
          this.doc.set(updatedDoc);
          this.syncActionStates(updatedDoc);
          this.keStatus.set(this.keSuccessMessage(uiAction));
          this.toast(this.keSuccessMessage(uiAction));
        },
        error: (err) => {
          const message = this.resolveKnowledgeEnrichmentError(err, uiAction);
          this.keError.set(message);
          this.keStatus.set(null);
          this.toast(message);
        },
      });
  }

  private persistKnowledgeEnrichment(
    uiAction: KeUiAction,
    result: KeEnrichmentResult,
  ): Observable<NuxeoDocument> {
    const docId = this.docUid;
    const propertyUpdates: Record<string, unknown> = {};
    let tagsToApply: string[] = [];

    switch (uiAction) {
      case 'text-classification': {
        const category = result.textClassification?.result?.trim();
        const vocabularySize = this.natureVocabulary().length;

        if (!category) {
          console.warn('[KE] text-classification returned no category', result);
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-no-category'),
          );
        }
        if (category === KE_NO_MATCH_SENTINEL) {
          console.warn(
            `[KE] text-classification: no match against ${vocabularySize} candidate(s)`,
            { candidates: this.natureVocabulary().map((entry) => entry.id), result },
          );
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-no-category-match', {
              count: vocabularySize,
            }),
          );
        }
        // Map back to a vocabulary id. Accept either the id or the display label
        // (the LLM occasionally returns the human-readable label rather than the id).
        const resolvedId = this.resolveNatureVocabularyId(category);
        if (!resolvedId) {
          console.warn(`[KE] text-classification: "${category}" is not in the nature vocabulary`, {
            candidates: this.natureVocabulary().map((entry) => entry.id),
            result,
          });
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-category-not-in-vocabulary', {
              category,
              count: vocabularySize,
            }),
          );
        }
        propertyUpdates['dc:nature'] = resolvedId;
        break;
      }

      case 'text-summarization': {
        const summary = result.textSummary?.result?.trim();
        if (!summary) {
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-no-summary'),
          );
        }
        propertyUpdates['dc:description'] = summary;
        break;
      }

      case 'named-entity-recognition-text': {
        tagsToApply = this.collectNamedEntityTags(result.namedEntityText?.result);
        if (tagsToApply.length === 0) {
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-no-text-entities'),
          );
        }
        break;
      }

      case 'image-enrichment': {
        const description = result.imageDescription?.result?.trim();
        tagsToApply = this.collectNamedEntityTags(result.namedEntityImage?.result);

        if (description) {
          propertyUpdates['dc:description'] = description;
        }
        if (Object.keys(propertyUpdates).length === 0 && tagsToApply.length === 0) {
          return this.throwKeResultError(
            this.translate.instant('document-detail.message.ke-no-image-result'),
          );
        }
        break;
      }
    }

    const existingTags = new Set(this.tags().map((tag) => tag.toLowerCase()));
    const uniqueTags = tagsToApply.filter((tag) => !existingTags.has(tag.toLowerCase()));

    const update$ =
      Object.keys(propertyUpdates).length > 0
        ? this.browseService.updateDocument(docId, propertyUpdates)
        : of(null);
    const tags$ =
      uniqueTags.length > 0
        ? forkJoin(uniqueTags.map((tag) => this.tagService.addTag(docId, tag)))
        : of([]);

    return forkJoin({ updated: update$, tags: tags$ }).pipe(
      switchMap(() => this.detailService.getFullDocument(docId)),
    );
  }

  /**
   * Maps a KE classification result back to a Nuxeo `nature` vocabulary id.
   * Accepts a match against either `id` or `displayLabel` (case-insensitive) since
   * the LLM sometimes returns the human-readable label.
   */
  private resolveNatureVocabularyId(value: string): string | null {
    const needle = value.trim().toLowerCase();
    if (!needle) return null;
    const match = this.natureVocabulary().find(
      (entry) => entry.id.toLowerCase() === needle || entry.displayLabel.toLowerCase() === needle,
    );
    return match?.id ?? null;
  }

  private collectNamedEntityTags(entityMap: Record<string, string[]> | null | undefined): string[] {
    if (!entityMap) return [];
    const values = Object.values(entityMap).flatMap((entries) => entries ?? []);
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    );
  }

  private keStartMessage(action: KeUiAction): string {
    return this.translate.instant(KE_MESSAGE_KEYS[action].start);
  }

  private keSuccessMessage(action: KeUiAction): string {
    return this.translate.instant(KE_MESSAGE_KEYS[action].success);
  }

  private resolveKnowledgeEnrichmentError(error: unknown, action: KeUiAction): string {
    const fallback = this.translate.instant(KE_MESSAGE_KEYS[action].failed);
    if (error instanceof KeEnrichmentError && error.messageKey) {
      return this.translate.instant(error.messageKey, error.messageParams);
    }
    if (error instanceof Error && error.message) {
      if (error.message.includes('No authentication info for calling the Enrichment service')) {
        return this.translate.instant('document-detail.message.ke-not-configured');
      }
      return error.message;
    }
    const maybeMessage = (error as { error?: { message?: string }; message?: string } | null)?.error
      ?.message;
    if (maybeMessage?.includes('No authentication info for calling the Enrichment service')) {
      return this.translate.instant('document-detail.message.ke-not-configured');
    }
    return maybeMessage ?? (error as { message?: string } | null)?.message ?? fallback;
  }

  private throwKeResultError(message: string): Observable<never> {
    return new Observable((subscriber) => {
      subscriber.error(new Error(message));
    });
  }

  ngOnDestroy(): void {
    // Leaving the last viewed document in the context would let a rule on
    // another page answer about a document the user is no longer looking at.
    this.extensionRuleContext.document.set(null);
    this.extensionRuleContext.flags.set({});
    const raw = this.rawBlobUrl();
    if (raw) {
      URL.revokeObjectURL(raw);
    }
    for (const url of this.videoObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.revokeStoryboardObjectUrls();
  }

  private maybeBackfillContentLakeMarker(doc: NuxeoDocument): void {
    if (!shouldProbeContentLakeIngestStatus(doc)) {
      if (isContentLakeIngestCurrent(doc)) {
        this.contentLakePresenceVerified.set(true);
      }
      return;
    }

    this.contentLakePresenceChecking.set(true);
    this.kdClient
      .listIngestSourceIds()
      .pipe(
        switchMap((sourceIds) =>
          this.contentLakeIngestService.backfillIngestMarkerIfNeeded(doc, sourceIds),
        ),
        finalize(() => this.contentLakePresenceChecking.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.presentInContentLake) {
          this.contentLakePresenceVerified.set(true);
        }
        if (result.doc && this.doc()?.uid === result.doc.uid) {
          this.doc.set(result.doc);
        }
      });
  }

  private applyContentLakeIngestMarkerLocally(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    const digest = readBlobDigest(doc);
    const writeProperty = resolveIngestMarkerWriteProperty(doc);
    if (!digest || !writeProperty) {
      return;
    }
    this.doc.set({
      ...doc,
      properties: {
        ...doc.properties,
        [writeProperty]: buildContentLakeIngestMarker(digest),
      },
    });
  }

  private loadDocument(uid: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.detailService
      .getFullDocument(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (isCollectionDocument(doc)) {
            void this.router.navigate(['/collections', doc.uid], { replaceUrl: true });
            return;
          }
          if (isFolderishDocument(doc) && doc.path) {
            this.browseContext.setFromDocument(doc);
            void this.router.navigateByUrl(this.browseUrlForPath(doc.path), { replaceUrl: true });
            return;
          }
          this.doc.set(doc);
          this.browseContext.setFromDocument(doc);
          this.syncActionStates(doc);
          this.loading.set(false);
          if (this.activeTabId() === 'app.tabs.permissions') {
            this.reloadDocumentPermissions();
          }
          if (this.activeTabId() === 'app.tabs.history' && !this.historyLoaded) {
            this.loadDirectoryEntries();
            this.loadAuditLog();
          }
          if (this.panelSubTab() === 'activity' && !this.panelActivityLoaded) {
            this.loadPanelActivity();
          }
          this.loadBlob(doc);
          if (this.freshNoteDocument && documentTypeTraits(doc.type).view === 'noteEditor') {
            this.focusNoteEditor.set(true);
            this.freshNoteDocument = false;
          }
          this.scheduleMetadataRefreshIfNeeded(doc);
          this.loadPublicationCount(uid);
          this.loadDocumentTasks(uid);
          this.loadDocumentWorkflows(uid);
          this.loadARenderUrl(doc);
          this.maybeBackfillContentLakeMarker(doc);
        },
        error: () => {
          this.error.set(this.translate.instant('document-detail.message.failed-to-load-document'));
          this.loading.set(false);
        },
      });
  }

  /* ─── Workflow / Task methods ─── */

  private loadDocumentTasks(uid: string): void {
    this.documentTasksLoading.set(true);
    const userId = this.currentUsername() ?? 'Administrator';
    this.taskService.getDocumentTasks(uid, userId).subscribe({
      next: (tasks) => {
        this.documentTasks.set(tasks);
        this.documentTasksLoading.set(false);
      },
      error: () => this.documentTasksLoading.set(false),
    });
  }

  private loadDocumentWorkflows(uid: string): void {
    this.workflowService.getDocumentWorkflows(uid).subscribe({
      next: (wfs) => this.documentWorkflows.set(wfs),
      error: () => this.documentWorkflows.set([]),
    });
  }

  abandonWorkflow(wf: NuxeoWorkflow): void {
    this.abandoningWorkflow.set(true);
    this.workflowService.cancelWorkflow(wf.id).subscribe({
      next: () => {
        this.abandoningWorkflow.set(false);
        this.toast(this.translate.instant('document-detail.message.workflow-abandoned'));
        this.loadDocumentWorkflows(this.docUid);
        this.loadDocumentTasks(this.docUid);
      },
      error: () => {
        this.abandoningWorkflow.set(false);
        this.toast(this.translate.instant('document-detail.message.failed-to-abandon-workflow'));
      },
    });
  }

  taskDueLabel(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    const d = new Date(task.dueDate);
    return d.toLocaleDateString(this.locale, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  openStartProcess(): void {
    this.showStartProcessPanel.set(true);
    this.workflowsLoading.set(true);
    this.detailService.getRunnableWorkflows(this.docUid).subscribe({
      next: (models) => {
        this.availableWorkflows.set(models);
        this.workflowsLoading.set(false);
      },
      error: () => {
        this.availableWorkflows.set([]);
        this.workflowsLoading.set(false);
      },
    });
  }

  closeStartProcess(): void {
    this.showStartProcessPanel.set(false);
    this.selectedWorkflowModel.set('');
  }

  startProcess(): void {
    const model = this.selectedWorkflowModel();
    if (!model) return;

    this.startingWorkflow.set(true);
    this.workflowService.startWorkflow(this.docUid, model).subscribe({
      next: () => {
        this.startingWorkflow.set(false);
        this.closeStartProcess();
        this.toast(this.translate.instant('document-detail.message.workflow-started-successfully'));
        this.loadDocumentTasks(this.docUid);
        this.loadDocumentWorkflows(this.docUid);
      },
      error: () => {
        this.startingWorkflow.set(false);
        this.toast(this.translate.instant('document-detail.message.failed-to-start-workflow'));
      },
    });
  }

  goToTask(task: NuxeoTask): void {
    void this.router.navigateByUrl('/tasks/' + task.id);
  }

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Turn "ParallelDocumentReview" or "wf.x.Y" into "Parallel Document Review" */
  workflowDisplayName(wf: { name: string; title: string; workflowModelName?: string }): string {
    // Use workflowModelName or name — the title is an i18n key (wf.x.Y)
    const raw = (wf.workflowModelName ?? wf.name) || wf.title;
    // If it looks like an i18n key, strip the prefix
    const cleaned = raw.startsWith('wf.') ? raw.replace(/^wf\.\w+\./, '') : raw;
    return cleaned
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private syncActionStates(doc: NuxeoDocument): void {
    this.isLocked.set(!!(doc.lockOwner || doc.lockCreated));
    this.lockOwner.set(doc.lockOwner ?? null);
    this.lockCreated.set(doc.lockCreated ?? null);
    this.isFavorite.set(doc.contextParameters?.favorites?.isFavorite ?? false);
    const subs = doc.contextParameters?.subscribedNotifications;
    this.isSubscribed.set(Array.isArray(subs) && subs.length > 0);
  }

  private loadBlob(doc: NuxeoDocument): void {
    const generation = ++this.blobLoadGeneration;
    this.resetViewerState();
    this.blobLoading.set(true);

    const noteText = doc.properties['note:note'] as string | undefined;
    const noteMime = doc.properties['note:mime_type'] as string | undefined;
    if (noteText !== undefined && noteText !== null) {
      this.noteContent.set(noteText);
      if (noteMime === 'text/markdown') {
        const rawHtml = this.renderMarkdown(noteText);
        this.noteHtml.set(renderTrustedHtml(this.sanitizer, rawHtml, { ADD_ATTR: ['target'] }));
      }
      this.blobLoading.set(false);
      return;
    }

    const picViews = doc.properties['picture:views'] as Array<Record<string, unknown>> | undefined;
    if (picViews?.length) {
      this.extractPictureMetadata(doc, picViews);
    }

    const transcodedVideos = doc.properties['vid:transcodedVideos'] as
      Array<Record<string, unknown>> | undefined;
    if (transcodedVideos && transcodedVideos.length > 0) {
      this.loadVideoSources(doc, transcodedVideos, generation);
      this.extractVideoInfo(doc);
      return;
    }

    const traits = documentTypeTraits(doc.type);
    const fc = doc.properties['file:content'] as Record<string, unknown> | null;
    if (!fc) {
      if (traits.picture) {
        this.fetchMainBlob(doc, generation);
        return;
      }
      if (traits.preview) {
        this.loadPreviewFallback(doc);
      } else {
        this.blobLoading.set(false);
      }
      return;
    }

    const mime = this.resolveMainContentMime(fc, doc);

    if (traits.picture || (picViews?.length && !mime)) {
      this.fetchMainBlob(doc, generation);
      return;
    }

    if (mime.startsWith('video/')) {
      this.fetchMainBlob(doc, generation);
      this.loadStoryboard(doc);
      this.extractVideoInfo(doc);
      return;
    }

    if (mime.startsWith('audio/') || mime.startsWith('image/') || mime === 'application/pdf') {
      this.fetchMainBlob(doc, generation);
      return;
    }

    if (mime.startsWith('text/') || mime === 'application/json') {
      this.detailService
        .fetchBlob(doc.uid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (blob) => {
            if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
            void blob.text().then((text) => this.noteContent.set(text));
            this.blobLoading.set(false);
            this.freshBlobDocument = false;
          },
          error: () => {
            if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
            this.loadPreviewFallback(doc);
          },
        });
      return;
    }

    const renditions = (doc.contextParameters?.['renditions'] ?? []) as Array<{ name: string }>;
    if (renditions.some((r) => r.name === 'pdf')) {
      this.hasPdfRendition.set(true);
      this.detailService
        .fetchPdfRendition(doc.uid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (blob) => {
            if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
            this.setBlobUrl(blob);
            this.blobLoading.set(false);
            this.freshBlobDocument = false;
          },
          error: () => {
            if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
            this.loadPreviewFallback(doc);
          },
        });
      return;
    }

    if (isBlobHoldingDocType(doc.type) && this.hasFileContentBlob(fc)) {
      this.fetchMainBlob(doc, generation);
      return;
    }

    this.loadPreviewFallback(doc);
  }

  private resolveMainContentMime(fc: Record<string, unknown> | null, doc: NuxeoDocument): string {
    const mime = (fc?.['mime-type'] as string) ?? '';
    if (mime) return mime;
    const fileName = (fc?.['name'] as string) ?? doc.title ?? '';
    return this.mimeTypeFromFileName(fileName);
  }

  private mimeTypeFromFileName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_EXTENSION[ext] ?? '';
  }

  private hasFileContentBlob(fc: Record<string, unknown>): boolean {
    return !!(
      fc['digest'] ||
      fc['data'] ||
      (typeof fc['name'] === 'string' && fc['name'].length > 0) ||
      Number(fc['length'] ?? 0) > 0
    );
  }

  private fetchMainBlob(doc: NuxeoDocument, generation: number, attempt = 0): void {
    const maxAttempts = this.freshBlobDocument || isBlobHoldingDocType(doc.type) ? 8 : 1;
    this.detailService
      .fetchBlob(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
          this.setBlobUrl(blob);
          this.blobLoading.set(false);
          this.freshBlobDocument = false;
          this.clearFreshUploadQueryParam();
        },
        error: () => {
          if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
          if (attempt + 1 < maxAttempts) {
            timer(400)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe(() => {
                if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
                this.fetchMainBlob(doc, generation, attempt + 1);
              });
            return;
          }
          this.freshBlobDocument = false;
          this.loadPreviewFallback(doc);
        },
      });
  }

  private clearFreshUploadQueryParam(): void {
    if (this.route.snapshot.queryParamMap.get('fresh') !== '1') return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { fresh: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Nuxeo may return partially hydrated Picture metadata immediately after create/import.
   * Poll briefly and merge metadata without resetting an already-visible preview.
   */
  private scheduleMetadataRefreshIfNeeded(doc: NuxeoDocument): void {
    if (!this.documentMetadataIncomplete(doc)) return;

    const uid = doc.uid;
    const maxAttempts = 6;

    const poll = (): void => {
      if (uid !== this.docUid || this.metadataRefreshAttempt >= maxAttempts) return;
      this.metadataRefreshAttempt += 1;

      timer(500)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          switchMap(() => this.detailService.getFullDocument(uid)),
        )
        .subscribe({
          next: (refetched) => {
            if (uid !== this.docUid) return;
            this.syncDocumentMetadataFromRefetch(refetched);
            if (
              this.documentMetadataIncomplete(refetched) &&
              this.metadataRefreshAttempt < maxAttempts
            ) {
              poll();
            }
          },
          error: () => {
            // Stop polling on transient failures; preview may already be visible.
          },
        });
    };

    poll();
  }

  private syncDocumentMetadataFromRefetch(doc: NuxeoDocument): void {
    this.doc.set(doc);
    const picViews = doc.properties['picture:views'] as Array<Record<string, unknown>> | undefined;
    if (picViews?.length) {
      this.extractPictureMetadata(doc, picViews);
    }
    this.extractVideoInfo(doc);
    const transcodedVideos = doc.properties['vid:transcodedVideos'] as
      Array<Record<string, unknown>> | undefined;
    if (transcodedVideos?.length && this.videoSources().length === 0 && !this.blobUrl()) {
      this.loadVideoSources(doc, transcodedVideos, this.blobLoadGeneration);
    }
    if (this.storyboard().length === 0) {
      this.loadStoryboard(doc);
    }
    if (!this.blobUrl() && this.videoSources().length === 0) {
      this.fetchMainBlob(doc, this.blobLoadGeneration);
    }
  }

  private documentMetadataIncomplete(doc: NuxeoDocument): boolean {
    const traits = documentTypeTraits(doc.type);
    if (traits.picture) {
      return this.pictureMetadataIncomplete(doc);
    }
    if (traits.video) {
      return this.videoDocumentMetadataIncomplete(doc);
    }
    if (this.hasVideoContent(doc)) {
      return this.videoInfoIncomplete(doc);
    }
    return false;
  }

  private hasVideoContent(doc: NuxeoDocument): boolean {
    if (documentTypeTraits(doc.type).video) {
      return true;
    }
    const fc = doc.properties['file:content'] as Record<string, unknown> | null;
    return this.resolveMainContentMime(fc, doc).startsWith('video/');
  }

  private videoDocumentMetadataIncomplete(doc: NuxeoDocument): boolean {
    return this.videoInfoIncomplete(doc) || this.storyboardIncomplete(doc);
  }

  private videoInfoIncomplete(doc: NuxeoDocument): boolean {
    if (this.videoInfo()) {
      return false;
    }

    const raw = doc.properties['vid:info'] as Record<string, unknown> | undefined;
    if (!raw) {
      // File attachments with video MIME never receive vid:info from Nuxeo.
      return documentTypeTraits(doc.type).video;
    }

    return !Object.values(raw).some(
      (value) => value !== null && value !== undefined && String(value).trim() !== '',
    );
  }

  private storyboardIncomplete(doc: NuxeoDocument): boolean {
    if (this.storyboard().length > 0) {
      return false;
    }

    // File documents with a video attachment do not get server-side storyboards.
    if (!documentTypeTraits(doc.type).video) {
      return false;
    }

    const sb = doc.properties['vid:storyboard'] as Array<Record<string, unknown>> | undefined;
    return !sb || sb.length === 0;
  }

  private pictureMetadataIncomplete(doc: NuxeoDocument): boolean {
    const info = doc.properties['picture:info'] as Record<string, unknown> | undefined;
    const views = doc.properties['picture:views'] as Array<Record<string, unknown>> | undefined;
    if (!info || !views?.length) {
      return true;
    }

    const width = Number(info['width'] ?? 0);
    const height = Number(info['height'] ?? 0);
    if (width <= 0 || height <= 0) {
      return true;
    }

    return !views.some((view) => {
      const title = (view['title'] as string) ?? '';
      const viewWidth = Number(view['width'] ?? 0);
      return (
        (title === 'FullHD' || title === 'OriginalJpeg' || title === 'Medium') && viewWidth > 200
      );
    });
  }

  private loadVideoSources(
    doc: NuxeoDocument,
    transcodedVideos: Array<Record<string, unknown>>,
    generation: number,
  ): void {
    const entries = this.collectTranscodedVideoEntries(transcodedVideos);
    if (entries.length === 0) {
      this.fetchMainBlob(doc, generation);
      this.loadStoryboard(doc, generation);
      return;
    }

    this.fetchPreferredVideoSource(doc, entries, generation, 0);
  }

  private collectTranscodedVideoEntries(
    transcodedVideos: Array<Record<string, unknown>>,
  ): Array<{ dataUrl: string; mimeType: string; label: string }> {
    const entries: Array<{ dataUrl: string; mimeType: string; label: string }> = [];
    for (const tv of transcodedVideos) {
      const content = tv['content'] as Record<string, unknown> | undefined;
      const dataUrl = (content?.['data'] as string) ?? '';
      const tvMime = (content?.['mime-type'] as string) ?? 'video/mp4';
      const label = (tv['name'] as string) ?? '';
      if (dataUrl && tvMime.startsWith('video/')) {
        entries.push({ dataUrl, mimeType: tvMime, label });
      }
    }

    return entries.sort((left, right) => {
      const leftScore = left.mimeType.includes('mp4') ? 0 : 1;
      const rightScore = right.mimeType.includes('mp4') ? 0 : 1;
      return leftScore - rightScore;
    });
  }

  private fetchPreferredVideoSource(
    doc: NuxeoDocument,
    entries: Array<{ dataUrl: string; mimeType: string; label: string }>,
    generation: number,
    index: number,
  ): void {
    if (index >= entries.length) {
      this.fetchMainBlob(doc, generation);
      this.loadStoryboard(doc, generation);
      return;
    }

    const entry = entries[index];
    this.http
      .get(this.resolveNuxeoBlobRequestUrl(entry.dataUrl), { responseType: 'blob' })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError(() => of(null)),
      )
      .subscribe((blob) => {
        if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) {
          return;
        }

        if (!blob) {
          this.fetchPreferredVideoSource(doc, entries, generation, index + 1);
          return;
        }

        const rawUrl = URL.createObjectURL(blob);
        this.videoObjectUrls.push(rawUrl);
        // Raw string, no bypass: this feeds `<source [src]>`, which is SecurityContext.NONE, so a
        // SafeResourceUrl is never unwrapped and stringifies into the attribute instead. The
        // transcoded-video source list was broken that way until this was unwrapped.
        this.videoSources.set([
          {
            url: rawUrl,
            mimeType: entry.mimeType,
            label: entry.label,
          },
        ]);
        this.blobLoading.set(false);
        this.loadStoryboard(doc, generation);
      });
  }

  /**
   * Nuxeo blob `data` URLs from REST responses are often absolute (e.g. :8080). Rewrite to the
   * proxied `/nuxeo/...` path so HttpClient + the auth interceptor can fetch them.
   */
  private resolveNuxeoBlobRequestUrl(dataUrl: string): string {
    if (dataUrl.startsWith('/nuxeo/')) {
      return dataUrl;
    }

    try {
      const url = new URL(dataUrl, window.location.origin);
      const nuxeoIdx = url.pathname.indexOf('/nuxeo/');
      if (nuxeoIdx >= 0) {
        return `${url.pathname.slice(nuxeoIdx)}${url.search}`;
      }
    } catch {
      // Fall through to returning the original URL.
    }

    return dataUrl;
  }

  private loadStoryboard(doc: NuxeoDocument, generation = this.blobLoadGeneration): void {
    // Several callers race for one video: `loadBlob` asks, and `setBlobUrl` asks
    // again from inside the `fetchMainBlob` it just started. Against a real server
    // the first request has not answered when the second arrives, so `storyboard()`
    // is still empty and every frame was fetched twice.
    if (this.storyboard().length > 0 || this.storyboardInFlight) {
      return;
    }

    const sb = doc.properties['vid:storyboard'] as Array<Record<string, unknown>> | undefined;
    if (sb?.length) {
      this.storyboardInFlight = true;
      this.loadServerStoryboard(doc, sb, generation);
      return;
    }

    const videoObjectUrl = this.rawBlobUrl() ?? this.videoObjectUrls[0] ?? null;
    if (videoObjectUrl && this.mimeType().startsWith('video/')) {
      this.storyboardInFlight = true;
      void this.generateClientStoryboard(videoObjectUrl, generation).finally(() =>
        this.releaseStoryboardGuard(doc, generation),
      );
    }
  }

  /**
   * Release the in-flight guard only for the load that still owns it.
   *
   * A response for a previously-viewed document arrives after the next load has taken
   * the guard, and clearing it there lets the next caller start the duplicate fetch the
   * guard was added to prevent — `storyboard()` is still empty, so it is no barrier.
   */
  private releaseStoryboardGuard(doc: NuxeoDocument, generation: number): void {
    if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) {
      return;
    }
    this.storyboardInFlight = false;
  }

  private loadServerStoryboard(
    doc: NuxeoDocument,
    sb: Array<Record<string, unknown>>,
    generation: number,
  ): void {
    const entries = sb.map((entry, index) => ({
      index,
      timecode: Number(entry['timecode'] ?? 0),
      thumbUrl: this.resolveStoryboardThumbnailUrl(
        entry['content'] as Record<string, unknown> | undefined,
      ),
      label: (entry['comment'] as string) ?? '',
    }));

    forkJoin(
      entries.map((entry) =>
        this.fetchStoryboardThumbnailBlob(doc.uid, entry.index, entry.thumbUrl).pipe(
          map((blob) => ({ entry, blob })),
          catchError(() => of(null)),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        this.releaseStoryboardGuard(doc, generation);
        if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) {
          return;
        }

        const items: StoryboardItem[] = [];
        for (const result of results) {
          if (!result) {
            continue;
          }
          const rawUrl = URL.createObjectURL(result.blob);
          this.storyboardObjectUrls.push(rawUrl);
          items.push({
            timecode: result.entry.timecode,
            thumbnailUrl: rawUrl,
            label: result.entry.label,
          });
        }

        if (items.length > 0) {
          this.storyboard.set(items);
          return;
        }

        const videoObjectUrl = this.rawBlobUrl() ?? this.videoObjectUrls[0] ?? null;
        if (videoObjectUrl && this.mimeType().startsWith('video/')) {
          void this.generateClientStoryboard(videoObjectUrl, generation);
        }
      });
  }

  private fetchStoryboardThumbnailBlob(
    uid: string,
    index: number,
    dataUrl: string,
  ): Observable<Blob> {
    return this.detailService.fetchBlobByXpath(uid, `vid:storyboard/${index}/content`).pipe(
      catchError(() => {
        if (!dataUrl) {
          return throwError(() => new Error('Storyboard thumbnail URL missing'));
        }
        return this.http.get(this.resolveNuxeoBlobRequestUrl(dataUrl), { responseType: 'blob' });
      }),
    );
  }

  /** Generate evenly spaced preview frames when Nuxeo has no `vid:storyboard` (e.g. File + .mp4). */
  private async generateClientStoryboard(
    videoObjectUrl: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.blobLoadGeneration || this.storyboard().length > 0) {
      return;
    }

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = videoObjectUrl;

    try {
      await new Promise<void>((resolve, reject) => {
        const onLoaded = (): void => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = (): void => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          reject(new Error('Failed to load video for storyboard generation'));
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
        video.load();
        // Storyboard thumbnails are optional; a metadata load failure leaves the strip empty.
      }).catch(() => undefined);

      if (generation !== this.blobLoadGeneration || this.storyboard().length > 0) {
        return;
      }

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const frameCount = Math.min(10, Math.max(4, Math.ceil(duration)));
      const timecodes =
        frameCount === 1
          ? [0]
          : Array.from({ length: frameCount }, (_, index) => (duration * index) / (frameCount - 1));

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const items: StoryboardItem[] = [];
      for (const timecode of timecodes) {
        if (generation !== this.blobLoadGeneration) {
          return;
        }

        await this.seekVideoForStoryboard(video, timecode);
        if (generation !== this.blobLoadGeneration) {
          return;
        }
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          continue;
        }

        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          continue;
        }

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.75),
        );
        if (generation !== this.blobLoadGeneration) {
          return;
        }
        if (!blob) {
          continue;
        }

        const rawUrl = URL.createObjectURL(blob);
        this.storyboardObjectUrls.push(rawUrl);
        items.push({
          timecode,
          thumbnailUrl: rawUrl,
          label: this.formatStoryboardTimecode(timecode),
        });
      }

      if (generation === this.blobLoadGeneration && items.length > 0) {
        this.storyboard.set(items);
      }
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  }

  private seekVideoForStoryboard(video: HTMLVideoElement, timecode: number): Promise<void> {
    if (Math.abs(video.currentTime - timecode) < 0.01) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onSeeked = (): void => finish();
      const onError = (): void => finish();
      const timeoutId = setTimeout(finish, 5000);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      video.currentTime = timecode;
    });
  }

  private formatStoryboardTimecode(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /** Web UI prefers `content.viewUrl`, then falls back to `content.data`. */
  private resolveStoryboardThumbnailUrl(content: Record<string, unknown> | undefined): string {
    if (!content) {
      return '';
    }
    const viewUrl = String(content['viewUrl'] ?? '').trim();
    if (viewUrl) {
      return viewUrl;
    }
    return String(content['data'] ?? '').trim();
  }

  private revokeStoryboardObjectUrls(): void {
    for (const url of this.storyboardObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.storyboardObjectUrls = [];
  }

  private extractVideoInfo(doc: NuxeoDocument): void {
    const raw = doc.properties['vid:info'] as Record<string, unknown> | undefined;
    if (!raw) return;

    const parseNum = (value: unknown): number | undefined => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const parseStr = (value: unknown): string | undefined => {
      if (value === null || value === undefined) return undefined;
      const s = String(value).trim();
      return s || undefined;
    };

    const info: VideoInfo = {
      duration: parseNum(raw['duration']),
      width: parseNum(raw['width']),
      height: parseNum(raw['height']),
      format: parseStr(raw['format']),
      videoCodec: parseStr(raw['videoCodec']),
      audioCodec: parseStr(raw['audioCodec']),
      frameRate: parseNum(raw['frameRate']),
    };

    if (Object.values(info).some((v) => v !== undefined)) {
      this.videoInfo.set(info);
    }
  }

  private loadFallbackBlob(doc: NuxeoDocument, generation = this.blobLoadGeneration): void {
    this.detailService
      .fetchBlob(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
          this.setBlobUrl(blob);
          this.blobLoading.set(false);
          this.freshBlobDocument = false;
        },
        error: () => {
          if (generation !== this.blobLoadGeneration || doc.uid !== this.docUid) return;
          this.loadPreviewFallback(doc);
        },
      });
  }

  private loadPreviewFallback(doc: NuxeoDocument): void {
    const previewCtx = doc.contextParameters?.['preview'] as { url?: string } | undefined;
    // This URL comes from the Nuxeo REST response, so it is server-supplied rather than built here,
    // and it is bypassed and loaded into an iframe. Constrain it to the repository we are already
    // talking to: either same-origin — which is how it arrives behind the dev proxy, where
    // NUXEO_API_ORIGIN is '' — or the configured Nuxeo origin. Anything else is dropped, and the
    // viewer falls through to its "Preview not available" placeholder.
    //
    // `allowInsecure` covers dev mode OR an application already served over plaintext. Gating it on
    // `isDevMode()` alone silently removed the preview fallback from any production build served
    // over `http://` — an ordinary on-prem deployment — because the URL is same-origin and so
    // necessarily `http:` too. An iframe is only a downgrade relative to its host document; where
    // the host is already plaintext there is nothing to downgrade, and the origin allow-list below
    // is what actually constrains where it can point.
    //
    // Through `insecureAllowedForHost` rather than the inline `isDevMode() || hostIsInsecure` this
    // reasoning was first written as. That expression was correct here and duplicated nowhere else,
    // which is exactly how the two ARender sites ended up with a stricter answer to the same question.
    const safe = navigableUrlOrNull(previewCtx?.url, {
      base: window.location.origin,
      allowedOrigins: [window.location.origin, originOf(this.nuxeoApiOrigin)],
      allowInsecure: insecureAllowedForHost(isDevMode()),
    });
    if (safe) {
      this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(safe));
    }
    this.blobLoading.set(false);
    this.freshBlobDocument = false;
  }

  private resetViewerState(): void {
    this.blobUrl.set(null);
    // `rawBlobUrl` belongs here, beside `blobUrl`, not only in `resetState`.
    //
    // `loadBlob` calls this on its own, so the two viewer inputs could disagree: `blobUrl` null
    // while `rawBlobUrl` still held the *previous* document's object URL. That is not inert. If the
    // blob fetch then falls through to `loadPreviewFallback`, `previewUrl` is set, so
    // `contentType()` gets past its "nothing to show" guard and dispatches on MIME — and for
    // `audio/*` the template binds `<audio [src]="rawBlobUrl()">`, rendering the old document's
    // audio under the new document's title.
    this.revokeRawBlobUrl();
    this.noteContent.set(null);
    this.noteHtml.set(null);
    this.noteSaving.set(false);
    this.focusNoteEditor.set(false);
    this.videoSources.set([]);
    this.storyboard.set([]);
    this.posterUrl.set(null);
    this.hasPdfRendition.set(false);
    this.previewUrl.set(null);
    this.pictureInfo.set(null);
    this.pictureViews.set([]);
    this.exifData.set(null);
    this.iptcData.set(null);
    this.videoInfo.set(null);
    this.storyboardInFlight = false;
    this.revokeStoryboardObjectUrls();
    for (const url of this.videoObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.videoObjectUrls = [];
  }

  private extractPictureMetadata(
    doc: NuxeoDocument,
    picViews: Array<Record<string, unknown>>,
  ): void {
    const info = doc.properties['picture:info'] as Record<string, unknown> | undefined;
    if (info) {
      const width = Number(info['width'] ?? 0);
      const height = Number(info['height'] ?? 0);
      if (width > 0 && height > 0) {
        const weight = Number(info['weight'] ?? 0);
        this.pictureInfo.set({
          width,
          height,
          format: (info['format'] as string) ?? '',
          colorSpace: (info['colorSpace'] as string) ?? '',
          depth: Number(info['depth'] ?? 0),
          weight: this.formatBytes(weight),
        });
      }
    }

    const views: PictureView[] = picViews.map((v) => {
      const content = v['content'] as Record<string, unknown> | undefined;
      const len = Number(content?.['length'] ?? 0);
      return {
        title: (v['title'] as string) ?? '',
        width: Number(v['width'] ?? 0),
        height: Number(v['height'] ?? 0),
        fileSize: this.formatBytes(len),
        format: ((content?.['mime-type'] as string) ?? '').replace('image/', '').toUpperCase(),
        downloadUrl: (content?.['data'] as string) ?? '',
      };
    });
    this.pictureViews.set(views);

    const imd = doc.properties['imd:image_description'] as string | undefined;
    const exif: ExifData = {};
    const dateOrig = doc.properties['imd:date_time_original'] as string | undefined;
    if (dateOrig) exif.dateTimeOriginal = dateOrig;
    const orient = doc.properties['imd:orientation'] as string | undefined;
    if (orient) exif.orientation = orient;
    const fNum = doc.properties['imd:fnumber'] as string | number | undefined;
    if (fNum) exif.fNumber = `f/${fNum}`;
    const exposure = doc.properties['imd:exposure_time'] as string | number | undefined;
    if (exposure) exif.exposureTime = String(exposure);
    const iso = doc.properties['imd:iso_speed_ratings'] as string | number | undefined;
    if (iso) exif.isoSpeedRatings = String(iso);
    const focal = doc.properties['imd:focal_length'] as string | number | undefined;
    if (focal) exif.focalLength = `${focal}mm`;
    if (Object.keys(exif).length > 0) {
      this.exifData.set(exif);
    }

    const iptc: IptcData = {};
    const copyright = doc.properties['iptc:copyright'] as string | undefined;
    if (copyright) iptc.copyright = copyright;
    const rights = doc.properties['iptc:rights'] as string | undefined;
    if (rights) iptc.rights = rights;
    const source = doc.properties['iptc:source'] as string | undefined;
    if (source) iptc.source = source;
    const desc = imd ?? (doc.properties['iptc:description'] as string | undefined);
    if (desc) iptc.description = desc;
    if (Object.keys(iptc).length > 0) {
      this.iptcData.set(iptc);
    }
  }

  downloadPictureFormat(url: string): void {
    if (!url) return;
    window.open(url, '_blank');
  }

  private renderMarkdown(text: string): string {
    return renderNoteMarkdown(text);
  }

  /** Revoke the current raw object URL and clear the signal. The only place that pairing lives. */
  private revokeRawBlobUrl(): void {
    const previousRaw = this.rawBlobUrl();
    if (previousRaw) URL.revokeObjectURL(previousRaw);
    this.rawBlobUrl.set(null);
    this.mainBlobType.set('');
  }

  private setBlobUrl(blob: Blob): void {
    this.revokeRawBlobUrl();
    const rawUrl = URL.createObjectURL(blob);
    this.rawBlobUrl.set(rawUrl);
    // Retained for the preview dialog's iframe gate: it must decide on the type the server actually
    // served, not on the document metadata, which can disagree. See AttachmentPreviewData.blobType.
    this.mainBlobType.set(blob.type);
    // Both forms are kept deliberately: the wrapped one for `iframe[src]`, which throws on a raw
    // string, and the raw one for `source[src]` / `audio[src]` / `video[poster]`, which are
    // SecurityContext.NONE and would stringify the wrapper into the attribute.
    this.blobUrl.set(trustObjectUrl(this.sanitizer, rawUrl));

    const doc = this.doc();
    if (doc && this.mimeType().startsWith('video/') && this.storyboard().length === 0) {
      this.loadStoryboard(doc);
    }
  }

  onTabChange(raw: number): void {
    const index = Math.floor(Number(raw));
    if (!Number.isFinite(index) || index < 0) {
      return;
    }
    this.activeTabIndex.set(index);
    this.loadDataForTab(this.detailTabs()[index]?.id ?? null);
  }

  /** The lazy loads the Permissions, History and Publishing tabs need on first show. */
  private loadDataForTab(id: string | null): void {
    if (id === 'app.tabs.permissions' && !this.permissionsTabLoaded) {
      this.reloadDocumentPermissions();
    }
    if (id === 'app.tabs.history' && !this.historyLoaded) {
      this.loadDirectoryEntries();
      this.loadAuditLog();
    }
    if (id === 'app.tabs.publishing' && !this.publishTabLoaded) {
      this.loadPublishingData();
    }
  }

  private reloadDocumentPermissions(): void {
    if (!this.docUid) return;
    this.permissionsLoading.set(true);
    this.detailService
      .getDocumentPermissions(this.docUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const existing = this.doc();
          if (!existing) {
            this.doc.set(updated);
          } else {
            this.doc.set(mergeDocumentPermissionsContext(existing, updated));
          }
          this.permissionsTabLoaded = true;
          this.permissionsLoading.set(false);
        },
        error: () => {
          this.permissionsLoading.set(false);
          this.toast(
            this.translate.instant('document-detail.message.failed-to-refresh-permissions'),
          );
        },
      });
  }

  private loadDirectoryEntries(): void {
    forkJoin({
      types: this.directoryService.getEventTypes(),
      categories: this.directoryService.getEventCategories(),
    }).subscribe({
      next: ({ types, categories }) => {
        this.availableActions.set(types);
        this.availableCategories.set(categories);
        this.eventTypeLabelMap = new Map(types.map((t) => [t.id, t.displayLabel]));
        this.eventCategoryLabelMap = new Map(categories.map((c) => [c.id, c.displayLabel]));
      },
    });
  }

  loadAuditLog(): void {
    if (!this.docUid) return;

    const doc = this.doc();
    if (!doc) {
      this.auditLoading.set(false);
      return;
    }

    if (!canViewDocumentAuditLog(doc)) {
      this.auditEntries.set([]);
      this.auditTotalSize.set(0);
      this.auditLoading.set(false);
      this.historyLoaded = true;
      return;
    }

    this.auditLoading.set(true);

    this.detailService
      .getAuditLog(this.docUid, this.auditPageSize(), this.auditPageIndex())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auditEntries.set(res.entries);
          this.auditTotalSize.set(res.resultsCount ?? res.totalSize ?? res.entries.length);
          this.auditLoading.set(false);
          this.historyLoaded = true;
        },
        error: () => {
          this.auditLoading.set(false);
        },
      });
  }

  onAuditPageChange(event: PageEvent): void {
    this.auditPageSize.set(event.pageSize);
    this.auditPageIndex.set(event.pageIndex);
    this.loadAuditLog();
  }

  onAuditSort(sort: Sort): void {
    this.sortActive.set(sort.active);
    this.sortDirection.set(sort.direction);
  }

  eventLabel(eventId: string): string {
    return (
      this.eventTypeLabelMap.get(eventId) ??
      eventId.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
    );
  }

  categoryLabel(category: string): string {
    return (
      this.eventCategoryLabelMap.get(category) ??
      category
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .replace('event ', '')
        .replace(' Category', '')
    );
  }

  avatarColor = avatarColor;

  tagCategory(index: number): SatTagCategory {
    return TAG_CATEGORIES[index % TAG_CATEGORIES.length];
  }

  private loadPublicationCount(uid: string): void {
    this.detailService.getPublishedVersions(uid).subscribe({
      next: (res) => {
        this.publishedDocs.set(res.entries);
        this.publishLoading.set(false);
      },
      error: () => this.publishLoading.set(false),
    });
  }

  private loadPublishingData(): void {
    this.publishLoading.set(true);
    this.sectionsLoading.set(true);

    if (this.publishedDocs().length === 0) {
      this.detailService.getPublishedVersions(this.docUid).subscribe({
        next: (res) => {
          this.publishedDocs.set(res.entries);
          this.publishLoading.set(false);
        },
        error: () => this.publishLoading.set(false),
      });
    } else {
      this.publishLoading.set(false);
    }

    this.detailService.getSectionTree().subscribe({
      next: (res) => {
        this.sectionTree.set(this.buildSectionTree(res.entries));
        this.sectionsLoading.set(false);
        // Marked loaded only here, as every other tab in this component does:
        // setting it up front left a failed section tree permanently empty,
        // because returning to the tab saw the flag and never retried.
        this.publishTabLoaded = true;
      },
      error: () => this.sectionsLoading.set(false),
    });
  }

  private buildSectionTree(docs: NuxeoDocument[]): SectionNode[] {
    const nodeMap = new Map<string, SectionNode>();
    const roots: SectionNode[] = [];

    for (const doc of docs) {
      nodeMap.set(doc.path, { doc, children: [], expanded: true });
    }

    for (const doc of docs) {
      const node = nodeMap.get(doc.path);
      if (!node) continue;
      const parentPath = doc.path.split('/').slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  selectSection(id: string): void {
    this.selectedSectionId.set(this.selectedSectionId() === id ? null : id);
  }

  toggleSectionNode(node: SectionNode): void {
    node.expanded = !node.expanded;
    this.sectionTree.update((t) => [...t]);
  }

  publishToSection(): void {
    const target = this.selectedSectionId();
    if (!target || !this.docUid) return;
    this.publishing.set(true);

    this.detailService.publishDocument(this.docUid, target, { override: true }).subscribe({
      next: () => {
        this.publishing.set(false);
        this.selectedSectionId.set(null);
        this.toast(this.translate.instant('document-detail.message.document-published'));
        this.refreshPublishedDocs();
      },
      error: () => {
        this.publishing.set(false);
        this.toast(this.translate.instant('document-detail.message.failed-to-publish'));
      },
    });
  }

  sectionIcon(node: SectionNode): string {
    return documentTypeTraits(node.doc.type).sectionIcon;
  }

  publishedPath(doc: NuxeoDocument): string {
    return doc.path;
  }

  publishedVersion(doc: NuxeoDocument): string {
    const major = doc.properties?.['uid:major_version'] ?? 0;
    const minor = doc.properties?.['uid:minor_version'] ?? 0;
    return `${major}.${minor}`;
  }

  isOlderVersion(pub: NuxeoDocument): boolean {
    const pubMajor = Number(pub.properties?.['uid:major_version'] ?? 0);
    const pubMinor = Number(pub.properties?.['uid:minor_version'] ?? 0);
    return (
      pubMajor < this.currentMajor() ||
      (pubMajor === this.currentMajor() && pubMinor < this.currentMinor())
    );
  }

  publishedRendition(doc: NuxeoDocument): string {
    const nature = doc.properties?.['dc:nature'] as string | null;
    if (nature) return nature;
    const mime = (doc.properties?.['file:content'] as Record<string, unknown>)?.[
      'mime-type'
    ] as string;
    if (mime === 'application/pdf') return 'PDF';
    return 'None';
  }

  publishedBy(doc: NuxeoDocument): string {
    return (
      (doc.properties?.['dc:lastContributor'] as string) ??
      (doc.properties?.['dc:creator'] as string) ??
      ''
    );
  }

  publishedDate(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:modified'] as string) ?? doc.lastModified ?? '';
  }

  goToPublishingTab(): void {
    // By id, not by literal 4: a manifest that hides or reorders a tab moves it.
    const index = this.detailTabs().findIndex((tab) => tab.id === 'app.tabs.publishing');
    if (index < 0) return;
    const g = this.detailTabGroup();
    if (g) {
      g.selectedIndex = index;
    }
    this.onTabChange(index);
  }

  unpublishDocument(proxyDoc: NuxeoDocument): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('unpublish');
    this.detailService.unpublishDocument(proxyDoc.uid).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.publishedDocs.update((docs) => docs.filter((d) => d.uid !== proxyDoc.uid));
        this.toast(this.translate.instant('document-detail.message.publication-removed'));
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('document-detail.message.failed-to-unpublish'));
      },
    });
  }

  republishDocument(proxyDoc: NuxeoDocument): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('republish');
    this.republishToSectionByProxy(proxyDoc);
  }

  private republishToSectionByProxy(proxyDoc: NuxeoDocument): void {
    const sectionPath = proxyDoc.path.split('/').slice(0, -1).join('/');
    // Find section UID from the section tree or query for it
    const findSection = (nodes: SectionNode[]): string | null => {
      for (const n of nodes) {
        if (n.doc.path === sectionPath) return n.doc.uid;
        const found = findSection(n.children);
        if (found) return found;
      }
      return null;
    };
    const sectionUid = findSection(this.sectionTree());
    if (sectionUid) {
      this.doRepublish(sectionUid);
    } else {
      const query = `SELECT * FROM Document WHERE ecm:path = '${sectionPath}' AND ecm:isTrashed = 0`;
      this.nuxeoApi.nxqlSearch(query, 1).subscribe({
        next: (res) => {
          if (res.entries.length > 0) {
            this.doRepublish(res.entries[0].uid);
          } else {
            this.actionInProgress.set(null);
            this.toast(this.translate.instant('document-detail.message.section-not-found'));
          }
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.failed-to-republish'));
        },
      });
    }
  }

  private doRepublish(targetSectionUid: string): void {
    this.detailService
      .publishDocument(this.docUid, targetSectionUid, { override: true })
      .subscribe({
        next: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.document-republished'));
          this.refreshPublishedDocs();
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.failed-to-republish'));
        },
      });
  }

  unpublishAll(): void {
    const docs = this.publishedDocs();
    if (docs.length === 0 || this.actionInProgress()) return;
    this.actionInProgress.set('unpublish-all');

    const deletions = docs.map((d) => this.detailService.unpublishDocument(d.uid));
    forkJoin(deletions).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.publishedDocs.set([]);
        this.toast(this.translate.instant('document-detail.message.all-publications-removed'));
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant('document-detail.message.failed-to-remove-some-publications'),
        );
        this.refreshPublishedDocs();
      },
    });
  }

  private refreshPublishedDocs(): void {
    this.detailService.getPublishedVersions(this.docUid).subscribe({
      next: (res) => this.publishedDocs.set(res.entries),
    });
  }

  // ── Document Actions ──

  toggleLock(): void {
    if (this.actionInProgress() || !this.requireWritePermission()) return;
    // Captured before the request: the page is reused across `:uid` changes, so when the response
    // lands `docUid` and `isLocked()` may describe another document.
    const uid = this.docUid;
    const wasLocked = this.isLocked();
    const request = ++this.lockRequest;
    this.actionInProgress.set('lock');
    const op = wasLocked
      ? this.detailService.unlockDocument(uid)
      : this.detailService.lockDocument(uid);

    op.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        if (request !== this.lockRequest) return;
        this.actionInProgress.set(null);
        if (uid !== this.docUid) return;
        this.isLocked.set(!wasLocked);
        // Nuxeo records the caller as the lock owner; naming a fixed account here
        // told every user someone else held their own lock.
        this.lockOwner.set(
          wasLocked ? null : (updated?.lockOwner ?? this.currentUsername() ?? null),
        );
        this.lockCreated.set(wasLocked ? null : (updated?.lockCreated ?? new Date().toISOString()));
        this.toast(
          this.translate.instant(
            wasLocked
              ? 'document-detail.message.document-unlocked'
              : 'document-detail.message.document-locked',
          ),
        );
      },
      error: (err: unknown) => {
        if (request !== this.lockRequest) return;
        this.actionInProgress.set(null);
        if (uid !== this.docUid) return;
        this.toast(this.translate.instant(this.lockRefusalKey(err, wasLocked)));
      },
    });
  }

  /**
   * On navigation, a lock request for the previous document stops owning the busy flag, so the new
   * document's controls are not held disabled by it, and its late response cannot clear a newer one.
   */
  private releaseLockRequest(): void {
    this.lockRequest += 1;
    if (this.actionInProgress() === 'lock') this.actionInProgress.set(null);
  }

  private lockRefusalKey(err: unknown, wasLocked: boolean): string {
    switch ((err as { status?: number } | null)?.status) {
      case 403:
        return wasLocked ? 'common.lock.unlock-no-permission' : 'common.lock.lock-no-permission';
      case 409:
        return wasLocked ? 'common.lock.locked-by-another-user' : 'common.lock.already-locked';
      default:
        return 'document-detail.message.failed-to-toggle-lock';
    }
  }

  toggleFavorite(): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('favorite');
    const op = this.isFavorite()
      ? this.detailService.removeFromFavorites(this.docUid)
      : this.detailService.addToFavorites(this.docUid);

    op.subscribe({
      next: () => {
        const wasFav = this.isFavorite();
        this.isFavorite.set(!wasFav);
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant(
            wasFav
              ? 'document-detail.message.removed-from-favorites'
              : 'document-detail.message.added-to-favorites',
          ),
        );
        window.dispatchEvent(new Event('favorites-changed'));
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('document-detail.message.failed-to-update-favorites'));
      },
    });
  }

  toggleSubscription(): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('subscribe');
    const op = this.isSubscribed()
      ? this.detailService.unsubscribe(this.docUid)
      : this.detailService.subscribe(this.docUid);

    op.subscribe({
      next: () => {
        const wasSub = this.isSubscribed();
        this.isSubscribed.set(!wasSub);
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant(
            wasSub
              ? 'document-detail.message.notifications-disabled'
              : 'document-detail.message.notifications-enabled',
          ),
        );
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('browse.message.failed-to-update-notifications'));
      },
    });
  }

  readonly isTrashed = computed(() => {
    const d = this.doc();
    return d?.isTrashed === true || d?.state === 'deleted';
  });

  trashDocument(): void {
    if (this.actionInProgress() || !this.requireRemovePermission()) return;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.delete-document'),
        message: this.translate.instant('confirm.delete-document-question'),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.actionInProgress.set('trash');

        this.detailService
          .trashDocument(this.docUid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(this.translate.instant('document-detail.message.document-moved-to-trash'));
              this.goBack();
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.failed-to-delete-document'),
              );
            },
          });
      });
  }

  restoreFromTrash(): void {
    if (this.actionInProgress() || !this.requireWritePermission()) return;
    this.actionInProgress.set('restore');
    this.detailService
      .restoreFromTrash(this.docUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.document-restored'));
          this.loadDocument(this.docUid);
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('browse.message.failed-to-restore-document'));
        },
      });
  }

  permanentlyDelete(): void {
    if (this.actionInProgress() || !this.requireRemovePermission()) return;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.permanently-delete-document'),
        message: this.translate.instant('confirm.permanently-delete-warning'),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.actionInProgress.set('permanentDelete');
        this.detailService
          .permanentlyDelete(this.docUid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.document-permanently-deleted'),
              );
              this.goBack();
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant(
                  'document-detail.message.failed-to-permanently-delete-document',
                ),
              );
            },
          });
      });
  }

  toggleClipboard(): void {
    const current = this.clipboardDocs();
    const d = this.doc();
    if (!d) return;

    if (this.isInClipboard()) {
      const updated = current.filter((c) => c.uid !== this.docUid);
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast(this.translate.instant('collections.message.removed-from-clipboard'));
    } else {
      const updated = [...current, { uid: d.uid, title: d.title, type: d.type }];
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast(this.translate.instant('collections.message.added-to-clipboard'));
    }
    window.dispatchEvent(new Event('clipboard-changed'));
  }

  exportDocument(): void {
    this.dialog.open(ExportDialogComponent, {
      data: {
        documentUid: this.docUid,
        documentTitle: this.doc()?.title ?? 'document',
        exportFn: (type: ExportType, uid: string): Observable<Blob> => {
          switch (type) {
            case 'thumbnail':
              return this.detailService.fetchThumbnail(uid);
            case 'pdf':
              return this.detailService.fetchPdfRendition(uid);
            case 'zip':
              return this.detailService.exportZip(uid, `${this.doc()?.title ?? 'export'}.zip`);
            case 'xml':
              return this.detailService.exportXml(uid);
          }
        },
      } satisfies ExportDialogData,
      width: '440px',
    });
  }

  openAddToCollectionDialog(): void {
    const ref = this.dialog.open(AddToCollectionDialogComponent, {
      width: '440px',
      autoFocus: false,
    });

    ref.afterClosed().subscribe((collectionId: string | undefined) => {
      if (!collectionId) return;
      this.actionInProgress.set('collection');
      this.detailService.addToCollection(this.docUid, collectionId).subscribe({
        next: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.added-to-collection'));
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('document-detail.message.failed-to-add-to-collection'));
        },
      });
    });
  }

  openEditDialog(): void {
    const currentDoc = this.doc();
    if (!currentDoc || !this.requireWritePermission()) return;

    const ref = this.dialog.open(EditDocumentDialogComponent, {
      width: '560px',
      data: { document: currentDoc },
    });

    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updatedDoc: NuxeoDocument | undefined) => {
        if (!updatedDoc) return;
        this.browseContext.requestTreeRefresh();
        this.browseContext.setFromDocument(updatedDoc);
        this.doc.set(updatedDoc);
        this.syncActionStates(updatedDoc);
        this.loadVocabularies();
        this.toast(this.translate.instant('browse.message.document-updated'));
        this.loadDocument(this.docUid);
      });
  }

  /** Toolbar Edit opens metadata; note-surface pencil focuses inline content (Web UI parity). */
  onEditClick(): void {
    this.openEditDialog();
  }

  saveNote(body: string): void {
    const doc = this.doc();
    if (!doc || this.noteSaving() || !this.requireWritePermission()) return;

    this.noteSaving.set(true);
    const mime = this.mimeType();
    this.browseService
      .updateDocument(
        doc.uid,
        {
          'note:note': body,
          'note:mime_type': mime,
        },
        { enrichPermissions: true },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.noteSaving.set(false);
          this.doc.set(this.mergeUpdatedDocument(doc, updated));
          this.noteContent.set(body);
          if (mime === 'text/markdown') {
            const rawHtml = this.renderMarkdown(body);
            this.noteHtml.set(renderTrustedHtml(this.sanitizer, rawHtml, { ADD_ATTR: ['target'] }));
          } else {
            this.noteHtml.set(null);
          }
          this.toast(this.translate.instant('document-detail.message.note-saved'));
        },
        error: (err) => {
          this.noteSaving.set(false);
          this.toast(
            isPermissionDeniedError(err)
              ? this.translate.instant(PERMISSION_DENIED_KEY)
              : this.translate.instant('document-detail.message.failed-to-save-note'),
          );
        },
      });
  }

  shareDocument(): void {
    this.dialog.open(ShareDialogComponent, {
      data: {
        title: this.doc()?.title ?? this.translate.instant('document-detail.share-fallback-title'),
        url: window.location.href,
      } satisfies ShareDialogData,
      width: '520px',
    });
  }

  private toast(message: string): void {
    this.snackBar.open(message, this.translate.instant('common.ok'), {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  /**
   * Keeps enricher data when a Note PUT omits contextParameters or returns empty
   * permissions/acls arrays (NXSAT-196). Permission refresh GETs use the default merge.
   */
  private mergeUpdatedDocument(existing: NuxeoDocument, updated: NuxeoDocument): NuxeoDocument {
    if (!existing.contextParameters && !updated.contextParameters) {
      return updated;
    }
    // Note PUT only: treat empty permissions/acls arrays from Nuxeo as absent (NXSAT-196).
    return mergeDocumentPermissionsContext(
      { ...updated, contextParameters: existing.contextParameters },
      updated,
      { treatEmptyEnricherAsAbsent: true },
    );
  }

  private requireWritePermission(): boolean {
    if (canWriteDocument(this.doc())) return true;
    this.toast(this.translate.instant(PERMISSION_DENIED_KEY));
    return false;
  }

  private requireRemovePermission(): boolean {
    if (canRemoveDocument(this.doc())) return true;
    this.toast(this.translate.instant(PERMISSION_DENIED_KEY));
    return false;
  }

  goBack(): void {
    const d = this.doc();
    if (d) {
      void this.router.navigateByUrl(this.browseUrlForPath(parentNuxeoFolderPath(d.path)));
    } else {
      void this.router.navigateByUrl(this.browseUrlForPath('/'));
    }
  }

  download(): void {
    if (!this.docUid) return;
    this.detailService
      .fetchBlob(this.docUid, { clientReason: 'download' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = this.fileName();
          anchor.click();
          URL.revokeObjectURL(objectUrl);
          this.refreshPanelActivityIfVisible();
        },
        error: () =>
          this.toast(this.translate.instant('document-detail.message.failed-to-download-document')),
      });
  }

  private refreshPanelActivityIfVisible(): void {
    if (this.panelSubTab() !== 'activity') return;
    this.panelActivityLoaded = false;
    this.loadPanelActivity();
  }

  previewMainBlob(): void {
    const rawUrl = this.rawBlobUrl();
    if (!rawUrl) return;
    const safeUrl = trustObjectUrl(this.sanitizer, rawUrl);
    this.dialog.open(AttachmentPreviewDialogComponent, {
      width: '90vw',
      maxWidth: '1200px',
      maxHeight: '95vh',
      panelClass: 'preview-dialog-panel',
      data: {
        name: this.fileName(),
        mimeType: this.mimeType(),
        blobType: this.mainBlobType(),
        blobUrl: safeUrl,
        rawUrl,
        // The document viewer behind this dialog is still bound to the same object URL.
        ownsRawUrl: false,
      },
    });
  }

  private loadARenderUrl(doc: NuxeoDocument): void {
    const xpath = this.blobXPathForARender(doc);
    if (!xpath) {
      this.arenderUrl.set(null);
      return;
    }
    const requestedDocUid = doc.uid;
    this.arenderUrl.set(null);
    this.arenderService
      .isAvailable()
      .pipe(
        switchMap((available) =>
          available ? this.arenderService.getPreviewerUrl(doc.uid, xpath) : of(null),
        ),
        // The `requestedDocUid` guard below only prevents a *stale* document's result being
        // applied; it does not unsubscribe, so without this the subscription outlives the
        // component. Required by convention on every `.subscribe()` in this repo.
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (url) => {
          if (requestedDocUid !== this.docUid) return;
          // Validate at the point of trust, not only where the URL was built. `ARenderService`
          // already refuses a `viewerOrigin` that is not an http(s) origin, so this is the second
          // of two independent checks — the value is about to be bypassed and navigated in an
          // iframe, which is a privilege boundary, and a boundary defended in exactly one place is
          // one refactor away from being undefended. Rejecting leaves `arenderUrl` null, which the
          // template renders as "Annotations are not available" — the same path as ARender not
          // being deployed.
          // Host-aware, matching `ARenderService` and the preview fallback. Left on a bare
          // `isDevMode()` this second check would reject on an http host what the first now allows,
          // so ARender would still be dead for on-prem plaintext — the defence-in-depth pair has to
          // agree on the policy, not just both be present.
          const safe = navigableUrlOrNull(url, {
            allowInsecure: insecureAllowedForHost(isDevMode()),
          });
          if (safe) {
            this.arenderUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(safe));
            this.arenderReloadId.update((n) => n + 1);
          }
        },
        error: () => {
          if (requestedDocUid !== this.docUid) return;
          this.arenderUrl.set(null);
        },
      });
  }

  /**
   * Blob xpath for Document.ARenderGetPreviewerUrl so annotations align with the main blob (file:content).
   */
  private blobXPathForARender(doc: NuxeoDocument): string | null {
    if (doc.properties['note:note'] !== undefined && doc.properties['note:note'] !== null) {
      return null;
    }
    const fc = doc.properties['file:content'] as Record<string, unknown> | null;
    if (!fc || !(fc['digest'] ?? fc['data'])) {
      const pics = doc.properties['picture:views'] as unknown[] | undefined;
      if (!pics?.length) return null;
    }
    return 'file:content';
  }

  // ── Panel Sub-Tab Switching ──

  switchPanelSubTab(tab: 'properties' | 'comments' | 'activity'): void {
    this.panelSubTab.set(tab);
    if (tab === 'comments' && !this.commentsLoaded) {
      this.loadComments();
    }
    if (tab === 'activity' && !this.panelActivityLoaded) {
      this.loadPanelActivity();
    }
  }

  // ── Comments ──

  loadComments(): void {
    if (!this.docUid) return;
    this.commentsLoading.set(true);
    this.detailService.getAllComments(this.docUid).subscribe({
      next: (res) => {
        const all = (res.entries ?? []).map((e) => ({
          id: e.uid,
          parentId: (e.properties['comment:parentId'] as string) ?? this.docUid,
          text: (e.properties['comment:text'] as string) ?? '',
          author: (e.properties['comment:author'] as string) ?? '',
          creationDate:
            (e.properties['comment:creationDate'] as string) ??
            (e.properties['dc:created'] as string) ??
            '',
          modificationDate:
            (e.properties['comment:modificationDate'] as string) ??
            (e.properties['dc:modified'] as string) ??
            '',
        }));
        const topLevel = all.filter((c) => c.parentId === this.docUid);
        const replies: Record<string, NuxeoComment[]> = {};
        for (const c of all) {
          if (c.parentId !== this.docUid) {
            if (!replies[c.parentId]) replies[c.parentId] = [];
            replies[c.parentId].push(c);
          }
        }
        this.comments.set(topLevel);
        this.repliesMap.set(replies);
        this.commentsLoading.set(false);
        this.commentsLoaded = true;
      },
      error: () => this.commentsLoading.set(false),
    });
  }

  submitComment(): void {
    const text = this.newCommentText().trim();
    if (!text || this.commentSaving() || !this.requireWritePermission()) return;
    this.commentSaving.set(true);
    this.detailService.createComment(this.docUid, text).subscribe({
      next: (comment) => {
        this.comments.update((list) => [comment, ...list]);
        this.newCommentText.set('');
        this.commentSaving.set(false);
      },
      error: () => {
        this.commentSaving.set(false);
        this.toast(this.translate.instant('document-detail.message.failed-to-add-comment'));
      },
    });
  }

  cancelNewComment(): void {
    this.newCommentText.set('');
  }

  startEditComment(comment: NuxeoComment): void {
    if (!this.requireWritePermission()) return;
    this.editingCommentId.set(comment.id);
    this.editingCommentText.set(comment.text);
  }

  cancelEditComment(): void {
    this.editingCommentId.set(null);
    this.editingCommentText.set('');
  }

  saveEditComment(): void {
    const id = this.editingCommentId();
    const text = this.editingCommentText().trim();
    if (!id || !text || this.commentSaving() || !this.requireWritePermission()) return;
    this.commentSaving.set(true);
    this.detailService
      .updateComment(this.docUid, id, text)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          if (this.comments().some((c) => c.id === id)) {
            this.comments.update((list) => list.map((c) => (c.id === id ? updated : c)));
          } else {
            this.repliesMap.update((map) => {
              const next = { ...map };
              for (const parentId of Object.keys(next)) {
                const replies = next[parentId];
                if (replies.some((r) => r.id === id)) {
                  next[parentId] = replies.map((r) => (r.id === id ? updated : r));
                  break;
                }
              }
              return next;
            });
          }
          this.editingCommentId.set(null);
          this.editingCommentText.set('');
          this.commentSaving.set(false);
        },
        error: () => {
          this.commentSaving.set(false);
          this.toast(this.translate.instant('document-detail.message.failed-to-update-comment'));
        },
      });
  }

  deleteComment(comment: NuxeoComment, parentCommentId?: string): void {
    if (!this.requireWritePermission()) return;
    const isReply = !!parentCommentId;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant(isReply ? 'confirm.delete-reply' : 'confirm.delete-comment'),
        message: this.translate.instant(
          isReply ? 'confirm.delete-reply-question' : 'confirm.delete-comment-question',
        ),
        confirmLabel: this.translate.instant('confirm.delete'),
      } as ConfirmDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.detailService
          .deleteComment(this.docUid, comment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              if (parentCommentId) {
                this.repliesMap.update((map) => ({
                  ...map,
                  [parentCommentId]: (map[parentCommentId] ?? []).filter(
                    (r) => r.id !== comment.id,
                  ),
                }));
                this.toast(this.translate.instant('document-detail.message.reply-deleted'));
              } else {
                this.comments.update((list) => list.filter((c) => c.id !== comment.id));
                this.repliesMap.update((map) => {
                  const { [comment.id]: _removed, ...rest } = map;
                  return rest;
                });
                this.toast(this.translate.instant('document-detail.message.comment-deleted'));
              }
            },
            error: () =>
              this.toast(
                this.translate.instant(
                  isReply
                    ? 'document-detail.message.failed-to-delete-reply'
                    : 'document-detail.message.failed-to-delete-comment',
                ),
              ),
          });
      });
  }

  startReply(commentId: string): void {
    if (!this.requireWritePermission()) return;
    this.replyingToId.set(commentId);
    this.replyText.set('');
  }

  cancelReply(): void {
    this.replyingToId.set(null);
    this.replyText.set('');
  }

  submitReply(commentId: string): void {
    const text = this.replyText().trim();
    if (!text || this.commentSaving() || !this.requireWritePermission()) return;
    this.commentSaving.set(true);
    this.detailService.createReply(this.docUid, commentId, text).subscribe({
      next: (reply) => {
        const correctedReply = { ...reply, parentId: commentId };
        this.repliesMap.update((m) => ({
          ...m,
          [commentId]: [...(m[commentId] ?? []), correctedReply],
        }));
        this.replyingToId.set(null);
        this.replyText.set('');
        this.commentSaving.set(false);
      },
      error: () => {
        this.commentSaving.set(false);
        this.toast(this.translate.instant('document-detail.message.failed-to-add-reply'));
      },
    });
  }

  replyCount(commentId: string): number {
    return (this.repliesMap()[commentId] ?? []).length;
  }

  lastReplyTime(commentId: string): string {
    const replies = this.repliesMap()[commentId];
    if (!replies?.length) return '';
    return this.relativeTime(replies[replies.length - 1].creationDate);
  }

  isCommentEdited(comment: NuxeoComment): boolean {
    return !!comment.modificationDate && comment.modificationDate !== comment.creationDate;
  }

  /**
   * Localised by `Intl.RelativeTimeFormat` rather than by a catalogue — see
   * `formatRelativeTime` for why a key per unit cannot express Polish or Arabic plurals.
   */
  relativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.translate.currentLang);
  }

  // ── Panel Activity ──

  loadPanelActivity(): void {
    if (!this.docUid) return;

    const doc = this.doc();
    if (!doc) {
      this.panelActivityLoading.set(false);
      return;
    }

    if (!canViewDocumentAuditLog(doc)) {
      this.panelActivity.set([]);
      this.panelActivityLoading.set(false);
      this.panelActivityLoaded = true;
      return;
    }

    this.panelActivityLoading.set(true);
    this.detailService
      .getAuditLog(this.docUid, 20, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.panelActivity.set(res.entries);
          this.panelActivityLoading.set(false);
          this.panelActivityLoaded = true;
        },
        error: () => this.panelActivityLoading.set(false),
      });
  }

  activityLabel(entry: AuditEntry): string {
    return auditActivityLabel(entry, this.eventTypeLabelMap);
  }

  // ── Versioning ──

  openCreateVersionDialog(): void {
    if (!this.requireWritePermission()) return;
    const ref = this.dialog.open(CreateVersionDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      panelClass: 'create-version-dialog-panel',
      data: {
        documentUid: this.docUid,
        documentTitle: this.doc()?.title ?? '',
        currentMajor: this.currentMajor(),
        currentMinor: this.currentMinor(),
      } satisfies CreateVersionDialogData,
    });

    ref.afterClosed().subscribe((result) => {
      if (result) {
        this.loadDocument(this.docUid);
        this.versionsLoaded = false;
        this.loadVersions();
      }
    });
  }

  toggleVersionDropdown(): void {
    if (!this.versionsLoaded) {
      this.loadVersions();
    }
    this.versionDropdownOpen.update((v) => !v);
  }

  loadVersions(): void {
    if (!this.docUid) return;
    this.versionsLoading.set(true);
    this.detailService.getVersions(this.docUid).subscribe({
      next: (res) => {
        this.versions.set(res.entries ?? []);
        this.versionsLoading.set(false);
        this.versionsLoaded = true;
      },
      error: () => this.versionsLoading.set(false),
    });
  }

  versionString(doc: NuxeoDocument): string {
    const major = Number(doc.properties['uid:major_version'] ?? 0);
    const minor = Number(doc.properties['uid:minor_version'] ?? 0);
    return `${major}.${minor}`;
  }

  restoreVersion(version: NuxeoDocument): void {
    if (!this.requireWritePermission()) return;
    this.versionDropdownOpen.set(false);
    this.actionInProgress.set('restore');
    this.detailService.restoreVersion(version.uid).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant('document-detail.restored-to-version', {
            version: this.versionString(version),
          }),
        );
        this.loadDocument(this.docUid);
        this.versionsLoaded = false;
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('document-detail.message.failed-to-restore-version'));
      },
    });
  }

  // ── Publish ──

  openPublishDialog(): void {
    if (!this.requireWritePermission()) return;
    const openDialog = (versions: NuxeoDocument[]) => {
      const renditions = this.buildRenditionOptions();
      const ref = this.dialog.open(PublishDialogComponent, {
        width: '620px',
        panelClass: 'publish-dialog-panel',
        data: {
          documentUid: this.docUid,
          documentTitle: this.doc()?.title ?? '',
          versionLabel: this.versionLabel(),
          renditions,
          versions,
        } satisfies PublishDialogData,
      });

      ref.afterClosed().subscribe((published) => {
        if (published) {
          this.publishTabLoaded = false;
        }
      });
    };

    if (this.versionsLoaded) {
      openDialog(this.versions());
    } else {
      this.detailService.getVersions(this.docUid).subscribe({
        next: (res) => {
          const entries = res.entries ?? [];
          this.versions.set(entries);
          this.versionsLoaded = true;
          openDialog(entries);
        },
        error: () => openDialog([]),
      });
    }
  }

  private buildRenditionOptions(): { name: string; label: string }[] {
    const d = this.doc();
    const rends = d?.contextParameters?.['renditions'] as Array<{ name: string }> | undefined;
    const labelMap: Record<string, string> = {
      thumbnail: this.translate.instant('rendition.thumbnail'),
      pdf: this.translate.instant('rendition.pdf'),
      zipExport: this.translate.instant('rendition.zip-export'),
      xmlExport: this.translate.instant('rendition.xml-export'),
    };
    if (!rends) return Object.entries(labelMap).map(([name, label]) => ({ name, label }));
    return rends.map((r) => ({ name: r.name, label: labelMap[r.name] ?? r.name }));
  }

  previewAttachment(att: { name: string; url: string; mimeType: string }): void {
    this.http
      .get(att.url, { responseType: 'blob' })
      // Without this, navigating away while the request is in flight still mints an object URL and
      // opens a dialog after teardown — the URL is only revoked by the dialog that never opened.
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const safeUrl = trustObjectUrl(this.sanitizer, objectUrl);
          this.dialog.open(AttachmentPreviewDialogComponent, {
            width: '90vw',
            maxWidth: '1200px',
            maxHeight: '95vh',
            panelClass: 'preview-dialog-panel',
            data: {
              name: att.name,
              mimeType: att.mimeType,
              // The served type, not the metadata one — the iframe gate needs what the browser
              // will actually parse by.
              blobType: blob.type,
              blobUrl: safeUrl,
              rawUrl: objectUrl,
              // Minted just above for this dialog, so the dialog revokes it on close.
              ownsRawUrl: true,
            },
          });
        },
        error: () =>
          this.toast(this.translate.instant('document-detail.message.failed-to-load-preview')),
      });
  }

  openDriveDialog(): void {
    const doc = this.doc();
    const fileContent = doc?.properties?.['file:content'] as {
      name?: string;
      data?: string;
    } | null;
    // Derive parent folder path so Drive opens in the document's containing folder
    const docPath = doc?.path ?? '';
    const parentPath = docPath.includes('/') ? docPath.split('/').slice(0, -1).join('/') : '/';
    const data: DriveDialogData = {
      docUid: doc?.uid ?? this.docUid,
      filename: fileContent?.name ?? doc?.title ?? '',
      blobUrl: fileContent?.data ?? '',
      docPath: parentPath || '/',
    };
    this.dialog.open(DriveDialogComponent, { width: '500px', data });
  }

  openAddPermissionDialog(): void {
    const data: AddPermissionDialogData = { documentUid: this.docUid };
    const ref = this.dialog.open(AddPermissionDialogComponent, {
      width: '540px',
      data,
      autoFocus: false,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved: boolean) => {
        if (saved) this.reloadDocumentPermissions();
      });
  }

  editPermission(ace: NuxeoAce): void {
    const ref = this.dialog.open(UpdatePermissionDialogComponent, {
      width: '520px',
      data: { documentUid: this.docUid, ace } satisfies UpdatePermissionDialogData,
      autoFocus: false,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated: boolean | undefined) => {
        if (updated) {
          this.toast(this.translate.instant('browse.message.permission-updated'));
          this.reloadDocumentPermissions();
        }
      });
  }

  deletePermission(ace: NuxeoAce): void {
    const ref = this.dialog.open(DeletePermissionDialogComponent, {
      width: '560px',
      data: {
        documentUid: this.docUid,
        ace,
        permissionLabel: this.permissionLabel(ace.permission),
        timeFrameLabel: this.aceTimeFrame(ace),
      } satisfies DeletePermissionDialogData,
      autoFocus: false,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted: boolean | undefined) => {
        if (deleted) {
          this.toast(this.translate.instant('browse.message.permission-deleted'));
          this.reloadDocumentPermissions();
        }
      });
  }

  editExternalPermission(ace: NuxeoAce): void {
    const ref = this.dialog.open(UpdatePermissionDialogComponent, {
      width: '520px',
      data: {
        documentUid: this.docUid,
        ace,
        isExternal: true,
      } satisfies UpdatePermissionDialogData,
      autoFocus: false,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated: boolean | undefined) => {
        if (updated) {
          this.toast(this.translate.instant('browse.message.permission-updated'));
          this.reloadDocumentPermissions();
        }
      });
  }

  sendPermissionNotification(ace: NuxeoAce): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('notify-' + ace.id);
    this.detailService
      .sendNotificationEmailForPermission(this.docUid, ace.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionInProgress.set(null);
          this.toast(this.translate.instant('browse.message.notification-email-sent'));
        },
        error: (err) => {
          this.actionInProgress.set(null);
          this.toast(
            isMailSendError(err)
              ? mailSendFailureMessage('send', (key) => this.translate.instant(key))
              : this.translate.instant('document-detail.message.failed-to-send-notification'),
          );
        },
      });
  }

  toggleInheritanceBlock(): void {
    if (this.actionInProgress()) return;
    const blocked = this.isInheritanceBlocked();
    this.actionInProgress.set('block-inheritance');
    const op = blocked
      ? this.detailService.unblockPermissionInheritance(this.docUid)
      : this.detailService.blockPermissionInheritance(this.docUid);
    op.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant(
            blocked
              ? 'document-detail.message.permission-inheritance-unblocked'
              : 'document-detail.message.permission-inheritance-blocked',
          ),
        );
        this.reloadDocumentPermissions();
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(
          this.translate.instant('document-detail.message.failed-to-update-permission-inheritance'),
        );
      },
    });
  }

  openExternalPermissionDialog(): void {
    if (!this.docUid) return;
    const data: ShareExternalDialogData = { documentUid: this.docUid };
    const ref = this.dialog.open(ShareExternalDialogComponent, {
      width: '540px',
      data,
      autoFocus: false,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved: boolean | undefined) => {
        if (saved) {
          this.reloadDocumentPermissions();
          this.toast(this.translate.instant('browse.message.shared-with-external-user'));
        }
      });
  }

  uploadAttachment(event: Event): void {
    if (!this.requireWritePermission()) {
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.actionInProgress.set('upload');

    this.detailService.uploadAttachment(this.docUid, file).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast(`"${file.name}" attached`);
        this.loadDocument(this.docUid);
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('document-detail.message.failed-to-upload-attachment'));
      },
    });
    input.value = '';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  downloadAttachment(url: string, name: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.click();
  }

  openReplaceDialog(att: { index: number; name: string }): void {
    if (!this.requireWritePermission()) return;
    const ref = this.dialog.open(ReplaceAttachmentDialogComponent, {
      width: '480px',
      data: { fileName: att.name },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((file: File | null) => {
        if (!file) return;
        this.actionInProgress.set('replace');
        this.detailService
          .replaceAttachment(this.docUid, att.index, file)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(`"${att.name}" replaced`);
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.failed-to-replace-attachment'),
              );
            },
          });
      });
  }

  openRemoveDialog(att: { index: number; name: string }): void {
    if (!this.requireWritePermission()) return;
    const ref = this.dialog.open(RemoveAttachmentDialogComponent, { width: '400px' });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed: boolean) => {
        if (!confirmed) return;
        this.actionInProgress.set('remove');
        this.detailService
          .removeAttachment(this.docUid, att.index)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(`"${att.name}" removed`);
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.failed-to-remove-attachment'),
              );
            },
          });
      });
  }

  openReplaceMainFileDialog(): void {
    if (!this.requireWritePermission()) return;
    const ref = this.dialog.open(ReplaceAttachmentDialogComponent, {
      width: '480px',
      data: { fileName: this.fileName() },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((file: File | null) => {
        if (!file) return;
        this.actionInProgress.set('replace-main');
        this.detailService
          .replaceMainFile(this.docUid, file)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(this.translate.instant('document-detail.message.main-file-replaced'));
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.failed-to-replace-main-file'),
              );
            },
          });
      });
  }

  openRemoveMainFileDialog(): void {
    if (!this.requireWritePermission()) return;
    const ref = this.dialog.open(RemoveAttachmentDialogComponent, { width: '400px' });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed: boolean) => {
        if (!confirmed) return;
        this.actionInProgress.set('remove-main');
        this.detailService
          .removeMainFile(this.docUid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast(this.translate.instant('document-detail.message.main-file-removed'));
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast(
                this.translate.instant('document-detail.message.failed-to-remove-main-file'),
              );
            },
          });
      });
  }

  /** Shared by matTooltip and aria-label on the details panel toggle (WCAG 2.5.3, NXENG-766). */
  detailsPanelToggleLabelKey(): 'document-detail.hide-details' | 'document-detail.show-details' {
    return this.propertiesPanelOpen()
      ? 'document-detail.hide-details'
      : 'document-detail.show-details';
  }

  closePropertiesPanel(): void {
    this.propertiesPanelOpen.set(false);
  }

  openPropertiesPanel(): void {
    this.propertiesPanelOpen.set(true);
  }
}
