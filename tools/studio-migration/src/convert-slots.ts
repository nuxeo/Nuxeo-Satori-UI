/**
 * M1's conversion of slot contributions (docs/business-apps/studio-migration.md, section 3).
 *
 * - **An operation button** on a document's page or over a selection becomes an action in
 *   `actions.json`, bound to the same operation and parameters, when the operation is on the
 *   deployment's allow-list (decision 3). A button with no operation, or one off the list, is
 *   reported.
 * - **A theme** becomes the app's `branding.theme`, with its tokens in `themes/<name>.json`.
 * - **The left menu and its pages** wait for phase 1's `navigation.json`, and **tabs** for M2.
 *
 * A contribution that sits in a condition waits for M2, which converts the condition: converting
 * it alone would show it to everyone.
 */
import { own, slotEntry, type Catalogue } from './catalogue';
import type { ConvertContext } from './convert';
import type { Inventory, SlotContribution } from './inventory';
import {
  actionIdOf,
  iconOf,
  isBound,
  labelOf,
  placed,
  queuePath,
  searchQueueId,
} from './app-files';

/** The operation an action converted from a button runs, and its parameters, or why it cannot. */
/**
 * What a button's operation runs on, as the action it becomes must: an action on the record
 * page's toolbar runs on the open record, one over a selection on the selected records
 * (app-definition-v2.md, section 5). Web UI writes those `[[document]]` and `[[selectedItems]]`
 * (or `[[documents]]`); a button on anything else, such as `[[document.parentRef]]` or a literal
 * id, or on nothing, would run its operation on another document once it became an action.
 */
const INPUTS: Readonly<Record<'toolbar' | 'bulk-actions', readonly string[]>> = {
  toolbar: ['document'],
  'bulk-actions': ['selectedItems', 'documents'],
};

export function buttonAction(
  contribution: SlotContribution,
  slot: 'toolbar' | 'bulk-actions',
):
  | {
      operation: string;
      parameters: Record<string, unknown> | null;
      attributes: Readonly<Record<string, string>>;
    }
  | { problem: string } {
  const buttons = contribution.parts.filter((part) => part.element === 'nuxeo-operation-button');
  if (buttons.length === 0)
    return { problem: 'It holds no operation button, and only those become actions' };
  if (buttons.length > 1)
    return {
      problem: `It holds ${buttons.length} operation buttons: which becomes which action is a person's call`,
    };
  const [button] = buttons;
  const operation = own(button.attributes, 'operation')?.trim();
  if (!operation) return { problem: 'Its operation button runs no operation' };
  const input = own(button.attributes, 'input')?.trim();
  const bound = /^(?:\[\[|\{\{)\s*([\w.]+)\s*(?:\]\]|\}\})$/.exec(input ?? '')?.[1];
  if (bound === undefined || !INPUTS[slot].includes(bound))
    return {
      problem: `Its button runs ${operation} on ${input ? input : 'no input'}, where an action ${slot === 'toolbar' ? 'on the toolbar runs on the open record' : 'over a selection runs on the selected records'}: a person maps it`,
    };
  const raw = own(button.attributes, 'params');
  if (raw === undefined || raw.trim() === '')
    return { operation, parameters: null, attributes: button.attributes };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      problem: `Its parameters, ${raw}, are bound to the page rather than written: a person maps them`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { problem: `Its parameters, ${raw}, are not an object of names and values` };
  const values = Object.values(parsed as Record<string, unknown>);
  if (values.some((value) => typeof value === 'object' && value !== null))
    return { problem: `Its parameters, ${raw}, hold more than literals: a person maps them` };
  if (values.some((value) => typeof value === 'string' && isBound(value)))
    return {
      problem: `Its parameters, ${raw}, are bound to the page, which a written action cannot be: a person maps them`,
    };
  return {
    operation,
    parameters: parsed as Record<string, unknown>,
    attributes: button.attributes,
  };
}

/** A slot contribution that becomes an action, with what the action runs. */
export interface ActionOwner {
  readonly contribution: SlotContribution;
  /** Its place in its file, from 1, as its construct's id counts it. */
  readonly index: number;
  readonly operation: string;
  readonly parameters: Record<string, unknown> | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly slot: 'toolbar' | 'bulk-actions';
}

/**
 * Which contribution each action id belongs to: the first, in the package's order, that becomes
 * an action at all. A contribution in a slot the app lacks, under a condition, with a button that
 * runs nothing, with page-bound parameters, or with an operation off the allow-list becomes none,
 * so it owns no id, and a later contribution of the same name may take it. The converter writes
 * the owners' actions and reports every other contribution to an owned id; checks 5 and 7 hold
 * each action to its owner.
 */
export function actionOwners(
  inventory: Inventory,
  catalogue: Catalogue,
  appId: string,
  allowList: ReadonlySet<string>,
): Map<string, ActionOwner> {
  const owners = new Map<string, ActionOwner>();
  for (const { contribution, index, overall } of placed(inventory.slotContributions)) {
    const entry = slotEntry(catalogue, contribution.slot);
    if (!entry || entry.how === 'reported') continue;
    if (entry.slot !== 'toolbar' && entry.slot !== 'bulk-actions') continue;
    if (contribution.operations.includes(null) || contribution.conditions.length > 0) continue;
    const action = buttonAction(contribution, entry.slot);
    if ('problem' in action || !allowList.has(action.operation)) continue;
    const id = actionIdOf(appId, contribution.name, overall);
    if (!owners.has(id)) owners.set(id, { contribution, index, ...action, slot: entry.slot });
  }
  return owners;
}

