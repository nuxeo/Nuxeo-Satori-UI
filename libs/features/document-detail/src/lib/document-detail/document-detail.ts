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
  ElementRef,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  descriptorLabel,
  type ExtensionActionDescriptor,
  type ExtensionDocumentViewDescriptor,
  type ExtensionTabDescriptor,
} from '@nuxeo/satori-platform/extensions';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CdkAriaLive } from '@angular/cdk/a11y';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

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
  canManageDocumentPermissions,
  canPublishDocument,
  canTagDocument,
  canWriteDocument,
  canRemoveDocument,
  canViewDocumentAuditLog,
  hasDocumentPermission,
  WRITE_VERSION,
  mergeDocumentPermissionsContext,
  auditActivityLabel,
  resolveAcePrincipal,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
  isBlobHoldingDocType,
  isFolderishDocument,
  isCollectionDocument,
  BrowseContextService,
  decodeNuxeoPathSegment,
  noteFormatLabel,
  normalizeNuxeoPath,
  parentNuxeoFolderPath,
  renderNoteMarkdown,
  isMailSendError,
  mailSendFailureMessage,
  readClipboardDocs,
  writeClipboardDocs,
  renderTrustedHtml,
  toBrowseRouterUrl,
  trustObjectUrl,
  type ClipboardDoc,
  formatRelativeTime,
  permissionRightLabel,
} from '@nuxeo/satori-platform/nuxeo-client';
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatBreadcrumbs, type SatBreadcrumbsItem } from '@hylandsoftware/satori-ui/breadcrumbs';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
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
import { DocumentLayoutComponent } from '@agentic-ui/shared/document-layouts';
import {
  catchError,
  finalize,
  forkJoin,
  map,
  merge,
  Observable,
  of,
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
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';
import { AddToCollectionDialogComponent } from '../add-to-collection-dialog/add-to-collection-dialog';
import { PublishDialogComponent, PublishDialogData } from '../publish-dialog/publish-dialog';
import { AttachmentPreviewDialogComponent } from '../attachment-preview-dialog/attachment-preview-dialog';
import { ReplaceAttachmentDialogComponent } from '../replace-attachment-dialog/replace-attachment-dialog';
import { RemoveAttachmentDialogComponent } from '../remove-attachment-dialog/remove-attachment-dialog';
import { EditDocumentDialogComponent } from '../edit-document-dialog/edit-document-dialog';
import { NoteEditorComponent } from '../note-editor/note-editor';
import { documentTypeTraits, type PackagedDocumentView } from './document-type-traits';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NXS_PERMISSIONS_PANEL_ID,
  NxsCommentExtraDirective,
  NxsCommentsComponent,
  NxsTagEditorComponent,
  NxsDeletePermissionDialogComponent,
  NxsShareExternalDialogComponent,
  NxsUpdatePermissionDialogComponent,
  NxsDetailsPanelComponent,
  NxsDocumentHistoryComponent,
  NxsDocumentToolbarComponent,
  NxsDriveDialogComponent,
  NxsManageVersionsComponent,
  NxsErrorStateComponent,
  NxsPermissionsPanelComponent,
  NxsPropertiesPanelComponent,
  NxsSpinnerComponent,
  NxsTabsComponent,
  NxsTagComponent,
  NxsToastService,
  nxsAceTimeFrame,
  nxsErrorStatus,
  NXS_PRIMITIVE_IDS,
  nxsToggleFavorite,
  provideNxsToast,
  type NxsDeletePermissionDialogData,
  type NxsDetailsPanelTab,
  type NxsDriveDialogData,
  type NxsShareExternalDialogData,
  type NxsUpdatePermissionDialogData,
  type NxsErrorStatus,
  type NxsTab,
  type NxsToolbarAction,
  type NxsVocabularyLabel,
} from '@nuxeo/satori-platform/components';

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
 * The message for a refused restore. 403 is also what Nuxeo answers when another user holds
 * the lock, which removes `WriteVersion` from everyone but its owner and administrators.
 */
