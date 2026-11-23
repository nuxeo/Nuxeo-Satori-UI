/**
 * The rule a converted field, action, card or menu entry carries: the conditions it sits in, from
 * the innermost out, each decided by `conditions.ts`, all of which must pass.
 *
 * The converter writes the rule as the thing's `visibleWhen`, and check 5 recomputes it from the
 * package to hold the file to it; the truth tables then hold the rule to Web UI's own reading of
 * the conditions.
 */
import {
  decideCondition,
  MAX_ROWS,
  tableSize,
  type ConditionDecision,
  type Rule,
} from './conditions';
import type { Condition, Inventory } from './inventory';

export type Guard =
  | {
      readonly kind: 'rule';
      readonly rule: Rule;
      /** True when one of its conditions reads the open document. */
      readonly document: boolean;
      readonly conditions: readonly Condition[];
    }
  | { readonly kind: 'proposed'; readonly note: string; readonly conditions: readonly Condition[] }
  | { readonly kind: 'reported'; readonly note: string; readonly conditions: readonly Condition[] };

/** A file's conditions, by their place in it. */
function conditionsOf(inventory: Inventory, path: string): Map<number, Condition> {
  return new Map(
    inventory.conditions
      .filter((condition) => condition.path === path)
      .map((condition) => [condition.index, condition]),
  );
}

/** The condition at `index` and those it sits in, innermost first. */
export function chainOf(inventory: Inventory, path: string, index: number): Condition[] {
  const byIndex = conditionsOf(inventory, path);
  const chain: Condition[] = [];
  const seen = new Set<number>();
  for (let at: number | null = index; at !== null && !seen.has(at);) {
    seen.add(at);
    const condition = byIndex.get(at);
    if (!condition) break;
    chain.push(condition);
    at = condition.parent;
  }
  return chain;
}

/** The guard of the conditions given, which must all pass. */
export function guardOf(conditions: readonly Condition[]): Guard {
  const decisions: ConditionDecision[] = conditions.map(decideCondition);
  const reported = decisions.findIndex((decision) => decision.kind === 'reported');
  if (reported !== -1) {
    const decision = decisions[reported] as Extract<ConditionDecision, { kind: 'reported' }>;
    return {
      kind: 'reported',
      note: `Condition ${conditions[reported].index + 1} of its file does not convert: ${decision.note}`,
      conditions,
    };
  }
  const proposed = decisions.findIndex((decision) => decision.kind === 'proposed');
  if (proposed !== -1)
    return {
      kind: 'proposed',
      note: `It shows only while condition ${conditions[proposed].index + 1} of its file passes, whose rule is proposed: shown with it once a person accepts it`,
      conditions,
    };
  const rules = decisions
    .map((decision) => (decision.kind === 'rule' ? decision.rule : 'core.true'))
    .filter((rule) => rule !== 'core.true');
  const rule: Rule =
    rules.length === 0
      ? 'core.true'
      : rules.length === 1
        ? rules[0]
        : { type: 'core.every', parameters: rules };
  // Each condition's own table fits; the table of them all together may not.
  const rows = conditions.length > 1 ? tableSize(conditions, rule) : 0;
  if (rows > MAX_ROWS)
    return {
      kind: 'reported',
      note: `The truth table of its conditions together would run ${rows} rows, more than the ${MAX_ROWS} one runs, so its rule could not be held to them: a person checks it`,
      conditions,
    };
  return {
    kind: 'rule',
    rule,
    document: decisions.some((decision) => decision.kind === 'rule' && decision.document),
    conditions,
  };
}

/** The guard of what sits in condition `index` of the file at `path`. */
export function guardAt(inventory: Inventory, path: string, index: number): Guard {
  return guardOf(chainOf(inventory, path, index));
}

/**
 * The guard of a set of conditions found in one contribution or card, which must nest one inside
 * the next: then they all enclose its content, innermost last. Side by side, which encloses what
 * is a person's call.
 */
export function guardOfSet(inventory: Inventory, path: string, indexes: readonly number[]): Guard {
  if (indexes.length === 0)
    return { kind: 'rule', rule: 'core.true', document: false, conditions: [] };
  const byIndex = conditionsOf(inventory, path);
  const innermost = indexes.find((index) =>
    indexes.every(
      (other) => other === index || chainOf(inventory, path, index).some((c) => c.index === other),
    ),
  );
  if (innermost === undefined)
    return {
      kind: 'reported',
      note: "It holds conditions side by side, and which encloses what is a person's call",
      conditions: indexes
        .map((index) => byIndex.get(index))
        .filter((c): c is Condition => c !== undefined),
    };
  return guardOf(chainOf(inventory, path, innermost));
}

/** A menu entry's guard: its item's conditions and its page's, all of which must pass. */
export function menuGuard(
  inventory: Inventory,
  item: { readonly path: string; readonly conditions: readonly number[] },
  page: { readonly path: string; readonly conditions: readonly number[] } | undefined,
): Guard {
  const first = guardOfSet(inventory, item.path, item.conditions);
  if (!page || page.conditions.length === 0 || first.kind !== 'rule') return first;
  const second = guardOfSet(inventory, page.path, page.conditions);
  if (second.kind !== 'rule') return second;
  const rules = [first.rule, second.rule].filter((rule) => rule !== 'core.true');
  const rule: Rule =
    rules.length === 0
      ? 'core.true'
      : rules.length === 1
        ? rules[0]
        : { type: 'core.every', parameters: rules };
  const conditions = [...first.conditions, ...second.conditions];
  const rows = tableSize(conditions, rule);
  if (rows > MAX_ROWS)
    return {
      kind: 'reported',
      note: `The truth table of its entry's and its page's conditions together would run ${rows} rows, more than the ${MAX_ROWS} one runs, so its rule could not be held to them: a person checks it`,
      conditions,
    };
  return { kind: 'rule', rule, document: first.document || second.document, conditions };
}

/** Records that a guard's rule was written at `where`, for each of its conditions. */
export function carry(carried: Map<string, string[]>, guard: Guard, where: string): void {
  if (guard.kind !== 'rule' || guard.rule === 'core.true') return;
  for (const condition of guard.conditions) {
    const key = `${condition.path}#${condition.index}`;
    carried.set(key, [...(carried.get(key) ?? []), where]);
  }
}
