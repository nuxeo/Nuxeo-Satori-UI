import type { LayoutFieldType } from '../layout.model';
import {
  FieldView,
  ValueContext,
  describeField,
  linkedRecordIds,
  vocabularyValues,
} from './field-view';

// Every case names its zone, as an offset, rather than inheriting the suite's. CI runs in UTC,
// where an instant's UTC day and its day in the reader's zone are the same day, so a date case that
// left the zone to the host would pass whichever way the view formatted (pattern 29).
const context: ValueContext = {
  locale: 'en-US',
  vocabulary: (directory, id) =>
    directory === 'claim_status' && id === 'pending' ? 'Pending review' : id,
  timeZone: '+0530',
};

const describe1 = (type: string, value: unknown, extra: Record<string, unknown> = {}): FieldView =>
  describeField('x:f', 'F', { type, ...extra }, value, context);

const dateIn = (timeZone: string, value: unknown): FieldView =>
  describeField('x:f', 'F', { type: 'date' }, value, { ...context, timeZone });

describe('describeField', () => {
  it('shows a list of only empty entries as empty, not as an empty chip list', () => {
    expect(describe1('string[]', ['', null]).kind).toBe('empty');
    expect(describe1('complex[]', [null], { fields: { a: { type: 'string' } } }).kind).toBe(
      'empty',
    );
  });

  it.each([null, undefined, '', []])('shows %j as empty', (value) => {
    expect(describe1('string', value).kind).toBe('empty');
  });

  /**
   * A complex value's sub-fields are read by own keys only. With no subfields read the names are
   * the value's own, and one every object inherits found a function or an object in `{}` where a
   * type was expected, and describing it threw; a listed one the value lacks found a function.
   */
  it('describes a complex value by its own keys only, inherited names included', () => {
    const subs = (view: FieldView) =>
      (view.groups?.[0] ?? []).map((sub) => [sub.key, sub.kind, sub.value]);
    const unlisted = JSON.parse('{"code":"A","constructor":"x","__proto__":"y"}');
    expect(subs(describe1('complex', unlisted))).toEqual(
      expect.arrayContaining([
        ['code', 'value', { text: 'A' }],
        ['constructor', 'value', { text: 'x' }],
        ['__proto__', 'value', { text: 'y' }],
      ]),
    );
    expect(
      subs(
        describe1(
          'complex',
          { code: 'A' },
          {
            fields: { code: { type: 'string' }, toString: { type: 'string' } },
          },
        ),
      ),
    ).toEqual([
      ['code', 'value', { text: 'A' }],
      ['toString', 'empty', undefined],
    ]);
  });

  it('shows a string as text, and a vocabulary-bound one by its entry label', () => {
    expect(describe1('string', 'Northside').value).toEqual({ text: 'Northside' });
    expect(describe1('string', 'pending', { directory: 'claim_status' }).value).toEqual({
      text: 'Pending review',
    });
    expect(describe1('string', 'unknown', { directory: 'claim_status' }).value).toEqual({
      text: 'unknown',
    });
  });

  it.each<[string, string, string]>([
    // The value, the reader's zone, and the day shown: in that zone it would be the day before.
    ['2026-11-24T00:00:00.000Z', '-0500', 'November 24, 2026'],
    ['2026-11-24T00:00:00Z', '-0800', 'November 24, 2026'],
    ['2026-11-24T00:00Z', '-0300', 'November 24, 2026'],
    ['2026-11-24T00:00:00+00:00', '-1000', 'November 24, 2026'],
    ['2026-11-24', '-0500', 'November 24, 2026'],
  ])('shows %s, a stored day, on its UTC day for a reader at %s', (value, zone, expected) => {
    expect(dateIn(zone, value).value).toEqual({ text: expected });
  });

  it.each<[string, string, string]>([
    // The value, the reader's zone, and the day shown there. Each one's UTC day is the other day.
    ['2026-11-23T20:00:00Z', '+0530', 'November 24, 2026'],
    ['2026-11-23T20:00:00.000Z', '+0900', 'November 24, 2026'],
    ['2026-11-24T03:00:00.000Z', '-0500', 'November 23, 2026'],
    ['2026-11-24T00:00:00.001Z', '-0500', 'November 23, 2026'],
    ['2026-11-24T00:00:00-00:00', '-0500', 'November 23, 2026'],
    ['2026-11-24T00:00:00+05:30', '+0530', 'November 24, 2026'],
  ])('shows %s, an instant, on the reader’s day at %s', (value, zone, expected) => {
    expect(dateIn(zone, value).value).toEqual({ text: expected });
  });

  it('shows the same instant on a different day to readers west and east of UTC', () => {
    // dc:created at 20:00 UTC: still the 23rd in New York, already the 24th in Kolkata.
    expect(dateIn('-0500', '2026-11-23T20:00:00Z').value).toEqual({ text: 'November 23, 2026' });
    expect(dateIn('+0530', '2026-11-23T20:00:00Z').value).toEqual({ text: 'November 24, 2026' });
  });

  it('shows a stored day and an instant in one list each in its own zone', () => {
    const view = describeField(
      'x:f',
      'F',
      { type: 'date[]' },
      ['2026-11-24T00:00:00.000Z', '2026-11-24T03:00:00.000Z'],
      { ...context, timeZone: '-0500' },
    );
    expect(view.chips).toEqual([{ text: 'November 24, 2026' }, { text: 'November 23, 2026' }]);
  });

  it('shows an instant at exactly midnight UTC as a stored day: the one known misreading', () => {
    // A dc:created stamped at 00:00:00.000Z is the evening of the 23rd in New York, but nothing in
    // the value tells it from a day Nuxeo stored.
    expect(dateIn('-0500', '2026-11-24T00:00:00.000Z').value).toEqual({
      text: 'November 24, 2026',
    });
  });

  it('shows a date as a long date, and an unparseable one as written', () => {
    expect(describe1('date', '2026-09-14T12:00:00.000Z').value).toEqual({
      text: 'September 14, 2026',
    });
    expect(describe1('date', 'not a date').value).toEqual({ text: 'not a date' });
  });

  it('shows numbers in the locale', () => {
    expect(describe1('double', 2480).value).toEqual({ text: '2,480' });
    expect(describe1('double', 1735.5).value).toEqual({ text: '1,735.5' });
    expect(describe1('long', 3).value).toEqual({ text: '3' });
    expect(describe1('long', '12').value).toEqual({ text: '12' });
  });

  /**
   * NXSAT-725. `formatNumber`'s default digits format is `1.0-3`, so the panel showed a number
   * that was not the stored value, and a non-zero value as `0`. The edit form stores and shows
   * the full value (`step="any"` for a double), so the view disagreed with the form.
   */
  it('shows a decimal at full precision, rounding nothing', () => {
    expect(describe1('double', 3.14159265).value).toEqual({ text: '3.14159265' });
    expect(describe1('double', 100.0005).value).toEqual({ text: '100.0005' });
    expect(describe1('double', 19.999999).value).toEqual({ text: '19.999999' });
  });

  it('shows a small decimal as itself rather than as zero', () => {
    // The worst of the reported cases: a non-zero measurement read as absent.
    expect(describe1('double', 0.0004).value).toEqual({ text: '0.0004' });
    expect(describe1('double', -0.0004).value).toEqual({ text: '-0.0004' });
    expect(describe1('double', 1e-7).value).toEqual({ text: '0.0000001' });
  });

  /**
   * Caught in review on PR 515. A digits format counts fractional *places*, not significant
   * digits, so any fixed maximum leaves the same defect intact below it — at `1.0-20`, `1e-21`
   * still rendered as `0`. The precision is derived per value instead, so there is no magnitude
   * at which the panel shows a number that is not the stored one.
   */
  it('shows a value below the old fixed limit rather than rounding it to zero', () => {
    expect(describe1('double', 1e-21).value).toEqual({ text: '0.000000000000000000001' });
    expect(describe1('double', -1e-21).value).toEqual({ text: '-0.000000000000000000001' });
  });

  it('keeps every digit of a value needing more than 20 fractional places', () => {
    expect(describe1('double', 1.23456789012345e-7).value).toEqual({
      text: '0.000000123456789012345',
    });
  });

  it('falls back to the round-trip form past the formatter ceiling, rather than to zero', () => {
    // Angular refuses a digits format above 100, and a denormal needs more. The exponential
    // form is the only exact one left; what matters is that it is not 0.
    expect(describe1('double', 5e-324).value).toEqual({ text: '5e-324' });
  });

  it('writes a large exponential value out in full, with grouping', () => {
    expect(describe1('double', 1e21).value).toEqual({ text: '1,000,000,000,000,000,000,000' });
  });

  it('keeps grouping while not rounding, so it is not String(value)', () => {
    // Full precision and thousands separators at once — the reason this is a digits format on
    // `formatNumber` rather than `String(value)`, which would drop the separator.
    expect(describe1('double', 123456789.12345679).value).toEqual({
      text: '123,456,789.12345679',
    });
  });

  it('hands a boolean to the template to translate, keeping false distinct from empty', () => {
    expect(describe1('boolean', true).value).toEqual({ flag: true });
    expect(describe1('boolean', false)).toMatchObject({ kind: 'value', value: { flag: false } });
    expect(describe1('boolean', 'true').value).toEqual({ flag: true });
    expect(describe1('boolean', 'maybe').value).toEqual({ text: 'maybe' });
  });

  it('shows a blob by its file name', () => {
    expect(describe1('blob', { name: 'claim.pdf', 'mime-type': 'application/pdf' }).value).toEqual({
      text: 'claim.pdf',
    });
  });

  it('shows a list as one chip per item, labelling vocabulary items', () => {
    expect(describe1('string[]', ['R51.9', '', 'G44.209'])).toMatchObject({
      kind: 'chips',
      chips: [{ text: 'R51.9' }, { text: 'G44.209' }],
    });
    expect(describe1('string[]', ['pending'], { directory: 'claim_status' }).chips).toEqual([
      { text: 'Pending review' },
    ]);
    expect(describe1('long[]', [1, 2000]).chips).toEqual([{ text: '1' }, { text: '2,000' }]);
  });

  it('shows a complex value as its sub-fields, by name, each by its own type', () => {
    const view = describeField(
      'claim:adjuster',
      'Adjuster',
      { type: 'complex', fields: { name: { type: 'string' }, since: { type: 'date' } } },
      { name: 'Priya Raman', since: '2024-01-02T12:00:00.000Z' },
      context,
    );
    expect(view.kind).toBe('groups');
    expect(view.groups).toEqual([
      [
        { key: 'name', label: 'Name', kind: 'value', value: { text: 'Priya Raman' } },
        { key: 'since', label: 'Since', kind: 'value', value: { text: 'January 2, 2024' } },
      ],
    ]);
  });

  it('shows a date sub-field by the same rule, in the zone the field was given', () => {
    const view = describeField(
      'claim:adjuster',
      'Adjuster',
      { type: 'complex', fields: { assigned: { type: 'date' }, since: { type: 'date' } } },
      // West of UTC, where each of the two would be the other day under the other's rule.
      { assigned: '2024-01-03T03:00:00.000Z', since: '2024-01-03T00:00:00.000Z' },
      { ...context, timeZone: '-0500' },
    );
    expect(view.groups).toEqual([
      [
        { key: 'assigned', label: 'Assigned', kind: 'value', value: { text: 'January 2, 2024' } },
        { key: 'since', label: 'Since', kind: 'value', value: { text: 'January 3, 2024' } },
      ],
    ]);
  });

  it('shows a list of complex values as one group per item', () => {
    const view = describeField(
      'files:files',
      'Files',
      { type: 'complex[]', fields: { file: { type: 'blob' } } },
      [{ file: { name: 'a.txt' } }, { file: null }],
      context,
    );
    expect(view.groups).toEqual([
      [{ key: 'file', label: 'File', kind: 'value', value: { text: 'a.txt' } }],
      [{ key: 'file', label: 'File', kind: 'empty' }],
    ]);
  });

  it('falls back to JSON for a complex value nested past the depth limit', () => {
    const deep = { type: 'complex', fields: {} };
    const view = describeField('x:f', 'F', deep, { a: 1 }, context, 4);
    expect(view.value).toEqual({ text: '{"a":1}' });
  });

  it('shows the keys of a complex value whose sub-fields the schema does not describe', () => {
    const view = describeField('x:f', 'F', { type: 'complex' }, { b: 'two', a: 'one' }, context);
    expect(view.groups?.[0]?.map((field) => [field.key, field.value])).toEqual([
      ['a', { text: 'one' }],
      ['b', { text: 'two' }],
    ]);
  });
});

