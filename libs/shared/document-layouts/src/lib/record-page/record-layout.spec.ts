import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DATE_RULE_MAX_DAYS, validateLayoutV2 } from '@agentic-ui/shared/app-definition';
import {
  DOCUMENT_RULE_EVALUATORS,
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';

import { tableColumns } from './widget-support';
import {
  DEFAULT_TIMELINE_EVENTS,
  MAX_RULE_LEVELS,
  entryOf,
  readRecordLayout,
  refusedRule,
  type RecordLayoutFile,
} from './record-layout';

/**
 * The rules this build registers, in these tests: some of the platform's own, a customer's own
 * Layer 2 rule the validator's packaged list does not have, and none of version 2's five, which
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
    // Named by a key, so its id is the heading where the key has no text.
    expect(card.label).toEqual({ keys: ['payers.member.card'], fallback: 'Member' });
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
    expect(card.label).toEqual({ keys: ['payers.member.claims'], fallback: 'Claims' });
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

  describe('a timeline and comments', () => {
    it('reads a timeline as written, each event once, and a card of comments', () => {
      const file = read({
        version: 2,
        columns: 2,
        cards: [
          {
            id: 'history',
            label: 'History',
            span: 2,
            visibleWhen: 'app.rules.canWrite',
            timeline: {
              events: ['lifecycle_transition_event', 'documentModified', 'documentModified'],
              filter: true,
              pageSize: 25,
            },
          },
          { id: 'notes', comments: { pageSize: 3 } },
        ],
      });
      expect(file.problems).toEqual([]);
      expect(file.cards[0]).toMatchObject({
        id: 'history',
        span: 2,
        visibleWhen: 'app.rules.canWrite',
        fields: [],
        related: null,
        comments: null,
        timeline: {
          events: ['lifecycle_transition_event', 'documentModified'],
          filter: true,
          pageSize: 25,
        },
      });
      expect(file.cards[1]).toMatchObject({
        id: 'notes',
        fields: [],
        related: null,
        timeline: null,
        comments: { pageSize: 3 },
      });
    });

    it("shows the record's own changes, ten at a time, with no filter, when the file says nothing", () => {
      const file = read({
        version: 2,
        cards: [
          { id: 'history', timeline: {} },
          { id: 'notes', comments: {} },
        ],
      });
      expect(file.cards[0].timeline).toEqual({
        events: DEFAULT_TIMELINE_EVENTS,
        filter: false,
        pageSize: 10,
      });
      expect(DEFAULT_TIMELINE_EVENTS).not.toContain('download');
      expect(file.cards[1].comments).toEqual({ pageSize: 10 });
    });

    it('shows by default the kinds of event layout-v2.md lists, in its order', () => {
      const proposal = readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          '..',
          '..',
          '..',
          '..',
          'docs',
          'business-apps',
          'layout-v2.md',
        ),
        'utf8',
      );
      const paragraph = /\*\*The default kinds\*\*([\s\S]*?)`download` is not one/.exec(proposal);
      expect(paragraph).not.toBeNull();
      const listed = [...(paragraph?.[1] ?? '').matchAll(/`([A-Za-z_]+)`/g)].map(
        (match) => match[1],
      );
      expect(listed).toEqual(DEFAULT_TIMELINE_EVENTS);
    });

    it('leaves out only the card whose timeline or comments have a key this build lacks', () => {
      const file = read({
        version: 2,
        cards: [
          { id: 'a', fields: ['dc:title'] },
          { id: 'history', timeline: { groupBy: 'day' } },
          { id: 'notes', comments: { readOnly: true } },
          { id: 'more', comments: {} },
        ],
      });
      expect(file.cards.map((card) => card.id)).toEqual(['a', 'more']);
      expect(file.problems).toEqual([
        'cards[1].timeline.groupBy: "groupBy" is not a key version 2 has; cards[1] left out',
        'cards[2].comments.readOnly: "readOnly" is not a key version 2 has; cards[2] left out',
      ]);
    });

    it('refuses a file whose card has both, as a structural error', () => {
      expect(
        readRecordLayout(
          { version: 2, cards: [{ id: 'x', timeline: {}, comments: {} }] },
          { rules: known },
        ),
      ).toEqual({
        invalid:
          'cards[0]: a card has one of "fields", "related", "timeline", "comments", "external" or "checklist"',
      });
    });
  });

  describe('a checklist', () => {
    const appeal = (checklist: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
      version: 2,
      cards: [
        { id: 'case', fields: ['dc:title'] },
        { id: 'checklist', label: 'Checklist', checklist, ...more },
      ],
    });
    const items = [
      { id: 'medicalRecords', labelKey: 'payers.appeal.medicalRecords' },
      { id: 'reviewer-assigned', label: 'Reviewer assigned' },
    ];

    it('reads its property and its items, in order, each with its words', () => {
      const file = read(
        appeal({ field: 'case:checklist', items }, { visibleWhen: 'app.rules.canWrite', span: 1 }),
      );
      expect(file.problems).toEqual([]);
      expect(file.cards[1]).toMatchObject({
        id: 'checklist',
        visibleWhen: 'app.rules.canWrite',
        fields: [],
        related: null,
        timeline: null,
        comments: null,
        external: null,
        checklist: {
          field: 'case:checklist',
          items: [
            {
              id: 'medicalRecords',
              label: { keys: ['payers.appeal.medicalRecords'], fallback: 'Medical records' },
            },
            {
              id: 'reviewer-assigned',
              label: { literal: 'Reviewer assigned', keys: [], fallback: 'Reviewer assigned' },
            },
          ],
        },
      });
      expect(file.cards[0].checklist).toBeNull();
      // Read-only unless the file opts in.
      expect(file.cards[1].checklist?.tickable).toBe(false);
    });

    it('reads the opt-in to ticking, true only when the file says so', () => {
      expect(
        read(appeal({ field: 'case:checklist', items, tickable: true })).cards[1],
      ).toMatchObject({ checklist: { field: 'case:checklist', tickable: true } });
      expect(
        read(appeal({ field: 'case:checklist', items, tickable: false })).cards[1].checklist
          ?.tickable,
      ).toBe(false);
    });

    it('leaves out only its card for a key this build lacks, in it or in an item', () => {
      const file = read({
        version: 2,
        cards: [
          { id: 'a', fields: ['dc:title'] },
          { id: 'b', checklist: { field: 'case:checklist', items, editable: true } },
          {
            id: 'c',
            checklist: { field: 'case:checklist', items: [{ id: 'x', label: 'X', due: 3 }] },
          },
          { id: 'd', checklist: { field: 'case:checklist', items } },
        ],
      });
      expect(file.cards.map((card) => card.id)).toEqual(['a', 'd']);
      expect(file.problems).toEqual([
        'cards[1].checklist.editable: "editable" is not a key version 2 has; cards[1] left out',
        'cards[2].checklist.items[0].due: "due" is not a key version 2 has; cards[2] left out',
      ]);
    });

    it('leaves out a card shown by a rule this build does not register', () => {
      const file = read(
        appeal(
          { field: 'case:checklist', items },
          {
            visibleWhen: {
              type: 'app.rules.fieldIn',
              parameters: [{ field: 'case:category' }, 'appeal'],
            },
          },
        ),
      );
      expect(file.cards.map((card) => card.id)).toEqual(['case']);
      expect(file.problems).toEqual([
        'cards[1] names the rule "app.rules.fieldIn", which this build does not register; left out',
      ]);
    });

    it('refuses the whole file for an item listed twice, as a structural error', () => {
      expect(
        readRecordLayout(
          appeal({
            field: 'case:checklist',
            items: [...items, { id: 'medicalRecords', label: 'Again' }],
          }),
          { rules: known },
        ),
      ).toEqual({
        invalid:
          'cards[1].checklist.items[2].id: the item "medicalRecords" is already listed at cards[1].checklist.items[0]',
      });
    });
  });

  describe('a card from another system', () => {
    const payment = (fields: unknown[], more: Record<string, unknown> = {}) => ({
      version: 2,
      cards: [
        { id: 'claim', fields: ['dc:title'] },
        {
          id: 'payment',
          label: 'Payment',
          external: { connector: 'payers.claimPayments', fields, ...more },
        },
      ],
    });

    it('reads its connector and its fields, by name or written out', () => {
      const file = read(
        payment([
          'paymentStatus',
          {
            name: 'paidAmount',
            labelKey: 'payers.claim.paid',
            widget: 'currency',
            parameters: { currency: 'USD' },
            visibleWhen: 'app.rules.canWrite',
          },
        ]),
      );
      expect(file.problems).toEqual([]);
      expect(file.cards[1]).toMatchObject({
        id: 'payment',
        fields: [],
        related: null,
        timeline: null,
        comments: null,
        external: {
          connector: 'payers.claimPayments',
          fields: [
            {
              place: 'cards[1].external.fields[0]',
              name: 'paymentStatus',
              label: { keys: [], fallback: 'Payment status' },
              widget: null,
              parameters: {},
              visibleWhen: null,
            },
            {
              place: 'cards[1].external.fields[1]',
              name: 'paidAmount',
              label: { keys: ['payers.claim.paid'], fallback: 'Paid amount' },
              widget: 'currency',
              parameters: { currency: 'USD' },
              visibleWhen: 'app.rules.canWrite',
            },
          ],
        },
      });
      expect(file.cards[0].external).toBeNull();
    });

    it('leaves out one field a finding or an unanswerable rule names, and a name shown already', () => {
      const file = read(
        payment([
          'paymentStatus',
          { name: 'paidOn', widget: 'calendar' },
          { name: 'paidAmount', visibleWhen: 'app.rules.isNote' },
          { name: 'policyNumber', widget: 'rich-text' },
          { name: 'paymentStatus', label: 'Again' },
        ]),
      );
      expect(file.cards[1].external?.fields.map((field) => field.name)).toEqual(['paymentStatus']);
      expect(file.problems).toEqual([
        'cards[1].external.fields[1].widget: the widget "calendar" is not registered; cards[1].external.fields[1] left out',
        'cards[1].external.fields[3].widget: the widget "rich-text" does not show a value from another system: one of text, long-text, number, currency, percent, date, relative-date, boolean, status-badge does; cards[1].external.fields[3] left out',
        'cards[1].external.fields[2] names the rule "app.rules.isNote", which this build does not register; left out',
        'cards[1].external.fields[4] shows paymentStatus again; that field left out',
      ]);
    });

    it('leaves out the card for a key of its own this build lacks, or when no field is left', () => {
      const unknownKey = read(payment(['paymentStatus'], { cache: 60 }));
      expect(unknownKey.cards.map((card) => card.id)).toEqual(['claim']);
      expect(unknownKey.problems).toEqual([
        'cards[1].external.cache: "cache" is not a key version 2 has; cards[1] left out',
      ]);
      const none = read(payment([{ name: 'paidOn', widget: 'calendar' }]));
      expect(none.cards.map((card) => card.id)).toEqual(['claim']);
      expect(none.problems).toContain('cards[1] has no field this build can show; left out');
    });

    it('refuses the whole file for an address in the card, as a structural error', () => {
      expect(
        readRecordLayout(
          payment([{ name: 'paymentStatus', label: 'https://core.example.invalid' }]),
          {
            rules: known,
          },
        ),
      ).toEqual({
        invalid:
          "cards[1].external.fields[0].label: an address is never written in a layout: a connector's address is the server's configuration",
      });
    });
  });

  it('gives a heading only to a card that names one', () => {
    const file = read({
      version: 2,
      cards: [
        { id: 'member-details', labelKey: 'payers.nope', fields: ['dc:title'] },
        { id: 'plain', fields: ['dc:title'] },
      ],
    });
    expect(file.cards.map((card) => card.label)).toEqual([
      { keys: ['payers.nope'], fallback: 'Member details' },
      { keys: [], fallback: null },
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

    /**
     * A column this build does not draw has no rule evaluated, so its rule, however unknown or
     * deep, cannot show it: the table stays, and only that column goes.
     */
    it('keeps a table whose undrawn column names a rule this build cannot answer', () => {
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
                    {
                      id: 'n',
                      visibleWhen: { type: 'app.rules.inGroup', parameters: ['g'] },
                      computed: { type: 'core.count', parameters: [{ field: 'x:y' }] },
                    },
                    {
                      field: 'line:items',
                      widget: 'table',
                      visibleWhen: nest(MAX_RULE_LEVELS + 1, 'app.rules.canWrite'),
                      parameters: { columns: ['item:a'] },
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
        'cards[0].fields[0].parameters.columns[1] is a computed column, which this build does not draw yet; that column left out',
        'cards[0].fields[0].parameters.columns[2] is a table inside a table, which this build does not draw yet; that column left out',
      ]);
    });

    /**
     * What the validator finds inside a column this build does not draw is about that column
     * only: a rule or a computation neither registry has, or an inner column's unknown widget.
     * The column goes, the table stays. On a column that is drawn, the same rule still leaves
     * the table out, and a structural error anywhere still refuses the file.
     */
    it('keeps a table for what the validator finds in a column it does not draw, and only there', () => {
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
                    {
                      id: 'n',
                      visibleWhen: 'acme.rules.unavailable',
                      computed: { type: 'core.nope' },
                    },
                    {
                      field: 'line:items',
                      widget: 'table',
                      parameters: {
                        columns: [
                          {
                            field: 'item:a',
                            widget: 'calendar',
                            visibleWhen: 'acme.rules.unavailable',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                field: 'member:other',
                widget: 'table',
                parameters: {
                  columns: [
                    'line:code',
                    { field: 'line:x', visibleWhen: 'acme.rules.unavailable' },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(file.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
      const columns = 'cards[0].fields[0].parameters.columns';
      expect(file.problems).toEqual([
        `${columns}[1].computed.type: the computation "core.nope" is not registered; ${columns}[1] left out`,
        `${columns}[1].visibleWhen: the rule "acme.rules.unavailable" is not registered; ${columns}[1] left out`,
        `${columns}[2].parameters.columns[0].widget: the widget "calendar" is not registered; ${columns}[2] left out`,
        `${columns}[2].parameters.columns[0].visibleWhen: the rule "acme.rules.unavailable" is not registered; ${columns}[2] left out`,
        'cards[0].fields[1].parameters.columns[1].visibleWhen: the rule "acme.rules.unavailable" is not registered; cards[0].fields[1] left out',
        `${columns}[1] is a computed column, which this build does not draw yet; that column left out`,
        `${columns}[2] is a table inside a table, which this build does not draw yet; that column left out`,
      ]);
      expect(
        readRecordLayout(
          {
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
                        { id: 'n', computed: { type: 'core.count', parameters: null } },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          { rules: known, rowActions },
        ),
      ).toEqual({
        invalid: `${columns}[1].computed.parameters: parameters must be a list`,
      });
    });

    /**
     * `columns[1]` undrawn says nothing of `columns[10]`, which is drawn: its rule still counts.
     * A place ends in `]`, so no prefix of one is another's; this pins that, not a guard.
     */
    it('leaves a table out for a drawn column whose place begins like an undrawn one', () => {
      const columns: unknown[] = Array.from({ length: 11 }, (_, index) => `line:c${index}`);
      columns[1] = { id: 'n', computed: { type: 'core.count', parameters: [{ field: 'x:y' }] } };
      columns[10] = { field: 'line:c10', visibleWhen: 'acme.rules.unavailable' };
      const file = read({
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              'dc:title',
              { field: 'member:lines', widget: 'table', parameters: { columns } },
            ],
          },
        ],
      });
      expect(file.cards[0].fields.map((field) => field.place)).toEqual(['cards[0].fields[0]']);
      expect(file.problems).toContain(
        'cards[0].fields[1].parameters.columns[10].visibleWhen: the rule "acme.rules.unavailable" is not registered; cards[0].fields[1] left out',
      );
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
    // A banner is an entry of its own, at the file's top level only.
    ['banners[1].visibleWhen.parameters[0]', 'banners[1]'],
    ['banners[0].tone', 'banners[0]'],
    // So is the review, and anything inside it.
    ['review', 'review'],
    ['review.rounds', 'review'],
  ])('%s is about %s', (path, entry) => {
    expect(entryOf(path)).toBe(entry);
  });

  it.each(['', 'columns', '$schema', 'reviewer'])('"%s" is about the file as a whole', (path) => {
    expect(entryOf(path)).toBeNull();
  });
});

describe('the review, as the app reads it', () => {
  const page = (extra: Record<string, unknown>) => ({
    version: 2,
    ...extra,
    cards: [{ id: 'c', fields: ['dc:title'] }],
  });

  it('is on for a file with a review, beside cards or tabs, and off for one without', () => {
    expect(read(page({ review: {} })).review).toBe(true);
    const tabbed = { version: 2, review: {}, tabs: [{ id: 't', cards: [page({}).cards[0]] }] };
    expect(read(tabbed).review).toBe(true);
    expect(read(page({})).review).toBe(false);
  });

  it('leaves out a review with an option this build does not have, and says so', () => {
    const file = read(page({ review: { mentions: true } }));
    expect(file.review).toBe(false);
    expect(file.cards.map((card) => card.id)).toEqual(['c']);
    expect(file.problems).toEqual([
      'review.mentions: "mentions" is not a key version 2 has; review left out',
    ]);
  });

  it('refuses the file for a review that is not an object, as for a banner', () => {
    expect(readRecordLayout(page({ review: true }), { rules: known })).toEqual({
      invalid: 'review: review is an object: {} turns it on',
    });
  });
});

describe('banners, as the app reads them', () => {
  const page = (banners: unknown[]) => ({
    version: 2,
    banners,
    cards: [{ id: 'c', fields: ['dc:title'] }],
  });

  it('reads each with its place, its message, its tone, info by default, and its rule', () => {
    const file = read(
      page([
        { id: 'vip', label: 'VIP customer', tone: 'negative', visibleWhen: 'acme.rules.isVip' },
        { id: 'new-asset', labelKey: 'acme.asset.new' },
      ]),
    );
    expect(file.banners).toEqual([
      {
        id: 'vip',
        place: 'banners[0]',
        label: { literal: 'VIP customer', keys: [], fallback: 'Vip' },
        tone: 'negative',
        visibleWhen: 'acme.rules.isVip',
      },
      {
        id: 'new-asset',
        place: 'banners[1]',
        label: { keys: ['acme.asset.new'], fallback: 'New asset' },
        tone: 'info',
        visibleWhen: null,
      },
    ]);
    expect(file.problems).toEqual([]);
  });

  it('leaves out a banner whose rule this build does not register, and keeps the others', () => {
    const file = read(
      page([
        {
          id: 'ending',
          label: 'Ending',
          visibleWhen: { type: 'app.rules.dateWithin', parameters: [{ field: 'dc:expired' }, 30] },
        },
        { id: 'kept', label: 'Kept' },
      ]),
    );
    expect(file.banners.map((banner) => banner.id)).toEqual(['kept']);
    expect(file.problems).toEqual([
      'banners[0] names the rule "app.rules.dateWithin", which this build does not register; left out',
    ]);
  });

  it('refuses the file for a structural finding in a banner, as for a card', () => {
    expect(
      readRecordLayout(page([{ id: 'x', label: 'X', tone: 'loud' }]), { rules: known }),
    ).toEqual({
      invalid: 'banners[0].tone: tone is one of info, warning, negative',
    });
  });

  it('has none for a file that names none', () => {
    expect(read({ version: 2, cards: [{ id: 'c', fields: ['dc:title'] }] }).banners).toEqual([]);
  });
});

describe('the date rules and the validator', () => {
  afterEach(() => vi.useRealTimers());

  it('agree on how far ahead dateWithin may look', () => {
    const within = DOCUMENT_RULE_EVALUATORS['app.rules.dateWithin'];
    // Only `Date` is faked. Today is the reader's own day, written as a stored day, so that the case
    // holds in any zone: it is about the limit, not about reading a date in a zone.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const context = {
      ...EMPTY_EXTENSION_RULE_CONTEXT,
      document: {
        uid: 'a',
        title: 'A',
        type: 'Picture',
        path: '/a',
        lastModified: '',
        properties: { 'dc:expired': today },
      },
    };
    const field = { field: 'dc:expired' };
    expect(within(context, [field, DATE_RULE_MAX_DAYS], () => false)).toBe(true);
    expect(within(context, [field, DATE_RULE_MAX_DAYS + 1], () => false)).toBe(false);
  });

  it('agree on what a literal date is: the validator accepts one exactly when the rule reads it', () => {
    // The validator's date grammar (`isDateText`, app-definition) and the rules' (`date-rules.ts`,
    // extensions) are two copies, as the two libraries cannot share code. Every literal here is
    // before today, so `datePassed` passes on it exactly when it reads it as a date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    const passed = DOCUMENT_RULE_EVALUATORS['app.rules.datePassed'];
    const accepted = (date: string): boolean =>
      validateLayoutV2(
        {
          version: 2,
          banners: [
            {
              id: 'b',
              label: 'B',
              visibleWhen: { type: 'app.rules.datePassed', parameters: [date] },
            },
          ],
          cards: [{ id: 'c', fields: ['dc:title'] }],
        },
        { mode: 'view' },
      ).length === 0;
    const literals = [
      '2020-01-01',
      '2020-02-29',
      '2020-01-01T00:00:00Z',
      '2020-01-01T09:30Z',
      '2020-01-01T09:30:15.250+05:30',
      '2020-01-01T09:30:00-11:00',
      '2019-02-29',
      '2020-13-01',
      '2020-04-31',
      '2020-01-01T24:00:00Z',
      '2020-01-01T09:60:00Z',
      '2020-01-01T09:30:60Z',
      '2020-01-01T09:30:00+24:00',
      '2020-01-01T09:30:00',
      '2020-01-01 09:30:00Z',
      '20200101',
    ];
    const readings = literals.map((date) => ({
      date,
      validator: accepted(date),
      rule: passed(EMPTY_EXTENSION_RULE_CONTEXT, [date], () => false),
    }));
    expect(readings.filter((each) => each.validator !== each.rule)).toEqual([]);
    expect(readings.filter((each) => each.validator).map((each) => each.date)).toEqual(
      literals.slice(0, 6),
    );
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
