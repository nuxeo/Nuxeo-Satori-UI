/**
 * M1's home and menu: a Web UI dashboard's list cards become cards of `home.json`, and the left
 * menu's entries that open a search screen become entries of `navigation.json`
 * (docs/business-apps/app-definition-v2.md, sections 9 and 10). Each names the queue its list was
 * written as.
 *
 * What neither file has a place for waits: the dashboard's tasks and recently viewed cards, and a
 * menu entry that opens anything but a search screen the conversion wrote as a queue.
 *
 * Both are worked out here from the inventory alone, so that the converter and harness check 7
 * read the same answer: which card or entry each is, and which queue it opens.
 */
import { homeQueueId, iconOf, labelOf, placed, queuePath, searchQueueId, slug } from './app-files';
import { own, slotEntry, type Catalogue } from './catalogue';
import { cardGuard, queueOwners, searchOfForm } from './convert-lists';
import { menuGuard, type Guard } from './guards';
import type { Inventory, SlotContribution } from './inventory';

/** A card of `home.json`, from a dashboard card whose list is a queue. */
export interface HomeCard {
  /** The dashboard card's place, from 0. */
  readonly index: number;
  readonly id: string;
  /** The queue it opens, by its id. */
  readonly queue: string;
  readonly entry: Readonly<Record<string, unknown>>;
}

/** An entry of `navigation.json`, from a left-menu entry that opens a search screen's queue. */
export interface MenuEntry {
  readonly item: SlotContribution;
  /** The `DRAWER_PAGES` contribution that holds the search screen it opens. */
  readonly page: SlotContribution;
  readonly id: string;
  readonly queue: string;
  readonly entry: Readonly<Record<string, unknown>>;
  /** The conditions it and its page sit in, whose rule is its `visibleWhen`. */
  readonly guard: Guard;
}

/** The queue id of a path written as `queues/<id>.json`. */
const queueIdOf = (path: string): string => path.slice('queues/'.length, -'.json'.length);

/**
 * One card per dashboard card that owns its queue, in the dashboard's order, with the card's
 * heading. A card whose list is not a queue has no card here.
 */
export function homeCards(inventory: Inventory): HomeCard[] {
  const owners = queueOwners(inventory);
  const cards: HomeCard[] = [];
  inventory.dashboard?.cards.forEach((card, index) => {
    const path = queuePath(homeQueueId(card, index));
    const owner = owners.get(path);
    if (owner?.kind !== 'card' || owner.card !== card) return;
    const id = `card-${index + 1}`;
    const queue = queueIdOf(path);
    const guard = cardGuard(inventory, card);
    const rule = guard.kind === 'rule' && guard.rule !== 'core.true' ? guard.rule : null;
    cards.push({
      index,
      id,
      queue,
      entry: {
        id,
        ...labelOf(card.heading),
        queue,
        ...(rule !== null ? { visibleWhen: rule } : {}),
      },
    });
  });
  return cards;
}

/** The id a left-menu entry takes in `navigation.json`: its name, or its icon's, made an id. */
export function menuEntryId(item: SlotContribution): string {
  const icon = item.parts.find((part) => part.element === 'nuxeo-menu-icon');
  return slug(item.name || (icon && own(icon.attributes, 'name')) || 'entry');
}

/** Why a left-menu contribution is no entry of `navigation.json`, as its report entry says. */
export interface MenuSkip {
  readonly outcome: 'pending' | 'proposed' | 'reported';
  readonly note: string;
}

/**
 * One entry per left-menu entry (`DRAWER_ITEMS`) whose page (`DRAWER_PAGES`, paired by name)
 * holds a search screen whose results own their queue, and why each other left-menu contribution
 * is none. Neither the entry nor its page may sit in a condition, which M2 converts. The first
 * entry to an id keeps it; a later one is reported.
 */
export function menuDecisions(
  inventory: Inventory,
  catalogue: Catalogue,
): { readonly entries: MenuEntry[]; readonly skipped: Map<SlotContribution, MenuSkip> } {
  const owners = queueOwners(inventory);
  const contributions = inventory.slotContributions;
  const entries: MenuEntry[] = [];
  const skipped = new Map<SlotContribution, MenuSkip>();
  const none = (item: SlotContribution, page: SlotContribution | undefined, skip: MenuSkip) => {
    skipped.set(item, skip);
    if (page && !skipped.has(page)) skipped.set(page, skip);
  };
  for (const { contribution: item } of placed(contributions)) {
    if (item.slot !== 'DRAWER_ITEMS') continue;
    if (slotEntry(catalogue, item.slot)?.how !== 'automatic') continue;
    const page = contributions.find(
      (other) => other.slot === 'DRAWER_PAGES' && other.name === item.name,
    );
    // Its conditions and its page's travel with it as its rule, which on the menu, where no
    // record is open, may read the user only.
    const guard = menuGuard(inventory, item, page);
    if (guard.kind !== 'rule') {
      none(item, page, { outcome: guard.kind, note: guard.note });
      continue;
    }
    if (guard.document) {
      none(item, page, {
        outcome: 'reported',
        note: 'Its condition reads a document, and no record is open in the menu',
      });
      continue;
    }
    const icon = item.parts.find((part) => part.element === 'nuxeo-menu-icon');
    const form = page?.parts.find((part) => part.element === 'nuxeo-search-form');
    const search = form ? searchOfForm(inventory, form.attributes) : undefined;
    const path = search ? queuePath(searchQueueId(search)) : undefined;
    const owner = path ? owners.get(path) : undefined;
    if (!icon || !search || !path || owner?.kind !== 'search' || owner.search !== search) {
      none(item, page, {
        outcome: 'pending',
        note: 'It opens no queue this conversion writes, and an entry of navigation.json opens a queue or a page: the mapping agent proposes the page (section 5)',
      });
      continue;
    }
    const id = menuEntryId(item);
    if (entries.some((other) => other.id === id)) {
      none(item, undefined, {
        outcome: 'reported',
        note: `Another menu entry already became navigation.json ${id}`,
      });
      continue;
    }
    const queue = queueIdOf(path);
    const symbol = iconOf(own(icon.attributes, 'icon'));
    entries.push({
      item,
      page: page as SlotContribution,
      id,
      queue,
      entry: {
        id,
        ...labelOf(own(icon.attributes, 'label') ?? null),
        ...(symbol !== null ? { icon: symbol } : {}),
        ...(item.order !== null ? { order: item.order } : {}),
        queue,
        ...(guard.rule !== 'core.true' ? { visibleWhen: guard.rule } : {}),
      },
      guard,
    });
  }
  return { entries, skipped };
}

/** The entries of `navigation.json` the package's left menu gives. */
export function menuEntries(inventory: Inventory, catalogue: Catalogue): MenuEntry[] {
  return menuDecisions(inventory, catalogue).entries;
}
