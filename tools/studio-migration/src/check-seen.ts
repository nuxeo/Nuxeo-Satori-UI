/**
 * Check 6, what people see (docs/business-apps/studio-migration.md, section 6): both apps show the
 * same labels and values on the same records.
 *
 * The labels are in the package and the conversion, so that half runs without a server: each
 * field, column and list is named in the new app as Web UI names it. The new app's label is
 * worked out as it works one out (extension-reference.md, section 9b): the `label`; else the
 * `labelKey`'s text in the package's labels; else `layout.field.<prefix>:<name>`'s; else the name,
 * made readable. A label that rests on a catalogue the package does not hold, Web UI's own or the
 * app's, is listed instead of compared.
 *
 * The values half opens the same records in both apps, as the same user, and needs the migration
 * server: it has not run, and the check says so.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { appIdOf, isBound, labelOf } from './app-files';
import { listColumns } from './app-walk';
import { layoutCards } from './blocks';
import { listed } from './check-model';
import { labelsOf, readCatalogue, recordedAllowList } from './convert';
import { PANEL_ROWS } from './convert-layouts';
import { own } from './catalogue';
import { homeCards, menuEntries } from './convert-home';
import { columnPlans, menuLabel, queueOwners } from './convert-lists';
import { actionOwners } from './convert-slots';
import { formPlaces, shownIn, tabOf } from './forms';
import { slotRegistry } from './slot-registry';
import type { CheckOutcome, HarnessInput } from './harness';
import { fieldWidget } from './widgets';

/** A label the comparison cannot settle, because its text is in a catalogue not in hand. */
const UNKNOWN = Symbol('unknown');
type Resolved = string | typeof UNKNOWN | null;

