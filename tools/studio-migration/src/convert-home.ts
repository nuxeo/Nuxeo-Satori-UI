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
import { queueOwners } from './convert-lists';
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
    cards.push({ index, id, queue, entry: { id, ...labelOf(card.heading), queue } });
  });
  return cards;
}

/**
 * One entry per left-menu entry (`DRAWER_ITEMS`) whose page (`DRAWER_PAGES`, paired by name)
 * holds a search screen whose results own their queue. Neither may sit in a condition, which M2
 * converts. Each id is the entry's name, made an id; the first entry to an id keeps it.
 */
export function menuEntries(inventory: Inventory, catalogue: Catalogue): MenuEntry[] {
  const owners = queueOwners(inventory);
  const contributions = inventory.slotContributions;
  const entries: MenuEntry[] = [];
  for (const { contribution: item } of placed(contributions)) {
    if (item.slot !== 'DRAWER_ITEMS' || item.conditions.length > 0) continue;
    if (slotEntry(catalogue, item.slot)?.how !== 'automatic') continue;
    const icon = item.parts.find((part) => part.element === 'nuxeo-menu-icon');
    if (!icon) continue;
    const page = contributions.find(
      (other) =>
        other.slot === 'DRAWER_PAGES' && other.name === item.name && other.conditions.length === 0,
    );
    const form = page?.parts.find((part) => part.element === 'nuxeo-search-form');
    if (!page || !form) continue;
    const search = inventory.searches.find(
      (candidate) =>
        candidate.part === 'results' &&
        (candidate.provider === own(form.attributes, 'provider') ||
          searchQueueId(candidate) === own(form.attributes, 'search-name')),
    );
    if (!search) continue;
    const path = queuePath(searchQueueId(search));
    const owner = owners.get(path);
    if (owner?.kind !== 'search' || owner.search !== search) continue;
    const id = slug(item.name || own(icon.attributes, 'name') || 'entry');
    if (entries.some((other) => other.id === id)) continue;
    const queue = queueIdOf(path);
    const symbol = iconOf(own(icon.attributes, 'icon'));
    entries.push({
      item,
      page,
      id,
      queue,
      entry: {
        id,
        ...labelOf(own(icon.attributes, 'label') ?? null),
        ...(symbol !== null ? { icon: symbol } : {}),
        ...(item.order !== null ? { order: item.order } : {}),
        queue,
      },
    });
  }
  return entries;
}
