import { TestBed } from '@angular/core/testing';

import { nxsDateFromAdapter, nxsDateToAdapter } from './adapter-date';
import { CalendarDayAdapter } from './calendar-day-adapter.mock';
import { NxsLocaleDateAdapter } from './locale-date';

describe('the date adapter crossings', () => {
  const calendarDays = new CalendarDayAdapter();
  const jsDates = () => TestBed.runInInjectionContext(() => new NxsLocaleDateAdapter());

  it('reads an adapter’s own date as a JS date at local midnight', () => {
    const day = nxsDateFromAdapter(calendarDays, calendarDays.createDate(2030, 0, 31));
    expect(day).toEqual(new Date(2030, 0, 31));
  });

  it('reads a year below 100 as that year, not as 19xx', () => {
    expect(nxsDateFromAdapter(calendarDays, { year: 42, month: 1, day: 3 })?.getFullYear()).toBe(
      42,
    );
  });

  it('reads no day from nothing, from an invalid date or from what is not the adapter’s', () => {
    expect(nxsDateFromAdapter(calendarDays, null)).toBeNull();
    expect(nxsDateFromAdapter(calendarDays, undefined)).toBeNull();
    expect(nxsDateFromAdapter(calendarDays, calendarDays.invalid())).toBeNull();
    expect(nxsDateFromAdapter(calendarDays, '2030-01-31')).toBeNull();
    expect(nxsDateFromAdapter(calendarDays, new Date(Number.NaN))).toBeNull();
  });

  it('returns a JS date itself, time of day included', () => {
    const instant = new Date('2030-01-31T10:30:00.000Z');
    expect(nxsDateFromAdapter(jsDates(), instant)).toBe(instant);
    expect(nxsDateFromAdapter(calendarDays, instant)).toBe(instant);
  });

  it('gives an adapter that holds JS dates the date itself', () => {
    const instant = new Date('2030-01-31T10:30:00.000Z');
    expect(nxsDateToAdapter(jsDates(), instant)).toBe(instant);
  });

  it('gives any other adapter its own date for the same local day', () => {
    const date = new Date(2030, 0, 31, 23, 59);
    expect(nxsDateToAdapter(calendarDays, date)).toEqual({ year: 2030, month: 0, day: 31 });
    expect(nxsDateToAdapter(calendarDays, null)).toBeNull();
    expect(nxsDateToAdapter(calendarDays, new Date(Number.NaN))).toBeNull();
  });

  it('crosses back to the day it started from', () => {
    const day = new Date(2031, 1, 28);
    expect(nxsDateFromAdapter(calendarDays, nxsDateToAdapter(calendarDays, day))).toEqual(day);
  });
});
