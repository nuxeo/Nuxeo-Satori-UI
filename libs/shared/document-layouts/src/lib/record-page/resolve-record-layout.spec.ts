import { describe, expect, it } from 'vitest';

import type { DocumentTypeDefinition, DocumentTypeSchema } from '../layout.model';
import { readRecordLayout, type RecordLayoutFile } from './record-layout';
import {
  recordFacetSchemasToRead,
  resolveRecordLayout,
  widgetAccepts,
  widgetPropertyType,
} from './resolve-record-layout';

const MEMBER: DocumentTypeDefinition = {
  name: 'Member',
  schemas: [
    { name: 'dublincore', prefix: 'dc', fields: { title: { type: 'string' } } },
    {
      name: 'member',
      prefix: 'member',
      fields: {
        phone: { type: 'string' },
        birthDate: { type: 'date' },
        visits: { type: 'integer' },
        tags: { type: 'string[]' },
      },
    },
  ],
};

const AUDIT: DocumentTypeSchema = {
  name: 'audit',
  prefix: 'aud',
  fields: { reviewer: { type: 'string' } },
};

function file(cards: unknown[], extra: Record<string, unknown> = {}): RecordLayoutFile {
  const read = readRecordLayout({ version: 2, cards, ...extra }, []);
  if ('invalid' in read) throw new Error(read.invalid);
  return read;
}

describe('resolveRecordLayout', () => {
  it("gives each property field its schema's definition, and keeps computed fields as written", () => {
    const { layout, skipped } = resolveRecordLayout(
      MEMBER,
      file([
        {
          id: 'a',
          fields: [
            'member:phone',
            {
              id: 'age',
              computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
            },
          ],
        },
      ]),
    );
    expect(skipped).toEqual([]);
    expect(layout.type).toBe('Member');
    const [phone, age] = layout.cards[0].fields;
    expect(phone).toMatchObject({
      kind: 'property',
      xpath: 'member:phone',
      definition: { type: 'string' },
    });
    expect(age).toMatchObject({ kind: 'computed', id: 'age' });
    expect(layout.properties.get('member:birthDate')).toEqual({ type: 'date' });
  });

  it("leaves out a field whose property neither the type nor the document's facets have", () => {
    const { layout, skipped } = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: ['dc:title', 'member:ssn'] }]),
    );
    expect(layout.cards[0].fields.map((field) => field.kind === 'property' && field.xpath)).toEqual(
      ['dc:title'],
    );
    expect(skipped).toEqual([
      { place: 'cards[0].fields[1]', xpath: 'member:ssn', reason: 'not-on-type' },
    ]);
  });

  it("reads a facet schema's properties, when the document carries the facet", () => {
    const { layout, skipped } = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: ['aud:reviewer'] }]),
      [AUDIT],
    );
    expect(skipped).toEqual([]);
    expect(layout.cards[0].fields[0]).toMatchObject({
      xpath: 'aud:reviewer',
      definition: { type: 'string' },
    });
  });

  it('leaves out a field whose widget does not show its property type', () => {
    const { layout, skipped } = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: ['dc:title', { field: 'member:phone', widget: 'date' }] }]),
    );
    expect(layout.cards[0].fields).toHaveLength(1);
    expect(skipped).toEqual([
      {
        place: 'cards[0].fields[1]',
        xpath: 'member:phone',
        reason: 'widget-type',
        widget: 'date',
        type: 'string',
      },
    ]);
  });

  it('shows an integer property through a widget for longs, as the schema language calls it', () => {
    const { skipped } = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: [{ field: 'member:visits', widget: 'number' }] }]),
    );
    expect(skipped).toEqual([]);
  });

  it('leaves out a card left with no field, still reporting each field', () => {
    const { layout, skipped } = resolveRecordLayout(
      MEMBER,
      file([
        { id: 'gone', fields: ['member:nope'] },
        { id: 'kept', fields: ['dc:title'] },
      ]),
    );
    expect(layout.cards.map((card) => card.id)).toEqual(['kept']);
    expect(skipped.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
  });

  it('leaves out a tab left with no card', () => {
    const read = readRecordLayout(
      {
        version: 2,
        tabs: [
          { id: 'gone', cards: [{ id: 'x', fields: ['member:nope'] }] },
          { id: 'kept', cards: [{ id: 'y', fields: ['dc:title'] }] },
        ],
      },
      [],
    );
    if ('invalid' in read) throw new Error(read.invalid);
    const { layout } = resolveRecordLayout(MEMBER, read);
    expect(layout.tabs?.map((tab) => tab.id)).toEqual(['kept']);
    expect(layout.cards).toEqual([]);
  });

  it("keeps the file's columns, and a card's span", () => {
    const { layout } = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', span: 2, fields: ['dc:title'] }], { columns: 2 }),
    );
    expect(layout.columns).toBe(2);
    expect(layout.cards[0].span).toBe(2);
  });
});

describe('recordFacetSchemasToRead', () => {
  const schemas = [
    { name: 'dublincore', prefix: 'dc' },
    { name: 'audit', prefix: 'aud' },
    { name: 'unrelated', prefix: 'un' },
  ];

  it('reads only the facet schemas a field names a property of', () => {
    expect(
      recordFacetSchemasToRead(
        MEMBER,
        schemas,
        file([{ id: 'a', fields: ['aud:reviewer', 'dc:title'] }]),
      ),
    ).toEqual([{ name: 'audit', prefix: 'aud' }]);
  });

  it('reads none when no field names one', () => {
    expect(
      recordFacetSchemasToRead(MEMBER, schemas, file([{ id: 'a', fields: ['dc:title'] }])),
    ).toEqual([]);
  });
});

describe('widgetAccepts', () => {
  it.each([
    ['text', 'string', true],
    ['text', 'long', false],
    ['number', 'long', true],
    ['number', 'integer', true],
    ['number', 'double', true],
    ['date', 'date', true],
    ['chips', 'string[]', true],
    ['chips', 'string', false],
    ['table', 'complex[]', true],
    ['file-list', 'blob[]', true],
    ['calendar', 'date', false],
  ])('%s shows a %s property: %s', (widget, type, accepted) => {
    expect(widgetAccepts(widget, { type })).toBe(accepted);
  });

  it('names a list of integers a list of longs', () => {
    expect(widgetPropertyType({ type: 'integer[]' })).toBe('long[]');
    expect(widgetPropertyType({ type: 'integerish' })).toBe('integerish');
  });
});
