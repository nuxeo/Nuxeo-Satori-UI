import { LocationStrategy } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { type CanActivateFn, type Routes } from '@angular/router';

import { PANEL_SERVER } from './panel-server';

/** The application's own address for a route of its: where a link in the panel leads. */
export function applicationUrl(serverOrigin: string, route: string): string {
  return `${serverOrigin}/nuxeo/agentic-ui/#${route.startsWith('/') ? route : `/${route}`}`;
}

/**
 * Where a panel's router believes it is: nowhere on the page's own address, which it never reads or
 * changes. A link the layout engine draws, such as a linked record's, has the application's address
 * for its `href`, so it opens there in a new tab when the user asks for one.
 */
@Injectable()
export class PanelLocationStrategy extends LocationStrategy {
  private readonly server = inject(PANEL_SERVER);

  override path(): string {
    return '';
  }

  override prepareExternalUrl(internal: string): string {
    return applicationUrl(this.server.origin, internal);
  }

  override getState(): unknown {
    return null;
  }

  override pushState(): void {
    // The page's history is the page's.
  }

  override replaceState(): void {
    // The page's history is the page's.
  }

  override forward(): void {
    // The page's history is the page's.
  }

  override back(): void {
    // The page's history is the page's.
  }

  override onPopState(): void {
    // The page's history is the page's.
  }

  override getBaseHref(): string {
    return '';
  }
}

/**
 * Every navigation in a panel opens the record in the application, in a new tab with no opener,
 * and the panel stays as it is.
 */
export const openInApplication: CanActivateFn = (_route, state) => {
  const server = inject(PANEL_SERVER);
  window.open(applicationUrl(server.origin, state.url), '_blank', 'noopener,noreferrer');
  return false;
};

export const PANEL_ROUTES: Routes = [
  { path: '**', children: [], canActivate: [openInApplication] },
];
