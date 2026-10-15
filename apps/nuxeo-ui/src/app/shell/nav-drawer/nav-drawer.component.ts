import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Component,
  inject,
  input,
  output,
  signal,
  effect,
  computed,
  DestroyRef,
  untracked,
  LOCALE_ID,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet, DatePipe, formatDate } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  NuxeoDocument,
  BrowseService,
  BrowseContextService,
  ClipboardTargetService,
  CollectionService,
  AssetService,
  AssetAggregationService,
  DocumentService,
  DocumentDetailService,
  TaskService,
  NuxeoTask,
  CURRENT_USERNAME,
  docTypeIcon,
  isFolderishDocument,
  isBrowsableNavNode,
  normalizeNuxeoPath,
  nuxeoPathsEqualFlexible,
  nuxeoPathSegments,
  toBrowseRouterUrl,
  documentNavigationUrl,
  isCollectionDocument,
  type AssetAggregations,
  canPasteClipboard,
  readClipboardDocs,
  writeClipboardDocs,
  type ClipboardDoc,
  formatRelativeTime,
  DocTypeLabelPipe,
  taskDueDistance,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  AppExtensionsService,
  DescriptorLabelPipe,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  type ExtensionElement,
} from '@nuxeo-satori/platform/extensions';
import { AuthService } from '../../auth/auth.service';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  AppNavItem,
  visibleSettingsDrawerItems,
  ADMINISTRATION_DRAWER_ITEMS,
  POWERUSER_ADMINISTRATION_DRAWER_ITEMS,
} from '../../platform-nav-items';
import { ThemingFeatureFlagService } from '../../theme/theming-feature-flag.service';
import { drawerDueKey } from './nav-drawer-due';
import { NxsDocumentTreeComponent } from '@nuxeo-satori/platform/components';

export interface FolderNode {
  doc: NuxeoDocument;
  children: FolderNode[];
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
}

