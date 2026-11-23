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
import { layoutFields, listColumns, rulesIn } from './app-walk';
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
  for (const [path, file] of Object.entries(conversion.app)) {
    for (const { at } of rulesIn(path, file))
      findings.push(
        `${path}: ${at} holds a rule that no condition of the package gives: M1 converts no condition`,
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
