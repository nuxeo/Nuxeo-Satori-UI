/**
 * The app's home is served at `/home`, inside the shell, by the home engine's page
 * (docs/business-apps/app-definition-v2.md, section 10), and its links to queues open the queue
 * page. Driven from the application's own routes, so a route removed or pointed elsewhere in
 * `app.routes.ts` fails here.
 */
import { reflectComponentType, type Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';

import { routes } from './app.routes';
import { authGuard } from './auth/auth.guards';

describe('the home route', () => {
  const shell = routes.find((route) => route.path === '' && route.children);
  const home = shell?.children?.find((route) => route.path === 'home');

  /** The home's own route, as the router loads it. */
  async function page(): Promise<Route | undefined> {
    const children = (await home?.loadChildren?.()) as Routes | undefined;
    return children?.find((route) => route.path === '');
  }

  it("is a page of the shell, behind the shell's sign-in", () => {
    expect(shell?.canActivate).toContain(authGuard);
    expect(home).toBeDefined();
  });

  // By its selector: the engine is lazy-loaded, so this spec may not import it statically.
  it("loads the home engine's page", async () => {
    const component = (await page())?.component as Type<unknown> | undefined;
    expect(component ? reflectComponentType(component)?.selector : null).toBe('lib-home-page');
  });

  it('links each queue to its page, /queues/<id>', async () => {
    const route = await page();
    // The token is the home engine's, which this spec may not import, so it is named by its
    // description: `InjectionToken HOME_QUEUE_LINK`.
    const [provider] = (route?.providers ?? []) as { provide: unknown; useValue: unknown }[];
    expect(String(provider?.provide)).toBe('InjectionToken HOME_QUEUE_LINK');
    const link = provider?.useValue as (queue: string) => readonly unknown[];
    expect(link('unassigned-claims')).toEqual(['/queues', 'unassigned-claims']);
  });

  it('is not the first page yet: the shell still opens the dashboard', () => {
    expect(shell?.children?.[0]).toEqual({ path: '', pathMatch: 'full', redirectTo: 'dashboard' });
  });
});
