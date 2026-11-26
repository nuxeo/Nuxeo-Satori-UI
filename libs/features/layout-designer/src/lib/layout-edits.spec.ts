import {
  addProperty,
  cardsOf,
  insertField,
  layoutFileName,
  layoutFileText,
  moveField,
  newLayoutFile,
  removeField,
  requiredChoice,
  ruleFromText,
  ruleText,
  setCardText,
  setFieldRule,
  type LayoutJson,
} from './layout-edits';

/** A field with no rule. */
const NONE = { required: undefined, readOnlyWhen: undefined, visibleWhen: undefined };

/** The Member page of layout-v2.md, section 9, cut down: a card of fields and a related list. */
const MEMBER: LayoutJson = {
  $schema: '../layout-v2.schema.json',
  version: 2,
  columns: 2,
  cards: [
    {
      id: 'member',
      labelKey: 'payers.member.card',
      fields: [
        {
          id: 'name',
          computed: { type: 'core.template', parameters: ['{member:firstName}'] },
        },
        { field: 'member:phone', widget: 'phone' },
        'member:ssn',
      ],
    },
    {
      id: 'claims',
      label: 'Claims',
      related: { pageProvider: 'member_claims', columns: ['claim:number'] },
    },
  ],
};

const member = { tab: null, card: 0 } as const;
const fieldsOf = (file: LayoutJson, card = 0): unknown =>
  (file['cards'] as LayoutJson[])[card]['fields'];

