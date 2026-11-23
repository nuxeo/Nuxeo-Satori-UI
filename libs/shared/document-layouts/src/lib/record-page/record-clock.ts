import { InjectionToken } from '@angular/core';

/**
 * What the record page and its lists read the time from: today, and the zone an instant is shown
 * in. Tokens, so that a test chooses both.
 */

/** Today, for computations and relative dates. A token, so that tests choose the day. */
export const RECORD_PAGE_TODAY = new InjectionToken<() => Date>('RECORD_PAGE_TODAY', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

/**
 * The zone an instant is shown in: `undefined`, the reader's own. A token, so that a test chooses
 * an offset such as `+0530`. In whatever zone the suite happens to run, UTC on CI, an instant read
 * in the wrong zone can still show the right day, and the test would prove nothing
 * (AGENTS/08-bug-patterns.md, pattern 29).
 */
export const RECORD_PAGE_TIME_ZONE = new InjectionToken<string | undefined>(
  'RECORD_PAGE_TIME_ZONE',
  { providedIn: 'root', factory: () => undefined },
);