describe('vocabularyValues', () => {
  it('names only the entries the values hold, in sub-fields and lists too, each once', () => {
    expect(
      vocabularyValues([
        { definition: { type: 'string', directory: 'claim_status' }, value: 'pending' },
        {
          definition: { type: 'string[]', directory: 'l10nsubjects' },
          value: ['architecture', '', null, 'architecture'],
        },
        {
          definition: {
            type: 'complex[]',
            fields: {
              country: { type: 'string', directory: 'country' },
              again: { type: 'string', directory: 'claim_status' },
            },
          },
          value: [{ country: 'FR', again: 'pending' }, { country: 'DE' }, null],
        },
      ]),
    ).toEqual([
      { directory: 'claim_status', id: 'pending' },
      { directory: 'country', id: 'DE' },
      { directory: 'country', id: 'FR' },
      { directory: 'l10nsubjects', id: 'architecture' },
    ]);
  });

  it('names nothing for an empty value, an unbound field or a type shown without a label', () => {
    expect(
      vocabularyValues([
        { definition: { type: 'string', directory: 'claim_status' }, value: '' },
        { definition: { type: 'string', directory: 'claim_status' }, value: null },
        { definition: { type: 'string' }, value: 'pending' },
        { definition: { type: 'date', directory: 'claim_status' }, value: '2026-09-14' },
        { definition: { type: 'string', directory: 'claim_status' }, value: ['pending'] },
      ]),
    ).toEqual([]);
  });
});

