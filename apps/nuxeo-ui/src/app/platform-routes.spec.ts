/**
 * `PLATFORM_ROUTES` in `libs/shared/app-definition` is the one list of the platform's own routes,
 * which the validator refuses as an app's address: an app with the id `contracts` and no address
 * would take `/contracts`, the component showcase. The list is the validator's, which cannot read
 * this application, so this holds it to the application's own routes, both ways: a page added in
 * `app.routes.ts` that the list lacks, or a name the list keeps once the page is gone, fails here.
 *
 * Each route's first segment is what an address would take: `settings/profile` reserves
 * `settings`. The shell's own `''` and its catch-all `**` are no address.
 */
import { PLATFORM_ROUTES } from '@agentic-ui/shared/app-definition';
import type { Route } from '@angular/router';

import { routes } from './app.routes';

function firstSegments(list: readonly Route[]): string[] {
  return list.flatMap((route) => {
    const path = route.path ?? '';
    if (path === '') return firstSegments(route.children ?? []);
    if (path === '**') return [];
    return [path.split('/')[0]];
  });
}

describe("the platform's routes, which no app may take as its address", () => {
  const served = [...new Set(firstSegments(routes))].sort();

  it('finds the pages the application serves', () => {
    // A guard on the walk itself: one that found nothing would make both checks below pass.
    expect(served).toContain('contracts');
    expect(served).toContain('login');
    expect(served).toContain('settings');
    expect(served.length).toBeGreaterThan(15);
  });

  it('lists every first segment app.routes.ts serves a page at', () => {
    expect(served.filter((segment) => !PLATFORM_ROUTES.includes(segment))).toEqual([]);
  });

  it('lists nothing app.routes.ts no longer serves', () => {
    expect(PLATFORM_ROUTES.filter((segment) => !served.includes(segment))).toEqual([]);
  });
});
