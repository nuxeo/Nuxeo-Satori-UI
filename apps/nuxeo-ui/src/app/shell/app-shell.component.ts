import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  of,
  switchMap,
  Subscription,
} from 'rxjs';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SatAppHeaderModule } from '@hylandsoftware/satori-ui/app-header';
import { SatLogoModule } from '@hylandsoftware/satori-ui/logo';
import {
  SatPlatformNavModule,
  SatPlatformNavStateService,
} from '@hylandsoftware/satori-ui/platform-nav';
import {
  CollectionService,
  DocumentDetailService,
  BrowseContextService,
  SearchService,
  SelectionService,
  readClipboardDocs,
  isBrowseRouterUrl,
  parseBrowseNuxeoPathFromRouterUrl,
  toBrowseRouterUrl,
  type GlobalSearchSuggestion,
  docTypeIcon,
} from '@nuxeo/satori-platform/nuxeo-client';
import { SelectionTopbarComponent } from '@nuxeo/satori-platform/ui';
import { AiChatService, AiFeatureFlagService } from '@agentic-ui/shared/ai-client';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { APP_NAV_ITEMS, PACKAGED_NAV_ITEMS } from '@nuxeo/satori-platform/extensions';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { SessionTimeoutService } from '../auth/session-timeout.service';
import { AppNavItem, SETTINGS_DRAWER_ITEMS, toAppNavItem } from '../platform-nav-items';
import { ThemingFeatureFlagService } from '../theme/theming-feature-flag.service';
import { drawerItemForPath } from './drawer-route-match';
import { NavDrawerComponent } from './nav-drawer/nav-drawer.component';
import { PresetBadgeComponent } from './preset-badge/preset-badge.component';
import { AiMarkdownPipe } from '../pipes/ai-markdown.pipe';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    SatPlatformNavModule,
    SatAppHeaderModule,
    SatLogoModule,
    MatDialogModule,
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatSidenavModule,
    MatTooltipModule,
    NavDrawerComponent,
    PresetBadgeComponent,
    SelectionTopbarComponent,
    FormsModule,
    AiMarkdownPipe,
    TranslatePipe,
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent implements OnDestroy {
  @ViewChild('globalSearchContainer')
  private globalSearchContainer?: ElementRef<HTMLElement>;

  private readonly settingsDrawerItem: AppNavItem = {
    id: 'app.navbar.settings',
    labelKey: 'nav.item.settings',
    label: 'Settings',
    path: '/settings',
    icon: 'settings',
    hasDrawer: true,
  };

  private readonly router = inject(Router);
  private readonly platformNavState = inject(SatPlatformNavStateService);
  private readonly auth = inject(AuthService);
  private readonly sessionTimeout = inject(SessionTimeoutService);
  private readonly snackBar = inject(MatSnackBar);
  readonly selectionService = inject(SelectionService);
  private readonly collectionService = inject(CollectionService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly searchService = inject(SearchService);
  private readonly browseContext = inject(BrowseContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appConfig = inject(AppConfigService);
  /** Layer 0 `branding.logo`; `null` keeps the Satori word mark. */
  protected readonly brandLogo = this.appConfig.brandingLogo;
  private readonly translate = inject(TranslateService);
  /**
   * The active language, as a signal.
   *
   * `TranslateService.currentLang` is a plain getter and `instant()` is not reactive, so a
   * `computed()` that reads either would never recompute on a language change. `onLangChange`
   * is the only reactive surface ngx-translate offers for this.
   */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() ?? 'en' },
  );
  readonly aiChat = inject(AiChatService);
  readonly featureFlags = inject(AiFeatureFlagService);
  readonly themingFlags = inject(ThemingFeatureFlagService);

  readonly aiChatOpen = this.aiChat.panelOpen;
  readonly aiChatInput = signal('');
  private readonly searchInput$ = new Subject<string>();

  /**
   * The navigation, resolved from the extension registry.
   *
   * Nothing is filtered here any more. Administration is hidden by the
   * `app.rules.hasAdministrationAccess` rule on its descriptor, which a manifest
   * can see, override or replace — the previous hardcoded `path === '/administration'`
   * test could do none of those.
   */
  private readonly navDescriptors = inject(APP_NAV_ITEMS);
  protected readonly navItems = computed(() => this.navDescriptors().map(toAppNavItem));

  readonly displayName = computed(() => this.auth.username() ?? 'User');
  readonly drawerOpen = signal(false);
  readonly activeDrawerItem = signal<AppNavItem | null>(null);
  readonly clipboardCount = signal(this.readClipboardCount());
  readonly clipboardBadgeLabel = computed(() => {
    const count = this.clipboardCount();
    return count > 99 ? '99+' : String(count);
  });
  readonly clipboardBadgeCssContent = computed(() => {
    const label = this.clipboardBadgeLabel();
    return this.clipboardCount() > 0 ? `"${label}"` : null;
  });
  readonly favoritesCount = signal(0);
  readonly globalSearchTerm = signal('');
  readonly globalSearchLoading = signal(false);
  readonly globalSearchError = signal<string | null>(null);
  readonly globalSearchResults = signal<GlobalSearchSuggestion[]>([]);
  readonly globalSearchOpen = signal(false);
  readonly thumbnailMap = signal<Record<string, string>>({});
  private thumbnailSubs: Subscription[] = [];

  readonly highlightedSearchTerm = computed(() => this.globalSearchTerm().trim());

  private readonly currentUrl = signal(this.router.url.split('?')[0]);

  readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    const parts = url.split('/').filter(Boolean);
    // Administration returns BEFORE the descriptor lookup below, so none of these titles ever
    // reached `navText` and all of them stayed English in every locale. The route is guarded by
    // `adminGuard`, so the pseudo-locale audit was redirected away from it and could not see them
    // either — which is how they survived being reported as fixed. Keyed here, at the only place
    // they are produced.
    if (parts[0] === 'administration') {
      const seg = parts[1] ?? 'analytics';
      if (seg === 'users-groups' && parts[2] === 'user' && parts[3]) {
        return this.translate.instant('admin.page-title.user-named', { name: parts[3] });
      }
      if (seg === 'users-groups' && parts[2] === 'group' && parts[3]) {
        return this.translate.instant('admin.page-title.group-named', { name: parts[3] });
      }
      // The drawer already owns a key for each of these pages, so they are reused rather than
      // duplicated: the same concept in the same product, which INFO-144 permits. Only the two
      // titles with no drawer entry need keys of their own.
      const titles: Record<string, string> = {
        analytics: 'drawer.administration-analytics',
        'users-groups': 'drawer.administration-users-groups',
        vocabularies: 'drawer.administration-vocabularies',
        audit: 'drawer.administration-audit',
        'cloud-services': 'admin.page-title.cloud-services',
        'nxql-search': 'drawer.administration-nxql-search',
      };
      return this.translate.instant(titles[seg] ?? 'admin.page-title.administration');
    }
    // Resolved entries first so a manifest relabel wins, then the packaged list
    // as a fallback. Matching only against `navItems()` — which is filtered —
    // meant hiding an entry by manifest or rule also stripped its page title,
    // and a user who reached the route directly saw the brand name instead of
    // "Trash". Hiding an entry is a navigation decision, not a route decision:
    // the route still exists and is still reachable. That is also why the
    // unfiltered settings list is used here while the drawer uses
    // `visibleSettingsDrawerItems` — the theming flag hides the *link*, and
    // `themingGuard` closes the *route*; neither should blank the title.
    const candidates = [
      ...this.navItems(),
      ...PACKAGED_NAV_ITEMS.map(toAppNavItem),
      ...SETTINGS_DRAWER_ITEMS,
    ];
    const match = candidates.find((item) => url === item.path || url.startsWith(item.path + '/'));
    // Layer 0: the product name on an unmatched route is branding, not a literal.
    return match ? this.navText(match) : this.appConfig.bootstrap().branding.applicationTitle;
  });

  /**
   * The text of a nav entry, preferring its translation key over its literal label.
   *
   * ## Why this exists instead of a pipe
   *
   * The nav descriptor's text reaches the user through three paths, and only one of them is a
   * template binding. This heading is built in TypeScript, so is the clipboard entry's composed
   * accessible name below, and so is the adf-core `DataColumn.title` in the browse feature —
   * that last one is rendered by upstream's own DataTable, where we have no template at all.
   * "Apply the pipe at the render site" has no render site in any of the three.
   *
   * `instant()` is a synchronous read of the already-loaded catalogue, which is correct here
   * because `APP_INITIALIZER` awaits `translate.use(...)` before the shell renders.
   *
   * ## Why it depends on `currentLang`
   *
   * `instant()` is not reactive. Read inside a `computed()` with nothing else changing, the
   * heading would keep the language it was first evaluated in. Touching the language signal
   * makes the dependency explicit, so a language change recomputes the heading rather than
   * leaving one stale string in the middle of a translated page.
   */
  protected navText(item: { readonly label: string; readonly labelKey?: string }): string {
    this.currentLang();
    if (!item.labelKey) return item.label;
    const translated = this.translate.instant(item.labelKey);
    // ngx-translate passes an unresolved key straight through. Rendering `nav.browse` as a
    // page heading would be worse than the English it replaced, so fall back deliberately.
    return translated === item.labelKey ? item.label : translated;
  }

  private storageListener = (e: StorageEvent) => {
    if (e.key === 'nuxeo_clipboard') {
      this.clipboardCount.set(this.readClipboardCount());
    }
  };

  private clipboardChangedListener = () => this.refreshClipboardCount();
  private favoritesChangedListener = () => this.refreshFavoritesCount();

  constructor() {
    this.sessionTimeout.start();

    // The browser tab is branding too, and it was previously fixed in index.html
    // where no customer could reach it. An effect rather than a one-off call
    // because the configuration load is asynchronous.
    effect(() => {
      document.title = this.appConfig.bootstrap().branding.documentTitle;
    });

    if (!this.platformNavState.collapsed()) {
      this.platformNavState.toggleCollapsed();
    }

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        const nextPath = e.urlAfterRedirects.split('?')[0];
        const previousPath = this.currentUrl();
        if (previousPath !== nextPath) {
          this.selectionService.clear();
        }
        this.currentUrl.set(nextPath);
        this.refreshClipboardCount();
        this.clearGlobalSearch();
        this.syncDrawerToRoute(nextPath);
      });

    window.addEventListener('storage', this.storageListener);
    window.addEventListener('clipboard-changed', this.clipboardChangedListener);
    window.addEventListener('favorites-changed', this.favoritesChangedListener);
    this.refreshFavoritesCount();

    // The subscription above only fires on subsequent navigations, so a deep link or a
    // reload needs the current route applied once here.
    this.syncDrawerToRoute(this.router.url.split('?')[0]);

    this.searchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((value) => {
          const term = value.trim();
          if (term.length < 2) {
            this.globalSearchLoading.set(false);
            this.globalSearchError.set(null);
            return of<GlobalSearchSuggestion[]>([]);
          }

          this.globalSearchLoading.set(true);
          this.globalSearchError.set(null);

          return this.searchService
            .suggestFromSuggestersLauncher(term)
            .pipe(finalize(() => this.globalSearchLoading.set(false)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.globalSearchResults.set(results);
        this.globalSearchOpen.set(this.globalSearchTerm().trim().length >= 2);
        this.loadThumbnailsForResults(results);
      });
  }

  ngOnDestroy(): void {
    this.sessionTimeout.stop();
    window.removeEventListener('storage', this.storageListener);
    window.removeEventListener('clipboard-changed', this.clipboardChangedListener);
    window.removeEventListener('favorites-changed', this.favoritesChangedListener);
    this.revokeThumbnails();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const searchContainer = this.globalSearchContainer?.nativeElement;
    const clickPath = event.composedPath?.() ?? [];
    if (
      searchContainer &&
      (clickPath.includes(searchContainer) || searchContainer.contains(event.target as Node))
    ) {
      return;
    }
    this.globalSearchOpen.set(false);
  }

  private readClipboardCount(): number {
    return readClipboardDocs().length;
  }

  clipboardNavAriaLabel(item: AppNavItem): string | null {
    if (item.path !== '/clipboard' || this.clipboardCount() <= 0) {
      return null;
    }
    const count = this.clipboardCount();
    // The catalogue's established two-key pluralisation, as used by every `common.count.*` pair.
    //
    // This maps `1` to the singular and EVERY other count to the plural. That is not the same
    // thing as "these locales have two plural forms", which an earlier version of this comment
    // claimed. Measured with `Intl.PluralRules`:
    //
    //   en -> one, other          (0 -> other)
    //   de -> one, other          (0 -> other)
    //   fr -> one, many, other    (0 -> ONE, 1_000_000 -> many)
    //
    // So French has three categories and treats zero as singular. This call site is unaffected on
    // both counts: it returns `null` above when the count is not positive, so zero never reaches a
    // key, and a clipboard cannot hold a million items. The narrowing is what makes two keys
    // correct HERE, not a property of the languages.
    //
    // `docs/i18n-status.md` records the ICU decision and the same measurement, including the
    // `common.count.*` pairs where the zero case is NOT narrowed away and French is therefore
    // wrong today.
    const key = count === 1 ? 'nav.clipboard.aria-label-one' : 'nav.clipboard.aria-label-many';
    return this.translate.instant(key, { name: this.navText(item), count });
  }

  isActive(path: string): boolean {
    const activeDrawer = this.activeDrawerItem();
    if (activeDrawer && this.drawerOpen()) {
      return activeDrawer.path === path;
    }
    const url = this.router.url.split('?')[0];
    return url === path || url.startsWith(path + '/');
  }

  onNavClick(item: AppNavItem, event: Event): void {
    this.refreshClipboardCount();
    this.clearGlobalSearch();

    if (!this.platformNavState.collapsed()) {
      this.platformNavState.toggleCollapsed();
    }

    if (item.hasDrawer) {
      event.preventDefault();
      event.stopPropagation();

      if (this.activeDrawerItem()?.path === item.path && this.drawerOpen()) {
        this.drawerOpen.set(false);
        this.activeDrawerItem.set(null);
      } else {
        this.activeDrawerItem.set(item);
        this.drawerOpen.set(true);
        if (item.path === '/administration') {
          const target = this.auth.isAdministrator()
            ? '/administration/analytics'
            : '/administration/users-groups';
          void this.router.navigateByUrl(target);
        } else if (item.path === '/personal-space') {
          void this.router.navigateByUrl('/personal-space');
        } else if (item.path === '/browse') {
          this.navigateToBrowse();
        }
      }
    } else {
      this.drawerOpen.set(false);
      this.activeDrawerItem.set(null);
      void this.router.navigateByUrl(item.path);
    }
  }

  onDrawerItemSelected(path: string): void {
    this.clearGlobalSearch();
    const base = path.split('?')[0];
    if (base === '/browse' || base.startsWith('/browse/')) {
      this.browseContext.setFromRouterUrl(path);
    }
    const keepTasksDrawer = /^\/tasks\/[^/]+$/.test(base);
    if (!keepTasksDrawer) {
      this.drawerOpen.set(false);
      this.activeDrawerItem.set(null);
    }
    void this.router.navigateByUrl(path);
  }

  /**
   * Open the drawer belonging to the route being shown, if it has one.
   *
   * Driven from the route rather than from the nav click, so a deep link and a browser
   * back both arrive with the tree already open — which is how the section is meant to
   * look, and previously only happened if the user clicked the nav item themselves.
   */
  private syncDrawerToRoute(currentPath: string): void {
    const matchingItem = drawerItemForPath(this.navItems(), currentPath);

    // Re-setting the same item would reopen a drawer the user has just closed, so a
    // navigation within one section leaves their choice alone.
    if (matchingItem && this.activeDrawerItem()?.path !== matchingItem.path) {
      this.activeDrawerItem.set(matchingItem);
      this.drawerOpen.set(true);
    }

    // Navigating away deliberately does not close it: the drawer is the browse tree, and
    // opening a document from it would otherwise dismiss the tree the user is working in.
  }

  toggleSettingsDrawer(): void {
    if (this.activeDrawerItem()?.path === this.settingsDrawerItem.path && this.drawerOpen()) {
      this.drawerOpen.set(false);
      this.activeDrawerItem.set(null);
      return;
    }

    if (!this.platformNavState.collapsed()) {
      this.platformNavState.toggleCollapsed();
    }

    this.activeDrawerItem.set(this.settingsDrawerItem);
    this.drawerOpen.set(true);
  }

  onNavigateKeepDrawer(path: string): void {
    this.clearGlobalSearch();
    const base = path.split('?')[0];
    if (base === '/browse' || base.startsWith('/browse/')) {
      this.browseContext.setFromRouterUrl(path);
    }
    void this.router.navigateByUrl(path, { onSameUrlNavigation: 'reload' });
  }

  onDrawerClose(): void {
    this.drawerOpen.set(false);
    this.activeDrawerItem.set(null);
    this.refreshClipboardCount();
  }

  onGlobalSearchInput(value: string): void {
    this.globalSearchTerm.set(value);
    const hasEnoughChars = value.trim().length >= 2;
    this.globalSearchOpen.set(hasEnoughChars);
    this.searchInput$.next(value);
  }

  onGlobalSearchFocus(): void {
    this.globalSearchOpen.set(this.globalSearchTerm().trim().length >= 2);
  }

  onGlobalSearchFocusOut(event: FocusEvent): void {
    const container = this.globalSearchContainer?.nativeElement;
    const nextTarget = event.relatedTarget as Node | null;

    if (container && nextTarget && container.contains(nextTarget)) {
      return;
    }

    this.clearGlobalSearch();
  }

  onGlobalSearchSelect(result: GlobalSearchSuggestion): void {
    this.clearGlobalSearch();
    if (result.kind === 'user') {
      void this.router.navigate(['/administration/users-groups/user', result.id]);
    } else if (result.kind === 'group') {
      void this.router.navigate(['/administration/users-groups/group', result.id]);
    } else {
      const documentUid = result.documentUid ?? result.id;
      void this.router.navigate(['/doc', documentUid]);
    }
  }

  private clearGlobalSearch(): void {
    this.globalSearchTerm.set('');
    this.globalSearchLoading.set(false);
    this.globalSearchError.set(null);
    this.globalSearchResults.set([]);
    this.globalSearchOpen.set(false);
    this.revokeThumbnails();
  }

  thumbnailUrl(result: GlobalSearchSuggestion): string | null {
    const uid = result.documentUid ?? result.id;
    return this.thumbnailMap()[uid] ?? null;
  }

  private loadThumbnailsForResults(results: GlobalSearchSuggestion[]): void {
    this.revokeThumbnails();

    const docResults = results.filter((r) => r.kind === 'document');
    for (const result of docResults) {
      const uid = result.documentUid ?? result.id;
      const sub = this.detailService
        .fetchThumbnail(uid)
        .pipe(catchError(() => of(null)))
        .subscribe((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((map) => ({ ...map, [uid]: url }));
        });
      this.thumbnailSubs.push(sub);
    }
  }

  private revokeThumbnails(): void {
    for (const sub of this.thumbnailSubs) sub.unsubscribe();
    this.thumbnailSubs = [];
    const map = this.thumbnailMap();
    for (const url of Object.values(map)) {
      URL.revokeObjectURL(url);
    }
    this.thumbnailMap.set({});
  }

  userGroupIcon(result: GlobalSearchSuggestion): string {
    if (result.kind === 'group') return 'group';
    if (result.kind === 'user') return 'person';
    return 'insert_drive_file';
  }

  userGroupSubtext(result: GlobalSearchSuggestion): string {
    return result.kind === 'group' ? 'Group' : 'User';
  }

  highlightText(value: string | null | undefined): Array<{ text: string; matched: boolean }> {
    const text = value ?? '';
    const term = this.highlightedSearchTerm();
    if (!text || term.length < 2) {
      return [{ text, matched: false }];
    }

    const loweredText = text.toLowerCase();
    const loweredTerm = term.toLowerCase();
    const parts: Array<{ text: string; matched: boolean }> = [];

    let from = 0;
    while (from < text.length) {
      const matchStart = loweredText.indexOf(loweredTerm, from);
      if (matchStart === -1) {
        parts.push({ text: text.slice(from), matched: false });
        break;
      }

      if (matchStart > from) {
        parts.push({ text: text.slice(from, matchStart), matched: false });
      }

      const matchEnd = matchStart + loweredTerm.length;
      parts.push({ text: text.slice(matchStart, matchEnd), matched: true });
      from = matchEnd;
    }

    return parts.length > 0 ? parts : [{ text, matched: false }];
  }

  labelHighlightParts(result: GlobalSearchSuggestion): Array<{ text: string; matched: boolean }> {
    return result.displayLabelHighlights?.length
      ? result.displayLabelHighlights
      : this.highlightText(result.displayLabel);
  }

  subtextHighlightParts(result: GlobalSearchSuggestion): Array<{ text: string; matched: boolean }> {
    if (result.kind === 'document') {
      if (result.pathHighlights?.length) return result.pathHighlights;
      return this.highlightText(result.path || '/');
    }

    return this.highlightText(this.userGroupSubtext(result));
  }

  refreshClipboardCount(): void {
    this.clipboardCount.set(this.readClipboardCount());
  }

  refreshFavoritesCount(): void {
    const user = this.auth.username();
    if (!user) return;
    this.collectionService.getFavorites(user, 1).subscribe({
      next: (res) => this.favoritesCount.set(res.totalSize ?? res.entries?.length ?? 0),
      error: () => this.favoritesCount.set(0),
    });
  }

  togglePlatformNav(): void {
    this.platformNavState.toggleCollapsed();
  }

  signOut(): void {
    this.drawerOpen.set(false);
    this.activeDrawerItem.set(null);
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  toggleAiChat(): void {
    this.aiChat.togglePanel();
    const url = this.router.url;
    const docMatch = url.match(/\/doc\/([a-f0-9-]+)/i);
    this.aiChat.setContext({
      docId: docMatch?.[1],
      page: url,
    });
  }

  sendAiMessage(): void {
    const msg = this.aiChatInput().trim();
    if (!msg) return;
    this.aiChat.send(msg);
    this.aiChatInput.set('');
  }

  /**
   * Send one of the empty-state suggestions, in the user's language.
   *
   * The template used to set `aiChatInput` to the English sentence and call `sendAiMessage()`,
   * so the button's visible label was translated but the message sent — and echoed back as the
   * user's own turn — was always English. Resolving the key here keeps the two the same string.
   */
  sendAiSuggestion(key: string): void {
    this.aiChatInput.set(this.translate.instant(key));
    this.sendAiMessage();
  }

  clearAiChat(): void {
    this.aiChat.clear();
  }

  openAiSource(uid: string, type?: string, path?: string): void {
    this.aiChatOpen.set(false);
    if (type === 'Collection') {
      void this.router.navigate(['/collections', uid]);
    } else if ((type === 'Folder' || type === 'OrderedFolder' || type === 'Workspace') && path) {
      void this.router.navigateByUrl(`/browse${path}`);
    } else {
      void this.router.navigate(['/doc', uid]);
    }
  }

  docTypeIcon(type: string): string {
    return docTypeIcon(type);
  }

  /** Open browse at the folder being viewed, or else the one browse last showed. */
  private navigateToBrowse(): void {
    const url = this.router.url;
    const nuxeoPath = isBrowseRouterUrl(url)
      ? parseBrowseNuxeoPathFromRouterUrl(url)
      : this.browseContext.contextPath();
    this.browseContext.setFromNuxeoPath(nuxeoPath);
    void this.router.navigateByUrl(toBrowseRouterUrl(nuxeoPath));
  }
}
