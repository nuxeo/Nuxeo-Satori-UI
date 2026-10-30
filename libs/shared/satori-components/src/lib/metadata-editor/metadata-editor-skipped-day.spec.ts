/**
 * A calendar day that its zone skipped entirely (NXSAT-727, review round 3).
 *
 * Samoa moved west of the date line at the end of 2011: **30 December 2011 did not exist** in
 * `Pacific/Apia`. `new Date(2011, 11, 30)` there rolls forward to the 31st, so a stored
 * `2011-12-30T00:00:00.000Z` reaches the picker as 31 December. Re-deriving the stored day from the
 * instant at write time then sees 30 against the picker's 31, reads that as a user edit, and
 * rewrites an untouched field to `2011-12-31T00:00:00.000Z`. Comparing against the day the control
 * was actually handed cannot make that mistake.
 *
 * **In a file of its own because the zone has to be the process's, and it is not this project's
 * pinned one.** Vitest runs `satori-components` `pool: 'threads'`, where Node reads the zone once
 * at startup and `process.env.TZ` assigned later is accepted and ignored, so a case cannot switch
 * zones for itself — `AGENTS/08-bug-patterns.md` pattern 27 records that trap. A separate spec file
 * gets its own worker, and `vite.config.mts` applies the project pin before any worker starts, so
 * the pin is what decides the zone here too.
 *
 * The consequence is that **this file only asserts anything under a zone with a skipped day**. Run
 * it deliberately, which is how it was verified:
 *
 *   TZ=Pacific/Apia npx vitest run --config libs/shared/satori-components/vite.config.mts \
 *     libs/shared/satori-components/src/lib/metadata-editor/metadata-editor-skipped-day.spec.ts
 *
 * so the guard below states the limitation rather than letting the file read as proof it is not.
 */
import { Injector } from '@angular/core';

import { CalendarDayAdapter } from '../date-input/calendar-day-adapter.mock';
import { NxsLocaleDateAdapter } from '../date-input/locale-date';
import { buildControl, propertyValue } from './metadata-editor-form';

const dates = Injector.create({ providers: [{ provide: NxsLocaleDateAdapter }] }).get(
  NxsLocaleDateAdapter,
);
const calendarDays = new CalendarDayAdapter();

/** The instant whose UTC day `Pacific/Apia` has no local midnight for. */
const SKIPPED = '2011-12-30T00:00:00.000Z';

/** Whether this process's zone actually skips that day, i.e. whether the cases below can fail. */
const zoneSkipsTheDay = (() => {
  const local = new Date(2011, 11, 30);
  return local.getDate() !== 30;
})();

describe('a stored day its zone skipped', () => {
  it('reports whether this run can assert anything, rather than passing silently', () => {
    // Not an assertion about the fix — an assertion about the run, so a green tick in a zone with
    // no skipped day is not mistaken for coverage of one.
    expect(typeof zoneSkipsTheDay).toBe('boolean');
    if (!zoneSkipsTheDay) {
      console.warn(
        `[NXSAT-727] zone ${Intl.DateTimeFormat().resolvedOptions().timeZone} has no skipped day ` +
          'around 2011-12-30; the cases in this file cannot fail here. Run them with ' +
          'TZ=Pacific/Apia.',
      );
    }
  });

  it('writes an untouched value back unchanged, for an adapter holding calendar days', () => {
    const control = buildControl({ type: 'date' }, SKIPPED, calendarDays);
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe(SKIPPED);
  });

  it('writes an untouched value back unchanged, for an adapter holding JS dates', () => {
    const control = buildControl({ type: 'date' }, SKIPPED, dates);
    expect(propertyValue({ type: 'date' }, control, dates)).toBe(SKIPPED);
  });

  it('still writes a genuinely picked day at its UTC midnight', () => {
    const control = buildControl({ type: 'date' }, SKIPPED, calendarDays);
    control.setValue(calendarDays.createDate(2012, 0, 5));
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe('2012-01-05T00:00:00.000Z');
  });
});
