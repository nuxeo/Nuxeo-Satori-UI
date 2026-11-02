import { Routes } from '@angular/router';

import { adminGuard } from './auth/admin.guard';
import { authGuard, loginGuard } from './auth/auth.guards';
import { ContractsPageComponent } from './features/contracts/contracts-page.component';
import { RETIRED_ROUTES } from './retired-routes';
import { themingGuard } from './theme/theming.guard';

const placeholder = () =>
  import('./placeholder-page.component').then((m) => m.PlaceholderPageComponent);

const notFound = () => import('./not-found-page.component').then((m) => m.NotFoundPageComponent);

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login-page.component').then((m) => m.LoginPageComponent),
    canActivate: [loginGuard],
  },
  {
    path: '',
    loadComponent: () => import('./shell/app-shell.component').then((m) => m.AppShellComponent),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent),
      },
      ...RETIRED_ROUTES,
      {
        path: 'browse',
        loadChildren: () => import('@agentic-ui/feature-browse').then((m) => m.browseRoutes),
      },
      {
        path: 'contracts',
        component: ContractsPageComponent,
        canActivate: [authGuard],
      },
      {
        path: 'recently-viewed',
        loadComponent: placeholder,
      },
      {
        path: 'search',
        loadChildren: () => import('@agentic-ui/feature-search').then((m) => m.searchRoutes),
      },
      {
        path: 'knowledge-discovery',
        loadChildren: () =>
          import('@agentic-ui/feature-knowledge-discovery').then((m) => m.knowledgeDiscoveryRoutes),
      },
      {
        path: 'expired-queue',
        loadComponent: placeholder,
      },
      // `/doc` with no document id — a link copied or truncated without it. The `**` below
      // cannot catch this: `path: 'doc'` matches the segment, leaving nothing for the feature's
      // only child (`:uid`) to match, and a parent that matched with no child to activate is a
      // successful navigation with an empty outlet rather than a no-match the router can fall
      // through. Measured: the header and the nav rail, and no page.
      //
      // `pathMatch: 'full'` is what keeps this off `/doc/:uid`, which is declared next and is
      // reached whenever there is an id. `/doc/a/b` needs nothing here — a leftover segment
      // _is_ a no-match, so it already falls through to `**`.
      { path: 'doc', pathMatch: 'full', loadComponent: notFound },
      {
        path: 'doc',
        loadChildren: () =>
          import('@agentic-ui/feature-document-detail').then((m) => m.documentDetailRoutes),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('@agentic-ui/feature-assets/asset-search-results').then(
            (m) => m.AssetSearchResultsComponent,
          ),
      },
      {
        path: 'tasks',
        loadChildren: () => import('@agentic-ui/feature-tasks').then((m) => m.tasksRoutes),
      },
      {
        path: 'favorites',
        loadComponent: placeholder,
      },
      {
        path: 'collections',
        loadChildren: () =>
          import('@agentic-ui/feature-collections').then((m) => m.collectionsRoutes),
      },
      {
        path: 'personal-space',
        loadComponent: () =>
          import('./personal-space/personal-space-page.component').then(
            (m) => m.PersonalSpacePageComponent,
          ),
      },
      {
        path: 'clipboard',
        loadComponent: placeholder,
      },
      {
        path: 'trash',
        loadChildren: () => import('@agentic-ui/feature-trash').then((m) => m.trashRoutes),
      },
      {
        path: 'administration',
        canActivate: [adminGuard],
        loadChildren: () =>
          import('@agentic-ui/feature-administration').then((m) => m.administrationRoutes),
      },
      {
        path: 'settings/nuxeo-drive',
        loadComponent: () =>
          import('./settings/nuxeo-drive/nuxeo-drive-page.component').then(
            (m) => m.NuxeoDrivePageComponent,
          ),
      },
      {
        path: 'settings/profile',
        loadComponent: () =>
          import('./settings/profile/profile-page.component').then((m) => m.ProfilePageComponent),
      },
      {
        path: 'settings/authorized-applications',
        loadComponent: () =>
          import('./settings/authorized-applications/authorized-applications-page.component').then(
            (m) => m.AuthorizedApplicationsPageComponent,
          ),
      },
      {
        path: 'settings/cloud-services',
        loadComponent: () =>
          import('./settings/cloud-services/cloud-services-page.component').then(
            (m) => m.CloudServicesPageComponent,
          ),
      },
      {
        path: 'settings/themes',
        canActivate: [themingGuard],
        loadComponent: () =>
          import('./settings/themes/themes-page.component').then((m) => m.ThemesPageComponent),
      },
      // Last, and inside the shell on purpose: an unmatched path keeps the navigation and the
      // header, so there is a way out. Without this route the router raised a navigation error and
      // left a blank page — measured at under 120 characters of text — for any stale bookmark.
      //
      // It cannot shadow a feature route: Angular matches in order and every path above is
      // declared before it. `/browse/**` is handled inside the browse feature's own routes, so
      // this never swallows a folder path.
      //
      // It is not, however, a catch-all for every address that identifies no page. A `**` is
      // only reached on a **no-match**, and a path whose parent route matched is not one: the
      // navigation succeeds with an empty outlet instead. `/doc` above is that case, and any
      // future route whose children cannot match an empty remainder needs the same treatment.
      { path: '**', loadComponent: notFound },
    ],
  },
];
