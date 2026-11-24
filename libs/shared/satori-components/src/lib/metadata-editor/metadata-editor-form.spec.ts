import { Injector } from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';

import { CalendarDayAdapter } from '../date-input/calendar-day-adapter.mock';
import { NxsLocaleDateAdapter } from '../date-input/locale-date';
import {
  MAX_COMPLEX_DEPTH,
  buildControl,
  fieldKind,
  firstError,
  newComplexItem,
  openingDay,
  propertyValue,
} from './metadata-editor-form';
import type { NxsEditorFieldType } from './metadata-editor.model';

/** The editor's own adapter, which holds JS dates. */
const dates = Injector.create({ providers: [{ provide: NxsLocaleDateAdapter }] }).get(
  NxsLocaleDateAdapter,
);
/** A host's adapter that holds calendar days, `{ year, month, day }`, rather than JS dates. */
const calendarDays = new CalendarDayAdapter();

const errorsOf = (definition: NxsEditorFieldType, value: unknown) =>
  buildControl(definition, value, dates).errors;

describe('fieldKind', () => {
  it('chooses a control from the type, the vocabulary and whether it is a list', () => {
    expect(fieldKind({ type: 'string' })).toBe('text');
    expect(fieldKind({ type: 'long' })).toBe('number');
    expect(fieldKind({ type: 'double' })).toBe('number');
    expect(fieldKind({ type: 'date' })).toBe('date');
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'string', directory: 'nature' })).toBe('vocabulary');
    expect(fieldKind({ type: 'string[]', directory: 'l10nsubjects' })).toBe('vocabulary-list');
    expect(fieldKind({ type: 'string[]' })).toBe('list');
    expect(fieldKind({ type: 'blob' })).toBe('read-only');
    expect(fieldKind({ type: 'blob[]' })).toBe('read-only');
  });

  it('edits a complex field with sub-fields, down to a depth limit', () => {
    const complex: NxsEditorFieldType = { type: 'complex', fields: { a: { type: 'string' } } };
    expect(fieldKind(complex)).toBe('complex');
    expect(fieldKind({ ...complex, type: 'complex[]' })).toBe('complex-list');
    expect(fieldKind(complex, MAX_COMPLEX_DEPTH)).toBe('read-only');
    expect(fieldKind({ type: 'complex' })).toBe('read-only');
  });
});

describe('buildControl validation', () => {
  it('requires a value that is not blank, and a list that is not empty', () => {
    expect(errorsOf({ type: 'string', required: true }, '   ')).toEqual({ required: true });
    expect(errorsOf({ type: 'string[]', required: true }, [])).toEqual({ required: true });
    expect(errorsOf({ type: 'long', required: true }, null)).toEqual({ required: true });
    expect(errorsOf({ type: 'string', required: true }, 'x')).toBeNull();
  });

  it('checks no constraint on an empty optional value', () => {
    expect(
      errorsOf({ type: 'string', constraints: { minLength: 3, pattern: '\\d+' } }, ''),
    ).toBeNull();
  });

  it('matches a pattern against the whole value, as Nuxeo does, and skips one it cannot compile', () => {
    expect(errorsOf({ type: 'string', constraints: { pattern: '\\d+' } }, '12a')).toEqual({
      pattern: true,
    });
    expect(errorsOf({ type: 'string', constraints: { pattern: '\\d+' } }, '12')).toBeNull();
    expect(errorsOf({ type: 'string', constraints: { pattern: '(' } }, 'anything')).toBeNull();
  });

  it('checks length on the trimmed text', () => {
    expect(errorsOf({ type: 'string', constraints: { minLength: 3 } }, ' ab ')).toEqual({
      minLength: { count: 3 },
    });
    expect(errorsOf({ type: 'string', constraints: { maxLength: 2 } }, ' ab ')).toBeNull();
  });

  it('honours inclusive and exclusive bounds', () => {
    const inclusive: NxsEditorFieldType = {
      type: 'double',
      constraints: { minimum: 1, maximum: 2 },
    };
    expect(errorsOf(inclusive, 1)).toBeNull();
    expect(errorsOf(inclusive, 2)).toBeNull();
    expect(errorsOf(inclusive, 0.5)).toEqual({ minimum: { bound: 1, inclusive: true } });
    const exclusive: NxsEditorFieldType = {
      type: 'double',
      constraints: { minimum: 1, maximum: 2, minimumInclusive: false, maximumInclusive: false },
    };
    expect(errorsOf(exclusive, 1)).toEqual({ minimum: { bound: 1, inclusive: false } });
    expect(errorsOf(exclusive, 2)).toEqual({ maximum: { bound: 2, inclusive: false } });
  });

  it('reads a number sent as text, and refuses what is not a number', () => {
    expect(buildControl({ type: 'long' }, '42', dates).value).toBe(42);
    expect(errorsOf({ type: 'long' }, 'abc')).toEqual({ number: true });
    expect(errorsOf({ type: 'integer' }, 1.5)).toEqual({ integer: true });
  });

  it('checks each item of a list against the constraints', () => {
    expect(errorsOf({ type: 'string[]', constraints: { maxLength: 2 } }, ['ok', 'long'])).toEqual({
      item: true,
    });
  });

  it('requires at least one entry in a required repeatable group', () => {
    const contacts: NxsEditorFieldType = {
      type: 'complex[]',
      required: true,
      fields: { name: { type: 'string' } },
    };
    const control = buildControl(contacts, [], dates);
    expect(control).toBeInstanceOf(FormArray);
    expect(control.errors).toEqual({ required: true });
    if (control instanceof FormArray) control.push(newComplexItem(contacts, dates, 0));
    control.updateValueAndValidity();
    expect(control.errors).toBeNull();
  });
});

