import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PACKAGED_NAV_ITEMS } from '@nuxeo/satori-platform/extensions';
import { of, Subject } from 'rxjs';

import {
  BrowseContextService,
  SearchAggregationService,
  SearchService,
} from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { toAppNavItem, type AppNavItem } from '../platform-nav-items';
import { AppShellComponent } from './app-shell.component';

/** Clicking the one Browse entry opens the folder in view, or else the one browse last showed. */
describe('AppShellComponent — the Browse nav entry', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    hasAdministrationAccess: signal(false),
    isAdministrator: signal(false),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  const BROWSE = {
    id: 'app.navbar.browse',
    path: '/browse',
    label: 'Browse',
    hasDrawer: true,
  } as AppNavItem;

  let navigated: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    navigated = [];
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake((url) => {
      navigated.push(String(url));
      return Promise.resolve(true);
    });
  });

  /** With the drawer closed: on a browse URL an open Browse drawer would be toggled shut instead. */
  function clickBrowseFrom(currentUrl: string): void {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(currentUrl);
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.drawerOpen.set(false);
    shell.onNavClick(BROWSE, new MouseEvent('click'));
  }

  it('expands header search and closes back to the page it was opened from', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/browse/contracts');
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onGlobalSearchFocus();
    shell.onGlobalSearchInput('NEV');
    shell.submitGlobalSearch();
    expect(TestBed.inject(SearchAggregationService).keywordRequest()).toEqual({ term: 'NEV' });
    expect(shell.globalSearchOpen()).toBeFalse();
    shell.closeSearch();
    expect(navigated).toEqual(['/search', '/browse/contracts']);
  });

  it('restores applied keywords when search is reopened', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/dashboard');
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    TestBed.inject(SearchAggregationService).drawerFilters.set({ ecm_fulltext: 'NEV' });
    shell.onGlobalSearchFocus();
    expect(shell.globalSearchTerm()).toBe('NEV');
  });

  it('restores applied keywords when returning from the document queue', () => {
    const router = TestBed.inject(Router);
    const navigation = new Subject<NavigationEnd>();
    spyOnProperty(router, 'events', 'get').and.returnValue(navigation);
    spyOnProperty(router, 'url', 'get').and.returnValue('/doc/test?searchQueue=true');
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    TestBed.inject(SearchAggregationService).drawerFilters.set({ ecm_fulltext: 'NEV' });
    navigation.next(new NavigationEnd(1, '/search', '/search'));
    expect(shell.globalSearchTerm()).toBe('NEV');
    shell.onGlobalSearchInput('draft');
    navigation.next(new NavigationEnd(2, '/search?page=2', '/search?page=2'));
    expect(shell.globalSearchTerm()).toBe('draft');
  });

  it('reopens search on click after Escape leaves the collapsed input focused', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/configurable-view');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      '#global-header-search-input',
    ) as HTMLInputElement;
    input.focus();
    fixture.componentInstance.closeSearch();
    navigated.length = 0;
    input.click();
    expect(navigated).toEqual(['/search']);
  });

  it('reloads suggestions for the restored keyword when search is reopened', fakeAsync(() => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/dashboard');
    const suggest = spyOn(
      TestBed.inject(SearchService),
      'suggestFromSuggestersLauncher',
    ).and.returnValue(of([{ id: 'test-user', displayLabel: 'NEV User', kind: 'user' }]));
    const fixture = TestBed.createComponent(AppShellComponent);
    TestBed.inject(SearchAggregationService).drawerFilters.set({ ecm_fulltext: 'NEV' });
    fixture.componentInstance.onGlobalSearchFocus();
    tick(251);
    expect(suggest).toHaveBeenCalledWith('NEV');
    expect(fixture.componentInstance.globalSearchResults()[0].displayLabel).toBe('NEV User');
    fixture.destroy();
  }));

  it('keeps the keyword draft on blur and clears it explicitly', () => {
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onGlobalSearchInput('invoice');
    shell.onGlobalSearchFocusOut(new FocusEvent('focusout'));
    expect(shell.globalSearchTerm()).toBe('invoice');
    shell.clearSearchKeywords();
    expect(TestBed.inject(SearchAggregationService).keywordRequest()).toEqual({ term: '' });
  });

  it('opens the folder the current browse URL names, and remembers it', () => {
    clickBrowseFrom('/browse/default-domain/workspaces/Contracts');

    expect(navigated).toEqual(['/browse/default-domain/workspaces/Contracts']);
    expect(TestBed.inject(BrowseContextService).contextPath()).toBe(
      '/default-domain/workspaces/Contracts',
    );
  });

  it('opens the folder browse last showed when the user is on another page', () => {
    TestBed.inject(BrowseContextService).setFromNuxeoPath('/default-domain/workspaces/Claims');

    clickBrowseFrom('/search');

    expect(navigated).toEqual(['/browse/default-domain/workspaces/Claims']);
  });

  it('opens the repository root when nothing has been browsed yet', () => {
    clickBrowseFrom('/dashboard');

    expect(navigated).toEqual(['/browse']);
  });

  it('opens the new search workspace without the legacy filter drawer', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/dashboard');
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onNavClick(
      { ...BROWSE, id: 'app.navbar.search', path: '/search' },
      new MouseEvent('click'),
    );
    expect(navigated).toEqual(['/search']);
    expect(shell.drawerOpen()).toBeFalse();
  });

  it('opens the search drawer for an explicit queue link, including document routes', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(
      '/doc/test?searchQueue=true',
    );
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    expect(shell.drawerOpen()).toBeTrue();
    expect(shell.activeDrawerItem()?.path).toBe('/search');
    expect(shell.activeDrawerItem()?.id).toBe('app.navbar.search');
  });

  it('opens the configurable view separately from header search', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/dashboard');
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    const descriptor = PACKAGED_NAV_ITEMS.find(
      (item) => item.id === 'app.navbar.configurableView',
    )!;
    expect(PACKAGED_NAV_ITEMS.some((item) => item.path === '/search')).toBeFalse();
    shell.onNavClick(toAppNavItem(descriptor), new MouseEvent('click'));
    expect(navigated).toEqual(['/configurable-view']);
    expect(shell.drawerOpen()).toBeFalse();
  });

  it('labels expanded search Search instead of Keywords', () => {
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue('/search');
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        'shell.search.placeholder': 'Keywords',
        'search.workspace.search': 'Search',
        'search.workspace.clear-search': 'Clear',
      },
      true,
    );
    translate.use('en');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.header-search-label').textContent.trim()).toBe(
      'Search',
    );
    expect(
      fixture.nativeElement.querySelector('.header-search-actions button').textContent.trim(),
    ).toBe('Clear');
  });
});
