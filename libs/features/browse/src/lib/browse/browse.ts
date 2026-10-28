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
  browseFolderFiltersActive,
  type BrowseFolderFilters,
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

const PAGE_SIZE = 50;

/**
 * How long a changed filter waits before the listing reloads.
 *
 * The filters run on the server now, so each keystroke would otherwise be a request. The loader's
 * `switchMap` already makes that *correct* — a superseded answer is discarded — so this is only
 * about not asking sixteen times for what one request answers. Long enough to coalesce typing,
 * short enough that a pause feels like the list is keeping up.
 */
export const FILTER_DEBOUNCE_MS = 250;

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
   * The same pending rows as a signal, so a `computed()` can see them.
   *
   * A paste is optimistic because `@children` is eventually consistent, so the new rows live only
   * in `entries()` until the server catches up. The filtered listing needs to know which rows those
   * are: they are the only ones the server's query has not judged.
   */
  private readonly pendingPasteList = signal<NuxeoDocument[]>([]);
  readonly browsePath = signal('/');
  private readonly browsePath$ = new Subject<{
    nuxeoPath: string;
    pageIndex: number;
    /** True for a reload a changed filter asked for, which must not blank the table. */
    filterChange?: boolean;
  }>();

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
    return this.entries().find((doc) => doc.uid === id) ?? null;
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
   * The filters as the server takes them, and as one comparable string.
   *
   * The key is what tells a real change from a recompute: the `Date` objects behind the range are
   * new instances on every pick, so comparing the filter object itself would reload the listing
   * for a value that had not changed.
   */
  private readonly currentFilters = computed<BrowseFolderFilters>(() => ({
    text: this.filterText(),
    type: this.filterType(),
    modifiedFrom: this.filterModifiedFrom(),
    modifiedTo: this.filterModifiedTo(),
    contributor: this.filterContributor(),
  }));

  private readonly filterKey = computed(() => {
    const filters = this.currentFilters();
    return [
      filters.text?.trim() ?? '',
      filters.type ?? '',
      filters.modifiedFrom?.getTime() ?? '',
      filters.modifiedTo?.getTime() ?? '',
      filters.contributor?.trim() ?? '',
    ].join('\u0000');
  });

  /** Whether a toolbar filter is narrowing the listing. Asked of the service, so one rule decides. */
  readonly filtersActive = computed(() => browseFolderFiltersActive(this.currentFilters()));

  /**
   * True when the **server** applied the filters, so the rows, the count and the pages on screen
   * already describe the whole folder rather than one page of it.
   *
   * False for the repository root, whose listing no query reproduces; there the filters still run
   * over what was loaded.
   */
  private readonly serverFiltered = signal(false);

  /** True while a changed filter's listing is on its way, so the toolbar can say so. */
  readonly filtering = signal(false);

  /**
   * The types the container holds, for the dropdown — fetched once per folder, when it opens.
   *
   * Separate from the rows because the rows are filtered: see
   * `BrowseService.getBrowseFolderTypes`.
   */
  private readonly folderTypes = signal<readonly string[]>([]);
  /** The folder {@link folderTypes} describes, so the fetch happens once per folder. */
  private folderTypesPath: string | null = null;
  private readonly folderTypeRequests$ = new Subject<string>();

  readonly distinctTypes = computed(() => {
    // The union of the fetched set and the page, never one alone. The fetched set is complete but
    // arrives only once the dropdown has been opened, and under an active type filter the page
    // holds that one type — so either source alone leaves the dropdown narrower than what is on
    // screen at some point in the sequence. A wider option list is never wrong; a missing option
    // is unreachable.
    const types = new Set<string>(this.folderTypes());
    for (const entry of this.entries()) {
      if (entry.type) types.add(entry.type);
    }
    return Array.from(types).sort();
  });

  /** Whether a document passes the filters, by the same comparisons the server's NXQL makes. */
  private matchesFilters(doc: NuxeoDocument): boolean {
    const filters = this.currentFilters();
    const text = filters.text?.trim().toLowerCase();
    if (text && !doc.title.toLowerCase().includes(text)) return false;
    if (filters.type && doc.type !== filters.type) return false;
    if (filters.modifiedFrom || filters.modifiedTo) {
      const modified = new Date(doc.lastModified).getTime();
      if (filters.modifiedFrom && modified < filters.modifiedFrom.getTime()) return false;
      // The whole of the chosen day counts, as the server's exclusive next-midnight bound does.
      if (filters.modifiedTo && modified >= filters.modifiedTo.getTime() + 86_400_000) return false;
    }
    const contributor = filters.contributor?.trim().toLowerCase();
    if (
      contributor &&
      !((doc.properties?.['dc:lastContributor'] as string) ?? '')
        .toLowerCase()
        .includes(contributor)
    ) {
      return false;
    }
    return true;
  }

  readonly filteredEntries = computed(() => {
    const docs = this.entries();
    if (!this.filtersActive()) return docs;
    if (!this.serverFiltered()) return docs.filter((doc) => this.matchesFilters(doc));

    // The server narrowed these, so they are not re-checked: `ILIKE` folds case in the database's
    // collation and `toLowerCase()` in the browser's, and for a character the two disagree on,
    // re-checking would hide a row the server matched — exactly the kind of difference that moving
    // the filter to the server removes. Only the optimistic paste rows appended to the server's
    // answer have been through no filter at all, so only they are judged here.
    const optimistic = new Set(this.pendingPasteList().map((doc) => doc.uid));
    if (optimistic.size === 0) return docs;
    return docs.filter((doc) => !optimistic.has(doc.uid) || this.matchesFilters(doc));
  });

  // Paging facts the listing is handed. The server pages the filtered listing, so these are its
  // own — except on the repository root, where the filters ran here over a listing the server
  // paged for something else: there the filtered set is all there is, and offering its next page
  // is what once left the control enabled beside zero filtered rows.
  private readonly clientFiltered = computed(() => this.filtersActive() && !this.serverFiltered());
  readonly listPageIndex = computed(() => (this.clientFiltered() ? 0 : this.pageIndex()));
  readonly listTotalSize = computed(() =>
    this.clientFiltered() ? this.filteredEntries().length : this.totalSize(),
  );
  readonly listHasNextPage = computed(() => (this.clientFiltered() ? false : this.hasNextPage()));

  /**
   * The count beside the toolbar: the server's total for the filtered folder, what a client-side
   * filter left, else Nuxeo's total — and nothing at all when Nuxeo did not count, because a page
   * of fifty from an uncounted folder is not "50 results".
   */
  readonly resultCount = computed<number | null>(() => {
    if (this.clientFiltered()) return this.filteredEntries().length;
    const total = this.totalSize();
    return total >= 0 ? total : null;
  });

  /**
   * Reloads the listing when a filter changes, debounced, from the first page.
   *
   * Page three of one filter is not page three of the next, so the index resets — the same reason
   * a new sort order starts again from the first page.
   *
   * `loadedFilterKey` starts as `null` and is set back to `null` whenever the filters are cleared
   * for a folder change: in both cases the load that is already happening carries the filters this
   * would ask for, so the next key becomes the baseline without a second request.
   */
  private loadedFilterKey: string | null = null;

  private readonly reloadWhenFiltersChange = effect(() => {
    const key = this.filterKey();
    untracked(() => {
      if (this.loadedFilterKey === key) return;
      const baseline = this.loadedFilterKey === null;
      this.loadedFilterKey = key;
      if (baseline) return;
      this.filtering.set(true);
      this.filterChanges$.next();
    });
  });

  private readonly filterChanges$ = new Subject<void>();

  /**
   * Collect the container's types, if they are not already in hand.
   *
   * Called when the type dropdown opens rather than when a folder loads, so a folder nobody filters
   * costs nothing.
   */
  loadFolderTypes(): void {
    const path = this.browsePath();
    if (this.folderTypesPath === path) return;
    this.folderTypesPath = path;
    this.folderTypeRequests$.next(path);
  }

  /** Forget the collected types, so the next dropdown opening fetches them again. */
  private invalidateFolderTypes(): void {
    this.folderTypesPath = null;
    this.folderTypes.set([]);
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
        // Another folder's types are not this folder's.
        this.invalidateFolderTypes();
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
        switchMap(({ nuxeoPath, pageIndex, filterChange }) => {
          // A filter reload keeps the rows it is replacing. `loading` makes the document list draw
          // its own loading state instead of the table, and at a 250ms debounce against a ~30ms
          // query that is a spinner flashing over every pause in typing. `filtering` says the same
          // thing in the toolbar without taking the rows away.
          if (!filterChange) this.loading.set(true);
          this.error.set(null);
          return this.browseService
            .getBrowseFolderContents(
              nuxeoPath,
              PAGE_SIZE,
              { currentPageIndex: pageIndex, sort: this.serverSort() },
              this.currentFilters(),
            )
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
          this.filtering.set(false);
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
          this.filtering.set(false);
          void this.router.navigateByUrl(`/browse${redirectTo}`, { replaceUrl: true });
          return;
        }
        this.currentDoc.set(folder);
        this.openedPath = payload.nuxeoPath;
        this.unopenedPath.set(null);
        this.browseContext.setFromNuxeoPath(folder.path);
        this.entries.set(entries);
        // Set from the answer, not assumed from the filters: the service decides per container
        // whether a query can reproduce its listing, and the rows, count and pager all read this.
        this.serverFiltered.set(payload.result.serverFiltered === true);
        this.hasNextPage.set(payload.result.hasNextPage === true);
        this.reconcilePendingPasteEntries(entries);
        // Only the pending rows the listing is actually showing. Counting all of them added a
        // document the filter excludes to the total on every refresh, so one visible row read
        // "2 results" — and the query can never clear it, because it never returns its uid.
        const pendingCount = this.visiblePendingPasteCount();
        this.totalSize.set(totalSize === entries.length ? totalSize + pendingCount : totalSize);
        this.loading.set(false);
        this.filtering.set(false);
        this.syncClipboardTarget(folder, payload.nuxeoPath);
        if (folder.uid && folder.uid !== 'virtual-root') {
          this.loadActivity(folder.uid);
        }
      });

    // A changed filter reloads the listing from its first page: page three of one filter is not
    // page three of the next. Debounced rather than per keystroke; `switchMap` in the loader is
    // what makes a superseded answer harmless, so this is only about how many requests it costs.
    this.filterChanges$
      .pipe(debounceTime(FILTER_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe(() => {
        this.pageIndex.set(0);
        this.browsePath$.next({
          nuxeoPath: this.currentNuxeoPath,
          pageIndex: 0,
          filterChange: true,
        });
      });

    this.folderTypeRequests$
      .pipe(
        switchMap((path) =>
          this.browseService.getBrowseFolderTypes(path).pipe(
            map((types) => ({ path, types: types as string[] | null })),
            // A failure leaves the dropdown on the types of the page on screen, which is what it
            // offered before this existed. Nothing else reads them, so there is nothing to report
            // and nothing to retry until the dropdown is opened again.
            catchError(() => of({ path, types: null })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ path, types }) => {
        if (path !== this.browsePath()) return;
        if (!types) {
          // Clearing the record of which folder was fetched is what lets re-opening try again.
          this.folderTypesPath = null;
          return;
        }
        this.folderTypes.set(types);
      });

    this.browsePath$.next({ nuxeoPath: initialPath, pageIndex: 0 });

    effect(() => {
      const tick = this.browseContext.contentRefreshTick();
      const previousTick = this.lastSeenContentRefreshTick;
      this.lastSeenContentRefreshTick = tick;
      if (previousTick < 0 || tick === previousTick) {
        return;
      }
      untracked(() => {
        // Something outside this page changed the folder — the detail panel, the tree, a created
        // domain. Which types it holds may have changed with it, and an optimistic paste copy may
        // now describe a document that has been renamed, moved or trashed since. A paste bumps
        // only `clipboardPasteTick`, so clearing them here cannot cut its own bridge.
        this.invalidateFolderTypes();
        this.clearPendingPasteEntries();
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
                // The reload the optimistic rows are waiting for: it is what clears each one that
                // the server has caught up with, so it must not discard the ones it has not.
                this.reloadAfterContentChange({ keepOptimisticPasteRows: true });
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
    // Only here, and only because the caller is about to load the new folder with exactly these
    // (empty) filters: without it, clearing them would be seen as a change and ask for the same
    // listing a second time, 250ms later. `clearFilters()` itself stays an ordinary filter change,
    // so a Clear control reloads the way every other filter control does.
    this.loadedFilterKey = null;
    this.filtering.set(false);
    this.serverFiltered.set(false);
    this.selectionService.clear();
  }

  loadContent(): void {
    this.browsePath$.next({ nuxeoPath: this.currentNuxeoPath, pageIndex: this.pageIndex() });
  }

  /**
   * Reload after the folder's **contents** changed — a rename, a trash, a restore, an upload, a
   * paste, a create/import.
   *
   * Still separate from `loadContent()`, which is also how paging and re-ordering reload: those
   * cannot change which types the folder holds, and these can, so the dropdown's collected types
   * are dropped here and nowhere else.
   *
   * It also forgets the optimistic paste rows, and that default is the point: a mutation makes a
   * pasted row's copy stale, so renaming one out of the active filter, moving it, or trashing it
   * used to leave it on screen under its old title — or after deletion — because a filtered query
   * never returns its uid for {@link reconcilePendingPasteEntries} to clear. Clearing here covers
   * every mutation path without naming them one by one, and the single caller that *must* keep
   * them says so.
   *
   * @param keepOptimisticPasteRows the paste's own deferred reload, and only that: it is the
   *   reload the rows are waiting for, so dropping them there would defeat the bridge entirely.
   */
  private reloadAfterContentChange(options?: { keepOptimisticPasteRows?: boolean }): void {
    this.invalidateFolderTypes();
    if (!options?.keepOptimisticPasteRows) {
      this.clearPendingPasteEntries();
    }
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
      const doc = this.entries().find((entry) => entry.uid === id);
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

  /**
   * How many optimistic paste rows the listing is actually showing.
   *
   * What the count may add to the server's total. An unfiltered listing shows all of them; a
   * filtered one shows only those that match, because {@link filteredEntries} judges exactly these
   * rows — so counting the rest inflated the total beside rows that did not include them.
   */
  private visiblePendingPasteCount(): number {
    const pending = [...this.pendingPasteEntries.values()];
    if (!this.filtersActive()) return pending.length;
    return pending.filter((doc) => this.matchesFilters(doc)).length;
  }

  /**
   * Forget the optimistic paste rows.
   *
   * They exist to bridge one gap: `@children` may not list a just-pasted document yet, and
   * {@link reconcilePendingPasteEntries} drops each one as soon as the server's answer includes
   * its uid. Under a server-side filter that inference does not hold — a row the filter excludes
   * is absent from every answer, so absence stops meaning "not committed yet" — and a pending copy
   * that is never cleared goes on being re-appended with whatever title it was pasted under.
   */
  private clearPendingPasteEntries(): void {
    if (this.pendingPasteEntries.size === 0) return;
    this.pendingPasteEntries.clear();
    this.syncPendingPasteList();
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
    // The rows on screen, not `entries().length`.
    //
    // The guard below asks "is the total a complete count of this listing?", and it asks it of the
    // number the total is displayed beside. Against the raw entry count it stopped being true for
    // good after one non-matching paste: that row joins `entries()` and is deliberately left out
    // of both the total and the rows, so the two counts diverge by one and never meet again — and
    // the *next* paste, one that does match, could then never raise the total. Two rows, "1
    // result". Unfiltered the two are the same number, so nothing changes there.
    const previousVisibleCount = this.filteredEntries().length;
    const previousTotalSize = this.totalSize();
    this.entries.update((entries) => {
      const existingUids = new Set(entries.map((entry) => entry.uid));
      additions = documents.filter((doc) => doc.uid && !existingUids.has(doc.uid));
      added = additions.length;
      return additions.length > 0 ? [...entries, ...additions] : entries;
    });

    if (added > 0) {
      // Only the rows the listing will show. Pasting a document the active filter excludes left
      // one visible row reporting "2 results", because the count rose and `filteredEntries` — the
      // thing that judges exactly these optimistic rows — correctly left it out.
      const shown = this.filtersActive()
        ? additions.filter((doc) => this.matchesFilters(doc)).length
        : added;
      if (shown > 0 && previousTotalSize === previousVisibleCount) {
        this.totalSize.update((count) => count + shown);
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
    return this.entries().filter((entry) => ids.has(entry.uid));
  }

  private resolveSelectedDocumentForDelete(uid: string) {
    const entry = this.entries().find((doc) => doc.uid === uid);
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
