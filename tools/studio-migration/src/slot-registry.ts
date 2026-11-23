/**
 * Which slot contributions Web UI shows, as its slots register them (nuxeo-elements,
 * `ui/nuxeo-slots.js`, `_registerContent` and `_render`), so that nothing Web UI leaves out
 * becomes an action, a menu entry or a tab:
 *
 * - **`disabled`.** A disabled contribution shows nothing.
 * - **The same name.** In one slot, a later contribution of an earlier one's `name`, at the same or
 *   a higher `priority`, replaces it when it holds a template, and otherwise only changes its
 *   `disabled`, `order` and `priority`. One at a lower priority is ignored.
 * - **A change with nothing to change.** A contribution with no template and no earlier one of its
 *   name in the package changes one of Web UI's own, if any, such as hiding its Permissions tab:
 *   the converter cannot see those, so it is reported for a person to decide.
 * - **`order`** is 0 when left out.
 *
 * Read in the package's order, across its files, as the inventory lists them. A contribution that
 * shares its name with one of Web UI's own and holds a template replaces Web UI's there too; the
 * converter does not see Web UI's own, so that is not reported.
 *
 * Worked out from the inventory alone: the converter and harness checks 5, 6 and 7 read the same
 * answer.
 */
import type { Decision } from './convert';
import type { Inventory, SlotContribution } from './inventory';

/** A contribution Web UI's slot shows, with its order once every change of its name is applied. */
export interface KeptContribution {
  readonly contribution: SlotContribution;
  /** Its order, as written or as a later contribution of its name changed it; `null` for none. */
  readonly order: number | null;
}

export interface SlotRegistry {
  /** What one slot shows, in the package's order, and why each other contribution to it does not. */
  readonly inSlot: (slot: string) => {
    readonly kept: readonly KeptContribution[];
    readonly dropped: readonly (readonly [SlotContribution, Decision])[];
  };
  /** Each contribution Web UI shows, with its order. */
  readonly kept: ReadonlyMap<SlotContribution, KeptContribution>;
  /** Why each contribution Web UI does not show of its own is left out. */
  readonly dropped: ReadonlyMap<SlotContribution, Decision>;
}

export function slotRegistry(inventory: Pick<Inventory, 'slotContributions'>): SlotRegistry {
  const bySlot = new Map<string, SlotContribution[]>();
  for (const contribution of inventory.slotContributions)
    bySlot.set(contribution.slot, [...(bySlot.get(contribution.slot) ?? []), contribution]);
  const slots = new Map([...bySlot].map(([slot, list]) => [slot, registered(list)]));
  const kept = new Map<SlotContribution, KeptContribution>();
  const dropped = new Map<SlotContribution, Decision>();
  for (const result of slots.values()) {
    for (const entry of result.kept) kept.set(entry.contribution, entry);
    for (const [contribution, decision] of result.dropped) dropped.set(contribution, decision);
  }
  return {
    inSlot: (slot) => slots.get(slot) ?? { kept: [], dropped: [] },
    kept,
    dropped,
  };
}

/** The registration of one slot's contributions, in the package's order. */
function registered(contributions: readonly SlotContribution[]): {
  readonly kept: KeptContribution[];
  readonly dropped: [SlotContribution, Decision][];
} {
  interface Node {
    contribution: SlotContribution;
    disabled: boolean;
    order: number | null;
    priority: number;
  }
  const nodes: Node[] = [];
  const dropped: [SlotContribution, Decision][] = [];
  for (const contribution of contributions) {
    const node: Node = {
      contribution,
      disabled: contribution.disabled,
      order: contribution.order,
      priority: contribution.priority,
    };
    const at = contribution.name
      ? nodes.findIndex((other) => other.contribution.name === contribution.name)
      : -1;
    if (at === -1) {
      if (!contribution.hasTemplate)
        dropped.push([
          contribution,
          {
            outcome: 'reported',
            note: `It holds no template, so it only changes a contribution of Web UI's own named ${contribution.name || 'as it is'}, if there is one${contribution.disabled ? ', which it hides' : ''}: a person decides what the app does about it`,
          },
        ]);
      else nodes.push(node);
      continue;
    }
    const earlier = nodes[at];
    if (node.priority < earlier.priority) {
      dropped.push([
        contribution,
        {
          outcome: 'reported',
          note: `An earlier contribution of the same name, ${contribution.name}, has a higher priority, so Web UI keeps that one and ignores this: it is left out`,
        },
      ]);
      continue;
    }
    if (contribution.hasTemplate) {
      dropped.push([
        earlier.contribution,
        {
          outcome: 'reported',
          note: `A later contribution of the same name, ${contribution.name}, replaces it, as Web UI's slots do: it is left out`,
        },
      ]);
      nodes[at] = node;
      continue;
    }
    // No template: it changes the earlier one, which is decided with what it now says. Web UI
    // takes the later one's `order` as it is, 0 when left out.
    earlier.disabled = node.disabled;
    earlier.order = node.order ?? 0;
    earlier.priority = node.priority;
    dropped.push([
      contribution,
      {
        outcome: 'reported',
        note: `It holds no template, so it only changes the earlier contribution of the same name, ${contribution.name}, which is decided with its disabled, order and priority`,
      },
    ]);
  }
  const kept: KeptContribution[] = [];
  for (const node of nodes) {
    if (node.disabled)
      dropped.push([
        node.contribution,
        {
          outcome: 'reported',
          note: 'It is disabled, so Web UI shows nothing of it: it is left out',
        },
      ]);
    else kept.push({ contribution: node.contribution, order: node.order });
  }
  return { kept, dropped };
}
