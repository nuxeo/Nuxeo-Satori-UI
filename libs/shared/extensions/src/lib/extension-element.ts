/**
 * What `disabled` and `order` mean on an {@link ExtensionElement}, for every slot.
 *
 * These are ACA's semantics, reproduced exactly rather than approximately, because a manifest
 * written against ACA must behave the same here. `extension-element.spec.ts` pins each edge case
 * to the output `@alfresco/adf-extensions@9.0.0` produced for it, including the ones that read
 * as surprising in a JSON manifest:
 *
 * - `disabled` hides an entry when it is **truthy**, not when it is `true`, so the string
 *   `"false"` hides it too;
 * - an **absent** `order` sorts as `Number.MAX_SAFE_INTEGER`: after any ordinary number, tied with
 *   that value itself, and before anything larger, such as `Infinity`;
 * - `null` is not absent. It takes part in the subtraction and so sorts as `0`, and a numeric
 *   string sorts as its number.
 */
import type { ExtensionElement } from './extension-slots';

/** `Array.prototype.filter` predicate: keep entries that are not disabled. */
export function filterEnabled(entry: Pick<ExtensionElement, 'disabled'>): boolean {
  return !entry.disabled;
}

/**
 * `Array.prototype.sort` comparator: ascending `order`, an absent `order` as `MAX_SAFE_INTEGER`.
 *
 * Equal keys compare as `0`, so registration order survives among them: `sort` is stable.
 */
export function sortByOrder(
  a: Pick<ExtensionElement, 'order'>,
  b: Pick<ExtensionElement, 'order'>,
): number {
  // `=== undefined`, not `??`: a `null` order must take part in the subtraction and sort as `0`.
  const left = a.order === undefined ? Number.MAX_SAFE_INTEGER : a.order;
  const right = b.order === undefined ? Number.MAX_SAFE_INTEGER : b.order;
  return left - right;
}
