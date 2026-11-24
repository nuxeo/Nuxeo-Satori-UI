/**
 * How many days a date is from today, for layout version 2's date rules, `app.rules.datePassed`
 * and `app.rules.dateWithin` (docs/business-apps/layout-v2.md, section 5).
 *
 * A day and an instant are different kinds, and JavaScript has one type for both
 * (`AGENTS/08-bug-patterns.md`, pattern 29). So a value is read as the record page's `date` widget
 * and the computations read it (`dates.ts` in `libs/shared/computations`):
 *
 * - **`2026-12-01`**, or an ISO 8601 instant at exactly midnight UTC, written with `Z` or `+00:00`
 *   and a fraction of zeros or none, is a stored day: that day, as written. Nuxeo stores a day-only
 *   write, such as a `dc:expired` picked in the Edit form, as `2026-12-01T00:00:00.000Z`.
 * - **Any other ISO 8601 instant with its zone** is its day in the reader's zone.
 * - **Anything else is not a date**, and no date rule passes on it: a time with no zone, which names
 *   a different instant in every zone; a day that does not exist, such as `2023-02-29`; a number;
 *   an empty or missing value.
 *
 * **Today is the reader's own day,** so a licence that ends on the 1st has passed for them from
 * their midnight. The day and the zone are the caller's: the rule context's `today` and
 * `timeZone`, which the record page fills from its own clock, and the browser's otherwise.
 *
 * The rule is the computations' own, written again here: this library is in the published package
 * and that one is not, so it cannot import it. `date-rules.spec.ts` holds this copy to cases of
 * its own, read in two zones either side of UTC and in UTC.
 *
 * **One known misreading,** the computations' too: an instant that happens to fall at exactly
 * midnight UTC is taken for a stored day. Nothing in the value tells the two apart.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

interface CalendarDay {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function exists(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const last = month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= last;
}

/** An instant's day in `timeZone`, or in the reader's zone when it is `undefined`. */
function dayIn(instant: Date, timeZone: string | undefined): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day'): number =>
    Number(parts.find((each) => each.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/** The day a value names, as the rules above read it, or `null` when it is not a date. */
function dayOf(value: unknown, timeZone: string | undefined): CalendarDay | null {
  if (typeof value !== 'string') return null;
  const day = DAY.exec(value);
  if (day) {
    const [year, month, date] = day.slice(1).map(Number);
    return exists(year, month, date) ? { year, month, day: date } : null;
  }
  const instant = INSTANT.exec(value);
  if (!instant) return null;
  const [year, month, date, hour, minute] = instant.slice(1, 6).map(Number);
  const [second, fraction, zone, zoneHour, zoneMinute] = instant.slice(6);
  const seconds = Number(second ?? 0);
  if (!exists(year, month, date) || hour > 23 || minute > 59 || seconds > 59) return null;
  if (Number(zoneHour ?? 0) > 23 || Number(zoneMinute ?? 0) > 59) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const stored =
    hour === 0 &&
    minute === 0 &&
    seconds === 0 &&
    /^0*$/.test(fraction ?? '') &&
    (zone === 'Z' || zone === '+00:00');
  return stored ? { year, month, day: date } : dayIn(new Date(time), timeZone);
}

/**
 * Days since 1 January 1970, for any proleptic Gregorian day: Howard Hinnant's `days_from_civil`,
 * as the computations count them, so no `Date` and no zone.
 */
function dayNumber({ year, month, day }: CalendarDay): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * How many days `value` is after `today`'s day: `0` for today, `-1` for yesterday, `30` for thirty
 * days from now. `null` when `value` is not a date, `today` not a valid `Date`, or `timeZone` not
 * a zone `Intl` reads.
 *
 * @param timeZone the reader's zone: `undefined`, the reader's own, as in the app; an IANA zone, or
 *   an offset such as `+0530` as `RECORD_PAGE_TIME_ZONE` writes one, so that a test or a host
 *   chooses it rather than inheriting the one it happens to run in
 */
export function daysFromToday(
  value: unknown,
  today: Date,
  timeZone: string | undefined = undefined,
): number | null {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) return null;
  try {
    const day = dayOf(value, timeZone);
    return day === null ? null : dayNumber(day) - dayNumber(dayIn(today, timeZone));
  } catch (error) {
    // `Intl.DateTimeFormat` refuses a zone it does not know, with a RangeError: no day is read.
    if (error instanceof RangeError) return null;
    throw error;
  }
}
