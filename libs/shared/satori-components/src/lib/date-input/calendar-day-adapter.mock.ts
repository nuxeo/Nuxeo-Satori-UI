import { Injectable } from '@angular/core';
import { DateAdapter } from '@angular/material/core';

/** A date as {@link CalendarDayAdapter} holds one: a plain object, never a JS `Date`. */
export interface CalendarDay {
  readonly year: number;
  /** 0 to 11, as `DateAdapter` counts months. */
  readonly month: number;
  readonly day: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many letters of a name each style keeps: all of it, three, or one. */
const NAME_LENGTH = { long: undefined, short: 3, narrow: 1 } as const;

const shorten = (names: string[], style: 'long' | 'short' | 'narrow'): string[] =>
  names.map((name) => name.slice(0, NAME_LENGTH[style]));

/** Milliseconds from 1970 to the day's UTC midnight, for arithmetic on days alone. */
function utc({ year, month, day }: CalendarDay): number {
  const at = new Date(0);
  at.setUTCFullYear(year, month, day);
  return at.getTime();
}

function fromUtc(time: number): CalendarDay {
  const at = new Date(time);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth(), day: at.getUTCDate() };
}

/**
 * A host's date adapter whose dates are not JS `Date`s, as Luxon's and Moment's are not: each date
 * is a `{ year, month, day }` object. It writes and reads `yyyy-mm-dd` and implements every method
 * Material's datepicker calls, so a spec can type into, pick from and read back a field the way a
 * host with a date library would. A component that assumes JS dates, by calling `getTime()` or
 * `toISOString()` on a field's value or by giving a field a JS `Date`, fails against it; Material's
 * `NativeDateAdapter` and its subclasses hold JS dates and cannot show that.
 */
@Injectable()
export class CalendarDayAdapter extends DateAdapter<CalendarDay> {
  getYear(date: CalendarDay): number {
    return date.year;
  }

  getMonth(date: CalendarDay): number {
    return date.month;
  }

  getDate(date: CalendarDay): number {
    return date.day;
  }

  getDayOfWeek(date: CalendarDay): number {
    return new Date(utc(date)).getUTCDay();
  }

  getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    return shorten(MONTHS, style);
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, i) => String(i + 1));
  }

  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    return shorten(WEEKDAYS, style);
  }

  getYearName(date: CalendarDay): string {
    return String(date.year);
  }

  getFirstDayOfWeek(): number {
    return 0;
  }

  getNumDaysInMonth(date: CalendarDay): number {
    return fromUtc(utc({ year: date.year, month: date.month + 1, day: 0 })).day;
  }

  clone(date: CalendarDay): CalendarDay {
    return { ...date };
  }

  createDate(year: number, month: number, day: number): CalendarDay {
    const date = { year, month, day };
    if (!this.isValid(date)) throw new Error(`CalendarDayAdapter: no day ${year}-${month}-${day}`);
    return date;
  }

  today(): CalendarDay {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }

  parse(value: unknown): CalendarDay | null {
    if (this.isDateInstance(value)) return this.clone(value as CalendarDay);
    if (typeof value !== 'string' || !value.trim()) return null;
    const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(value);
    if (!match) return this.invalid();
    const date = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
    return this.isValid(date) ? date : this.invalid();
  }

  format(date: CalendarDay): string {
    if (!this.isValid(date)) throw new Error('CalendarDayAdapter: cannot format an invalid date');
    return this.toIso8601(date);
  }

  addCalendarYears(date: CalendarDay, years: number): CalendarDay {
    return this.addCalendarMonths(date, years * 12);
  }

  addCalendarMonths(date: CalendarDay, months: number): CalendarDay {
    const index = date.year * 12 + date.month + months;
    const target = { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12, day: 1 };
    return { ...target, day: Math.min(date.day, this.getNumDaysInMonth(target)) };
  }

  addCalendarDays(date: CalendarDay, days: number): CalendarDay {
    return fromUtc(utc(date) + days * DAY_MS);
  }

  toIso8601(date: CalendarDay): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${String(date.year).padStart(4, '0')}-${two(date.month + 1)}-${two(date.day)}`;
  }

  isDateInstance(obj: unknown): boolean {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      !(obj instanceof Date) &&
      ['year', 'month', 'day'].every(
        (field) => typeof (obj as Record<string, unknown>)[field] === 'number',
      )
    );
  }

  isValid(date: CalendarDay): boolean {
    const { year, month, day } = date;
    if (![year, month, day].every(Number.isInteger) || month < 0 || month > 11 || day < 1) {
      return false;
    }
    return day <= fromUtc(utc({ year, month: month + 1, day: 0 })).day;
  }

  invalid(): CalendarDay {
    return { year: Number.NaN, month: Number.NaN, day: Number.NaN };
  }

  /** `yyyy-mm-dd`, the one text it takes as unambiguous; otherwise as `DateAdapter` does. */
  override deserialize(value: unknown): CalendarDay | null {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return this.parse(value);
    return super.deserialize(value);
  }
}
