/**
 * The cases every copy of `isStoredCalendarDay` is held to (`AGENTS/08-bug-patterns.md`,
 * pattern 29).
 *
 * The predicate decides whether a date property holds a stored calendar day, shown and edited on
 * its UTC day, or an instant, shown and opened on the reader's day. Two libraries on `main` carry a
 * copy, because neither can import the other's: the layout `date` view's, in
 * `document-layouts/…/document-layout/stored-calendar-day.ts`, and the edit form's, in
 * `satori-components/…/stored-calendar-day.ts`. `document-layouts` depends on
 * `satori-components`, so the only home both could import is a published platform entry point.
 *
 * Both specs run this one list, so the copies cannot drift apart on any case it holds. If a copy
 * needs a new case, add it here, and both copies must pass it. A third copy, in
 * `libs/shared/computations` (PR 632, not on `main`), has the same cases written out in its spec.
 *
 * The predicate reads the text and never a zone, so no case here depends on the suite's.
 */

/** Values that are a stored day: a bare day, or exactly midnight UTC written `Z` or `+00:00`. */
export const STORED_CALENDAR_DAYS: readonly string[] = [
  '2024-03-06',
  '2024-03-06T00:00:00.000Z',
  '2024-03-06T00:00:00Z',
  '2024-03-06T00:00Z',
  '2024-03-06T00:00:00.0Z',
  '2024-03-06T00:00:00.00Z',
  '2024-03-06T00:00:00+00:00',
  '2024-03-06T00:00:00.000+00:00',
  '2024-02-29',
  '2000-02-29T00:00:00.000Z',
];

/** Values that are not, each with the reason, for the test's name. */
export const NOT_STORED_CALENDAR_DAYS: readonly (readonly [unknown, string])[] = [
  ['2024-03-06T00:00:00.001Z', 'a millisecond past midnight UTC'],
  ['2024-03-06T00:00:01Z', 'a second past'],
  ['2024-03-06T00:01:00Z', 'a minute past'],
  ['2024-03-06T01:00:00Z', 'an hour past'],
  ['2024-03-06T00:00:00-00:00', 'midnight with an unknown offset'],
  ['2024-03-06T00:00:00+05:30', 'midnight in another zone'],
  ['2024-03-06T00:00:00-05:00', 'midnight west of UTC'],
  ['2024-03-06T20:00:00.000Z', 'an evening'],
  ['2024-03-06T00:00:00.0001Z', 'more than milliseconds'],
  ['2024-03-06T00:00:00', 'a time with no zone'],
  ['2024-03-06T00:00:00.000', 'a time with no zone, with milliseconds'],
  ['2024-03-06T00:00:00+0000', 'an offset with no colon'],
  ['2024-03-06Z', 'a zone with no time'],
  ['2023-02-29', 'a 29 February in a common year'],
  ['1900-02-29T00:00:00.000Z', 'a 29 February in a century that is not a leap year'],
  ['2024-02-30', 'a 30 February'],
  ['2024-04-31T00:00:00Z', 'a 31 April'],
  ['2024-13-01', 'a thirteenth month'],
  ['2024-00-10', 'a month 0'],
  ['2024-03-00', 'a day 0'],
  ['20240306', 'the basic format'],
  ['2024-3-6', 'unpadded'],
  [' 2024-03-06', 'a leading space'],
  ['2024-03-06 ', 'a trailing space'],
  ['+002024-03-06', 'an expanded year'],
  ['yesterday', 'a word'],
  ['', 'nothing'],
  [new Date('2024-03-06T00:00:00.000Z'), 'a Date, which is read in the reader’s zone'],
  [20240306, 'a number'],
  [null, 'null'],
  [undefined, 'undefined'],
];
