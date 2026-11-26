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
        lines: {
          type: 'complex[]',
          fields: { code: { type: 'string' }, amount: { type: 'double' }, scan: { type: 'blob' } },
        },
        bag: { type: 'complex[]' },
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
  const read = readRecordLayout({ version: 2, cards, ...extra }, { rules: [] });
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
      { rules: [] },
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

  it('keeps the review for a record that shows its picture, and leaves it out, saying so, for one that does not', () => {
    const reviewed = file([{ id: 'a', fields: ['dc:title'] }], { review: {} });
    const shown = resolveRecordLayout(MEMBER, reviewed, [], 'picture');
    expect(shown.layout.review).toBe(true);
    expect(shown.notes).toEqual([]);

    const none = resolveRecordLayout(MEMBER, reviewed, [], null);
    expect(none.layout.review).toBe(false);
    expect(none.notes).toEqual([
      'review: a review is drawn on a picture, and this record shows none; left out',
    ]);

    const without = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: ['dc:title'] }]),
      [],
      'picture',
    );
    expect(without.layout.review).toBe(false);
    expect(without.notes).toEqual([]);
  });

  it('keeps the share links for a record that shows its picture, and leaves them out, saying so, for one that does not', () => {
    const shared = file([{ id: 'a', fields: ['dc:title'] }], { shareLinks: {} });
    const shown = resolveRecordLayout(MEMBER, shared, [], 'picture');
    expect(shown.layout.shareLinks).toBe(true);
    expect(shown.notes).toEqual([]);

    const none = resolveRecordLayout(MEMBER, shared, [], null);
    expect(none.layout.shareLinks).toBe(false);
    expect(none.notes).toEqual([
      "shareLinks: share links serve a picture's views, and this record shows none; left out",
    ]);

    const without = resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: ['dc:title'] }]),
      [],
      'picture',
    );
    expect(without.layout.shareLinks).toBe(false);
  });
});