export function checkSeen({ pkg, inventory, catalogue, conversion }: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  /** Each translation key whose text is in a catalogue not in hand, with whose catalogue. */
  const unsettled = new Map<string, Set<string>>();
  const unsettle = (key: string, whose: string): void => {
    unsettled.set(key, (unsettled.get(key) ?? new Set()).add(whose));
  };
  const locale =
    inventory.translations.find((t) => t.locale === 'en')?.locale ??
    inventory.translations[0]?.locale ??
    'en';
  const webTexts: Record<string, unknown> = {};
  for (const translations of inventory.translations.filter((t) => t.locale === locale))
    Object.assign(webTexts, readCatalogue(pkg, translations.path));
  const appTexts = labelsOf(conversion)[locale] ?? {};

  /** What Web UI shows for a label as its file writes it. */
  const web = (text: string | null): Resolved => {
    const label = labelOf(text);
    if ('label' in label) return label.label;
    if ('labelKey' in label) {
      const value = Object.hasOwn(webTexts, label.labelKey) ? webTexts[label.labelKey] : undefined;
      if (typeof value === 'string') return normal(value);
      unsettle(label.labelKey, "Web UI's");
      return UNKNOWN;
    }
    // Bound to the page some other way: only Web UI can say what it shows.
    if (text !== null && isBound(text)) {
      unsettle(normal(text), "Web UI's binding");
      return UNKNOWN;
    }
    return null;
  };
  /** What the new app shows for an entry, a list or a field, as it works the label out. */
  const shown = (entry: unknown, fallbackKey: string | null, name: string | null): Resolved => {
    if (isRecord(entry) && typeof entry['label'] === 'string') return normal(entry['label']);
    if (isRecord(entry) && typeof entry['labelKey'] === 'string') {
      const key = entry['labelKey'];
      if (Object.hasOwn(appTexts, key)) return normal(appTexts[key]);
      unsettle(key, "the app's");
      return UNKNOWN;
    }
    if (fallbackKey !== null && Object.hasOwn(appTexts, fallbackKey))
      return normal(appTexts[fallbackKey]);
    return name === null ? null : readable(name);
  };
  /**
   * What Web UI shows for a label its element translates as a key, `[[i18n(label)]]`, as a page
   * item, a menu icon and an operation button do: the text the package gives the key, or else the
   * label as written, as Web UI shows a key no catalogue holds.
   */
  const translated = (label: string | null): Resolved => {
    if (label === null || label.trim() === '') return null;
    const key = label.trim();
    const value = Object.hasOwn(webTexts, key) ? webTexts[key] : undefined;
    return typeof value === 'string' ? normal(value) : normal(key);
  };
  const compare = (where: string, webLabel: Resolved, appLabel: Resolved): void => {
    if (webLabel === null || webLabel === UNKNOWN || appLabel === UNKNOWN) return;
    if (appLabel !== webLabel)
      findings.push(
        `${where}: the app shows ${JSON.stringify(appLabel)}, where Web UI shows ${JSON.stringify(webLabel)}`,
      );
  };

  // Layouts, with the layout blocks they use, their tabs, and task forms: each field named as
  // Web UI names it, and each tab as its page item does.
  for (const place of formPlaces(pkg, inventory)) {
    const fields = shownIn(conversion.app[place.path], place.tab);
    const { cards, fields: placed } = layoutCards(inventory, place.source);
    const seen = new Set<string>();
    for (const { field, card } of placed) {
      // The field that shows a property is the first one in no condition and of an element the
      // catalogue knows, as check 2 reads it.
      if (field.binding === null || seen.has(field.binding) || field.condition !== null) continue;
      if (!place.options.inTab && (cards[card].use?.conditions.length ?? 0) > 0) continue;
      if (fieldWidget(catalogue, field.element, field.attributes) === null) continue;
      seen.add(field.binding);
      if (place.options.mode === 'metadata' && PANEL_ROWS.has(field.binding)) continue;
      const match = fields.find((candidate) => candidate.field === field.binding);
      if (!match) continue;
      const name = field.binding.slice(field.binding.indexOf(':') + 1);
      compare(
        `${place.path}: ${field.binding}`,
        web(field.label),
        shown(match.entry, `layout.field.${field.binding}`, name),
      );
    }
    const tab = place.tabPlan;
    const written = tab ? tabOf(conversion.app[place.path], tab.id) : null;
    if (tab && written) {
      const item = tab.item.parts.find((part) => part.element === 'nuxeo-page-item');
      // Web UI translates a page item's label as a key, and shows the key itself when no
      // catalogue has it; with no label it shows nothing, where the app shows the tab's id.
      const label = item ? (own(item.attributes, 'label') ?? null) : null;
      compare(
        `${place.path}: the tab ${tab.id}`,
        translated(label),
        shown(written.tab, null, tab.id),
      );
      // A list's columns, named as Web UI's headings name them.
      const listing = tab.listing;
      const cards = Array.isArray(written.tab['cards']) ? written.tab['cards'] : [];
      const card = listing
        ? cards.find((item) => isRecord(item) && item['id'] === listing.cardId)
        : undefined;
      if (listing && isRecord(card)) {
        const sources = listing.columns.filter((_, index) => listing.plans[index].kind === 'write');
        for (const column of listColumns(card['related'])) {
          const source = sources.find((candidate) => candidate.field === column.field);
          if (source)
            compare(
              `${place.path}: the tab ${tab.id}'s column ${column.field}`,
              web(source.name),
              shown(column.entry, null, null),
            );
        }
      }
    }
  }

  // Lists: each queue against the one list that owns its path, as the converter decides it.
  for (const [path, owner] of queueOwners(inventory)) {
    const queue = conversion.app[path];
    if (queue === undefined) continue;
    // The columns written, as the converter plans them: a column under a condition with its rule,
    // and none left out, whose heading the queue does not show.
    const [source, columns] =
      owner.kind === 'search'
        ? [owner.search.path, owner.search.columnDetails]
        : [inventory.dashboard?.path ?? '', owner.card.columns];
    const plans = columnPlans(inventory, source, columns, false);
    const sources = columns.filter((_, index) => plans[index].kind === 'write');
    const name =
      owner.kind === 'search' ? menuLabel({ inventory }, owner.search) : owner.card.heading;
    if (name !== null) compare(`${path}: its name`, web(name), shown(queue, null, null));
    for (const column of listColumns(queue)) {
      const source = sources.find((candidate) => candidate.field === column.field);
      if (source)
        compare(
          `${path}: the column ${column.field}`,
          web(source.name),
          shown(column.entry, null, null),
        );
    }
  }

  // The home's cards and the menu's entries, named as the dashboard and the left menu name them.
  // One with no name of its own shows its queue's, compared above.
  for (const card of homeCards(inventory)) {
    const written = listItem(conversion.app['home.json'], 'cards', card.id);
    const source = inventory.dashboard?.cards[card.index];
    if (written && source && ('label' in written || 'labelKey' in written))
      compare(`home.json: ${card.id}`, web(source.heading), shown(written, null, null));
  }
  for (const entry of menuEntries(inventory, catalogue)) {
    const written = listItem(conversion.app['navigation.json'], 'entries', entry.id);
    const icon = entry.item.parts.find((part) => part.element === 'nuxeo-menu-icon');
    if (written && icon && ('label' in written || 'labelKey' in written))
      compare(
        `navigation.json: ${entry.id}`,
        translated(own(icon.attributes, 'label') ?? null),
        shown(written, null, null),
      );
  }

  // Each action and menu entry where Web UI's slot places it: its order, as the package writes it
  // or a later contribution of its name changes it, and none where Web UI's is left to its default.
  const placedAt = (written: unknown): number | null =>
    isRecord(written) && typeof written['order'] === 'number' ? written['order'] : null;
  const actionsFile = conversion.app['actions.json'];
  const actionList =
    isRecord(actionsFile) && Array.isArray(actionsFile['actions']) ? actionsFile['actions'] : [];
  const owners = actionOwners(inventory, catalogue, appIdOf(pkg), recordedAllowList(conversion));
  for (const [id, owner] of owners) {
    const written = actionList.find((action) => isRecord(action) && action['id'] === id);
    // Named as its button is: the button Web UI's slot keeps, not one it left out.
    if (isRecord(written))
      compare(
        `actions.json: ${id}`,
        translated(own(owner.attributes, 'label') ?? null),
        shown(written, null, null),
      );
    const want = Number.isInteger(owner.order) ? owner.order : null;
    if (written !== undefined && placedAt(written) !== want)
      findings.push(
        `actions.json: ${id} is at order ${placedAt(written) ?? 'none'}, where Web UI's slot places "${owner.contribution.name}" at ${owner.order}`,
      );
  }
  const registry = slotRegistry(inventory);
  for (const entry of menuEntries(inventory, catalogue)) {
    const written = listItem(conversion.app['navigation.json'], 'entries', entry.id);
    const order = registry.kept.get(entry.item)?.order;
    const want = order !== undefined && Number.isInteger(order) ? order : null;
    if (written !== undefined && placedAt(written) !== want)
      findings.push(
        `navigation.json: ${entry.id} is at order ${placedAt(written) ?? 'none'}, where Web UI's slot places "${entry.item.name}" at ${want ?? 'none'}`,
      );
  }

  // Equals in the places Web UI's slot gives them: the app keeps a file's order between equal
  // orders, so two of one order the file lists the other way round show the other way round.
  const placeOf = (list: unknown[], id: string): number =>
    list.findIndex((item) => isRecord(item) && item['id'] === id);
  const misplaced = (
    file: string,
    list: unknown[],
    ranked: readonly {
      readonly id: string;
      readonly slot: string;
      readonly order: number;
      readonly rank: number;
      readonly name: string;
    }[],
  ): void => {
    for (const a of ranked)
      for (const b of ranked) {
        if (a.slot !== b.slot || a.order !== b.order || a.rank >= b.rank) continue;
        const [first, second] = [placeOf(list, a.id), placeOf(list, b.id)];
        if (first !== -1 && second !== -1 && first > second)
          findings.push(
            `${file}: ${b.id} comes before ${a.id}, where Web UI's slot shows "${a.name}" first, both at order ${a.order}`,
          );
      }
  };
  misplaced(
    'actions.json',
    actionList,
    [...owners].map(([id, owner]) => ({
      id,
      slot: owner.contribution.slot,
      order: owner.order,
      rank: owner.rank,
      name: owner.contribution.name,
    })),
  );
  const menuFile = conversion.app['navigation.json'];
  misplaced(
    'navigation.json',
    isRecord(menuFile) && Array.isArray(menuFile['entries']) ? menuFile['entries'] : [],
    menuEntries(inventory, catalogue).flatMap((entry) => {
      const kept = registry.kept.get(entry.item);
      return kept
        ? [
            {
              id: entry.id,
              slot: entry.item.slot,
              order: kept.order,
              rank: kept.rank,
              name: entry.item.name,
            },
          ]
        : [];
    }),
  );

  const values =
    'The values half opens the same records in both apps, as the same user, and needs the migration server';
  return {
    findings,
    rest:
      unsettled.size > 0
        ? `${values}. ${unsettled.size} ${unsettled.size === 1 ? 'label rests' : 'labels rest'} on a catalogue or a binding the package does not hold: ${listed(
            [...unsettled].map(([key, whose]) => `${key} (${[...whose].join(' and ')})`),
          )}`
        : values,
  };
}

function normal(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A field name made readable, as the app's `humanize` in libs/shared/document-layouts does:
 * `billedAmount` is "Billed amount", and an acronym such as `ID` keeps its capitals. Copied, not
 * imported: that library is Angular, and this tool runs in Node.
 */
export function readable(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  const text = words.join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name;
}

/** The card or entry of a home or menu file with the given id. */
function listItem(
  file: unknown,
  key: 'cards' | 'entries',
  id: string,
): Record<string, unknown> | undefined {
  const items = isRecord(file) && Array.isArray(file[key]) ? file[key] : [];
  return items.find((item): item is Record<string, unknown> => isRecord(item) && item['id'] === id);
}