function restoreVersionErrorKey(err: unknown): string {
  if (isPermissionDeniedError(err)) return 'document-detail.message.restore-version-forbidden';
  if ((err as { status?: number })?.status === 409) {
    return 'document-detail.message.restore-version-conflict';
  }
  return 'document-detail.message.failed-to-restore-version';
}

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
    NxsCommentExtraDirective,
    NxsCommentsComponent,
    NxsTagEditorComponent,
    NxsDetailsPanelComponent,
    NxsDocumentHistoryComponent,
    NxsDocumentToolbarComponent,
    NxsErrorStateComponent,
    NxsManageVersionsComponent,
    NxsPropertiesPanelComponent,
    NxsSpinnerComponent,
    NxsTabsComponent,
    NxsTagComponent,
    CdkAriaLive,
    TranslatePipe,
    DatePipe,
    NgTemplateOutlet,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DocumentLayoutComponent,
    DocumentViewerComponent,
    ExtensionOutletComponent,
    NxsPermissionsPanelComponent,
    NoteEditorComponent,
    SatAvatarModule,
    SAT_BANNER_IMPORTS,
    SatBreadcrumbs,
    SatGhost,
    SatTagModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideSatoriDateAdapter(), provideNxsToast()],
  templateUrl: './document-detail.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: [
    './document-detail.scss',
    './document-detail-go-back-icon.scss',
    './document-detail-go-back-focus.scss',
    './document-detail-panel-toggle-focus.scss',
    './document-detail-version-banner.scss',
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
  private readonly toast = inject(NxsToastService);
  private readonly dialog = inject(MatDialog);
  private readonly appConfig = inject(AppConfigService);
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
  private readonly aiChatService = inject(AiChatService);
  readonly featureFlags = inject(AiFeatureFlagService);

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

  /** The toolbar actions this document is offered, overflow included, with every rule applied. */
  readonly toolbarActions = computed<readonly ExtensionActionDescriptor[]>(() =>
    this.extensions.resolve<ExtensionActionDescriptor>(
      EXTENSION_SLOTS.toolbar,
      this.extensionRuleContext.context(),
    ),
  );

  /** Ticks when the language or its catalogue changes, so `instant` lookups in computeds re-run. */
  private readonly translationTick = toSignal(
    merge(this.translate.onLangChange, this.translate.onTranslationChange).pipe(
      map((_, index) => index),
    ),
    { initialValue: -1 },
  );

  /**
   * The toolbar slot, resolved for `nxs-document-toolbar`: labels translated, enabled rules
   * evaluated, and the Unlock tooltip naming who holds the lock. `overflow` sends an entry to the
   * "More actions" menu; `overflow: false` in a manifest promotes it out.
   */
  readonly toolbarEntries = computed<readonly NxsToolbarAction[]>(() => {
    this.translationTick();
    return this.toolbarActions().map((action) => ({
      id: action.id,
      label: descriptorLabel(action, (key) => this.translate.instant(key)),
      icon: action.icon,
      tooltip: this.toolbarTooltip(action),
      disabled: !this.isToolbarActionEnabled(action),
      active: this.isToolbarActionActive(action),
      overflow: !!action.overflow,
    }));
  });

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

  /** The tab strip for `nxs-tabs`: labels translated, so a language change relabels it. */
  readonly detailTabEntries = computed<readonly NxsTab[]>(() => {
    this.translationTick();
    return this.detailTabs().map((tab) => ({
      id: tab.id,
      label: descriptorLabel(tab, (key) => this.translate.instant(key)),
      icon: tab.icon,
    }));
  });

  /** The component a contributed tab renders: its `componentId`, else its own ID. */
  tabComponentId(id: string): string {
    const tab = this.detailTabs().find((candidate) => candidate.id === id);
    return tab?.componentId ?? id;
  }

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
  /** Which error state `error` shows: the status of the document request that failed. */
  readonly errorStatus = signal<NxsErrorStatus>(500);
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
  private readonly panelToggle = viewChild('panelToggle', { read: ElementRef });
  private readonly publicationsHeading = viewChild('publicationsHeading', { read: ElementRef });
  /** Web UI's side pane offers Comments only on a document with the `Commentable` facet. */
  readonly panelViews = computed<readonly NxsDetailsPanelTab[]>(() => {
    this.translationTick();
    const view = (id: string) => ({
      id,
      label: this.translate.instant(`document-detail.document-detail.${id}`),
    });
    const commentable = this.doc()?.facets?.includes('Commentable') ?? false;
    return [view('properties'), ...(commentable ? [view('comments')] : []), view('activity')];
  });
  readonly activePanelView = computed(() => {
    const selected = this.panelSubTab();
    return this.panelViews().some((view) => view.id === selected) ? selected : 'properties';
  });
  readonly vocabularyLabel = computed<NxsVocabularyLabel>(() => {
    const nature = this.natureVocabulary();
    const coverage = this.coverageVocabulary();
    const subjects = this.subjectVocabulary();
    return (directory, id) =>
      directory === 'nature'
        ? resolveNatureLabel(id, nature)
        : formatHierarchicalL10nLabel(id, directory === 'l10ncoverage' ? coverage : subjects);
  });
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
  /** Token of the newest `loadDocument` read; the page is reused across `:uid` changes. */
  private documentLoadGeneration = 0;
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
  // Loaded from the Nuxeo `nature` directory for metadata display.
  // Refreshed on each document navigation (Nuxeo Web UI parity).
  readonly natureVocabulary = signal<DirectoryEntry[]>([]);
  readonly coverageVocabulary = signal<L10nDirectoryEntry[]>([]);
  readonly subjectVocabulary = signal<L10nDirectoryEntry[]>([]);

  /** The thread `nxs-comments` loaded, comments and replies, for the sentiment analysis. */
  readonly comments = signal<readonly NuxeoComment[]>([]);

  // Panel activity state (recent activity for the side panel)
  readonly panelActivity = signal<AuditEntry[]>([]);
  readonly panelActivityLoading = signal(false);
  private panelActivityLoaded = false;

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

  private permissionsTabLoaded = false;
  /**
   * `nxs-document-history` reads the audit trail and its vocabularies when it is created, and a tab
   * body is created with the page, so it is rendered only once its tab has been shown.
   */
  readonly historyShown = signal(false);
  readonly activeTabIndex = signal(0);
  readonly permissionsLoading = signal(false);

  /** The `eventTypes` vocabulary's labels, for the side panel's activity; read once. */
  private readonly eventTypeLabels = signal(new Map<string, string>());
  private eventTypesRequested = false;

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
    const cacheKey = `${path}\0${d.title}`;
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
        href: toBrowseRouterUrl(accumulated),
      };
    });
    return this.breadcrumbItemsCache;
  });

  private browseUrlForPath(nuxeoPath: string): string {
    return toBrowseRouterUrl(nuxeoPath);
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

  readonly publicationCount = computed(() => this.publishedDocs().length);

  readonly tags = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const raw = d.properties['nxtag:tags'] as Array<{ label: string }> | string[] | null;
    if (!raw) return [];
    return raw.map((t) => (typeof t === 'string' ? t : t.label));
  });

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

  // Permissions tab computed
  /**
   * Web UI's external-user card: granted, pending or effective shares on the document's own ACLs.
   * An inherited share is the parent's to edit, and an archived one has expired.
   */
  readonly externalAces = computed<(NuxeoAce & { aclName: string })[]>(() => {
    const d = this.doc();
    const acls = d?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    return acls
      .filter((acl) => acl.name !== 'inherited')
      .flatMap((acl) => acl.aces.map((ace) => ({ ...ace, aclName: acl.name })))
      .filter(
        (ace) =>
          ace.externalUser &&
          ace.granted &&
          (ace.status === 'pending' || ace.status === 'effective'),
      );
  });
  /** Web UI's `org.nuxeo.web.ui.permissions.externalUsers`, on unless a package turns it off. */
  readonly showExternalShares = computed(() =>
    this.appConfig.featureToggle('permissions.externalUsers', true),
  );
  private readonly visiblePermissions = computed(
    () => this.doc()?.contextParameters?.['userVisiblePermissions'] as string[] | undefined,
  );

  /**
   * The page is showing a version rather than the live document.
   *
   * A version's `permissions` enricher repeats the live document's — `Write`, `WriteSecurity`
   * and the rest — while the server refuses to modify it, so the enricher alone would render
   * every edit control. The write gates below therefore also ask this.
   */
  readonly isVersionView = computed(() => this.doc()?.isVersion === true);

  readonly canManagePermissions = computed(
    () => !this.isVersionView() && canManageDocumentPermissions(this.doc()),
  );
  readonly permissionsPanelId = NXS_PERMISSIONS_PANEL_ID;
  readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;
  readonly tabsId = NXS_PRIMITIVE_IDS.tabs;
  readonly actionBarId = NXS_PRIMITIVE_IDS.actionBar;
  /** What the tab strip rendered by ID calls in place of `(selectedIndexChange)`. */
  readonly tabSelectHandler = (_tab: NxsTab, index: number): void => this.onTabChange(index);
  /** What the action bar rendered by ID calls in place of `(selected)`. */
  readonly toolbarActionHandler = (entry: NxsToolbarAction): void => this.runToolbarEntry(entry);
  /** The panel's writes can change the external-user shares this tab reads itself. */
  readonly onPermissionsChanged = () => this.reloadDocumentPermissions();
  readonly canWriteDoc = computed(() => !this.isVersionView() && canWriteDocument(this.doc()));
  /** Web UI's `isTaggable`: Write on the document itself, not a version or a proxy. */
  readonly canTag = computed(() => canTagDocument(this.doc()));
  readonly canRemoveDoc = computed(() => canRemoveDocument(this.doc()));

  /** `Document.RestoreVersion` is checked against `WriteVersion`, not `Write`. */
  readonly canRestoreVersion = computed(
    () => this.isVersionView() && hasDocumentPermission(this.doc(), WRITE_VERSION),
  );
  /** The Publishing tab's own Publish, gated as the toolbar's is (`app.rules.canPublish`). */
  readonly canPublish = computed(() => canPublishDocument(this.doc()));

  /** Web UI's `_canUnpublish`: `WriteVersion` on the publication itself, not on this document. */
  canUnpublish(pub: NuxeoDocument): boolean {
    return hasDocumentPermission(pub, WRITE_VERSION);
  }

  /** Web UI's `_canRepublish`: an older version is published, or this one with changes since. */
  canRepublish(pub: NuxeoDocument): boolean {
    if (!this.canUnpublish(pub)) return false;
    const sameVersion =
      Number(pub.properties?.['uid:major_version'] ?? 0) === this.currentMajor() &&
      Number(pub.properties?.['uid:minor_version'] ?? 0) === this.currentMinor();
    return this.isOlderVersion(pub) || (sameVersion && this.doc()?.isCheckedOut === true);
  }

  permissionLabel(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  aceTimeFrame(ace: NuxeoAce): string {
    return nxsAceTimeFrame(ace, (key, params) => this.translate.instant(key, params), this.locale);
  }

  displayUsername(ace: NuxeoAce): string {
    return resolveAcePrincipal(ace.username).replace(/^transient\//, '');
  }

  aceGrantedBy(ace: NuxeoAce): string {
    const creator = ace.creator ? resolveAcePrincipal(ace.creator) : '';
    return creator || '—';
  }

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

  runToolbarEntry(entry: NxsToolbarAction): void {
    const action = this.toolbarActions().find((candidate) => candidate.id === entry.id);
    if (action) this.runToolbarAction(action);
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
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const uid = params.get('uid');
      if (!uid) {
        this.errorStatus.set(404);
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
    const fromCurrent = this.router.currentNavigation()?.extras?.state as
      { freshBlobDocument?: boolean } | undefined;
    if (fromCurrent?.freshBlobDocument === true) {
      return true;
    }
    const historyState = history.state as { freshBlobDocument?: boolean } | undefined;
    return historyState?.freshBlobDocument === true;
  }

  private readFreshNoteNavigationState(): boolean {
    const fromCurrent = this.router.currentNavigation()?.extras?.state as
      { freshNote?: boolean } | undefined;
    if (fromCurrent?.freshNote === true) {
      return true;
    }
    const historyState = history.state as { freshNote?: boolean } | undefined;
    return historyState?.freshNote === true;
  }

  /** Pre-loads vocabulary data for metadata display (live queries). */
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
    this.panelActivity.set([]);
    this.panelActivityLoaded = false;
    this.actionInProgress.set(null);
    this.showStartProcessPanel.set(false);
    this.documentTasks.set([]);
    this.documentWorkflows.set([]);
    this.panelSubTab.set('properties');
    this.permissionsTabLoaded = false;
    this.publishTabLoaded = false;
    this.historyShown.set(this.activeTabId() === 'app.tabs.history');
    // Not just the `publishTabLoaded` flag above: `loadPublishingData()` skips its own fetch
    // while this array is non-empty, so the previous document's entries would both show in the
    // side panel's count and keep Unpublish pointing at its proxies — indefinitely if the new
    // document's count request then failed.
    this.publishedDocs.set([]);
    this.publishLoading.set(false);
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
      next: (labels) => {
        this.setTags(labels);
        this.aiSuggestedTags.update((tags) => tags.filter((t) => t.label !== tagLabel));
        this.toast.show(this.translate.instant('common.tag-applied', { name: tagLabel }));
      },
      error: () =>
        this.toast.error(this.translate.instant('document-detail.message.failed-to-apply-tag')),
    });
  }

  /** Keeps the document's `nxtag:tags` in step with what Nuxeo answered to a tag change. */
  setTags(labels: readonly string[]): void {
    this.doc.update(
      (d) =>
        d && {
          ...d,
          properties: { ...d.properties, 'nxtag:tags': labels.map((label) => ({ label })) },
        },
    );
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

  private loadDocument(uid: string): void {
    const generation = ++this.documentLoadGeneration;
    const isCurrent = (): boolean =>
      generation === this.documentLoadGeneration && uid === this.docUid;
    this.loading.set(true);
    this.error.set(null);

    this.detailService
      .getFullDocument(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (!isCurrent()) return;
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
        },
        error: (err: unknown) => {
          if (!isCurrent()) return;
          this.errorStatus.set(nxsErrorStatus(err));
          this.error.set(this.translate.instant('document-detail.message.failed-to-load-document'));
          this.loading.set(false);
        },
      });
  }

  /* ─── Workflow / Task methods ─── */

  private loadDocumentTasks(uid: string): void {
    this.documentTasksLoading.set(true);
    const generation = this.documentLoadGeneration;
    const userId = this.currentUsername() ?? 'Administrator';
    this.taskService.getDocumentTasks(uid, userId).subscribe({
      next: (tasks) => {
        if (uid !== this.docUid || generation !== this.documentLoadGeneration) return;
        this.documentTasks.set(tasks);
        this.documentTasksLoading.set(false);
      },
      error: () => {
        if (uid === this.docUid && generation === this.documentLoadGeneration) {
          this.documentTasksLoading.set(false);
        }
      },
    });
  }

  private loadDocumentWorkflows(uid: string): void {
    // A late answer for the document the route left would put its workflow banner, and
    // its Abandon button, on the page now showing another — a version, say.
    const generation = this.documentLoadGeneration;
    this.workflowService.getDocumentWorkflows(uid).subscribe({
      next: (wfs) => {
        if (uid === this.docUid && generation === this.documentLoadGeneration) {
          this.documentWorkflows.set(wfs);
        }
      },
      error: () => {
        if (uid === this.docUid && generation === this.documentLoadGeneration) {
          this.documentWorkflows.set([]);
        }
      },
    });
  }

  abandonWorkflow(wf: NuxeoWorkflow): void {
    this.abandoningWorkflow.set(true);
    this.workflowService.cancelWorkflow(wf.id).subscribe({
      next: () => {
        this.abandoningWorkflow.set(false);
        this.toast.show(this.translate.instant('document-detail.message.workflow-abandoned'));
        this.loadDocumentWorkflows(this.docUid);
        this.loadDocumentTasks(this.docUid);
      },
      error: () => {
        this.abandoningWorkflow.set(false);
        this.toast.error(
          this.translate.instant('document-detail.message.failed-to-abandon-workflow'),
        );
      },
    });
  }

  taskDueLabel(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    const d = new Date(task.dueDate);
    return d.toLocaleDateString(this.locale, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  openStartProcess(): void {
    const requestedFor = this.docUid;
    const generation = this.documentLoadGeneration;
    this.showStartProcessPanel.set(true);
    this.workflowsLoading.set(true);
    this.detailService.getRunnableWorkflows(requestedFor).subscribe({
      next: (models) => {
        if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
        this.availableWorkflows.set(models);
        this.workflowsLoading.set(false);
      },
      error: () => {
        if (requestedFor === this.docUid && generation === this.documentLoadGeneration) {
          this.availableWorkflows.set([]);
          this.workflowsLoading.set(false);
        }
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
        this.toast.show(
          this.translate.instant('document-detail.message.workflow-started-successfully'),
        );
        this.loadDocumentTasks(this.docUid);
        this.loadDocumentWorkflows(this.docUid);
      },
      error: () => {
        this.startingWorkflow.set(false);
        this.toast.error(
          this.translate.instant('document-detail.message.failed-to-start-workflow'),
        );
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

  /** The lazy loads the Permissions, Publishing and History tabs need on first show. */
  private loadDataForTab(id: string | null): void {
    if (id === 'app.tabs.history') this.historyShown.set(true);
    if (id === 'app.tabs.permissions' && !this.permissionsTabLoaded) {
      this.reloadDocumentPermissions();
    }
    if (id === 'app.tabs.publishing' && !this.publishTabLoaded) {
      this.loadPublishingData();
    }
  }

  private reloadDocumentPermissions(): void {
    const requestedFor = this.docUid;
    if (!requestedFor) return;
    const generation = this.documentLoadGeneration;
    this.permissionsLoading.set(true);
    this.detailService
      .getDocumentPermissions(requestedFor)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          // Late, this would put the previous document — or its permissions — on the page.
          if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
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
          if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
          this.permissionsLoading.set(false);
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-refresh-permissions'),
          );
        },
      });
  }

  avatarColor = avatarColor;

  tagCategory(index: number): SatTagCategory {
    return TAG_CATEGORIES[index % TAG_CATEGORIES.length];
  }

  /**
   * A version's publications are its live document's, as Web UI lists them: a proxy names the live
   * document as its `proxyVersionableId`, so asking with the version's own uid finds none.
   */
  private loadPublicationCount(uid: string): void {
    const generation = this.documentLoadGeneration;
    this.detailService.getPublishedVersions(this.liveDocumentUid()).subscribe({
      next: (res) => {
        if (uid !== this.docUid || generation !== this.documentLoadGeneration) return;
        this.publishedDocs.set(res.entries);
        this.publishLoading.set(false);
      },
      error: () => {
        if (uid === this.docUid && generation === this.documentLoadGeneration) {
          this.publishLoading.set(false);
        }
      },
    });
  }

  private loadPublishingData(): void {
    this.publishLoading.set(true);
    this.sectionsLoading.set(true);

    if (this.publishedDocs().length === 0) {
      const requestedFor = this.docUid;
      const generation = this.documentLoadGeneration;
      this.detailService.getPublishedVersions(this.liveDocumentUid()).subscribe({
        next: (res) => {
          if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
          this.publishedDocs.set(res.entries);
          this.publishLoading.set(false);
        },
        error: () => {
          if (requestedFor === this.docUid && generation === this.documentLoadGeneration) {
            this.publishLoading.set(false);
          }
        },
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
    if (!target || !this.docUid || !this.canPublish()) return;
    this.publishing.set(true);

    this.detailService.publishDocument(this.docUid, target, { override: true }).subscribe({
      next: () => {
        this.publishing.set(false);
        this.selectedSectionId.set(null);
        this.toast.show(this.translate.instant('document-detail.message.document-published'));
        this.refreshPublishedDocs();
      },
      error: () => {
        this.publishing.set(false);
        this.toast.error(this.translate.instant('document-detail.message.failed-to-publish'));
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
    this.onTabChange(index);
  }

  unpublishDocument(proxyDoc: NuxeoDocument): void {
    if (this.actionInProgress()) return;
    this.confirmPublicationAction(
      'document-detail.document-detail.unpublish',
      'document-detail.document-detail.unpublish-confirm',
      () => {
        this.actionInProgress.set('unpublish');
        this.detailService
          .unpublishDocument(proxyDoc.uid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.publishedDocs.update((docs) => docs.filter((d) => d.uid !== proxyDoc.uid));
              this.focusPublicationsHeading();
              this.toast.show(
                this.translate.instant('document-detail.message.publication-removed'),
              );
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
                this.translate.instant('document-detail.message.failed-to-unpublish'),
              );
            },
          });
      },
    );
  }

  republishDocument(proxyDoc: NuxeoDocument): void {
    if (this.actionInProgress()) return;
    this.confirmPublicationAction(
      'document-detail.document-detail.republish',
      'document-detail.document-detail.republish-confirm',
      () => {
        this.actionInProgress.set('republish');
        this.republishToSectionByProxy(proxyDoc);
      },
    );
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
            this.toast.error(this.translate.instant('document-detail.message.section-not-found'));
          }
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast.error(this.translate.instant('document-detail.message.failed-to-republish'));
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
          this.focusPublicationsHeading();
          this.toast.show(this.translate.instant('document-detail.message.document-republished'));
          this.refreshPublishedDocs();
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast.error(this.translate.instant('document-detail.message.failed-to-republish'));
        },
      });
  }

  unpublishAll(): void {
    if (this.publishedDocs().length === 0 || this.actionInProgress()) return;
    this.confirmPublicationAction(
      'document-detail.document-detail.unpublish-all',
      'document-detail.document-detail.unpublish-all-confirm',
      () => {
        const docs = this.publishedDocs();
        if (docs.length === 0) return;
        this.actionInProgress.set('unpublish-all');
        const deletions = docs.map((d) => this.detailService.unpublishDocument(d.uid));
        forkJoin(deletions)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.publishedDocs.set([]);
              this.focusPublicationsHeading();
              this.toast.show(
                this.translate.instant('document-detail.message.all-publications-removed'),
              );
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
                this.translate.instant(
                  'document-detail.message.failed-to-remove-some-publications',
                ),
              );
              this.refreshPublishedDocs();
            },
          });
      },
    );
  }

  /**
   * Web UI asks before each publication action (`nuxeo-document-publications`). On Cancel the
   * dialog returns focus to the button that opened it.
   */
  private confirmPublicationAction(actionKey: string, questionKey: string, run: () => void): void {
    const action = this.translate.instant(actionKey);
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: action,
          message: this.translate.instant(questionKey),
          confirmLabel: action,
        } as ConfirmDialogData,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed && !this.actionInProgress()) run();
      });
  }

  /** The button that ran a publication action may leave with its row, so focus goes to the heading. */
  private focusPublicationsHeading(): void {
    (this.publicationsHeading()?.nativeElement as HTMLElement | undefined)?.focus();
  }

  private refreshPublishedDocs(): void {
    const requestedFor = this.docUid;
    const generation = this.documentLoadGeneration;
    this.detailService.getPublishedVersions(this.liveDocumentUid()).subscribe({
      next: (res) => {
        if (requestedFor === this.docUid && generation === this.documentLoadGeneration) {
          this.publishedDocs.set(res.entries);
        }
      },
    });
  }

  // ── Document Actions ──

  toggleLock(): void {
    if (this.actionInProgress() || !this.isLockable() || !this.requireWritePermission()) return;
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
        this.toast.show(
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
        this.toast.error(this.translate.instant(this.lockRefusalKey(err, wasLocked)));
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
    const uid = this.docUid;
    nxsToggleFavorite(this.detailService, uid, this.isFavorite())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (favorite) => {
          // The page is reused when `:uid` changes: an answer for the document left behind says
          // nothing about the star of the one now shown, which loaded its own.
          if (uid === this.docUid) this.isFavorite.set(favorite);
          this.actionInProgress.set(null);
          this.toast.show(
            this.translate.instant(
              favorite
                ? 'document-detail.message.added-to-favorites'
                : 'document-detail.message.removed-from-favorites',
            ),
          );
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-update-favorites'),
          );
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
        this.toast.show(
          this.translate.instant(
            wasSub
              ? 'document-detail.message.notifications-disabled'
              : 'document-detail.message.notifications-enabled',
          ),
        );
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast.error(this.translate.instant('browse.message.failed-to-update-notifications'));
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
              this.toast.show(
                this.translate.instant('document-detail.message.document-moved-to-trash'),
              );
              this.goBack();
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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
          this.toast.show(this.translate.instant('document-detail.message.document-restored'));
          this.loadDocument(this.docUid);
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast.error(this.translate.instant('browse.message.failed-to-restore-document'));
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
              this.toast.show(
                this.translate.instant('document-detail.message.document-permanently-deleted'),
              );
              this.goBack();
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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
      this.toast.show(this.translate.instant('collections.message.removed-from-clipboard'));
    } else {
      const updated = [...current, { uid: d.uid, title: d.title, type: d.type }];
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast.show(this.translate.instant('collections.message.added-to-clipboard'));
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
          this.toast.show(this.translate.instant('document-detail.message.added-to-collection'));
        },
        error: () => {
          this.actionInProgress.set(null);
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-add-to-collection'),
          );
        },
      });
    });
  }

  openEditDialog(): void {
    const currentDoc = this.doc();
    if (!currentDoc || !this.requireWritePermission()) return;

    const ref = this.dialog.open(EditDocumentDialogComponent, {
      width: '720px',
      maxWidth: '95vw',
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
        this.toast.show(this.translate.instant('browse.message.document-updated'));
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
          this.toast.show(this.translate.instant('document-detail.message.note-saved'));
        },
        error: (err) => {
          this.noteSaving.set(false);
          this.toast.error(
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

  /**
   * The packaged Lock/Unlock rules' Immutable/Root restriction, held here too because a manifest
   * may clear those rules, and an administrator keeps Write on a version.
   */
  private isLockable(): boolean {
    const d = this.doc();
    return !d?.facets?.includes('Immutable') && d?.type !== 'Root';
  }

  /**
   * Through `canWriteDoc`, so a version is refused here too: a manifest may re-enable a write
   * action's rule, and the handler must not then open an editor on a version.
   */
  private requireWritePermission(): boolean {
    if (this.canWriteDoc()) return true;
    this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
    return false;
  }

  private requireRemovePermission(): boolean {
    if (canRemoveDocument(this.doc())) return true;
    this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
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
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-download-document'),
          ),
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

  switchPanelSubTab(tab: string): void {
    if (tab !== 'properties' && tab !== 'comments' && tab !== 'activity') return;
    this.panelSubTab.set(tab);
    if (tab === 'activity' && !this.panelActivityLoaded) {
      this.loadPanelActivity();
    }
  }

  /**
   * Localised by `Intl.RelativeTimeFormat` rather than by a catalogue — see
   * `formatRelativeTime` for why a key per unit cannot express Polish or Arabic plurals.
   */
  relativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.translate.getCurrentLang() ?? 'en');
  }

  // ── Panel Activity ──

  loadPanelActivity(): void {
    if (!this.docUid) return;
    this.loadEventTypeLabels();

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
    const requestedFor = this.docUid;
    const generation = this.documentLoadGeneration;
    this.detailService
      .getAuditLog(requestedFor, 20, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
          this.panelActivity.set(res.entries);
          this.panelActivityLoading.set(false);
          this.panelActivityLoaded = true;
        },
        error: () => {
          if (requestedFor === this.docUid && generation === this.documentLoadGeneration) {
            this.panelActivityLoading.set(false);
          }
        },
      });
  }

  activityLabel(entry: AuditEntry): string {
    return auditActivityLabel(entry, this.eventTypeLabels());
  }

  /** The activity list names an event by its vocabulary label once the vocabulary is read. */
  private loadEventTypeLabels(): void {
    if (this.eventTypesRequested) return;
    this.eventTypesRequested = true;
    this.directoryService
      .getEventTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (types) =>
          this.eventTypeLabels.set(new Map(types.map((t) => [t.id, t.displayLabel]))),
        error: () => (this.eventTypesRequested = false),
      });
  }

  // ── Versioning ──

  /** `nxs-manage-versions` created one: the document is checked in at it now. */
  onVersionCreated(): void {
    this.loadDocument(this.docUid);
  }

  /** The live document — this one, or the one a version on screen belongs to. */
  private liveDocumentUid(): string {
    const d = this.doc();
    return (d?.isVersion && d.versionableId) || this.docUid;
  }

  versionString(doc: NuxeoDocument): string {
    const major = Number(doc.properties['uid:major_version'] ?? 0);
    const minor = Number(doc.properties['uid:minor_version'] ?? 0);
    return `${major}.${minor}`;
  }

  /** Move between a document and its versions. */
  private navigateWithinVersions(uid: string): void {
    void this.router.navigate(['/doc', uid]);
  }

  /** Open a version read-only. Choosing one from the list never restores it. */
  openVersion(version: NuxeoDocument): void {
    if (version.uid !== this.docUid) this.navigateWithinVersions(version.uid);
  }

  /** Leave a version for the live document it belongs to. */
  showLatestVersion(): void {
    const liveUid = this.liveDocumentUid();
    if (liveUid !== this.docUid) this.navigateWithinVersions(liveUid);
  }

  /** Restoring replaces the live document's content, so it is confirmed first. */
  confirmRestoreVersion(): void {
    const version = this.doc();
    if (!version || !this.canRestoreVersion() || this.actionInProgress()) return;
    const label = this.versionString(version);
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: this.translate.instant('document-detail.version-restore-confirm-title'),
          message: this.translate.instant('document-detail.version-restore-replaces-content', {
            version: label,
          }),
          confirmLabel: this.translate.instant('document-detail.version-restore', {
            version: label,
          }),
        } as ConfirmDialogData,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) this.restoreVersion(version);
      });
  }

  restoreVersion(version: NuxeoDocument): void {
    if (!hasDocumentPermission(version, WRITE_VERSION)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    const generation = this.documentLoadGeneration;
    const versionUid = version.uid;
    this.actionInProgress.set('restore');
    this.detailService
      .restoreVersion(versionUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (generation !== this.documentLoadGeneration) return;
          this.actionInProgress.set(null);
          this.toast.show(
            this.translate.instant('document-detail.restored-to-version', {
              version: this.versionString(version),
            }),
          );
          const liveUid = version.versionableId;
          if (liveUid && liveUid !== this.docUid) {
            this.navigateWithinVersions(liveUid);
          } else {
            this.loadDocument(this.docUid);
          }
        },
        error: (err: unknown) => {
          if (generation !== this.documentLoadGeneration) return;
          this.actionInProgress.set(null);
          this.toast.error(this.translate.instant(restoreVersionErrorKey(err)));
        },
      });
  }

  // ── Publish ──

  /**
   * Web UI's `isPublishable`, so a version is published as it is: `Document.PublishToSection`
   * runs on the document on screen, and the dialog lists the live document's versions.
   */
  openPublishDialog(): void {
    const doc = this.doc();
    if (!doc || !canPublishDocument(doc)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    const requestedFor = this.docUid;
    const generation = this.documentLoadGeneration;
    const openDialog = (versions: NuxeoDocument[]) => {
      if (requestedFor !== this.docUid || generation !== this.documentLoadGeneration) return;
      this.dialog
        .open(PublishDialogComponent, {
          width: '620px',
          panelClass: 'publish-dialog-panel',
          data: {
            documentUid: doc.uid,
            documentTitle: doc.title,
            versionLabel: this.versionLabel(),
            renditions: this.buildRenditionOptions(),
            versions,
          } satisfies PublishDialogData,
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((published) => {
          if (!published) return;
          this.publishTabLoaded = false;
          this.refreshPublishedDocs();
        });
    };
    this.detailService
      .getVersionsDirect(this.liveDocumentUid())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (versions) => openDialog(versions),
        error: () => openDialog([]),
      });
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
          this.toast.error(
            this.translate.instant('document-detail.message.failed-to-load-preview'),
          ),
      });
  }

  openDriveDialog(): void {
    // Drive opens the folder that holds the document.
    const docPath = this.doc()?.path ?? '';
    const parentPath = docPath.includes('/') ? docPath.split('/').slice(0, -1).join('/') : '/';
    const data: NxsDriveDialogData = { folderPath: parentPath || '/' };
    this.dialog.open(NxsDriveDialogComponent, { data });
  }

  deletePermission(ace: NuxeoAce & { aclName?: string }): void {
    const ref = this.dialog.open(NxsDeletePermissionDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      role: 'alertdialog',
      data: {
        documentUid: this.docUid,
        ace,
        acl: ace.aclName,
      } satisfies NxsDeletePermissionDialogData,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted: boolean | undefined) => {
        if (deleted) {
          this.toast.show(this.translate.instant('browse.message.permission-deleted'));
          this.reloadDocumentPermissions();
        }
      });
  }

  editExternalPermission(ace: NuxeoAce): void {
    const ref = this.dialog.open(NxsUpdatePermissionDialogComponent, {
      maxWidth: '95vw',
      data: {
        documentUid: this.docUid,
        ace,
        permissions: this.visiblePermissions(),
      } satisfies NxsUpdatePermissionDialogData,
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated: boolean | undefined) => {
        if (updated) this.reloadDocumentPermissions();
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
          this.toast.show(this.translate.instant('browse.message.notification-email-sent'));
        },
        error: (err) => {
          this.actionInProgress.set(null);
          this.toast.error(
            isMailSendError(err)
              ? mailSendFailureMessage('send', (key) => this.translate.instant(key))
              : this.translate.instant('document-detail.message.failed-to-send-notification'),
          );
        },
      });
  }

  openExternalPermissionDialog(): void {
    if (!this.docUid) return;
    const data: NxsShareExternalDialogData = {
      documentUid: this.docUid,
      permissions: this.visiblePermissions(),
    };
    const ref = this.dialog.open(NxsShareExternalDialogComponent, { maxWidth: '95vw', data });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((shared: boolean | undefined) => {
        if (shared) this.reloadDocumentPermissions();
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
        this.toast.show(`"${file.name}" attached`);
        this.loadDocument(this.docUid);
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast.error(
          this.translate.instant('document-detail.message.failed-to-upload-attachment'),
        );
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
              this.toast.show(`"${att.name}" replaced`);
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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
              this.toast.show(`"${att.name}" removed`);
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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
              this.toast.show(this.translate.instant('document-detail.message.main-file-replaced'));
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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
              this.toast.show(this.translate.instant('document-detail.message.main-file-removed'));
              this.loadDocument(this.docUid);
            },
            error: () => {
              this.actionInProgress.set(null);
              this.toast.error(
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

  /** The close button leaves with the panel, so focus goes to the button that reopens it. */
  closePropertiesPanel(): void {
    this.propertiesPanelOpen.set(false);
    (this.panelToggle()?.nativeElement as HTMLElement | undefined)?.focus();
  }

  openPropertiesPanel(): void {
    this.propertiesPanelOpen.set(true);
  }
}
