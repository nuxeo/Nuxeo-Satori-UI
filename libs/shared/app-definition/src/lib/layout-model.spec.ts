import { readContentModel, type ContentModel } from './content-model';
import {
  heldToModel,
  loadable,
  publishable,
  validateLayoutV2,
  validateTaskForm,
  type LayoutMode,
} from './layout-v2';
import { validateFile } from './package';

/** A Member type, in the shape the server answers, as `content-model.spec.ts` reads it. */
function memberModel(): ContentModel {
  const reading = readContentModel({
    doctypes: {
      Member: {
        parent: 'Document',
        facets: ['Protected'],
        schemas: ['dublincore', 'member'],
      },
    },
    facets: [
      {
        name: 'Protected',
        schemas: [{ name: 'protected', '@prefix': 'prot', fields: { ssn: 'string' } }],
      },
      {
        name: 'Flagged',
        schemas: [{ name: 'flags', '@prefix': 'flag', fields: { reason: 'string' } }],
      },
    ],
    schemas: [
      { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string', created: 'date' } },
      {
        name: 'member',
        '@prefix': 'member',
        fields: {
          firstName: 'string',
          birthDate: 'date',
          visits: 'integer',
          balance: 'double',
          plans: 'string[]',
          status: {
            type: 'string',
            constraints: [
              { name: 'directoryResolver', parameters: { directory: 'member_status' } },
            ],
          },
          address: {
            type: 'complex',
            fields: { street: 'string', city: 'string', zip: 'string', country: 'string' },
          },
          claims: { type: 'complex[]', fields: { code: 'string', amount: 'double', paid: 'date' } },
          attachments: 'complex[]',
          checklist: {
            type: 'complex[]',
            fields: { item: 'string', done: 'boolean', doneBy: 'string', doneOn: 'date' },
          },
          steps: { type: 'complex[]', fields: { item: 'string', done: 'string', doneOn: 'date' } },
        },
      },
    ],
  });
  if (!reading.model) throw new Error(reading.problems.join('\n'));
  return reading.model;
}

const model = memberModel();

const withFields = (...fields: unknown[]): Record<string, unknown> => ({
  version: 2,
  cards: [{ id: 'c', fields }],
});

/** The findings as the command line prints them. `given: null` checks with no model. */
const messages = (
  content: unknown,
  {
    type = 'Member',
    mode = 'view',
    given = model,
  }: { type?: string; mode?: LayoutMode; given?: ContentModel | null } = {},
): string[] =>
  validateLayoutV2(content, { mode, model: given ?? undefined, type }).map(
    (finding) => `${finding.path}: ${finding.message} [${finding.kind}]`,
  );

describe('validateLayoutV2, given the content model', () => {
  it("passes fields of the type's schemas and of the facets it declares, each in a widget that shows it", () => {
    expect(
      messages(
        withFields(
          'dc:title',
          'prot:ssn',
          { field: 'member:birthDate', widget: 'date' },
          // Nuxeo's integer is the widgets' long.
          { field: 'member:visits', widget: 'number' },
          { field: 'member:balance', widget: 'currency', parameters: { currency: 'USD' } },
          { field: 'member:plans', widget: 'chips' },
          {
            field: 'member:status',
            widget: 'vocabulary',
            parameters: { directory: 'member_status' },
          },
          {
            field: 'member:address',
            widget: 'address',
            parameters: { parts: { street: 'street', city: 'city', postcode: 'zip' } },
          },
          {
            field: 'member:claims',
            widget: 'table',
            parameters: {
              columns: ['claim:code', { field: 'claim:paid', widget: 'relative-date' }],
            },
          },
          // With no subfields read, a table's columns are taken as written, as the page takes them.
          { field: 'member:attachments', widget: 'table', parameters: { columns: ['a:anything'] } },
        ),
      ),
    ).toEqual([]);
  });

  it('refuses a field whose property is on neither the type nor its facets', () => {
    expect(messages(withFields('member:lastName', { field: 'dc:nope', widget: 'text' }))).toEqual([
      'cards[0].fields[0]: "member:lastName" is not a property of the type "Member" or of its facets [unknown]',
      'cards[0].fields[1].field: "dc:nope" is not a property of the type "Member" or of its facets [unknown]',
    ]);
  });

  it('says so when the schema is named for its prefix, or a facet the type lacks brings it', () => {
    expect(messages(withFields('dublincore:title', 'flag:reason'))).toEqual([
      'cards[0].fields[0]: "dublincore:title" is written "dc:title": the schema "dublincore" has the prefix "dc" [unknown]',
      'cards[0].fields[1]: "flag:reason" is not a property of the type "Member": the facet "Flagged" brings it, which "Member" does not declare, so a record shows it only once given that facet at run time [unknown]',
    ]);
  });

  it("refuses a widget that does not show its property's type", () => {
    expect(
      messages(
        withFields(
          { field: 'member:birthDate', widget: 'text' },
          { field: 'member:firstName', widget: 'number' },
          { field: 'member:plans', widget: 'text' },
          { field: 'member:firstName', widget: 'chips' },
          { field: 'member:claims', widget: 'address', parameters: { parts: { city: 'code' } } },
        ),
      ),
    ).toEqual([
      'cards[0].fields[0].widget: the widget "text" does not show "member:birthDate", a date property: it takes string [parameter]',
      'cards[0].fields[1].widget: the widget "number" does not show "member:firstName", a string property: it takes long or double [parameter]',
      'cards[0].fields[2].widget: the widget "text" does not show "member:plans", a string[] property: it takes string [parameter]',
      'cards[0].fields[3].widget: the widget "chips" does not show "member:firstName", a string property: it takes string[] [parameter]',
      'cards[0].fields[4].widget: the widget "address" does not show "member:claims", a complex[] property: it takes complex [parameter]',
    ]);
  });

  it("refuses a table column naming a subfield its property lacks, and a column's widget that does not show its subfield", () => {
    expect(
      messages(
        withFields({
          field: 'member:claims',
          widget: 'table',
          parameters: {
            columns: [
              'claim:code',
              'claim:cost',
              { field: 'claim:total', widget: 'number' },
              { field: 'claim:paid', widget: 'number' },
              // A computed column is not a subfield.
              { id: 'n', computed: { type: 'core.count', parameters: [{ field: 'claim:code' }] } },
            ],
          },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].parameters.columns[1]: "member:claims" has no subfield "cost" [unknown]',
      'cards[0].fields[0].parameters.columns[2].field: "member:claims" has no subfield "total" [unknown]',
      'cards[0].fields[0].parameters.columns[3].widget: the widget "number" does not show "paid" of "member:claims", a date property: it takes long or double [parameter]',
    ]);
  });

  it('refuses an address part naming a subfield its property lacks', () => {
    expect(
      messages(
        withFields({
          field: 'member:address',
          widget: 'address',
          parameters: { parts: { street: 'street', postcode: 'postcode' } },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].parameters.parts.postcode: "member:address" has no subfield "postcode" [unknown]',
    ]);
  });

  it("leaves an address part that is not a text to the widget's own check, without throwing", () => {
    expect(
      messages(
        withFields({
          field: 'member:address',
          widget: 'address',
          parameters: { parts: { street: 'street', city: { toString: 0 } } },
        }),
      ),
    ).toEqual([
      'cards[0].fields[0].parameters.parts: parts must give each part a subfield name [parameter]',
    ]);
  });

  describe("a banner's link", () => {
    const linked = (field: string) => ({
      version: 2,
      banners: [{ id: 'next', label: 'Superseded', link: { field } }],
      cards: [{ id: 'c', fields: ['dc:title'] }],
    });

    it("passes a text property of the type or a facet, which holds the linked record's id", () => {
      expect(messages(linked('member:firstName'))).toEqual([]);
      expect(messages(linked('prot:ssn'))).toEqual([]);
    });

    it('refuses one the type lacks, and one that is not one text', () => {
      expect(messages(linked('member:next'))).toEqual([
        'banners[0].link.field: "member:next" is not a property of the type "Member" or of its facets [unknown]',
      ]);
      expect(messages(linked('member:plans'))).toEqual([
        'banners[0].link.field: a banner links one record, by a string property holding its id, and "member:plans" is a string[] property [parameter]',
      ]);
      expect(messages(linked('member:birthDate'))).toEqual([
        'banners[0].link.field: a banner links one record, by a string property holding its id, and "member:birthDate" is a date property [parameter]',
      ]);
    });

    it('checks nothing against the model when none is given', () => {
      expect(messages(linked('member:next'), { given: null })).toEqual([]);
    });
  });

  describe("a checklist's property", () => {
    const checklist = (field: string, where: 'cards' | 'tabs' = 'cards') => {
      const card = {
        id: 'checklist',
        label: 'Checklist',
        checklist: { field, items: [{ id: 'reviewerAssigned', label: 'Reviewer assigned' }] },
      };
      return where === 'cards'
        ? { version: 2, cards: [card] }
        : { version: 2, tabs: [{ id: 't', label: 'T', cards: [card] }] };
    };

    it('passes a list of complex values with item, done, doneBy and doneOn, each of its type', () => {
      expect(messages(checklist('member:checklist'))).toEqual([]);
      expect(messages(checklist('member:checklist', 'tabs'))).toEqual([]);
    });

    it('refuses one the type lacks, as a field is refused', () => {
      expect(messages(checklist('member:todo'))).toEqual([
        'cards[0].checklist.field: "member:todo" is not a property of the type "Member" or of its facets [unknown]',
      ]);
      expect(messages(checklist('member:todo', 'tabs'))).toEqual([
        'tabs[0].cards[0].checklist.field: "member:todo" is not a property of the type "Member" or of its facets [unknown]',
      ]);
    });

    it('refuses one that is not a list of complex values', () => {
      expect(messages(checklist('member:plans'))).toEqual([
        'cards[0].checklist.field: a checklist reads a list of complex values, and "member:plans" is a string[] property [parameter]',
      ]);
      expect(messages(checklist('member:address'))).toEqual([
        'cards[0].checklist.field: a checklist reads a list of complex values, and "member:address" is a complex property [parameter]',
      ]);
    });

    it('refuses a subfield it lacks, and one of another type', () => {
      expect(messages(checklist('member:steps'))).toEqual([
        'cards[0].checklist.field: "done" of "member:steps" is a string value, and a checklist reads it as a boolean [parameter]',
        'cards[0].checklist.field: "member:steps" has no subfield "doneBy", which a checklist reads [unknown]',
      ]);
    });

    it('takes one whose subfields the model did not read as written, as a table does', () => {
      expect(messages(checklist('member:attachments'))).toEqual([]);
    });

    it('checks nothing against the model when none is given', () => {
      expect(messages(checklist('member:todo'), { given: null })).toEqual([]);
    });
  });

  it('checks the fields of every tab, in every mode', () => {
    const tabs = {
      version: 2,
      tabs: [
        { id: 't1', label: 'One', cards: [{ id: 'a', fields: ['member:firstName'] }] },
        { id: 't2', label: 'Two', cards: [{ id: 'b', fields: ['member:middleName'] }] },
      ],
    };
    for (const mode of ['view', 'metadata', 'edit', 'create'] as const) {
      expect(messages(tabs, { mode })).toEqual([
        'tabs[1].cards[0].fields[0]: "member:middleName" is not a property of the type "Member" or of its facets [unknown]',
      ]);
      expect(messages(withFields({ field: 'member:birthDate', widget: 'text' }), { mode })).toEqual(
        [
          'cards[0].fields[0].widget: the widget "text" does not show "member:birthDate", a date property: it takes string [parameter]',
        ],
      );
    }
  });

  it("leaves a related list's columns alone: they are the listed records', not this type's", () => {
    const related = {
      version: 2,
      cards: [
        {
          id: 'claims',
          label: 'Claims',
          related: {
            pageProvider: 'member_claims',
            parameters: [{ field: 'member:firstName' }],
            columns: ['claim:number', { field: 'claim:received', widget: 'date' }],
          },
        },
      ],
    };
    expect(messages(related)).toEqual([]);
  });

  it('adds nothing to a finding the file has already: an unknown widget, a malformed name', () => {
    expect(
      messages(withFields({ field: 'member:firstName', widget: 'calendar' }, 'not a property')),
    ).toEqual([
      'cards[0].fields[0].widget: the widget "calendar" is not registered [unknown]',
      'cards[0].fields[1]: "not a property" is not a property, <prefix>:<name> [structure]',
    ]);
  });

  it('holds a review to a type whose record page shows a picture: the picture schema, and no video one', () => {
    const reading = readContentModel({
      doctypes: {
        Asset: { parent: 'Document', facets: ['Picture'], schemas: ['dublincore'] },
        Clip: { parent: 'Document', facets: ['Picture', 'Video'], schemas: ['dublincore'] },
        Member: { parent: 'Document', facets: [], schemas: ['dublincore'] },
      },
      facets: [
        {
          name: 'Picture',
          schemas: [{ name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } }],
        },
        {
          name: 'Video',
          schemas: [{ name: 'video', '@prefix': 'vid', fields: { duration: 'double' } }],
        },
      ],
      schemas: [{ name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } }],
    });
    if (!reading.model) throw new Error(reading.problems.join('\n'));
    const reviewed = { ...withFields('dc:title'), review: {} };
    expect(messages(reviewed, { type: 'Asset', given: reading.model })).toEqual([]);
    expect(messages(reviewed, { type: 'Member', given: reading.model })).toEqual([
      'review: a review is drawn on a picture, and the type "Member" has no "picture" schema: its record page shows no picture [unknown]',
    ]);
    expect(messages(reviewed, { type: 'Clip', given: reading.model })).toEqual([
      'review: a review is drawn on a picture, and the type "Clip" has the "video" schema: its record page keeps its player, not its picture [unknown]',
    ]);
    // Without a model nothing says what the type has: the record page leaves the review out.
    expect(messages(reviewed, { type: 'Member', given: null })).toEqual([]);
  });

  it('holds share links to a type whose record page shows a picture, as it does a review', () => {
    const reading = readContentModel({
      doctypes: {
        Asset: { parent: 'Document', facets: ['Picture'], schemas: ['dublincore'] },
        Clip: { parent: 'Document', facets: ['Picture', 'Video'], schemas: ['dublincore'] },
        Member: { parent: 'Document', facets: [], schemas: ['dublincore'] },
      },
      facets: [
        {
          name: 'Picture',
          schemas: [{ name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } }],
        },
        {
          name: 'Video',
          schemas: [{ name: 'video', '@prefix': 'vid', fields: { duration: 'double' } }],
        },
      ],
      schemas: [{ name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } }],
    });
    if (!reading.model) throw new Error(reading.problems.join('\n'));
    const shared = { ...withFields('dc:title'), shareLinks: {} };
    expect(messages(shared, { type: 'Asset', given: reading.model })).toEqual([]);
    expect(messages(shared, { type: 'Member', given: reading.model })).toEqual([
      `shareLinks: share links serve a picture's views, and the type "Member" has no "picture" schema: its record page shows no picture [unknown]`,
    ]);
    expect(messages(shared, { type: 'Clip', given: reading.model })).toEqual([
      `shareLinks: share links serve a picture's views, and the type "Clip" has the "video" schema: its record page keeps its player, not its picture [unknown]`,
    ]);
    expect(messages(shared, { type: 'Member', given: null })).toEqual([]);
  });

  it('refuses a type the model does not have, and a model given without a type', () => {
    expect(messages(withFields('member:firstName'), { type: 'Claim' })).toEqual([
      ': the document type "Claim" is not in the content model [unknown]',
    ]);
    expect(messages(withFields('member:firstName'), { type: '' })).toEqual([
      ': a content model was given without the document type the file lays out, so no field was checked against it [unknown]',
    ]);
  });

  it('checks nothing against the model when none is given', () => {
    expect(
      messages(withFields('member:lastName', { field: 'member:birthDate', widget: 'text' }), {
        given: null,
      }),
    ).toEqual([]);
  });

  it('is unknown or parameter, never structure, so the app loads the rest of the file', () => {
    const findings = validateLayoutV2(
      withFields('member:firstName', 'member:lastName', {
        field: 'member:birthDate',
        widget: 'text',
      }),
      { mode: 'view', model, type: 'Member' },
    );
    expect(findings.map((finding) => finding.kind)).toEqual(['unknown', 'parameter']);
    expect(loadable(findings)).toBe(true);
    expect(publishable(findings)).toBe(false);
  });

  it('heldToModel answers true exactly when the validator runs the model checks', () => {
    // A model with no type: every file the checks reach is refused for its type.
    const empty = readContentModel({ doctypes: {}, facets: [], schemas: [] });
    if (!empty.model) throw new Error(empty.problems.join('\n'));
    const cases: [unknown, LayoutMode, string, boolean][] = [
      [withFields('member:firstName'), 'view', 'Member', true],
      [withFields('member:firstName'), 'edit', 'Member', true],
      [{ version: 3, cards: [] }, 'view', 'Member', false],
      [null, 'view', 'Member', false],
      [withFields('member:firstName'), 'other' as LayoutMode, 'Member', false],
      [withFields('member:firstName'), 'view', '', false],
    ];
    for (const [content, mode, type, held] of cases) {
      expect(heldToModel(content, { mode, type })).toBe(held);
      const findings = validateLayoutV2(content, { mode, model: empty.model, type });
      expect(
        findings.some((finding) => finding.message.includes('is not in the content model')),
      ).toBe(held);
    }
  });

  it("is checked by validateFile against the type a layout's path names", () => {
    const layout = withFields({ field: 'member:birthDate', widget: 'text' });
    const context = { assets: new Set<string>() };
    expect(
      validateFile({ kind: 'layout', type: 'Member', mode: 'view' }, layout, context, { model }),
    ).toEqual([
      {
        path: 'cards[0].fields[0].widget',
        kind: 'parameter',
        message:
          'the widget "text" does not show "member:birthDate", a date property: it takes string',
      },
    ]);
    // The type is the path's, not any type: another path, another type's properties.
    expect(
      validateFile({ kind: 'layout', type: 'Claim', mode: 'view' }, layout, context, { model }),
    ).toEqual([
      {
        path: '',
        kind: 'unknown',
        message: 'the document type "Claim" is not in the content model',
      },
    ]);
    expect(validateFile({ kind: 'layout', type: 'Member', mode: 'view' }, layout, context)).toEqual(
      [],
    );
    // A task form's type is any record's a workflow runs on, so no model holds it.
    expect(validateTaskForm(layout)).toEqual([]);
  });
});
