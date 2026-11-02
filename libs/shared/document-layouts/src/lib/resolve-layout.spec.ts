import { readLayoutFile } from './layout-file';
import { DocumentTypeDefinition, DocumentTypeSchema } from './layout.model';
import {
  applyLayoutFile,
  facetSchemasToRead,
  generateLayout,
  humanize,
  readDocumentSchemas,
  readDocumentType,
  readSchema,
  readSchemaResponse,
} from './resolve-layout';

/** Trimmed from a real `/config/types/Claim` response with `fetch-schema: fields`. */
const CLAIM_RESPONSE = {
  'entity-type': 'docType',
  name: 'Claim',
  parent: 'File',
  schemas: [
    { name: 'common', fields: { icon: 'string' } },
    { name: 'file', fields: { content: 'blob' } },
    {
      name: 'dublincore',
      '@prefix': 'dc',
      fields: {
        title: { type: 'string', constraints: [{ name: 'string', parameters: {} }] },
        subjects: {
          type: 'string[]',
          constraints: [],
          itemConstraints: [
            {
              name: 'directoryResolver',
              parameters: { directory: 'l10nsubjects', validation: 'true' },
            },
          ],
        },
      },
    },
    {
      name: 'claim',
      '@prefix': 'claim',
      fields: {
        status: {
          type: 'string',
          constraints: [
            {
              name: 'directoryResolver',
              parameters: { directory: 'claim_status', validation: 'true' },
            },
            { name: 'string', parameters: {} },
          ],
        },
        number: { type: 'string', constraints: [] },
        billedAmount: { type: 'double', constraints: [] },
        adjuster: {
          type: 'complex',
          fields: { name: { type: 'string', constraints: [] }, email: 'string' },
        },
      },
    },
  ],
};

const claim = (): DocumentTypeDefinition => {
  const type = readDocumentType(CLAIM_RESPONSE, 'Claim');
  if (!type) throw new Error('fixture did not read');
  return type;
};

describe('humanize', () => {
  it.each([
    ['billedAmount', 'Billed amount'],
    ['memberId', 'Member id'],
    ['memberID', 'Member ID'],
    ['payers_case', 'Payers case'],
    ['image_metadata', 'Image metadata'],
    ['claim', 'Claim'],
    ['HTMLBody', 'HTML body'],
    ['', ''],
  ])('%s → %s', (name, expected) => expect(humanize(name)).toBe(expected));
});

describe('readDocumentType', () => {
  it('reads prefixes, falling back to the schema name when Nuxeo reports none', () => {
    const prefixes = claim().schemas.map((schema) => [schema.name, schema.prefix]);
    expect(prefixes).toEqual([
      ['common', 'common'],
      ['file', 'file'],
      ['dublincore', 'dc'],
      ['claim', 'claim'],
    ]);
  });

  it('reads the vocabulary a value, or each item of a list, is bound to', () => {
    const fields = Object.fromEntries(
      claim().schemas.map((schema) => [schema.name, schema.fields]),
    );
    expect(fields['claim']?.['status']).toEqual({ type: 'string', directory: 'claim_status' });
    expect(fields['dublincore']?.['subjects']).toEqual({
      type: 'string[]',
      directory: 'l10nsubjects',
    });
    expect(fields['dublincore']?.['title']).toEqual({ type: 'string' });
    expect(fields['file']?.['content']).toEqual({ type: 'blob' });
  });

  it('reads complex sub-fields in both of the shapes Nuxeo answers with', () => {
    const adjuster = claim().schemas.find((schema) => schema.name === 'claim')?.fields['adjuster'];
    expect(adjuster).toEqual({
      type: 'complex',
      fields: { name: { type: 'string' }, email: { type: 'string' } },
    });
  });

  it('answers null for a body that is not a type', () => {
    expect(readDocumentType(null, 'Claim')).toBeNull();
    expect(readDocumentType({ name: 'Claim' }, 'Claim')).toBeNull();
  });

  it('skips schemas and fields it cannot read rather than failing the type', () => {
    const type = readDocumentType(
      {
        schemas: [
          { fields: { a: 'string' } },
          { name: 'x', fields: { a: 7, b: { constraints: [] }, c: 'long' } },
        ],
      },
      'X',
    );
    expect(type).toEqual({
      name: 'X',
      schemas: [{ name: 'x', prefix: 'x', fields: { c: { type: 'long' } } }],
    });
  });
});

