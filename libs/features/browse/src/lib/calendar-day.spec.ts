import { calendarDayOf } from './calendar-day';

/**
 * The day Browse's edit-metadata dialog (`edit-metadata-dialog`) opens `dc:expired` on: its UTC
 * day, whatever the value holds. Its constructor calls `calendarDayOf` on the stored value, and its own
 * spec's 20:00Z case covers that call. This file pins the conversion for the case documented in
 * `docs/extension-reference.md` ("`dc:expired` is read two ways").
 *
 * The edit form (`nxs-metadata-editor`) opens an instant on the reader's day, as the layout view
 * shows it, so for a `dc:expired` that is not a stored day the two can open on different days.
 * Leaving this read on the UTC day is deliberate: it is how the Properties panel's Expires row
 * shows `dc:expired`, so this dialog agrees with the row beside it. One predicate exported for
 * every surface would close the gap; that decision is deferred, not rejected.
 *
 * Literal days, under the suite's pinned +05:30 (`vite.config.mts`), where the local day and the
 * UTC day of 18:30Z differ.
 */
describe('calendarDayOf', () => {
  const fields = (day: Date | null) => day && [day.getFullYear(), day.getMonth(), day.getDate()];

  it('opens a day Web UI wrote at local midnight at +05:30 on its UTC day, the 5th', () => {
    // 6 March picked in Web UI at +05:30 is stored as 18:30Z on the 5th. The edit form opens it
    // on the 6th for a reader at +05:30; this dialog, like the Expires row, on the 5th.
    expect(fields(calendarDayOf('2024-03-05T18:30:00.000Z'))).toEqual([2024, 2, 5]);
  });

  it('opens a stored day on that day, as every other surface does', () => {
    expect(fields(calendarDayOf('2024-03-06T00:00:00.000Z'))).toEqual([2024, 2, 6]);
    expect(fields(calendarDayOf('2024-03-06'))).toEqual([2024, 2, 6]);
  });
});