describe('buildControl values', () => {
  it('starts each control in the shape it edits', () => {
    expect(buildControl({ type: 'date' }, '2027-01-31T00:00:00.000Z', dates).value).toBeInstanceOf(
      Date,
    );
    expect(buildControl({ type: 'date' }, 'nonsense', dates).value).toBeNull();
    expect(buildControl({ type: 'boolean' }, 'true', dates).value).toBe(true);
    expect(buildControl({ type: 'string' }, 7, dates).value).toBe('7');
    expect(buildControl({ type: 'string' }, null, dates).value).toBe('');
    expect(buildControl({ type: 'string[]' }, 'not a list', dates).value).toEqual([]);
    expect(buildControl({ type: 'blob' }, { name: 'a' }, dates).disabled).toBe(true);
  });

  it('builds a complex field as a group of its sub-fields, tolerating a missing value', () => {
    const control = buildControl(
      { type: 'complex', fields: { a: { type: 'string' } } },
      null,
      dates,
    );
    expect(control).toBeInstanceOf(FormGroup);
    expect(control.value).toEqual({ a: '' });
  });
});

describe('propertyValue', () => {
  it('sends dates as ISO text, blank text as null and single-line text trimmed', () => {
    // Built from local components, as a picker's value is — not parsed from a UTC instant, which
    // would name a different local day either side of UTC and make this assertion zone-dependent.
    expect(propertyValue({ type: 'date' }, new FormControl(new Date(2027, 0, 31)), dates)).toBe(
      '2027-01-31T00:00:00.000Z',
    );
    expect(propertyValue({ type: 'string' }, new FormControl('  '), dates)).toBeNull();
    expect(propertyValue({ type: 'string' }, new FormControl(' a '), dates)).toBe('a');
    expect(propertyValue({ type: 'string' }, new FormControl(' a '), dates, 0, true)).toBe(' a ');
    expect(propertyValue({ type: 'long' }, new FormControl(null), dates)).toBeNull();
  });

  it('sends a repeatable group as a list of objects', () => {
    const definition: NxsEditorFieldType = {
      type: 'complex[]',
      fields: { name: { type: 'string' }, age: { type: 'long' } },
    };
    const control = buildControl(definition, [{ name: 'Ann', age: '3' }, {}], dates);
    expect(propertyValue(definition, control, dates)).toEqual([
      { name: 'Ann', age: 3 },
      { name: null, age: null },
    ]);
  });
});

