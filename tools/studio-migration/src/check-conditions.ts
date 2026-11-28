/**
 * Check 5, conditions (docs/business-apps/studio-migration.md, section 6): each converted rule
 * decides as the original condition did.
 *
 * M2 converts conditions into registered rules (`conditions.ts`), each carried as the
 * `visibleWhen` of what it guards (`guards.ts`). Without a server, the check holds:
 *
 * - **no rule is invented.** Every rule in the converted package sits on something a condition of
 *   the package guards, and decides as that condition does on every row of their truth table. A
 *   free JavaScript condition slipped in, an inverted rule or a rule on the wrong field fails;
 * - **each condition's own rule** decides as Web UI does on every row;
 * - **nothing is widened to everyone.** A field, button or dashboard card Web UI shows only while
 *   a condition passes must not be converted without it: a field written without a
 *   `visibleWhen`, an action without one, a queue written for the card at all, or a card of
 *   `home.json` or an entry of `navigation.json` for what shows only under a condition.
 *
 * The truth tables run Web UI's reading of a condition, as `nuxeo-filter` and `FiltersBehavior`
 * implement it, against the app's reading of the rule, as the registered rules implement it.
 * Evaluating the original in Web UI itself, on the migration server, has not run: with conditions
 * in the package, the check says so; with none, there is nothing for a table to decide.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { actionIdOf, appIdOf, homeQueueId, placed, queuePath, searchQueueId } from './app-files';
import { fieldOf, listColumns, rulesIn } from './app-walk';
import { layoutCards } from './blocks';
import { chainTable, decideCondition, describeSituation, readsPermissions } from './conditions';
import { guardOfSet, menuGuard, type Guard } from './guards';
import { recordedAllowList } from './convert';
import { homeCards, menuEntries, menuEntryId } from './convert-home';
import { planFields } from './convert-layouts';
import { formPlaces, shownIn, tabOf } from './forms';
import { slotRegistry } from './slot-registry';
import { ALWAYS, fieldWidget } from './widgets';
import {
  cardGuard,
  columnPlans,
  isConditionalTable,
  queueOwners,
  tableGuard,
} from './convert-lists';
import { actionOwners } from './convert-slots';
import type { CheckOutcome, HarnessInput } from './harness';
import type { ResultColumn } from './inventory';

export function checkConditions({
  pkg,
  inventory,
  catalogue,
  conversion,
}: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  // Every rule in the package must be the guard of what it sits on, the conditions that thing
  // shows under in Web UI, and must decide as they do on every row of their truth table.
  for (const [path, file] of Object.entries(conversion.app)) {
    for (const { at, rule } of rulesIn(path, file)) {
      // A form's field Web UI only shows is read-only always: no condition gives that, and
      // check 2 holds it to Web UI's element.
      if (at.endsWith('.readOnlyWhen') && rule === ALWAYS) continue;
      // Web UI's task page fetches the task's target without its permissions: no permission
      // test passes on a task layout, nor in a block it uses, whatever file the test is in.
      if (path.startsWith('tasks/') && readsPermissions(rule)) {
        findings.push(
          `${path}: ${at} reads a permission, which Web UI's task page does not fetch, so Web UI never shows what it guards there`,
        );
        continue;
      }
      const guard = guardFor(inventory, catalogue, pkg, conversion, path, file, at);
      if (!guard || guard.kind !== 'rule' || guard.conditions.length === 0) {
        findings.push(`${path}: ${at} holds a rule that no condition of the package gives`);
        continue;
      }
      const table = chainTable(guard.conditions, rule);
      if (table.unreadable)
        findings.push(
          `${path}: ${at} holds a rule the truth table cannot read, so it cannot be held to Web UI's condition`,
        );
      else if (table.disagree.length > 0)
        findings.push(
          `${path}: ${at} decides otherwise than Web UI's condition on ${table.disagree.length} of ${table.rows} rows, such as ${describeSituation(table.disagree[0])}`,
        );
    }
  }
  // Each condition the converter turns into a rule decides as Web UI's on every row.
  for (const condition of inventory.conditions) {
    const decision = decideCondition(condition);
    if (decision.kind === 'reported') continue;
    const table = chainTable([condition], decision.rule);
    if (table.unreadable)
      findings.push(
        `condition ${condition.index + 1} of ${condition.path}: the truth table cannot read its rule, so it cannot be held to Web UI's condition`,
      );
    else if (table.disagree.length > 0)
      findings.push(
        `condition ${condition.index + 1} of ${condition.path}: its rule decides otherwise than Web UI on ${table.disagree.length} of ${table.rows} rows, such as ${describeSituation(table.disagree[0])}`,
      );
  }

  // Layouts, tabs and task forms: a field, a layout block or a tab Web UI shows only while a
  // condition passes must not show without its rule.
  for (const place of formPlaces(pkg, inventory)) {
    const file = conversion.app[place.path];
    const shown = shownIn(file, place.tab);
    const { cards, fields } = layoutCards(inventory, place.source);
    const useConditional = (card: number): boolean =>
      !place.options.inTab && (cards[card].use?.conditions.length ?? 0) > 0;
    // A property shown to everyone by a field Web UI does show: in no condition, its own or its
    // block's, of an element the catalogue knows, and not in a block given no document, which
    // shows nothing. A field the converter cannot write shows nothing in the app either.
    const always = new Set(
      fields
        .filter(
          (field) =>
            field.field.conditions.length === 0 &&
            !useConditional(field.card) &&
            (cards[field.card].use?.document ?? true) &&
            fieldWidget(catalogue, field.field.element, field.field.attributes) !== null,
        )
        .map((field) => field.field.binding),
    );
    for (const placed of fields) {
      const { field } = placed;
      if (field.binding === null || always.has(field.binding)) continue;
      const own = field.condition !== null;
      const blockGuard = useConditional(placed.card)
        ? guardOfSet(inventory, place.source.path, cards[placed.card].use?.conditions ?? [])
        : null;
      const byBlock =
        blockGuard !== null && !(blockGuard.kind === 'rule' && blockGuard.rule === 'core.true');
      if (!own && !byBlock) continue;
      for (const match of shown.filter((candidate) => candidate.field === field.binding)) {
        const ruled = isRecord(match.entry) && 'visibleWhen' in match.entry;
        const card = holderOf(file, match.at);
        if (own && !ruled)
          findings.push(
            `${place.path}: it shows ${field.binding}${placed.conditionsIn === place.source.path ? '' : ` of the layout block ${cards[placed.card].use?.element}`} to everyone, though Web UI shows it only while condition ${(field.condition ?? 0) + 1} passes`,
          );
        else if (
          byBlock &&
          !(isRecord(card) && card['id'] === cards[placed.card].id && 'visibleWhen' in card)
        )
          // Its block's own card, whose rule the tables hold to the block's condition: under
          // another card's rule, or none, it shows to others than Web UI shows it to.
          findings.push(
            `${place.path}: it shows ${field.binding} of the layout block ${cards[placed.card].use?.element} outside the card ${cards[placed.card].id} and its rule, though Web UI shows the block only while a condition passes`,
          );
      }
    }
    // What shows under a rule is there: each field the converter writes under its condition's
    // rule, or in a layout block's card under the block's, an accepted proposal's among them.
    // Check 2 holds the fields in no condition; a tab on a type with no file is check 2's too.
    if (place.options.version === 2 && !(place.tabPlan && file === undefined)) {
      const where = place.tab === null || place.tab === 'view' ? '' : ` tab ${place.tab}`;
      const planned = planFields({ catalogue, inventory }, place.source, place.options);
      planned.plans.forEach((plan, position) => {
        if (plan.kind !== 'write') return;
        const card = planned.cardPlans[planned.placed[position].card];
        const ruled =
          (plan.guard?.kind === 'rule' && plan.guard.rule !== 'core.true') ||
          (card.kind === 'write' && card.guard !== undefined);
        if (ruled && !shown.some((candidate) => candidate.field === plan.binding))
          findings.push(
            `${place.path}${where}: ${plan.binding} is missing, though ${place.what} shows it while a condition passes, and its rule converts`,
          );
      });
    }
    const tab = place.tabPlan;
    if (tab && !(tab.guard.rule === 'core.true')) {
      const written = tabOf(file, tab.id);
      if (written && !('visibleWhen' in written.tab))
        findings.push(
          `${place.path}: its tab ${tab.id} shows to everyone, though Web UI shows the tab ${tab.name} only while a condition passes`,
        );
    }
    // A tab whose page is a list: its card under the conditions inside the page around the list,
    // and each column under its own.
    const listing = tab?.listing;
    const written = tab && listing ? tabOf(file, tab.id) : null;
    if (tab && listing && written) {
      const cards = Array.isArray(written.tab['cards']) ? written.tab['cards'] : [];
      const card = cards.find((item) => isRecord(item) && item['id'] === listing.cardId);
      if (isRecord(card)) {
        if (listing.guard && !('visibleWhen' in card))
          findings.push(
            `${place.path}: its card ${listing.cardId} shows the list of the tab ${tab.name} to everyone who sees the tab, though Web UI's page shows the list only while a condition passes`,
          );
        findings.push(
          ...columnsWidened(
            `${place.path} tab ${tab.id}`,
            card['related'],
            inventory,
            listing.source,
            listing.columns,
            true,
          ),
        );
      }
    }
  }

  const actions = conversion.app['actions.json'];
  const list = isRecord(actions) && Array.isArray(actions['actions']) ? actions['actions'] : [];
  const appId = appIdOf(pkg);
  // An action whose id a contribution in no condition owns is that one's, not the conditional
  // contribution's that happens to share its name.
  const owners = actionOwners(inventory, catalogue, appId, recordedAllowList(conversion));
  for (const { contribution, overall } of placed(inventory.slotContributions)) {
    const id = actionIdOf(appId, contribution.name, overall);
    if (contribution.conditions.length === 0) continue;
    const owner = owners.get(id);
    // Another contribution, in no condition, owns the id: the action is that one's.
    if (owner && owner.contribution !== contribution) continue;
    if (owner && owner.rule === null) continue;
    const action = list.find((candidate) => isRecord(candidate) && candidate['id'] === id);
    if (action && !('visibleWhen' in (action as Record<string, unknown>)))
      findings.push(
        `actions.json: ${id} shows to everyone, though Web UI shows "${contribution.name}" only while a condition passes`,
      );
  }

  // Lists. A queue at a path no list owns, where a list under a condition would have gone, shows
  // that list to everyone; an owned queue is its owner's, whatever else shares the path.
  const lists = queueOwners(inventory);
  inventory.dashboard?.cards.forEach((card, index) => {
    const path = queuePath(homeQueueId(card, index));
    const queue = conversion.app[path];
    if (!card.conditional || queue === undefined) return;
    const owner = lists.get(path);
    if (owner && (owner.kind !== 'card' || owner.card !== card)) return;
    // A condition of no test passes for everyone, as the home card's does.
    const guard = cardGuard(inventory, card);
    if (guard.kind === 'rule' && guard.rule === 'core.true') return;
    if (!isRecord(queue) || !('visibleWhen' in queue))
      findings.push(
        `${path}: it lists card ${index + 1}'s records for everyone, though Web UI shows the card only while a condition passes`,
      );
  });
  // A list's column under a condition shows only with its rule, and one that cannot carry it not
  // at all: either way, never to everyone.
  inventory.dashboard?.cards.forEach((card, index) => {
    const path = queuePath(homeQueueId(card, index));
    const queue = conversion.app[path];
    if (queue === undefined) return;
    const owner = lists.get(path);
    if (owner?.kind !== 'card' || owner.card !== card) return;
    findings.push(
      ...columnsWidened(path, queue, inventory, inventory.dashboard?.path ?? '', card.columns),
    );
  });
  for (const search of inventory.searches) {
    if (search.part !== 'results') continue;
    const path = queuePath(searchQueueId(search));
    const queue = conversion.app[path];
    if (queue === undefined) continue;
    const owner = lists.get(path);
    if (isConditionalTable(search)) {
      if (!owner || owner.kind !== 'search' || owner.search !== search) {
        if (!owner)
          findings.push(
            `${path}: it lists ${search.provider ?? 'its records'} for everyone, though Web UI shows the table only while a condition passes`,
          );
        continue;
      }
      const guard = tableGuard(inventory, search);
      if (
        !(guard.kind === 'rule' && guard.rule === 'core.true') &&
        (!isRecord(queue) || !('visibleWhen' in queue))
      )
        findings.push(
          `${path}: it lists ${search.provider ?? 'its records'} for everyone, though Web UI shows the table only while a condition passes`,
        );
    }
    if (owner?.kind !== 'search' || owner.search !== search) continue;
    findings.push(...columnsWidened(path, queue, inventory, search.path, search.columnDetails));
  }

  // The home and the menu: a card or an entry for a dashboard card or a menu entry under a
  // condition, which owns no queue and so is no card or entry of its own, shows to everyone.
  const homeFile = conversion.app['home.json'];
  const homeList = isRecord(homeFile) && Array.isArray(homeFile['cards']) ? homeFile['cards'] : [];
  inventory.dashboard?.cards.forEach((card, index) => {
    const id = `card-${index + 1}`;
    const written = homeList.find((item) => isRecord(item) && item['id'] === id);
    const guard = card.conditional ? cardGuard(inventory, card) : null;
    if (guard?.kind === 'rule' && guard.rule === 'core.true') return;
    if (card.conditional && isRecord(written) && !('visibleWhen' in written))
      findings.push(
        `home.json: ${id} shows card ${index + 1} to everyone, though Web UI shows it only while a condition passes`,
      );
  });
  const registry = slotRegistry(inventory);
  const menuFile = conversion.app['navigation.json'];
  const menuList =
    isRecord(menuFile) && Array.isArray(menuFile['entries']) ? menuFile['entries'] : [];
  for (const item of inventory.slotContributions) {
    if (item.slot !== 'DRAWER_ITEMS') continue;
    // An entry Web UI's slot does not show is none: an entry written for it is check 7's.
    if (!registry.kept.has(item)) continue;
    // The entry under a condition, or the page it opens, as Web UI's slot keeps it.
    const page = inventory.slotContributions.find(
      (other) =>
        other.slot === 'DRAWER_PAGES' && other.name === item.name && registry.kept.has(other),
    );
    if (item.conditions.length === 0 && (page?.conditions.length ?? 0) === 0) continue;
    const id = menuEntryId(item);
    const guard = menuGuard(inventory, item, page);
    if (guard.kind === 'rule' && guard.rule === 'core.true') continue;
    const written = menuList.find((entry) => isRecord(entry) && entry['id'] === id);
    if (isRecord(written) && !('visibleWhen' in written))
      findings.push(
        `navigation.json: ${id} shows to everyone, though Web UI shows the menu entry "${item.name}" only while a condition passes`,
      );
  }

  const conditions = inventory.conditions.length;
  return {
    findings,
    ...(conditions > 0
      ? {
          rest: `The truth tables of ${conditions} ${conditions === 1 ? 'condition' : 'conditions'} ran against Web UI's and the app's code as written; evaluating each original in Web UI itself, on the migration server, has not run`,
        }
      : {}),
  };
}

/**
 * The guard of what a rule sits on, worked out from the package: the field of a view layout by
 * its property, an action by its id, a home card or a menu entry by its id. `null` when the rule
 * sits on something no condition of the package guards, or somewhere the converter writes none.
 */
