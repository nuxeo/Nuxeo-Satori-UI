import {
  propertiesOf,
  propertyTypeOf,
  readContentModel,
  type ContentModel,
  type PropertyModel,
} from './content-model';

/**
 * Answers as a Nuxeo 2023 server gives them, cut down: `/config/types`' doctypes, `/config/facets`,
 * and schemas in both of `/config/schemas`' shapes. The list answers each field as its bare type,
 * and a complex one with its subfields; `/config/schemas/<name>` read with `fetch-schema: fields`
 * answers each field as an object with its constraints, which name a vocabulary.
 */
const doctypes = {
  Document: { parent: 'None!!!', facets: [], schemas: [] },
  File: {
    parent: 'Document',
    facets: ['Versionable', 'NXTag', 'Downloadable'],
    schemas: ['common', 'file', 'dublincore', 'uid', 'files', 'facetedTag'],
  },
};
const facets = [
  {
    name: 'NXTag',
    schemas: [
      {
        name: 'facetedTag',
        '@prefix': 'nxtag',
        fields: {
          tags: { fields: { label: 'string', username: 'string' }, type: 'complex[]' },
        },
      },
    ],
  },
  { name: 'Versionable' },
  { name: 'Downloadable' },
  {
    name: 'Picture',
    schemas: [{ name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } }],
  },
];
const listed = [
  { name: 'common', '@prefix': '', fields: { icon: 'string', 'icon-expanded': 'string' } },
  { name: 'file', '@prefix': '', fields: { content: 'blob' } },
  { name: 'uid', '@prefix': '', fields: { major_version: 'long', uid: 'string' } },
  {
    name: 'files',
    '@prefix': '',
    fields: { files: { fields: { file: 'blob' }, type: 'complex[]' } },
  },
  { name: 'picture', '@prefix': 'picture', fields: { views: 'complex[]' } },
];
const dublincore = {
  'entity-type': 'schema',
  name: 'dublincore',
  prefix: 'dc',
  '@prefix': 'dc',
  fields: {
    title: { type: 'string', constraints: [{ name: 'string', parameters: {} }] },
    created: { type: 'date', constraints: [{ name: 'date', parameters: {} }] },
    coverage: {
      type: 'string',
      constraints: [
        {
          'entity-type': 'validation_constraint',
          name: 'directoryResolver',
          parameters: { directory: 'l10ncoverage', validation: 'true' },
        },
        { 'entity-type': 'validation_constraint', name: 'string', parameters: {} },
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
    contributors: {
      type: 'string[]',
      constraints: [],
      itemConstraints: [{ name: 'userManagerResolver', parameters: { includeUsers: 'true' } }],
    },
  },
};
/** What the server answers, loosely typed: the controls break it in ways no answer would. */
interface Source {
  doctypes: { File: { parent?: string; facets: string[]; schemas: string[] } } & Record<
    string,
    unknown
  >;
  facets: Record<string, unknown>[];
  schemas: ({ name?: string; fields?: unknown } & Record<string, unknown>)[];
}
const source = (): Source => ({
  doctypes: structuredClone(doctypes),
  facets: structuredClone(facets),
  schemas: [...structuredClone(listed), structuredClone(dublincore)],
});

function read(raw: unknown = source()): ContentModel {
  const reading = readContentModel(raw);
  if (!reading.model) throw new Error(reading.problems.join('\n'));
  return reading.model;
}

const plain = (property: PropertyModel | undefined): unknown =>
  property && {
    ...property,
    ...(property.fields
      ? { fields: Object.fromEntries([...property.fields].map(([k, v]) => [k, plain(v)])) }
      : {}),
  };

describe('readContentModel', () => {
  it('reads each type with its parent, facets and schemas; Document has no parent', () => {
    const model = read();
    expect(model.types.get('File')).toEqual({
      name: 'File',
      parent: 'Document',
      facets: ['Versionable', 'NXTag', 'Downloadable'],
      schemas: ['common', 'file', 'dublincore', 'uid', 'files', 'facetedTag'],
    });
    expect(model.types.get('Document')?.parent).toBeNull();
    expect(model.facets.get('NXTag')).toEqual({ name: 'NXTag', schemas: ['facetedTag'] });
    // A facet that brings no schema has no `schemas` key at all.
    expect(model.facets.get('Versionable')).toEqual({ name: 'Versionable', schemas: [] });
  });

  it("reads each property's type, whether it is a list, its subfields and its directory", () => {
    const dc = read().schemas.get('dublincore');
    expect(dc?.prefix).toBe('dc');
    expect(plain(dc?.properties.get('title'))).toEqual({ type: 'string', list: false });
    expect(plain(dc?.properties.get('created'))).toEqual({ type: 'date', list: false });
    expect(plain(dc?.properties.get('coverage'))).toEqual({
      type: 'string',
      list: false,
      directory: 'l10ncoverage',
    });
    // A list's directory binds each item, and Nuxeo says so in `itemConstraints`.
    expect(plain(dc?.properties.get('subjects'))).toEqual({
      type: 'string',
      list: true,
      directory: 'l10nsubjects',
    });
    // A user picker's resolver is not a directory.
    expect(plain(dc?.properties.get('contributors'))).toEqual({ type: 'string', list: true });
    expect(plain(read().schemas.get('files')?.properties.get('files'))).toEqual({
      type: 'complex',
      list: true,
      fields: { file: { type: 'blob', list: false } },
    });
  });

  it('names an unprefixed schema by its name, as Nuxeo writes file:content', () => {
    expect(read().schemas.get('file')?.prefix).toBe('file');
    expect(read().schemas.get('uid')?.prefix).toBe('uid');
  });

  it('takes a schema only a facet brings from the facet, when the list lacks it', () => {
    const model = read();
    expect(model.schemas.get('facetedTag')?.prefix).toBe('nxtag');
    expect(plain(model.schemas.get('facetedTag')?.properties.get('tags'))).toEqual({
      type: 'complex',
      list: true,
      fields: { label: { type: 'string', list: false }, username: { type: 'string', list: false } },
    });
  });

  it('refuses a model it cannot read whole, with every problem', () => {
    expect(readContentModel(null).problems).toEqual([
      'a content model is { doctypes, facets, schemas }',
    ]);
    expect(readContentModel({ ...source(), types: {} }).problems).toEqual([
      '"types" is not a key of a content model: doctypes, facets, schemas',
    ]);
    expect(readContentModel({ doctypes: [], facets: {}, schemas: null }).problems).toEqual([
      'doctypes is the doctypes object of /config/types',
      'facets is the list /config/facets answers',
      'schemas is the list /config/schemas answers',
    ]);
    const broken = source();
    broken.doctypes.File.schemas.push('claim');
    broken.doctypes.File.facets.push('Hidden');
    (broken.schemas[0].fields as Record<string, unknown>)['icon'] = 7;
    broken.schemas.push({ name: 'common', '@prefix': '', fields: {} });
    expect(readContentModel(broken).problems).toEqual([
      'schemas[0].fields.icon: a field is its type, or { type, fields, constraints }',
      'schemas[6]: "common" is listed twice',
      'doctypes.File.facets: the facet "Hidden" is not in facets',
      'doctypes.File.schemas: the schema "claim" is not in schemas',
    ]);
  });
  it('reads an explicit null as malformed, not as absent', () => {
    const broken = source();
    broken.schemas.push({ name: 'n', fields: null });
    broken.facets.push({ name: 'Nulls', schemas: null });
    Object.assign(broken.doctypes, { Nulls: { facets: null, schemas: null } });
    expect(readContentModel(broken).problems).toEqual([
      'schemas[6].fields: must be an object of fields',
      'facets[4].schemas: must be a list of schemas',
      'doctypes.Nulls.facets: must be a list of names',
      'doctypes.Nulls.schemas: must be a list of names',
    ]);
  });

  it('names the place of each entry it cannot read: a schema, a field, a facet, a type', () => {
    const broken = source();
    broken.schemas.push(
      { fields: {} },
      { name: 'z', fields: [] },
      {
        name: 'y',
        fields: { untyped: { constraints: [] }, nested: { type: 'complex', fields: 'x' } },
      },
    );
    broken.facets.push({}, { name: 'X', schemas: {} }, { name: 'NXTag' });
    Object.assign(broken.doctypes, {
      Broken: 'x',
      Odd: { parent: 3, facets: 'x', schemas: [''] },
    });
    expect(readContentModel(broken).problems).toEqual([
      'schemas[6]: a schema is { name, @prefix, fields }',
      'schemas[7].fields: must be an object of fields',
      "schemas[8].fields.untyped.type: must be the field's type",
      'schemas[8].fields.nested.fields: must be an object of fields',
      'facets[4]: a facet is { name, schemas }',
      'facets[5].schemas: must be a list of schemas',
      'facets[6]: "NXTag" is listed twice',
      'doctypes.Broken: a document type is { parent, facets, schemas }',
      'doctypes.Odd.facets: must be a list of names',
      'doctypes.Odd.schemas: must be a list of names',
      'doctypes.Odd.parent: must be the name of a type',
    ]);
  });
  it("refuses a schema's prefix that is not a text, or two that disagree, rather than read it as none", () => {
    const broken = source();
    broken.schemas.push(
      { name: 'a', '@prefix': 123, fields: { title: 'string' } },
      { name: 'b', prefix: null, fields: {} },
      { name: 'c', '@prefix': 'c1', prefix: 'c2', fields: {} },
      // Empty and missing are the name, as Nuxeo means them; the same prefix twice is one.
      { name: 'd', '@prefix': '', prefix: 'dd', fields: {} },
      { name: 'e', '@prefix': 'ee', prefix: 'ee', fields: {} },
    );
    expect(readContentModel(broken).problems).toEqual([
      "schemas[6].@prefix: must be the schema's prefix, a text",
      "schemas[7].prefix: must be the schema's prefix, a text",
      'schemas[8]: its @prefix and prefix disagree, "c1" and "c2"',
    ]);
    broken.schemas.splice(6, 3);
    const model = read(broken);
    expect(model.schemas.get('d')?.prefix).toBe('dd');
    expect(model.schemas.get('e')?.prefix).toBe('ee');
  });
});

describe('propertiesOf', () => {
  it("is every property of the type's schemas and of the facets it declares", () => {
    const model = read();
    const properties = propertiesOf(model, 'File');
    expect([...(properties?.keys() ?? [])].sort()).toEqual(
      [
        'common:icon',
        'common:icon-expanded',
        'dc:contributors',
        'dc:coverage',
        'dc:created',
        'dc:subjects',
        'dc:title',
        'file:content',
        'files:files',
        'nxtag:tags',
        'uid:major_version',
        'uid:uid',
      ].sort(),
    );
    // Picture is a facet File does not declare.
    expect(properties?.has('picture:views')).toBe(false);
    expect(propertiesOf(model, 'Claim')).toBeNull();
  });

  it("adds a declared facet's schema the type's own list leaves out", () => {
    const raw = source();
    raw.doctypes.File.schemas = raw.doctypes.File.schemas.filter((name) => name !== 'facetedTag');
    expect(propertiesOf(read(raw), 'File')?.has('nxtag:tags')).toBe(true);
  });
});

describe('propertyTypeOf', () => {
  it("is the type as a widget's accepts writes it, with integer as long", () => {
    expect(propertyTypeOf({ type: 'string', list: true })).toBe('string[]');
    expect(propertyTypeOf({ type: 'complex', list: false })).toBe('complex');
    expect(propertyTypeOf({ type: 'integer', list: false })).toBe('long');
    expect(propertyTypeOf({ type: 'integer', list: true })).toBe('long[]');
  });
});
