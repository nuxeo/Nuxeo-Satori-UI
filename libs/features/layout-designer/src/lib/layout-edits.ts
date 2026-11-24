/**
 * The layout designer's edits, on a layout file version 2 as JSON (docs/business-apps/layout-v2.md).
 *
 * Each edit takes the file and gives back a new one, the file it was given left as it was, and
 * changes only what it names: a key it does not edit, and one version 2 does not have, are kept as
 * written. An edit whose card or field is not in the file gives the file back unchanged. Whether
 * the result is a valid file is the validator's to say, not these functions': a card's id may be
 * renamed to one that is taken, and the validator then refuses the file.
 */

export type LayoutJson = Record<string, unknown>;

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
  readonly shows: 'fields' | 'related' | 'timeline' | 'comments' | 'nothing';
  readonly fields: readonly DesignerField[];
}

/** The heading keys of a card the designer edits. */
export type CardText = 'id' | 'label' | 'labelKey';

const isObject = (value: unknown): value is LayoutJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function fieldOf(entry: unknown, index: number): DesignerField {
  if (typeof entry === 'string') return { index, kind: 'property', name: entry, widget: null };
  if (isObject(entry)) {
    const widget = typeof entry['widget'] === 'string' ? entry['widget'] : null;
    if (typeof entry['field'] === 'string') {
      return { index, kind: 'property', name: entry['field'], widget };
    }
    if ('computed' in entry) {
      return {
        index,
        kind: 'computed',
        name: typeof entry['id'] === 'string' ? entry['id'] : null,
        widget,
      };
    }
  }
  return { index, kind: 'other', name: null, widget: null };
}

function shows(card: LayoutJson): DesignerCard['shows'] {
  for (const key of ['fields', 'related', 'timeline', 'comments'] as const) {
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
    else card[key] = value;
  });
}

/** The file as a download or a package holds it: JSON, two spaces deep, and a last newline. */
export function layoutFileText(file: LayoutJson): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
