/**
 * The app's home is served at `/home`, inside the shell, by the home engine's page
 * (docs/business-apps/app-definition-v2.md, section 10). Driven from the application's own routes,
 * so a route removed or pointed elsewhere in `app.routes.ts` fails here.
 */
import { reflectComponentType, type Type } from '@angular/core';

import { routes } from './app.routes';
import { authGuard } from './auth/auth.guards';

describe('the home route', () => {
  const shell = routes.find((route) => route.path === '' && route.children);
  const home = shell?.children?.find((route) => route.path === 'home');

  it("is a page of the shell, behind the shell's sign-in", () => {
    expect(shell?.canActivate).toContain(authGuard);
    expect(home).toBeDefined();
  });

  // By its selector: the engine is lazy-loaded, so this spec may not import it statically.
  it("loads the home engine's page", async () => {
    const component = (await home?.loadComponent?.()) as Type<unknown> | undefined;
    expect(component ? reflectComponentType(component)?.selector : null).toBe('lib-home-page');
  });

  it('is not the first page yet: the shell still opens the dashboard', () => {
    expect(shell?.children?.[0]).toEqual({ path: '', pathMatch: 'full', redirectTo: 'dashboard' });
  });
});
