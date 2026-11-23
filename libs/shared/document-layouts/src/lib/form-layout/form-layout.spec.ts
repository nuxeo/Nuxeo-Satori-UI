import { describe, expect, it } from 'vitest';

import { MAX_RULE_LEVELS } from '../record-page/record-layout';
import type { DocumentTypeDefinition } from '../layout.model';
import { readFormLayout, type FormLayoutFile, type FormPropertyField } from './form-layout';
import { formFacetSchemasToRead, resolveFormLayout } from './resolve-form-layout';

/**
 * The rules this build registers in these tests: some of the platform's, a customer's own Layer 2
 * rule, and `app.rules.fieldIn`. `app.rules.inGroup` stands for a platform rule a build was made
 * without.
 */
const known = [
  'core.every',
  'core.some',
  'core.not',
  'app.rules.canWrite',
  'app.rules.fieldIn',
  'acme.rules.isVip',
];

function read(content: Record<string, unknown>, kind: 'edit' | 'create' | 'task' = 'edit') {
  const file = readFormLayout(content, kind, { rules: known });
  if ('invalid' in file) throw new Error(`refused: ${file.invalid}`);
  return file;
}

const decided = { type: 'app.rules.fieldIn', parameters: [{ field: 'claim:status' }, 'decided'] };

/** The Claim edit form: a status, an amount required once decided, and a service period. */
const CLAIM_EDIT = {
  version: 2,
  cards: [
    {
      id: 'claim',
      labelKey: 'acme.claim.card',
      fields: [
        'claim:number',
        { field: 'claim:status', widget: 'vocabulary', parameters: { directory: 'claimStatus' } },
        {
          field: 'claim:allowed',
          widget: 'currency',
          parameters: { currency: 'USD' },
          required: decided,
          readOnlyWhen: 'app.rules.canWrite',
          checks: [
            {
              type: 'core.atMost',
              parameters: [{ field: 'claim:billed' }],
              label: 'No more than the billed amount',
            },
          ],
        },
        { field: 'claim:serviceStart', widget: 'date', required: true },
        {
          field: 'claim:serviceEnd',
          widget: 'date',
          checks: [
            {
              type: 'core.notBefore',
              parameters: [{ field: 'claim:serviceStart' }],
              labelKey: 'acme.claim.endBeforeStart',
            },
          ],
        },
      ],
    },
  ],
};

const field = (file: FormLayoutFile, index: number) =>
  file.cards[0]?.fields[index] as FormPropertyField;