@Component({
  selector: 'app-nav-drawer',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    DescriptorLabelPipe,
    NgTemplateOutlet,
    DatePipe,
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatTooltipModule,
    MatSnackBarModule,
    TranslatePipe,
    ExtensionOutletComponent,
    NxsDocumentTreeComponent,
  ],
  templateUrl: './nav-drawer.component.html',
  styleUrl: './nav-drawer.component.scss',
})
export class NavDrawerComponent {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly browseService = inject(BrowseService);
  private readonly browseContext = inject(BrowseContextService);
  private readonly clipboardTargetService = inject(ClipboardTargetService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly collectionService = inject(CollectionService);
  private readonly assetService = inject(AssetService);
  private readonly assetAggregationService = inject(AssetAggregationService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly docService = inject(DocumentService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly extensions = inject(AppExtensionsService);
  private readonly componentRegistry = inject(ExtensionComponentRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);

  readonly activeItem = input<AppNavItem | null>(null);
  readonly itemSelected = output<string>();
  readonly navigateKeepDrawer = output<string>();
  readonly signOutSelected = output<void>();
  private readonly themingFlags = inject(ThemingFeatureFlagService);
  readonly settingsItems = computed(() =>
    visibleSettingsDrawerItems(this.themingFlags.themingEnabled()),
  );
  readonly administrationItems = computed(() =>
    this.authService.isAdministrator()
      ? ADMINISTRATION_DRAWER_ITEMS
      : POWERUSER_ADMINISTRATION_DRAWER_ITEMS,
  );

  /** The browse tree, which loads and follows the browsed folder itself. */
  private readonly browseTree = viewChild(NxsDocumentTreeComponent);
  /** The folder browse shows, which the tree expands to and marks. */
  readonly browseTreePath = computed(() => this.browseContext.contextPath());

  readonly personalSpaceNodes = signal<FolderNode[]>([]);
  readonly personalSpaceLoading = signal(false);
  readonly personalSpaceError = signal<string | null>(null);
  private personalSpaceLoaded = false;

  readonly collections = signal<NuxeoDocument[]>([]);
  readonly collectionsLoading = signal(false);
  private collectionsLoaded = false;

  /**
   * The `sidebar` slot entry for the active nav item, if any.
   *
   * By convention a nav item `app.navbar.<name>` is served by the sidebar
   * component `app.sidebar.<name>`, so a manifest that adds a nav item and
   * registers a component for it gets drawer content with no code change. The
   * packaged entries that have bespoke markup above never reach this.
   */
  readonly sidebarComponentId = computed<string | null>(() => {
    const id = this.activeItem()?.id;
    if (!id) return null;
    const sidebar = this.extensions
      .resolve<ExtensionElement>(EXTENSION_SLOTS.sidebar, this.ruleContext.context())
      .find((entry) => entry.id === id || entry.id === id.replace('.navbar.', '.sidebar.'));
    if (sidebar) return (sidebar as { componentId?: string }).componentId ?? sidebar.id;
    const byConvention = id.replace('.navbar.', '.sidebar.');
    return this.componentRegistry.has(byConvention) ? byConvention : null;
  });

  // Tasks
  private readonly taskService = inject(TaskService);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  readonly tasks = signal<NuxeoTask[]>([]);
  readonly tasksLoading = signal(false);
  readonly tasksError = signal<string | null>(null);
  readonly clipboardDocs = signal<ClipboardDoc[]>(readClipboardDocs());
  readonly clipboardEmpty = computed(() => this.clipboardDocs().length === 0);
  readonly clipboardCanPaste = computed(() =>
    canPasteClipboard(this.clipboardDocs(), this.clipboardTargetService.target()),
  );
  readonly clipboardActionLoading = signal(false);

  readonly favorites = signal<NuxeoDocument[]>([]);
  readonly favoritesLoading = signal(false);
  readonly thumbnailMap = signal<Record<string, string | null>>({});

  // Recently Viewed
  readonly recentlyViewed = signal<NuxeoDocument[]>([]);
  readonly recentlyViewedLoading = signal(false);
  readonly recentlyViewedError = signal<string | null>(null);
  private recentlyViewedLoaded = false;

  // Expired Queue
  readonly expiredDocs = signal<NuxeoDocument[]>([]);
  readonly expiredLoading = signal(false);
  readonly expiredError = signal<string | null>(null);
  private expiredLoaded = false;

  private readonly destroyRef = inject(DestroyRef);
  /** Tracks which user the drawer caches belong to — cleared on sign-out or user switch. */
  private drawerSessionUser: string | null = null;

  constructor() {
    this.taskService.tasksChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadTasks());

    effect(() => {
      const username = this.authService.username() ?? null;
      if (username !== this.drawerSessionUser) {
        this.clearUserScopedDrawerCaches();
        this.drawerSessionUser = username;
      }
    });

    effect(() => {
      const refreshTick = this.browseContext.treeRefreshTick();
      if (refreshTick > 0) {
        untracked(() => {
          const item = this.activeItem();
          if (item?.id === 'app.navbar.browse') {
            this.refreshBrowseTree();
          }
          if (item?.path === '/personal-space') {
            this.refreshPersonalSpaceTree();
          }
        });
      }
    });

    effect(() => {
      const item = this.activeItem();
      if (item?.id === 'app.navbar.collections' && !this.collectionsLoaded) {
        this.loadCollections();
      }
      if (item?.id === 'app.navbar.assets') {
        this.loadAssetAggregations();
      }
      if (item?.id === 'app.navbar.tasks') {
        this.loadTasks();
      }
      if (item?.id === 'app.navbar.clipboard') {
        this.refreshClipboard();
      }
      if (item?.id === 'app.navbar.favorites') {
        this.loadFavorites();
      }
      if (item?.id === 'app.navbar.recentlyViewed' && !this.recentlyViewedLoaded) {
        this.loadRecentlyViewed();
      }
      if (item?.id === 'app.navbar.expiredQueue' && !this.expiredLoaded) {
        this.loadExpiredDocuments();
      }
      if (item?.id === 'app.navbar.personalSpace' && !this.personalSpaceLoaded) {
        this.loadPersonalSpaceTree();
      }
    });

    const onClipboardChanged = () => this.refreshClipboard();
    window.addEventListener('clipboard-changed', onClipboardChanged);

    const onFavoritesChanged = () => this.loadFavorites();
    window.addEventListener('favorites-changed', onFavoritesChanged);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('clipboard-changed', onClipboardChanged);
      window.removeEventListener('favorites-changed', onFavoritesChanged);
      this.revokeThumbnails();
    });
  }

