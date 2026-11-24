import type { Routes } from '@angular/router';

import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';

/**
 * Routes the template ships with.
 *
 * A plain array, because **routing is not one of the four layers** — a fork owns
 * its route table.
 *
 * The `routes` slot does resolve, in a host that wires it:
 * `docs/extension-reference.md` lists it as "Resolves", and the product
 * application gets that by calling `provideExtensionRoutes()`
 * (`apps/nuxeo-ui/src/app/extensions/provide-app-extensions.ts:256`). What a
 * *library* cannot do is contribute a route on its own — the host has to opt in.
 *
 * This template deliberately does not opt in. Its `app.config.ts` provides no
 * `provideExtensionRoutes()`, so a manifest route contributed to this application
 * resolves nothing and the table below is the whole of its routing. Add the
 * provider if you want a fork whose routes a manifest can extend.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'documents' },
  {
    /**
     * The repository browser.
     *
     * The folder is a **query parameter**, not a path segment, and that is a
     * deliberate difference from the product's `/browse/:path` shape: a Nuxeo path
     * contains slashes and spaces, and `?path=/default-domain/workspaces/acme` is
     * readable in a URL bar while a doubly-encoded segment is not. Bound to the
     * component's `path` input by `withComponentInputBinding()`.
     */
    path: 'documents',
    loadComponent: () => import('./pages/documents/documents').then((m) => m.DocumentsComponent),
  },
  {
    path: 'documents/:uid',
    loadComponent: () =>
      import('./pages/documents/document-detail').then((m) => m.DocumentDetailComponent),
  },
  {
    path: 'search',
    loadComponent: () => import('./pages/search/search').then((m) => m.SearchComponent),
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent),
  },
  {
    path: 'components',
    loadComponent: () =>
      import('./pages/components/components').then((m) => m.ComponentsShowcaseComponent),
  },
  {
    /**
     * The ECM working surface: search, metadata, preview and actions on one page.
     * Lazily loaded, so its chunk is only fetched when someone navigates here.
     */
    path: 'case-file',
    loadComponent: () => import('./pages/case-file/case-file').then((m) => m.CaseFileComponent),
  },
  {
    path: 'stats',
    loadComponent: () => import('./pages/stats/stats').then((m) => m.StatsComponent),
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./pages/reports/reports-panel').then((m) => m.ReportsPanelComponent),
  },
  {
    /**
     * A route for a component the host cannot import.
     *
     * `libs/extensions/acme-extensions` exports only its provider and its ID list —
     * deliberately, so a host cannot depend on a class name that should be free to
     * change. So the host maps the *path* and `ExtensionOutletComponent` resolves
     * the *component* from the registry by ID, honouring the lazy loader the
     * library registered.
     *
     * `data` reaches the `componentId` input because the template bootstraps with
     * `withComponentInputBinding()`, which binds route data to component inputs.
     *
     * This route exists because the generated library's navbar entry pointed at
     * `/acme-extensions` and **nothing routed there** — it fell through the
     * wildcard back to `/home`. A nav entry that goes nowhere is precisely the
     * "descriptors nothing renders" failure, and the Phase 4 evidence now asserts
     * this path renders the panel.
     */
    path: 'acme-extensions',
    component: ExtensionOutletComponent,
    data: { componentId: 'acme.panel.acmeExtensions' },
  },
  { path: '**', redirectTo: 'documents' },
];