function guardFor(
  inventory: HarnessInput['inventory'],
  catalogue: HarnessInput['catalogue'],
  pkg: HarnessInput['pkg'],
  conversion: HarnessInput['conversion'],
  path: string,
  file: unknown,
  at: string,
): Guard | null {
  const parts = at.split('.');
  const item = (list: string, index: string): unknown => {
    const holder = isRecord(file) ? file[list] : undefined;
    return Array.isArray(holder) ? holder[Number(index)] : undefined;
  };
  if (/^(?:layouts\/[^/]+\/[^/]+|tasks\/[^/]+)\.layout\.json$/.test(path))
    return formGuard(pkg, inventory, catalogue, path, file, parts);
  const id = (list: string): unknown => {
    const entry = item(list, parts[1]);
    return isRecord(entry) ? entry['id'] : undefined;
  };
  if (path === 'actions.json' && parts[0] === 'actions') {
    const owner = actionOwners(
      inventory,
      catalogue,
      appIdOf(pkg),
      recordedAllowList(conversion),
    ).get(String(id('actions')));
    return owner
      ? guardOfSet(inventory, owner.contribution.path, owner.contribution.conditions)
      : null;
  }
  if (path === 'home.json' && parts[0] === 'cards') {
    const card = homeCards(inventory).find((candidate) => candidate.id === id('cards'));
    const source = card && inventory.dashboard?.cards[card.index];
    return source && inventory.dashboard
      ? guardOfSet(inventory, inventory.dashboard.path, source.conditions)
      : null;
  }
  if (path === 'navigation.json' && parts[0] === 'entries') {
    const entry = menuEntries(inventory, catalogue).find(
      (candidate) => candidate.id === id('entries'),
    );
    return entry ? menuGuard(inventory, entry.item, entry.page) : null;
  }
  if (path.startsWith('queues/')) {
    const owner = queueOwners(inventory).get(path);
    if (!owner) return null;
    // The queue's own rule: its card's, or its search screen's table's.
    if (at === 'visibleWhen')
      return owner.kind === 'card' && inventory.dashboard
        ? guardOfSet(inventory, inventory.dashboard.path, owner.card.conditions)
        : owner.kind === 'search' && isConditionalTable(owner.search)
          ? tableGuard(inventory, owner.search)
          : null;
    // A column's: columns.<j>.visibleWhen, by the property it shows.
    if (parts.length === 3 && parts[0] === 'columns' && parts[2] === 'visibleWhen')
      return owner.kind === 'card'
        ? columnGuard(
            inventory,
            inventory.dashboard?.path ?? '',
            owner.card.columns,
            file,
            Number(parts[1]),
            false,
          )
        : columnGuard(
            inventory,
            owner.search.path,
            owner.search.columnDetails,
            file,
            Number(parts[1]),
            false,
          );
  }
  return null;
}

