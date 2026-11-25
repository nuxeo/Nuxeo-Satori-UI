/**
 * The layout designer is a page of the shell, at `/administration/layout-designer`, behind the
 * administrator gate, and its own route lets administrators alone in
 * (docs/business-apps/development-plan.md, phase 6). Driven from the application's own routes and
 * menus, so a guard dropped or swapped, or the entry offered to power users, fails here. None of
 * it is a security control: the designer writes nothing to the server.
 */
import { reflectComponentType, type Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';

import { routes } from './app.routes';
import { adminGuard } from './auth/admin.guard';
import { authGuard } from './auth/auth.guards';
import {
  ADMINISTRATION_DRAWER_ITEMS,
  LAYOUT_DESIGNER_PATH,
  POWERUSER_ADMINISTRATION_DRAWER_ITEMS,
} from './platform-nav-items';

describe('the layout designer route', () => {
  const shell = routes.find((route) => route.path === '' && route.children);
  const children = shell?.children ?? [];
  const designer = children.find((route) => route.path === 'administration/layout-designer');

  /** One of the designer's own routes, as the router loads it: its layout files', or its queues'. */
  async function page(path = ''): Promise<Route | undefined> {
    const loaded = (await designer?.loadChildren?.()) as Routes | undefined;
    return loaded?.find((route) => route.path === path);
  }

  it("is a page of the shell, behind the shell's sign-in and the administrator gate", () => {
    expect(shell?.canActivate).toContain(authGuard);
    expect(designer?.canActivate).toEqual([adminGuard]);
  });

  it('is declared before the administration feature, which would otherwise be matched first', () => {
    const at = children.indexOf(designer as Route);
    const administration = children.findIndex((route) => route.path === 'administration');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(administration);
  });

  // By its selector: the feature is lazy-loaded, so this spec may not import it statically.
  it("loads the designer's page, for administrators alone", async () => {
    const route = await page();
    const component = route?.component as Type<unknown> | undefined;
    expect(component ? reflectComponentType(component)?.selector : null).toBe(
      'lib-layout-designer-page',
    );
    expect(route?.canActivate).toEqual([fullAdministratorGuard]);
  });

  it("loads the designer's queues at queues, for administrators alone", async () => {
    const route = await page('queues');
    const component = route?.component as Type<unknown> | undefined;
    expect(component ? reflectComponentType(component)?.selector : null).toBe(
      'lib-queue-designer-page',
    );
    expect(route?.canActivate).toEqual([fullAdministratorGuard]);
  });

  it("is in the administrators' menu, and not in the power users'", () => {
    expect(LAYOUT_DESIGNER_PATH).toBe('/administration/layout-designer');
    expect(ADMINISTRATION_DRAWER_ITEMS.map((item) => item.path)).toContain(LAYOUT_DESIGNER_PATH);
    expect(POWERUSER_ADMINISTRATION_DRAWER_ITEMS.map((item) => item.path)).not.toContain(
      LAYOUT_DESIGNER_PATH,
    );
  });
});