  private computeAssetAggregationsFromEntries(entries: NuxeoDocument[]): AssetAggregations {
    const aggregations: AssetAggregations = {};

    const typeMap = new Map<string, number>();
    const mimeMap = new Map<string, number>();

    for (const doc of entries) {
      typeMap.set(doc.type, (typeMap.get(doc.type) ?? 0) + 1);

      const fileContent = doc.properties['file:content'] as { 'mime-type'?: string } | null;
      const mime = fileContent?.['mime-type'];
      if (mime) {
        mimeMap.set(mime, (mimeMap.get(mime) ?? 0) + 1);
      }
    }

    if (typeMap.size > 0) {
      aggregations.system_primaryType_agg = {
        buckets: Array.from(typeMap.entries()).map(([key, docCount]) => ({ key, docCount })),
      };
    }

    if (mimeMap.size > 0) {
      aggregations.system_mimetype_agg = {
        buckets: Array.from(mimeMap.entries()).map(([key, docCount]) => ({ key, docCount })),
      };
    }

    return aggregations;
  }

  private loadAssetAggregations(): void {
    this.assetService.searchAssets({ pageSize: 200 }).subscribe({
      next: (res) => {
        const aggregations =
          res.aggregations ?? this.computeAssetAggregationsFromEntries(res.entries ?? []);
        this.assetAggregationService.aggregations.set(aggregations);
        this.assetAggregationService.items.set(
          (res.entries ?? []).map((entry) => ({
            id: entry.uid,
            title: entry.title,
            type: entry.type,
            icon: docTypeIcon(entry.type),
          })),
        );
      },
      error: () => {
        this.assetAggregationService.aggregations.set({});
        this.assetAggregationService.items.set([]);
      },
    });
  }

  get isBrowse(): boolean {
    return this.activeItem()?.id === 'app.navbar.browse';
  }

  get isPersonalSpace(): boolean {
    return this.activeItem()?.id === 'app.navbar.personalSpace';
  }

  get isCollections(): boolean {
    return this.activeItem()?.id === 'app.navbar.collections';
  }

  get isAssets(): boolean {
    return this.activeItem()?.id === 'app.navbar.assets';
  }

  get isSearchFilters(): boolean {
    return this.activeItem()?.id === 'app.navbar.search';
  }

  get isClipboard(): boolean {
    return this.activeItem()?.id === 'app.navbar.clipboard';
  }

  get isSettings(): boolean {
    return this.activeItem()?.id === 'app.navbar.settings';
  }

  get isAdministration(): boolean {
    return this.activeItem()?.id === 'app.navbar.administration';
  }

  isAdminDrawerPathActive(path: string): boolean {
    const url = this.router.url.split('?')[0];
    if (path === '/administration/users-groups') {
      return url === path || url.startsWith(`${path}/`);
    }
    return url === path;
  }

  onAdministrationItemClick(path: string): void {
    this.navigateKeepDrawer.emit(path);
  }

  get isFavorites(): boolean {
    return this.activeItem()?.id === 'app.navbar.favorites';
  }

  get isRecentlyViewed(): boolean {
    return this.activeItem()?.id === 'app.navbar.recentlyViewed';
  }

  get isExpiredQueue(): boolean {
    return this.activeItem()?.id === 'app.navbar.expiredQueue';
  }