/**
 * The guard of what a rule of a layout file or a task form sits on, worked out from the package:
 * a tab by its id, a layout block's card by its id, and a field by the property it shows in its
 * card. The place is the file, or the tab, that shows the Web UI layout the converter plans.
 */
function formGuard(
  pkg: HarnessInput['pkg'],
  inventory: HarnessInput['inventory'],
  catalogue: HarnessInput['catalogue'],
  path: string,
  file: unknown,
  parts: readonly string[],
): Guard | null {
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  let tab: string | null = null;
  let rest = parts;
  let container: unknown = file;
  if (parts[0] === 'tabs') {
    const entry = list(isRecord(file) ? file['tabs'] : undefined)[Number(parts[1])];
    if (!isRecord(entry) || typeof entry['id'] !== 'string') return null;
    tab = entry['id'];
    rest = parts.slice(2);
    container = entry;
  }
  const place = formPlaces(pkg, inventory).find(
    (candidate) =>
      candidate.path === path &&
      (candidate.tab === tab || (tab === null && candidate.tab === 'view')),
  );
  if (!place) return null;
  // tabs.<t>.visibleWhen: the tab, by its id.
  if (rest.length === 1 && rest[0] === 'visibleWhen') return place.tabPlan?.guard ?? null;
  if (rest[0] !== 'cards') return null;
  const card = list(isRecord(container) ? container['cards'] : undefined)[Number(rest[1])];
  if (!isRecord(card)) return null;
  // A tab whose page is a list: its card of related records, by its id, and a column of it, by
  // the property it shows.
  const listing = place.tabPlan?.listing;
  if (listing) {
    if (card['id'] !== listing.cardId) return null;
    if (rest.length === 3 && rest[2] === 'visibleWhen') return listing.guard ?? null;
    if (
      rest.length === 6 &&
      rest[2] === 'related' &&
      rest[3] === 'columns' &&
      rest[5] === 'visibleWhen'
    )
      return columnGuard(
        inventory,
        listing.source,
        listing.columns,
        card['related'],
        Number(rest[4]),
        true,
      );
    return null;
  }
  const planned = planFields({ catalogue, inventory }, place.source, place.options);
  const index = planned.cards.findIndex((candidate) => candidate.id === card['id']);
  if (index === -1) return null;
  // cards.<i>.visibleWhen: a layout block's card, by its id.
  if (rest.length === 3 && rest[2] === 'visibleWhen') {
    const plan = planned.cardPlans[index];
    return plan.kind === 'write' && plan.guard ? plan.guard : null;
  }
  // cards.<i>.fields.<j>.visibleWhen: a field, by the property it shows in that card. The field
  // the converter plans to write for it: its conditions are the rule's, not another's.
  if (rest.length !== 5 || rest[2] !== 'fields' || rest[4] !== 'visibleWhen') return null;
  const binding = fieldOf(list(card['fields'])[Number(rest[3])]);
  const at = planned.placed.findIndex((candidate, position) => {
    const plan = planned.plans[position];
    return candidate.card === index && plan.kind === 'write' && plan.binding === binding;
  });
  if (at === -1) return null;
  const placed = planned.placed[at];
  return placed.field.conditions.length > 0
    ? guardOfSet(inventory, placed.conditionsIn, placed.field.conditions)
    : null;
}

