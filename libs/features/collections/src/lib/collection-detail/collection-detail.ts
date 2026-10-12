import { Component, DestroyRef, LOCALE_ID, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import {
  NuxeoDocument,
  NuxeoAce,
  NuxeoAcl,
  AuditEntry,
  CollectionService,
  DocumentDetailService,
  DirectoryService,
  DirectoryEntry,
  docTypeIcon,
  avatarColor,
  canViewDocumentAuditLog,
  canWriteDocument,
  canRemoveDocument,
  canShowWriteDocumentAction,
  canShowRemoveDocumentAction,
  hasDocumentPermissionsEnricher,
  PERMISSION_DENIED_KEY,
  isPermissionDeniedError,
  NON_CONTENT_DOCUMENT_TYPES,
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
  formatAceDateRange,
  permissionRightLabel,
} from '@nuxeo-satori/platform/nuxeo-client';
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import { SatBreadcrumbsComponent, SatBreadcrumbsItem } from '@hylandsoftware/satori-ui/breadcrumbs';
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
  provideTranslatedDatepickerIntl,
} from '@nuxeo-satori/platform/ui';
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

@Component({
  selector: 'lib-collection-detail',
  standalone: true,
  providers: [provideTranslatedDatepickerIntl()],
  imports: [
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatTabsModule,
    MatTooltipModule,
    MatMenuModule,
    MatSnackBarModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    SatAvatarModule,
    SatBreadcrumbsComponent,
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
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly adminAccess = inject(ADMIN_ACCESS_CHECKS);

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
  readonly totalSize = signal(0);
  readonly thumbnailMap = signal<Record<string, string | null>>({});
  /** Batch token for thumbnail loads, so a superseded response cannot write. */
  private thumbnailGeneration = 0;
  /** Request token for the members load — see `loadMembers` for why the two are separate. */
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
  private breadcrumbItemsCache: SatBreadcrumbsItem[] = [];

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

  readonly breadcrumbItems = computed<SatBreadcrumbsItem[]>(() => {
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
      return { label: decodeURIComponent(s), href: accumulated };
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

  onBreadcrumbClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (href) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  readonly localAces = computed<NuxeoAce[]>(() => {
    const acls = this.collection()?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    const local = acls.find((a) => a.name === 'local');
    return local?.aces.filter((ace) => ace.granted && !ace.externalUser) ?? [];
  });

  readonly inheritedAces = computed<NuxeoAce[]>(() => {
    const acls = this.collection()?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    const inherited = acls.find((a) => a.name === 'inherited');
    return inherited?.aces.filter((ace) => ace.granted) ?? [];
  });

  readonly externalAces = computed<NuxeoAce[]>(() => {
    const acls = this.collection()?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return [];
    return acls.flatMap((a) => a.aces).filter((ace) => ace.externalUser && ace.granted);
  });

  readonly isInheritanceBlocked = computed<boolean>(() => {
    const acls = this.collection()?.contextParameters?.['acls'] as NuxeoAcl[] | undefined;
    if (!acls) return false;
    return !acls.some((a) => a.name === 'inherited');
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeThumbnails());

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
    // The thumbnail generation below does not cover this, because it is minted from *inside* the
    // members response — so it orders thumbnail batches against each other and leaves the members
    // request itself unguarded. Navigating A -> B starts two member requests; if B resolves first and
    // A lands afterwards, A overwrote `members` and `totalSize` with the previous collection's data
    // and its `loadThumbnails` then took the newest thumbnail generation, discarding B's images too.
    //
    // The uid is captured as well as the counter: the route can change between request and response,
    // and the uid is what the user is actually looking at.
    const generation = ++this.memberGeneration;
    const requestedUid = this.collectionUid;
    this.loading.set(true);
    this.error.set(null);

    this.collectionService
      .getCollectionMembers(requestedUid, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.memberGeneration || requestedUid !== this.collectionUid) return;
          this.members.set(res.entries);
          this.totalSize.set(res.totalSize);
          this.loading.set(false);
          this.loadThumbnails(res.entries);
        },
        error: () => {
          // Guarded too, and it has to clear `loading` only for the request that still owns it — a
          // stale failure would otherwise show an error over a newer collection's results. The
          // superseding call already set `loading` true for itself.
          if (generation !== this.memberGeneration || requestedUid !== this.collectionUid) return;
          this.error.set(
            this.translate.instant('collections.message.failed-to-load-collection-contents'),
          );
          this.loading.set(false);
        },
      });
  }

  private loadThumbnails(docs: NuxeoDocument[]): void {
    // Same guard as the Search, Trash, Assets and Browse loaders: a request started for the previous
    // collection could otherwise resolve after the reset below and insert stale data.
    const generation = ++this.thumbnailGeneration;
    // The reset that made the leak unbounded: `thumbnailMap.set({})` dropped the last
    // batch's URLs without revoking the blobs behind them, so every navigation to
    // another collection pinned another batch in memory for the life of the document.
    this.revokeThumbnails();
    this.thumbnailMap.set({});
    for (const doc of docs) {
      if (!this.canLoadThumbnail(doc)) continue;
      this.detailService
        .fetchThumbnail(doc.uid)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          // Drop a response from a superseded batch. Without this a thumbnail request started for the
          // previous collection could resolve after the reset above and reinsert a stale blob URL —
          // and the map is also the revocation ledger, so the leaked URL is then never revoked.
          if (!blob || generation !== this.thumbnailGeneration) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((m) => {
            const previous = m[doc.uid];
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return {
              ...m,
              [doc.uid]: url,
            };
          });
        });
    }
  }

  private revokeThumbnails(): void {
    for (const url of Object.values(this.thumbnailMap())) {
      if (url) URL.revokeObjectURL(url);
    }
  }

  private canLoadThumbnail(doc: NuxeoDocument): boolean {
    const normalizedType = doc.type.trim().toLowerCase();
    return normalizedType.length > 0 && !NON_CONTENT_DOCUMENT_TYPES.has(normalizedType);
  }

  docIcon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  lastContributor(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:lastContributor'] as string) ?? '';
  }

  contributorInitial(doc: NuxeoDocument): string {
    const c = this.lastContributor(doc);
    return c ? c.charAt(0).toUpperCase() : '?';
  }

  onRowClick(doc: NuxeoDocument): void {
    void this.router.navigateByUrl(`/doc/${doc.uid}`);
  }

  // --- Actions ---

  editCollection(): void {
    const col = this.collection();
    if (!col) return;
    if (hasDocumentPermissionsEnricher(col) && !canWriteDocument(col)) {
      this.toast(this.translate.instant(PERMISSION_DENIED_KEY));
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
          this.toast(this.translate.instant('browse.message.collection-updated'));
        }
      });
  }

  toggleLock(): void {
    if (this.actionInProgress() || !this.showsLockAction()) return;
    if (!this.canEditCollection()) {
      this.toast(
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
        this.toast(
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
        this.toast(this.translate.instant(this.lockRefusalKey(err, wasLocked)));
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
        this.toast(
          this.translate.instant(
            wasSub
              ? 'collections.message.notifications-disabled'
              : 'collections.message.notifications-enabled',
          ),
        );
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('browse.message.action-failed'));
      },
    });
  }

  deleteCollection(): void {
    const col = this.collection();
    if (this.actionInProgress()) return;
    if (col && hasDocumentPermissionsEnricher(col) && !canRemoveDocument(col)) {
      this.toast(this.translate.instant(PERMISSION_DENIED_KEY));
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
              this.toast(this.translate.instant('browse.message.collection-moved-to-trash'));
              this.browseContext.requestTreeRefresh();
              const col = this.collection();
              const redirectUrl = col?.path ? postTrashBrowseRouterUrl(col.path) : '/collections';
              void this.router.navigateByUrl(redirectUrl);
            },
            error: (err) => {
              this.actionInProgress.set(null);
              this.toast(
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
      this.toast(this.translate.instant('collections.message.removed-from-clipboard'));
    } else {
      const updated = [...current, { uid: col.uid, title: col.title, type: col.type }];
      this.clipboardDocs.set(updated);
      writeClipboardDocs(updated);
      this.toast(this.translate.instant('collections.message.added-to-clipboard'));
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

  aceTimeFrame(ace: NuxeoAce): string {
    return formatAceDateRange(
      ace.begin,
      ace.end,
      (key, params) => this.translate.instant(key, params),
      this.locale,
    );
  }

  addPermission(): void {
    const dialogRef = this.dialog.open(AddPermissionDialogComponent, {
      data: { documentUid: this.collectionUid } satisfies AddPermissionDialogData,
      width: '560px',
    });

    dialogRef.afterClosed().subscribe((created: boolean | undefined) => {
      if (created) {
        this.loadCollection();
        this.toast(this.translate.instant('browse.message.permission-added'));
      }
    });
  }

  editPermission(ace: NuxeoAce): void {
    const dialogRef = this.dialog.open(UpdatePermissionDialogComponent, {
      data: { documentUid: this.collectionUid, ace } satisfies UpdatePermissionDialogData,
      width: '520px',
    });

    dialogRef.afterClosed().subscribe((updated: boolean | undefined) => {
      if (updated) {
        this.loadCollection();
        this.toast(this.translate.instant('browse.message.permission-updated'));
      }
    });
  }

  deletePermission(ace: NuxeoAce): void {
    const dialogRef = this.dialog.open(DeletePermissionDialogComponent, {
      data: {
        documentUid: this.collectionUid,
        ace,
        permissionLabel: this.permissionLabel(ace.permission),
        timeFrameLabel: this.aceTimeFrame(ace),
      } satisfies DeletePermissionDialogData,
      width: '560px',
    });

    dialogRef.afterClosed().subscribe((deleted: boolean | undefined) => {
      if (deleted) {
        this.loadCollection();
        this.toast(this.translate.instant('browse.message.permission-deleted'));
      }
    });
  }

  displayUsername(ace: NuxeoAce): string {
    return ace.username.replace(/^transient\//, '');
  }

  editExternalPermission(ace: NuxeoAce): void {
    const dialogRef = this.dialog.open(UpdatePermissionDialogComponent, {
      data: {
        documentUid: this.collectionUid,
        ace,
        isExternal: true,
      } satisfies UpdatePermissionDialogData,
      width: '520px',
    });

    dialogRef.afterClosed().subscribe((updated: boolean | undefined) => {
      if (updated) {
        this.loadCollection();
        this.toast(this.translate.instant('browse.message.permission-updated'));
      }
    });
  }

  sendNotificationEmail(ace: NuxeoAce): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('notify-' + ace.id);

    this.detailService.sendNotificationEmailForPermission(this.collectionUid, ace.id).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('browse.message.notification-email-sent'));
      },
      error: (err) => {
        this.actionInProgress.set(null);
        this.toast(
          isMailSendError(err)
            ? mailSendFailureMessage('send', (key) => this.translate.instant(key))
            : this.translate.instant('collections.message.failed-to-send-notification'),
        );
      },
    });
  }

  shareWithExternal(): void {
    const dialogRef = this.dialog.open(ShareExternalDialogComponent, {
      data: { documentUid: this.collectionUid } satisfies ShareExternalDialogData,
      width: '520px',
    });

    dialogRef.afterClosed().subscribe((created: boolean | undefined) => {
      if (created) {
        this.loadCollection();
        this.toast(this.translate.instant('browse.message.shared-with-external-user'));
      }
    });
  }

  toggleInheritance(): void {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('inheritance');

    const blocked = this.isInheritanceBlocked();
    const op = blocked
      ? this.detailService.unblockPermissionInheritance(this.collectionUid)
      : this.detailService.blockPermissionInheritance(this.collectionUid);

    op.subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.loadCollection();
        this.toast(
          this.translate.instant(
            blocked
              ? 'collections.message.inheritance-unblocked'
              : 'collections.message.inheritance-blocked',
          ),
        );
      },
      error: () => {
        this.actionInProgress.set(null);
        this.toast(this.translate.instant('browse.message.action-failed'));
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

  private toast(message: string): void {
    this.snackBar.open(message, this.translate.instant('common.ok'), {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
