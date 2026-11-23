/**
 * Calendar days, and the whole days, months and years between two of them, for `core.age` and
 * `core.dateDiff`.
 *
 * A day and an instant are different kinds, and JavaScript has one type for both
 * (`AGENTS/08-bug-patterns.md`, pattern 29): a stored day is anchored in UTC, and a real instant
 * belongs in the reader's zone. So each value is read by what it is:
 *
 * - **`2024-03-06`** is that day.
 * - **An ISO 8601 instant at exactly midnight UTC**, written with `Z` or `+00:00` and a fraction of
 *   zeros or none, is its UTC day. That is what Nuxeo stores for a day-only write: `2024-03-06`
 *   comes back as `2024-03-06T00:00:00.000Z`.
 * - **Any other ISO 8601 instant**, such as `dc:created`, is its day in the reader's zone.
 * - **A `Date`** is its local year, month and day, as a picker gives them: a form's date picker
 *   holds a calendar day as a `Date` at local midnight (`toCalendarDay` in
 *   `libs/shared/satori-components`, `metadata-editor-form.ts`).
 * - **`today`** is the reader's local day, so an age turns over at their midnight.
 *
 * `isStoredCalendarDay` says which of the two readings a value gets, so that the record page's
 * `date` widget can format with the same rule.
 *
 * **One known misreading.** An instant that happens to fall at exactly midnight UTC, a `dc:created`
 * stamped at `00:00:00.000Z`, is taken for a stored day. West of UTC it then reads a day later than
 * it is in the reader's zone. Nothing in the value tells the two apart.
 *
 * - **Only ISO 8601 as Nuxeo writes it is a date:** a day, `2024-03-06`, or a date and time with
 *   its zone, `2024-03-06T00:00:00.000Z` or `…+02:00`. A time with no zone names a different
 *   instant in every zone, so it is refused rather than guessed. So is a day that does not exist,
 *   such as `2023-02-29`.
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
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  return month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function exists(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

/** A text read as a date: its day, and whether it is a stored day rather than an instant. */
interface Reading {
  readonly day: CalendarDay;
  readonly stored: boolean;
}

function read(text: string): Reading | undefined {
  const day = DAY.exec(text);
  if (day) {
    const [year, month, date] = day.slice(1).map(Number);
    return exists(year, month, date)
      ? { day: { year, month, day: date }, stored: true }
      : undefined;
  }
  const instant = INSTANT.exec(text);
  if (!instant) return undefined;
  const [year, month, date, hour, minute] = instant.slice(1, 6).map(Number);
  const [second, fraction, zone, zoneHour, zoneMinute] = instant.slice(6);
  const [seconds, offsetHours, offsetMinutes] = [second, zoneHour, zoneMinute].map((part) =>
    Number(part ?? 0),
  );
  if (!exists(year, month, date) || hour > 23 || minute > 59 || seconds > 59) return undefined;
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return undefined;
  const stored =
    hour === 0 &&
    minute === 0 &&
    seconds === 0 &&
    /^0*$/.test(fraction ?? '') &&
    (zone === 'Z' || zone === '+00:00');
  return { day: stored ? utcDayOf(new Date(time)) : localDayOf(new Date(time)), stored };
}

/** The day an ISO 8601 text names, as the rules above read it, or `undefined` if it is not one. */
export function parseDay(text: string): CalendarDay | undefined {
  return read(text)?.day;
}

/**
 * Whether a value is a stored calendar day, read in UTC, rather than an instant, read in the
 * reader's zone: `2024-03-06`, or an ISO 8601 instant at exactly midnight UTC. False for anything
 * that is not a date, and for a `Date`, which is read in the reader's zone. The record page's `date`
 * widget formats with the same rule.
 */
export function isStoredCalendarDay(value: unknown): boolean {
  return typeof value === 'string' && read(value)?.stored === true;
}

/** An instant's day in UTC: the day a stored day names. */
export function utcDayOf(date: Date): CalendarDay {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** An instant's day in the reader's zone: the day an instant, a `Date` or `today` names. */
export function localDayOf(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** A calendar day as ISO 8601 writes one, `2024-03-06`. A year past 9999 is not one. */
export function written({ year, month, day }: CalendarDay): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
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
