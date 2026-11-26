import type { CanDeactivateFn, Routes } from '@angular/router';

import { CapturePageComponent, type LeavableCapture } from './capture-page/capture-page';

/** Where the app goes once it has signed the person out: Sign out, and the idle timeout. */
const SIGN_IN = '/login';

/**
 * Leaving the capture page with photos not filed asks first, and the page asks. Not on the way to
 * the sign-in page: by then the session has ended, and the photos cannot be filed anyway.
 */
export const leaveCapture: CanDeactivateFn<LeavableCapture> = (page, _route, _current, next) => {
  const path = next.url.split(/[?#]/, 1)[0] ?? '';
  return path === SIGN_IN || path.startsWith(`${SIGN_IN}/`) || page.leave();
};

/**
 * The capture page, for anyone signed in: the app mounts it inside its shell, behind its sign-in
 * guard. Who may file a photo on a record is the server's to decide, on every upload.
 */
export const captureRoutes: Routes = [
  {
    path: '',
    component: CapturePageComponent,
    canDeactivate: [leaveCapture],
  },
];
