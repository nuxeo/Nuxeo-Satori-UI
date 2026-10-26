/**
 * The merge behind `$references`: configuration objects folded left to right, later winning.
 *
 * This is ACA's `mergeObjects`, reproduced from `@alfresco/adf-extensions@9.0.0` branch for
 * branch, so a layer written against ACA merges identically here. `extension-merge.spec.ts`
 * pins every case to the output upstream produced for it, the surprising ones included:
 *
 * - a key ending `.$replace` replaces instead of merging, and any key starting `$` is skipped —
 *   but only where a merge happens, so `$` keys inside a value taken whole survive;
 * - arrays merge **by `id`**: entries with an `id` come first, in the earlier array's order with
 *   integer-like ids ahead of the rest, then the earlier array's entries without one, then the
 *   later array's unmatched entries;
 * - a later value that is not an array is appended to an earlier array;
 * - a later scalar does **not** replace an earlier object: a number or boolean is ignored and a
 *   string is spread into it by index. `"<key>.$replace"` is the way to replace one.
 *
 * It departs from upstream in three places, each where upstream throws or rewrites a prototype
 * rather than producing configuration:
 *
 * 1. **`null` or `undefined` meeting an object.** Upstream throws `TypeError` when an earlier
 *    value is `null` or a later one is `null` or `undefined` over an object, because it calls
 *    `Object.keys` on it. That ran inside a `computed`, so every slot rethrew. Here the later
 *    value wins, which is the scalar rule — and what `"rule": null` is documented to mean.
 * 2. **A `__proto__` key is skipped.** Upstream assigned it, which replaced the merged object's
 *    prototype with a copy of the value, so its keys read as configuration without being own
 *    properties. `Object.prototype` itself was never written by either.
 * 3. **An `id` is only ever data.** Upstream looked ids up in a `{}`, so an entry whose id was
 *    `__proto__` vanished and one whose id named an `Object.prototype` member (`constructor`,
 *    `toString`) merged with that member instead of being appended. The lookup has no prototype.
 */

const REPLACE_SUFFIX = '.$replace';

type Bag = Record<PropertyKey, unknown>;

/**
 * Merge `objects` left to right into a new object. No input is modified.
 *
 * A value seen in only one input is taken by reference, not copied — as upstream does.
 */
export function mergeObjects(...objects: readonly object[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const source of objects) {
    for (const key of Object.keys(source)) mergeKey(result, source as Bag, key);
  }
  return result;
}

function mergeKey(result: Record<string, unknown>, source: Bag, key: string): void {
  const replace = key.endsWith(REPLACE_SUFFIX);
  // `replace` removes the first occurrence, as upstream's does, so a key with the suffix twice
  // reads a different source key below. Kept: it is upstream's output for that key.
  const prop = replace ? key.replace(REPLACE_SUFFIX, '') : key;
  if (prop.startsWith('$') || prop === '__proto__') return;
  if (replace) {
    result[prop] = source[`${prop}${REPLACE_SUFFIX}`];
  } else {
    result[prop] = Object.hasOwn(result, prop)
      ? mergeValue(result[prop], source[prop])
      : source[prop];
  }
}

function mergeValue(current: unknown, incoming: unknown): unknown {
  if (Array.isArray(current)) {
    return Array.isArray(incoming) ? mergeArrays(current, incoming) : [...current, incoming];
  }
  if (typeof current !== 'object' || current === null) return incoming;
  if (incoming === null || incoming === undefined) return incoming;
  // A primitive `incoming` is deliberate: `Object.keys` gives a number or boolean no keys and a
  // string its indices, which is upstream's result for a scalar over an object.
  return mergeObjects(current, incoming as object);
}

function mergeArrays(left: readonly unknown[], right: readonly unknown[]): unknown[] {
  const byId: Bag = Object.create(null);
  const rest: unknown[] = [];
  // `forEach`, not `for…of`: it skips the holes of a sparse array, as upstream's did.
  left.forEach((entry) => {
    if (hasId(entry)) byId[entry.id as PropertyKey] = entry;
    else rest.push(entry);
  });
  right.forEach((entry) => {
    const match = hasId(entry) ? byId[entry.id as PropertyKey] : undefined;
    if (hasId(entry) && match) byId[entry.id as PropertyKey] = mergeObjects(match as object, entry);
    else rest.push(entry);
  });
  return [...Object.keys(byId).map((id) => byId[id]), ...rest];
}

function hasId(entry: unknown): entry is { readonly id: unknown } {
  return Boolean(entry) && Object.hasOwn(entry as object, 'id');
}
