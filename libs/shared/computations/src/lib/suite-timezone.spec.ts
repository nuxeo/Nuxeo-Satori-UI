import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZONE, ZONES } from './zones.testing';

/**
 * Guards the zones this suite runs in. `vite.config.mts` runs every spec in each zone of
 * `zones.testing.ts`, one east of UTC and one west, because each reading of a date can only fail on
 * one side (`AGENTS/08-bug-patterns.md`, pattern 29). Losing either run would break nothing
 * visibly, so it is asserted here rather than left as a comment.
 */

/** A zone's offset from UTC at an instant, in minutes east, read through Intl, not this process. */
function offsetOf(zone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!match) return 0;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

const AT = new Date('2026-11-23T00:00:00.000Z');

describe('the suite’s time zone', () => {
  it('is the zone vite.config.mts gave this run, one of the two the suite supports', () => {
    expect(ZONES).toContain(ZONE);
    expect(ZONE).toBe(process.env['TZ']);
    // This process's dates follow it, not only Intl.
    expect(-AT.getTimezoneOffset()).toBe(offsetOf(ZONE, AT));
  });

  it('is one of two zones, one each side of UTC by more than an hour and a half', () => {
    expect(ZONES.map((zone) => offsetOf(zone, AT))).toEqual([330, -300]);
  });

  it('is one of the zones vite.config.mts runs, which are the ones zones.testing.ts names', () => {
    const config = readFileSync(join(import.meta.dirname, '../../vite.config.mts'), 'utf8');
    const runs = /^const ZONES = \[(.*)\];$/m.exec(config)?.[1];
    expect(runs?.split(', ').map((zone) => zone.slice(1, -1))).toEqual([...ZONES]);
  });
});