describe('dates, with an adapter that does not hold JS dates', () => {
  const instant = '2027-01-31T10:30:00.000Z';
  /**
   * The calendar day `instant` opens on, as the adapter holds it: the reader's, since it is not a
   * stored day. `10:30Z` is 31 January from UTC−10:30 to UTC+13:29, so this literal holds for the
   * pinned zone and for the zones this suite is deliberately run in (see the block below).
   */
  const day = { year: 2027, month: 0, day: 31 };

  it('starts a date control on the adapter’s date for the day the property opens on', () => {
    expect(buildControl({ type: 'date' }, instant, calendarDays).value).toEqual(day);
    expect(buildControl({ type: 'date' }, 'nonsense', calendarDays).value).toBeNull();
    expect(buildControl({ type: 'date' }, null, calendarDays).value).toBeNull();
  });

  it('opens a stored day in a year below 100 in that year, which `new Date` would read as 19xx', () => {
    const control = buildControl({ type: 'date' }, '0050-06-15', calendarDays);
    expect(control.value).toEqual({ year: 50, month: 5, day: 15 });
    expect((buildControl({ type: 'date' }, '0050-06-15', dates).value as Date).getFullYear()).toBe(
      50,
    );
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe('0050-06-15T00:00:00.000Z');
  });

  it('writes back the instant it was built from, time of day included, while its day is kept', () => {
    const control = buildControl({ type: 'date' }, instant, calendarDays);
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe(instant);
  });

  it('writes a day picked in the field as an ISO instant at its UTC midnight', () => {
    const control = buildControl({ type: 'date' }, instant, calendarDays);
    control.setValue(calendarDays.createDate(2028, 1, 29));
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe('2028-02-29T00:00:00.000Z');
    const empty = buildControl({ type: 'date' }, null, calendarDays);
    empty.setValue(calendarDays.createDate(2028, 0, 2));
    expect(propertyValue({ type: 'date' }, empty, calendarDays)).toBe('2028-01-02T00:00:00.000Z');
  });

  it('writes no date for a cleared field or one holding no valid date', () => {
    const control = buildControl({ type: 'date' }, instant, calendarDays);
    control.setValue(null);
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBeNull();
    control.setValue(calendarDays.invalid());
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBeNull();
  });

  it('does the same for a date inside a complex field', () => {
    const definition: NxsEditorFieldType = {
      type: 'complex',
      fields: { due: { type: 'date' }, note: { type: 'string' } },
    };
    const control = buildControl(definition, { due: instant, note: 'x' }, calendarDays);
    expect(control.value).toEqual({ due: day, note: 'x' });
    expect(propertyValue(definition, control, calendarDays)).toEqual({ due: instant, note: 'x' });
  });

  it('holds the property’s calendar day, and still writes its instant, for a JS-date adapter', () => {
    // The control holds the day at local midnight, not the instant: the field edits only a day,
    // and `dateProperty` has to compare the day the control names against the day it was given.
    // Holding the instant made those two disagree west of UTC, so an untouched field was
    // rewritten a day earlier (NXSAT-727).
    const control = buildControl({ type: 'date' }, instant, dates);
    expect(control.value).toEqual(new Date(2027, 0, 31));
    expect(propertyValue({ type: 'date' }, control, dates)).toBe(instant);
  });
});

/**
 * The calendar day a user picks must become the same instant whatever zone they are in, and must
 * come back as the day they picked (NXSAT-727).
 *
 * **These cases only assert anything outside UTC**, which is why `vite.config.mts` pins the suite
 * to `Asia/Calcutta`. Anchoring a day locally and anchoring it in UTC agree exactly in UTC, so in
 * UTC the defect and the fix are byte-identical — and a CI runner is UTC. The literals below do
 * not depend on the zone, or, where a value opens on the reader's day, hold across the range each
 * case states, the pinned zone and New York included. What the pin buys is that they go red when
 * the anchoring regresses.
 *
 * Setting `process.env.TZ` from inside a case does **not** work here and must not be used: Vitest
 * runs this project `pool: 'threads'` and Node reads the zone once at startup, so the assignment
 * is accepted and ignored. Measured — a four-zone loop written that way ran the host zone four
 * times and read as if it covered four.
 *
 * The west-of-UTC direction, where a naive form-only fix would have moved the same off-by-one
 * instead of removing it, is proved by running this suite under
 * `SATORI_TEST_TZ=America/New_York` — **not** `TZ`, which `vite.config.mts` overrides on purpose —
 * and by the browser capture in that zone; both are recorded on the ticket.
 */
