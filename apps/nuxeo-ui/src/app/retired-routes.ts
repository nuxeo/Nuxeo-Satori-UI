import { inject } from '@angular/core';
import { Router, type Route } from '@angular/router';
import { toBrowseRouterUrl } from '@nuxeo-satori/platform/nuxeo-client';

/**
 * The adf-hx proof of concept's two routes, retired. Bookmarks and shared links to them still
 * arrive, and the router has no wildcard route, so an unmatched path is a navigation error rather
 * than a fallback page. Each redirects to the page that replaced it, with its query string intact.
 *
 * `/browse-adf-hx` named its folder in `?path=`, and `/browse` reads the folder from its path, so
 * keeping the query alone would open the repository root. The folder is therefore also moved into
 * the path: `/browse-adf-hx?path=%2Fa%2Fb` opens `/browse/a/b?path=%2Fa%2Fb`. `/search-adf-hx`
 * read no parameter of its own.
 */
export const RETIRED_ROUTES: Route[] = [
  {
    path: 'browse-adf-hx',
    pathMatch: 'full',
    redirectTo: ({ queryParams, fragment }) => {
      const folder = queryParams['path'];
      const target = inject(Router).parseUrl(
        toBrowseRouterUrl(typeof folder === 'string' ? folder : '/'),
      );
      target.queryParams = { ...queryParams };
      target.fragment = fragment;
      return target;
    },
  },
  { path: 'search-adf-hx', pathMatch: 'full', redirectTo: 'search' },
];