export function convertSlots(context: ConvertContext): void {
  const { inventory, catalogue } = context;
  const actions: Record<string, unknown>[] = [];
  const owners = actionOwners(inventory, catalogue, context.appId, context.allowList);
  for (const { contribution, index, overall } of placed(inventory.slotContributions)) {
    const id = `slot-contribution:${contribution.path}#${index}`;
    const entry = slotEntry(catalogue, contribution.slot);
    if (!entry) {
      context.decide(id, { outcome: 'reported', note: 'Its slot is not in the catalogue' });
      continue;
    }
    if (entry.how === 'reported') {
      context.decide(id, { outcome: 'reported', note: entry.note ?? catalogue.reportedBecause });
      continue;
    }
    if (contribution.operations.includes(null)) {
      context.decide(id, { outcome: 'reported', note: 'Its operation button runs no operation' });
      continue;
    }
    if (contribution.conditions.length > 0) {
      context.decide(id, {
        outcome: 'pending',
        note: 'It shows only while a condition passes: M2 converts the condition, with truth tables, so it is not shown to everyone meanwhile',
      });
      continue;
    }
    if (entry.slot === 'toolbar' || entry.slot === 'bulk-actions') {
      const action = buttonAction(contribution, entry.slot);
      if ('problem' in action) {
        context.decide(id, { outcome: 'reported', note: action.problem });
        continue;
      }
      if (!context.allowList.has(action.operation)) {
        context.decide(id, {
          outcome: 'reported',
          note: `Its operation, ${action.operation}, is not on the deployment's allow-list (decision 3), so no action may run it`,
        });
        continue;
      }
      const actionId = actionIdOf(context.appId, contribution.name, overall);
      if (owners.get(actionId)?.contribution !== contribution) {
        context.decide(id, {
          outcome: 'reported',
          note: `Another contribution already became ${actionId}`,
        });
        continue;
      }
      const label = labelOf(own(action.attributes, 'label') ?? null);
      const icon = iconOf(own(action.attributes, 'icon'));
      actions.push({
        id: actionId,
        ...(Object.keys(label).length > 0 ? label : { label: contribution.name || actionId }),
        ...(icon !== null ? { icon } : {}),
        ...(contribution.order !== null ? { order: contribution.order } : {}),
        ...(entry.slot === 'bulk-actions' ? { on: ['bulk'] } : {}),
        operation: action.operation,
        ...(action.parameters !== null ? { parameters: action.parameters } : {}),
      });
      context.decide(id, { outcome: 'converted', to: `actions.json ${actionId}` });
      continue;
    }
    if (entry.layer0 === 'themes') {
      const name = contribution.parts.find((part) => part.element === 'nuxeo-theme');
      const theme = name ? own(name.attributes, 'name') : undefined;
      if (!theme || !inventory.themes.some((candidate) => candidate.name === theme)) {
        context.decide(id, {
          outcome: 'reported',
          note: `It names a theme${theme ? `, ${theme},` : ''} the package does not hold`,
        });
        continue;
      }
      context.theme ??= theme;
      context.decide(
        id,
        context.theme === theme
          ? {
              outcome: 'converted',
              to: `app.json branding.theme, with its tokens in themes/${theme}.json`,
            }
          : {
              outcome: 'reported',
              note: `The app takes one theme, and ${context.theme} comes first`,
            },
      );
      continue;
    }
    if (entry.slot === 'navbar' || entry.slot === 'sidebar') {
      context.decide(id, {
        outcome: 'pending',
        note: `Phase 1's navigation.json makes it a menu entry${opens(context, contribution)}; that file is not in the app definition yet`,
      });
      continue;
    }
    if (entry.slot === 'tabs') {
      context.decide(id, { outcome: 'pending', note: 'Tabs are converted in M2' });
      continue;
    }
    context.decide(id, {
      outcome: 'pending',
      note:
        entry.how === 'agent-proposes'
          ? 'The mapping agent proposes its target (section 5), and is not built yet'
          : `Its target, ${entry.slot ?? entry.layer0}, is converted in a later phase`,
    });
  }
  if (actions.length > 0) context.files['actions.json'] = { version: 2, actions };
}

/** Which queue a menu entry or its page opens, when it is a search screen M1 wrote. */
function opens(context: ConvertContext, contribution: SlotContribution): string {
  const page =
    contribution.slot === 'DRAWER_PAGES'
      ? contribution
      : context.inventory.slotContributions.find(
          (other) => other.slot === 'DRAWER_PAGES' && other.name === contribution.name,
        );
  const form = page?.parts.find((part) => part.element === 'nuxeo-search-form');
  if (!form) return '';
  const search = context.inventory.searches.find(
    (candidate) =>
      candidate.part === 'results' &&
      (candidate.provider === own(form.attributes, 'provider') ||
        searchQueueId(candidate) === own(form.attributes, 'search-name')),
  );
  return search ? ` that opens ${queuePath(searchQueueId(search))}` : '';
}
