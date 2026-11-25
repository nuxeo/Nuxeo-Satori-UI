import type { CanDeactivateFn, Routes } from '@angular/router';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';
import type { Observable } from 'rxjs';

import { LayoutDesignerPageComponent } from './layout-designer-page/layout-designer-page';
import { QueueDesignerPageComponent } from './queue-designer-page/queue-designer-page';

/** Where the app goes once it has signed the person out: Sign out, and the idle timeout. */
const SIGN_IN = '/login';

/** A designer page, which answers whether it may be left. */
export interface LeavablePage {
  leave(): Observable<boolean>;
}

/**
 * Leaving a designer page while a file is changed asks first; the page asks, and answers. Not on
 * the way to the sign-in page: by then the session has ended, and a refusal would keep a record on
 * screen for no one, the very thing the idle timeout signs out to stop.
 */
export const leaveLayoutDesigner: CanDeactivateFn<LeavablePage> = (
  page,
  _route,
  _current,
  next,
) => {
  const path = next.url.split(/[?#]/, 1)[0] ?? '';
  return path === SIGN_IN || path.startsWith(`${SIGN_IN}/`) || page.leave();
};

/**
 * The layout designer, for administrators only: its layout files at the feature's root, and its
 * queues at `queues`. The app mounts it under its administrator gate, which lets administrators
 * and power users in; these routes let administrators alone. Neither is a security control: the
 * designer writes nothing to the server, and the server's permissions decide what anyone may read
 * or change.
 */
export const layoutDesignerRoutes: Routes = [
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
];
