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

/**
 * How long, in milliseconds, after a timeline first asks the audit, or after the record changes,
 * it asks once more; `null`, never. Nuxeo writes its audit through a stream into the search index,
 * and an entry was readable 0.8 to 1.4 seconds after the edit that wrote it (measured on Nuxeo
 * 2025), so the first answer after a change usually lacks it. A token, so that a test need not
 * wait, and a host whose audit is written at once may ask once only.
 */
export const RECORD_TIMELINE_AUDIT_DELAY = new InjectionToken<number | null>(
  'RECORD_TIMELINE_AUDIT_DELAY',
  { providedIn: 'root', factory: () => 2500 },
);