describe('a picked calendar day is anchored in UTC', () => {
  it('is sent as that day at UTC midnight, not at the writer’s local midnight', () => {
    // What the field holds once the user has picked 6 March 2024: that day, at local midnight.
    const control = new FormControl(new Date(2024, 2, 6));
    expect(propertyValue({ type: 'date' }, control, dates)).toBe('2024-03-06T00:00:00.000Z');
  });

  it('round-trips through the form without drifting', () => {
    const control = buildControl({ type: 'date' }, '2024-03-06T00:00:00.000Z', dates);
    // Untouched: the instant the read returned, byte for byte.
    expect(propertyValue({ type: 'date' }, control, dates)).toBe('2024-03-06T00:00:00.000Z');
    // Moved on a day: the new day, still at UTC midnight.
    control.setValue(new Date(2024, 2, 7));
    expect(propertyValue({ type: 'date' }, control, dates)).toBe('2024-03-07T00:00:00.000Z');
  });

  it('names an afternoon instant’s own day, rather than rounding to the nearest midnight', () => {
    // The rejected alternative — `dayToDate`, the ACE heuristic — snaps a value that is not
    // midnight anywhere to the nearest UTC midnight, which would call this 6 March. A date field
    // renders arbitrary `date` properties, timestamps included, so that rounding is not available
    // here even though it recovers more of the days the old code mis-stored. The instant opens on
    // the reader's day, which is 5 March from UTC−14:23 to UTC+09:36.
    const control = buildControl({ type: 'date' }, '2024-03-05T14:23:11.000Z', calendarDays);
    expect(control.value).toEqual({ year: 2024, month: 2, day: 5 });
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe('2024-03-05T14:23:11.000Z');
  });

  it('anchors a bare date definition, the shape a layout-added field arrives as', () => {
    // The ticket reports `qa:d`, contributed by a layout rather than by the type's own schemas,
    // behaving identically to `dc:expired`. This case asserts the serialisation for a definition
    // with no schema context around it — which is the whole of what distinguishes the two, since
    // `applyLayoutFile` resolves a layout field to the schema's own definition and both reach
    // `propertyValue` through the same call in `metadata-editor.component.ts`.
    //
    // So: this proves the serialisation, and the shared call site is read from the code, not
    // asserted here. Naming this case after the layout field would claim the second half too.
    const layoutField: NxsEditorFieldType = { type: 'date' };
    const control = buildControl(layoutField, null, calendarDays);
    control.setValue(calendarDays.createDate(2024, 2, 6));
    expect(propertyValue(layoutField, control, calendarDays)).toBe('2024-03-06T00:00:00.000Z');
  });
});

/**
 * The day a value opens on follows the layout `date` view's rule (pattern 29): a stored day on
 * its UTC day, any other instant on the reader's. Before, every value opened on its UTC day, so at
 * +05:30 the view showed `2026-11-23T20:00:00Z` as 24 November and the form opened on the 23rd.
 *
 * These cases name the reader's zone through `openingDay`'s `offset`, so they do not depend on the
 * suite's zone and they run in CI. That matters for the stored-day half of the rule: east of UTC a
 * stored day's UTC midnight is on the same local day, so under the pin only a zone west of UTC
 * tells "a stored day on its UTC day" from "everything on the reader's day".
 */
