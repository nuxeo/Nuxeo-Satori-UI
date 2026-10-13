import { FormArray, FormControl, FormGroup } from '@angular/forms';

import {
  MAX_COMPLEX_DEPTH,
  buildControl,
  fieldKind,
  firstError,
  newComplexItem,
  propertyValue,
} from './metadata-editor-form';
import type { NxsEditorFieldType } from './metadata-editor.model';

const errorsOf = (definition: NxsEditorFieldType, value: unknown) =>
  buildControl(definition, value).errors;

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
    expect(buildControl({ type: 'long' }, '42').value).toBe(42);
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
    const control = buildControl(contacts, []);
    expect(control).toBeInstanceOf(FormArray);
    expect(control.errors).toEqual({ required: true });
    if (control instanceof FormArray) control.push(newComplexItem(contacts, 0));
    control.updateValueAndValidity();
    expect(control.errors).toBeNull();
  });
});

describe('buildControl values', () => {
  it('starts each control in the shape it edits', () => {
    expect(buildControl({ type: 'date' }, '2027-01-31T00:00:00.000Z').value).toBeInstanceOf(Date);
    expect(buildControl({ type: 'date' }, 'nonsense').value).toBeNull();
    expect(buildControl({ type: 'boolean' }, 'true').value).toBe(true);
    expect(buildControl({ type: 'string' }, 7).value).toBe('7');
    expect(buildControl({ type: 'string' }, null).value).toBe('');
    expect(buildControl({ type: 'string[]' }, 'not a list').value).toEqual([]);
    expect(buildControl({ type: 'blob' }, { name: 'a' }).disabled).toBe(true);
  });

  it('builds a complex field as a group of its sub-fields, tolerating a missing value', () => {
    const control = buildControl({ type: 'complex', fields: { a: { type: 'string' } } }, null);
    expect(control).toBeInstanceOf(FormGroup);
    expect(control.value).toEqual({ a: '' });
  });
});

describe('propertyValue', () => {
  it('sends dates as ISO text, blank text as null and single-line text trimmed', () => {
    expect(
      propertyValue({ type: 'date' }, new FormControl(new Date('2027-01-31T00:00:00.000Z'))),
    ).toBe('2027-01-31T00:00:00.000Z');
    expect(propertyValue({ type: 'string' }, new FormControl('  '))).toBeNull();
    expect(propertyValue({ type: 'string' }, new FormControl(' a '))).toBe('a');
    expect(propertyValue({ type: 'string' }, new FormControl(' a '), 0, true)).toBe(' a ');
    expect(propertyValue({ type: 'long' }, new FormControl(null))).toBeNull();
  });

  it('sends a repeatable group as a list of objects', () => {
    const definition: NxsEditorFieldType = {
      type: 'complex[]',
      fields: { name: { type: 'string' }, age: { type: 'long' } },
    };
    const control = buildControl(definition, [{ name: 'Ann', age: '3' }, {}]);
    expect(propertyValue(definition, control)).toEqual([
      { name: 'Ann', age: 3 },
      { name: null, age: null },
    ]);
  });
});

describe('firstError', () => {
  it('reports the most fundamental error first, the server message above all', () => {
    const control = new FormControl('');
    control.setErrors({ pattern: true, required: true });
    expect(firstError(control)?.key).toBe('required');
    control.setErrors({ required: true, server: 'Taken' });
    expect(firstError(control)).toEqual({ key: 'server', params: { message: 'Taken' } });
    control.setErrors({ matDatepickerParse: { text: 'x' } });
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
