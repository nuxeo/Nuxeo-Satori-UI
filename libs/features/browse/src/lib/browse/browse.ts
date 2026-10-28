import {
  NxsDateInputComponent,
  NXS_PERMISSIONS_PANEL_ID,
  NXS_PRIMITIVE_IDS,
  NxsActionMenuComponent,
  NxsBreadcrumbsComponent,
  NxsCardComponent,
  NxsColumnPickerComponent,
  NxsDocumentListComponent,
  NxsDomainHintComponent,
  NxsDriveDialogComponent,
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsErrorStateComponent,
  NxsFolderHeaderComponent,
  NxsPagerComponent,
  NxsPermissionsPanelComponent,
  NxsSpinnerComponent,
  NxsThumbnailComponent,
  NxsUploadQueue,
  NxsUploadQueueComponent,
  nxsErrorStatus,
  provideNxsThumbnailCache,
  type NxsBreadcrumbItem,
  type NxsDocumentListColumn,
  type NxsDocumentListRowAction,
  type NxsDocumentListSort,
  type NxsDriveDialogData,
  type NxsErrorStatus,
  type NxsFolderPickerDialogData,
  type NxsFolderPickerDialogResult,
  type NxsRenameDialogData,
  type NxsMenuAction,
  type NxsPickableColumn,
  NxsToastService,
  nxsVisibleText,
  provideNxsToast,
} from '@nuxeo/satori-platform/components';

import {
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, of, Subject, timer, EMPTY } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
} from 'rxjs/operators';

import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

