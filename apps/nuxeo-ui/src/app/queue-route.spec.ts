/**
 * An app's queues are served at `/queues/<id>`, inside the shell, by the queue engine's page
 * (docs/business-apps/app-definition-v2.md, section 4). Driven from the application's own routes,
 * so a route removed or pointed elsewhere in `app.routes.ts` fails here.
 */
import { reflectComponentType, type Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';

import { routes } from './app.routes';
import { authGuard } from './auth/auth.guards';

describe('the queue route', () => {
  const shell = routes.find((route) => route.path === '' && route.children);
  const queues = shell?.children?.filter((route) => route.path === 'queues') ?? [];

  it("is a page of the shell, behind the shell's sign-in", () => {
    expect(shell?.canActivate).toContain(authGuard);
    expect(queues.some((route) => route.loadChildren)).toBe(true);
  });

  // By its selector: the engine is lazy-loaded, so this spec may not import it statically.
  it("loads the queue engine's page for /queues/<id>, the id as the page's input", async () => {
    const children = (await queues.find((route) => route.loadChildren)?.loadChildren?.()) as
      Routes | undefined;
    const page = children?.find((route) => route.path === ':id');
    const component = page?.component as Type<unknown> | undefined;
    const mirror = component ? reflectComponentType(component) : null;
    expect(mirror?.selector).toBe('lib-queue-page');
    // `withComponentInputBinding()` hands the `:id` parameter to the input of the same name.
    expect(mirror?.inputs.map((input) => input.propName)).toContain('id');
  });

  it('answers /queues with no id with the not-found page, not an empty outlet', async () => {
    const bare = queues.find((route) => route.pathMatch === 'full');
    // Declared first, so the router reaches it before the lazy children it would match nothing in.
    expect(bare).toBeDefined();
    expect(queues.indexOf(bare as Route)).toBe(0);
    const component = (await bare?.loadComponent?.()) as Type<unknown> | undefined;
    expect(component ? reflectComponentType(component)?.selector : null).toBe(
      reflectComponentType(
        (await import('./not-found-page.component')).NotFoundPageComponent as Type<unknown>,
      )?.selector,
    );
  });
});
