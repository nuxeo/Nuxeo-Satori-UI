import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of } from 'rxjs';

import { CapturePageComponent } from './capture-page/capture-page';
import { captureRoutes, leaveCapture } from './lib.routes';

describe('captureRoutes', () => {
  it('draws the capture page at the root, asking before it is left', () => {
    expect(captureRoutes).toEqual([
      { path: '', component: CapturePageComponent, canDeactivate: [leaveCapture] },
    ]);
  });

  it('asks the page, but not on the way to the sign-in page', () => {
    const page = { leave: vi.fn(() => of(false)) };
    const to = (url: string) => ({ url }) as RouterStateSnapshot;
    const route = {} as ActivatedRouteSnapshot;
    const current = to('/capture');
    expect(leaveCapture(page, route, current, to('/login'))).toBe(true);
    expect(leaveCapture(page, route, current, to('/login?reason=idle'))).toBe(true);
    expect(page.leave).not.toHaveBeenCalled();
    leaveCapture(page, route, current, to('/home'));
    expect(page.leave).toHaveBeenCalledTimes(1);
  });
});