describe("a table's columns", () => {
  const table = (columns: unknown[], xpath = 'member:lines') =>
    resolveRecordLayout(
      MEMBER,
      file([{ id: 'a', fields: [{ field: xpath, widget: 'table', parameters: { columns } }] }]),
    );

  /**
   * A schema's subfields are a plain object, so a column naming what every object inherits found
   * a function, not an absence, and resolving the page threw. It is a subfield like any missing one.
   */
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'leaves out a column naming %s, which only objects themselves have',
    (name) => {
      const { layout, notes } = table([
        'line:code',
        `line:${name}`,
        { field: `line:${name}`, widget: 'text' },
      ]);
      expect(layout.cards[0].fields[0].parameters['columns']).toEqual(['line:code']);
      expect(notes).toEqual([
        `cards[0].fields[0].parameters.columns[1] left out: member:lines has no subfield "${name}"`,
        `cards[0].fields[0].parameters.columns[2] left out: member:lines has no subfield "${name}"`,
      ]);
    },
  );

  it('leaves out a column naming a subfield its property does not have, and says so', () => {
    const { layout, notes } = table(['line:code', 'line:cod']);
    expect(layout.cards[0].fields[0].parameters['columns']).toEqual(['line:code']);
    expect(notes).toEqual([
      'cards[0].fields[0].parameters.columns[1] left out: member:lines has no subfield "cod"',
    ]);
  });

  it("says when a column's widget does not show its subfield, and keeps the column", () => {
    const { layout, notes } = table([{ field: 'line:code', widget: 'date' }]);
    expect(layout.cards[0].fields[0].parameters['columns']).toHaveLength(1);
    expect(notes).toEqual([
      'cards[0].fields[0].parameters.columns[0]: the widget "date" does not show "code", a string value, so the cell shows the value itself',
    ]);
  });

  it('says when a column widget is one this build shows as version 1 would', () => {
    const { notes } = table([{ field: 'line:scan', widget: 'image' }]);
    expect(notes).toEqual([
      'cards[0].fields[0].parameters.columns[0]: the widget "image" shows the subfield\'s own value in this build',
    ]);
  });

  it("says that a document-link column shows the record's title without its link, a cell being text", () => {
    const { layout, notes } = table([{ field: 'line:code', widget: 'document-link' }]);
    expect(layout.cards[0].fields[0].parameters['columns']).toHaveLength(1);
    expect(notes).toEqual([
      "cards[0].fields[0].parameters.columns[0]: a table's cell shows the linked record's title, without its link",
    ]);
  });

  it('takes the columns as written when the schema lists no subfields, as version 1 does', () => {
    const { layout, notes } = table(['bag:anything'], 'member:bag');
    expect(layout.cards[0].fields[0].parameters['columns']).toEqual(['bag:anything']);
    expect(notes).toEqual([]);
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

  it('reads a schema the panel presents when a field names it, as version 1 does', () => {
    const tagged = [...schemas, { name: 'facetedTag', prefix: 'nxtag' }];
    expect(
      recordFacetSchemasToRead(MEMBER, tagged, file([{ id: 'a', fields: ['nxtag:tags'] }])),
    ).toEqual([{ name: 'facetedTag', prefix: 'nxtag' }]);
  });

  it('reads a schema whose property only a computation names', () => {
    const page = file([
      {
        id: 'a',
        fields: [{ id: 'n', computed: { type: 'core.template', parameters: ['{aud:reviewer}'] } }],
      },
    ]);
    expect(recordFacetSchemasToRead(MEMBER, schemas, page)).toEqual([
      { name: 'audit', prefix: 'aud' },
    ]);
  });

  it('reads none when no field names one', () => {
    expect(
      recordFacetSchemasToRead(MEMBER, schemas, file([{ id: 'a', fields: ['dc:title'] }])),
    ).toEqual([]);
  });

  it("reads the schema of a checklist's property", () => {
    const page = file([
      { id: 'a', checklist: { field: 'aud:checklist', items: [{ id: 'x', label: 'X' }] } },
    ]);
    expect(recordFacetSchemasToRead(MEMBER, schemas, page)).toEqual([
      { name: 'audit', prefix: 'aud' },
    ]);
  });

  it("reads the schema of a banner link's property, which no field names", () => {
    const page = file([{ id: 'a', fields: ['dc:title'] }], {
      banners: [{ id: 'next', label: 'Next', link: { field: 'aud:reviewer' } }],
    });
    expect(recordFacetSchemasToRead(MEMBER, schemas, page)).toEqual([
      { name: 'audit', prefix: 'aud' },
    ]);
  });
});

describe("a banner's link", () => {
  const linked = (field: string) =>
    file([{ id: 'a', fields: ['dc:title'] }], {
      banners: [{ id: 'next', label: 'Next', link: { field } }],
    });

  it("keeps a link to a text property of the type, or of a facet's schema", () => {
    expect(resolveRecordLayout(MEMBER, linked('member:phone')).layout.banners[0].link).toBe(
      'member:phone',
    );
    const facet = resolveRecordLayout(MEMBER, linked('aud:reviewer'), [AUDIT]);
    expect(facet.layout.banners[0].link).toBe('aud:reviewer');
    expect(facet.notes).toEqual([]);
  });

  it('leaves out a link to a property the type lacks, or to a list, keeping the banner, and says so', () => {
    const missing = resolveRecordLayout(MEMBER, linked('member:next'));
    expect(missing.layout.banners.map((banner) => [banner.id, banner.link])).toEqual([
      ['next', null],
    ]);
    expect(missing.notes).toEqual([
      'banners[0].link: "member:next" is not a property of Member; the banner shows without its link',
    ]);
    const list = resolveRecordLayout(MEMBER, linked('member:tags'));
    expect(list.layout.banners[0].link).toBeNull();
    expect(list.notes).toEqual([
      'banners[0].link: "member:tags" is a string[] property, and a banner links one record; the banner shows without its link',
    ]);
  });
});

describe('a checklist', () => {
  const CHECKLIST_SUBFIELDS = {
    item: { type: 'string' },
    done: { type: 'boolean' },
    doneBy: { type: 'string' },
    doneOn: { type: 'date' },
  };
  const CASE: DocumentTypeDefinition = {
    name: 'Case',
    schemas: [
      {
        name: 'case',
        prefix: 'case',
        fields: {
          number: { type: 'string' },
          checklist: { type: 'complex[]', fields: CHECKLIST_SUBFIELDS },
          loose: { type: 'complex[]' },
          tags: { type: 'string[]' },
          steps: {
            type: 'complex[]',
            fields: { ...CHECKLIST_SUBFIELDS, done: { type: 'string' } },
          },
          partial: {
            type: 'complex[]',
            fields: { item: { type: 'string' }, done: { type: 'boolean' } },
          },
        },
      },
    ],
  };
  const card = (field: string, id = 'checklist') => ({
    id,
    checklist: { field, items: [{ id: 'reviewerAssigned', label: 'Reviewer assigned' }] },
  });

  it('keeps a card whose property holds the four subfields, each of its type', () => {
    const { layout, skipped, notes } = resolveRecordLayout(
      CASE,
      file([{ id: 'a', fields: ['case:number'] }, card('case:checklist')]),
    );
    expect(skipped).toEqual([]);
    expect(notes).toEqual([]);
    expect(layout.cards.map((each) => each.id)).toEqual(['a', 'checklist']);
    expect(layout.cards[1].checklist?.field).toBe('case:checklist');
  });

  it("leaves out a card whose property is neither the type's nor the facets'", () => {
    const { layout, skipped } = resolveRecordLayout(CASE, file([card('case:todo')]));
    expect(layout.cards).toEqual([]);
    expect(skipped).toEqual([{ place: 'cards[0]', xpath: 'case:todo', reason: 'not-on-type' }]);
  });

  it('leaves out a card whose property cannot hold the items, and says why', () => {
    const { layout, notes } = resolveRecordLayout(
      CASE,
      file([card('case:tags', 'a'), card('case:steps', 'b'), card('case:partial', 'c')]),
    );
    expect(layout.cards).toEqual([]);
    expect(notes).toEqual([
      'cards[0] left out: a checklist reads a list of complex values, and case:tags is a string[] property',
      'cards[1] left out: "done" of case:steps is a string value, and a checklist reads it as a boolean',
      'cards[2] left out: case:partial has no subfield "doneBy", which a checklist reads',
    ]);
  });

  it('takes a property whose subfields the schema does not list as written, as a table does', () => {
    const { layout, notes } = resolveRecordLayout(CASE, file([card('case:loose')]));
    expect(notes).toEqual([]);
    expect(layout.cards.map((each) => each.id)).toEqual(['checklist']);
  });

  it("keeps a card whose property a facet's schema brings", () => {
    const audit: DocumentTypeSchema = {
      name: 'audit',
      prefix: 'aud',
      fields: { checklist: { type: 'complex[]', fields: CHECKLIST_SUBFIELDS } },
    };
    const { layout } = resolveRecordLayout(CASE, file([card('aud:checklist')]), [audit]);
    expect(layout.cards.map((each) => each.id)).toEqual(['checklist']);
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
