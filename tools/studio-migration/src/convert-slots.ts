/**
 * M1's conversion of slot contributions (docs/business-apps/studio-migration.md, section 3).
 *
 * - **An operation button** on a document's page or over a selection becomes an action in
 *   `actions.json`, bound to the same operation and parameters, when the operation is on the
 *   deployment's allow-list (decision 3). A button with no operation, or one off the list, is
 *   reported.
 * - **A theme** becomes the app's `branding.theme`, with its tokens in `themes/<name>.json`.
 * - **The left menu's entries** that open a search screen become entries of `navigation.json`
 *   (`convert-home.ts`); **tabs** become tabs of the view files of the types they show on
 *   (`convert-tabs.ts`).
 *
 * A contribution that sits in a condition carries its rule as the `visibleWhen` of what it
 * becomes, where that can hold one: an action, or a menu entry. Elsewhere it is pending, because
 * converting it alone would show it to everyone.
 */
import { own, slotEntry, type Catalogue } from './catalogue';
import type { Rule } from './conditions';
import { menuDecisions } from './convert-home';
import { carry, guardOfSet, type Guard } from './guards';
import type { ConvertContext } from './convert';
import type { Inventory, SlotContribution } from './inventory';
import { actionIdOf, iconOf, isBound, placed, translatedLabelOf } from './app-files';
import { slotRegistry } from './slot-registry';

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
  /** The rule of the conditions it sits in, for its `visibleWhen`; `null` for none. */
  readonly rule: Rule | null;
  /** Its order as Web UI's slot registers it, a later contribution of its name included: 0 when left out. */
  readonly order: number;
  /** Its place among what its slot shows, as Web UI orders them. */
  readonly rank: number;
}

/**
 * Whether a contribution's conditions can travel with the action it becomes: they must convert,
 * and over a selection none may read the open record, which a bulk action has not.
 */
export function actionGuard(
  inventory: Inventory,
  contribution: SlotContribution,
  slot: 'toolbar' | 'bulk-actions',
):
  | { readonly rule: Rule | null; readonly guard?: Guard }
  | { readonly outcome: 'pending' | 'proposed' | 'reported'; readonly note: string } {
  if (contribution.conditions.length === 0) return { rule: null };
  const guard = guardOfSet(inventory, contribution.path, contribution.conditions);
  if (guard.kind !== 'rule') return { outcome: guard.kind, note: guard.note };
  if (slot === 'bulk-actions' && guard.document)
    return {
      outcome: 'reported',
      note: 'Its condition reads the open record, and an action over a selection has none',
    };
  return { rule: guard.rule === 'core.true' ? null : guard.rule, guard };
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
  const registry = slotRegistry(inventory);
  for (const { contribution, index, overall } of placed(inventory.slotContributions)) {
    const entry = slotEntry(catalogue, contribution.slot);
    if (!entry || entry.how === 'reported') continue;
    if (entry.slot !== 'toolbar' && entry.slot !== 'bulk-actions') continue;
    // What Web UI's slot does not show, disabled, replaced or outranked, becomes nothing.
    const kept = registry.kept.get(contribution);
    if (!kept) continue;
    if (contribution.operations.includes(null)) continue;
    const guard = actionGuard(inventory, contribution, entry.slot);
    if (!('rule' in guard)) continue;
    const action = buttonAction(contribution, entry.slot);
    if ('problem' in action || !allowList.has(action.operation)) continue;
    const id = actionIdOf(appId, contribution.name, overall);
    if (!owners.has(id))
      owners.set(id, {
        contribution,
        index,
        ...action,
        slot: entry.slot,
        rule: guard.rule,
        order: kept.order,
        rank: kept.rank,
      });
  }
  return owners;
}

/** Why an order Web UI reads is not written: an app definition's orders are whole numbers. */
function unwholeOrder(order: number): string {
  return `Its order, ${order}, is no whole number, which an app definition's order is: written with none, the app shows it after every ordered one, where Web UI's slot places it at ${order}: a person picks a whole order`;
}