import {
  NuxeoDocument,
  NuxeoAcl,
  NuxeoAce,
  AuditEntry,
  DirectoryEntry,
  BROWSE_FILTER_SCAN_LIMIT,
  type BrowseFolderEntrySet,
  type BrowseSortEntry,
  BrowseService,
  BrowseContextService,
  ClipboardTargetService,
  decodeNuxeoPathSegment,
  nuxeoBreadcrumbTitles,
  parseBrowseNuxeoPathFromRouterUrl,
  isBrowseRouterUrl,
  nuxeoPathsEqualFlexible,
  DocumentDetailService,
  DirectoryService,
  DocumentImportService,
  SelectionService,
  TagService,
  docTypeIcon,
  avatarColor,
  isFolderishDocument,
  canAddChildren,
  canManageDocumentPermissions,
  mergeDocumentPermissionsContext,
  canWriteDocument,
  canRemoveDocument,
  canShowRemoveDocumentAction,
  canShowWriteDocumentAction,
  hasDocumentPermissionsEnricher,
  canViewDocumentAuditLog,
  auditActivityLabel,
  DOMAIN_CONTAINER_GUIDANCE_KEY,
  isDomainParentType,
  isRestrictedImportParentPath,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
  isMailSendError,
  mailSendFailureMessage,
  resolveAcePrincipal,
  CURRENT_USERNAME,
  ADMIN_ACCESS_CHECKS,
  shouldShowUserWorkspaceBreadcrumbs,
  postTrashBrowseRouterUrl,
  isCollectionDocument,
  formatRelativeTime,
  formatAceDateRange,
  permissionRightLabel,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';

import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import { SatTagModule } from '@hylandsoftware/satori-ui/tag';

import {
  ConfirmDialogComponent,
  ConfirmDialogData,
  EditCollectionDialogComponent,
  EditCollectionDialogData,
  ExportDialogComponent,
  ExportDialogData,
  ExportType,
  ShareDialogComponent,
  ShareDialogData,
  trashDocumentConfirmData,
  trashSelectedDocumentsConfirmData,
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';

import {
  UpdatePermissionDialogComponent,
  UpdatePermissionDialogData,
  DeletePermissionDialogComponent,
  DeletePermissionDialogData,
  ShareExternalDialogComponent,
  ShareExternalDialogData,
} from '@agentic-ui/shared-permission-dialogs';

import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  descriptorLabel,
  ExtensionActionRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  type ExtensionActionDescriptor,
  type ExtensionColumnDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';

import {
  ALL_COLUMNS,
  ColumnDef,
  loadColumnVisibility,
  saveColumnSettings,
} from '../column-settings-dialog/column-settings-dialog';
import {
  EditMetadataDialogComponent,
  EditMetadataDialogData,
} from '../edit-metadata-dialog/edit-metadata-dialog';
import { CreateImportDialogComponent } from '../create-import/create-import-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/**
 * The packaged column set as descriptors, for an injector where Layer 1
 * registration has not run. Derived from `ALL_COLUMNS` rather than restated, so
 * there is one list to keep in step instead of two.
 */
const FALLBACK_COLUMN_DESCRIPTORS: readonly ExtensionColumnDescriptor[] = ALL_COLUMNS.map(
  (col, index) => ({
    id: `app.documentList.${col.key}`,
    label: col.label,
    field: col.key,
    order: (index + 1) * 10,
    ...(col.visible ? {} : { hiddenByDefault: true }),
  }),
);

/**
 * The Nuxeo property each sortable column orders by on the server.
 *
 * Only these five: every browse source — `@children`, `tree_children` and
 * `default_content_collection` — was checked to sort by each of them, and they are the columns Nuxeo
 * Web UI's folder and collection views sort. A column outside this map gets a plain header, because
 * `@children` answers a property it cannot sort by with an empty page rather than an error.
 */
const SORT_FIELDS: Readonly<Record<string, string>> = {
  title: 'dc:title',
  modified: 'dc:modified',
  lastContributor: 'dc:lastContributor',
  created: 'dc:created',
  author: 'dc:creator',
};

/** One page of a folder: the 50 entries browse has always asked for, now with the rest reachable. */
/** One folder-scan request. Carries its own sort, so a later re-order cannot rewrite it. */
interface ScanRequest {
  path: string;
  sortKey: string;
  generation: number;
  sort: BrowseSortEntry[];
}

const PAGE_SIZE = 50;

@Component({
  selector: 'lib-browse',
  standalone: true,
  providers: [
    provideSatoriDateAdapter(),
    provideTranslatedDatepickerIntl(),
    provideNxsToast(),
    provideNxsThumbnailCache(),
  ],
  imports: [
    NxsDateInputComponent,
    NxsActionMenuComponent,
    NxsBreadcrumbsComponent,
    NxsCardComponent,
    NxsColumnPickerComponent,
    NxsDocumentListComponent,
    NxsDomainHintComponent,
    NxsErrorStateComponent,
    NxsFolderHeaderComponent,
    NxsPagerComponent,
    NxsSpinnerComponent,
    NxsThumbnailComponent,
    NxsUploadQueueComponent,
    DocTypeLabelPipe,
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatTabsModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatAutocompleteModule,
    SatAvatarModule,
    SatTagModule,
    ExtensionOutletComponent,
    NxsPermissionsPanelComponent,
  ],
  templateUrl: './browse.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './browse.scss',
})
export class BrowseComponent {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  private readonly router = inject(Router);
  private readonly browseService = inject(BrowseService);
  private readonly browseContext = inject(BrowseContextService);
  private readonly clipboardTargetService = inject(ClipboardTargetService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly directoryService = inject(DirectoryService);
  private readonly tagService = inject(TagService);
  readonly selectionService = inject(SelectionService);
  private readonly extensions = inject(AppExtensionsService);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly actionRegistry = inject(ExtensionActionRegistry);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(NxsToastService);
  private readonly importService = inject(DocumentImportService);
  /** Files dropped on the list: each one's progress and outcome, through the import's own queue. */
  readonly droppedUploads = new NxsUploadQueue();
  /** The folder the dropped files go into, kept for a retry after the page has moved on. */
  private droppedUploadPath: string | null = null;
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly adminAccess = inject(ADMIN_ACCESS_CHECKS);

  // Core state
  readonly entries = signal<NuxeoDocument[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Which error state `error` shows: the status of the request that failed. */
  readonly errorStatus = signal<NxsErrorStatus>(500);
  readonly currentDoc = signal<NuxeoDocument | null>(null);
  /** The folder the address names when it could not be opened — refused, missing or failing. */
  private readonly unopenedPath = signal<string | null>(null);
  /** The address whose folder is on screen, as it was asked for. */
  private openedPath: string | null = null;
  /** Nuxeo's count of the folder's entries; negative when it did not count them. */
  readonly totalSize = signal(0);
  readonly pageSize = PAGE_SIZE;
  readonly pageIndex = signal(0);
  readonly hasNextPage = signal(false);
  /** The server-side order, or `null` for the source's own. Kept across folders, like Web UI. */
  readonly listSort = signal<NxsDocumentListSort | null>(null);
  private currentNuxeoPath = '/';
  /** Skips the initial contentRefreshTick effect run to avoid duplicate folder loads. */
  private lastSeenContentRefreshTick = -1;
  /** Skips the initial clipboardPasteTick effect run. */
  private lastSeenClipboardPasteTick = -1;
  /** Clipboard paste results not yet visible in @children (eventual consistency on Cloud). */
  private readonly pendingPasteEntries = new Map<string, NuxeoDocument>();
  /**
   * The same pending rows as a signal.
   *
   * The map alone is invisible to `computed()`, and the scanned folder needs them: a paste is
   * optimistic because `@children` is eventually consistent, so the new rows live only in
   * `entries()` until the server catches up. Without this a just-pasted document was missing from
   * a filtered listing even though it was sitting in the page behind the filter.
   */
  private readonly pendingPasteList = signal<NuxeoDocument[]>([]);
  /**
   * Which of the two document sources was populated most recently.
   *
   * Needed because neither is inherently fresher. A scan that finishes after a content refresh
   * carries the newer copy of a renamed document; a page reloaded after the scan carries it
   * instead. Picking a side by assumption got one of those two cases wrong whichever side was
   * chosen, so the collision is settled by read order. Plain fields, written immediately before
   * the signal they describe — the recompute is driven by that signal, so these cannot be read
   * stale.
   */
  private sourceClock = 0;
  private entriesStamp = 0;
  private scanStamp = 0;
  readonly browsePath = signal('/');
  private readonly browsePath$ = new Subject<{ nuxeoPath: string; pageIndex: number }>();

  // Details side panel
  readonly panelOpen = signal(false);
  readonly panelSubTab = signal<'info' | 'tags' | 'activity'>('info');
  readonly tags = computed<string[]>(() => {
    const doc = this.currentDoc();
    if (!doc) return [];
    const raw = doc.properties?.['nxtag:tags'] as Array<{ label: string } | string> | undefined;
    if (!raw) return [];
    return raw.map((t) => (typeof t === 'string' ? t : t.label));
  });
  readonly activityEntries = signal<AuditEntry[]>([]);
  readonly activityLoading = signal(false);

  // Tag autocomplete
  tagInput = '';
  readonly tagSearchResults = signal<string[]>([]);
  readonly showCreateOption = signal(false);
  private readonly tagSearch$ = new Subject<string>();

  // Tabs
  readonly activeTabIndex = signal(0);

  // Permissions tab
  readonly permissionsLoaded = signal(false);
  readonly permissionsLoading = signal(false);
  readonly permissionsPanelId = NXS_PERMISSIONS_PANEL_ID;
  /** The panel's writes can change the external-user shares this tab reads itself. */
  readonly onPermissionsChanged = () => this.reloadPermissions();
  readonly externalAces = computed<NuxeoAce[]>(() => {
    const doc = this.currentDoc();
    const acls = doc?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    return acls.flatMap((a) => a.aces).filter((ace) => ace.externalUser && ace.granted);
  });
  readonly canWriteCurrentDoc = computed(() => canWriteDocument(this.currentDoc()));
  readonly canCreateContentHere = computed(() => {
    const doc = this.currentDoc();
    if (!doc || doc.type === 'Favorites' || !canAddChildren(doc) || !this.isBrowseFolderish(doc)) {
      return false;
    }
    return !isDomainParentType(doc.type) && !isRestrictedImportParentPath(doc.path);
  });
  readonly canRemoveCurrentDoc = computed(() => canRemoveDocument(this.currentDoc()));
  readonly singleSelectedEntry = computed(() => {
    const ids = [...this.selectionService.selectedIds()];
    if (ids.length !== 1) return null;
    const id = ids[0];
    return this.selectableEntries().find((doc) => doc.uid === id) ?? null;
  });
  readonly showHeaderEdit = computed(() => {
    const selected = this.singleSelectedEntry();
    if (selected && isCollectionDocument(selected)) {
      return canShowWriteDocumentAction(selected);
    }
    return this.canWriteCurrentDoc();
  });
  readonly showHeaderDelete = computed(() => {
    if (this.selectionService.selectedCount() > 0) {
      return this.selectedEntries().some((doc) => canShowRemoveDocumentAction(doc));
    }
    return this.canRemoveCurrentDoc();
  });
  readonly canManageCurrentPermissions = computed(() =>
    canManageDocumentPermissions(this.currentDoc()),
  );
  readonly actionInProgress = signal<string | null>(null);

  // History tab
  readonly auditEntries = signal<AuditEntry[]>([]);
  readonly auditLoading = signal(false);
  readonly auditTotalSize = signal(0);
  readonly auditPageSize = signal(10);
  readonly auditPageIndex = signal(0);
  private historyLoaded = false;
  /**
   * History-tab filter and sort state, as signals.
   *
   * These were plain fields, and `filteredAuditEntries` below is a `computed()`
   * that reads them. A computed only recomputes when a tracked *signal*
   * dependency changes, so its sole dependency was `auditEntries` — every
   * filter keystroke and every column sort updated the field, left the memoised
   * value in place, and the History tab did not move. The browse document list
   * next to it already held its filters in signals; this half had been missed.
   */
  readonly filterUsername = signal('');
  readonly filterDateFrom = signal<Date | null>(null);
  readonly filterDateTo = signal<Date | null>(null);
  readonly filterAction = signal('');
  readonly filterCategory = signal('');
  readonly availableActions = signal<DirectoryEntry[]>([]);
  readonly availableCategories = signal<DirectoryEntry[]>([]);
  readonly eventTypeLabelMap = signal<Record<string, string>>({});
  readonly eventCategoryLabelMap = signal<Record<string, string>>({});
  readonly sortActive = signal('eventDate');
  readonly sortDirection = signal<'asc' | 'desc' | ''>('desc');

  readonly filteredAuditEntries = computed(() => {
    let entries = this.auditEntries();
    const username = this.filterUsername();
    const dateFrom = this.filterDateFrom();
    const dateTo = this.filterDateTo();
    const action = this.filterAction();
    const category = this.filterCategory();
    const sortActive = this.sortActive();
    const sortDirection = this.sortDirection();

    if (username) {
      const term = username.toLowerCase();
      entries = entries.filter((e) => e.principalName?.toLowerCase().includes(term));
    }
    if (dateFrom) {
      const from = dateFrom.getTime();
      entries = entries.filter((e) => new Date(e.eventDate).getTime() >= from);
    }
    if (dateTo) {
      const to = dateTo.getTime() + 86_400_000;
      entries = entries.filter((e) => new Date(e.eventDate).getTime() < to);
    }
    if (action) {
      entries = entries.filter((e) => e.eventId === action);
    }
    if (category) {
      entries = entries.filter((e) => e.category === category);
    }
    if (sortActive && sortDirection) {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const key = sortActive as keyof AuditEntry;
      entries = [...entries].sort((a, b) => {
        const va = String(a[key] ?? '');
        const vb = String(b[key] ?? '');
        return va.localeCompare(vb) * dir;
      });
    }
    return entries;
  });

  // Trash tab
  readonly trashedDocs = signal<NuxeoDocument[]>([]);
  readonly trashLoading = signal(false);
  private trashLoaded = false;

  // View toggle
  readonly viewMode = signal<'list' | 'card'>('list');
  readonly csvExporting = signal(false);

  // ── Column settings ──
  //
  // Three layers, narrowest last: packaged descriptors registered into the
  // `documentList` slot, then the manifest's hide/reorder/relabel by id, then the
  // user's own picker. `columns` is computed rather than a signal so a manifest
  // change reflows without a reload; the user's choice is the only mutable part.

  /** Keys the user switched on, or `null` if they have never chosen. */
  private readonly userVisibleKeys = signal<readonly string[] | null>(loadColumnVisibility());

  /**
   * Descriptors resolved through Layer 1, falling back to the packaged list.
   *
   * The fallback matters: a bare `TestBed` has no `APP_INITIALIZER`, so the slot
   * is empty there, and rendering a document list with no columns at all would be
   * a worse failure than using the defaults. This mirrors how `app-config` treats
   * an absent manifest — tolerant, with the packaged values reproducing the
   * pre-Layer-1 behaviour exactly.
   */
  private readonly columnDescriptors = computed<readonly ExtensionColumnDescriptor[]>(() => {
    const resolved = this.extensions.resolve<ExtensionColumnDescriptor>(
      EXTENSION_SLOTS.documentList,
      this.ruleContext.context(),
    );
    return resolved.length > 0 ? resolved : FALLBACK_COLUMN_DESCRIPTORS;
  });

  readonly columns = computed<ColumnDef[]>(() => {
    const chosen = this.userVisibleKeys();
    return this.columnDescriptors().map((descriptor) => ({
      key: descriptor.field,
      label: descriptor.label,
      // Carried through so the template can prefer the key; `ColumnDef` is a view model, and
      // resolving here would mean the header stopped following a language change.
      labelKey: descriptor.labelKey,
      visible: chosen ? chosen.includes(descriptor.field) : !descriptor.hiddenByDefault,
    }));
  });

  readonly visibleColumns = computed(() => this.columns().filter((c) => c.visible));
  readonly columnPanelOpen = signal(false);

  /** Title keys every row; the picker will not let a user switch it off. */
  readonly requiredColumnKeys: readonly string[] = ['title'];

  /** What Reset returns to: the descriptors' defaults, so a manifest-hidden column stays hidden. */
  readonly defaultColumnKeys = computed(() =>
    this.columnDescriptors()
      .filter((descriptor) => !descriptor.hiddenByDefault)
      .map((descriptor) => descriptor.field),
  );

  /**
   * The active language as a signal. `translate.instant` is not reactive, so the picker's
   * labels read this to follow a language change.
   */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() ?? 'en' },
  );

  /** The columns as the picker offers them: names resolved for the active language. */
  readonly pickerColumns = computed<readonly NxsPickableColumn[]>(() => {
    this.currentLang();
    return this.columns().map((column) => ({
      key: column.key,
      label: descriptorLabel(column, (key) => this.translate.instant(key)),
      visible: column.visible,
    }));
  });

  /**
   * The browse document context menu, resolved through Layer 1.
   *
   * Share, Notify Me / Unsubscribe and Export were three fixed `mat-menu-item`
   * elements here. They are the same three, in the same order, with the same
   * icons; what changed is that each is addressable by id, so a manifest can
   * hide, reorder, relabel or gate one, and a customer library can add a fourth
   * with a registration instead of an edit to this template.
   */
  readonly contextMenuActions = computed<readonly ExtensionActionDescriptor[]>(() =>
    this.extensions.resolve<ExtensionActionDescriptor>(
      EXTENSION_SLOTS.contextMenu,
      this.ruleContext.context(),
    ),
  );

  /** The context menu as `nxs-action-menu` renders it: labels translated, enabled rules applied. */
  readonly contextMenuItems = computed<readonly NxsMenuAction[]>(() => {
    this.currentLang();
    return this.contextMenuActions().map((action) => ({
      id: action.id,
      label: descriptorLabel(action, (key) => this.translate.instant(key)),
      icon: action.icon,
      disabled: !this.isContextMenuActionEnabled(action),
    }));
  });

  /**
   * Publish this surface's interface state so the context-menu rules can read it.
   *
   * `app.rules.isSubscribed` decides which half of the Notify Me / Unsubscribe
   * toggle is offered, and subscription state is not on the document model the
   * rule context carries — it is an enricher on the folder this page loaded.
   * Cleared on destroy, so the next surface does not inherit it.
   */
  private readonly publishFlagsToRuleContext = effect(() =>
    this.ruleContext.flags.set({ subscribed: this.isSubscribed() === true }),
  );
  // Filters
  readonly filterText = signal('');
  readonly filterType = signal('');
  readonly filterModifiedFrom = signal<Date | null>(null);
  readonly filterModifiedTo = signal<Date | null>(null);
  readonly filterContributor = signal('');

  /**
   * Every child of the folder, fetched the first time a filter is applied to it.
   *
   * `null` means "not scanned": the filters then fall back to the loaded page, which is what the
   * toolbar did for every folder before. The scan does **not** depend on what was typed — it
   * collects the folder's children and the filtering happens here — so adding a character never
   * refetches anything. It is keyed by path **and** sort order, and invalidated by bumping
   * {@link scanGeneration}, which is what a content change does.
   */
  private readonly scannedEntries = signal<NuxeoDocument[] | null>(null);
  private readonly scannedPath = signal<string | null>(null);
  private readonly scannedSortKey = signal<string | null>(null);
  /**
   * Bumped whenever a scan can no longer be trusted — a rename, a trash, an upload, a paste.
   *
   * It is a signal the scanning effect **reads**, which is the point: clearing `scannedPath` alone
   * did not restart the effect, because the effect tracks neither it nor anything a refresh
   * changes, so a filter silently fell back to the loaded page and lost its off-page matches.
   * Tracking `scannedPath` instead would also re-fire on a failed scan and could spin.
   */
  private readonly scanGeneration = signal(0);
  private scannedGeneration = -1;
  /** Requests, piped through `switchMap`, which is what cancels the scan each one replaces. */
  private readonly scanRequests$ = new Subject<ScanRequest>();
  /** True when the last scan for this folder failed, so the rows are only the loaded page. */
  readonly filterScanFailed = signal(false);
  /** The cap the template names when a scan was cut short. */
  readonly filterScanLimit = BROWSE_FILTER_SCAN_LIMIT;
  /** True when {@link BROWSE_FILTER_SCAN_LIMIT} cut the scan short, so a filter saw only part. */
  readonly filterScanTruncated = signal(false);
  readonly filterScanning = signal(false);

  /** Whether a toolbar filter is narrowing the listing. */
  readonly filtersActive = computed(
    () =>
      !!this.filterText() ||
      !!this.filterType() ||
      !!this.filterModifiedFrom() ||
      !!this.filterModifiedTo() ||
      !!this.filterContributor(),
  );

  /**
   * What the filters run over: the whole folder once scanned, else the page on screen.
   *
   * The fallback is deliberate rather than a loading state — the rows stay filtered while the
   * scan is in flight instead of blanking — and it is also the behaviour for a folder whose scan
   * failed.
   */
  /** The scan, but only if it belongs to the folder and order on screen. */
  private readonly scanForCurrentFolder = computed<NuxeoDocument[] | null>(() => {
    const scanned = this.scannedEntries();
    if (!scanned) return null;
    if (this.scannedPath() !== this.browsePath()) return null;
    if (this.scannedSortKey() !== this.serverSortKey()) return null;

    /**
     * The scan, plus anything the loaded page or an optimistic paste has that it lacks.
     *
     * A scan can genuinely be missing a child the page already holds, and the paste path shows
     * why: `@children` is eventually consistent, so a scan that finished before Nuxeo listed a
     * pasted document ends up without it. `reconcilePendingPasteEntries()` then drops the
     * optimistic row the moment the **page** includes it — which left the document in `entries()`
     * and absent from the scan the filter reads, so it disappeared from filtered results.
     *
     * Folding only the pending rows in was not enough, because reconciliation is keyed on the page
     * rather than on the scan. Merging both makes this scope a superset of the unfiltered listing,
     * so a filter can never show less than browsing the folder would — which closes that race and
     * any other way the scan falls behind the page. Everything merged is a child of this same
     * folder, so nothing foreign can enter.
     */
    // Freshest copy wins on a uid collision, decided by which source was read last. Keeping the
    // scan's copy unconditionally meant a renamed document kept its old title in the filtered rows
    // *and* in what the filters matched on, so searching for the new name missed a row that was on
    // screen under that very name. Always preferring the page is equally wrong: a scan that
    // finished after a content refresh is the newer read.
    //
    // An optimistic paste row fills a gap and never overrides — for real this time.
    //
    // A pasted document off the current page stays pending indefinitely, because
    // `reconcilePendingPasteEntries()` only clears what the *page* lists. Once a scan observes its
    // renamed copy, merging the original paste response back over it restored the old title and
    // made the new one unfindable. The optimistic copy is also appended to `entries()`, so it has
    // to be excluded there too, not only in `pendingPasteList()`.
    const seenInScan = new Set(scanned.map((doc) => doc.uid));
    const pendingUids = new Set(this.pendingPasteList().map((doc) => doc.uid));
    const pageIsFresher = this.entriesStamp > this.scanStamp;
    const fresher = new Map<string, NuxeoDocument>();
    for (const doc of this.pendingPasteList()) {
      if (doc.uid && !seenInScan.has(doc.uid)) fresher.set(doc.uid, doc);
    }
    for (const doc of this.entries()) {
      if (!doc.uid) continue;
      if (!seenInScan.has(doc.uid)) {
        fresher.set(doc.uid, doc);
        continue;
      }
      // In the scan already: only a genuinely newer *server* read may replace it, which an
      // optimistic row is not however recently it was appended.
      if (pageIsFresher && !pendingUids.has(doc.uid)) fresher.set(doc.uid, doc);
    }

    // Scan order preserved — it is the order the server was asked for — with each document
    // replaced by its fresher copy where one exists.
    const merged = scanned.map((doc) => (doc.uid && fresher.get(doc.uid)) || doc);
    let added = false;
    for (const [uid, doc] of fresher) {
      if (!seenInScan.has(uid)) {
        merged.push(doc);
        added = true;
      }
    }

    // Identity back when nothing changed, so downstream computeds do not recompute for nothing.
    return added || merged.some((doc, index) => doc !== scanned[index]) ? merged : scanned;
  });

  /**
   * The rows the listing shows: the scanned folder **only while a filter is narrowing it**.
   *
   * The `filtersActive()` guard is load-bearing. Without it, opening the type dropdown or clearing
   * the last filter left the cached scan as the row source, so the table rendered up to 500 rows
   * beside a pager still describing 50-row server pages — and Next then advanced `entries()`
   * without changing a single visible row.
   */
  private readonly filterScope = computed<NuxeoDocument[]>(() =>
    this.filtersActive() ? (this.scanForCurrentFolder() ?? this.entries()) : this.entries(),
  );

  readonly distinctTypes = computed(() => {
    // The scanned folder where there is one, filter or no filter: built from the loaded page, this
    // dropdown could not offer a type that appears only past the first fifty rows, and the user
    // opens it *before* any filter is active. Unlike the rows, a wider option list is never wrong.
    const types = new Set((this.scanForCurrentFolder() ?? this.entries()).map((e) => e.type));
    return Array.from(types).sort();
  });

  /**
   * Documents the UI can resolve by id: the loaded page plus the scanned folder.
   *
   * Selection is made from what is on screen, which while filtering includes off-page rows. The
   * selection helpers resolved ids against `entries()` only, so selecting an off-page row found no
   * document: Delete disappeared despite the row's permissions allowing it, and header Edit on an
   * off-page Collection fell through to the parent folder's metadata. The page wins on collision,
   * because its rows carry the fresher enrichers.
   */
  private readonly selectableEntries = computed<NuxeoDocument[]>(
    // The reconciled scope itself, which already folds the page in with the right precedence.
    //
    // This used to re-apply `entries()` over it unconditionally, which undid that reconciliation:
    // in the off-page paste-then-rename case the page still holds the stale optimistic copy, so
    // the row displayed "Renamed Pasted Report" while selection recorded "Pasted Report" — and
    // header actions read that row's stale permission enrichers.
    () => this.scanForCurrentFolder() ?? this.entries(),
  );

  readonly filteredEntries = computed(() => {
    let docs = this.filterScope();
    const text = this.filterText();
    const type = this.filterType();
    const modFrom = this.filterModifiedFrom();
    const modTo = this.filterModifiedTo();
    const contributor = this.filterContributor();

    if (text) {
      const term = text.toLowerCase();
      docs = docs.filter((d) => d.title.toLowerCase().includes(term));
    }
    if (type) {
      docs = docs.filter((d) => d.type === type);
    }
    if (modFrom) {
      const from = modFrom.getTime();
      docs = docs.filter((d) => new Date(d.lastModified).getTime() >= from);
    }
    if (modTo) {
      const to = modTo.getTime() + 86_400_000;
      docs = docs.filter((d) => new Date(d.lastModified).getTime() < to);
    }
    if (contributor) {
      const term = contributor.toLowerCase();
      docs = docs.filter((d) =>
        ((d.properties?.['dc:lastContributor'] as string) ?? '').toLowerCase().includes(term),
      );
    }

    // Never sorted here: the page arrives in the server's order, which is the order the user
    // asked for. Sorting a page in the browser once hid a sort the server had dropped.
    return docs;
  });

  /**
   * True while a filter is showing the whole folder rather than one page of it, which is when the
   * server pager must not be offered: its next page belongs to the unfiltered listing, so it used
   * to stay enabled beside zero filtered rows.
   */
  readonly filteredAcrossFolder = computed(
    () =>
      // `scanForCurrentFolder()` and not merely "a scan was started": while the scan is in flight
      // the rows still come from the loaded page, so claiming folder-wide coverage would suppress
      // the pager over a listing that is still only one page.
      this.filtersActive() && this.scanForCurrentFolder() !== null,
  );

  // Paging facts the listing is handed. While a filter covers the whole folder the filtered set is
  // complete, so there is no next page to offer and the total is what the filter left. Handing the
  // server's `hasNextPage` through in that state is what left the next-page control enabled beside
  // zero filtered rows: the pager described the unfiltered listing, the rows described the filter.
  readonly listPageIndex = computed(() => (this.filteredAcrossFolder() ? 0 : this.pageIndex()));
  readonly listTotalSize = computed(() =>
    this.filteredAcrossFolder() ? this.filteredEntries().length : this.totalSize(),
  );
  readonly listHasNextPage = computed(() =>
    this.filteredAcrossFolder() ? false : this.hasNextPage(),
  );

  /**
   * The count beside the toolbar: what the filters left, else Nuxeo's total, else nothing — a page
   * of fifty from a folder Nuxeo did not count is not "50 results".
   */
  readonly resultCount = computed<number | null>(() => {
    if (this.filtersActive()) return this.filteredEntries().length;
    const total = this.totalSize();
    return total >= 0 ? total : null;
  });

  /** The requested order, as one comparable value, so a scan can be keyed by it. */
  private readonly serverSortKey = computed(() => {
    const sort = this.listSort();
    const field = sort ? SORT_FIELDS[sort.key] : undefined;
    return sort && field ? `${field}:${sort.direction}` : '';
  });

  /**
   * Scans the folder when a filter is applied, and re-scans when what it holds would be wrong.
   *
   * Tracks four things: the folder, whether a filter is active, the requested order, and
   * {@link scanGeneration}. Sort is tracked because a scan taken in one order is the wrong set to
   * show in another; the generation is tracked because clearing `scannedPath` on a content refresh
   * did not restart this effect at all, leaving an active filter on the loaded page.
   *
   * The guard reads its state through `untracked`, so a scan that fails cannot re-trigger the
   * effect and spin — it stays on the loaded page until the folder, order, filter or generation
   * changes.
   */
  private readonly scanFolderWhenFiltering = effect(() => {
    const path = this.browsePath();
    const sortKey = this.serverSortKey();
    const generation = this.scanGeneration();
    if (!this.filtersActive()) return;
    untracked(() => this.startFolderScanIfStale(path, sortKey, generation));
  });

  /**
   * Scan the folder now, if what is cached is not already the right set.
   *
   * Also called when the type dropdown opens: without it the list of types was built from the
   * loaded page right up until a filter was applied, so the first type a user could pick came from
   * a narrower set than the one they would then be filtering over.
   */
  ensureFolderScan(): void {
    this.startFolderScanIfStale(
      this.browsePath(),
      this.serverSortKey(),
      untracked(() => this.scanGeneration()),
    );
  }

  private startFolderScanIfStale(path: string, sortKey: string, generation: number): void {
    if (
      this.scannedPath() === path &&
      this.scannedSortKey() === sortKey &&
      this.scannedGeneration === generation
    ) {
      return;
    }
    this.startFolderScan(path, sortKey, generation);
  }

  private startFolderScan(path: string, sortKey: string, generation: number): void {
    // Written before the request goes out, so a second run cannot start the same scan twice.
    this.scannedPath.set(path);
    this.scannedSortKey.set(sortKey);
    this.scannedGeneration = generation;
    this.scannedEntries.set(null);
    this.filterScanTruncated.set(false);
    this.filterScanFailed.set(false);
    this.filterScanning.set(true);
    this.scanRequests$.next({ path, sortKey, generation, sort: this.serverSort() });
  }

  /**
   * Applies a finished scan, if it is still the one being waited for.
   *
   * Two mechanisms, and both are needed. `switchMap` on {@link scanRequests$} tears down the
   * previous scan when another is requested: that stops obsolete subscriptions fetching pages they
   * will never use, and it is the only thing that fixes a sort cycle A -> B -> A, where the two A
   * scans share a path, a sort **and** a generation, so no key could tell them apart and a late
   * error from the first cleared the second's results.
   *
   * The key check below covers what `switchMap` cannot: {@link invalidateFolderScan} clears the
   * cache without issuing a new request, so an in-flight scan is not cancelled and must not be
   * allowed to land afterwards.
   */
  private applyScanResult(request: ScanRequest, set: BrowseFolderEntrySet | null): void {
    if (
      this.scannedPath() !== request.path ||
      this.scannedSortKey() !== request.sortKey ||
      this.scannedGeneration !== request.generation
    ) {
      return;
    }
    this.filterScanning.set(false);
    if (!set) {
      // The rows fall back to the loaded page — narrower than asked for, but never wrong about
      // what it did show. `filterScanFailed` is what stops that reading as a complete answer: an
      // off-page match would otherwise surface as "0 results", indistinguishable from no match.
      this.scannedPath.set(null);
      this.scannedSortKey.set(null);
      this.filterScanFailed.set(true);
      return;
    }
    this.scanStamp = ++this.sourceClock;
    this.scannedEntries.set(set.entries);
    this.filterScanTruncated.set(set.truncated);
  }

  /**
   * True when the merge has changed the scan while a server sort is selected.
   *
   * Then the rows are no longer in the order the server was asked for: a title-ascending scan of
   * Apple, Banana becomes Zebra, Banana once a newer page supplies Apple's renamed copy, and an
   * appended row lands at the end regardless of where it sorts — while the sort indicator still
   * claims the column.
   */
  private readonly mergeBrokeRequestedOrder = computed(() => {
    if (!this.serverSortKey()) return false;
    const scanned = this.scannedEntries();
    const merged = this.scanForCurrentFolder();
    return !!scanned && !!merged && merged !== scanned;
  });

  private lastReorderStamp = -1;

  /**
   * Re-scans when the merge has broken the requested order, so the server re-orders it.
   *
   * Sorting the merged set here instead was the other option, and it is the wrong one for this
   * repository: `filteredEntries` carries the note that sorting a page in the browser once hid a
   * sort the server had dropped. The server stays the authority on order.
   *
   * Guarded to once per page read. A folder whose listing is still eventually consistent can hand
   * back the same stale copy, and without the guard that would re-scan forever.
   */
  private readonly rescanWhenMergeBreaksOrder = effect(() => {
    // Only while filtering. `ensureFolderScan()` also scans with no filter active, to widen the
    // type dropdown; in a sorted folder past the scan cap the page merges in, the order breaks and
    // this would invalidate that scan — but `scanFolderWhenFiltering` will not re-scan without a
    // filter, so the open dropdown silently fell back to the current page's types. Order does not
    // matter to a set of types, and the rows come from `entries()` when nothing is filtered.
    if (!this.filtersActive()) return;
    if (!this.mergeBrokeRequestedOrder()) return;
    untracked(() => {
      if (this.lastReorderStamp === this.entriesStamp) return;
      this.lastReorderStamp = this.entriesStamp;
      this.invalidateFolderScan();
    });
  });

  /** Scan this folder again after a failure, from the message the failure puts on screen. */
  retryFolderScan(): void {
    this.filterScanFailed.set(false);
    this.ensureFolderScan();
  }

  /**
   * Drop a scan once it can no longer be trusted: another folder, or changed content.
   *
   * Bumping the generation is what makes the effect re-scan while a filter is still applied, which
   * is the case that matters after a rename, a trash, an upload or a paste: those refresh
   * `entries()` through `loadContent()`, and without this the filtered rows kept showing deleted
   * documents and missed newly created matches.
   */
  private invalidateFolderScan(): void {
    this.scannedPath.set(null);
    this.scannedSortKey.set(null);
    this.scannedEntries.set(null);
    this.filterScanTruncated.set(false);
    this.filterScanFailed.set(false);
    this.filterScanning.set(false);
    this.scanGeneration.update((generation) => generation + 1);
  }

  /** The visible columns as the document list takes them: translated, sortable where the server sorts. */
  readonly listColumns = computed<readonly NxsDocumentListColumn[]>(() => {
    this.currentLang();
    return this.visibleColumns().map((column) => ({
      key: column.key,
      label: descriptorLabel(column, (key) => this.translate.instant(key)),
      sortable: column.key in SORT_FIELDS,
    }));
  });

  readonly listSelectedIds = computed(() => [...this.selectionService.selectedIds()]);

  /**
   * Each row's menu: the `rowActions` slot resolved with that row's document in focus, so a rule
   * reads the row's permissions, not the folder's. A collection listed here also keeps its Edit.
   */
  readonly rowMenus = computed<Readonly<Record<string, readonly NxsMenuAction[]>>>(() => {
    this.currentLang();
    const base = this.ruleContext.context();
    const menus: Record<string, NxsMenuAction[]> = {};
    for (const doc of this.filteredEntries()) {
      const context = { ...base, document: doc };
      const entries: NxsMenuAction[] = this.extensions
        .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
        .map((action) => ({
          id: action.id,
          label: descriptorLabel(action, (key) => this.translate.instant(key)),
          icon: action.icon,
          disabled: !this.extensions.evaluateRule(action.enabledRule, context),
        }));
      if (this.isCollectionEntry(doc) && this.canEditCollectionEntry(doc)) {
        entries.unshift({
          id: 'collection.edit',
          label: this.translate.instant('browse.browse.edit'),
          icon: 'pencil',
        });
      }
      if (entries.length > 0) menus[doc.uid] = entries;
    }
    return menus;
  });

  // Subscription state
  readonly isSubscribed = computed(() => {
    const doc = this.currentDoc();
    const notifs = doc?.contextParameters?.['subscribedNotifications'] as string[] | undefined;
    return notifs && notifs.length > 0;
  });

  /** Rendered by ID, so the product shows Satori's and a host without it the built-in one. */
  readonly breadcrumbsId = NXS_PRIMITIVE_IDS.breadcrumbs;
  /** Rendered by ID, so the product shows Satori's status tag and a host without it the built-in one. */
  readonly statusTagId = NXS_PRIMITIVE_IDS.statusTag;
  /** Each card in the card view is rendered by ID, so a component registered under it replaces them. */
  readonly cardId = NXS_PRIMITIVE_IDS.card;

  /**
   * The card view's cards, each with its own open and selection callbacks.
   *
   * The outlet that renders a card by ID binds no outputs, so the callbacks reach the card as
   * inputs. They are made here, once per listing, rather than in the template, so a card's inputs
   * keep their identity from one change detection to the next and the outlet does not re-set them.
   */
  readonly cards = computed(() =>
    this.filteredEntries().map((doc) => ({
      doc,
      name: this.documentName(doc),
      open: () => this.onRowClick(doc),
      select: () => this.toggleSelection(doc.uid),
    })),
  );

  readonly breadcrumbs = computed<NxsBreadcrumbItem[]>(() => {
    this.currentLang();
    const doc = this.currentDoc();
    // A folder that could not be opened has no document, so its trail comes from the address and
    // never ends at the folder shown before it.
    const path = doc?.path ?? this.unopenedPath();
    const crumbs: NxsBreadcrumbItem[] = [
      { label: this.translate.instant('browse.breadcrumb.root'), routerLink: '/browse' },
    ];
    if (!path || path === '/') return crumbs;
    // Ancestor titles as Web UI renders them, from the `breadcrumb` enricher on the same fetch that
    // brought the folder. A path segment is only the fallback, and it has three real cases: a folder
    // opened from the address bar has no document and so no enricher; an entry may carry no title;
    // and `afterBrowseMetadataEdit` sets `currentDoc` from the update response, which carries no
    // enricher, for the one render before `loadContent()` re-fetches.
    const ancestorTitles = nuxeoBreadcrumbTitles(doc);
    const parts = path.split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated += `/${part}`;
      const isCurrent = accumulated === path;
      const label =
        isCurrent && doc
          ? doc.title
          : (ancestorTitles.get(accumulated) ?? decodeNuxeoPathSegment(part));
      if (isCurrent) {
        crumbs.push({ label });
      } else {
        crumbs.push({ label, routerLink: `/browse${accumulated}` });
      }
    }
    return crumbs;
  });

  readonly showBreadcrumbs = computed(() => {
    const doc = this.currentDoc();
    if (!doc?.path) return true;
    return shouldShowUserWorkspaceBreadcrumbs(
      doc.path,
      this.currentUsername(),
      this.adminAccess.isAdministrator(),
    );
  });

  /** `enabledRule` renders a menu item disabled rather than hiding it. */
  isContextMenuActionEnabled(action: ExtensionActionDescriptor): boolean {
    return this.extensions.evaluateRule(action.enabledRule, this.ruleContext.context());
  }

  runContextMenuAction(action: ExtensionActionDescriptor): void {
    this.actionRegistry.execute(action, this.ruleContext.context());
  }

  /** The descriptor behind the entry chosen in `nxs-action-menu`, run through the registry. */
  runContextMenuItem(item: NxsMenuAction): void {
    const action = this.contextMenuActions().find((candidate) => candidate.id === item.id);
    if (action) this.runContextMenuAction(action);
  }

  /**
   * The behaviour behind the packaged context-menu ids.
   *
   * Registered from the component rather than from `provideSatoriExtensions`
   * because each handler closes over this instance, and withdrawn on destroy for
   * the same reason: a handler left registered keeps a destroyed component
   * reachable and would run against dead state. Withdrawing the registration
   * rather than the ids is what leaves a customer's handler for the same id
   * untouched.
   */
  private registerContextMenuHandlers(): void {
    const registration = this.actionRegistry.registerPackaged({
      'app.contextMenu.share': { execute: () => this.openShareDialog() },
      'app.contextMenu.subscribe': { execute: () => this.toggleNotify() },
      'app.contextMenu.unsubscribe': { execute: () => this.toggleNotify() },
      'app.contextMenu.export': { execute: () => this.openExportDialog() },
      'app.rowActions.download': {
        execute: (context) => this.withRow(context, (doc) => this.downloadEntry(doc)),
      },
      'app.rowActions.rename': {
        execute: (context) => this.withRow(context, (doc) => this.renameEntry(doc)),
      },
      'app.rowActions.copyTo': {
        execute: (context) => this.withRow(context, (doc) => this.copyOrMoveEntry('copy', doc)),
      },
      'app.rowActions.moveTo': {
        execute: (context) => this.withRow(context, (doc) => this.copyOrMoveEntry('move', doc)),
      },
      'app.rowActions.delete': {
        execute: (context) => this.withRow(context, (doc) => this.trashEntry(doc)),
      },
    });
    this.destroyRef.onDestroy(() => {
      registration.unregister();
      this.ruleContext.flags.set({});
    });
  }

  /** A row action runs on the row's document, which arrives as the context's focused one. */
  private withRow(context: ExtensionRuleContext, run: (doc: NuxeoDocument) => void): void {
    if (context.document) run(context.document);
  }

  constructor() {
    this.registerContextMenuHandlers();
    const initialPath = parseBrowseNuxeoPathFromRouterUrl(this.router.url);
    this.currentNuxeoPath = initialPath;
    this.browsePath.set(initialPath);
    if (isBrowseRouterUrl(this.router.url)) {
      this.browseContext.setFromRouterUrl(this.router.url);
    }

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => parseBrowseNuxeoPathFromRouterUrl(this.router.url)),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((nuxeoPath) => {
        this.resetBrowseTabState();
        // Another folder's children are not this folder's; a stale scan would filter the wrong set.
        this.invalidateFolderScan();
        this.currentNuxeoPath = nuxeoPath;
        this.browsePath.set(nuxeoPath);
        this.pageIndex.set(0);
        if (isBrowseRouterUrl(this.router.url)) {
          this.browseContext.setFromRouterUrl(this.router.url);
        }
        this.browsePath$.next({ nuxeoPath, pageIndex: 0 });
      });

    this.browsePath$
      .pipe(
        switchMap(({ nuxeoPath, pageIndex }) => {
          this.loading.set(true);
          this.error.set(null);
          return this.browseService
            .getBrowseFolderContents(nuxeoPath, PAGE_SIZE, {
              currentPageIndex: pageIndex,
              sort: this.serverSort(),
            })
            .pipe(
              map((result) => ({ nuxeoPath, pageIndex, result })),
              catchError((error: unknown) =>
                of({ nuxeoPath, pageIndex, error: nxsErrorStatus(error) }),
              ),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((payload) => {
        if (payload.nuxeoPath !== this.currentNuxeoPath) return;
        if (payload.pageIndex !== this.pageIndex()) return;
        if ('error' in payload) {
          this.errorStatus.set(payload.error);
          this.error.set(this.translate.instant('browse.message.failed-to-load-folder-contents'));
          this.loading.set(false);
          // Another folder failing leaves nothing of the one before it — not its title and
          // actions in the header, its count, nor the end of the trail. The same folder failing
          // on another page or order keeps them.
          if (payload.nuxeoPath !== this.openedPath) {
            this.openedPath = null;
            this.currentDoc.set(null);
            this.entries.set([]);
            this.totalSize.set(-1);
            this.unopenedPath.set(payload.nuxeoPath);
          }
          return;
        }
        const { folder, entries, totalSize, redirectTo } = payload.result;
        if (redirectTo) {
          this.loading.set(false);
          void this.router.navigateByUrl(`/browse${redirectTo}`, { replaceUrl: true });
          return;
        }
        this.currentDoc.set(folder);
        this.openedPath = payload.nuxeoPath;
        this.unopenedPath.set(null);
        this.browseContext.setFromNuxeoPath(folder.path);
        this.entriesStamp = ++this.sourceClock;
        this.entries.set(entries);
        this.hasNextPage.set(payload.result.hasNextPage === true);
        this.reconcilePendingPasteEntries(entries);
        const pendingCount = this.pendingPasteEntries.size;
        this.totalSize.set(totalSize === entries.length ? totalSize + pendingCount : totalSize);
        this.loading.set(false);
        this.syncClipboardTarget(folder, payload.nuxeoPath);
        if (folder.uid && folder.uid !== 'virtual-root') {
          this.loadActivity(folder.uid);
        }
      });

    this.scanRequests$
      .pipe(
        // `switchMap`, not `mergeMap`: a new request must cancel the scan it replaces, or obsolete
        // subscriptions go on fetching pages and a late error from one of them can clear the
        // newer scan's results.
        switchMap((request) =>
          this.browseService
            // One page the size of the cap, not ten pages of `PAGE_SIZE`.
            //
            // Each page the walk asks for is a full `getBrowseFolderContents()` call, and on the
            // repository root for a restricted user that falls back to `getNavTreeBootstrap()`,
            // which re-fetches the **whole** accessible list every time and then pages it in
            // memory. Walking it in fifties therefore repeated that bootstrap up to ten times to
            // assemble a list the first call already held.
            //
            // Measured against this Nuxeo: `@children` reports `maxPageSize: 1000` and answers a
            // 66-child folder in one request at `pageSize: 500`, with `isNextPageAvailable:
            // false`. The cap maths is page-size agnostic — the walk counts rows actually
            // returned — so this only changes how many round trips it costs.
            .getAllBrowseFolderEntries(
              request.path,
              BROWSE_FILTER_SCAN_LIMIT,
              BROWSE_FILTER_SCAN_LIMIT,
              request.sort,
            )
            .pipe(
              map((set) => ({ request, set: set as BrowseFolderEntrySet | null })),
              catchError(() => of({ request, set: null as BrowseFolderEntrySet | null })),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ request, set }) => this.applyScanResult(request, set));

    this.browsePath$.next({ nuxeoPath: initialPath, pageIndex: 0 });

    effect(() => {
      const tick = this.browseContext.contentRefreshTick();
      const previousTick = this.lastSeenContentRefreshTick;
      this.lastSeenContentRefreshTick = tick;
      if (previousTick < 0 || tick === previousTick) {
        return;
      }
      untracked(() => {
        // The folder's contents changed, so a scan taken before the change is stale. Dropping it
        // lets the effect re-scan while a filter is still applied.
        this.invalidateFolderScan();
        if (this.currentNuxeoPath) {
          this.loadContent();
        }
      });
    });

    effect(() => {
      const tick = this.browseContext.clipboardPasteTick();
      const previousTick = this.lastSeenClipboardPasteTick;
      this.lastSeenClipboardPasteTick = tick;
      if (previousTick < 0 || tick === previousTick) {
        return;
      }
      untracked(() => {
        const paste = this.browseContext.consumeClipboardPasteEvent();
        if (!paste) {
          return;
        }
        const current = this.currentDoc();
        if (current?.uid === paste.targetUid) {
          this.applyClipboardPasteToListing(paste.documents);
        }
        if (this.currentNuxeoPath) {
          timer(1500)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
              if (this.currentDoc()?.uid === paste.targetUid && this.currentNuxeoPath) {
                this.reloadAfterContentChange();
              }
            });
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.clipboardTargetService.clear();
    });

    this.tagSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) =>
          term.length > 0
            ? this.tagService.searchTags(term).pipe(catchError(() => of([])))
            : of([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        const existing = this.tags();
        const filtered = results.filter((r) => !existing.includes(r));
        this.tagSearchResults.set(filtered);
        const exactMatch = results.some((r) => r.toLowerCase() === this.tagInput.toLowerCase());
        this.showCreateOption.set(this.tagInput.trim().length > 0 && !exactMatch);
      });
  }

  // ── Content loading ──

  private syncClipboardTarget(folder: NuxeoDocument, nuxeoPath: string): void {
    if (!isFolderishDocument(folder) || folder.uid === 'virtual-root') {
      this.clipboardTargetService.clear();
      return;
    }

    const path = folder.path ?? nuxeoPath;
    this.browseService
      .getFolderContext(path)
      .pipe(
        catchError(() => of(folder)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((doc) => {
        if (nuxeoPath !== this.currentNuxeoPath) return;
        this.clipboardTargetService.setTarget(doc);
      });
  }

  private resetBrowseTabState(): void {
    this.historyLoaded = false;
    this.trashLoaded = false;
    this.permissionsLoaded.set(false);
    this.permissionsLoading.set(false);
    this.activeTabIndex.set(0);
    this.pendingPasteEntries.clear();
    this.syncPendingPasteList();
    this.clearFilters();
    this.selectionService.clear();
  }

  loadContent(): void {
    this.browsePath$.next({ nuxeoPath: this.currentNuxeoPath, pageIndex: this.pageIndex() });
  }

  /**
   * Reload after the folder's **contents** changed — a rename, a trash, a restore, an upload, a
   * paste, a create/import.
   *
   * Separate from `loadContent()` on purpose. That one is also how ordinary paging and re-ordering
   * reload, and those must keep the scan; these must not, or a filtered listing goes on showing
   * documents that were just deleted and misses ones that were just created.
   */
  private reloadAfterContentChange(): void {
    this.invalidateFolderScan();
    this.loadContent();
  }

  /** Another page of the same folder, in the same order. */
  goToPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex === this.pageIndex()) return;
    this.pageIndex.set(pageIndex);
    this.loadContent();
  }

  /** A new order starts again from the first page: page three of another order is another set. */
  onListSortChange(sort: NxsDocumentListSort | null): void {
    this.listSort.set(sort);
    this.pageIndex.set(0);
    this.loadContent();
  }

  /** The list's order as Nuxeo takes it; a column outside `SORT_FIELDS` is never sent. */
  private serverSort(): { sortBy: string; sortOrder: 'ASC' | 'DESC' }[] {
    const sort = this.listSort();
    const field = sort ? SORT_FIELDS[sort.key] : undefined;
    if (!sort || !field) return [];
    return [{ sortBy: field, sortOrder: sort.direction === 'asc' ? 'ASC' : 'DESC' }];
  }

  /** The list's selection, written back to the shared service with each document's title and type. */
  onListSelectionChange(ids: readonly string[]): void {
    const next = new Set(ids);
    const current = this.selectionService.selectedIds();
    for (const id of current) {
      if (!next.has(id)) this.selectionService.toggle(id);
    }
    for (const id of ids) {
      if (current.has(id)) continue;
      const doc = this.selectableEntries().find((entry) => entry.uid === id);
      this.selectionService.toggle(id, doc?.title ?? id, null, doc?.type);
    }
  }

  /** Runs a row menu's entry through the registry, with the row's document in focus. */
  onRowAction({ action, document }: NxsDocumentListRowAction): void {
    if (action.id === 'collection.edit') {
      this.openEditCollectionDialog(document);
      return;
    }
    const context = { ...this.ruleContext.context(), document };
    const descriptor = this.extensions
      .resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.rowActions, context)
      .find((candidate) => candidate.id === action.id);
    if (descriptor) this.actionRegistry.execute(descriptor, context);
  }

  // ── Files dropped on the list ──

  /** Uploads files dropped on the list into the folder on screen, as Create / Import's do. */
  uploadDropped(files: readonly File[]): void {
    const folder = this.currentDoc();
    if (!folder || !this.canCreateContentHere()) return;
    if (this.droppedUploads.busy()) {
      this.toast.show(this.translate.instant('browse.message.upload-in-progress'));
      return;
    }
    this.droppedUploads.clearDone();
    this.droppedUploads.stage(files);
    this.droppedUploadPath = folder.path;
    this.runDroppedUploads();
  }

  /** Uploads what is pending in the dropped files' queue: all of them, or what failed last time. */
  runDroppedUploads(): void {
    const path = this.droppedUploadPath;
    const files = this.droppedUploads.pending();
    if (!path || files.length === 0 || this.droppedUploads.busy()) return;
    this.droppedUploads.start();
    this.importService
      .importFiles(path, files, {
        onProgress: (progress) => this.droppedUploads.progress(progress),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (docs) => {
          this.droppedUploads.complete(docs);
          this.toast.show(
            this.translate.instant(
              docs.length === 1
                ? 'common.count.created-file-one'
                : 'common.count.created-file-many',
              { count: docs.length },
            ),
          );
          this.afterDroppedUpload(path);
        },
        error: (err: unknown) => {
          this.droppedUploads.fail(err);
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err) ? PERMISSION_DENIED_KEY : 'browse.message.upload-failed',
            ),
          );
          if (this.droppedUploads.done().length > 0) this.afterDroppedUpload(path);
        },
      });
  }

  private afterDroppedUpload(path: string): void {
    this.browseContext.requestTreeRefresh();
    if (nuxeoPathsEqualFlexible(path, this.currentDoc()?.path ?? ''))
      this.reloadAfterContentChange();
  }

  // ── Row actions ──

  /** The row's main file, saved by the browser under the file's own name. */
  downloadEntry(doc: NuxeoDocument): void {
    this.detailService
      .fetchBlob(doc.uid, { clientReason: 'download' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const content = doc.properties?.['file:content'] as { name?: string } | null | undefined;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = content?.name || doc.title || 'download';
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.download-failed',
            ),
          ),
      });
  }

  /** Changes the row's title; its path name stays, so links to it keep working. */
  renameEntry(doc: NuxeoDocument): void {
    // The packaged rule's Immutable restriction, held here too because a manifest may clear the
    // rule, and a version's or publication's permissions still list Write.
    if (doc.facets?.includes('Immutable')) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    this.dialog
      .open<NxsRenameDialogComponent, NxsRenameDialogData, NuxeoDocument>(
        NxsRenameDialogComponent,
        {
          data: { documentId: doc.uid, title: doc.title },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated) => {
        if (!updated) return;
        this.toast.show(
          this.translate.instant('browse.message.renamed', { name: updated.title ?? doc.title }),
        );
        this.browseContext.requestTreeRefresh();
        this.reloadAfterContentChange();
      });
  }

  /** Chooses a folder, then copies or moves the row there. */
  copyOrMoveEntry(operation: 'copy' | 'move', doc: NuxeoDocument): void {
    const here = this.currentDoc()?.path;
    const data: NxsFolderPickerDialogData = {
      heading: this.translate.instant(
        operation === 'copy'
          ? 'browse.row-actions.copy-heading'
          : 'browse.row-actions.move-heading',
        { name: doc.title },
      ),
      confirmLabel: this.translate.instant(
        operation === 'copy' ? 'browse.row-actions.copy-here' : 'browse.row-actions.move-here',
      ),
      initialPath: here,
      excludePath: this.isFolderish(doc) ? doc.path : undefined,
      currentParentPath: operation === 'move' ? here : undefined,
    };
    this.dialog
      .open<NxsFolderPickerDialogComponent, NxsFolderPickerDialogData, NxsFolderPickerDialogResult>(
        NxsFolderPickerDialogComponent,
        { data },
      )
      .afterClosed()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((target): target is NxsFolderPickerDialogResult => !!target),
        switchMap((target) =>
          (operation === 'copy'
            ? this.browseService.copyDocuments([doc.uid], target.uid)
            : this.browseService.moveDocuments([doc.uid], target.uid)
          ).pipe(map(() => target)),
        ),
      )
      .subscribe({
        next: (target) => {
          this.toast.show(
            this.translate.instant(
              operation === 'copy' ? 'browse.message.copied-to' : 'browse.message.moved-to',
              { name: doc.title, folder: target.title },
            ),
          );
          if (operation === 'move' && this.selectionService.isSelected(doc.uid)) {
            this.selectionService.toggle(doc.uid);
          }
          this.browseContext.requestTreeRefresh();
          this.reloadAfterContentChange();
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : operation === 'copy'
                  ? 'browse.message.failed-to-copy'
                  : 'browse.message.failed-to-move',
            ),
          ),
      });
  }

  /** Moves the row to the trash, after the same confirmation as the header's Delete. */
  trashEntry(doc: NuxeoDocument): void {
    if (isCollectionDocument(doc)) {
      this.deleteCollectionEntry(doc);
      return;
    }
    const guard$ =
      doc.type === 'Collections' ? this.browseService.hasChildCollections(doc.uid) : of(false);
    guard$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((blocked) => {
          if (blocked) {
            this.showCollectionsFolderDeleteBlockedMessage();
            return EMPTY;
          }
          return this.dialog
            .open(ConfirmDialogComponent, {
              data: trashDocumentConfirmData(doc.title, (key, params) =>
                this.translate.instant(key, params),
              ),
            })
            .afterClosed();
        }),
        filter((confirmed) => confirmed === true),
        switchMap(() => this.detailService.trashDocument(doc.uid)),
      )
      .subscribe({
        next: () => {
          if (this.selectionService.isSelected(doc.uid)) this.selectionService.toggle(doc.uid);
          this.toast.show(this.translate.instant('browse.message.moved-to-trash'));
          this.browseContext.requestTreeRefresh();
          this.reloadAfterContentChange();
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.failed-to-delete',
            ),
          ),
      });
  }

  /** Merge clipboard copy/move API results into the visible folder (Web UI updates listing immediately). */
  /** Mirror the pending-paste map into its signal; the map is not reactive on its own. */
  private syncPendingPasteList(): void {
    this.pendingPasteList.set([...this.pendingPasteEntries.values()]);
  }

  private applyClipboardPasteToListing(documents: NuxeoDocument[]): void {
    if (documents.length === 0) {
      return;
    }

    for (const doc of documents) {
      if (doc.uid) {
        this.pendingPasteEntries.set(doc.uid, doc);
      }
    }
    this.syncPendingPasteList();

    let added = 0;
    let additions: NuxeoDocument[] = [];
    const previousEntryCount = this.entries().length;
    const previousTotalSize = this.totalSize();
    this.entriesStamp = ++this.sourceClock;
    this.entries.update((entries) => {
      const existingUids = new Set(entries.map((entry) => entry.uid));
      additions = documents.filter((doc) => doc.uid && !existingUids.has(doc.uid));
      added = additions.length;
      return additions.length > 0 ? [...entries, ...additions] : entries;
    });

    if (added > 0) {
      if (previousTotalSize === previousEntryCount) {
        this.totalSize.update((count) => count + added);
      }
    }
  }

  /** Keep optimistic paste rows until Nuxeo @children includes them. */
  private reconcilePendingPasteEntries(serverEntries: NuxeoDocument[]): void {
    if (this.pendingPasteEntries.size === 0) {
      return;
    }

    const serverUids = new Set(serverEntries.map((entry) => entry.uid));
    for (const uid of serverUids) {
      this.pendingPasteEntries.delete(uid);
    }
    this.syncPendingPasteList();

    const pending = [...this.pendingPasteEntries.values()];
    if (pending.length === 0) {
      return;
    }

    this.entriesStamp = ++this.sourceClock;
    this.entries.update((current) => {
      const currentUids = new Set(current.map((entry) => entry.uid));
      const additions = pending.filter((doc) => doc.uid && !currentUids.has(doc.uid));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
  }

  // ── Details side panel ──

  togglePanel(): void {
    this.panelOpen.update((v) => !v);
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }

  switchPanelSubTab(tab: 'info' | 'tags' | 'activity'): void {
    this.panelSubTab.set(tab);
  }

  private loadActivity(uid: string): void {
    if (!this.currentDoc()) {
      this.activityLoading.set(false);
      return;
    }

    if (!canViewDocumentAuditLog(this.currentDoc())) {
      this.activityEntries.set([]);
      this.activityLoading.set(false);
      return;
    }

    this.activityLoading.set(true);
    this.detailService
      .getAuditLog(uid, 5, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.activityEntries.set(res.entries);
          this.activityLoading.set(false);
        },
        error: () => this.activityLoading.set(false),
      });
  }

  onTagSearch(term: string): void {
    this.tagSearch$.next(term);
  }

  selectTag(label: string): void {
    this.applyTag(label);
  }

  createTag(): void {
    const label = this.tagInput.trim();
    if (label) this.applyTag(label);
  }

  private applyTag(label: string): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.tagService.addTag(doc.uid, label).subscribe({
      next: () => {
        this.tagInput = '';
        this.tagSearchResults.set([]);
        this.showCreateOption.set(false);
        this.browseService.getByPath(this.currentNuxeoPath).subscribe({
          next: (d) => this.currentDoc.set(d),
        });
        this.toast.show(this.translate.instant('common.tag-added', { name: label }));
      },
      error: () => this.toast.error(this.translate.instant('browse.message.failed-to-add-tag')),
    });
  }

  removeTag(label: string): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.tagService.removeTag(doc.uid, label).subscribe({
      next: () => {
        this.browseService.getByPath(this.currentNuxeoPath).subscribe({
          next: (d) => this.currentDoc.set(d),
        });
      },
      error: () => this.toast.error(this.translate.instant('browse.message.failed-to-remove-tag')),
    });
  }

  // ── Tab changes ──

  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
    if (index === 1) {
      this.loadPermissions();
    }
    if (index === 2 && !this.historyLoaded) {
      this.loadDirectoryEntries();
      this.loadAuditLog();
    }
    if (index === 3 && !this.trashLoaded) {
      this.loadTrash();
    }
  }

  // ── History tab ──

  private loadDirectoryEntries(): void {
    forkJoin([
      this.directoryService.getEventTypes(),
      this.directoryService.getEventCategories(),
    ]).subscribe({
      next: ([types, cats]) => {
        this.availableActions.set(types);
        this.availableCategories.set(cats);
        const typeMap: Record<string, string> = {};
        for (const t of types) typeMap[t.id] = t.label;
        this.eventTypeLabelMap.set(typeMap);
        const catMap: Record<string, string> = {};
        for (const c of cats) catMap[c.id] = c.label;
        this.eventCategoryLabelMap.set(catMap);
      },
    });
  }

  loadAuditLog(): void {
    const doc = this.currentDoc();
    if (!doc) return;

    if (!canViewDocumentAuditLog(doc)) {
      this.auditEntries.set([]);
      this.auditTotalSize.set(0);
      this.auditLoading.set(false);
      this.historyLoaded = true;
      return;
    }

    this.auditLoading.set(true);
    this.detailService
      .getAuditLog(doc.uid, this.auditPageSize(), this.auditPageIndex())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auditEntries.set(res.entries);
          this.auditTotalSize.set(res.resultsCount ?? res.totalSize ?? res.entries.length);
          this.auditLoading.set(false);
          this.historyLoaded = true;
        },
        error: () => this.auditLoading.set(false),
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
    return this.eventTypeLabelMap()[eventId] ?? eventId;
  }

  activityLabel(entry: AuditEntry): string {
    return auditActivityLabel(entry, this.eventTypeLabelMap());
  }

  categoryLabel(category: string): string {
    return this.eventCategoryLabelMap()[category] ?? category;
  }

  avatarColor = avatarColor;

  // ── Trash tab ──

  private loadTrash(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.trashLoading.set(true);
    this.browseService.getTrashedChildren(doc.uid, 50).subscribe({
      next: (res) => {
        this.trashedDocs.set(res.entries);
        this.trashLoading.set(false);
        this.trashLoaded = true;
      },
      error: () => this.trashLoading.set(false),
    });
  }

  restoreDocument(doc: NuxeoDocument): void {
    this.browseService.restoreDocument(doc.uid).subscribe({
      next: () => {
        this.toast.show(`"${doc.title}" restored`);
        this.loadTrash();
        this.reloadAfterContentChange();
      },
      error: () =>
        this.toast.error(this.translate.instant('browse.message.failed-to-restore-document')),
    });
  }

  // ── View toggle ──

  setViewMode(mode: 'list' | 'card'): void {
    this.viewMode.set(mode);
  }

  // ── Column settings ──

  openColumnPanel(): void {
    this.columnPanelOpen.set(true);
  }

  closeColumnPanel(): void {
    this.columnPanelOpen.set(false);
  }

  /** The picker's Done: the keys to show, in column order. */
  applyColumns(keys: readonly string[]): void {
    this.userVisibleKeys.set(keys);
    saveColumnSettings(this.columns().map((c) => ({ ...c, visible: keys.includes(c.key) })));
    this.columnPanelOpen.set(false);
  }

  // ── Filters ──

  clearFilters(): void {
    this.filterText.set('');
    this.filterType.set('');
    this.filterModifiedFrom.set(null);
    this.filterModifiedTo.set(null);
    this.filterContributor.set('');
  }

  /**
   * Clears the Modified range on its own.
   *
   * The title and contributor filters each had a clear suffix; this one had only the calendar
   * toggle, so the only ways out of a chosen range were "clear filters" — which also discards the
   * other three — or emptying both inputs by hand.
   */
  clearModifiedRange(): void {
    this.filterModifiedFrom.set(null);
    this.filterModifiedTo.set(null);
  }

  // ── CSV export (server-side via Nuxeo Bulk Action) ──

  exportCsv(): void {
    const doc = this.currentDoc();
    if (!doc || this.csvExporting()) return;

    this.csvExporting.set(true);
    this.toast.show(this.translate.instant('browse.message.starting-csv-export'));

    this.browseService
      .startCsvExport(doc.uid)
      .pipe(switchMap((commandId) => this.browseService.pollAndDownloadCsv(commandId)))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${doc.title ?? 'export'}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          this.csvExporting.set(false);
          this.toast.show(this.translate.instant('browse.message.csv-exported-successfully'));
        },
        error: () => {
          this.csvExporting.set(false);
          this.toast.error(this.translate.instant('browse.message.csv-export-failed'));
        },
      });
  }

  getCellValue(doc: NuxeoDocument, key: string): string {
    switch (key) {
      case 'title':
        return doc.title;
      case 'type':
        return doc.type;
      case 'modified':
        return doc.lastModified ? new Date(doc.lastModified).toLocaleDateString(this.locale) : '';
      case 'lastContributor':
        return (doc.properties?.['dc:lastContributor'] as string) ?? '';
      case 'state':
        return (doc.properties?.['dc:nature'] as string) ?? '';
      case 'version': {
        const major = doc.properties?.['uid:major_version'];
        return major !== undefined && major !== null
          ? `${major}.${doc.properties?.['uid:minor_version'] ?? 0}`
          : '';
      }
      case 'created':
        return doc.properties?.['dc:created']
          ? new Date(doc.properties['dc:created'] as string).toLocaleDateString(this.locale)
          : '';
      case 'author':
        return (doc.properties?.['dc:creator'] as string) ?? '';
      case 'nature':
        return (doc.properties?.['dc:nature'] as string) ?? '';
      case 'coverage':
        return (doc.properties?.['dc:coverage'] as string) ?? '';
      case 'subjects': {
        const s = doc.properties?.['dc:subjects'] as string[] | undefined;
        return s?.join(', ') ?? '';
      }
      default:
        return '';
    }
  }

  // ── Action toolbar ──

  openDriveDialog(): void {
    const data: NxsDriveDialogData = { folderPath: this.currentDoc()?.path ?? '/' };
    this.dialog.open(NxsDriveDialogComponent, { data });
  }

  private isBrowseFolderish(doc: NuxeoDocument | null | undefined): boolean {
    if (!doc) return false;
    return doc.type === 'Favorites' || isFolderishDocument(doc);
  }

  isCurrentFolderish(): boolean {
    return this.isBrowseFolderish(this.currentDoc());
  }

  openCreateImportDialog(): void {
    const doc = this.currentDoc();
    if (!doc || !this.isBrowseFolderish(doc)) {
      this.toast.show(this.translate.instant('browse.message.open-a-folder-to-create-or-import'));
      return;
    }
    if (!canAddChildren(doc)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    if (isDomainParentType(doc.type) || isRestrictedImportParentPath(doc.path)) {
      this.toast.show(this.translate.instant(DOMAIN_CONTAINER_GUIDANCE_KEY), { duration: 6000 });
      return;
    }
    this.dialog
      .open(CreateImportDialogComponent, {
        width: '960px',
        height: '680px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: { parentPath: doc.path, parentTitle: doc.title },
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result?.navigateToUid || result?.navigateToUrl || result?.refreshed) {
          this.browseContext.requestTreeRefresh();
        }
        if (result?.navigateToUrl) {
          if (result.navigateToUrl.startsWith('/doc/')) {
            const uid = result.navigateToUrl.slice('/doc/'.length);
            void this.router.navigate(['/doc', uid], {
              queryParams: { fresh: '1' },
              state: {
                freshBlobDocument: true,
                freshNote: result.freshNote === true,
              },
            });
          } else {
            void this.router.navigateByUrl(result.navigateToUrl);
          }
          return;
        }
        const browsePath = result?.navigateToPath?.replace(/\/+$/, '');
        if (browsePath && browsePath !== '/') {
          void this.router.navigateByUrl(`/browse${browsePath}`);
          return;
        }
        if (result?.navigateToUid) {
          void this.router.navigate(['/doc', result.navigateToUid], {
            queryParams: { fresh: '1' },
            state: {
              freshBlobDocument: true,
              freshNote: result.freshNote === true,
            },
          });
          return;
        }
        if (result?.refreshed) this.reloadAfterContentChange();
      });
  }

  openEditDialog(): void {
    const selected = this.singleSelectedEntry();
    if (selected && isCollectionDocument(selected)) {
      this.openEditCollectionDialog(selected);
      return;
    }

    const doc = this.currentDoc();
    if (!doc) return;
    if (!canWriteDocument(doc)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    const data: EditMetadataDialogData = {
      uid: doc.uid,
      title: doc.title,
      description: (doc.properties?.['dc:description'] as string) ?? '',
      nature: (doc.properties?.['dc:nature'] as string) ?? '',
      subjects: (doc.properties?.['dc:subjects'] as string[]) ?? [],
      coverage: (doc.properties?.['dc:coverage'] as string) ?? '',
      expires: (doc.properties?.['dc:expired'] as string) ?? null,
    };
    const ref = this.dialog.open(EditMetadataDialogComponent, { data });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result) this.afterBrowseMetadataEdit(result);
      });
  }

  /** Reload browse content and nav tree after metadata changes (title rename, etc.). */
  private afterBrowseMetadataEdit(updatedDoc: NuxeoDocument): void {
    this.browseContext.requestTreeRefresh();
    const previousPath = this.currentDoc()?.path;
    if (
      updatedDoc.path &&
      previousPath &&
      !nuxeoPathsEqualFlexible(updatedDoc.path, previousPath)
    ) {
      this.browseContext.setFromNuxeoPath(updatedDoc.path);
      void this.router.navigateByUrl(`/browse${updatedDoc.path}`);
      return;
    }
    this.currentDoc.set(updatedDoc);
    this.reloadAfterContentChange();
  }

  isCollectionEntry(doc: NuxeoDocument): boolean {
    return isCollectionDocument(doc);
  }

  canEditCollectionEntry(doc: NuxeoDocument): boolean {
    return canShowWriteDocumentAction(doc);
  }

  canDeleteCollectionEntry(doc: NuxeoDocument): boolean {
    return canShowRemoveDocumentAction(doc);
  }

  hasCollectionEntryActions(doc: NuxeoDocument): boolean {
    return this.canEditCollectionEntry(doc) || this.canDeleteCollectionEntry(doc);
  }

  openEditCollectionDialog(doc: NuxeoDocument): void {
    this.detailService
      .getFullDocument(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fullDoc) => {
          if (!canWriteDocument(fullDoc)) {
            this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
            return;
          }
          const ref = this.dialog.open(EditCollectionDialogComponent, {
            data: { document: fullDoc } satisfies EditCollectionDialogData,
            width: '560px',
          });
          ref
            .afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((updatedDoc) => {
              if (updatedDoc) {
                this.browseContext.requestTreeRefresh();
                this.reloadAfterContentChange();
                this.toast.show(this.translate.instant('browse.message.collection-updated'));
              }
            });
        },
        error: (err) =>
          this.toast.error(
            isPermissionDeniedError(err)
              ? this.translate.instant(PERMISSION_DENIED_KEY)
              : this.translate.instant('browse.message.failed-to-load-collection'),
          ),
      });
  }

  deleteCollectionEntry(doc: NuxeoDocument): void {
    this.detailService
      .getFullDocument(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fullDoc) => {
          if (!canRemoveDocument(fullDoc)) {
            this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
            return;
          }
          const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            data: {
              title: this.translate.instant('confirm.delete-collection'),
              message: this.translate.instant('confirm.delete-document-named', {
                name: fullDoc.title,
              }),
              confirmLabel: this.translate.instant('confirm.delete'),
            } as ConfirmDialogData,
          });
          dialogRef
            .afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((confirmed) => {
              if (!confirmed) return;
              this.detailService
                .trashDocument(fullDoc.uid)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                  next: () => {
                    this.selectionService.clear();
                    this.browseContext.requestTreeRefresh();
                    this.reloadAfterContentChange();
                    this.toast.show(
                      this.translate.instant('browse.message.collection-moved-to-trash'),
                    );
                  },
                  error: (err) =>
                    this.toast.error(
                      isPermissionDeniedError(err)
                        ? this.translate.instant(PERMISSION_DENIED_KEY)
                        : this.translate.instant('browse.message.failed-to-delete-collection'),
                    ),
                });
            });
        },
        error: (err) =>
          this.toast.error(
            isPermissionDeniedError(err)
              ? this.translate.instant(PERMISSION_DENIED_KEY)
              : this.translate.instant('browse.message.failed-to-load-collection'),
          ),
      });
  }

  deleteDocument(): void {
    const selectedCount = this.selectionService.selectedCount();
    if (selectedCount > 0) {
      this.deleteSelectedDocuments();
      return;
    }

    const doc = this.currentDoc();
    if (!doc) return;
    if (doc.type === 'Collections') {
      this.guardCollectionsFolderDelete(doc);
      return;
    }
    this.confirmTrashDocument(doc);
  }

  private selectedEntries(): NuxeoDocument[] {
    const ids = new Set(this.selectionService.selectedIds());
    return this.selectableEntries().filter((entry) => ids.has(entry.uid));
  }

  private resolveSelectedDocumentForDelete(uid: string) {
    const entry = this.selectableEntries().find((doc) => doc.uid === uid);
    if (entry && hasDocumentPermissionsEnricher(entry)) {
      return of(entry);
    }
    return this.detailService.getFullDocument(uid).pipe(catchError(() => of(null)));
  }

  private guardCollectionsFolderDelete(doc: NuxeoDocument): void {
    if (this.entries().some((entry) => isCollectionDocument(entry))) {
      this.showCollectionsFolderDeleteBlockedMessage();
      return;
    }

    this.browseService
      .hasChildCollections(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hasChildCollections) => {
          if (hasChildCollections) {
            this.showCollectionsFolderDeleteBlockedMessage();
            return;
          }
          this.proceedToTrashDocument(doc);
        },
        error: () =>
          this.toast.error(
            this.translate.instant('browse.message.failed-to-verify-folder-contents'),
          ),
      });
  }

  private proceedToTrashDocument(doc: NuxeoDocument): void {
    if (!canRemoveDocument(doc)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    this.openTrashConfirmDialog(doc);
  }

  private showCollectionsFolderDeleteBlockedMessage(): void {
    this.toast.error(
      this.translate.instant('browse.message.remove-all-collections-from-this-folder-before'),
      { duration: 5000 },
    );
  }

  private confirmTrashDocument(doc: NuxeoDocument): void {
    if (doc.type === this.translate.instant('search.search-filters-drawer.collections')) {
      this.guardCollectionsFolderDelete(doc);
      return;
    }
    this.proceedToTrashDocument(doc);
  }

  private openTrashConfirmDialog(doc: NuxeoDocument): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: trashDocumentConfirmData(doc.title, (key, params) =>
        this.translate.instant(key, params),
      ),
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.detailService
          .trashDocument(doc.uid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toast.show(this.translate.instant('browse.message.moved-to-trash'));
              this.browseContext.resetContext();
              this.browseContext.requestTreeRefresh();
              void this.router.navigateByUrl(postTrashBrowseRouterUrl(doc.path));
            },
            error: (err) =>
              this.toast.error(
                isPermissionDeniedError(err)
                  ? this.translate.instant(PERMISSION_DENIED_KEY)
                  : this.translate.instant('browse.message.failed-to-delete'),
              ),
          });
      });
  }

  private deleteSelectedDocuments(): void {
    const ids = [...this.selectionService.selectedIds()];
    if (ids.length === 0) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: trashSelectedDocumentsConfirmData(ids.length, (key, params) =>
        this.translate.instant(key, params),
      ),
    });

    dialogRef
      .afterClosed()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((confirmed) => {
          if (!confirmed) return EMPTY;
          return forkJoin(ids.map((uid) => this.resolveSelectedDocumentForDelete(uid)));
        }),
        switchMap((docs) => {
          const resolved = docs.filter((doc): doc is NuxeoDocument => !!doc);
          const loadFailedCount = docs.length - resolved.length;
          const denied = resolved.filter((doc) => !canRemoveDocument(doc));
          const allowed = resolved.filter((doc) => canRemoveDocument(doc));

          if (allowed.length === 0) {
            if (loadFailedCount > 0) {
              this.toast.error(
                resolved.length === 0
                  ? this.translate.instant(
                      'browse.message.failed-to-load-selected-documents-for-deletion',
                    )
                  : this.translate.instant(
                      loadFailedCount === 1
                        ? 'common.count.skipped-unloadable-one'
                        : 'common.count.skipped-unloadable-many',
                      { count: loadFailedCount },
                    ),
                { duration: 5000 },
              );
            }
            if (resolved.length > 0) {
              this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
            }
            return EMPTY;
          }

          if (loadFailedCount > 0) {
            this.toast.error(
              this.translate.instant(
                loadFailedCount === 1
                  ? 'common.count.skipped-unloadable-one'
                  : 'common.count.skipped-unloadable-many',
                { count: loadFailedCount },
              ),
              { duration: 5000 },
            );
          }

          if (denied.length > 0) {
            this.toast.error(
              this.translate.instant(
                denied.length === 1
                  ? 'common.count.skipped-no-permission-one'
                  : 'common.count.skipped-no-permission-many',
                { count: denied.length },
              ),
              { duration: 5000 },
            );
          }

          const collectionsFolders = allowed.filter((doc) => doc.type === 'Collections');
          if (collectionsFolders.length === 0) {
            return of(allowed);
          }

          return forkJoin(
            collectionsFolders.map((doc) =>
              this.browseService.hasChildCollections(doc.uid).pipe(
                map((hasChildCollections) => ({ doc, hasChildCollections })),
                catchError(() => of({ doc, hasChildCollections: true })),
              ),
            ),
          ).pipe(
            map((checks) => {
              const blockedUids = new Set(
                checks.filter((check) => check.hasChildCollections).map((check) => check.doc.uid),
              );
              if (blockedUids.size > 0) {
                this.showCollectionsFolderDeleteBlockedMessage();
              }
              return allowed.filter((doc) => !blockedUids.has(doc.uid));
            }),
          );
        }),
        switchMap((docs) => {
          if (docs.length === 0) {
            return EMPTY;
          }
          return forkJoin(
            docs.map((doc) =>
              this.detailService.trashDocument(doc.uid).pipe(catchError(() => of(null))),
            ),
          ).pipe(map((results) => ({ docs, trashed: results.filter(Boolean).length })));
        }),
      )
      .subscribe({
        next: ({ docs, trashed }) => {
          if (trashed === 0) {
            this.toast.error(this.translate.instant('browse.message.failed-to-delete'));
            return;
          }
          this.selectionService.clear();
          this.toast.show(
            trashed === 1
              ? this.translate.instant('browse.message.moved-to-trash')
              : `${trashed} documents moved to trash`,
          );
          if (trashed < docs.length) {
            this.toast.error(
              this.translate.instant(
                docs.length - trashed === 1
                  ? 'common.count.delete-failed-one'
                  : 'common.count.delete-failed-many',
                { count: docs.length - trashed },
              ),
              { duration: 5000 },
            );
          }
          this.browseContext.requestTreeRefresh();
          this.reloadAfterContentChange();
        },
        error: () => this.toast.error(this.translate.instant('browse.message.failed-to-delete')),
      });
  }

  downloadAll(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.detailService.exportZip(doc.uid, `${doc.title}.zip`).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${doc.title}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error(this.translate.instant('browse.message.download-failed')),
    });
  }

  openShareDialog(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.dialog.open(ShareDialogComponent, {
      data: { title: doc.title, url: window.location.href } as ShareDialogData,
    });
  }

  toggleNotify(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    // Read before the call, not after: the success handler refreshes `currentDoc`,
    // so re-reading `isSubscribed()` there reports whichever of the two requests
    // resolved first and can announce the opposite of what just happened.
    const wasSubscribed = this.isSubscribed() === true;
    const action$ = wasSubscribed
      ? this.detailService.unsubscribe(doc.uid)
      : this.detailService.subscribe(doc.uid);
    action$.subscribe({
      next: () => {
        this.browseService.getByPath(this.currentNuxeoPath).subscribe({
          next: (d) => this.currentDoc.set(d),
        });
        this.toast.show(
          wasSubscribed
            ? this.translate.instant('browse.message.unsubscribed')
            : this.translate.instant('browse.message.subscribed-to-notifications'),
        );
      },
      error: () =>
        this.toast.error(this.translate.instant('browse.message.failed-to-update-notifications')),
    });
  }

  openExportDialog(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    this.dialog.open(ExportDialogComponent, {
      data: {
        documentUid: doc.uid,
        documentTitle: doc.title,
        exportFn: (type: ExportType, uid: string) => {
          switch (type) {
            case 'thumbnail':
              return this.detailService.fetchThumbnail(uid);
            case 'zip':
              return this.detailService.exportZip(uid);
            case 'xml':
              return this.detailService.exportXml(uid);
            default:
              return this.detailService.fetchThumbnail(uid);
          }
        },
      } as ExportDialogData,
    });
  }

  // ── Helpers ──

  /** Same predicate as create/import enablement: facet/type-based folderish, plus Favorites. */
  isFolderish(doc: NuxeoDocument): boolean {
    return this.isBrowseFolderish(doc);
  }

  docIcon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  lastContributor(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:lastContributor'] as string) ?? '';
  }

  /**
   * Initials for a `sat-avatar`, never empty.
   *
   * `SatAvatar` at `size="24"` renders `initials()[0].toUpperCase()`, which throws
   * a `TypeError` on an empty string — and every value browse binds to it can be
   * empty: `lastContributor` and `docCreator` return `''` when the Dublin Core
   * property is absent, `resolveAcePrincipal` returns `''` for an unrecognised
   * principal, and Nuxeo omits `principalName` on system audit events. The throw
   * happens inside change detection, so it takes the whole listing down, not one
   * cell.
   */
  avatarInitials(value: string | null | undefined): string {
    return value?.trim() || '?';
  }

  docCreator(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:creator'] as string) ?? '';
  }

  docState(): string {
    const doc = this.currentDoc();
    return (doc?.properties?.['dc:nature'] as string) ?? 'Project';
  }

  isSelected(id: string): boolean {
    return this.selectionService.isSelected(id);
  }

  selectionAriaLabel(doc: NuxeoDocument): string {
    return this.translate.instant('common.select-item', { name: this.documentName(doc) });
  }

  /**
   * What a document is called on screen and to a screen reader: its title, else its path, else its
   * UID — as the document list names a row — so a card's controls are never unnamed.
   */
  documentName(doc: NuxeoDocument): string {
    return nxsVisibleText(doc.title) || doc.path || doc.uid;
  }

  toggleSelection(id: string): void {
    const doc = this.filteredEntries().find((d) => d.uid === id);
    this.selectionService.toggle(id, doc?.title ?? id, null, doc?.type);
  }

  onRowClick(doc: NuxeoDocument): void {
    if (isCollectionDocument(doc)) {
      void this.router.navigateByUrl(`/collections/${doc.uid}`);
      return;
    }
    if (this.isFolderish(doc)) {
      this.browseContext.setFromNuxeoPath(doc.path);
      void this.router.navigateByUrl(`/browse${doc.path}`);
    } else {
      void this.router.navigateByUrl(`/doc/${doc.uid}`);
    }
  }

  /**
   * Localised by `Intl.RelativeTimeFormat` rather than by a catalogue — see
   * `formatRelativeTime` for why a key per unit cannot express Polish or Arabic plurals.
   */
  relativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.translate.getCurrentLang() ?? 'en');
  }

  permissionIcon(permission: string): string {
    switch (permission) {
      case 'Everything':
        return 'admin_panel_settings';
      case 'ReadWrite':
        return 'edit';
      case 'Read':
        return 'visibility';
      case 'Write':
        return 'create';
      default:
        return 'lock';
    }
  }

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

  private loadPermissions(force = false): void {
    const doc = this.currentDoc();
    if (!doc || this.permissionsLoading()) return;
    if (this.permissionsLoaded() && !force) return;

    this.permissionsLoading.set(true);
    this.detailService
      .getDocumentPermissions(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.applyPermissionsDoc(updated);
          this.permissionsLoaded.set(true);
          this.permissionsLoading.set(false);
        },
        error: () => {
          this.permissionsLoading.set(false);
          this.toast.error(this.translate.instant('browse.message.failed-to-load-permissions'));
        },
      });
  }

  private applyPermissionsDoc(updated: NuxeoDocument): void {
    const existing = this.currentDoc();
    if (!existing) {
      this.currentDoc.set(updated);
      return;
    }
    this.currentDoc.set(mergeDocumentPermissionsContext(existing, updated));
  }

  private reloadPermissions(): void {
    this.loadPermissions(true);
  }

  deletePermission(ace: NuxeoAce): void {
    const doc = this.currentDoc();
    if (!doc) return;
    const dialogRef = this.dialog.open(DeletePermissionDialogComponent, {
      data: {
        documentUid: doc.uid,
        ace,
        permissionLabel: this.permissionLabel(ace.permission),
        timeFrameLabel: this.aceTimeFrame(ace),
      } satisfies DeletePermissionDialogData,
      width: '560px',
    });
    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted: boolean | undefined) => {
        if (deleted) {
          this.reloadPermissions();
          this.toast.show(this.translate.instant('browse.message.permission-deleted'));
        }
      });
  }

  shareWithExternal(): void {
    const doc = this.currentDoc();
    if (!doc) return;
    const dialogRef = this.dialog.open(ShareExternalDialogComponent, {
      data: { documentUid: doc.uid } satisfies ShareExternalDialogData,
      width: '520px',
    });
    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created: boolean | undefined) => {
        if (created) {
          this.reloadPermissions();
          this.toast.show(this.translate.instant('browse.message.shared-with-external-user'));
        }
      });
  }

  editExternalPermission(ace: NuxeoAce): void {
    const doc = this.currentDoc();
    if (!doc) return;
    const dialogRef = this.dialog.open(UpdatePermissionDialogComponent, {
      data: { documentUid: doc.uid, ace, isExternal: true } satisfies UpdatePermissionDialogData,
      width: '520px',
    });
    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated: boolean | undefined) => {
        if (updated) {
          this.reloadPermissions();
          this.toast.show(this.translate.instant('browse.message.permission-updated'));
        }
      });
  }

  sendNotificationEmail(ace: NuxeoAce): void {
    const doc = this.currentDoc();
    if (!doc || this.actionInProgress()) return;
    this.actionInProgress.set('notify-' + ace.id);
    this.detailService
      .sendNotificationEmailForPermission(doc.uid, ace.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionInProgress.set(null);
          this.toast.show(this.translate.instant('browse.message.notification-email-sent'));
        },
        error: (err) => {
          this.actionInProgress.set(null);
          const message = isMailSendError(err)
            ? mailSendFailureMessage('send', (key) => this.translate.instant(key))
            : this.translate.instant('browse.message.failed-to-send-notification');
          this.toast.error(message, { duration: 7000 });
        },
      });
  }
}
