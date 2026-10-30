import { drawerExpiredLabel } from './nav-drawer-expired';

describe('drawerExpiredLabel', () => {
  /**
   * The idiom `field-view.spec.ts` uses for the same rule: two instants on the same UTC day, one
   * at each end of it. Outside UTC, local formatting moves one of the two across a day boundary,
   * so the pair can only agree if the formatting is UTC.
   *
   * **Stated limitation:** in UTC the two formattings are identical, so this case cannot fail
   * there, and `nuxeo-ui` has no time-zone pin to fix that — it runs under Karma
   * (`ng test --browsers=ChromeHeadless`), not Vitest, so there is no config hook of the kind
   * `satori-components`, `features/browse` and `shared/ui` use. Running `TZ=<any non-UTC zone> ng
   * test nuxeo-ui` does discriminate. The rule itself is pinned by the suites that can pin a zone;
   * this case guards the call site against losing its `'UTC'` argument.
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
