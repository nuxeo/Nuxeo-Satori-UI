import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { BrowseContextService } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import type { AppNavItem } from '../platform-nav-items';
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
});
