import {
  addProperty,
  cardsOf,
  insertField,
  layoutFileText,
  moveField,
  removeField,
  setCardText,
  type LayoutJson,
} from './layout-edits';

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
            { index: 0, kind: 'computed', name: 'name', widget: null },
            { index: 1, kind: 'property', name: 'member:phone', widget: 'phone' },
            { index: 2, kind: 'property', name: 'member:ssn', widget: null },
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
            ],
          },
        ],
      });
      expect(cards.map((card) => [card.path, card.tabId, card.shows])).toEqual([
        ['tabs[0].cards[0]', 'main', 'fields'],
        ['tabs[1].cards[0]', 'more', 'timeline'],
        ['tabs[1].cards[1]', 'more', 'comments'],
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

  it('writes the file as JSON, two spaces deep, with a last newline', () => {
    const text = layoutFileText({ version: 2, cards: [] });
    expect(text).toBe('{\n  "version": 2,\n  "cards": []\n}\n');
    expect(JSON.parse(layoutFileText(MEMBER))).toEqual(MEMBER);
  });
});
