import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { APP_CONFIG_FORMAT, AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  NXS_PERMISSIONS_PANEL_ID,
  NxsPermissionsPanelComponent,
} from '@nuxeo-satori/platform/components';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  type ExtensionActionDescriptor,
  type ExtensionRouteDescriptor,
  type ExtensionTabDescriptor,
} from '@nuxeo-satori/platform/extensions';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';

/**
 * The application's own wiring of the four slots that used to be dead surface.
 *
 * The library and feature specs prove each slot reaches a screen given the
 * packaged descriptors. They cannot prove **this application** registers them,
 * or that `provideExtensionRoutes()` is in `provideAppExtensions()` — and a
 * descriptor nothing registers is the same defect as a descriptor nothing
 * renders, one layer up. So this bootstraps the real `appConfig.providers` and
 * drives the manifest through `AppConfigService.load()`, the method the app
 * itself calls at startup.
 */
describe('provideAppExtensions — the four reserved slots, as the app wires them', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    isAdministrator: signal(false),
    isPowerUser: signal(false),
    hasAdministrationAccess: signal(false),
    basicCredentials: () => 'dGVzdA==',
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  let http: HttpTestingController;
  let extensions: AppExtensionsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // `provideHttpClientTesting()` last so its backend wins over the real one
      // in `appConfig.providers`; everything else is the shipped configuration.
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    extensions = TestBed.inject(AppExtensionsService);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush({}));
    http.verify();
  });

  /** Stand in the configuration service, with one package contributing `extensions`. */
  async function loadManifest(extensionConfig: unknown): Promise<void> {
    const config = TestBed.inject(AppConfigService);
    const done = config.load();
    for (const layer of ['bootstrap', 'manifest'] as const) {
      const content = layer === 'manifest' ? { extensions: extensionConfig } : {};
      http
        .match((request) => request.url.endsWith(`/agentic-ui-config/${layer}.json`))
        .forEach((request) =>
          request.flush({
            format: APP_CONFIG_FORMAT,
            layer,
            fragments: [
              { name: 'acme', component: 'com.acme', bundle: 'com.acme', source: 'x', content },
            ],
            diagnostics: [],
          }),
        );
    }
    await done;
    TestBed.inject(ApplicationRef).tick();
  }

  it('registers the packaged toolbar, tabs and context-menu descriptors', () => {
    const ids = (slot: string) => extensions.resolve(slot).map((entry) => entry.id);

    expect(ids(EXTENSION_SLOTS.toolbar)).toContain('app.toolbar.export');
    expect(ids(EXTENSION_SLOTS.tabs)).toEqual([
      'app.tabs.view',
      'app.tabs.annotations',
      'app.tabs.permissions',
      'app.tabs.history',
      'app.tabs.publishing',
    ]);
    expect(ids(EXTENSION_SLOTS.contextMenu)).toContain('app.contextMenu.share');
  });

  it('registers the packaged permissions panel under the ID the library exports', async () => {
    await loadManifest({});
    const components = TestBed.inject(ExtensionComponentRegistry);
    expect(components.has(NXS_PERMISSIONS_PANEL_ID)).toBe(true);
    expect(await components.resolve(NXS_PERMISSIONS_PANEL_ID)).toBe(NxsPermissionsPanelComponent);
  });

  it('merges manifest contributions into all four slots', async () => {
    await loadManifest({
      slots: {
        toolbar: [{ id: 'acme.toolbar.archive', label: 'Archive', icon: 'inventory_2', order: 5 }],
        tabs: [{ id: 'acme.tabs.claims', label: 'Claims', order: 15 }],
        contextMenu: [{ id: 'acme.contextMenu.escalate', label: 'Escalate', order: 5 }],
        routes: [{ id: 'acme.routes.reports', path: 'reports' }],
      },
    });

    const toolbar = extensions.resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.toolbar);
    const tabs = extensions.resolve<ExtensionTabDescriptor>(EXTENSION_SLOTS.tabs);
    const contextMenu = extensions.resolve<ExtensionActionDescriptor>(EXTENSION_SLOTS.contextMenu);
    const routes = extensions.resolve<ExtensionRouteDescriptor>(EXTENSION_SLOTS.routes);

    expect(toolbar[0].id).toBe('acme.toolbar.archive');
    expect(tabs[1].id).toBe('acme.tabs.claims');
    expect(contextMenu[0].id).toBe('acme.contextMenu.escalate');
    expect(routes.map((route) => route.id)).toEqual(['acme.routes.reports']);
  });

  /**
   * The load-bearing one, and the reason this file bootstraps the whole config
   * rather than calling the registry: `provideExtensionRoutes()` has to be part
   * of `provideAppExtensions()` for a manifest route to exist at runtime.
   *
   * Seen red on purpose by dropping `provideExtensionRoutes()` from the array
   * returned by `provideAppExtensions()`: `Expected undefined to be truthy` on
   * the `contributed` lookup below, with the shell's children unchanged.
   */
  it('adds a manifest route to the authenticated shell, inside its children', async () => {
    const router = TestBed.inject(Router);
    const shellBefore = router.config.find((route) => route.path === '');
    const countBefore = shellBefore?.children?.length ?? 0;

    await loadManifest({
      slots: { routes: [{ id: 'acme.routes.reports', path: 'reports' }] },
    });

    const shell = router.config.find((route) => route.path === '');
    const contributed = shell?.children?.find((child) => child.path === 'reports');

    expect(contributed).toBeTruthy();
    expect(contributed?.component).toBeTruthy();
    expect(contributed?.data?.['componentId']).toBe('acme.routes.reports');
    // Appended, so the shell's own `{ path: '', redirectTo: 'dashboard' }` still
    // matches first and no packaged path is shadowed.
    expect(shell?.children?.length).toBe(countBefore + 1);
    expect(shell?.children?.[0].redirectTo).toBe('dashboard');
  });

  it('does not register a route the manifest disables', async () => {
    const router = TestBed.inject(Router);

    await loadManifest({
      slots: { routes: [{ id: 'acme.routes.reports', path: 'reports', disabled: true }] },
    });

    const shell = router.config.find((route) => route.path === '');
    expect(shell?.children?.some((child) => child.path === 'reports')).toBe(false);
  });
});
