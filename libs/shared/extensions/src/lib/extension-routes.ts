import {
  type EnvironmentProviders,
  effect,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { Router, type Route, type Routes } from '@angular/router';

import { AppExtensionsService } from './app-extensions.service';
import type { ExtensionRouteDescriptor } from './extension-actions';
import { ExtensionOutletComponent } from './extension-outlet.component';
import { partitionExtensionRouteDescriptors } from './extension-route-paths';
import { EXTENSION_SLOTS } from './extension-slots';

/**
 * Marks a route this file put into the config, so a re-resolve replaces its own
 * contributions and leaves the application's own routes alone.
 */
const EXTENSION_ROUTE_MARKER = 'satoriExtensionRoute';

/**
 * Turn route descriptors into `Routes` answered by {@link ExtensionOutletComponent}.
 *
 * Exported because it is the whole of the mapping and a caller that builds its
 * own router config statically may want it without the live re-registration
 * below.
 *
 * The component is named by id and resolved from `ExtensionComponentRegistry`,
 * which is what keeps this Layer 1: a manifest places a component that is
 * already compiled in, and contributing a new one is Layer 2.
 *
 * A descriptor whose `path` the router would refuse is dropped here rather than
 * handed to `resetConfig`, which validates only under `ngDevMode` and would
 * otherwise reject the **whole batch** — one typo taking down a customer's working
 * routes with it. What was dropped is on `AppExtensionsService.invalidRoutes`.
 */
export function extensionRoutes(descriptors: readonly ExtensionRouteDescriptor[]): Routes {
  return partitionExtensionRouteDescriptors(descriptors).accepted.map((descriptor) => ({
    path: descriptor.path,
    component: ExtensionOutletComponent,
    data: {
      [EXTENSION_ROUTE_MARKER]: true,
      componentId: descriptor.componentId ?? descriptor.id,
      componentInputs: descriptor.inputs ?? {},
    },
  }));
}

export interface ExtensionRoutesOptions {
  /**
   * Path of the top-level route whose `children` the contributions join.
   *
   * Defaults to `''`, which is the authenticated shell in this application.
   * A contributed route therefore renders inside the shell — with the navigation
   * drawer and the header — rather than replacing it, which is what a customer
   * adding a page expects. If no top-level route has that path, contributions
   * are appended at the top level instead.
   */
  readonly parentPath?: string;
}

/**
 * Register the manifest's `routes` slot with the router, and keep it current.
 *
 * ## Why this is an effect rather than a one-shot
 *
 * The manifest is fetched by `AppConfigService.load()` in an `APP_INITIALIZER`,
 * which nothing guarantees has settled when `provideRouter()` builds the config,
 * so there may be nothing to contribute yet. Re-resolving on the manifest signal
 * is what makes a manifest-declared route exist as soon as the manifest lands,
 * rather than only on the next full page load.
 *
 * ## What it deliberately does not do
 *
 * Descriptors are resolved against an **empty rule context**. A `rule` on a
 * route would otherwise be evaluated once, at registration, against whatever
 * happened to be in focus then — an answer that would look like authorisation
 * and be nothing of the kind. Use `disabled`, or a `visible: false` override, to
 * withdraw a route.
 *
 * A route contributed here carries **no guard**, and adding one from a manifest
 * is not offered. Nuxeo evaluates permissions server-side; a page reachable by
 * URL is not a page whose data the user may read.
 *
 * The registration is late by construction, so a deep link typed before the
 * manifest has loaded does not match. The route works from the moment the
 * manifest arrives; it is not a substitute for a compiled-in route.
 */
export function provideExtensionRoutes(options: ExtensionRoutesOptions = {}): EnvironmentProviders {
  const parentPath = options.parentPath ?? '';
  return provideEnvironmentInitializer(() => {
    const router = inject(Router);
    const extensions = inject(AppExtensionsService);

    effect(() => {
      const descriptors = extensions.resolve<ExtensionRouteDescriptor>(EXTENSION_SLOTS.routes);
      applyExtensionRoutes(router, parentPath, extensionRoutes(descriptors));
    });
  });
}

function isExtensionRoute(route: Route): boolean {
  return route.data?.[EXTENSION_ROUTE_MARKER] === true;
}

function applyExtensionRoutes(router: Router, parentPath: string, contributed: Routes): void {
  const host = router.config.find(
    (route) => route.path === parentPath && Array.isArray(route.children),
  );

  if (!host) {
    router.resetConfig([...router.config.filter((r) => !isExtensionRoute(r)), ...contributed]);
    return;
  }

  router.resetConfig(
    router.config.map((route) =>
      route === host
        ? {
            ...route,
            // Appended, never prepended: the shell's own `{ path: '', redirectTo }`
            // must keep matching first, and a contributed path must not shadow a
            // packaged one.
            children: [
              ...(route.children ?? []).filter((c) => !isExtensionRoute(c)),
              ...contributed,
            ],
          }
        : route,
    ),
  );
}
