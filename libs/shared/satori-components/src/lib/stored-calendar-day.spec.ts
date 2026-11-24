import { NOT_STORED_CALENDAR_DAYS, STORED_CALENDAR_DAYS } from '@agentic-ui/shared/testing';

import { isStoredCalendarDay } from './stored-calendar-day';

// The one case list every copy of the predicate runs, so this copy and the layout view's in
// `document-layouts` are held to the same rule. See `stored-calendar-day-cases.ts`.

describe('isStoredCalendarDay', () => {
  it.each(STORED_CALENDAR_DAYS)('is true for %s, a stored day', (text) => {
    expect(isStoredCalendarDay(text)).toBe(true);
  });

  it.each(NOT_STORED_CALENDAR_DAYS)('is false for %j: %s', (value) => {
    expect(isStoredCalendarDay(value)).toBe(false);
  });
});