export function convertSlots(context: ConvertContext): void {
  const { inventory, catalogue } = context;
  const actions: Record<string, unknown>[] = [];
  const owners = actionOwners(inventory, catalogue, context.appId, context.allowList);
  const registry = slotRegistry(inventory);
  const translated = new Set(inventory.translations.flatMap((translations) => translations.keys));
  const menus = menuDecisions(inventory, catalogue);
  const entries = menus.entries;
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
    // Tabs are decided with the view files they go into (`convert-tabs.ts`).
    if (entry.slot === 'tabs') continue;
    // What Web UI's slot does not show of its own becomes nothing, and says why.
    const dropped = registry.dropped.get(contribution);
    if (dropped) {
      context.decide(id, dropped);
      continue;
    }
    if (contribution.operations.includes(null)) {
      context.decide(id, { outcome: 'reported', note: 'Its operation button runs no operation' });
      continue;
    }
    // A contribution under a condition carries its rule where its target can, and waits or is
    // reported where it cannot: an action reads it below, a menu entry in `menuDecisions`.
    const actionable = entry.slot === 'toolbar' || entry.slot === 'bulk-actions';
    const menu = entry.slot === 'navbar' || entry.slot === 'sidebar';
    if (contribution.conditions.length > 0 && !actionable && !menu) {
      const guard = guardOfSet(inventory, contribution.path, contribution.conditions);
      context.decide(id, {
        outcome: guard.kind === 'rule' ? 'pending' : guard.kind,
        note:
          guard.kind === 'rule'
            ? `It shows only while a condition passes, and its target, ${entry.slot ?? entry.layer0}, carries no rule yet`
            : guard.note,
      });
      continue;
    }
    if (entry.slot === 'toolbar' || entry.slot === 'bulk-actions') {
      const guard = actionGuard(inventory, contribution, entry.slot);
      if (!('rule' in guard)) {
        context.decide(id, { outcome: guard.outcome, note: guard.note });
        continue;
      }
      // A custom element of the package is the code track's: its plugin is proposed with the
      // element (`convert-elements.ts`), and the app's toolbar draws actions, not components.
      const element = contribution.parts.find((part) =>
        inventory.customElements.some((custom) => custom.name === part.element),
      );
      if (
        element &&
        !contribution.parts.some((part) => part.element === 'nuxeo-operation-button')
      ) {
        context.decide(id, {
          outcome: 'reported',
          note: `It holds ${element.element}, a custom element of the package, not an operation button: the element's plugin is proposed with the element, and an app's toolbar shows actions, not components, so where the plugin shows is a person's call`,
        });
        continue;
      }
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
      // Web UI's button translates its label as a key (`nuxeo-operation-button`, `i18n(label)`).
      const label = translatedLabelOf(own(action.attributes, 'label') ?? null, translated);
      // Its order as Web UI's slot keeps it, a later contribution of its name included.
      const owner = owners.get(actionId);
      const icon = iconOf(own(action.attributes, 'icon'));
      actions.push({
        id: actionId,
        ...(Object.keys(label).length > 0 ? label : { label: contribution.name || actionId }),
        ...(icon !== null ? { icon } : {}),
        // An order is a whole number in an app definition; one that is not is kept by the place.
        ...(owner && Number.isInteger(owner.order) ? { order: owner.order } : {}),
        ...(entry.slot === 'bulk-actions' ? { on: ['bulk'] } : {}),
        ...(guard.rule !== null ? { visibleWhen: guard.rule } : {}),
        operation: action.operation,
        ...(action.parameters !== null ? { parameters: action.parameters } : {}),
      });
      if (guard.guard) carry(context.carried, guard.guard, `actions.json ${actionId}`);
      context.decide(
        id,
        owner && !Number.isInteger(owner.order)
          ? {
              outcome: 'reported',
              to: `actions.json ${actionId}`,
              note: unwholeOrder(owner.order),
            }
          : { outcome: 'converted', to: `actions.json ${actionId}` },
      );
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
      const menu = entries.find(
        (candidate) => candidate.item === contribution || candidate.page === contribution,
      );
      context.decide(
        id,
        menu === undefined
          ? (menus.skipped.get(contribution) ?? {
              outcome: 'pending',
              note: 'No entry of the left menu opens it, so it is no entry of navigation.json: the mapping agent proposes where it goes (section 5)',
            })
          : menu.item === contribution
            ? Number.isInteger(registry.kept.get(contribution)?.order ?? 0)
              ? { outcome: 'converted', to: `navigation.json ${menu.id}` }
              : {
                  outcome: 'reported',
                  to: `navigation.json ${menu.id}`,
                  note: unwholeOrder(registry.kept.get(contribution)?.order ?? 0),
                }
            : {
                outcome: 'converted',
                to: `queues/${menu.queue}.json, which the menu entry navigation.json ${menu.id} opens`,
              },
      );
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
  // In Web UI's order, which places equals as its slots do.
  const rank = (action: Record<string, unknown>): number =>
    owners.get(String(action['id']))?.rank ?? 0;
  actions.sort((a, b) => rank(a) - rank(b));
  if (actions.length > 0) context.files['actions.json'] = { version: 2, actions };
  if (entries.length > 0) {
    context.files['navigation.json'] = { version: 2, entries: entries.map((e) => e.entry) };
    for (const menu of entries) carry(context.carried, menu.guard, `navigation.json ${menu.id}`);
  }
}
