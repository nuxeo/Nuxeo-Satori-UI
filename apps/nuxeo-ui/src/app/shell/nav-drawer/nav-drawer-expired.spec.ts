import { drawerExpiredLabel } from './nav-drawer-expired';

describe('drawerExpiredLabel', () => {
  /**
   * The idiom `field-view.spec.ts` uses for the same rule: two instants on the same UTC day, one
   * at each end of it. Outside UTC, local formatting moves one of the two across a day boundary,
   * so the pair can only agree if the formatting is UTC.
   *
   * In UTC the two formattings are identical, so this case can only fail outside it. `nuxeo-ui`
   * runs under Karma rather than Vitest, so it has no `vite.config.mts` to pin the way
   * `satori-components`, `features/browse` and `shared/ui` do — the zone is pinned on the Nx
   * target instead (`apps/nuxeo-ui/project.json`, `test.options.env.TZ`), which reaches the
   * browser Karma launches.
   *
   * Watched failing on purpose, which is the only reason to believe any of that: with the `'UTC'`
   * argument removed and `TZ=UTC` on the shell, this case reports
   * `Expected 'Mar 7, 2024' to be 'Mar 6, 2024'` — so the target pin beats the shell, and the
   * case is protecting the call site rather than restating it.
   */
  it('shows the UTC calendar day, so both ends of that day read alike', () => {
    expect(drawerExpiredLabel('2024-03-06T00:00:00.000Z', 'en-US')).toBe('Mar 6, 2024');
    expect(drawerExpiredLabel('2024-03-06T23:59:00.000Z', 'en-US')).toBe('Mar 6, 2024');
  });

  it('shows nothing for an absent, empty or unparseable value', () => {
    expect(drawerExpiredLabel(undefined, 'en-US')).toBe('');
    expect(drawerExpiredLabel(null, 'en-US')).toBe('');
    expect(drawerExpiredLabel('', 'en-US')).toBe('');
    expect(drawerExpiredLabel('not a date', 'en-US')).toBe('');
    expect(drawerExpiredLabel(1709683200000, 'en-US')).toBe('');
  });

  // No locale case: this app registers `en-US` only, and `formatDate` throws NG0701 for any other.
  // Registering one here would assert Angular's locale data, not this function's zone handling.
});
