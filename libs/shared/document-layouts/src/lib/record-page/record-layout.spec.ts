import { describe, expect, it } from 'vitest';

import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';

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

function read(content: Record<string, unknown>): RecordLayoutFile {
  const file = readRecordLayout(content, known);
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
      expect(readRecordLayout({ version: 1, cards: [] }, known)).toEqual({
        invalid: 'version: version must be 2, not 1',
      });
    });

    it('a file with two structural errors, naming the first and counting the rest', () => {
      // Two cards with no id: two structural findings, of which the first is named.
      const refused = readRecordLayout(
        { version: 2, cards: [{ fields: ['dc:title'] }, { fields: ['dc:title'] }] },
        known,
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

    it('a card of related records, which this build does not draw yet', () => {
      const file = read({
        version: 2,
        cards: [
          { id: 'a', fields: ['dc:title'] },
          { id: 'claims', related: { pageProvider: 'member_claims', columns: ['dc:title'] } },
        ],
      });
      expect(file.cards.map((card) => card.id)).toEqual(['a']);
      expect(file.problems).toEqual([
        'cards[1] lists related records, which this build does not draw yet; left out',
      ]);
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
    ['cards[0].related.columns[1].widget', 'cards[0]'],
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
