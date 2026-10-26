import type { DateAdapter } from '@angular/material/core';

/**
 * The two crossings between a date field's own dates and the JS `Date`s the rest of the library
 * computes with. A field holds dates as its adapter does: `NxsLocaleDateAdapter`, Material's native
 * adapter and date-fns hold JS `Date`s, but a host's Luxon adapter holds a `DateTime`, Moment a
 * `Moment`, and another library something else again. `provideNxsDateAdapter()` keeps a host's
 * adapter, so a field's value is whatever that adapter holds, and code that calls `getTime()` on
 * it throws.
 *
 * Kept off the library's index: they are how its own components meet an adapter, not an API.
 */

/**
 * The calendar day a date field's value names, as a JS `Date` at local midnight; `null` when there
 * is none or it is not a valid date.
 *
 * A JS `Date` is returned as it is, time of day included, so a field whose adapter holds JS dates
 * reads exactly as it did before adapters were kept. Any other date is read through the adapter's
 * `isValid`, `getYear`, `getMonth` and `getDate`.
 */
export function nxsDateFromAdapter(adapter: DateAdapter<unknown>, value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined) return null;
  if (!adapter.isDateInstance(value) || !adapter.isValid(value)) return null;
  const year = adapter.getYear(value);
  const month = adapter.getMonth(value);
  const day = adapter.getDate(value);
  const date = new Date(year, month, day);
  // `new Date` reads a year below 100 as 19xx.
  date.setFullYear(year, month, day);
  return date;
}

/**
 * A JS `Date`'s calendar day as the date field's adapter holds a date, for the field's value: the
 * inverse of {@link nxsDateFromAdapter}. `null` for no date or an invalid one.
 *
 * An adapter that holds JS dates gets `date` itself, time of day included, as it did before
 * adapters were kept. Any other gets its own date for the same local day, from its `createDate`.
 */
export function nxsDateToAdapter<D>(adapter: DateAdapter<D>, date: Date | null): D | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  if (adapter.isDateInstance(date)) return date as D;
  return adapter.createDate(date.getFullYear(), date.getMonth(), date.getDate());
}
