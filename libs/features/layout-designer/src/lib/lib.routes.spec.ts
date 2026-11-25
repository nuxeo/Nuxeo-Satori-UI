import type { RouterStateSnapshot } from '@angular/router';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';

import { LayoutDesignerPageComponent } from './layout-designer-page/layout-designer-page';
import { QueueDesignerPageComponent } from './queue-designer-page/queue-designer-page';
import { layoutDesignerRoutes, leaveLayoutDesigner } from './lib.routes';

describe('layoutDesignerRoutes', () => {
  // By identity, not by count: a guard swapped for any other function would pass a length check,
  // and on an administrators-only page that is the regression this exists to catch.
  it('opens its layout files and its queues for administrators alone, and asks before either is left', () => {
    expect(layoutDesignerRoutes).toEqual([
      {
        path: '',
        component: LayoutDesignerPageComponent,
        canActivate: [fullAdministratorGuard],
        canDeactivate: [leaveLayoutDesigner],
      },
      {
        path: 'queues',
        component: QueueDesignerPageComponent,
        canActivate: [fullAdministratorGuard],
        canDeactivate: [leaveLayoutDesigner],
      },
    ]);
  });

  describe('leaveLayoutDesigner', () => {
    const route = {} as Parameters<typeof leaveLayoutDesigner>[1];
    const at = (url: string) => ({ url }) as RouterStateSnapshot;
    const here = at('/administration/layout-designer');

    it('leaves as the page answers, for any other page', () => {
      const answer = of(false);
      const page = { leave: vi.fn(() => answer) };
      expect(leaveLayoutDesigner(page, route, here, at('/browse/default-domain'))).toBe(answer);
      expect(leaveLayoutDesigner(page, route, here, at('/login-help'))).toBe(answer);
      expect(page.leave).toHaveBeenCalledTimes(2);
    });

    // Sign out and the idle timeout end the session, then open the sign-in page: asking then
    // would keep the record on screen for no one.
    it('leaves for the sign-in page without asking', () => {
      const page = { leave: vi.fn(() => of(false)) };
      expect(leaveLayoutDesigner(page, route, here, at('/login'))).toBe(true);
      expect(leaveLayoutDesigner(page, route, here, at('/login?expired=1'))).toBe(true);
      expect(page.leave).not.toHaveBeenCalled();
    });
  });
});
