/** Update packaged selections without discarding customer quick filters carried by the URL. */
export function quickFilterQuery(
  raw: string,
  selected: ReadonlySet<string>,
  packaged: readonly string[],
): string | null {
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const current = new Set(values);
  // Item navigation does not change the query: keep its representation to avoid another fetch.
  if (packaged.every((value) => current.has(value) === selected.has(value)))
    return raw.trim() || null;
  const customer = values.filter((value) => !packaged.includes(value));
  return (
    [...new Set([...packaged.filter((value) => selected.has(value)), ...customer])].join(',') ||
    null
  );
}
