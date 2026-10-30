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
  /** The calendar day `instant` names, as the adapter holds it: the UTC one (NXSAT-727). */
  const utcDay = { year: 2027, month: 0, day: 31 };

  it('starts a date control on the adapter’s date for the property’s UTC day', () => {
    expect(buildControl({ type: 'date' }, instant, calendarDays).value).toEqual(utcDay);
    expect(buildControl({ type: 'date' }, 'nonsense', calendarDays).value).toBeNull();
    expect(buildControl({ type: 'date' }, null, calendarDays).value).toBeNull();
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
    expect(control.value).toEqual({ due: utcDay, note: 'x' });
    expect(propertyValue(definition, control, calendarDays)).toEqual({ due: instant, note: 'x' });
  });

  it('holds the property’s calendar day, and still writes its instant, for a JS-date adapter', () => {
    // The control holds the day at local midnight, not the instant: the field edits only a day,
    // and `dateProperty` has to compare the day the control names against the day the instant
    // names in UTC. Holding the instant made those two disagree west of UTC, so an untouched
    // field was rewritten a day earlier (NXSAT-727).
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
 * UTC the defect and the fix are byte-identical — and a CI runner is UTC. The literals below are
 * the correct answer in *every* zone, so they stay true if the pin is ever changed; what the pin
 * buys is that they go red when the anchoring regresses.
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

  it('opens the picker on the day the value names in UTC, not the day it names locally', () => {
    // 20:00Z is the next day east of UTC+04:00, so reading the local day gives 7 March here.
    const instant = '2024-03-06T20:00:00.000Z';
    const control = buildControl({ type: 'date' }, instant, calendarDays);
    expect(control.value).toEqual({ year: 2024, month: 2, day: 6 });
    // And the write-back agrees with the read: untouched, it is the same instant, time of day
    // included. If the two sides disagreed about which day this is, an edit of a neighbouring
    // field would silently rewrite this one — which is what `sameCalendarDay` exists to prevent,
    // and what comparing a UTC day against a local day used to do.
    expect(propertyValue({ type: 'date' }, control, calendarDays)).toBe(instant);
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
    // here even though it recovers more of the days the old code mis-stored.
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
