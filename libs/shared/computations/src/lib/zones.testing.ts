/**
 * Test support, not part of the library. The zones the suite runs in, one each side of UTC:
 * `vite.config.mts` runs every spec once in each.
 *
 * Two, because each reading of a date can only be seen failing on one side
 * (`AGENTS/08-bug-patterns.md`, pattern 29):
 *
 * - **East, Asia/Calcutta, +05:30.** A `Date` at local midnight, a picked day, falls on the
 *   previous day in UTC, and an instant at 20:00Z falls on the next day here. Reading either in UTC
 *   instead of the reader's zone is a day out here.
 * - **West, America/New_York, -05:00 or -04:00.** Midnight UTC, a stored day, falls on the previous
 *   day here, and so does an instant at 03:00Z. Reading a stored day in the reader's zone instead
 *   of UTC is a day out only west of UTC: midnight UTC is the same day everywhere from UTC to
 *   +14:00.
 *
 * The suite supports these two zones and no other. Its expectations are literals, as pattern 29
 * asks, and where one differs between the zones, `inZone` gives each its own.
 */
export const ZONES = ['Asia/Calcutta', 'America/New_York'] as const;
export type Zone = (typeof ZONES)[number];

/** The zone this run is in. */
export const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The literal this zone expects. */
export function inZone<T>(expected: Readonly<Record<Zone, T>>): T {
  if (!(ZONES as readonly string[]).includes(ZONE))
    throw new Error(`the suite runs in ${ZONES.join(' and ')}, not ${ZONE}`);
  return expected[ZONE as Zone];
}
