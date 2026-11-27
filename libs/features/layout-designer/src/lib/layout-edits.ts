/**
 * The layout designer's edits, on a layout file version 2 as JSON (docs/business-apps/layout-v2.md).
 *
 * Each edit takes the file and gives back a new one, the file it was given left as it was, and
 * changes only what it names: a key it does not edit, and one version 2 does not have, are kept as
 * written. An edit whose card or field is not in the file gives the file back unchanged. Whether
 * the result is a valid file is the validator's to say, not these functions': a card's id may be
 * renamed to one that is taken, and the validator then refuses the file.
 */

import { LAYOUT_V2_KEYS } from '@agentic-ui/shared/app-definition';

import { jsonFileText } from './json-file-text';

export type LayoutJson = Record<string, unknown>;

/**
 * A field's keys that hold a rule, as layout-v2.md, sections 2 and 5, writes them: `visibleWhen`
 * in every mode; `required`, which may also be `true`, and `readOnlyWhen` in the forms only.
 */
export type FieldRuleKey = 'required' | 'readOnlyWhen' | 'visibleWhen';

/** Where a card is: `cards[<card>]`, or `tabs[<tab>].cards[<card>]`. */
export interface CardPlace {
  readonly tab: number | null;
  readonly card: number;
}

/** What one entry of a card's `fields` is, as the designer lists it. */
export interface DesignerField {
  readonly index: number;
  /**
   * `property`: `"<prefix>:<name>"`, or an object with `field`. `computed`: an object with
   * `computed`. `other`: anything else, which the validator refuses.
   */
  readonly kind: 'property' | 'computed' | 'other';
  /** The property, a computed field's id, or `null` for an entry that names neither. */
  readonly name: string | null;
  readonly widget: string | null;
  /** The field's rules as written, by key; `undefined` for a key it does not have. */
  readonly rules: Readonly<Record<FieldRuleKey, unknown>>;
}

const NO_RULES: Readonly<Record<FieldRuleKey, unknown>> = {
  required: undefined,
  readOnlyWhen: undefined,
  visibleWhen: undefined,
};

function rulesOf(entry: LayoutJson): Readonly<Record<FieldRuleKey, unknown>> {
  return {
    required: entry['required'],
    readOnlyWhen: entry['readOnlyWhen'],
    visibleWhen: entry['visibleWhen'],
  };
}

/** A card as the designer lists it. */
export interface DesignerCard {
  readonly place: CardPlace;
  /** Where it is written, as the validator's findings name it: `cards[0]`, `tabs[1].cards[0]`. */
  readonly path: string;
  /** The tab it is in, by its id, or `null` for a file of cards. */
  readonly tabId: string | null;
  readonly id: string;
  readonly label: string;
  readonly labelKey: string;
  /** What the card shows. Only a card of `fields` has fields to edit. */
  readonly shows:
    'fields' | 'related' | 'timeline' | 'comments' | 'external' | 'checklist' | 'holds' | 'nothing';
  readonly fields: readonly DesignerField[];
}

/** The heading keys of a card the designer edits. */
export type CardText = 'id' | 'label' | 'labelKey';

const isObject = (value: unknown): value is LayoutJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * `object` with `key` set to `value` where a person writes it: in its place when the object has it,
 * and otherwise before the first key `order` puts after it, so that every other key keeps its place
 * and its line. A key `order` does not name, or one with no key after it, is written last.
 */
export function placeKey(
  object: LayoutJson,
  key: string,
  value: unknown,
  order: readonly string[],
): void {
  const rank = order.indexOf(key);
  const entries = Object.entries(object);
  const at =
    Object.hasOwn(object, key) || rank < 0
      ? -1
      : entries.findIndex(([other]) => order.indexOf(other) > rank);
  if (at < 0) {
    object[key] = value;
    return;
  }
  for (const [other] of entries) delete object[other];
  entries.splice(at, 0, [key, value]);
  for (const [other, item] of entries) object[other] = item;
}

/**
 * What one entry of a card's `fields`, or of a queue's `columns`, is: the two are written the same
 * way (layout-v2.md, sections 2 and 7).
 */
