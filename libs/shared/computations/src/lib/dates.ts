/**
 * Calendar days, and the whole days, months and years between two of them, for `core.age` and
 * `core.dateDiff`.
 *
 * A day and an instant are different kinds, and JavaScript has one type for both
 * (`AGENTS/08-bug-patterns.md`, pattern 29). So the rules are written down here:
 *
 * - **A record's date is a calendar day anchored in UTC.** Nuxeo stores a day-only write as midnight
 *   UTC, and the layout's `date` widget formats in UTC (`libs/shared/document-layouts`,
 *   `field-view.ts`), so an age agrees with the birth date the page shows beside it. A date with a
 *   time is the instant it names, and its day is that instant's day in UTC.
 * - **`today` is an instant, read in the reader's own zone.** It is the day the person looking at
 *   the page is living, so an age turns over at their midnight, not at Greenwich's.
 * - **Only ISO 8601 as Nuxeo writes it is a date:** `2024-03-06`, or a date and time with its zone,
 *   `2024-03-06T00:00:00.000Z` or `…+02:00`. A time with no zone names a different instant in
 *   every zone, so it is refused rather than guessed. So is a day that does not exist, such as
 *   `2023-02-29`.
 * - **A whole month is counted as a birthday is.** It is complete on the same day of the month,
 *   and when that month has no such day, on the first day of the next. A year is twelve such
 *   months. So someone born on 29 February 2000 turns one on 1 March 2001, and 31 January plus a
 *   month is 1 March, not 28 February.
 */

export interface CalendarDay {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
}

export type Unit = 'days' | 'months' | 'years';
export const UNITS: readonly Unit[] = ['days', 'months', 'years'];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  return month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function exists(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

/** The day an ISO 8601 text names, as the rules above read it, or `undefined` if it is not one. */
export function parseDay(text: string): CalendarDay | undefined {
  const day = DAY.exec(text);
  if (day) {
    const [year, month, date] = day.slice(1).map(Number);
    return exists(year, month, date) ? { year, month, day: date } : undefined;
  }
  const instant = INSTANT.exec(text);
  if (!instant) return undefined;
  const [year, month, date, hour, minute] = instant.slice(1, 6).map(Number);
  const [second, zoneHour, zoneMinute] = instant.slice(6).map((part) => Number(part ?? 0));
  if (!exists(year, month, date) || hour > 23 || minute > 59 || second > 59) return undefined;
  if (zoneHour > 23 || zoneMinute > 59) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : utcDayOf(new Date(time));
}

/** An instant's day in UTC: the day a record's date names. */
export function utcDayOf(date: Date): CalendarDay {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** An instant's day in the reader's zone: the day `today` names. */
export function localDayOf(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/**
 * Days since 1 January 1970, for any proleptic Gregorian day. It is Howard Hinnant's
 * `days_from_civil`, which needs no `Date`, so no zone and no `Date.UTC`, whose years 0 to 99 are
 * read as 1900 to 1999.
 */
export function dayNumber({ year, month, day }: CalendarDay): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * `to` minus `from`, in whole units: positive when `to` is later, negative when it is earlier, and
 * the same size either way round. Never `-0`, which a number format writes as "-0".
 */
export function difference(from: CalendarDay, to: CalendarDay, unit: Unit): number {
  if (unit === 'days') return dayNumber(to) - dayNumber(from);
  const forwards = dayNumber(to) >= dayNumber(from);
  const [early, late] = forwards ? [from, to] : [to, from];
  const months =
    (late.year - early.year) * 12 + (late.month - early.month) - (late.day < early.day ? 1 : 0);
  const whole = unit === 'months' ? months : Math.floor(months / 12);
  return forwards ? whole : 0 - whole;
}