describe('openingDay, in a zone the case names', () => {
  const WEST = -5 * 60; // New York in winter, UTC−05:00
  const EAST = 5 * 60 + 30; // Kolkata, UTC+05:30
  const CET = 60; // Paris in winter, UTC+01:00

  it('opens a stored day on its UTC day, west of UTC as well, where its local day is the day before', () => {
    // 00:00Z on 6 March is 19:00 on 5 March in New York. Opening it there on the 5th is the
    // defect NXSAT-727 fixed, and the form must not bring it back with the reader's day.
    expect(openingDay('2024-03-06T00:00:00.000Z', WEST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-06', WEST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-06T00:00:00+00:00', WEST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-06T00:00:00.000Z', EAST)).toEqual({ year: 2024, month: 2, day: 6 });
  });

  it('opens an instant on the reader’s day, both sides of UTC', () => {
    // The values in the defect: 20:00Z on 23 November is 01:30 on the 24th at +05:30.
    expect(openingDay('2026-11-23T20:00:00Z', EAST)).toEqual({ year: 2026, month: 10, day: 24 });
    expect(openingDay('2026-11-23T20:00:00Z', WEST)).toEqual({ year: 2026, month: 10, day: 23 });
    expect(openingDay('2026-11-23T20:00:00Z', 0)).toEqual({ year: 2026, month: 10, day: 23 });
    // 03:00Z on 24 November is 22:00 on the 23rd in New York.
    expect(openingDay('2026-11-24T03:00:00Z', WEST)).toEqual({ year: 2026, month: 10, day: 23 });
    expect(openingDay('2026-11-24T03:00:00Z', EAST)).toEqual({ year: 2026, month: 10, day: 24 });
  });

  it('opens a millisecond past midnight UTC as an instant, not as a stored day', () => {
    expect(openingDay('2024-03-06T00:00:00.001Z', WEST)).toEqual({ year: 2024, month: 2, day: 5 });
  });

  it('opens a value written at local midnight by another client on the day picked, in that zone', () => {
    // Nuxeo Web UI writes 6 March picked in Paris as 23:00Z on the 5th. It is not a stored day, so
    // it opens on the reader's day: the 6th in Paris and east of it, the 5th west of UTC. Midnight
    // written with the writer's own offset is the same instant, read the same way.
    expect(openingDay('2024-03-05T23:00:00.000Z', CET)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-05T23:00:00.000Z', EAST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-05T23:00:00.000Z', WEST)).toEqual({ year: 2024, month: 2, day: 5 });
    expect(openingDay('2024-03-06T00:00:00-05:00', WEST)).toEqual({ year: 2024, month: 2, day: 6 });
  });

  it('opens a day Web UI wrote at local midnight at +05:30 on the day picked, for a reader there', () => {
    // 6 March picked in Web UI at +05:30 is stored as 18:30Z on the 5th. The form opens it on
    // 6 March there and on 5 March in New York. The Expires row, the two `dc:expired` dialogs and
    // the Expired queue read it on its UTC day, 5 March, everywhere: their specs assert that day
    // for this same value. A stored day, below, is 6 March on every one of those surfaces.
    expect(openingDay('2024-03-05T18:30:00.000Z', EAST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-05T18:30:00.000Z', WEST)).toEqual({ year: 2024, month: 2, day: 5 });
    expect(openingDay('2024-03-06T00:00:00.000Z', EAST)).toEqual({ year: 2024, month: 2, day: 6 });
    expect(openingDay('2024-03-06T00:00:00.000Z', WEST)).toEqual({ year: 2024, month: 2, day: 6 });
  });

  it('reads a JS Date as an instant, as the layout view does', () => {
    expect(openingDay(new Date('2024-03-06T00:00:00.000Z'), WEST)).toEqual({
      year: 2024,
      month: 2,
      day: 5,
    });
  });

  it('keeps a year below 100, which `new Date` would read as 19xx', () => {
    expect(openingDay('0050-06-15T20:00:00.000Z', EAST)).toEqual({ year: 50, month: 5, day: 16 });
    expect(openingDay('0050-06-15', WEST)).toEqual({ year: 50, month: 5, day: 15 });
  });

  it('opens nothing for a value that holds no valid date', () => {
    expect(openingDay(null, WEST)).toBeNull();
    expect(openingDay('', WEST)).toBeNull();
    expect(openingDay('nonsense', WEST)).toBeNull();
  });
});

/**
 * The same rule through `buildControl`, which reads the reader's zone from the browser, as the
 * picker's calendar and the view do. A case here has to name the zone this run is in, so its
 * literals are listed per zone: the pinned one, and New York for the deliberate west-of-UTC run.
 * In any other zone the first case says so and the rest do not run.
 */
describe('the day a date control opens on, in the zone this run is in', () => {
  const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

  interface Day {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  }
  /**
   * A value, the day it opens on in a zone, why, and what it writes back while that day is kept.
   * `moved` is a different day, the instant's UTC day, and what picking it writes.
   */
  interface Opening {
    readonly value: string;
    readonly opens: Day;
    readonly why: string;
    readonly writes: string;
    readonly moved?: { readonly to: Day; readonly writes: string };
  }
  const OPENS_ON: Readonly<Record<string, readonly Opening[]>> = {
    'Asia/Calcutta': [
      {
        value: '2026-11-23T20:00:00Z',
        opens: { year: 2026, month: 10, day: 24 },
        why: 'an instant, 01:30 on the 24th here',
        writes: '2026-11-23T20:00:00.000Z',
      },
      {
        value: '2024-03-06T20:00:00.000Z',
        opens: { year: 2024, month: 2, day: 7 },
        why: 'an instant, 01:30 on the 7th here',
        writes: '2024-03-06T20:00:00.000Z',
        moved: { to: { year: 2024, month: 2, day: 6 }, writes: '2024-03-06T00:00:00.000Z' },
      },
      {
        value: '2024-03-05T18:30:00.000Z',
        opens: { year: 2024, month: 2, day: 6 },
        why: '6 March as Web UI writes it here, local midnight',
        writes: '2024-03-05T18:30:00.000Z',
        moved: { to: { year: 2024, month: 2, day: 5 }, writes: '2024-03-05T00:00:00.000Z' },
      },
      {
        value: '2024-03-06T00:00:00.000Z',
        opens: { year: 2024, month: 2, day: 6 },
        why: 'a stored day',
        writes: '2024-03-06T00:00:00.000Z',
      },
    ],
    'America/New_York': [
      {
        value: '2026-11-24T03:00:00Z',
        opens: { year: 2026, month: 10, day: 23 },
        why: 'an instant, 22:00 on the 23rd here',
        writes: '2026-11-24T03:00:00.000Z',
        moved: { to: { year: 2026, month: 10, day: 24 }, writes: '2026-11-24T00:00:00.000Z' },
      },
      {
        value: '2024-03-06T00:00:00.001Z',
        opens: { year: 2024, month: 2, day: 5 },
        why: 'an instant, 19:00 on the 5th here',
        writes: '2024-03-06T00:00:00.001Z',
      },
      {
        value: '2024-03-06T00:00:00.000Z',
        opens: { year: 2024, month: 2, day: 6 },
        why: 'a stored day, though 19:00 on the 5th here',
        writes: '2024-03-06T00:00:00.000Z',
      },
      {
        value: '2024-03-06',
        opens: { year: 2024, month: 2, day: 6 },
        why: 'a bare stored day',
        writes: '2024-03-06T00:00:00.000Z',
      },
      {
        value: '2024-03-05T18:30:00.000Z',
        opens: { year: 2024, month: 2, day: 5 },
        why: '6 March as Web UI writes it at +05:30, 13:30 on the 5th here',
        writes: '2024-03-05T18:30:00.000Z',
      },
    ],
  };
  const here = OPENS_ON[ZONE] ?? [];

  it('reports whether this run can assert anything, rather than passing silently', () => {
    expect(typeof ZONE).toBe('string');
    if (here.length === 0) {
      console.warn(
        `zone ${ZONE} has no literals in this block; its cases do not run. ` +
          'They run under the pin, and with SATORI_TEST_TZ=America/New_York.',
      );
    }
  });

  for (const { value, opens, why, writes, moved } of here) {
    it(`opens ${value}, ${why}, on that day, and writes ${writes} back untouched`, () => {
      const held = buildControl({ type: 'date' }, value, calendarDays);
      expect(held.value).toEqual(opens);
      expect(propertyValue({ type: 'date' }, held, calendarDays)).toBe(writes);
      // The editor's own adapter, which holds JS dates at local midnight.
      const local = buildControl({ type: 'date' }, value, dates);
      expect(local.value).toEqual(new Date(opens.year, opens.month, opens.day));
      expect(propertyValue({ type: 'date' }, local, dates)).toBe(writes);
    });

    it(`writes ${value} back when the day it opened on is cleared and typed again`, () => {
      const control = buildControl({ type: 'date' }, value, calendarDays);
      control.setValue(null);
      control.setValue(calendarDays.createDate(opens.year, opens.month, opens.day));
      expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe(writes);
    });

    if (moved) {
      it(`writes ${value} moved to its UTC day as that day at UTC midnight: an edit here`, () => {
        // Its UTC day is not the day it opened on here, so picking it is a change of day.
        const control = buildControl({ type: 'date' }, value, calendarDays);
        control.setValue(calendarDays.createDate(moved.to.year, moved.to.month, moved.to.day));
        expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe(moved.writes);
      });
    }
  }
});

describe('firstError', () => {
  it('reports the most fundamental error first, the server message above all', () => {
    const control = new FormControl('');
    control.setErrors({ pattern: true, required: true });
    expect(firstError(control)?.key).toBe('required');
    control.setErrors({ required: true, server: 'Taken' });
    expect(firstError(control)).toEqual({ key: 'server', params: { message: 'Taken' } });
    control.setErrors({ nxsDateParse: { text: 'x' } });
    expect(firstError(control)?.key).toBe('date');
    control.setErrors({ maximum: { bound: 2, inclusive: false } });
    expect(firstError(control)).toEqual({
      key: 'maximum-exclusive',
      params: { bound: 2, inclusive: false },
    });
    control.setErrors({ minLength: { count: 3 } });
    expect(firstError(control)).toEqual({ key: 'minLength', params: { count: 3 } });
    control.setErrors({ somethingElse: true });
    expect(firstError(control)?.key).toBe('invalid');
    control.setErrors(null);
    expect(firstError(control)).toBeNull();
  });
});