  onSettingsSignOut(): void {
    this.signOutSelected.emit();
  }

  get isTrash(): boolean {
    return this.activeItem()?.id === 'app.navbar.trash';
  }

  // ── Expired Queue ──

  private loadExpiredDocuments(): void {
    this.expiredLoaded = true;
    this.expiredLoading.set(true);
    this.expiredError.set(null);

    this.docService.getExpiredDocuments(20).subscribe({
      next: (res) => {
        this.expiredDocs.set(res.entries);
        this.expiredLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => {
        this.expiredError.set(
          this.translate.instant('app.message.failed-to-load-expired-documents'),
        );
        this.expiredLoading.set(false);
        this.expiredLoaded = false;
      },
    });
  }

  refreshExpired(): void {
    this.expiredLoaded = false;
    this.loadExpiredDocuments();
  }

  openExpiredDoc(doc: NuxeoDocument): void {
    this.navigateKeepDrawer.emit(`/doc/${doc.uid}`);
  }

  expiredDate(doc: NuxeoDocument): string {
    const expired = doc.properties?.['dc:expired'] as string;
    if (!expired) return '';
    // `formatDate`, not `inject(DatePipe)`. Listing `DatePipe` in `imports` makes it usable as
    // `| date` in the template; it does NOT provide it for injection, so injecting it threw
    // NG0201 in this component's constructor and took the app-shell header specs down with it.
    // `providers: [DatePipe]` would also work, but this needs no DI at all — `formatDate` is the
    // function `DatePipe.transform` delegates to, and it takes the locale as an argument.
    return formatDate(new Date(expired), 'mediumDate', this.locale);
  }

  // ── Recently Viewed ──

  private loadRecentlyViewed(): void {
    this.recentlyViewedLoaded = true;
    this.recentlyViewedLoading.set(true);
    this.recentlyViewedError.set(null);

    const userId = this.authService.username() ?? 'Administrator';
    this.docService.getRecentlyViewed(userId, 20).subscribe({
      next: (res) => {
        this.recentlyViewed.set(res.entries);
        this.recentlyViewedLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => {
        this.recentlyViewedError.set(
          this.translate.instant('app.message.failed-to-load-recently-viewed-documents'),
        );
        this.recentlyViewedLoading.set(false);
        this.recentlyViewedLoaded = false;
      },
    });
  }

  refreshRecentlyViewed(): void {
    this.recentlyViewedLoaded = false;
    this.loadRecentlyViewed();
  }

  openRecentlyViewedDoc(doc: NuxeoDocument): void {
    if (isCollectionDocument(doc)) {
      this.navigateKeepDrawer.emit(documentNavigationUrl(doc));
      return;
    }

    if (isFolderishDocument(doc)) {
      this.navigateKeepDrawer.emit(`/browse${doc.path}`);
      return;
    }

    this.navigateKeepDrawer.emit(`/doc/${doc.uid}`);
  }

  docIcon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  /**
   * Localised by `Intl.RelativeTimeFormat`, which also covers the future case this used to
   * spell as `in ${label}` — a positive offset produces "in 3 days" in each language's own
   * word order. See `formatRelativeTime`.
   */
  relativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.translate.currentLang);
  }

  // ── Collections ──

  private loadCollections(): void {
    this.collectionsLoading.set(true);
    this.collectionService.getAll().subscribe({
      next: (res) => {
        this.collections.set(res.entries);
        this.collectionsLoading.set(false);
        this.collectionsLoaded = true;
        this.loadThumbnailsForIds(res.entries.map((d) => d.uid));
      },
      error: () => {
        this.collectionsLoading.set(false);
      },
    });
  }

  openCollection(col: NuxeoDocument): void {
    this.navigateKeepDrawer.emit(`/collections/${col.uid}`);
  }

  collectionOwner(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:creator'] as string) ?? '';
  }

  collectionOwnerInitial(doc: NuxeoDocument): string {
    const owner = this.collectionOwner(doc);
    return owner ? owner.charAt(0).toUpperCase() : '?';
  }

