/**
 * NXSAT-811 — the side nav keeps the drawer the user opened when they follow a document's
 * breadcrumb into Browse.
 *
 * A document opened from Favorites, Clipboard, Recently viewed, Collections, Search, Assets or
 * Tasks has a breadcrumb whose ancestors lead into `/browse/...`, and the shell used to swap the
 * open drawer for the Browse tree after that navigation. The Personal Space drawer's route
 * redirects into `/browse/...` and lost its drawer the same way.
 *
 * The decision itself is tested in `drawer-route-match.spec.ts`. This renders the real shell and
 * sends it the navigation, to check the decision is what the shell acts on.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, Router, type Event as RouterEvent } from '@angular/router';
import type { Subject } from 'rxjs';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import type { AppNavItem } from '../platform-nav-items';
import { AppShellComponent } from './app-shell.component';

describe('AppShellComponent — the side nav drawer follows the route (NXSAT-811)', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('Administrator'),
    hasAdministrationAccess: signal(true),
    isAdministrator: signal(true),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  let http: HttpTestingController;
  let component: AppShellComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => {
    const emptyDocumentList = {
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    };
    http.match(() => true).forEach((request) => request.flush(emptyDocumentList));
    http.verify();
  });

  /** The nav item for `path`, as the shell builds it from the extension registry. */
  function navItem(path: string): AppNavItem {
    const items = (component as unknown as { navItems: () => AppNavItem[] }).navItems();
    const found = items.find((i) => i.path === path);
    expect(found).withContext(`a nav item for ${path}`).toBeDefined();
    return found as AppNavItem;
  }

  /** Sends the shell the end of a navigation to `url`, as the router does. */
  function navigatedTo(url: string): void {
    (TestBed.inject(Router).events as Subject<RouterEvent>).next(new NavigationEnd(1, url, url));
  }

  function open(path: string): void {
    component.activeDrawerItem.set(navItem(path));
    component.drawerOpen.set(true);
  }

  it('keeps Favorites open when the breadcrumb leads into Browse', () => {
    open('/favorites');
    navigatedTo('/doc/abc');
    expect(component.activeDrawerItem()?.path).toBe('/favorites');

    navigatedTo('/browse/default-domain/workspaces/QA287');

    expect(component.activeDrawerItem()?.path).toBe('/favorites');
    expect(component.drawerOpen()).toBe(true);
  });

  it('keeps each of the drawers that open documents', () => {
    for (const path of ['/clipboard', '/recently-viewed', '/collections', '/documents', '/tasks']) {
      open(path);
      navigatedTo('/browse/default-domain/workspaces/QA287');
      expect(component.activeDrawerItem()?.path).withContext(`${path} drawer`).toBe(path);
      expect(component.drawerOpen()).withContext(`${path} drawer open`).toBe(true);
    }
  });

  it('keeps Personal Space open when its route redirects into Browse', () => {
    open('/personal-space');
    navigatedTo('/browse/default-domain/UserWorkspaces/Administrator');
    expect(component.activeDrawerItem()?.path).toBe('/personal-space');
    expect(component.drawerOpen()).toBe(true);
  });

  it('still opens the Browse drawer for a deep link or reload with nothing open', () => {
    expect(component.drawerOpen()).toBe(false);
    navigatedTo('/browse/default-domain/workspaces/QA287');
    expect(component.activeDrawerItem()?.path).toBe('/browse');
    expect(component.drawerOpen()).toBe(true);
  });

  it('opens a section’s drawer again on a route into it after the user closed it, as before', () => {
    open('/browse');
    component.onDrawerClose();
    expect(component.drawerOpen()).toBe(false);
    expect(component.activeDrawerItem()).toBeNull();

    // Closing clears the chosen drawer along with the open flag, so nothing is open and the next
    // route into Browse is treated like a deep link. This did not change.
    navigatedTo('/browse/default-domain/workspaces/QA287');

    expect(component.drawerOpen()).toBe(true);
    expect(component.activeDrawerItem()?.path).toBe('/browse');
  });

  it('leaves an open drawer alone when history navigation lands on another drawer’s route', () => {
    open('/personal-space');

    // Back to an earlier Browse page reaches the shell as the same navigation end as a link does:
    // history navigation does not replace an open drawer either. With nothing open it opens the
    // route's drawer, which the deep-link test above covers.
    navigatedTo('/browse/default-domain/workspaces/QA287');

    expect(component.activeDrawerItem()?.path).toBe('/personal-space');
    expect(component.drawerOpen()).toBe(true);
  });

  it('still switches drawers when the user picks another item in the rail', () => {
    open('/favorites');
    component.onNavClick(navItem('/browse'), new Event('click'));
    expect(component.activeDrawerItem()?.path).toBe('/browse');
    expect(component.drawerOpen()).toBe(true);
  });
});
