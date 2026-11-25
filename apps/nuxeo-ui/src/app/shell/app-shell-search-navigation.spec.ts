import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { SearchAggregationService } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import type { AppNavItem } from '../platform-nav-items';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent — search return navigation', () => {
  let currentUrl: string;
  let navigation: Subject<NavigationEnd | NavigationStart>;
  let navigated: string[];

  beforeEach(async () => {
    currentUrl = '/browse/contracts?page=2';
    navigation = new Subject<NavigationEnd | NavigationStart>();
    navigated = [];
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, {
        useValue: {
          isAuthenticated: signal(true),
          username: signal('test.user'),
          hasAdministrationAccess: signal(false),
          isAdministrator: signal(false),
          basicCredentials: () => null,
          shareAuthToken: () => null,
          logout: () => undefined,
        },
      })
      .compileComponents();
    const router = TestBed.inject(Router);
    spyOnProperty(router, 'url', 'get').and.callFake(() => currentUrl);
    spyOnProperty(router, 'events', 'get').and.returnValue(navigation);
    spyOn(router, 'navigateByUrl').and.callFake((url) => {
      navigated.push(String(url));
      return Promise.resolve(true);
    });
  });

  function finishNavigation(url: string): void {
    navigation.next(new NavigationStart(1, url));
    currentUrl = url;
    navigation.next(new NavigationEnd(1, url, url));
  }

  it('returns to Browse after a customer Search navigation entry opens the workspace', () => {
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onNavClick(
      { id: 'customer.search', path: '/search', label: 'Search' } as AppNavItem,
      new MouseEvent('click'),
    );
    finishNavigation('/search');
    shell.closeSearch();
    expect(navigated.at(-1)).toBe('/browse/contracts?page=2');
  });

  it('retains the origin and submitted keyword when Enter follows a click before navigation ends', () => {
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onGlobalSearchActivate();
    shell.onGlobalSearchInput('contract');
    shell.submitGlobalSearch();
    finishNavigation('/search');
    expect(TestBed.inject(SearchAggregationService).keywordRequest()).toEqual({
      term: 'contract',
    });
    shell.closeSearch();
    expect(navigated.at(-1)).toBe('/browse/contracts?page=2');
  });

  it('retains the completed origin when router.url changes before Search NavigationEnd', () => {
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.onGlobalSearchActivate();
    navigation.next(new NavigationStart(1, '/search'));
    currentUrl = '/search';
    shell.onGlobalSearchInput('contract');
    shell.submitGlobalSearch();
    navigation.next(new NavigationEnd(1, '/search', '/search'));
    expect(TestBed.inject(SearchAggregationService).keywordRequest()).toEqual({ term: 'contract' });
    shell.closeSearch();
    expect(navigated.at(-1)).toBe('/browse/contracts?page=2');
  });

  it('uses Dashboard as the fallback for a direct Search deep link', () => {
    currentUrl = '/search';
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    shell.closeSearch();
    expect(navigated).toEqual(['/dashboard']);
  });

  it('does not capture Login when constructed during the initial Search navigation', () => {
    currentUrl = '/login';
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    // The initial NavigationStart preceded shell construction; only its completion is observed.
    currentUrl = '/search';
    navigation.next(new NavigationEnd(1, '/search', '/search'));
    shell.closeSearch();
    expect(navigated).toEqual(['/dashboard']);
  });

  it('tracks drawer-driven entry and retains its origin through search pagination', () => {
    const shell = TestBed.createComponent(AppShellComponent).componentInstance;
    finishNavigation('/doc/first?searchQueue=true&quickFilters=noFolder');
    finishNavigation('/search?quickFilters=noFolder');
    finishNavigation('/search?quickFilters=noFolder&page=2');
    shell.closeSearch();
    expect(navigated).toEqual(['/doc/first?searchQueue=true&quickFilters=noFolder']);
  });
});
