/**
 * The words a property value shows as, or `''` for a value with nothing to show.
 *
 * A Nuxeo property is not always a string. With resolvers fetched, `dc:nature` arrives as a
 * directory entry and `dc:creator` as a user; a blob is an object, a multi-valued field an array.
 * Interpolating any of those prints `[object Object]` — a defect observed in another document
 * sidebar and listed as a parity target not to copy. So objects are read for the field that names
 * them, and an object with no such field shows nothing rather than its type.
 */
export function nxsPropertyText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => nxsPropertyText(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const properties = (
    typeof record['properties'] === 'object' && record['properties'] !== null
      ? record['properties']
      : {}
  ) as Record<string, unknown>;

  if (record['entity-type'] === 'user') {
    const name = [properties['firstName'], properties['lastName']]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ');
    return name || nxsPropertyText(record['id'] ?? properties['username']);
  }
  for (const candidate of [
    properties['label'],
    properties['label_en'],
    record['title'],
    record['label'],
    record['name'],
    properties['id'],
    record['id'],
  ]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return '';
}

/** A username's initial for an avatar; `?` when there is no letter to show. */
export function nxsInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}
