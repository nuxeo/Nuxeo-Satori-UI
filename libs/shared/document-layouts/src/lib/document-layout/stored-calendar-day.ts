/**
 * Whether a date property holds a stored calendar day or an instant, so that the layout `date`
 * view formats each in its own zone (`AGENTS/08-bug-patterns.md`, pattern 29).
 *
 * A day and an instant are different kinds, and JavaScript has one type for both. A stored day is
 * anchored in UTC: Nuxeo writes a day-only value, `2024-03-06`, as `2024-03-06T00:00:00.000Z`, and
 * the edit form writes a picked day at its UTC midnight. A real instant, such as `dc:created`,
 * belongs in the reader's zone. So:
 *
 * - **`2024-03-06`** is a stored day.
 * - **An ISO 8601 instant at exactly midnight UTC**, written with `Z` or `+00:00` and a fraction of
 *   zeros or none, is a stored day.
 * - **Anything else** is not: any other instant, midnight in another zone, `-00:00` (RFC 3339's
 *   "offset unknown"), a time with no zone, a day that does not exist such as `2023-02-29`, and a
 *   value that is not a string.
 *
 * **One known misreading.** An instant that happens to fall at exactly midnight UTC, a `dc:created`
 * stamped at `00:00:00.000Z`, is taken for a stored day and shown on its UTC day. West of UTC that
 * is a day later than the reader's own. Nothing in the value tells the two apart.
 *
 * **The same rule as two copies elsewhere.** `nxs-metadata-editor` opens a date on its day by the
 * one in `satori-components/…/stored-calendar-day.ts`, so the edit form agrees with this view. This
 * library depends on that one, but it cannot be imported without exporting it from the published
 * platform API, which is an API decision for a human. Both specs run one case list,
 * `stored-calendar-day-cases.ts` in `libs/shared/testing`. The other copy is `isStoredCalendarDay`
 * in `libs/shared/computations`, which layout version 2's record page formats with (PR 632, into
 * `integration/enterprise-grade-app`). That library is not on `main`; when both are on one branch,
 * this copy should go and `field-view.ts` should import that one.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIDNIGHT_UTC = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0{1,3})?)?(?:Z|\+00:00)$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** True for a stored calendar day, read in UTC; false for an instant, read in the reader's zone. */
export function isStoredCalendarDay(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = DAY.exec(value) ?? MIDNIGHT_UTC.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}