  // ── Browse tree ──

  /** Reads the browse tree again, as after a paste, a create or a delete. */
  refreshBrowseTree(): void {
    this.browseTree()?.reload();
  }

  onBrowseTreeNavigate(doc: NuxeoDocument): void {
    const path = doc.path || '/';
    this.browseContext.setFromNuxeoPath(path);
    this.navigateKeepDrawer.emit(path === '/' ? '/browse' : documentNavigationUrl(doc));
  }

  isNodeActive(node: FolderNode): boolean {
    const activePath = normalizeNuxeoPath(this.browseContext.contextPath());
    const nodePath = node.doc.path;
    if (nuxeoPathsEqualFlexible(nodePath, activePath)) {
      return true;
    }

    const activeSegments = nuxeoPathSegments(activePath);
    const nodeSegments = nuxeoPathSegments(nodePath);
    if (activeSegments.length <= nodeSegments.length) {
      return false;
    }

    const isAncestor = nodeSegments.every((segment, index) => segment === activeSegments[index]);
    if (!isAncestor) {
      return false;
    }

    if (!node.expanded || node.children.length === 0) {
      return true;
    }

    const hasVisibleDeeperMatch = node.children.some((child) =>
      this.isNodeOrAncestorOfActivePath(child, activeSegments),
    );
    return !hasVisibleDeeperMatch;
  }

  private isNodeOrAncestorOfActivePath(node: FolderNode, activeSegments: string[]): boolean {
    const nodeSegments = nuxeoPathSegments(node.doc.path);
    if (nodeSegments.length > activeSegments.length) {
      return false;
    }
    return nodeSegments.every((segment, index) => segment === activeSegments[index]);
  }

  private clearUserScopedDrawerCaches(): void {
    this.browseTree()?.reload();
    this.collectionsLoaded = false;
    this.collections.set([]);
    this.collectionsLoading.set(false);
    this.recentlyViewedLoaded = false;
    this.recentlyViewed.set([]);
    this.recentlyViewedLoading.set(false);
    this.recentlyViewedError.set(null);
    this.expiredLoaded = false;
    this.expiredDocs.set([]);
    this.expiredLoading.set(false);
    this.expiredError.set(null);
    this.personalSpaceLoaded = false;
    this.personalSpaceNodes.set([]);
    this.personalSpaceLoading.set(false);
    this.personalSpaceError.set(null);
    this.favorites.set([]);
    this.favoritesLoading.set(false);
    this.tasks.set([]);
    this.tasksLoading.set(false);
    this.tasksError.set(null);
  }

  refreshPersonalSpaceTree(): void {
    this.personalSpaceLoaded = false;
    this.loadPersonalSpaceTree();
  }

