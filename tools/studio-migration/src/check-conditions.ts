/**
 * Check 5, conditions (docs/business-apps/studio-migration.md, section 6): each converted rule
 * decides as the original condition did.
 *
 * M1 converts no condition; M2 does, with a truth table per condition evaluated in Web UI on the
 * migration server. So what M1 can hold, it holds in full, without a server:
 *
 * - **no rule is invented.** Every rule in the converted package must come from a condition of
 *   the package, and in M1 none does, so any rule fails: a free JavaScript condition slipped into
 *   the configuration among them;
 * - **nothing is widened to everyone.** A field, button or dashboard card Web UI shows only while
 *   a condition passes must not be converted without it: a field written without a
 *   `visibleWhen`, an action without one, a queue written for the card at all, or a card of
 *   `home.json` or an entry of `navigation.json` for what shows only under a condition.
 *
 * The truth tables wait for M2 and the migration server. With conditions in the package, that part
 * has not run, and the check says so; with none, there is nothing for a table to decide.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import {
  LAYOUT_VERSION,
  actionIdOf,
  appIdOf,
  homeQueueId,
  layoutPath,
  placed,
  queuePath,
  searchQueueId,
} from './app-files';
import { fieldOf, layoutFields, listColumns, rulesIn } from './app-walk';
import { chainTable, decideCondition, describeSituation } from './conditions';
import { guardAt, guardOfSet, type Guard } from './guards';
import { recordedAllowList } from './convert';
import { homeCards, menuEntries, menuEntryId } from './convert-home';
import { isConditionalTable, queueOwners } from './convert-lists';
import { actionOwners } from './convert-slots';
import type { CheckOutcome, HarnessInput } from './harness';

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
    if (table.unreadable || table.disagree.length > 0)
      findings.push(
        `condition ${condition.index + 1} of ${condition.path}: its rule decides otherwise than Web UI on ${table.disagree.length} of ${table.rows} rows`,
      );
  }

  const compared = new Set<string>();
  for (const layout of inventory.layouts) {
    if (layout.docType === null || !Object.hasOwn(LAYOUT_VERSION, layout.mode)) continue;
    const path = layoutPath(layout.docType, layout.mode);
    // The first layout of a type and mode is the one written; a later one is reported.
    if (compared.has(path)) continue;
    compared.add(path);
    const shown = layoutFields(conversion.app[path]);
    const always = new Set(
      layout.fields.filter((field) => field.condition === null).map((field) => field.binding),
    );
    for (const field of layout.fields) {
      if (field.condition === null || field.binding === null || always.has(field.binding)) continue;
      for (const match of shown.filter((candidate) => candidate.field === field.binding)) {
        if (!isRecord(match.entry) || !('visibleWhen' in match.entry))
          findings.push(
            `${path}: it shows ${field.binding} to everyone, though Web UI shows it only while condition ${field.condition + 1} passes`,
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
    if (contribution.conditions.length === 0 || owners.has(id)) continue;
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
    if (card.conditional && !lists.has(path) && conversion.app[path] !== undefined)
      findings.push(
        `${path}: it lists card ${index + 1}'s records for everyone, though Web UI shows the card only while a condition passes`,
      );
  });
  for (const search of inventory.searches) {
    if (search.part !== 'results') continue;
    const path = queuePath(searchQueueId(search));
    const queue = conversion.app[path];
    if (queue === undefined) continue;
    const owner = lists.get(path);
    if (isConditionalTable(search)) {
      if (!owner)
        findings.push(
          `${path}: it lists ${search.provider ?? 'its records'} for everyone, though Web UI shows the table only while a condition passes`,
        );
      continue;
    }
    if (owner?.kind !== 'search' || owner.search !== search) continue;
    const always = new Set(
      search.columnDetails.filter((column) => !column.conditional).map((column) => column.field),
    );
    for (const column of search.columnDetails) {
      if (!column.conditional || column.field === null || always.has(column.field)) continue;
      if (listColumns(queue).some((shown) => shown.field === column.field))
        findings.push(
          `${path}: it shows the column ${column.field} to everyone, though Web UI shows it only while a condition passes`,
        );
    }
  }

  // The home and the menu: a card or an entry for a dashboard card or a menu entry under a
  // condition, which owns no queue and so is no card or entry of its own, shows to everyone.
  const homeIds = new Set(homeCards(inventory).map((card) => card.id));
  const homeFile = conversion.app['home.json'];
  const homeList = isRecord(homeFile) && Array.isArray(homeFile['cards']) ? homeFile['cards'] : [];
  inventory.dashboard?.cards.forEach((card, index) => {
    const id = `card-${index + 1}`;
    const written = homeList.find((item) => isRecord(item) && item['id'] === id);
    if (card.conditional && !homeIds.has(id) && isRecord(written) && !('visibleWhen' in written))
      findings.push(
        `home.json: ${id} shows card ${index + 1} to everyone, though Web UI shows it only while a condition passes`,
      );
  });
  const menuIds = new Set(menuEntries(inventory, catalogue).map((entry) => entry.id));
  const menuFile = conversion.app['navigation.json'];
  const menuList =
    isRecord(menuFile) && Array.isArray(menuFile['entries']) ? menuFile['entries'] : [];
  for (const item of inventory.slotContributions) {
    if (item.slot !== 'DRAWER_ITEMS') continue;
    // The entry under a condition, or the page it opens.
    const page = inventory.slotContributions.find(
      (other) => other.slot === 'DRAWER_PAGES' && other.name === item.name,
    );
    if (item.conditions.length === 0 && (page?.conditions.length ?? 0) === 0) continue;
    const id = menuEntryId(item);
    const written = menuList.find((entry) => isRecord(entry) && entry['id'] === id);
    if (!menuIds.has(id) && isRecord(written) && !('visibleWhen' in written))
      findings.push(
        `navigation.json: ${id} shows to everyone, though Web UI shows the menu entry "${item.name}" only while a condition passes`,
      );
  }

  const conditions = inventory.conditions.length;
  return {
    findings,
    ...(conditions > 0
      ? {
          rest: `${conditions} ${conditions === 1 ? 'condition waits' : 'conditions wait'} for M2, whose truth tables run in Web UI on the migration server`,
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
  const layout = /^layouts\/([^/]+)\/([^/]+)\.layout\.json$/.exec(path);
  if (layout) {
    // cards.<i>.fields.<j>.visibleWhen: a field, by the property it shows.
    if (
      parts.length !== 5 ||
      parts[0] !== 'cards' ||
      parts[2] !== 'fields' ||
      parts[4] !== 'visibleWhen'
    )
      return null;
    const card = item('cards', parts[1]);
    const fields = isRecord(card) && Array.isArray(card['fields']) ? card['fields'] : [];
    const binding = fieldOf(fields[Number(parts[3])]);
    const source = inventory.layouts.find(
      (candidate) => candidate.docType === layout[1] && candidate.mode === layout[2],
    );
    const field = source?.fields.find(
      (candidate) => candidate.binding === binding && candidate.condition !== null,
    );
    return source && field && field.condition !== null
      ? guardAt(inventory, source.path, field.condition)
      : null;
  }
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
  if (path.startsWith('queues/') && at === 'visibleWhen') {
    const owner = queueOwners(inventory).get(path);
    return owner?.kind === 'card' && inventory.dashboard
      ? guardOfSet(inventory, inventory.dashboard.path, owner.card.conditions)
      : null;
  }
  return null;
}

/** A menu entry's guard: its item's conditions and its page's, all of which must pass. */
export function menuGuard(
  inventory: HarnessInput['inventory'],
  item: { readonly path: string; readonly conditions: readonly number[] },
  page: { readonly path: string; readonly conditions: readonly number[] } | undefined,
): Guard {
  const first = guardOfSet(inventory, item.path, item.conditions);
  if (!page || page.conditions.length === 0 || first.kind !== 'rule') return first;
  const second = guardOfSet(inventory, page.path, page.conditions);
  if (second.kind !== 'rule') return second;
  const rules = [first.rule, second.rule].filter((rule) => rule !== 'core.true');
  return {
    kind: 'rule',
    rule:
      rules.length === 0
        ? 'core.true'
        : rules.length === 1
          ? rules[0]
          : { type: 'core.every', parameters: rules },
    document: first.document || second.document,
    conditions: [...first.conditions, ...second.conditions],
  };
}