/**
 * What a list shows of its columns under a condition to others than Web UI shows them to: one
 * written with its rule shown without it, or one left out shown at all. A property a column in no
 * condition shows to everyone is that column's. `columns` are Web UI's, in the file at `source`.
 */
function columnsWidened(
  path: string,
  list: unknown,
  inventory: HarnessInput['inventory'],
  source: string,
  columns: readonly ResultColumn[],
  record = false,
): string[] {
  const findings: string[] = [];
  const plans = columnPlans(inventory, source, columns, record);
  const always = new Set(
    columns.filter((column) => !column.conditional).map((column) => column.field),
  );
  // Property by property: the list's columns of it, each paired with the column the converter
  // writes at that place among them. One more than it writes, or one without the rule its own
  // has, shows to others than Web UI shows it to.
  const fields = new Set(
    columns
      .filter((column) => column.conditional && column.field !== null && !always.has(column.field))
      .map((column) => column.field),
  );
  for (const field of fields) {
    const written = plans.filter((plan) => plan.kind === 'write' && plan.field === field);
    listColumns(list)
      .filter((candidate) => candidate.field === field)
      .forEach((shown, occurrence) => {
        const plan = written[occurrence];
        const ruled = plan?.kind === 'write' && plan.guard !== undefined;
        if (
          plan === undefined ||
          (ruled && !(isRecord(shown.entry) && 'visibleWhen' in shown.entry))
        )
          findings.push(
            `${path}: it shows the column ${field} to everyone, though Web UI shows it only while a condition passes`,
          );
      });
  }
  return findings;
}

/**
 * The guard of the rule of the column at `at` of a written list, by the property it shows and its
 * place among the list's columns of that property: the conditions of the column the converter
 * writes there (`columnPlans`), or `null` when it writes none with a rule. Two columns of one
 * property under different conditions are each held to their own.
 */
function columnGuard(
  inventory: HarnessInput['inventory'],
  source: string,
  columns: readonly ResultColumn[],
  list: unknown,
  at: number,
  record: boolean,
): Guard | null {
  const written = listColumns(list);
  const field = written[at]?.field ?? null;
  const occurrence = written.slice(0, at).filter((column) => column.field === field).length;
  const plan = columnPlans(inventory, source, columns, record).filter(
    (candidate) => candidate.kind === 'write' && candidate.field === field,
  )[occurrence];
  return plan?.kind === 'write' ? (plan.guard ?? null) : null;
}

/** The card a field entry sits in, from its place: `cards.1.fields.0`, `tabs.0.cards.1.fields.0`. */
function holderOf(file: unknown, at: string): unknown {
  const parts = at.split('.').slice(0, -2);
  return parts.reduce<unknown>(
    (value, key) =>
      isRecord(value) || Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined,
    file,
  );
}
