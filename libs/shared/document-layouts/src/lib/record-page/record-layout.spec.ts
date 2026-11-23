import { describe, expect, it } from 'vitest';

import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';

import { tableColumns } from './widget-support';
import {
  MAX_RULE_LEVELS,
  entryOf,
  readRecordLayout,
  refusedRule,
  type RecordLayoutFile,
} from './record-layout';

/**
 * The rules this build registers, in these tests: some of the platform's own, a customer's own
 * Layer 2 rule the validator's packaged list does not have, and none of version 2's three, which
 * stand here for any platform rule a build was made without.
 */
const known = [
  'core.every',
  'core.some',
  'core.not',
  'app.rules.canWrite',
  'app.rules.isType',
  'acme.rules.isVip',
];

/** The row actions slot's: the platform's, and a customer's own registered in Layer 2 code. */
const rowActions = ['app.rowActions.download', 'acme.rowActions.flag'];

function read(content: Record<string, unknown>): RecordLayoutFile {
  const file = readRecordLayout(content, { rules: known, rowActions });
  if ('invalid' in file) throw new Error(`refused: ${file.invalid}`);
  return file;
}

describe('readRecordLayout', () => {
  it('reads cards, their fields and what each says', () => {
    const file = read({
      version: 2,
      columns: 2,
      cards: [
        {
          id: 'member',
          labelKey: 'payers.member.card',
          span: 2,
          visibleWhen: 'app.rules.canWrite',
          fields: [
            'member:phone',
            {
              field: 'member:status',
              widget: 'status-badge',
              parameters: { tones: { active: 'positive' } },
            },
            {
              id: 'age',
              label: 'Age',
              widget: 'number',
              computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
            },
          ],
        },
      ],
    });
    expect(file.problems).toEqual([]);
    expect(file.columns).toBe(2);
    expect(file.tabs).toBeNull();
    const [card] = file.cards;
    expect(card).toMatchObject({
      id: 'member',
      place: 'cards[0]',
      span: 2,
      visibleWhen: 'app.rules.canWrite',
    });
    expect(card.label).toEqual({ keys: ['payers.member.card'], fallback: null });
    expect(card.fields).toEqual([
      {
        kind: 'property',
        place: 'cards[0].fields[0]',
        xpath: 'member:phone',
        label: { keys: ['layout.field.member:phone'], fallback: 'Phone' },
        widget: null,
        parameters: {},
        visibleWhen: null,
      },
      {
        kind: 'property',
        place: 'cards[0].fields[1]',
        xpath: 'member:status',
        label: { keys: ['layout.field.member:status'], fallback: 'Status' },
        widget: 'status-badge',
        parameters: { tones: { active: 'positive' } },
        visibleWhen: null,
      },
      {
        kind: 'computed',
        place: 'cards[0].fields[2]',
        id: 'age',
        computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
        label: { literal: 'Age', keys: [], fallback: 'Age' },
        widget: 'number',
        parameters: {},
        visibleWhen: null,
      },
    ]);
  });

  it('reads a card of related records: its page provider, parameters, columns, order and actions', () => {
    const file = read({
      version: 2,
      columns: 2,
      cards: [
        {
          id: 'claims',
          labelKey: 'payers.member.claims',
          span: 2,
          related: {
            pageProvider: 'member_claims',
            parameters: [{ field: 'ecm:uuid' }, 'open'],
            columns: [
              'claim:number',
              {
                field: 'claim:billedAmount',
                label: 'Billed',
                widget: 'currency',
                parameters: { currency: 'USD' },
              },
            ],
            sort: [{ field: 'claim:serviceDate', order: 'desc' }, { field: 'dc:title' }],
            pageSize: 25,
            rowActions: ['app.rowActions.download'],
          },
        },
      ],
    });
    expect(file.problems).toEqual([]);
    const [card] = file.cards;
    expect(card).toMatchObject({ id: 'claims', place: 'cards[0]', span: 2, fields: [] });
    expect(card.label).toEqual({ keys: ['payers.member.claims'], fallback: null });
    expect(card.related).toEqual({
      pageProvider: 'member_claims',
      parameters: [{ field: 'ecm:uuid' }, 'open'],
      columns: [
        {
          kind: 'property',
          place: 'cards[0].related.columns[0]',
          xpath: 'claim:number',
          label: { keys: ['layout.field.claim:number'], fallback: 'Number' },
          widget: null,
          parameters: {},
          visibleWhen: null,
        },
        {
          kind: 'property',
          place: 'cards[0].related.columns[1]',
          xpath: 'claim:billedAmount',
          label: {
            literal: 'Billed',
            keys: ['layout.field.claim:billedAmount'],
            fallback: 'Billed amount',
          },
          widget: 'currency',
          parameters: { currency: 'USD' },
          visibleWhen: null,
        },
      ],
      sort: [
        { field: 'claim:serviceDate', order: 'desc' },
        { field: 'dc:title', order: 'asc' },
      ],
      pageSize: 25,
      rowActions: ['app.rowActions.download'],
    });
  });

  it('shows ten records on a page when the file gives no page size', () => {
    const file = read({
      version: 2,
      cards: [{ id: 'claims', related: { pageProvider: 'member_claims', columns: ['dc:title'] } }],
    });
    expect(file.cards[0].related).toMatchObject({
      parameters: [],
      sort: [],
      pageSize: 10,
      rowActions: [],
    });
  });

  it('defaults a card to one column of one', () => {
    const file = read({ version: 2, cards: [{ id: 'a', fields: ['dc:title'] }] });
    expect(file.columns).toBe(1);
    expect(file.cards[0].span).toBe(1);
  });

  it('reads tabs, each holding cards, and names a tab with no label from its id', () => {
    const file = read({
      version: 2,
      tabs: [{ id: 'claim-history', cards: [{ id: 'a', fields: ['dc:title'] }] }],
    });
    expect(file.cards).toEqual([]);
    expect(file.tabs?.[0]).toMatchObject({ id: 'claim-history', place: 'tabs[0]' });
    expect(file.tabs?.[0].label).toEqual({ keys: [], fallback: 'Claim history' });
    expect(file.tabs?.[0].cards[0].fields[0].place).toBe('tabs[0].cards[0].fields[0]');
  });

  describe('refuses a file with a structural error, as layout-v2.md section 8 says', () => {
    it('a version 1 file, which has no view mode', () => {
      expect(readRecordLayout({ version: 1, cards: [] }, { rules: known })).toEqual({
        invalid: 'version: version must be 2, not 1',
      });
    });

    it('a file with two structural errors, naming the first and counting the rest', () => {
      // Two cards with no id: two structural findings, of which the first is named.
      const refused = readRecordLayout(
        { version: 2, cards: [{ fields: ['dc:title'] }, { fields: ['dc:title'] }] },
        { rules: known },
      );
      expect(refused).toEqual({
        invalid: expect.stringMatching(/^cards\[0\]\.id: .* \(and 1 more\)$/),
      });
    });
  });

  describe('leaves out what this build cannot show, and says why', () => {
    it('a field naming a widget nobody registered', () => {
      const file = read({
        version: 2,
        cards: [{ id: 'a', fields: ['dc:title', { field: 'dc:x', widget: 'calendar' }] }],
      });
      expect(file.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
      expect(file.problems).toEqual([
        'cards[0].fields[1].widget: the widget "calendar" is not registered; cards[0].fields[1] left out',
      ]);
    });

    it('a field giving its widget a parameter it cannot take, and only that field', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: ['dc:title', { field: 'dc:x', widget: 'long-text', parameters: { rows: 99 } }],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1].parameters.rows: rows must be a whole number from 2 to 20; cards[0].fields[1] left out',
      ]);
    });

    it('a computed field naming a computation nobody registered', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: ['dc:title', { id: 'n', computed: { type: 'core.nope', parameters: [] } }],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1].computed.type: the computation "core.nope" is not registered; cards[0].fields[1] left out',
      ]);
    });

    /**
     * The validator knows the platform's rules, so the pipeline passes a file that uses them; a
     * build made without one does not register it. Evaluated, an unregistered rule passes, and
     * the member's social security number would show to everyone. Left out instead.
     */
    it('a field shown by a rule the validator knows and this build does not register', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'member',
            fields: [
              'member:phone',
              {
                field: 'member:ssn',
                visibleWhen: { type: 'app.rules.inGroup', parameters: ['member-services'] },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
      expect(file.problems).toEqual([
        'cards[0].fields[1] names the rule "app.rules.inGroup", which this build does not register; left out',
      ]);
    });

    it('a card, and a tab, shown by such a rule', () => {
      const file = read({
        version: 2,
        tabs: [
          { id: 'kept', cards: [{ id: 'a', fields: ['dc:title'] }] },
          {
            id: 'gone',
            visibleWhen: { type: 'app.rules.inState', parameters: ['approved'] },
            cards: [{ id: 'b', fields: ['dc:title'] }],
          },
          {
            id: 'partly',
            cards: [
              {
                id: 'c',
                visibleWhen: {
                  type: 'app.rules.fieldIn',
                  parameters: [{ field: 'dc:nature' }, 'x'],
                },
                fields: ['dc:title'],
              },
              { id: 'd', fields: ['dc:title'] },
            ],
          },
        ],
      });
      expect(file.tabs?.map((tab) => tab.id)).toEqual(['kept', 'partly']);
      expect(file.tabs?.[1].cards.map((card) => card.id)).toEqual(['d']);
      expect(file.problems).toEqual([
        'tabs[1] names the rule "app.rules.inState", which this build does not register; left out',
        'tabs[2].cards[0] names the rule "app.rules.fieldIn", which this build does not register; left out',
      ]);
    });

    it('a rule nested in a composite, at any depth', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'dc:title',
              {
                field: 'dc:x',
                visibleWhen: {
                  type: 'core.every',
                  parameters: [
                    'app.rules.canWrite',
                    {
                      type: 'core.not',
                      parameters: [{ type: 'app.rules.inState', parameters: ['approved'] }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1] names the rule "app.rules.inState", which this build does not register; left out',
      ]);
    });

    it('a computed field whose core.choose takes such a rule', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'dc:title',
              {
                id: 'c',
                computed: {
                  type: 'core.choose',
                  parameters: [{ type: 'app.rules.inGroup', parameters: ['g'] }, 'yes', 'no'],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1] names the rule "app.rules.inGroup", which this build does not register; left out',
      ]);
    });

    /** A column a rule hides would otherwise show to everyone: the whole table is left out. */
    it('a table whose column is shown by a rule this build does not register', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'dc:title',
              {
                field: 'member:lines',
                widget: 'table',
                parameters: {
                  columns: [
                    'line:code',
                    {
                      field: 'line:ssn',
                      visibleWhen: { type: 'app.rules.inGroup', parameters: ['g'] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
      expect(file.problems).toEqual([
        'cards[0].fields[1].parameters.columns[1] names the rule "app.rules.inGroup", which this build does not register; cards[0].fields[1] left out',
      ]);
    });

    /**
     * Past the registry's depth a rule passes whatever it says, so `core.false` would show what
     * it hides: the tab, card, field or table it is on is left out, wherever the rule is.
     */
    it(`a rule nested more than ${MAX_RULE_LEVELS} levels deep, wherever it is`, () => {
      const deep = nest(MAX_RULE_LEVELS + 1, 'app.rules.canWrite');
      const file = read({
        version: 2,
        tabs: [
          {
            id: 'kept',
            cards: [
              {
                id: 'a',
                fields: [
                  'dc:title',
                  { field: 'dc:x', visibleWhen: deep },
                  {
                    id: 'c',
                    computed: { type: 'core.choose', parameters: [deep, 'yes', 'no'] },
                  },
                  {
                    field: 'member:lines',
                    widget: 'table',
                    parameters: {
                      columns: ['line:code', { field: 'line:ssn', visibleWhen: deep }],
                    },
                  },
                  // At the limit, answered as written: kept.
                  { field: 'dc:y', visibleWhen: nest(MAX_RULE_LEVELS, 'app.rules.canWrite') },
                ],
              },
              { id: 'b', visibleWhen: deep, fields: ['dc:title'] },
            ],
          },
          { id: 'gone', visibleWhen: deep, cards: [{ id: 'd', fields: ['dc:title'] }] },
        ],
      });
      expect(file.tabs?.map((tab) => tab.id)).toEqual(['kept']);
      expect(file.tabs?.[0].cards.map((card) => card.id)).toEqual(['a']);
      expect(file.tabs?.[0].cards[0].fields.map((field) => field.place)).toEqual([
        'tabs[0].cards[0].fields[0]',
        'tabs[0].cards[0].fields[4]',
      ]);
      const deeper = `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`;
      expect(file.problems).toEqual([
        `tabs[0].cards[0].fields[1] ${deeper}; left out`,
        `tabs[0].cards[0].fields[2] ${deeper}; left out`,
        `tabs[0].cards[0].fields[3].parameters.columns[1] ${deeper}; tabs[0].cards[0].fields[3] left out`,
        `tabs[0].cards[1] ${deeper}; left out`,
        `tabs[1] ${deeper}; left out`,
      ]);
    });

    it('a computed column, which this build does not draw yet: that column only', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'member:lines',
                widget: 'table',
                parameters: {
                  columns: [
                    'line:code',
                    { id: 'n', computed: { type: 'core.count', parameters: [{ field: 'x:y' }] } },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[0].parameters.columns[1] is a computed column, which this build does not draw yet; that column left out',
      ]);
    });

    /**
     * A table inside a table's column is not drawn, so a rule inside it, even one this build does
     * not register, is never evaluated: the column goes, and the rest of the table stays.
     */
    it('a table inside a table, which this build does not draw yet: that column only', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'member:visits',
                widget: 'table',
                parameters: {
                  columns: [
                    'visit:note',
                    {
                      field: 'visit:calls',
                      widget: 'table',
                      parameters: {
                        columns: [
                          'call:by',
                          {
                            field: 'call:secret',
                            visibleWhen: { type: 'app.rules.inGroup', parameters: ['g'] },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[0].parameters.columns[1] is a table inside a table, which this build does not draw yet; that column left out',
      ]);
      expect(
        tableColumns(file.cards[0].fields[0].parameters['columns']).map((c) => c.subfield),
      ).toEqual(['note']);
    });

    it('a column of related records naming a widget nobody registered, and only that column', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: ['claim:number', { field: 'claim:amount', widget: 'sparkline' }],
            },
          },
        ],
      });
      expect(file.cards[0].related?.columns.map((column) => column.xpath)).toEqual([
        'claim:number',
      ]);
      expect(file.problems).toEqual([
        'cards[0].related.columns[1].widget: the widget "sparkline" is not registered; cards[0].related.columns[1] left out',
      ]);
    });

    it('a column of related records shown by a rule this build does not register', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: [
                'claim:number',
                { field: 'claim:amount', visibleWhen: 'app.rules.isNotBusy' },
              ],
            },
          },
        ],
      });
      expect(file.cards[0].related?.columns).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].related.columns[1] names the rule "app.rules.isNotBusy", which this build does not register; left out',
      ]);
    });

    it('a computed column of related records, which this build does not draw yet', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: [
                'claim:number',
                { id: 'label', computed: { type: 'core.template', parameters: ['{dc:title}'] } },
              ],
            },
          },
        ],
      });
      expect(file.cards[0].related?.columns).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].related.columns[1] is a computed column, which this build does not draw yet; that column left out',
      ]);
    });

    it('a second column of related records showing the same property', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: ['claim:number', { field: 'claim:number', label: 'Again' }],
            },
          },
        ],
      });
      expect(file.cards[0].related?.columns.map((column) => column.label.literal)).toEqual([
        undefined,
      ]);
      expect(file.problems).toEqual([
        'cards[0].related.columns[1] shows claim:number again; that column left out',
      ]);
    });

    it("a table in a related list's cell, which this build does not draw yet", () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: [
                'claim:number',
                {
                  field: 'claim:lines',
                  widget: 'table',
                  parameters: {
                    columns: [
                      'line:code',
                      { field: 'line:cost', visibleWhen: 'app.rules.canWrite' },
                    ],
                  },
                },
              ],
            },
          },
        ],
      });
      expect(file.cards[0].related?.columns.map((column) => column.xpath)).toEqual([
        'claim:number',
      ]);
      expect(file.problems).toEqual([
        "cards[0].related.columns[1] is a table in a list's cell, which this build does not draw yet; that column left out",
      ]);
    });

    it("a row action nobody registered, keeping a customer's own", () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: ['claim:number'],
              rowActions: [
                'app.rowActions.download',
                'acme.rowActions.nope',
                'acme.rowActions.flag',
              ],
            },
          },
        ],
      });
      expect(file.cards[0].related?.rowActions).toEqual([
        'app.rowActions.download',
        'acme.rowActions.flag',
      ]);
      expect(file.problems).toEqual([
        'cards[0].related.rowActions[1]: the row action "acme.rowActions.nope" is not registered; cards[0].related.rowActions[1] left out',
      ]);
    });

    it('a card of related records left with no column', () => {
      const file = read({
        version: 2,
        cards: [
          { id: 'a', fields: ['dc:title'] },
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              columns: [{ field: 'claim:amount', widget: 'sparkline' }],
            },
          },
        ],
      });
      expect(file.cards.map((card) => card.id)).toEqual(['a']);
      expect(file.problems).toContain('cards[1] has no column this build can show; left out');
    });

    it('a card left with no field, and a tab left with no card', () => {
      const file = read({
        version: 2,
        tabs: [
          { id: 'a', cards: [{ id: 'x', fields: [{ field: 'dc:x', widget: 'calendar' }] }] },
          { id: 'b', cards: [{ id: 'y', fields: ['dc:title'] }] },
        ],
      });
      expect(file.tabs?.map((tab) => tab.id)).toEqual(['b']);
    });
  });

  it("keeps a field shown by a customer's own rule, which only this build's registry knows", () => {
    const file = read({
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [{ field: 'dc:x', visibleWhen: { type: 'acme.rules.isVip', parameters: [] } }],
        },
      ],
    });
    expect(file.cards[0].fields).toHaveLength(1);
    expect(file.problems).toEqual([]);
  });

  it("does not take a rule's own parameters for rules", () => {
    const file = read({
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            { field: 'dc:x', visibleWhen: { type: 'app.rules.isType', parameters: ['Claim'] } },
          ],
        },
      ],
    });
    expect(file.cards[0].fields).toHaveLength(1);
    expect(file.problems).toEqual([]);
  });
});

