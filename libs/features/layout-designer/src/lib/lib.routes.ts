import type { CanDeactivateFn, Routes } from '@angular/router';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';

import { LayoutDesignerPageComponent } from './layout-designer-page/layout-designer-page';

/** Where the app goes once it has signed the person out: Sign out, and the idle timeout. */
const SIGN_IN = '/login';

/**
 * Leaving the designer while a file is changed asks first; the page asks, and answers. Not on the
 * way to the sign-in page: by then the session has ended, and a refusal would keep a record on
 * screen for no one, the very thing the idle timeout signs out to stop.
 */
export const leaveLayoutDesigner: CanDeactivateFn<Pick<LayoutDesignerPageComponent, 'leave'>> = (
  page,
  _route,
  _current,
  next,
) => {
  const path = next.url.split(/[?#]/, 1)[0] ?? '';
  return path === SIGN_IN || path.startsWith(`${SIGN_IN}/`) || page.leave();
};

/**
 * The layout designer, for administrators only. The app mounts it under its administrator gate,
 * which lets administrators and power users in; this route lets administrators alone. Neither is a
 * security control: the designer writes nothing to the server, and the server's permissions decide
 * what anyone may read or change.
 */
export const layoutDesignerRoutes: Routes = [
  {
    path: '',
    component: LayoutDesignerPageComponent,
    canActivate: [fullAdministratorGuard],
    canDeactivate: [leaveLayoutDesigner],
  },
];
