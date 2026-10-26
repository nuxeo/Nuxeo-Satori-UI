import { FieldView, ValueContext, describeField, vocabularyValues } from './field-view';

const context: ValueContext = {
  locale: 'en-US',
  vocabulary: (directory, id) =>
    directory === 'claim_status' && id === 'pending' ? 'Pending review' : id,
};

const describe1 = (type: string, value: unknown, extra: Record<string, unknown> = {}): FieldView =>
  describeField('x:f', 'F', { type, ...extra }, value, context);

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

  it('shows a string as text, and a vocabulary-bound one by its entry label', () => {
    expect(describe1('string', 'Northside').value).toEqual({ text: 'Northside' });
    expect(describe1('string', 'pending', { directory: 'claim_status' }).value).toEqual({
      text: 'Pending review',
    });
    expect(describe1('string', 'unknown', { directory: 'claim_status' }).value).toEqual({
      text: 'unknown',
    });
  });

  it('shows a date in UTC, so a calendar date is the same day in every timezone', () => {
    // Outside UTC, local formatting moves one of these two across a day boundary.
    expect(describe1('date', '2026-09-14T00:00:00.000Z').value).toEqual({
      text: 'September 14, 2026',
    });
    expect(describe1('date', '2026-09-14T23:59:00.000Z').value).toEqual({
      text: 'September 14, 2026',
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