export function fieldOf(entry: unknown, index: number): DesignerField {
  if (typeof entry === 'string') {
    return { index, kind: 'property', name: entry, widget: null, rules: NO_RULES };
  }
  if (isObject(entry)) {
    const widget = typeof entry['widget'] === 'string' ? entry['widget'] : null;
    if (typeof entry['field'] === 'string') {
      return { index, kind: 'property', name: entry['field'], widget, rules: rulesOf(entry) };
    }
    if ('computed' in entry) {
      return {
        index,
        kind: 'computed',
        name: typeof entry['id'] === 'string' ? entry['id'] : null,
        widget,
        rules: rulesOf(entry),
      };
    }
  }
  return { index, kind: 'other', name: null, widget: null, rules: NO_RULES };
}

function shows(card: LayoutJson): DesignerCard['shows'] {
  for (const key of [
    'fields',
    'related',
    'timeline',
    'comments',
    'external',
    'checklist',
    'holds',
  ] as const) {
    if (key in card) return key;
  }
  return 'nothing';
}

/** The cards of a file, a tab's included, in the order the file writes them. */
export function cardsOf(file: unknown): DesignerCard[] {
  if (!isObject(file)) return [];
  const read = (list: unknown, tab: number | null, tabId: string | null): DesignerCard[] =>
    (Array.isArray(list) ? list : []).flatMap((card: unknown, index): DesignerCard[] => {
      if (!isObject(card)) return [];
      const fields = Array.isArray(card['fields']) ? card['fields'] : [];
      return [
        {
          place: { tab, card: index },
          path: tab === null ? `cards[${index}]` : `tabs[${tab}].cards[${index}]`,
          tabId,
          id: text(card['id']),
          label: text(card['label']),
          labelKey: text(card['labelKey']),
          shows: shows(card),
          fields: fields.map(fieldOf),
        },
      ];
    });
  if (Array.isArray(file['tabs'])) {
    return file['tabs'].flatMap((tab: unknown, index) =>
      isObject(tab) ? read(tab['cards'], index, text(tab['id'])) : [],
    );
  }
  return read(file['cards'], null, null);
}

/**
 * The file with `change` made to a copy of the card at `place`. The file is copied whole, so
 * nothing the caller holds of the one it gave is changed. Unchanged when there is no card there.
 */
function withCard(
  file: LayoutJson,
  place: CardPlace,
  change: (card: LayoutJson) => void,
): LayoutJson {
  const copy = structuredClone(file);
  const holder = place.tab === null ? copy : (copy['tabs'] as unknown[] | undefined)?.[place.tab];
  const cards = isObject(holder) ? holder['cards'] : undefined;
  const card = Array.isArray(cards) ? cards[place.card] : undefined;
  if (!isObject(card)) return copy;
  change(card);
  return copy;
}

/** The file with the card's field at `from` moved to `to`, the others keeping their order. */
export function moveField(
  file: LayoutJson,
  place: CardPlace,
  from: number,
  to: number,
): LayoutJson {
  return withCard(file, place, (card) => {
    const fields = card['fields'];
    if (!Array.isArray(fields)) return;
    if (from < 0 || from >= fields.length || to < 0 || to >= fields.length) return;
    const [entry] = fields.splice(from, 1);
    fields.splice(to, 0, entry);
  });
}

/**
 * The file without the card's field at `index`, and that field's entry, as written, to put back
 * with {@link insertField}. `entry` is `undefined` when there is no such field.
 */
export function removeField(
  file: LayoutJson,
  place: CardPlace,
  index: number,
): { readonly file: LayoutJson; readonly entry: unknown } {
  let entry: unknown;
  const next = withCard(file, place, (card) => {
    const fields = card['fields'];
    if (!Array.isArray(fields) || index < 0 || index >= fields.length) return;
    [entry] = fields.splice(index, 1);
  });
  return { file: next, entry };
}

/**
 * The file with `entry` among the card's fields at `index`, or last when the card has fewer. A
 * card with no `fields` gets none: a card of related records, a timeline or comments shows no field.
 */
