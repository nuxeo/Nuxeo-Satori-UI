import { Component, DestroyRef, LOCALE_ID, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, map, Observable } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';

import {
  NuxeoDocument,
  NuxeoAce,
  NuxeoAcl,
  AuditEntry,
  CollectionService,
  DocumentDetailService,
  DirectoryService,
  DirectoryEntry,
  avatarColor,
  canViewDocumentAuditLog,
  canWriteDocument,
  canRemoveDocument,
  canShowWriteDocumentAction,
  canShowRemoveDocumentAction,
  hasDocumentPermissionsEnricher,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
  isMailSendError,
  mailSendFailureMessage,
  readClipboardDocs,
  writeClipboardDocs,
  type ClipboardDoc,
  CURRENT_USERNAME,
  ADMIN_ACCESS_CHECKS,
  shouldShowUserWorkspaceBreadcrumbs,
  postTrashBrowseRouterUrl,
  BrowseContextService,
  canManageDocumentPermissions,
  decodeNuxeoPathSegment,
  permissionRightLabel,
} from '@nuxeo/satori-platform/nuxeo-client';
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import { SatTagModule } from '@hylandsoftware/satori-ui/tag';
import {
  ShareDialogComponent,
  ShareDialogData,
  ExportDialogComponent,
  ExportDialogData,
  ExportType,
  ConfirmDialogComponent,
  ConfirmDialogData,
  EditCollectionDialogComponent,
  EditCollectionDialogData,
  DateMaskPipe,
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NXS_PERMISSIONS_PANEL_ID,
  NXS_PRIMITIVE_IDS,
  NxsBreadcrumbsComponent,
  NxsDeletePermissionDialogComponent,
  NxsDocumentListComponent,
  NxsFolderHeaderComponent,
  NxsPermissionsPanelComponent,
  NxsShareExternalDialogComponent,
  NxsSpinnerComponent,
  NxsUpdatePermissionDialogComponent,
  nxsAceTimeFrame,
  nxsErrorStatus,
  provideNxsThumbnailCache,
  NxsToastService,
  provideNxsToast,
  type NxsBreadcrumbItem,
  type NxsDeletePermissionDialogData,
  type NxsDocumentListColumn,
  type NxsDocumentListSort,
  type NxsErrorStatus,
  type NxsShareExternalDialogData,
  type NxsUpdatePermissionDialogData,
} from '@nuxeo/satori-platform/components';

/**
 * The property each member column sorts by on the server: the three columns this page shows, each
 * of which Nuxeo Web UI's collection view also sorts, and `default_content_collection` was checked
 * to accept.
 */
const MEMBER_SORT_FIELDS: Readonly<Record<string, string>> = {
  title: 'dc:title',
  modified: 'dc:modified',
  lastContributor: 'dc:lastContributor',
};

const MEMBER_PAGE_SIZE = 50;