describe('readSchema', () => {
  /** Trimmed from a real `/config/schemas/dublincore` response with `fetch-schema: fields`. */
  const DUBLINCORE = {
    'entity-type': 'schema',
    name: 'dublincore',
    prefix: 'dc',
    '@prefix': 'dc',
    fields: {
      nature: {
        type: 'string',
        constraints: [
          { 'entity-type': 'validation_constraint', name: 'string', parameters: {} },
          {
            'entity-type': 'validation_constraint',
            name: 'directoryResolver',
            parameters: { directory: 'nature', validation: 'true' },
          },
        ],
      },
      subjects: {
        type: 'string[]',
        constraints: [],
        itemConstraints: [
          {
            'entity-type': 'validation_constraint',
            name: 'directoryResolver',
            parameters: { directory: 'l10nsubjects', validation: 'true' },
          },
        ],
      },
      title: 'string',
    },
  };

  it('reads a schema answered alone as it reads one inside a type, vocabularies included', () => {
    expect(readSchema(DUBLINCORE)).toEqual({
      name: 'dublincore',
      prefix: 'dc',
      fields: {
        nature: { type: 'string', directory: 'nature' },
        subjects: { type: 'string[]', directory: 'l10nsubjects' },
        title: { type: 'string' },
      },
    });
    expect(readSchema(DUBLINCORE)).toEqual(
      readDocumentType({ schemas: [DUBLINCORE] }, 'File')?.schemas[0],
    );
  });

  it('addresses a schema with no prefix by its name, as for a type', () => {
    expect(
      readSchema({ 'entity-type': 'schema', name: 'file', fields: { content: 'blob' } }),
    ).toEqual({ name: 'file', prefix: 'file', fields: { content: { type: 'blob' } } });
  });

  it('answers null for a body that is not a schema, as a 204 is', () => {
    expect(readSchema(null)).toBeNull();
    expect(readSchema('')).toBeNull();
    expect(readSchema({ fields: {} })).toBeNull();
  });

  it('takes a response alone only for the schema asked for, with a fields object', () => {
    expect(readSchemaResponse(DUBLINCORE, 'dublincore')).toEqual(readSchema(DUBLINCORE));
    expect(readSchemaResponse({ name: 'marker', fields: {} }, 'marker')).toEqual({
      name: 'marker',
      prefix: 'marker',
      fields: {},
    });
    expect(readSchemaResponse(DUBLINCORE, 'hxai')).toBeNull();
    expect(readSchemaResponse({ name: 'marker' }, 'marker')).toBeNull();
    expect(readSchemaResponse({ name: 'marker', fields: null }, 'marker')).toBeNull();
    expect(readSchemaResponse({ name: 'marker', fields: [] }, 'marker')).toBeNull();
    expect(readSchemaResponse(null, 'marker')).toBeNull();
  });
});

describe('readDocumentSchemas', () => {
  it("reads a document's schemas by name and prefix, sorted by name", () => {
    expect(
      readDocumentSchemas([
        { name: 'uid', prefix: 'uid' },
        { name: 'externalEntity', prefix: 'externalEntity' },
        { name: 'dublincore', prefix: 'dc' },
      ]),
    ).toEqual([
      { name: 'dublincore', prefix: 'dc' },
      { name: 'externalEntity', prefix: 'externalEntity' },
      { name: 'uid', prefix: 'uid' },
    ]);
  });

  it('skips an entry it cannot read, once each, and names an unprefixed one by its name', () => {
    expect(
      readDocumentSchemas([
        { name: 'file' },
        { prefix: 'x' },
        'hxai',
        { name: 'file', prefix: 'file' },
      ]),
    ).toEqual([{ name: 'file', prefix: 'file' }]);
  });

  it('answers no schemas for a document that reports none', () => {
    expect(readDocumentSchemas(undefined)).toEqual([]);
    expect(readDocumentSchemas({ name: 'claim' })).toEqual([]);
  });
});

describe('facetSchemasToRead', () => {
  const document = readDocumentSchemas(
    [
      'claim',
      'common',
      'dublincore',
      'externalEntity',
      'hxai',
      'collectionMember',
      'thumbnail',
    ].map((name) => ({
      name,
      prefix: name === 'dublincore' ? 'dc' : name === 'thumbnail' ? 'thumb' : name,
    })),
  );
  const names = (refs: readonly { name: string }[]) => refs.map((ref) => ref.name);

  it('reads, for the generated layout, the ones the type lacks and the panel does not present', () => {
    expect(names(facetSchemasToRead(claim(), document, null))).toEqual(['externalEntity', 'hxai']);
  });

  it('reads, for a contributed file, only the ones whose prefix the file names', () => {
    const named = readLayoutFile({
      version: 1,
      sections: [{ id: 'a', fields: ['externalEntity:origin', 'thumb:thumbnail', 'claim:status'] }],
    });
    if ('invalid' in named) throw new Error(named.invalid);
    expect(names(facetSchemasToRead(claim(), document, named))).toEqual([
      'externalEntity',
      'thumbnail',
    ]);
  });
});

