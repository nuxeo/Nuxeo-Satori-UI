import {
  dayNumber,
  difference,
  isStoredCalendarDay,
  localDayOf,
  parseDay,
  utcDayOf,
  written,
  type CalendarDay,
  type Unit,
} from './dates';
import { TODAY } from './record.testing';
import { inZone } from './zones.testing';

const day = (year: number, month: number, date: number): CalendarDay => ({
  year,
  month,
  day: date,
});

// The suite runs in Asia/Calcutta and in America/New_York (zones.testing.ts). Where a day differs
// between them, `inZone` gives each its literal, as pattern 29 asks.

describe('parseDay', () => {
  it.each([
    ['2024-03-06', day(2024, 3, 6)],
    ['2024-02-29', day(2024, 2, 29)],
    ['2000-02-29', day(2000, 2, 29)],
  ])('reads %s, a day, as that day', (text, expected) => {
    expect(parseDay(text)).toEqual(expected);
  });

  it.each([
    '2024-03-06T00:00:00.000Z',
    '2024-03-06T00:00:00Z',
    '2024-03-06T00:00Z',
    '2024-03-06T00:00:00.0Z',
    '2024-03-06T00:00:00.00Z',
    '2024-03-06T00:00:00+00:00',
    '2024-03-06T00:00:00.000+00:00',
  ])('reads %s, a stored day at midnight UTC, as its day in UTC', (text) => {
    // In New York this is the evening of 5 March: read in the reader's zone, it would be a day out.
    expect(parseDay(text)).toEqual(day(2024, 3, 6));
  });

  it.each<[string, CalendarDay, CalendarDay]>([
    // The text, then its day in Asia/Calcutta and in America/New_York.
    ['2024-03-06T20:00:00.000Z', day(2024, 3, 7), day(2024, 3, 6)],
    ['2024-03-07T03:00:00.000Z', day(2024, 3, 7), day(2024, 3, 6)],
    ['2024-03-06T12:00:00.000Z', day(2024, 3, 6), day(2024, 3, 6)],
    ['2024-03-06T23:59:59.999Z', day(2024, 3, 7), day(2024, 3, 6)],
    ['2024-03-06T10:15Z', day(2024, 3, 6), day(2024, 3, 6)],
    ['2024-03-06T10:15:30.5Z', day(2024, 3, 6), day(2024, 3, 6)],
    // Just past midnight UTC, or midnight written another way, is an instant, not a stored day.
    ['2024-03-06T00:00:00.001Z', day(2024, 3, 6), day(2024, 3, 5)],
    ['2024-03-06T00:00:01Z', day(2024, 3, 6), day(2024, 3, 5)],
    ['2024-03-06T00:00:00-00:00', day(2024, 3, 6), day(2024, 3, 5)],
    ['2024-03-06T00:00:00+05:30', day(2024, 3, 6), day(2024, 3, 5)],
    ['2024-03-06T01:00:00+05:30', day(2024, 3, 6), day(2024, 3, 5)],
    ['2024-03-06T22:00:00-05:00', day(2024, 3, 7), day(2024, 3, 6)],
  ])('reads %s, an instant, as its day in the reader’s zone', (text, calcutta, newYork) => {
    expect(parseDay(text)).toEqual(
      inZone({ 'Asia/Calcutta': calcutta, 'America/New_York': newYork }),
    );
  });

  it.each([
    ['', 'nothing'],
    ['yesterday', 'a word'],
    ['20240306', 'the basic format'],
    ['2024-3-6', 'unpadded'],
    [' 2024-03-06', 'a leading space'],
    ['2024-03-06 ', 'a trailing space'],
    ['+002024-03-06', 'an expanded year'],
    ['2024-03-06Z', 'a zone with no time'],
    ['2024-03-06T10:00:00', 'a time with no zone, which is a different instant in every zone'],
    ['2024-03-06T10:00:00.000', 'a time with no zone, with milliseconds'],
    ['2024-03-06T10:00:00+0530', 'an offset with no colon'],
    ['2024-03-06T10:00:00.1234Z', 'more than milliseconds'],
    ['2023-02-29', 'a 29 February in a common year'],
    ['1900-02-29', 'a 29 February in a century that is not a leap year'],
    ['2024-02-30', 'a 30 February'],
    ['2024-04-31', 'a 31 April'],
    ['2024-13-01', 'a thirteenth month'],
    ['2024-00-10', 'a month 0'],
    ['2024-03-00', 'a day 0'],
    ['2024-03-06T24:00:00Z', 'the hour 24'],
    ['2024-03-06T10:60:00Z', 'the minute 60'],
    ['2024-03-06T10:00:60Z', 'a leap second'],
    ['2024-03-06T10:00:00+24:00', 'an offset of 24 hours'],
    ['2024-03-06T10:00:00+05:60', 'an offset of 60 minutes'],
  ])('refuses %j: %s', (text) => {
    expect(parseDay(text)).toBeUndefined();
  });
});