@Component({
  selector: 'lib-collection-detail',
  standalone: true,
  providers: [
    provideSatoriDateAdapter(),
    provideTranslatedDatepickerIntl(),
    provideNxsToast(),
    provideNxsThumbnailCache(),
  ],
  imports: [
    DateMaskPipe,
    ExtensionOutletComponent,
    NxsBreadcrumbsComponent,
    NxsDocumentListComponent,
    NxsFolderHeaderComponent,
    NxsPermissionsPanelComponent,
    NxsSpinnerComponent,
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTooltipModule,
    MatMenuModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    SatAvatarModule,
    SatTagModule,
  ],
  templateUrl: './collection-detail.html',
  styleUrl: './collection-detail.scss',
})
export class CollectionDetailComponent {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly collectionService = inject(CollectionService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly directoryService = inject(DirectoryService);
  private readonly toast = inject(NxsToastService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly adminAccess = inject(ADMIN_ACCESS_CHECKS);
  private readonly appConfig = inject(AppConfigService);

  readonly collection = signal<NuxeoDocument | null>(null);
  /**
   * Whether the collection itself resolved, kept separate from `collection` because a null
   * document has three different meanings — still loading, gone, and unreachable — and the page
   * must not offer actions in the last two. Before this existed, a failed load left `collection`
   * at null and the template's `collection()?.title ?? 'Collection'` rendered the full surface,
   * tabs and actions included, for a collection that did not exist.
   */
  readonly loadState = signal<'loading' | 'loaded' | 'not-found' | 'error'>('loading');
  readonly members = signal<NuxeoDocument[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Which error state `error` shows: the status of the member request that failed. */
  readonly errorStatus = signal<NxsErrorStatus>(500);
  readonly totalSize = signal(0);
  readonly memberPageSize = MEMBER_PAGE_SIZE;
  readonly memberPageIndex = signal(0);
  readonly membersHaveNextPage = signal(false);
  readonly memberSort = signal<NxsDocumentListSort | null>(null);
  /** The active language as a signal, so the column names follow a language change. */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.currentLang },
  );
  /** The member columns, as the list takes them: translated, each sorted on the server. */
  readonly memberColumns = computed<readonly NxsDocumentListColumn[]>(() => {
    this.currentLang();
    return [
      { key: 'title', label: this.translate.instant('collections.collection-detail.title') },
      { key: 'modified', label: this.translate.instant('collections.collection-detail.modified') },
      {
        key: 'lastContributor',
        label: this.translate.instant('collections.collection-detail.last-contributor'),
      },
    ].map((column) => ({ ...column, sortable: column.key in MEMBER_SORT_FIELDS }));
  });
  /** Request token for the members load — see `loadMembers`. */
  private memberGeneration = 0;
  /**
   * Request token for the collection read and its fallback. Without it a read for a collection
   * navigated away from could land later and install its lock state, and `toggleLock()` would then
   * send the wrong operation to the collection now on screen.
   */
  private collectionGeneration = 0;
  /** Token of the lock request that owns `actionInProgress`; navigation invalidates it. */
  private lockRequest = 0;

  readonly isLocked = signal(false);
  readonly lockOwner = signal<string | null>(null);
  readonly lockCreated = signal<string | null>(null);
  readonly isSubscribed = signal(false);
  readonly actionInProgress = signal<string | null>(null);
  readonly clipboardDocs = signal<ClipboardDoc[]>(readClipboardDocs());

  private collectionUid = '';

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
  private readonly activeTabIndex = signal(0);

  readonly filterUsername = signal('');
  readonly filterDateFrom = signal<Date | null>(null);
  readonly filterDateTo = signal<Date | null>(null);
  readonly filterAction = signal('');
  readonly filterCategory = signal('');

  readonly availableActions = signal<DirectoryEntry[]>([]);
  readonly availableCategories = signal<DirectoryEntry[]>([]);
  private eventTypeLabelMap = new Map<string, string>();
  private eventCategoryLabelMap = new Map<string, string>();
  private sortActive = signal('');
  private sortDirection = signal<'asc' | 'desc' | ''>('');
  private breadcrumbPathCache: string | null = null;
  private breadcrumbItemsCache: NxsBreadcrumbItem[] = [];
  /** Rendered by ID, so the product shows Satori's and a host without it the built-in one. */
  readonly breadcrumbsId = NXS_PRIMITIVE_IDS.breadcrumbs;

  readonly isInClipboard = computed(() =>
    this.clipboardDocs().some((d) => d.uid === this.collectionUid),
  );

  readonly canEditCollection = computed(() => canShowWriteDocumentAction(this.collection()));
  readonly canDeleteCollection = computed(() => canShowRemoveDocumentAction(this.collection()));
  /**
   * Write holders may lock; anyone who can read a locked collection sees that it is, and by whom.
   * Nuxeo's default lock policy takes Write on a locked document away from everyone but its owner
   * and administrators, so `canEditCollection` also decides who may unlock. Never offered on a
   * version, an immutable document or the repository root, as in Web UI.
   */
  readonly showsLockAction = computed(() => {
    // Until the current read lands, `collection()` still holds the previous document.
    if (this.loadState() !== 'loaded') return false;
    const col = this.collection();
    if (col?.facets?.includes('Immutable') || col?.type === 'Root') return false;
    return this.isLocked() || this.canEditCollection();
  });

  private readonly browseContext = inject(BrowseContextService);

  readonly breadcrumbItems = computed<NxsBreadcrumbItem[]>(() => {
    const col = this.collection();
    if (!col?.path) return [];

    if (col.path === this.breadcrumbPathCache) {
      return this.breadcrumbItemsCache;
    }

    const segments = col.path.split('/').filter(Boolean);
    segments.pop();
    this.breadcrumbPathCache = col.path;
    let accumulated = '/browse';
    this.breadcrumbItemsCache = segments.map((s) => {
      accumulated += `/${s}`;
      return { label: decodeNuxeoPathSegment(s), routerLink: accumulated };
    });
    return this.breadcrumbItemsCache;
  });

  readonly showBreadcrumbs = computed(() => {
    const col = this.collection();
    if (!col?.path) return false;
    return shouldShowUserWorkspaceBreadcrumbs(
      col.path,
      this.currentUsername(),
      this.adminAccess.isAdministrator(),
    );
  });

  /** The collection's local and inherited entries: the `nxs-` panel, resolved by its ID. */
  readonly permissionsPanelId = NXS_PERMISSIONS_PANEL_ID;
  /** The panel's writes can change the external shares this tab lists itself. */
  readonly onPermissionsChanged = () => this.loadCollection();

  /**
   * Web UI's external-user card: the collection's own pending and effective shares. An inherited
   * share is the parent's to edit, and an archived one has expired.
   */
  readonly externalAces = computed<(NuxeoAce & { aclName: string })[]>(() => {
    const acls = this.collection()?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
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

  readonly canManagePermissions = computed(() => canManageDocumentPermissions(this.collection()));

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.releaseLockRequest();
      this.collectionUid = params.get('uid') ?? '';
      this.historyLoaded = false;
      if (this.collectionUid) {
        this.loadCollection();
        this.loadMembers();
      }
    });
  }