describe('generateLayout', () => {
  it("puts a facet schema's section after the type's own, each in name order", () => {
    const facet = (name: string): DocumentTypeSchema => ({
      name,
      prefix: name,
      fields: { b: { type: 'string' }, a: { type: 'string' } },
    });
    const layout = generateLayout(claim(), 'metadata', [facet('hxai'), facet('externalEntity')]);
    expect(layout.sections.map((section) => section.id)).toEqual([
      'claim',
      'externalEntity',
      'hxai',
    ]);
    expect(layout.sections[1]?.fields.map((field) => field.xpath)).toEqual([
      'externalEntity:a',
      'externalEntity:b',
    ]);
    expect(layout.sections[1]?.label).toEqual({
      keys: ['layout.schema.externalEntity'],
      fallback: 'External entity',
    });
  });

  it('adds nothing for the facets of a File in a collection, subscribed, with a thumbnail', () => {
    const stock = ['collectionMember', 'notification', 'thumbnail'].map((name) => ({
      name,
      prefix: name,
      fields: { anything: { type: 'string' } },
    }));
    expect(generateLayout(claim(), 'metadata', stock).sections.map((s) => s.id)).toEqual(['claim']);
  });

  it('gives each schema the panel does not already present a section, fields by name', () => {
    const layout = generateLayout(claim(), 'metadata');
    expect(layout.source).toBe('generated');
    expect(layout.display).toBe('sections');
    expect(layout.sections.map((section) => section.id)).toEqual(['claim']);
    expect(layout.sections[0]?.fields.map((field) => field.xpath)).toEqual([
      'claim:adjuster',
      'claim:billedAmount',
      'claim:number',
      'claim:status',
    ]);
  });

  it('labels a section and its fields by translation key first, then by readable name', () => {
    const [section] = generateLayout(claim(), 'metadata').sections;
    expect(section?.label).toEqual({ keys: ['layout.schema.claim'], fallback: 'Claim' });
    expect(section?.fields[1]?.label).toEqual({
      keys: ['layout.field.claim:billedAmount'],
      fallback: 'Billed amount',
    });
  });

  it('adds nothing to a stock File: every one of its schemas is already presented', () => {
    const file = readDocumentType(
      {
        schemas: ['common', 'file', 'dublincore', 'uid', 'files', 'facetedTag', 'relatedtext'].map(
          (name) => ({
            name,
            fields: { anything: 'string' },
          }),
        ),
      },
      'File',
    );
    expect(file && generateLayout(file, 'metadata').sections).toEqual([]);
  });

  it('adds nothing to a stock Picture, including the iptc schema a distribution may add', () => {
    const picture = readDocumentType(
      {
        schemas: [
          'common',
          'uid',
          'dublincore',
          'facetedTag',
          'file',
          'picture',
          'image_metadata',
          'iptc',
          'relatedtext',
        ].map((name) => ({ name, fields: { anything: 'string' } })),
      },
      'Picture',
    );
    expect(picture && generateLayout(picture, 'metadata').sections).toEqual([]);
  });

  it('shows a customer schema added to a stock type, and drops a schema with no fields', () => {
    const file = readDocumentType(
      {
        schemas: [
          { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
          { name: 'contract', '@prefix': 'ct', fields: { party: 'string' } },
          { name: 'marker', fields: {} },
        ],
      },
      'File',
    );
    expect(file && generateLayout(file, 'metadata').sections.map((section) => section.id)).toEqual([
      'contract',
    ]);
  });
});

describe('applyLayoutFile', () => {
  const file = (content: Record<string, unknown>) => {
    const read = readLayoutFile(content);
    if ('invalid' in read) throw new Error(read.invalid);
    return read;
  };

  it('shows exactly the listed fields, in the file order, and nothing generated', () => {
    const { layout, skipped } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        display: 'tabs',
        sections: [
          { id: 'summary', label: 'Summary', fields: ['claim:status', 'claim:number'] },
          { id: 'more', labelKey: 'acme.more', fields: ['dc:title'] },
        ],
      }),
    );
    expect(skipped).toEqual([]);
    expect(layout.source).toBe('contributed');
    expect(layout.display).toBe('tabs');
    expect(
      layout.sections.map((section) => [section.id, section.fields.map((field) => field.xpath)]),
    ).toEqual([
      ['summary', ['claim:status', 'claim:number']],
      ['more', ['dc:title']],
    ]);
    expect(layout.sections.map((section) => section.label)).toEqual([
      { literal: 'Summary', keys: [], fallback: null },
      { keys: ['acme.more'], fallback: null },
    ]);
  });

  it('honours a field label literal and key ahead of the generated key', () => {
    const { layout } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        sections: [
          {
            id: 'a',
            fields: [{ field: 'claim:status', label: 'Status', labelKey: 'acme.status' }],
          },
        ],
      }),
    );
    expect(layout.sections[0]?.fields[0]?.label).toEqual({
      literal: 'Status',
      keys: ['acme.status', 'layout.field.claim:status'],
      fallback: 'Status',
    });
  });

  it('skips a field the type does not have and keeps the rest', () => {
    const { layout, skipped } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        sections: [{ id: 'a', fields: ['claim:nope', 'member:plan', 'claim:number'] }],
      }),
    );
    expect(skipped).toEqual(['claim:nope', 'member:plan']);
    expect(layout.sections[0]?.fields.map((field) => field.xpath)).toEqual(['claim:number']);
  });

  it('finds a field of a facet schema passed beside the type', () => {
    const external: DocumentTypeSchema = {
      name: 'externalEntity',
      prefix: 'externalEntity',
      fields: { origin: { type: 'string' } },
    };
    const contents = file({
      version: 1,
      sections: [{ id: 'a', fields: ['externalEntity:origin'] }],
    });
    const without = applyLayoutFile(claim(), 'metadata', contents);
    expect(without.skipped).toEqual(['externalEntity:origin']);
    // On a document without the facet the section has nothing left to show, so it is left out
    // rather than left as a dangling heading — the case a layout shared with a facet hits.
    expect(without.layout.sections).toEqual([]);
    const { layout, skipped } = applyLayoutFile(claim(), 'metadata', contents, [external]);
    expect(skipped).toEqual([]);
    expect(layout.sections[0]?.fields[0]).toMatchObject({
      xpath: 'externalEntity:origin',
      definition: { type: 'string' },
      label: { fallback: 'Origin' },
    });
  });

  it('addresses a prefix-less schema by its name, as Nuxeo does', () => {
    const { layout, skipped } = applyLayoutFile(
      claim(),
      'metadata',
      file({ version: 1, sections: [{ id: 'a', fields: ['file:content'] }] }),
    );
    expect(skipped).toEqual([]);
    expect(layout.sections[0]?.fields[0]?.definition).toEqual({ type: 'blob' });
  });

  /**
   * The three sections of the NXSAT-728 repro: one that resolves a field, one whose fields the
   * type does not have, one that lists none. Only the first is a section to render, as the
   * generated layout leaves out a schema with no fields.
   */
  it('leaves out a section with no fields and one whose every field is unknown, keeping the rest', () => {
    const { layout, skipped } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        sections: [
          { id: 'details', label: 'Details', fields: ['dc:title'] },
          { id: 'extra', label: 'Extra info', fields: ['qa:missing', 'qa:gone'] },
          { id: 'nothing', label: 'Nothing here', fields: [] },
        ],
      }),
    );
    expect(
      layout.sections.map((section) => [section.id, section.fields.map((field) => field.xpath)]),
    ).toEqual([['details', ['dc:title']]]);
    // The warning for a typo in a layout file is the only diagnostic its author gets, so
    // dropping the section must not stop the fields under it being reported.
    expect(skipped).toEqual(['qa:missing', 'qa:gone']);
  });

  it('resolves to no sections at all when no section of the file has a field to show', () => {
    const { layout, skipped } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        sections: [
          { id: 'only', label: 'Nothing at all', fields: ['qa:missing'] },
          { id: 'empty', label: 'Nothing here either', fields: [] },
        ],
      }),
    );
    expect(layout.sections).toEqual([]);
    expect(skipped).toEqual(['qa:missing']);
  });

  // That no tab is then offered for it is asserted of the rendered tabs in
  // `document-layout.spec.ts`; this one is about the sections the resolver answers with.
  it('leaves out an empty section in tabs display too, keeping the display', () => {
    const { layout } = applyLayoutFile(
      claim(),
      'metadata',
      file({
        version: 1,
        display: 'tabs',
        sections: [
          { id: 'details', label: 'Details', fields: ['claim:number'] },
          { id: 'extra', label: 'Extra info', fields: ['qa:missing'] },
        ],
      }),
    );
    expect(layout.display).toBe('tabs');
    expect(layout.sections.map((section) => section.id)).toEqual(['details']);
  });
});