describe('isStoredCalendarDay', () => {
  it.each([
    '2024-03-06',
    '2024-03-06T00:00:00.000Z',
    '2024-03-06T00:00:00Z',
    '2024-03-06T00:00Z',
    '2024-03-06T00:00:00.00Z',
    '2024-03-06T00:00:00+00:00',
  ])('is true for %s, a stored day', (text) => {
    expect(isStoredCalendarDay(text)).toBe(true);
  });

  it.each<[unknown, string]>([
    ['2024-03-06T00:00:00.001Z', 'a millisecond past midnight UTC'],
    ['2024-03-06T00:00:01Z', 'a second past'],
    ['2024-03-06T00:01:00Z', 'a minute past'],
    ['2024-03-06T00:00:00-00:00', 'midnight with an unknown offset'],
    ['2024-03-06T00:00:00+05:30', 'midnight in another zone'],
    ['2024-03-06T20:00:00.000Z', 'an evening'],
    [new Date('2024-03-06T00:00:00.000Z'), 'a Date, which is read in the reader’s zone'],
    ['2023-02-29', 'a day that does not exist'],
    ['2024-03-06T00:00:00', 'a time with no zone'],
    ['yesterday', 'a word'],
    [20240306, 'a number'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('is false for %j: %s', (value) => {
    expect(isStoredCalendarDay(value)).toBe(false);
  });

  it('takes an instant at exactly midnight UTC for a stored day: the one known misreading', () => {
    // A dc:created stamped at 00:00:00.000Z is the evening of 23 November in New York, but nothing
    // in the text tells it from a day Nuxeo stored, so it is read as 24 November everywhere.
    expect(isStoredCalendarDay('2026-11-24T00:00:00.000Z')).toBe(true);
    expect(parseDay('2026-11-24T00:00:00.000Z')).toEqual(day(2026, 11, 24));
  });
});

describe('the two readings of an instant', () => {
  it('reads an instant’s day in UTC, or in the reader’s zone', () => {
    const evening = new Date('2024-03-06T20:00:00.000Z');
    expect(utcDayOf(evening)).toEqual(day(2024, 3, 6));
    expect(localDayOf(evening)).toEqual(
      inZone({ 'Asia/Calcutta': day(2024, 3, 7), 'America/New_York': day(2024, 3, 6) }),
    );
    const early = new Date('2024-03-07T03:00:00.000Z');
    expect(utcDayOf(early)).toEqual(day(2024, 3, 7));
    expect(localDayOf(early)).toEqual(
      inZone({ 'Asia/Calcutta': day(2024, 3, 7), 'America/New_York': day(2024, 3, 6) }),
    );
  });

  it('gives the suite’s today a different day in UTC east of it, so a spec can tell them apart', () => {
    expect(localDayOf(TODAY)).toEqual(day(2026, 11, 23));
    expect(utcDayOf(TODAY)).toEqual(
      inZone({ 'Asia/Calcutta': day(2026, 11, 22), 'America/New_York': day(2026, 11, 23) }),
    );
  });

  it('writes a day as ISO 8601 does', () => {
    expect(written(day(2024, 3, 6))).toBe('2024-03-06');
    expect(written(day(50, 1, 1))).toBe('0050-01-01');
  });
});

describe('dayNumber', () => {
  it.each([
    [day(1970, 1, 1), 0],
    [day(1969, 12, 31), -1],
    [day(2000, 3, 1), 11017],
    [day(2026, 11, 23), 20780],
  ])('counts %j as day %i since 1 January 1970', (calendarDay, expected) => {
    expect(dayNumber(calendarDay)).toBe(expected);
  });

  it('agrees with Date on every day from 1899 to 2101', () => {
    const date = new Date(Date.UTC(1899, 0, 1));
    const wrong: string[] = [];
    while (date.getUTCFullYear() < 2102) {
      const expected = date.getTime() / 86_400_000;
      if (dayNumber(utcDayOf(date)) !== expected) wrong.push(date.toISOString());
      date.setUTCDate(date.getUTCDate() + 1);
    }
    expect(wrong).toEqual([]);
  });

  it('counts years 0 to 99 as themselves, which Date.UTC reads as 1900 to 1999', () => {
    const date = new Date(0);
    date.setUTCFullYear(50, 0, 1);
    expect(dayNumber(day(50, 1, 1))).toBe(date.getTime() / 86_400_000);
    expect(dayNumber(day(50, 1, 1))).not.toBe(Date.UTC(50, 0, 1) / 86_400_000);
  });
});

describe('difference', () => {
  it.each<[CalendarDay, CalendarDay, Unit, number]>([
    [day(2026, 3, 1), day(2026, 3, 31), 'days', 30],
    [day(2024, 2, 28), day(2024, 3, 1), 'days', 2],
    [day(2023, 2, 28), day(2023, 3, 1), 'days', 1],
    [day(2026, 3, 1), day(2026, 3, 1), 'days', 0],
    // A month is complete on the same day of the month...
    [day(2026, 1, 15), day(2026, 2, 14), 'months', 0],
    [day(2026, 1, 15), day(2026, 2, 15), 'months', 1],
    // ...and, when the month has no such day, on the first day of the next.
    [day(2026, 1, 31), day(2026, 2, 28), 'months', 0],
    [day(2026, 1, 31), day(2026, 3, 1), 'months', 1],
    [day(2024, 1, 31), day(2024, 2, 29), 'months', 0],
    [day(2026, 3, 31), day(2026, 4, 30), 'months', 0],
    [day(2026, 3, 31), day(2026, 5, 1), 'months', 1],
    [day(2026, 1, 31), day(2026, 3, 31), 'months', 2],
    [day(2025, 11, 23), day(2026, 11, 23), 'months', 12],
    // A year is twelve such months, so it is a birthday.
    [day(1990, 11, 23), day(2026, 11, 23), 'years', 36],
    [day(1990, 11, 24), day(2026, 11, 23), 'years', 35],
    [day(1990, 12, 1), day(2026, 11, 23), 'years', 35],
    [day(1990, 1, 1), day(2026, 11, 23), 'years', 36],
    [day(2000, 2, 29), day(2001, 2, 28), 'years', 0],
    [day(2000, 2, 29), day(2001, 3, 1), 'years', 1],
    [day(2000, 2, 29), day(2004, 2, 29), 'years', 4],
  ])('from %j to %j is %i %s', (from, to, unit, expected) => {
    expect(difference(from, to, unit)).toBe(expected);
  });

  it.each<Unit>(['days', 'months', 'years'])(
    'is negative when the second is earlier, the same size either way round, in %s',
    (unit) => {
      const pairs: [CalendarDay, CalendarDay][] = [
        [day(2026, 3, 1), day(2026, 3, 31)],
        [day(2026, 1, 31), day(2026, 3, 1)],
        [day(1990, 11, 24), day(2026, 11, 23)],
        [day(2000, 2, 29), day(2001, 3, 1)],
      ];
      // `0 - x` rather than `-x`, which is -0 for 0, and `toBe` tells -0 from 0.
      for (const [early, late] of pairs)
        expect(difference(late, early, unit)).toBe(0 - difference(early, late, unit));
      expect(difference(day(2026, 3, 31), day(2026, 3, 1), 'days')).toBe(-30);
      expect(difference(day(2001, 3, 1), day(2000, 2, 29), 'years')).toBe(-1);
    },
  );

  it('never gives -0, which a number format writes as "-0"', () => {
    const value = difference(day(2026, 5, 15), day(2026, 5, 10), 'months');
    expect(Object.is(value, 0)).toBe(true);
    expect(new Intl.NumberFormat('en').format(value)).toBe('0');
    expect(Object.is(difference(day(2026, 5, 15), day(2026, 1, 20), 'years'), 0)).toBe(true);
  });
});