  /** Retry after a transport or permission failure. Not offered for `not-found`, which retrying cannot change. */
  retryLoad(): void {
    this.loadCollection();
  }

  goToCollections(): void {
    void this.router.navigateByUrl('/collections');
  }

  private loadCollection(): void {
    const generation = ++this.collectionGeneration;
    const requestedUid = this.collectionUid;
    const isCurrent = (): boolean =>
      generation === this.collectionGeneration && requestedUid === this.collectionUid;
    this.loadState.set('loading');
    this.isLocked.set(false);
    this.lockOwner.set(null);
    this.lockCreated.set(null);
    this.detailService
      .getFullDocument(requestedUid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (!isCurrent()) return;
          this.collection.set(doc);
          this.loadState.set('loaded');
          this.syncActionStates(doc);
          if (this.activeTabIndex() === 2 && !this.historyLoaded) {
            this.loadAuditLog();
          }
        },
        error: () => {
          if (!isCurrent()) return;
          this.collectionService
            .getById(requestedUid)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (doc) => {
                if (!isCurrent()) return;
                this.collection.set(doc);
                this.loadState.set('loaded');
                this.syncActionStates(doc);
                if (this.activeTabIndex() === 2 && !this.historyLoaded) {
                  this.loadAuditLog();
                }
              },
              // Both reads failed. A 404 means the collection is genuinely absent — a mistyped,
              // stale or deleted link — and is reported as such; anything else is a transport or
              // permission failure the user can retry, and saying "does not exist" there would be
              // a guess. Either way the page must stop pretending it loaded something.
              error: (err: unknown) => {
                if (!isCurrent()) return;
                this.collection.set(null);
                this.loadState.set(
                  (err as { status?: number } | null)?.status === 404 ? 'not-found' : 'error',
                );
              },
            });
        },
      });
  }

  private syncActionStates(doc: NuxeoDocument): void {
    this.isLocked.set(!!(doc.lockOwner || doc.lockCreated));
    this.lockOwner.set(doc.lockOwner ?? null);
    this.lockCreated.set(doc.lockCreated ?? null);
    const subs = doc.contextParameters?.subscribedNotifications;
    this.isSubscribed.set(Array.isArray(subs) && subs.length > 0);
  }

  loadMembers(): void {
    // Claimed at request start, and checked on BOTH callbacks.
    //
    // Navigating A -> B starts two member requests; if B resolves first and A lands afterwards, A
    // overwrote `members` and `totalSize` with the previous collection's data.
    //
    // The uid is captured as well as the counter: the route can change between request and response,
    // and the uid is what the user is actually looking at.
    const generation = ++this.memberGeneration;
    const requestedUid = this.collectionUid;
    this.loading.set(true);
    this.error.set(null);

    const sort = this.memberSort();
    const sortBy = sort ? MEMBER_SORT_FIELDS[sort.key] : undefined;
    this.collectionService
      .getCollectionMembers(requestedUid, MEMBER_PAGE_SIZE, {
        currentPageIndex: this.memberPageIndex(),
        sort:
          sort && sortBy ? [{ sortBy, sortOrder: sort.direction === 'asc' ? 'ASC' : 'DESC' }] : [],
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.memberGeneration || requestedUid !== this.collectionUid) return;
          this.members.set(res.entries);
          this.totalSize.set(res.totalSize);
          this.membersHaveNextPage.set(
            (res as { isNextPageAvailable?: boolean }).isNextPageAvailable === true,
          );
          this.loading.set(false);
        },
        error: (err: unknown) => {
          // Guarded too, and it has to clear `loading` only for the request that still owns it — a
          // stale failure would otherwise show an error over a newer collection's results. The
          // superseding call already set `loading` true for itself.
          if (generation !== this.memberGeneration || requestedUid !== this.collectionUid) return;
          this.errorStatus.set(nxsErrorStatus(err));
          this.error.set(
            this.translate.instant('collections.message.failed-to-load-collection-contents'),
          );
          this.loading.set(false);
        },
      });
  }

  /** Another page of members, in the same order. */
  goToMemberPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex === this.memberPageIndex()) return;
    this.memberPageIndex.set(pageIndex);
    this.loadMembers();
  }

  /** A new order starts from the first page. */
  onMemberSortChange(sort: NxsDocumentListSort | null): void {
    this.memberSort.set(sort);
    this.memberPageIndex.set(0);
    this.loadMembers();
  }

  onRowClick(doc: NuxeoDocument): void {
    void this.router.navigateByUrl(`/doc/${doc.uid}`);
  }

  // --- Actions ---

  editCollection(): void {
    const col = this.collection();
    if (!col) return;
    if (hasDocumentPermissionsEnricher(col) && !canWriteDocument(col)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }

    const dialogRef = this.dialog.open(EditCollectionDialogComponent, {
      data: { document: col } satisfies EditCollectionDialogData,
      width: '560px',
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updatedDoc: NuxeoDocument | undefined) => {
        if (updatedDoc) {
          this.collection.set(updatedDoc);
          this.browseContext.requestTreeRefresh();
          this.toast.show(this.translate.instant('browse.message.collection-updated'));
        }
      });
  }

  toggleLock(): void {
    if (this.actionInProgress() || !this.showsLockAction()) return;
    if (!this.canEditCollection()) {
      this.toast.error(
        this.translate.instant(
          this.isLocked() ? 'common.lock.locked-by-another-user' : PERMISSION_DENIED_KEY,
        ),
      );
      return;
    }
    // Captured before the request: the page is reused across `:uid` changes, so when the response
    // lands `collectionUid` and `isLocked()` may describe another collection.
    const uid = this.collectionUid;
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
        if (uid !== this.collectionUid) return;
        this.isLocked.set(!wasLocked);
        // Nuxeo records the caller as the lock owner; naming a fixed account here would
        // tell every user someone else held their own lock.
        this.lockOwner.set(
          wasLocked ? null : (updated?.lockOwner ?? this.currentUsername() ?? null),
        );
        this.lockCreated.set(wasLocked ? null : (updated?.lockCreated ?? new Date().toISOString()));
        this.toast.show(
          this.translate.instant(
            wasLocked
              ? 'collections.message.collection-unlocked'
              : 'collections.message.collection-locked',
          ),
        );
      },
      error: (err: unknown) => {
        if (request !== this.lockRequest) return;
        this.actionInProgress.set(null);
        if (uid !== this.collectionUid) return;
        this.toast.error(this.translate.instant(this.lockRefusalKey(err, wasLocked)));
      },
    });
  }

  /**
   * On navigation, a lock request for the previous collection stops owning the busy flag, so the
   * new one's controls are not held disabled by it, and its late response cannot clear a newer one.
   */
  private releaseLockRequest(): void {
    this.lockRequest += 1;
    if (this.actionInProgress() === 'lock') this.actionInProgress.set(null);
  }

  /** "Locked by {owner} on {date}", or null while unlocked. */
  lockTooltip(): string | null {
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

  private lockRefusalKey(err: unknown, wasLocked: boolean): string {
    switch ((err as { status?: number } | null)?.status) {
      case 403:
        return wasLocked ? 'common.lock.unlock-no-permission' : 'common.lock.lock-no-permission';
      case 409:
        return wasLocked ? 'common.lock.locked-by-another-user' : 'common.lock.already-locked';
      default:
        return 'browse.message.action-failed';
    }
  }

  toggleSubscription(): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('subscribe');
    const op = this.isSubscribed()
      ? this.detailService.unsubscribe(this.collectionUid)
      : this.detailService.subscribe(this.collectionUid);

    op.subscribe({
      next: () => {
        const wasSub = this.isSubscribed();
        this.isSubscribed.set(!wasSub);
        this.actionInProgress.set(null);
        this.toast.show(
          this.translate.instant(
            wasSub
              ? 'collections.message.notifications-disabled'
              : 'collections.message.notifications-enabled',
          ),
        );
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast.error(this.translate.instant('browse.message.action-failed'));
      },
    });
  }

  deleteCollection(): void {
    const col = this.collection();
    if (this.actionInProgress()) return;
    if (col && hasDocumentPermissionsEnricher(col) && !canRemoveDocument(col)) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('confirm.delete-collection'),
        message: this.translate.instant('confirm.delete-collection-question'),
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
          .trashDocument(this.collectionUid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.actionInProgress.set(null);
              this.toast.show(this.translate.instant('browse.message.collection-moved-to-trash'));
              this.browseContext.requestTreeRefresh();
              const col = this.collection();
              const redirectUrl = col?.path ? postTrashBrowseRouterUrl(col.path) : '/collections';
              void this.router.navigateByUrl(redirectUrl);
            },
            error: (err) => {
              this.actionInProgress.set(null);
              this.toast.error(
                isPermissionDeniedError(err)
                  ? this.translate.instant(PERMISSION_DENIED_KEY)
                  : this.translate.instant('browse.message.failed-to-delete-collection'),
              );
            },
          });
      });
  }

  toggleClipboard(): void {
    const current = this.clipboardDocs();
    const col = this.collection();
    if (!col) return;

    if (this.isInClipboard()) {
      const updated = current.filter((c) => c.uid !== this.collectionUid);
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast.show(this.translate.instant('collections.message.removed-from-clipboard'));
    } else {
      const updated = [...current, { uid: col.uid, title: col.title, type: col.type }];
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast.show(this.translate.instant('collections.message.added-to-clipboard'));
    }
    window.dispatchEvent(new Event('clipboard-changed'));
  }

  exportCollection(): void {
    const title = this.collection()?.title ?? 'collection';
    this.dialog.open(ExportDialogComponent, {
      data: {
        documentUid: this.collectionUid,
        documentTitle: title,
        exportFn: (type: ExportType, uid: string): Observable<Blob> => {
          switch (type) {
            case 'thumbnail':
              return this.detailService.fetchThumbnail(uid);
            case 'pdf':
              return this.detailService.fetchPdfRendition(uid);
            case 'zip':
              return this.collectionService.bulkDownload(uid, `${title}.zip`);
            case 'xml':
              return this.detailService.exportXml(uid);
          }
        },
      } satisfies ExportDialogData,
      width: '440px',
    });
  }

  shareCollection(): void {
    this.dialog.open(ShareDialogComponent, {
      data: {
        title:
          this.collection()?.title ?? this.translate.instant('collections.share-fallback-title'),
        url: window.location.href,
      } satisfies ShareDialogData,
      width: '520px',
    });
  }

  permissionLabel(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  /** The day each date's writer picked, as the panel and the dialogs show it. */
  aceTimeFrame(ace: NuxeoAce): string {
    return nxsAceTimeFrame(ace, (key, params) => this.translate.instant(key, params), this.locale);
  }

  deletePermission(ace: NuxeoAce & { aclName?: string }): void {
    const dialogRef = this.dialog.open(NxsDeletePermissionDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      role: 'alertdialog',
      data: {
        documentUid: this.collectionUid,
        ace,
        acl: ace.aclName,
      } satisfies NxsDeletePermissionDialogData,
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted: boolean | undefined) => {
        if (deleted) {
          this.loadCollection();
          this.toast.show(this.translate.instant('browse.message.permission-deleted'));
        }
      });
  }

  displayUsername(ace: NuxeoAce): string {
    return ace.username.replace(/^transient\//, '');
  }

  editExternalPermission(ace: NuxeoAce): void {
    this.withVisiblePermissions((permissions) =>
      this.dialog
        .open(NxsUpdatePermissionDialogComponent, {
          maxWidth: '95vw',
          data: {
            documentUid: this.collectionUid,
            ace,
            permissions,
          } satisfies NxsUpdatePermissionDialogData,
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((updated: boolean | undefined) => {
          if (updated) this.loadCollection();
        }),
    );
  }

  sendNotificationEmail(ace: NuxeoAce): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('notify-' + ace.id);

    this.detailService.sendNotificationEmailForPermission(this.collectionUid, ace.id).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast.show(this.translate.instant('browse.message.notification-email-sent'));
      },
      error: (err) => {
        this.actionInProgress.set(null);
        this.toast.error(
          isMailSendError(err)
            ? mailSendFailureMessage('send', (key) => this.translate.instant(key))
            : this.translate.instant('collections.message.failed-to-send-notification'),
        );
      },
    });
  }

  shareWithExternal(): void {
    this.withVisiblePermissions((permissions) =>
      this.dialog
        .open(NxsShareExternalDialogComponent, {
          maxWidth: '95vw',
          data: {
            documentUid: this.collectionUid,
            permissions,
          } satisfies NxsShareExternalDialogData,
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((shared: boolean | undefined) => {
          if (shared) this.loadCollection();
        }),
    );
  }

  /**
   * The rights a Collection offers, from the `userVisiblePermissions` enricher — Read,
   * ReadCanCollect, ReadWrite and Everything on a stock server — rather than a fixed list. A
   * failed read leaves the dialogs to their own default.
   */
  private withVisiblePermissions(open: (permissions: readonly string[] | null) => void): void {
    const requestedFor = this.collectionUid;
    this.detailService
      .getDocumentPermissions(requestedFor)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (requestedFor !== this.collectionUid) return;
          const visible = doc.contextParameters?.['userVisiblePermissions'];
          open(Array.isArray(visible) ? (visible as string[]) : null);
        },
        error: () => {
          if (requestedFor === this.collectionUid) open(null);
        },
      });
  }

  // --- History tab ---

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

  onTabChange(index: number): void {
    this.activeTabIndex.set(index);
    if (index === 2 && !this.historyLoaded) {
      this.loadDirectoryEntries();
      this.loadAuditLog();
    }
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
    if (!this.collectionUid) return;

    const collection = this.collection();
    if (!collection) {
      this.auditLoading.set(false);
      return;
    }

    if (!canViewDocumentAuditLog(collection)) {
      this.auditEntries.set([]);
      this.auditTotalSize.set(0);
      this.auditLoading.set(false);
      this.historyLoaded = true;
      return;
    }

    this.auditLoading.set(true);

    this.detailService
      .getAuditLog(this.collectionUid, this.auditPageSize(), this.auditPageIndex())
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
          this.historyLoaded = false;
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
}
