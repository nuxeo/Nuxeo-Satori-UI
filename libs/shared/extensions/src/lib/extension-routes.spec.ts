import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import { AppExtensionsService } from './app-extensions.service';
import { extensionRoutes, provideExtensionRoutes } from './extension-routes';
import { provideSatoriExtensions } from './provide-satori-extensions';

@Component({ standalone: true, selector: 'lib-test-home', template: 'PACKAGED HOME' })
class HomeComponent {}

@Component({
  standalone: true,
  selector: 'lib-test-shell',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class ShellComponent {}

@Component({
  standalone: true,
  selector: 'lib-test-reports',
  template: '<p class="reports">CONTRIBUTED REPORTS PAGE</p>',
})
class ReportsComponent {}

/**
 * A manifest with one `routes` entry, fed the way the product feeds one.
 *
 * `AppExtensionsService` reads `AppConfigService.manifest().extensionLayers`, so
 * standing in a manifest here exercises the real merge path rather than calling
 * `ExtensionSlotRegistry.register()` directly — which is what a customer cannot
 * do and therefore what this test must not do either.
 */
function provideManifest(extensions: unknown) {
  return {
    provide: AppConfigService,
    useValue: { manifest: signal({ extensionLayers: [extensions] }) },
  };
}

describe('provideExtensionRoutes', () => {
  /**
   * The claim: a route that exists only in the manifest resolves to a registered
   * component and that component's markup is in the document.
   *
   * Seen red on purpose by removing `provideExtensionRoutes()` from the
   * providers: `navigateByUrl('/reports')` then rejected with
   * `NG04002: Cannot match any routes. URL Segment: 'reports'`, which is exactly
   * the state the four reserved slots were in before this change.
   */
  it('renders a component named only by the manifest at a path only the manifest declares', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: '',
              component: ShellComponent,
              children: [{ path: '', component: HomeComponent }],
            },
          ],
          withComponentInputBinding(),
        ),
        provideManifest({
          slots: {
            routes: [
              {
                id: 'acme.routes.reports',
                path: 'reports',
                componentId: 'acme.components.reports',
              },
            ],
          },
        }),
        provideSatoriExtensions({ components: { 'acme.components.reports': ReportsComponent } }),
        provideExtensionRoutes(),
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/reports');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.ownerDocument.body.textContent).toContain(
      'CONTRIBUTED REPORTS PAGE',
    );
  });

  /**
   * The negative half. An entry the manifest marks `disabled` must not produce a
   * route at all — otherwise `disabled` would be cosmetic, and the assertion
   * above would pass for any manifest whatsoever.
   */
  it('does not register a disabled entry', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: '',
              component: ShellComponent,
              children: [{ path: '', component: HomeComponent }],
            },
          ],
          withComponentInputBinding(),
        ),
        provideManifest({
          slots: {
            routes: [
              {
                id: 'acme.routes.reports',
                path: 'reports',
                componentId: 'acme.components.reports',
                disabled: true,
              },
            ],
          },
        }),
        provideSatoriExtensions({ components: { 'acme.components.reports': ReportsComponent } }),
        provideExtensionRoutes(),
      ],
    });

    const harness = await RouterTestingHarness.create();

    await expect(harness.navigateByUrl('/reports')).rejects.toThrow(/Cannot match any routes/);
  });

  /**
   * The packaged config must survive the merge. `resetConfig` replaces the whole
   * router configuration, so a contribution that dropped the application's own
   * routes would still pass the first test.
   */
  it('leaves the application routes intact', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: '',
              component: ShellComponent,
              children: [{ path: '', component: HomeComponent }],
            },
          ],
          withComponentInputBinding(),
        ),
        provideManifest({
          slots: {
            routes: [
              {
                id: 'acme.routes.reports',
                path: 'reports',
                componentId: 'acme.components.reports',
              },
            ],
          },
        }),
        provideSatoriExtensions({ components: { 'acme.components.reports': ReportsComponent } }),
        provideExtensionRoutes(),
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    harness.detectChanges();

    expect(harness.routeNativeElement?.ownerDocument.body.textContent).toContain('PACKAGED HOME');
  });
});

/**
 * `Router.resetConfig` runs `validateConfig` only under `ngDevMode`, and one of its
 * rules is `path cannot start with a slash`. A manifest writing `"path": "/reports"`
 * therefore threw a `RuntimeError` out of the registration effect in development, and
 * in a production build was accepted as a route that can never match — neither of
 * which is the tolerant-manifest behaviour every other config loader promises.
 */
describe('extension route path validation', () => {
  const REJECTED: readonly unknown[] = ['/reports', '', 'reports?tab=1', 'reports#top', 'a b', 7];

  it.each(REJECTED)('drops a descriptor whose path is %o', (path) => {
    expect(
      extensionRoutes([{ id: 'acme.routes.bad', path } as { id: string; path: string }]),
    ).toEqual([]);
  });

  it('keeps the paths Angular can actually match', () => {
    const routes = extensionRoutes([
      { id: 'acme.routes.reports', path: 'reports' },
      { id: 'acme.routes.report', path: 'reports/:id' },
    ]);

    expect(routes.map((route) => route.path)).toEqual(['reports', 'reports/:id']);
  });

  /**
   * The load-bearing half. Before the validation, `resetConfig` threw on the invalid
   * entry and *nothing* in the batch registered, so one typo in a manifest took the
   * customer's working routes down with it.
   */
  it('registers a valid sibling of an invalid entry', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: '',
              component: ShellComponent,
              children: [{ path: '', component: HomeComponent }],
            },
          ],
          withComponentInputBinding(),
        ),
        provideManifest({
          slots: {
            routes: [
              { id: 'acme.routes.bad', path: '/reports' },
              {
                id: 'acme.routes.reports',
                path: 'reports',
                componentId: 'acme.components.reports',
              },
            ],
          },
        }),
        provideSatoriExtensions({ components: { 'acme.components.reports': ReportsComponent } }),
        provideExtensionRoutes(),
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/reports');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(harness.routeNativeElement?.ownerDocument.body.textContent).toContain(
      'CONTRIBUTED REPORTS PAGE',
    );
  });

  /**
   * Dropping the entry silently would be its own failure: the customer would see a
   * route that does nothing and no way to find out why. Reported on the same service
   * and in the same shape as `missingLayers`.
   */
  it('reports the rejected entry on AppExtensionsService', () => {
    TestBed.configureTestingModule({
      providers: [
        provideManifest({
          slots: {
            routes: [
              { id: 'acme.routes.bad', path: '/reports' },
              { id: 'acme.routes.reports', path: 'reports' },
            ],
          },
        }),
        provideSatoriExtensions({}),
      ],
    });

    const invalid = TestBed.inject(AppExtensionsService).invalidRoutes();

    expect(invalid.map((entry) => entry.id)).toEqual(['acme.routes.bad']);
    expect(invalid[0].reason).toContain('/reports');
  });
});