describe('entryOf', () => {
  it.each([
    ['tabs[0].cards[1].fields[2].widget', 'tabs[0].cards[1].fields[2]'],
    ['cards[3].visibleWhen', 'cards[3]'],
    ['tabs[1].visibleWhen.parameters', 'tabs[1]'],
    // A widget's own lists are not the file's fields: the finding is about the field.
    ['cards[0].fields[1].parameters.columns[0].widget', 'cards[0].fields[1]'],
    ['cards[0].fields[1].parameters.fields[0]', 'cards[0].fields[1]'],
    // A list's column and row action are entries of their own, as a field is.
    ['cards[0].related.columns[1].widget', 'cards[0].related.columns[1]'],
    ['tabs[1].cards[0].related.rowActions[2]', 'tabs[1].cards[0].related.rowActions[2]'],
    ['cards[0].related.sort[0].field', 'cards[0]'],
    ['cards[0].related.pageProvider', 'cards[0]'],
  ])('%s is about %s', (path, entry) => {
    expect(entryOf(path)).toBe(entry);
  });

  it.each(['', 'columns', '$schema'])('"%s" is about the file as a whole', (path) => {
    expect(entryOf(path)).toBeNull();
  });
});

/** `inner` under composites, `levels` in all: `nest(1, r)` is `r`, `nest(2, r)` one `core.every` over it. */
function nest(levels: number, inner: ExtensionRule): ExtensionRule {
  let rule = inner;
  for (let level = 1; level < levels; level++) rule = { type: 'core.every', parameters: [rule] };
  return rule;
}

