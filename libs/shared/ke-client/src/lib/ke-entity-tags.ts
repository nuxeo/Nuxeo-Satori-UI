import type { KeNamedEntityMap } from './ke.models';

/**
 * Named-entity categories the Context API returns that are shown as document tags.
 * Any other category (`urls`, `custom_entities`, or one added later) is not a tag, so config
 * keys, endpoints and file names never end up in a document's tags.
 */
export const KE_TAG_ENTITY_CATEGORIES = [
  'organizations',
  'locations',
  'products_brands',
  'titles',
  'dates_times',
] as const;

/** Flattens the allowed entity categories into unique, trimmed tag values. */
export function toKeEntityTags(entityMap: KeNamedEntityMap | null | undefined): string[] {
  if (!entityMap) return [];
  const values = KE_TAG_ENTITY_CATEGORIES.flatMap((category) => entityMap[category] ?? []);
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}
