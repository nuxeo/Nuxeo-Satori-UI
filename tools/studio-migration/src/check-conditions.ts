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
 *   `visibleWhen`, an action without one, or a queue written for the card at all.
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
} from './app-files';
import { layoutFields, rulesIn } from './app-walk';
import type { CheckOutcome, HarnessInput } from './harness';

export function checkConditions({ pkg, inventory, conversion }: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  for (const [path, file] of Object.entries(conversion.app)) {
    for (const { at } of rulesIn(file))
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
  for (const { contribution, index } of placed(inventory.slotContributions)) {
    if (contribution.conditions.length === 0) continue;
    const id = actionIdOf(appId, contribution.name, index);
    const action = list.find((candidate) => isRecord(candidate) && candidate['id'] === id);
    if (action && !('visibleWhen' in (action as Record<string, unknown>)))
      findings.push(
        `actions.json: ${id} shows to everyone, though Web UI shows "${contribution.name}" only while a condition passes`,
      );
  }

  inventory.dashboard?.cards.forEach((card, index) => {
    const path = queuePath(homeQueueId(card, index));
    if (card.conditional && conversion.app[path] !== undefined)
      findings.push(
        `${path}: it lists card ${index + 1}'s records for everyone, though Web UI shows the card only while a condition passes`,
      );
  });

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