describe('readFormLayout', () => {
  it('reads cards, and each field’s widget, required, read-only rule and checks', () => {
    const file = read(CLAIM_EDIT);
    expect(file.problems).toEqual([]);
    expect(file.tabs).toBeNull();
    expect(file.cards.map((card) => card.id)).toEqual(['claim']);
    expect(file.cards[0]?.label).toEqual({ keys: ['acme.claim.card'], fallback: null });
    expect(field(file, 0)).toMatchObject({
      kind: 'property',
      xpath: 'claim:number',
      widget: null,
      required: false,
      readOnlyWhen: null,
      checks: [],
    });
    expect(field(file, 2)).toMatchObject({
      xpath: 'claim:allowed',
      widget: 'currency',
      parameters: { currency: 'USD' },
      required: decided,
      readOnlyWhen: 'app.rules.canWrite',
      checks: [
        {
          place: 'cards[0].fields[2].checks[0]',
          type: 'core.atMost',
          parameters: [{ field: 'claim:billed' }],
          label: { literal: 'No more than the billed amount', keys: [], fallback: null },
        },
      ],
    });
    expect(field(file, 3).required).toBe(true);
    expect(field(file, 4).checks[0]?.label).toEqual({
      keys: ['acme.claim.endBeforeStart'],
      fallback: null,
    });
  });

  it('reads tabs, each holding cards', () => {
    const file = read({
      version: 2,
      tabs: [
        { id: 'main', label: 'Main', cards: [{ id: 'a', fields: ['claim:number'] }] },
        {
          id: 'more',
          visibleWhen: 'acme.rules.isVip',
          cards: [{ id: 'b', fields: ['claim:notes'] }],
        },
      ],
    });
    expect(file.cards).toEqual([]);
    expect(file.tabs?.map((tab) => [tab.id, tab.label, tab.visibleWhen])).toEqual([
      ['main', { literal: 'Main', keys: [], fallback: 'Main' }, null],
      ['more', { keys: [], fallback: 'More' }, 'acme.rules.isVip'],
    ]);
  });

  it('reads a computed field, which a form shows and never edits', () => {
    const file = read({
      version: 2,
      cards: [
        {
          id: 'member',
          fields: [
            {
              id: 'age',
              widget: 'number',
              computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
            },
          ],
        },
      ],
    });
    expect(file.cards[0]?.fields[0]).toMatchObject({
      kind: 'computed',
      id: 'age',
      widget: 'number',
    });
  });

  describe('refuses the whole file for a structural error', () => {
    it.each([
      ['not version 2', { version: 1, cards: [] }, 'version: version must be 2, not 1'],
      [
        'columns, which belong in view mode',
        { version: 2, columns: 2, cards: [{ id: 'a', fields: ['a:b'] }] },
        'columns: columns belongs in view mode only',
      ],
      [
        'related records, which belong in view mode',
        {
          version: 2,
          cards: [{ id: 'a', related: { pageProvider: 'p', columns: ['dc:title'] } }],
        },
        'cards[0].related: related records belong in view mode only',
      ],
      [
        'a var: field, which only a task form has',
        { version: 2, cards: [{ id: 'a', fields: ['var:decision'] }] },
        'cards[0].fields[0]: "var:" names a task variable, which only a task form has',
      ],
      [
        'a required computed field',
        {
          version: 2,
          cards: [
            {
              id: 'a',
              fields: [
                { id: 'n', computed: { type: 'core.count', parameters: [1] }, required: true },
              ],
            },
          ],
        },
        'cards[0].fields[0]: a computed field is never editable, so it is never required or read-only',
      ],
    ])('%s', (_, content, reason) => {
      const file = readFormLayout(content, 'edit', { rules: known });
      expect('invalid' in file && file.invalid).toBe(reason);
    });

    it('in the create mode as in the edit mode', () => {
      const file = readFormLayout({ version: 2, columns: 1, cards: [] }, 'create', {
        rules: known,
      });
      expect('invalid' in file && file.invalid).toBe('columns: columns belongs in view mode only');
    });
  });

  describe('leaves out what this build does not have, and says why', () => {
    it('a field naming a widget nobody registered', () => {
      const file = read({
        version: 2,
        cards: [{ id: 'a', fields: ['claim:number', { field: 'claim:map', widget: 'acme.map' }] }],
      });
      expect(file.cards[0]?.fields.map((entry) => entry.place)).toEqual(['cards[0].fields[0]']);
      expect(file.problems).toEqual([
        'cards[0].fields[1].widget: the widget "acme.map" is not registered; cards[0].fields[1] left out',
      ]);
    });

    it('a field with a check nobody registered: its value would be saved unchecked', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'claim:number',
              { field: 'claim:end', checks: [{ type: 'acme.weekday', parameters: [] }] },
            ],
          },
        ],
      });
      expect(file.cards[0]?.fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1].checks[0].type: the check "acme.weekday" is not registered; cards[0].fields[1] left out',
      ]);
    });

    it('a field required, or read-only, by a rule this build does not register', () => {
      const unregistered = { type: 'app.rules.inGroup', parameters: ['adjusters'] };
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              { field: 'claim:a', required: unregistered },
              { field: 'claim:b', readOnlyWhen: unregistered },
              'claim:c',
            ],
          },
        ],
      });
      expect(file.cards[0]?.fields.map((entry) => entry.place)).toEqual(['cards[0].fields[2]']);
      expect(file.problems).toEqual([
        'cards[0].fields[0] names the rule "app.rules.inGroup", which this build does not register; left out',
        'cards[0].fields[1] names the rule "app.rules.inGroup", which this build does not register; left out',
      ]);
    });

    it('a field whose check’s computed bound takes a rule this build does not register', () => {
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'claim:a',
              {
                field: 'claim:b',
                checks: [
                  {
                    type: 'core.atMost',
                    parameters: [
                      {
                        computed: {
                          type: 'core.choose',
                          parameters: [{ type: 'app.rules.inGroup', parameters: ['x'] }, 1, 2],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(file.cards[0]?.fields).toHaveLength(1);
      expect(file.problems).toEqual([
        'cards[0].fields[1] names the rule "app.rules.inGroup", which this build does not register; left out',
      ]);
    });

    it('a field whose required rule nests deeper than the rule registry answers', () => {
      let rule: unknown = 'app.rules.canWrite';
      for (let level = 1; level <= MAX_RULE_LEVELS; level++)
        rule = { type: 'core.not', parameters: [rule] };
      const file = read({
        version: 2,
        cards: [{ id: 'a', fields: ['claim:a', { field: 'claim:b', required: rule }] }],
      });
      expect(file.cards[0]?.fields).toHaveLength(1);
      expect(file.problems).toEqual([
        `cards[0].fields[1] nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers; left out`,
      ]);
    });

    it('a card left with no field, and a tab left with no card', () => {
      const file = read({
        version: 2,
        tabs: [
          { id: 'kept', cards: [{ id: 'a', fields: ['claim:a'] }] },
          { id: 'gone', cards: [{ id: 'b', fields: [{ field: 'claim:b', widget: 'acme.map' }] }] },
        ],
      });
      expect(file.tabs?.map((tab) => tab.id)).toEqual(['kept']);
    });
  });

  describe('a task form', () => {
    const TASK = {
      version: 2,
      cards: [
        { id: 'claim', fields: ['claim:number'] },
        {
          id: 'determination',
          fields: [
            {
              field: 'var:decision',
              widget: 'vocabulary',
              parameters: { directory: 'claimDecision' },
              required: true,
            },
            {
              field: 'var:allowedAmount',
              required: {
                type: 'app.rules.fieldIn',
                parameters: [{ field: 'var:decision' }, 'approve'],
              },
            },
          ],
        },
      ],
    };

    it('reads its var: fields, which only a task form has', () => {
      const file = read(TASK, 'task');
      expect(file.kind).toBe('task');
      expect(file.cards[1]?.fields.map((entry) => (entry as FormPropertyField).xpath)).toEqual([
        'var:decision',
        'var:allowedAmount',
      ]);
    });

    it('refuses a required record property: a task form shows those read-only', () => {
      const file = readFormLayout(
        { version: 2, cards: [{ id: 'a', fields: [{ field: 'claim:number', required: true }] }] },
        'task',
        { rules: known },
      );
      expect('invalid' in file && file.invalid).toBe(
        `cards[0].fields[0].required: "required" belongs on a var: field: a task form shows the record's own properties read-only`,
      );
    });
  });
});

const CLAIM: DocumentTypeDefinition = {
  name: 'Claim',
  schemas: [
    {
      name: 'claim',
      prefix: 'claim',
      fields: {
        number: { type: 'string' },
        status: { type: 'string' },
        allowed: { type: 'double' },
        billed: { type: 'double' },
        serviceStart: { type: 'date' },
        serviceEnd: { type: 'date' },
      },
    },
  ],
};

describe('resolveFormLayout', () => {
  it('gives each field its property’s definition', () => {
    const { layout, skipped } = resolveFormLayout(CLAIM, read(CLAIM_EDIT));
    expect(skipped).toEqual([]);
    expect(layout).toMatchObject({ version: 2, kind: 'edit', type: 'Claim', tabs: null });
    expect(
      layout.cards[0]?.fields.map((entry) => entry.kind === 'property' && entry.definition),
    ).toEqual([
      { type: 'string' },
      { type: 'string' },
      { type: 'double' },
      { type: 'date' },
      { type: 'date' },
    ]);
  });

  it('leaves out a field the type lacks, and one whose widget does not show its type', () => {
    const { layout, skipped } = resolveFormLayout(
      CLAIM,
      read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: ['claim:number', 'claim:missing', { field: 'claim:number', widget: 'date' }],
          },
        ],
      }),
    );
    expect(layout.cards[0]?.fields).toHaveLength(1);
    expect(skipped).toEqual([
      { place: 'cards[0].fields[1]', xpath: 'claim:missing', reason: 'not-on-type' },
      {
        place: 'cards[0].fields[2]',
        xpath: 'claim:number',
        reason: 'widget-type',
        widget: 'date',
        type: 'string',
      },
    ]);
  });

  it('holds a task form’s var: fields to the step’s variables, and to nothing else', () => {
    const file = read(
      {
        version: 2,
        cards: [{ id: 'a', fields: ['claim:number', 'var:decision', 'var:unknown'] }],
      },
      'task',
    );
    const { layout, skipped } = resolveFormLayout(
      CLAIM,
      file,
      [],
      new Map([['var:decision', { type: 'string' }]]),
    );
    expect(
      layout.cards[0]?.fields.map((entry) => entry.kind === 'property' && entry.xpath),
    ).toEqual(['claim:number', 'var:decision']);
    expect(skipped).toEqual([
      { place: 'cards[0].fields[2]', xpath: 'var:unknown', reason: 'not-on-type' },
    ]);
    // Outside a task form, no variable is a property, even if one is given.
    const edit = resolveFormLayout(
      CLAIM,
      read(CLAIM_EDIT),
      [],
      new Map([['claim:x', { type: 'string' }]]),
    );
    expect(edit.layout.properties.has('claim:x')).toBe(false);
  });

  it('reads only the facet schemas a field or a computation names', () => {
    const file = read({
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            'claim:number',
            'audit:reviewer',
            { id: 't', computed: { type: 'core.template', parameters: ['{risk:score}'] } },
          ],
        },
      ],
    });
    const wanted = formFacetSchemasToRead(
      CLAIM,
      [
        { name: 'claim', prefix: 'claim' },
        { name: 'audit', prefix: 'audit' },
        { name: 'risk', prefix: 'risk' },
        { name: 'other', prefix: 'other' },
      ],
      file,
    );
    expect(wanted.map((schema) => schema.name)).toEqual(['audit', 'risk']);
  });
});
