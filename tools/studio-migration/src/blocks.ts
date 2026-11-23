/**
 * Layout blocks where they are used: the cards of a layout (docs/business-apps/studio-migration.md,
 * section 3, "Reusable layout blocks").
 *
 * A Web UI layout shows a block's fields where the block sits among its own, so a block becomes a
 * card of its own fields there, in version 1 a section, between the cards of the layout's own
 * fields before and after it. Each use is a construct of the file that uses it, and so is each of
 * the block's fields there: a block used twice shows its fields twice, each decided where it shows.
 *
 * Structure only, read from the inventory: the converter and harness checks 2, 5 and 6 read the
 * same cards, and hold what each holds to the package.
 */
import { slug } from './app-files';
import type { BlockUse, Inventory, LayoutBlock, LayoutField } from './inventory';

/** A layout as the planning reads it: a file's own fields, and the block uses it expands. */
export interface LayoutSource {
  /** The file the fields are in, and whose conditions they and its block uses count in. */
  readonly path: string;
  readonly fields: readonly LayoutField[];
  /** The construct kind of its own fields. */
  readonly fieldKind: 'layout-field' | 'task-field';
  /** The block uses to expand, in the file's order; every use in `path` when left out. */
  readonly uses?: readonly BlockUse[];
  /**
   * Put before each card's id: a card's id is unique in its file (layout-v2.md, section 2), so a
   * tab's cards are named after the tab, `<tab>.<card>`, apart from the record page's own.
   */
  readonly cardPrefix?: string;
}

/** A field as a layout shows it: one of its own, or one of a layout block it uses. */
export interface PlacedField {
  /** Its construct's id. */
  readonly id: string;
  readonly field: LayoutField;
  /** The file `field.conditions` count in: the layout's own, or its block's. */
  readonly conditionsIn: string;
  /** Its card, by its place among the layout's cards. */
  readonly card: number;
}

/** A card a layout's fields are grouped in: a run of its own fields, or one block it uses. */
export interface PlannedCard {
  /** Its id in the file: `fields`, `fields-2` and so on, or the block's element, made an id. */
  readonly id: string;
  /** The block use it is, or `null` for a run of the layout's own fields. */
  readonly use: BlockUse | null;
}

/**
 * The cards of a layout, in Web UI's order, and every field with the card it goes in: the
 * layout's own fields up to its first block use, the block's, the layout's next ones, and so on.
 * Structure only, from the inventory: the converter and checks 2 and 5 read the same cards.
 */
export function layoutCards(
  inventory: Inventory,
  source: LayoutSource,
): { readonly cards: PlannedCard[]; readonly fields: PlacedField[] } {
  const uses = source.uses ?? inventory.blockUses.filter((use) => use.path === source.path);
  const cards: PlannedCard[] = [];
  const fields: PlacedField[] = [];
  const ids = new Set<string>();
  const unique = (name: string): string => {
    const base = `${source.cardPrefix ?? ''}${name}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  let run: number | null = null;
  let next = 0;
  const ownUntil = (end: number): void => {
    for (; next < Math.min(end, source.fields.length); next++) {
      if (run === null) {
        run = cards.length;
        cards.push({ id: unique('fields'), use: null });
      }
      fields.push({
        id: `${source.fieldKind}:${source.path}#${next + 1}`,
        field: source.fields[next],
        conditionsIn: source.path,
        card: run,
      });
    }
  };
  for (const use of uses) {
    ownUntil(use.after);
    run = null;
    const card = cards.length;
    cards.push({ id: unique(slug(use.element)), use });
    blockOf(inventory, use)?.fields.forEach((field, index) =>
      fields.push({
        id: blockFieldId(use, index),
        field,
        conditionsIn: use.block,
        card,
      }),
    );
  }
  ownUntil(source.fields.length);
  return { cards, fields };
}

export function blockOf(inventory: Inventory, use: BlockUse): LayoutBlock | undefined {
  return inventory.blocks.find((block) => block.path === use.block);
}

export const blockUseId = (use: BlockUse): string => `block-use:${use.path}#${use.index + 1}`;
export const blockFieldId = (use: BlockUse, index: number): string =>
  `block-field:${use.path}#${use.index + 1}.${index + 1}`;