  private loadPersonalSpaceTree(): void {
    this.personalSpaceLoaded = true;
    this.personalSpaceLoading.set(true);
    this.personalSpaceError.set(null);

    this.browseService
      .getUserWorkspace()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (workspace) => {
          const rootNode: FolderNode = {
            doc: workspace,
            children: [],
            expanded: true,
            loaded: false,
            loading: true,
          };
          this.personalSpaceNodes.set([rootNode]);
          this.personalSpaceLoading.set(false);

          this.browseService
            .getNavTreeChildren(workspace)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (res) => {
                rootNode.children = this.toFolderNodes(res.entries ?? []);
                rootNode.loaded = true;
                rootNode.loading = false;
                this.personalSpaceNodes.update((nodes) => [...nodes]);
                this.prefetchChildStatus(rootNode.children);
              },
              error: () => {
                rootNode.loading = false;
                rootNode.loaded = true;
                rootNode.children = [];
                this.personalSpaceNodes.update((nodes) => [...nodes]);
                this.personalSpaceError.set(
                  this.translate.instant('app.message.failed-to-load-workspace-folders'),
                );
              },
            });
        },
        error: () => {
          this.personalSpaceError.set(
            this.translate.instant('app.message.failed-to-load-personal-workspace'),
          );
          this.personalSpaceLoading.set(false);
          this.personalSpaceLoaded = false;
        },
      });
  }

  private notifyActiveTreeChanged(): void {
    this.personalSpaceNodes.update((nodes) => [...nodes]);
  }

  private toFolderNodes(entries: NuxeoDocument[]): FolderNode[] {
    return (entries ?? [])
      .filter((e) => isBrowsableNavNode(e))
      .map((doc) => ({
        doc,
        children: [],
        expanded: false,
        loaded: false,
        loading: false,
      }));
  }

  toggleNode(node: FolderNode): void {
    if (node.expanded) {
      node.expanded = false;
      this.notifyActiveTreeChanged();
      return;
    }

    if (!node.loaded) {
      node.loading = true;
      this.notifyActiveTreeChanged();

      this.browseService
        .getNavTreeChildren(node.doc)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            node.children = this.toFolderNodes(res.entries);
            node.loaded = true;
            node.loading = false;
            node.expanded = true;
            this.notifyActiveTreeChanged();
            this.prefetchChildStatus(node.children);
          },
          error: () => {
            node.loading = false;
            node.loaded = true;
            node.children = [];
            this.notifyActiveTreeChanged();
          },
        });
    } else {
      node.expanded = true;
      this.notifyActiveTreeChanged();
    }
  }

  private prefetchChildStatus(nodes: FolderNode[]): void {
    const unloaded = nodes.filter((n) => !n.loaded);
    if (unloaded.length === 0) return;

    const checks$ = unloaded.map((n) =>
      this.browseService.getNavTreeChildren(n.doc).pipe(catchError(() => of(null))),
    );

    forkJoin(checks$)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        results.forEach((res, i) => {
          const node = unloaded[i];
          if (res) {
            node.loaded = true;
            node.children = this.toFolderNodes(res.entries ?? []);
          }
        });
        this.notifyActiveTreeChanged();
      });
  }

  navigateToFolder(node: FolderNode): void {
    const nuxeoPath = node.doc.path;
    this.browseContext.setFromNuxeoPath(nuxeoPath);
    this.navigateKeepDrawer.emit(documentNavigationUrl(node.doc));
  }

  nodeLabel(node: FolderNode): string {
    return node.doc.title;
  }

  hasChildren(node: FolderNode): boolean {
    if (node.loading) {
      return true;
    }
    if (!node.loaded) {
      return true;
    }
    if (node.children.length > 0) {
      return true;
    }
    // Nuxeo Web UI keeps disclosure triangles on folderish nodes even when empty.
    return isFolderishDocument(node.doc);
  }

  // ── Tasks panel ──

  get isTasksPanel(): boolean {
    return this.activeItem()?.id === 'app.navbar.tasks';
  }

  loadTasks(): void {
    this.tasksLoading.set(true);
    this.tasksError.set(null);
    const userId = this.currentUsername() ?? 'Administrator';
    this.taskService.getUserTasks(userId, 50).subscribe({
      next: (entries) => {
        this.tasks.set(entries);
        this.tasksLoading.set(false);
      },
      error: () => {
        this.tasksError.set(this.translate.instant('tasks.message.failed-to-load-tasks'));
        this.tasksLoading.set(false);
      },
    });
  }

  selectTask(task: NuxeoTask): void {
    this.itemSelected.emit('/tasks/' + task.id);
  }

  /** Highlights the row that matches the current /tasks/:taskId route. */
  isTaskSelected(task: NuxeoTask): boolean {
    const path = this.router.url.split('?')[0];
    const m = /^\/tasks\/([^/]+)/.exec(path);
    return m ? m[1] === task.id : false;
  }

  /** Title row: directive when present (e.g. "Consolidate Review"), else task name. */
  taskPrimaryTitle(task: NuxeoTask): string {
    if (task.directive) {
      const d = task.directive.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
      return d
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\./g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return this.taskLabel(task);
  }

  /** Relative due fragment only (pairs with the "Due"/"Overdue" prefix in the template). */
  dueRelativeOnly(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    const distance = taskDueDistance(task.dueDate);
    return this.translate.instant(drawerDueKey(distance), { count: distance.count });
  }

  /** Workflow as a single sentence-style line (e.g. "Parallel document review"). */
  taskWorkflowSentence(task: NuxeoTask): string {
    const raw = (task.workflowTitle || task.workflowModelName || '').trim();
    if (!raw) return '';
    const key = raw.replace(/^wf\.\w+\./, '');
    const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' ');
    const lower = spaced.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  isOverdue(task: NuxeoTask): boolean {
    return !!task.dueDate && new Date(task.dueDate) < new Date();
  }

  // ── Clipboard ──

  refreshClipboard(): void {
    const docs = readClipboardDocs();
    this.clipboardDocs.set(docs);
    this.loadThumbnailsForIds(docs.map((d) => d.uid));
  }

  /**
   * Every document id currently displayed in any drawer panel.
   *
   * Computed on demand rather than cached, because the loaders' callbacks need the *current* answer: an
   * effect-maintained cache is written after change detection, so a response arriving in between would
   * be judged against a stale set and a legitimate thumbnail dropped.
   *
   * Five panels share one `thumbnailMap`, which is why this is a union rather than a per-panel ledger.
   * A sixth panel that forgets to appear here would reintroduce the leak, so it is listed in one place
   * with the loaders reading from it.
   */
  private liveThumbnailIds(): Set<string> {
    return new Set<string>([
      ...this.expiredDocs().map((d) => d.uid),
      ...this.recentlyViewed().map((d) => d.uid),
      ...this.collections().map((d) => d.uid),
      ...this.clipboardDocs().map((d) => d.uid),
      ...this.favorites().map((d) => d.uid),
    ]);
  }

  /**
   * Revokes and forgets thumbnails for documents no longer shown in any panel.
   *
   * `thumbnailMap` only ever grew. This drawer lives in the app shell for the whole session, so every
   * clipboard entry removed, every favourites or recently-viewed refresh, left its blob alive until the
   * tab closed — unbounded growth from ordinary use, not a leak that needed anything to go wrong. The
   * per-id revoke-before-replace already present only covers re-fetching the SAME id.
   */
  private reconcileThumbnails(): void {
    const live = this.liveThumbnailIds();
    const map = this.thumbnailMap();
    const stale = Object.keys(map).filter((id) => !live.has(id));
    if (stale.length === 0) return;
    for (const id of stale) {
      const url = map[id];
      if (url) URL.revokeObjectURL(url);
    }
    this.thumbnailMap.update((current) => {
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });
  }

  private loadThumbnailsForIds(uids: string[]): void {
    this.reconcileThumbnails();
    for (const uid of uids) {
      if (this.thumbnailMap()[uid]) continue;
      this.detailService
        .fetchThumbnail(uid)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob) return;
          // Dropped if this document left every panel while the request was in flight: minting here
          // would add a URL nothing renders and nothing revokes until the tab closes.
          if (!this.liveThumbnailIds().has(uid)) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((m) => {
            const previous = m[uid];
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return {
              ...m,
              [uid]: url,
            };
          });
        });
    }
  }

  openClipboardDoc(doc: ClipboardDoc): void {
    this.navigateKeepDrawer.emit(`/doc/${doc.uid}`);
  }

  removeFromClipboard(doc: ClipboardDoc): void {
    const updated = this.clipboardDocs().filter((d) => d.uid !== doc.uid);
    this.clipboardDocs.set(updated);
    writeClipboardDocs(updated);
    window.dispatchEvent(new Event('clipboard-changed'));
  }

  clearClipboard(): void {
    this.clipboardDocs.set([]);
    writeClipboardDocs([]);
    window.dispatchEvent(new Event('clipboard-changed'));
  }

  copyClipboard(): void {
    this.executeClipboardAction('copy');
  }

  moveClipboard(): void {
    this.executeClipboardAction('move');
  }

  private executeClipboardAction(action: 'copy' | 'move'): void {
    const target = this.clipboardTargetService.target();
    const uids = this.clipboardDocs().map((doc) => doc.uid);
    if (
      !target ||
      uids.length === 0 ||
      !this.clipboardCanPaste() ||
      this.clipboardActionLoading()
    ) {
      return;
    }

    this.clipboardActionLoading.set(true);
    const request$ =
      action === 'copy'
        ? this.browseService.copyDocuments(uids, target.uid)
        : this.browseService.moveDocuments(uids, target.uid);

    request$
      .pipe(
        finalize(() => this.clipboardActionLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (results) => {
          if (results.length === 0) {
            this.snackBar.open(
              action === 'copy'
                ? this.translate.instant('app.message.failed-to-copy-clipboard-items')
                : this.translate.instant('app.message.failed-to-move-clipboard-items'),
              this.translate.instant('common.dismiss'),
              { duration: 4000 },
            );
            return;
          }
          const count = results.length;
          this.clearClipboard();
          this.browseContext.notifyClipboardPasteComplete({
            targetUid: target.uid,
            documents: results,
            action,
          });
          this.browseContext.requestTreeRefresh();
          const verb = action === 'copy' ? 'Copied' : 'Moved';
          this.snackBar.open(
            `${verb} ${count} item${count === 1 ? '' : 's'} to ${target.title ?? 'folder'}.`,
            this.translate.instant('common.dismiss'),
            { duration: 4000 },
          );
        },
        error: () => {
          this.snackBar.open(
            action === 'copy'
              ? this.translate.instant('app.message.failed-to-copy-clipboard-items')
              : this.translate.instant('app.message.failed-to-move-clipboard-items'),
            this.translate.instant('common.dismiss'),
            { duration: 4000 },
          );
        },
      });
  }

  // ── Favorites ──

  loadFavorites(): void {
    const user = this.authService.username();
    if (!user) return;
    this.favoritesLoading.set(true);
    this.collectionService.getFavorites(user, 50).subscribe({
      next: (res) => {
        this.favorites.set(res.entries);
        this.favoritesLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => this.favoritesLoading.set(false),
    });
  }

  /**
   * Blob URLs currently owned by the drawer.
   *
   * Both loaders (`loadThumbnailsForIds` for clipboard and `loadThumbnails` for favourites) write
   * raw object-URL strings into `thumbnailMap`, so teardown can revoke the map's current values
   * directly on destroy.
   */
  private revokeThumbnails(): void {
    for (const url of Object.values(this.thumbnailMap())) if (url) URL.revokeObjectURL(url);
  }

  private loadThumbnails(docs: NuxeoDocument[]): void {
    this.reconcileThumbnails();
    for (const doc of docs) {
      if (this.thumbnailMap()[doc.uid]) continue;
      this.detailService
        .fetchThumbnail(doc.uid)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob) return;
          // Same guard as the id-based loader above.
          if (!this.liveThumbnailIds().has(doc.uid)) return;
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

  openFavoriteDoc(doc: NuxeoDocument): void {
    this.navigateKeepDrawer.emit(`/doc/${doc.uid}`);
  }

  removeFromFavorites(doc: NuxeoDocument): void {
    this.detailService.removeFromFavorites(doc.uid).subscribe({
      next: () => {
        this.favorites.update((list) => list.filter((d) => d.uid !== doc.uid));
        window.dispatchEvent(new Event('favorites-changed'));
      },
    });
  }

  favoriteContributor(doc: NuxeoDocument): string {
    return (doc.properties?.['dc:lastContributor'] as string) ?? '';
  }

  favoriteContributorInitial(doc: NuxeoDocument): string {
    const c = this.favoriteContributor(doc);
    return c ? c.charAt(0).toUpperCase() : '?';
  }
}