export function insertField(
  file: LayoutJson,
  place: CardPlace,
  index: number,
  entry: unknown,
): LayoutJson {
  return withCard(file, place, (card) => {
    const fields = card['fields'];
    if (!Array.isArray(fields)) return;
    fields.splice(Math.max(0, Math.min(index, fields.length)), 0, structuredClone(entry));
  });
}

/**
 * The file with the property `xpath` as the card's last field, written `"<prefix>:<name>"`: the
 * widget its schema type picks shows it, as layout-v2.md, section 2, says of a field with none.
 */
export function addProperty(file: LayoutJson, place: CardPlace, xpath: string): LayoutJson {
  return insertField(file, place, Number.MAX_SAFE_INTEGER, xpath);
}

/**
 * The file with the card's `id`, `label` or `labelKey` set to `value`. An empty `label` or
 * `labelKey` is taken out, rather than written empty: a card with neither shows no heading
 * (layout-v2.md, section 2). An `id` is written as given, empty or not, and the validator says
 * whether it is one.
 */
export function setCardText(
  file: LayoutJson,
  place: CardPlace,
  key: CardText,
  value: string,
): LayoutJson {
  return withCard(file, place, (card) => {
    if (key !== 'id' && value === '') delete card[key];
    else placeKey(card, key, value, LAYOUT_V2_KEYS.card);
  });
}

/**
 * The file with the card's field at `index` given `value` for `key`, or without `key` when `value`
 * is `undefined`. A field written `"<prefix>:<name>"` is written as an object to hold a rule, and
 * written back as the string once it holds nothing but its `field` again, as the kits write one.
 * An entry that is neither is left as it is.
 */
export function setFieldRule(
  file: LayoutJson,
  place: CardPlace,
  index: number,
  key: FieldRuleKey,
  value: unknown,
): LayoutJson {
  return withCard(file, place, (card) => {
    const fields = card['fields'];
    if (!Array.isArray(fields) || index < 0 || index >= fields.length) return;
    const entry: unknown = fields[index];
    if (typeof entry === 'string') {
      if (value !== undefined) fields[index] = { field: entry, [key]: structuredClone(value) };
      return;
    }
    if (!isObject(entry)) return;
    if (value === undefined) delete entry[key];
    else placeKey(entry, key, structuredClone(value), LAYOUT_V2_KEYS.field);
    const keys = Object.keys(entry);
    if (keys.length === 1 && keys[0] === 'field' && typeof entry['field'] === 'string') {
      fields[index] = entry['field'];
    }
  });
}

/** What the designer offers for `required`: not required, always, or while a rule passes. */
export type RequiredChoice = 'no' | 'always' | 'rule';

/** The choice a field's `required` is: `true` is always, a rule is a rule, and nothing or `false` is no. */
export function requiredChoice(value: unknown): RequiredChoice {
  if (value === undefined || value === false) return 'no';
  return value === true ? 'always' : 'rule';
}

/**
 * A rule as the designer shows it to be edited: a rule's ID as it is, any other rule as JSON, two
 * spaces deep, and none as nothing.
 */
export function ruleText(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * A rule as the person wrote it: nothing is no rule, `undefined`; JSON is what it says; anything
 * else is a rule's ID, as written. A text that was meant as JSON and is not becomes an ID the rule
 * registry does not have, so the validator refuses it rather than the designer guessing.
 */
export function ruleFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

/**
 * A new layout file, for a type and a mode the server serves none for: one card, with no field,
 * to add the type's properties to.
 */
export function newLayoutFile(): LayoutJson {
  return { version: 2, cards: [{ id: 'main', fields: [] }] };
}

/** The name a package gives a type's file for a mode, under `layouts/<Type>/`. */
export function layoutFileName(mode: string): string {
  return `${mode}.layout.json`;
}

/**
 * The file as a download or a package holds it: its JSON as the repository's Prettier lays it out,
 * byte for byte, with a last newline (`jsonFileText`). A queue's file is written the same way.
 */
export function layoutFileText(file: LayoutJson): string {
  return jsonFileText(file);
}