describe('the layout edits', () => {
  describe('cardsOf', () => {
    it('lists each card with where it is, its heading and its fields', () => {
      expect(cardsOf(MEMBER)).toEqual([
        {
          place: member,
          path: 'cards[0]',
          tabId: null,
          id: 'member',
          label: '',
          labelKey: 'payers.member.card',
          shows: 'fields',
          fields: [
            { index: 0, kind: 'computed', name: 'name', widget: null, rules: NONE },
            { index: 1, kind: 'property', name: 'member:phone', widget: 'phone', rules: NONE },
            { index: 2, kind: 'property', name: 'member:ssn', widget: null, rules: NONE },
          ],
        },
        {
          place: { tab: null, card: 1 },
          path: 'cards[1]',
          tabId: null,
          id: 'claims',
          label: 'Claims',
          labelKey: '',
          shows: 'related',
          fields: [],
        },
      ]);
    });

    it("lists a tab's cards by the tab, at the paths the validator names", () => {
      const cards = cardsOf({
        version: 2,
        tabs: [
          { id: 'main', cards: [{ id: 'a', fields: ['dc:title'] }] },
          {
            id: 'more',
            cards: [
              { id: 'b', timeline: {} },
              { id: 'c', comments: {} },
              { id: 'd', external: { connector: 'payers.claimPayments', fields: ['paidOn'] } },
              {
                id: 'e',
                checklist: { field: 'case:checklist', items: [{ id: 'a', label: 'A' }] },
              },
            ],
          },
        ],
      });
      expect(cards.map((card) => [card.path, card.tabId, card.shows])).toEqual([
        ['tabs[0].cards[0]', 'main', 'fields'],
        ['tabs[1].cards[0]', 'more', 'timeline'],
        ['tabs[1].cards[1]', 'more', 'comments'],
        ['tabs[1].cards[2]', 'more', 'external'],
        ['tabs[1].cards[3]', 'more', 'checklist'],
      ]);
    });

    it('lists an entry that names nothing as one, for the validator to refuse', () => {
      const [card] = cardsOf({ version: 2, cards: [{ id: 'a', fields: [42, { label: 'x' }] }] });
      expect(card.fields.map((field) => [field.kind, field.name])).toEqual([
        ['other', null],
        ['other', null],
      ]);
    });

    it('lists nothing for what is not a file', () => {
      expect(cardsOf(null)).toEqual([]);
      expect(cardsOf([])).toEqual([]);
      expect(cardsOf({ version: 2, cards: 'no' })).toEqual([]);
    });
  });

  describe('moveField', () => {
    it('moves a field within its card, the others keeping their order, and leaves the given file as it was', () => {
      const before = structuredClone(MEMBER);
      const moved = moveField(MEMBER, member, 2, 0);
      expect(fieldsOf(moved)).toEqual([
        'member:ssn',
        { id: 'name', computed: { type: 'core.template', parameters: ['{member:firstName}'] } },
        { field: 'member:phone', widget: 'phone' },
      ]);
      expect(MEMBER).toEqual(before);
    });

    it('keeps every key it does not edit, a key version 2 lacks among them', () => {
      const file: LayoutJson = { ...MEMBER, later: { kept: true } };
      const moved = moveField(file, member, 0, 1);
      expect(moved['later']).toEqual({ kept: true });
      expect(moved['$schema']).toBe('../layout-v2.schema.json');
      expect(moved['cards']).not.toBe(file['cards']);
    });

    it('changes nothing for a place or an index that is not there', () => {
      expect(moveField(MEMBER, member, 2, 3)).toEqual(MEMBER);
      expect(moveField(MEMBER, member, -1, 0)).toEqual(MEMBER);
      expect(moveField(MEMBER, { tab: null, card: 5 }, 0, 1)).toEqual(MEMBER);
      expect(moveField(MEMBER, { tab: 0, card: 0 }, 0, 1)).toEqual(MEMBER);
      expect(moveField(MEMBER, { tab: null, card: 1 }, 0, 1)).toEqual(MEMBER);
    });

    it("moves a field of a tab's card", () => {
      const file = {
        version: 2,
        tabs: [{ id: 't', cards: [{ id: 'a', fields: ['dc:title', 'dc:description'] }] }],
      };
      const moved = moveField(file, { tab: 0, card: 0 }, 1, 0);
      expect((moved['tabs'] as LayoutJson[])[0]['cards']).toEqual([
        { id: 'a', fields: ['dc:description', 'dc:title'] },
      ]);
    });
  });

  describe('removeField and insertField', () => {
    it('takes a field out with its entry as written, and puts it back where it was', () => {
      const { file, entry } = removeField(MEMBER, member, 1);
      expect(entry).toEqual({ field: 'member:phone', widget: 'phone' });
      expect(fieldsOf(file)).toHaveLength(2);
      expect(insertField(file, member, 1, entry)).toEqual(MEMBER);
    });

    it('gives no entry, and the file unchanged, for a field that is not there', () => {
      const { file, entry } = removeField(MEMBER, member, 9);
      expect(entry).toBeUndefined();
      expect(file).toEqual(MEMBER);
    });

    it('puts a field last when its card has fewer, and gives a card of related records none', () => {
      const { file, entry } = removeField(MEMBER, member, 0);
      const back = insertField(file, member, 99, entry);
      expect((fieldsOf(back) as unknown[]).at(-1)).toEqual(entry);
      expect(insertField(MEMBER, { tab: null, card: 1 }, 0, 'dc:title')).toEqual(MEMBER);
    });
  });

  describe('addProperty', () => {
    it('adds the property as the last field, as a plain "<prefix>:<name>" its schema type shows', () => {
      const added = addProperty(MEMBER, member, 'member:email');
      expect((fieldsOf(added) as unknown[]).at(-1)).toBe('member:email');
      expect(fieldsOf(added)).toHaveLength(4);
    });
  });

  describe('setCardText', () => {
    it("sets a card's heading text and key, and takes an empty one out", () => {
      const labelled = setCardText(MEMBER, member, 'label', 'The member');
      expect((labelled['cards'] as LayoutJson[])[0]).toMatchObject({
        label: 'The member',
        labelKey: 'payers.member.card',
      });
      const keyless = setCardText(labelled, member, 'labelKey', '');
      expect('labelKey' in (keyless['cards'] as LayoutJson[])[0]).toBe(false);
      const renamed = setCardText(keyless, member, 'labelKey', 'payers.member.heading');
      expect((renamed['cards'] as LayoutJson[])[0]['labelKey']).toBe('payers.member.heading');
    });

    it('writes an id as given, empty or taken, for the validator to judge', () => {
      expect((setCardText(MEMBER, member, 'id', '')['cards'] as LayoutJson[])[0]['id']).toBe('');
      expect((setCardText(MEMBER, member, 'id', 'claims')['cards'] as LayoutJson[])[0]['id']).toBe(
        'claims',
      );
    });
  });

  describe('setFieldRule', () => {
    const statusRule = { type: 'app.rules.fieldIn', parameters: [{ field: 'member:ssn' }, 'x'] };

    it("writes a rule into a field object, keeping the field's other keys", () => {
      const next = setFieldRule(MEMBER, member, 1, 'readOnlyWhen', 'app.rules.isLocked');
      expect((fieldsOf(next) as unknown[])[1]).toEqual({
        field: 'member:phone',
        widget: 'phone',
        readOnlyWhen: 'app.rules.isLocked',
      });
      expect(cardsOf(next)[0].fields[1].rules).toEqual({
        ...NONE,
        readOnlyWhen: 'app.rules.isLocked',
      });
    });

    it('writes a string field as an object to hold a rule, and back once it holds none', () => {
      const required = setFieldRule(MEMBER, member, 2, 'required', true);
      expect((fieldsOf(required) as unknown[])[2]).toEqual({ field: 'member:ssn', required: true });
      const shown = setFieldRule(required, member, 2, 'visibleWhen', statusRule);
      const back = setFieldRule(
        setFieldRule(shown, member, 2, 'required', undefined),
        member,
        2,
        'visibleWhen',
        undefined,
      );
      expect((fieldsOf(back) as unknown[])[2]).toBe('member:ssn');
      // Nothing to take out of a string: it stays as it was.
      expect(setFieldRule(MEMBER, member, 2, 'required', undefined)).toEqual(MEMBER);
    });

    it('changes neither the file it is given nor the rule, and nothing for a field not there', () => {
      const before = structuredClone(MEMBER);
      const next = setFieldRule(MEMBER, member, 2, 'visibleWhen', statusRule);
      statusRule.parameters.push('y');
      expect(MEMBER).toEqual(before);
      expect(((fieldsOf(next) as unknown[])[2] as LayoutJson)['visibleWhen']).toEqual({
        type: 'app.rules.fieldIn',
        parameters: [{ field: 'member:ssn' }, 'x'],
      });
      // A field already an object holds a copy of the rule too.
      const rule = { type: 'core.not', parameters: ['app.rules.canWrite'] };
      const onObject = setFieldRule(MEMBER, member, 1, 'readOnlyWhen', rule);
      rule.parameters.push('app.rules.isLocked');
      expect(((fieldsOf(onObject) as unknown[])[1] as LayoutJson)['readOnlyWhen']).toEqual({
        type: 'core.not',
        parameters: ['app.rules.canWrite'],
      });
      expect(setFieldRule(MEMBER, member, 9, 'required', true)).toEqual(MEMBER);
      expect(setFieldRule(MEMBER, { tab: null, card: 1 }, 0, 'required', true)).toEqual(MEMBER);
    });
  });

  describe('rules as text', () => {
    it('shows an ID as it is, any other rule as JSON, and none as nothing', () => {
      expect(ruleText(undefined)).toBe('');
      expect(ruleText('app.rules.canWrite')).toBe('app.rules.canWrite');
      expect(ruleText({ type: 'core.not', parameters: ['app.rules.canWrite'] })).toBe(
        '{\n  "type": "core.not",\n  "parameters": [\n    "app.rules.canWrite"\n  ]\n}',
      );
    });

    it('reads JSON as what it says, anything else as an ID as written, and nothing as no rule', () => {
      expect(ruleFromText('  ')).toBeUndefined();
      expect(ruleFromText(' app.rules.canWrite ')).toBe('app.rules.canWrite');
      expect(ruleFromText('{ "type": "core.not", "parameters": ["app.rules.canWrite"] }')).toEqual({
        type: 'core.not',
        parameters: ['app.rules.canWrite'],
      });
      expect(ruleFromText('true')).toBe(true);
      // Broken JSON is kept as typed, for the validator to refuse as no rule's ID.
      expect(ruleFromText('{ "type": ')).toBe('{ "type":');
    });

    it("says what a field's required is: no, always, or a rule", () => {
      expect(requiredChoice(undefined)).toBe('no');
      expect(requiredChoice(false)).toBe('no');
      expect(requiredChoice(true)).toBe('always');
      expect(requiredChoice('app.rules.canWrite')).toBe('rule');
      expect(requiredChoice('')).toBe('rule');
    });
  });

  it('starts a new file with one card and no field, named for its mode', () => {
    expect(newLayoutFile()).toEqual({ version: 2, cards: [{ id: 'main', fields: [] }] });
    expect(newLayoutFile()).not.toBe(newLayoutFile());
    expect(layoutFileName('edit')).toBe('edit.layout.json');
  });

  it("writes the file as the repository's Prettier lays it out, with a last newline", () => {
    // On one line where it fits in 100 columns, as Prettier writes a short file. The layout is held
    // to Prettier itself by json-file-text.spec.ts, and to every kit's files by round-trip.spec.ts.
    expect(layoutFileText({ version: 2, cards: [] })).toBe('{ "version": 2, "cards": [] }\n');
    expect(JSON.parse(layoutFileText(MEMBER))).toEqual(MEMBER);
  });

  it('writes a heading or a rule it adds where version 2 lists its key, every other key in place', () => {
    const file: LayoutJson = {
      version: 2,
      cards: [{ id: 'c', fields: [{ field: 'dc:title', widget: 'text', required: true }] }],
    };
    const headed = setCardText(setCardText(file, member, 'labelKey', 'k'), member, 'label', 'L');
    expect(Object.keys((headed['cards'] as LayoutJson[])[0])).toEqual([
      'id',
      'label',
      'labelKey',
      'fields',
    ]);
    const ruled = setFieldRule(file, member, 0, 'visibleWhen', 'app.rules.canWrite');
    expect(Object.keys((fieldsOf(ruled) as LayoutJson[])[0])).toEqual([
      'field',
      'widget',
      'visibleWhen',
      'required',
    ]);
    // A key it already has keeps its place, written where the format would not put it included.
    const again = setFieldRule(ruled, member, 0, 'required', false);
    expect(Object.keys((fieldsOf(again) as LayoutJson[])[0])).toEqual([
      'field',
      'widget',
      'visibleWhen',
      'required',
    ]);
    // `checks` is listed after `required`, and written before it here.
    const unordered: LayoutJson = {
      version: 2,
      cards: [{ id: 'c', fields: [{ field: 'dc:title', checks: [], required: true }] }],
    };
    const changed = (
      fieldsOf(setFieldRule(unordered, member, 0, 'required', false)) as LayoutJson[]
    )[0];
    expect(changed).toEqual({ field: 'dc:title', checks: [], required: false });
    expect(Object.keys(changed)).toEqual(['field', 'checks', 'required']);
    expect(file).toEqual({
      version: 2,
      cards: [{ id: 'c', fields: [{ field: 'dc:title', widget: 'text', required: true }] }],
    });
  });
});
