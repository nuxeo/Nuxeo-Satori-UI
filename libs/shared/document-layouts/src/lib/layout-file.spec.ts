import { readLayoutEnvelope, readLayoutFile, readLayoutIndex } from './layout-file';

const FORMAT = 'nuxeo-agentic-ui-config/1';

describe('readLayoutIndex', () => {
  it('lists the types and modes in force, with the component behind each', () => {
    const index = readLayoutIndex({
      format: FORMAT,
      layer: 'layouts',
      layouts: [
        {
          type: 'Claim',
          mode: 'metadata',
          url: 'layouts/Claim/metadata.layout.json',
          component: 'org.acme.config',
        },
        { type: 'Member', mode: 'edit' },
      ],
      diagnostics: [
        {
          level: 'info',
          code: 'replaced',
          message: 'layout Claim/metadata from a is replaced by b.',
        },
      ],
    });
    expect(index).toEqual({
      entries: [
        { type: 'Claim', mode: 'metadata', component: 'org.acme.config' },
        { type: 'Member', mode: 'edit', component: '' },
      ],
      diagnostics: [
        {
          level: 'info',
          code: 'replaced',
          message: 'layout Claim/metadata from a is replaced by b.',
        },
      ],
    });
  });

  it('drops entries whose type or mode the server would have refused', () => {
    const index = readLayoutIndex({
      format: FORMAT,
      layer: 'layouts',
      layouts: [
        { type: '../Claim', mode: 'metadata' },
        { type: 'Claim', mode: 'Metadata' },
        { type: 'Claim' },
        'Claim/metadata',
        { type: 'Claim', mode: 'metadata' },
      ],
      diagnostics: [],
    });
    expect('invalid' in index ? [] : index.entries).toEqual([
      { type: 'Claim', mode: 'metadata', component: '' },
    ]);
  });

  it('refuses anything that is not the layouts envelope', () => {
    expect(readLayoutIndex({ layouts: [] })).toEqual({ invalid: `not a ${FORMAT} response` });
    expect(readLayoutIndex({ format: FORMAT, layer: 'manifest', fragments: [] })).toEqual({
      invalid: 'expected layer "layouts", got "manifest"',
    });
    expect(readLayoutIndex({ format: FORMAT, layer: 'layouts', layouts: {} })).toEqual({
      invalid: 'layouts must be a list',
    });
    expect(readLayoutIndex(null)).toEqual({ invalid: `not a ${FORMAT} response` });
  });
});

describe('readLayoutEnvelope', () => {
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    format: FORMAT,
    layer: 'layout',
    type: 'Claim',
    mode: 'metadata',
    content: { version: 1, sections: [] },
    ...overrides,
  });

  it('returns the content of the layout asked for', () => {
    expect(readLayoutEnvelope(envelope(), 'Claim', 'metadata')).toEqual({
      content: { version: 1, sections: [] },
    });
  });

  it('refuses a layout for another type or mode, or a body that is not an object', () => {
    expect(readLayoutEnvelope(envelope({ type: 'Member' }), 'Claim', 'metadata')).toEqual({
      invalid: 'expected the Claim/metadata layout',
    });
    expect(readLayoutEnvelope(envelope({ mode: 'edit' }), 'Claim', 'metadata')).toHaveProperty(
      'invalid',
    );
    expect(readLayoutEnvelope(envelope({ layer: 'layouts' }), 'Claim', 'metadata')).toHaveProperty(
      'invalid',
    );
    expect(readLayoutEnvelope(envelope({ content: [] }), 'Claim', 'metadata')).toEqual({
      invalid: 'content must be a JSON object',
    });
    expect(readLayoutEnvelope({ content: {} }, 'Claim', 'metadata')).toEqual({
      invalid: `not a ${FORMAT} response`,
    });
  });
});