const WEI = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const JOHN = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
/** A record the reader may not read, or that no longer exists. */
const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';
const REFERENCE = { type: 'string', documentReference: true } as const;

describe('a document reference', () => {
  /** Wei is read, John is still being read, and any other is unavailable. */
  const links: ValueContext = {
    ...context,
    record: (id) =>
      id === WEI
        ? { text: 'Wei Chen', url: `/doc/${WEI}` }
        : id === JOHN
          ? null
          : { text: 'Unavailable', url: null },
  };
  const reference = (
    value: unknown,
    definition: LayoutFieldType = REFERENCE,
    given: ValueContext = links,
  ): FieldView => describeField('x:f', 'F', definition, value, given);

  it("shows the linked record's title and route, never the stored id", () => {
    expect(reference(WEI).value).toEqual({ record: { text: 'Wei Chen', url: `/doc/${WEI}` } });
  });

  it('shows a record it may not read, and a value that is no id, as unavailable', () => {
    expect(reference(GONE).value).toEqual({ record: { text: 'Unavailable', url: null } });
    expect(reference('/default-domain/members/wei').value).toEqual({
      record: { text: 'Unavailable', url: null },
    });
  });

  it('shows nothing of a record while it is read, not its id', () => {
    expect(reference(JOHN)).toEqual({ key: 'x:f', label: 'F', kind: 'value', value: { text: '' } });
  });

  it('lists each record of a list of references, leaving out one still being read', () => {
    expect(reference([WEI, JOHN, GONE], { ...REFERENCE, type: 'string[]' }).chips).toEqual([
      { record: { text: 'Wei Chen', url: `/doc/${WEI}` } },
      { record: { text: 'Unavailable', url: null } },
    ]);
  });

  it('shows a reference inside a complex value the same way', () => {
    const view = reference({ member: WEI }, { type: 'complex', fields: { member: REFERENCE } });
    expect(view.groups?.[0]?.[0]?.value).toEqual({
      record: { text: 'Wei Chen', url: `/doc/${WEI}` },
    });
  });

  it('shows the stored value where nothing reads the record, as on the record page', () => {
    expect(reference(WEI, REFERENCE, context).value).toEqual({ text: WEI });
    // And a property that is no reference is never looked up.
    expect(reference(WEI, { type: 'string' }).value).toEqual({ text: WEI });
  });
});

describe('linkedRecordIds', () => {
  it('names the ids the references hold, in sub-fields and lists too, each once, sorted', () => {
    expect(
      linkedRecordIds([
        { definition: REFERENCE, value: WEI },
        { definition: { ...REFERENCE, type: 'string[]' }, value: [JOHN, '', null, WEI] },
        {
          definition: { type: 'complex[]', fields: { member: REFERENCE } },
          value: [{ member: GONE }, {}, null],
        },
      ]),
    ).toEqual([GONE, JOHN, WEI].sort());
  });

  it('names no value that is not an id, nor one that no reference holds', () => {
    const injected = `${WEI}' OR ecm:uuid IS NOT NULL OR ecm:uuid = '`;
    expect(
      linkedRecordIds([
        { definition: REFERENCE, value: injected },
        { definition: REFERENCE, value: `default:${WEI}` },
        { definition: REFERENCE, value: WEI.toUpperCase() },
        { definition: REFERENCE, value: [WEI] },
        { definition: { type: 'string' }, value: JOHN },
        { definition: { ...REFERENCE, type: 'date' }, value: JOHN },
      ]),
    ).toEqual([]);
  });
});