describe('refusedRule', () => {
  const isKnown = (id: string) => known.includes(id);
  it('names an unregistered rule, written as an ID or with parameters', () => {
    const refusal = 'names the rule "app.rules.nope", which this build does not register';
    expect(refusedRule('app.rules.nope', isKnown)).toBe(refusal);
    expect(refusedRule({ type: 'app.rules.nope', parameters: [] }, isKnown)).toBe(refusal);
  });

  it('is null for registered rules, and for no rule', () => {
    expect(refusedRule('app.rules.canWrite', isKnown)).toBeNull();
    expect(refusedRule(undefined, isKnown)).toBeNull();
  });

  it('looks inside composites, and only composites', () => {
    expect(
      refusedRule(
        { type: 'core.some', parameters: ['app.rules.canWrite', 'app.rules.nope'] },
        isKnown,
      ),
    ).toBe('names the rule "app.rules.nope", which this build does not register');
    expect(
      refusedRule({ type: 'app.rules.isType', parameters: ['app.rules.nope'] }, isKnown),
    ).toBeNull();
  });

  it(`answers a rule ${MAX_RULE_LEVELS} levels deep, and refuses one a level deeper`, () => {
    expect(refusedRule(nest(MAX_RULE_LEVELS, 'app.rules.canWrite'), isKnown)).toBeNull();
    expect(refusedRule(nest(MAX_RULE_LEVELS + 1, 'app.rules.canWrite'), isKnown)).toBe(
      `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`,
    );
  });

  /**
   * The limit is the registry's, held to it both ways: were the registry to answer less deep, a
   * kept rule would pass where it means to hide; were it to answer deeper, a file would lose an
   * entry for nothing.
   */
  it('is as deep as the rule registry answers a rule as written, and no deeper', () => {
    const registry = new ExtensionRuleRegistry();
    const answer = (levels: number) =>
      registry.evaluate(nest(levels, 'core.false'), EMPTY_EXTENSION_RULE_CONTEXT);
    expect(answer(MAX_RULE_LEVELS)).toBe(false);
    // One level more, the registry stops descending and passes it: what the page leaves out.
    expect(answer(MAX_RULE_LEVELS + 1)).toBe(true);
  });
});
