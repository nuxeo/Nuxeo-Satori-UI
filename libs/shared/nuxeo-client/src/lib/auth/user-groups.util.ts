/** Nuxeo built-in group granting limited administration access in Web UI. */
export const NUXEO_POWERUSERS_GROUP = 'powerusers';

/** Reads `properties.groups` from Nuxeo `GET /me` (shape varies slightly by version). */
export function readGroupsFromMe(me: unknown): string[] {
  if (!me || typeof me !== 'object') return [];
  const props = (me as Record<string, unknown>)['properties'];
  if (!props || typeof props !== 'object') return [];
  const groups = (props as Record<string, unknown>)['groups'];
  if (!Array.isArray(groups)) return [];
  return groups.filter((g): g is string => typeof g === 'string');
}

/**
 * Every group Nuxeo counts the user in, from `GET /me`: the stored ones (`properties.groups`) and
 * `extendedGroups`, which adds the parent groups of nested ones and the virtual ones, such as
 * `members`, that every user is in. What a rule that asks "is the user in this group" must read:
 * the stored groups alone miss a member of a subgroup.
 */
export function readAllGroupsFromMe(me: unknown): string[] {
  const all = new Set(readGroupsFromMe(me));
  const extended =
    me && typeof me === 'object' ? (me as Record<string, unknown>)['extendedGroups'] : null;
  if (Array.isArray(extended)) {
    for (const group of extended) {
      const name =
        typeof group === 'string'
          ? group
          : group && typeof group === 'object'
            ? (group as Record<string, unknown>)['name']
            : null;
      if (typeof name === 'string' && name !== '') all.add(name);
    }
  }
  return [...all];
}

/** True when the user belongs to the `powerusers` group (case-insensitive). */
export function isPowerUserFromGroups(groups: readonly string[]): boolean {
  return groups.some((g) => g.trim().toLowerCase() === NUXEO_POWERUSERS_GROUP);
}
