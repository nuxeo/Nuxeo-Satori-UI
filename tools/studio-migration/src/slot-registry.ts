/**
 * Which slot contributions Web UI shows, and in what order, as its slots register them
 * (nuxeo-elements, `ui/nuxeo-slots.js`: `_registerContent`, `_merge`, `_render`), so that nothing
 * Web UI leaves out becomes an action, a menu entry, a theme or a tab. The registration is
 * replayed step by step, in the package's order:
 *
 * - **Each slot it names.** A contribution registers into each part of its `slot` split at commas,
 *   as written: `slot="A,B"` is A and B.
 * - **The same name.** In a slot, a contribution of an earlier one's `name`, at the same or a
 *   higher `priority`, replaces it in its place when it holds a template, and otherwise changes its
 *   `disabled`, `order` and `priority`; at a lower priority it is ignored. Two with no name are
 *   never the same. Every contribution is registered, a template-less one too, so one that comes
 *   first with a high priority makes a later one of its name ignored.
 * - **The order.** After each registration the slot sorts its contributions by `order`, 0 when
 *   left out, keeping their places between equals.
 * - **What shows.** A contribution with a template, not disabled, in the slot when all is
 *   registered. One with no template shows nothing: where no earlier one of its name is in the
 *   package, it changes one of Web UI's own, which the converter cannot see, and is reported.
 *
 * Read in the package's order: the inventory lists the custom bundle, which Studio's bundle
 * imports first, before the bundle, and the files of each kind as the bundle lists them. Where Web
 * UI loads them in another order, which only the server's web resources say, two of one name with
 * one priority could resolve the other way. A contribution that shares its name with one of Web
 * UI's own and holds a template replaces Web UI's there, which the converter does not see either.
 *
 * Worked out from the inventory alone: the converter and harness checks 5, 6 and 7 read the same
 * answer.
 */
import type { Decision } from './convert';
import type { Inventory, SlotContribution } from './inventory';

/** A contribution Web UI's slot shows. */
export interface KeptContribution {
  readonly contribution: SlotContribution;
  /** Its order once every change of its name is applied: 0 when left out, as Web UI's is. */
  readonly order: number;
  /** Its place among what its slot shows, from 0: Web UI's order, equals in their places. */
  readonly rank: number;
}

export interface SlotRegistry {
  /** What one slot shows, in Web UI's order, and why each other contribution to it does not. */
  readonly inSlot: (slot: string) => {
    readonly kept: readonly KeptContribution[];
    readonly dropped: readonly (readonly [SlotContribution, Decision])[];
  };
  /** Each contribution Web UI shows, in the slot it names. */
  readonly kept: ReadonlyMap<SlotContribution, KeptContribution>;
  /** Why each contribution Web UI does not show of its own is left out. */
  readonly dropped: ReadonlyMap<SlotContribution, Decision>;
}

interface Node {
  readonly contribution: SlotContribution;
  slot: string;
  disabled: boolean;
  order: number;
  priority: number;
}

/** Why a node is not shown, set as the registration goes. */
type Fate =
  | { readonly kind: 'replaced'; readonly by: string }
  | { readonly kind: 'ignored'; readonly by: string }
  | { readonly kind: 'merged'; readonly into: string }
  | { readonly kind: 'moved'; readonly to: string };

export function slotRegistry(inventory: Pick<Inventory, 'slotContributions'>): SlotRegistry {
  const slots = new Map<string, Node[]>();
  const nodes = new Map<SlotContribution, Node>();
  const fates = new Map<SlotContribution, Fate>();
  for (const contribution of inventory.slotContributions) {
    const node: Node = {
      contribution,
      slot: contribution.slot,
      disabled: contribution.disabled,
      order: contribution.orderValue ?? 0,
      priority: contribution.priority,
    };
    nodes.set(contribution, node);
    for (const slot of contribution.slot.split(',')) {
      const list = slots.get(slot) ?? [];
      slots.set(slot, list);
      const at = contribution.name
        ? list.findIndex((other) => other.contribution.name === contribution.name)
        : -1;
      if (at === -1) list.push(node);
      else if (node.priority < list[at].priority)
        fates.set(contribution, { kind: 'ignored', by: contribution.name });
      else if (contribution.hasTemplate) {
        fates.set(list[at].contribution, { kind: 'replaced', by: contribution.name });
        list[at] = node;
      } else {
        const earlier = list[at];
        earlier.disabled = node.disabled;
        earlier.order = node.order;
        earlier.priority = node.priority;
        // `_merge` takes the slot too, which moves the earlier one to the later one's slots.
        if (node.slot !== earlier.slot)
          fates.set(earlier.contribution, { kind: 'moved', to: node.slot });
        fates.set(contribution, { kind: 'merged', into: contribution.name });
      }
      // Array.prototype.sort is stable: equals keep their places.
      list.sort((a, b) => a.order - b.order);
    }
  }

  const kept = new Map<SlotContribution, KeptContribution>();
  const keptIn = new Map<string, KeptContribution[]>();
  for (const [slot, list] of slots) {
    const shown: KeptContribution[] = [];
    for (const node of list) {
      const fate = fates.get(node.contribution);
      if (node.disabled || !node.contribution.hasTemplate || fate?.kind === 'moved') continue;
      const entry = { contribution: node.contribution, order: node.order, rank: shown.length };
      shown.push(entry);
      if (node.contribution.slot === slot || !kept.has(node.contribution))
        kept.set(node.contribution, entry);
    }
    keptIn.set(slot, shown);
  }
  const dropped = new Map<SlotContribution, Decision>();
  for (const [contribution, node] of nodes) {
    if (kept.has(contribution)) continue;
    dropped.set(contribution, {
      outcome: 'reported',
      note: whyLeftOut(node, fates.get(contribution)),
    });
  }
  return {
    inSlot: (slot) => {
      const shown = keptIn.get(slot) ?? [];
      const among = [...nodes.values()].filter(
        (node) =>
          node.contribution.slot.split(',').includes(slot) && dropped.has(node.contribution),
      );
      return {
        kept: shown,
        dropped: among.map((node) => [
          node.contribution,
          dropped.get(node.contribution) as Decision,
        ]),
      };
    },
    kept,
    dropped,
  };
}

function whyLeftOut(node: Node, fate: Fate | undefined): string {
  const { contribution } = node;
  switch (fate?.kind) {
    case 'replaced':
      return `A later contribution of the same name, ${fate.by}, replaces it, as Web UI's slots do: it is left out`;
    case 'ignored':
      return `An earlier contribution of the same name, ${fate.by}, has a higher priority, so Web UI keeps that one and ignores this: it is left out`;
    case 'merged':
      return `It holds no template, so it only changes the earlier contribution of the same name, ${fate.into}, which is decided with its disabled, order and priority`;
    case 'moved':
      return `A later contribution of its name, with no template, moves it to the slots ${fate.to}, which the converter does not follow: a person maps it`;
  }
  if (!contribution.hasTemplate)
    return `It holds no template, so it only changes a contribution of Web UI's own named ${contribution.name || 'as it is'}, if there is one${node.disabled ? ', which it hides' : ''}: a person decides what the app does about it`;
  return 'It is disabled, so Web UI shows nothing of it: it is left out';
}