describe('edit and create layouts', () => {
  /** Field shapes as `/config/schemas/<name>` answers them, constraints included. */
  const POLICY = {
    name: 'policy',
    '@prefix': 'pol',
    fields: {
      number: {
        type: 'string',
        constraints: [
          { name: 'NotNullConstraint', parameters: {} },
          { name: 'PatternConstraint', parameters: { Pattern: '[A-Z]{2}-\\d+' } },
          { name: 'string', parameters: {} },
        ],
      },
      notes: {
        type: 'string',
        constraints: [{ name: 'LengthConstraint', parameters: { Minimum: '3', Maximum: '2000' } }],
      },
      premium: {
        type: 'double',
        constraints: [
          {
            name: 'NumericIntervalConstraint',
            parameters: {
              Minimum: '0',
              MinimumInclusive: 'false',
              Maximum: '1000000',
              MaximumInclusive: 'true',
            },
          },
        ],
      },
      codes: {
        type: 'string[]',
        constraints: [],
        itemConstraints: [{ name: 'LengthConstraint', parameters: { Maximum: '8' } }],
      },
      scan: { type: 'blob', constraints: [] },
      scans: { type: 'blob[]', constraints: [] },
    },
  };

  const policyType = (): DocumentTypeDefinition => {
    const schema = readSchema(POLICY);
    if (!schema) throw new Error('fixture did not read');
    return { name: 'Policy', schemas: [schema] };
  };

  it('reads required, pattern, length and interval constraints, and item constraints of a list', () => {
    const fields = readSchema(POLICY)?.fields ?? {};
    expect(fields['number']).toEqual({
      type: 'string',
      required: true,
      constraints: { pattern: '[A-Z]{2}-\\d+' },
    });
    expect(fields['notes']?.constraints).toEqual({ minLength: 3, maxLength: 2000 });
    expect(fields['premium']?.constraints).toEqual({
      minimum: 0,
      minimumInclusive: false,
      maximum: 1000000,
    });
    expect(fields['codes']?.constraints).toEqual({ maxLength: 8 });
    expect(fields['scan']).toEqual({ type: 'blob' });
  });

  it('ignores a bound it cannot read rather than inventing one', () => {
    const schema = readSchema({
      name: 's',
      fields: {
        a: {
          type: 'long',
          constraints: [{ name: 'NumericIntervalConstraint', parameters: { Minimum: '' } }],
        },
        b: {
          type: 'string',
          constraints: [{ name: 'LengthConstraint', parameters: { Maximum: 'many' } }],
        },
        c: { type: 'string', constraints: [{ name: 'PatternConstraint', parameters: {} }, 'junk'] },
      },
    });
    expect(schema?.fields).toEqual({
      a: { type: 'long' },
      b: { type: 'string' },
      c: { type: 'string' },
    });
  });

  it('leaves file fields out of the generated edit and create forms, not out of metadata', () => {
    const xpaths = (mode: 'metadata' | 'edit' | 'create') =>
      generateLayout(policyType(), mode).sections.flatMap((s) => s.fields.map((f) => f.xpath));
    expect(xpaths('metadata')).toContain('pol:scan');
    for (const mode of ['edit', 'create'] as const) {
      expect(xpaths(mode)).toEqual(['pol:codes', 'pol:notes', 'pol:number', 'pol:premium']);
      expect(generateLayout(policyType(), mode).mode).toBe(mode);
    }
  });

  it('lets a layout file make a field required, never optional', () => {
    const read = readLayoutFile({
      version: 1,
      sections: [
        {
          id: 'a',
          fields: [
            { field: 'pol:notes', required: true },
            { field: 'pol:number', required: false },
            { field: 'pol:premium', required: 'yes' },
          ],
        },
      ],
    });
    if ('invalid' in read) throw new Error(read.invalid);
    const { layout } = applyLayoutFile(policyType(), 'edit', read);
    expect(
      layout.sections[0]?.fields.map((f) => [f.xpath, f.definition.required ?? false]),
    ).toEqual([
      ['pol:notes', true],
      ['pol:number', true],
      ['pol:premium', false],
    ]);
  });
});