describe('readLayoutFile', () => {
  it('reads sections, fields in both forms, and labels', () => {
    const file = readLayoutFile({
      version: 1,
      sections: [
        {
          id: 'summary',
          label: 'Claim summary',
          fields: [
            'claim:number',
            { field: 'claim:status', label: 'Status', labelKey: 'acme.status' },
          ],
        },
        { id: 'amounts', labelKey: 'acme.amounts', fields: [] },
      ],
    });
    expect(file).toEqual({
      display: 'sections',
      problems: [],
      sections: [
        {
          id: 'summary',
          label: 'Claim summary',
          labelKey: undefined,
          fields: [
            { field: 'claim:number' },
            { field: 'claim:status', label: 'Status', labelKey: 'acme.status' },
          ],
        },
        { id: 'amounts', label: undefined, labelKey: 'acme.amounts', fields: [] },
      ],
    });
  });

  it('accepts a section id of 64 characters', () => {
    expect(
      readLayoutFile({ version: 1, sections: [{ id: `s${'.'.repeat(63)}`, fields: [] }] }),
    ).toHaveProperty('sections');
  });

  it('accepts display tabs and an empty layout', () => {
    expect(readLayoutFile({ version: 1, display: 'tabs', sections: [] })).toEqual({
      display: 'tabs',
      sections: [],
      problems: [],
    });
  });

  it('skips a field entry that is not an xpath, and says which', () => {
    const file = readLayoutFile({
      version: 1,
      sections: [{ id: 'a', fields: ['claim number', { label: 'no field' }, 42, 'claim:number'] }],
    });
    expect('invalid' in file).toBe(false);
    if ('invalid' in file) return;
    expect(file.sections[0]?.fields).toEqual([{ field: 'claim:number' }]);
    expect(file.problems).toEqual([
      'section "a" field 1 is not "<prefix>:<name>"',
      'section "a" field 2 is not "<prefix>:<name>"',
      'section "a" field 3 is not "<prefix>:<name>"',
    ]);
  });

  it('skips a field listed twice in one section, and says so; another section may list it again', () => {
    const file = readLayoutFile({
      version: 1,
      sections: [
        {
          id: 'a',
          fields: ['claim:number', { field: 'claim:number', label: 'Again' }, 'claim:status'],
        },
        { id: 'b', fields: ['claim:number'] },
      ],
    });
    expect('invalid' in file).toBe(false);
    if ('invalid' in file) return;
    expect(file.sections.map((section) => section.fields.map((field) => field.field))).toEqual([
      ['claim:number', 'claim:status'],
      ['claim:number'],
    ]);
    expect(file.problems).toEqual(['section "a" lists claim:number twice']);
  });

  it.each([
    [{ sections: [] }, 'version must be 1, got null'],
    [{ version: 2, sections: [] }, 'version must be 1, got 2'],
    [{ version: '1', sections: [] }, 'version must be 1, got "1"'],
    [
      { version: 1, display: 'grid', sections: [] },
      'display must be "sections" or "tabs", got "grid"',
    ],
    [{ version: 1 }, 'sections must be a list'],
    [{ version: 1, sections: ['a'] }, 'sections[0] must be an object'],
    [
      { version: 1, sections: [{ fields: [] }] },
      "sections[0].id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit",
    ],
    [
      { version: 1, sections: [{ id: 'a b', fields: [] }] },
      "sections[0].id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit",
    ],
    [
      { version: 1, sections: [{ id: '_summary', fields: [] }] },
      "sections[0].id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit",
    ],
    [
      { version: 1, sections: [{ id: 'a'.repeat(65), fields: [] }] },
      "sections[0].id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit",
    ],
    [
      {
        version: 1,
        sections: [
          { id: 'a', fields: [] },
          { id: 'a', fields: [] },
        ],
      },
      'section id "a" is used twice',
    ],
    [{ version: 1, sections: [{ id: 'a', feilds: [] }] }, 'section "a" needs a fields list'],
  ])('refuses %j: %s', (content, reason) => {
    expect(readLayoutFile(content)).toEqual({ invalid: reason });
  });
});
