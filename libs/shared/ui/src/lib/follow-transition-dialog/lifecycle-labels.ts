/**
 * The text for a lifecycle state or transition: `lifecycle.state.<name>` or
 * `lifecycle.transition.<name>` when the catalogue, or a manifest's `labels`, has it, and the name
 * written out otherwise, `backToProject` as "Back to project".
 *
 * Lifecycles are the server's, so most names have no entry. A manifest labels one with
 * `"labels": { "lifecycle.transition.determine": "Determine the claim" }`.
 *
 * Takes a resolver rather than `TranslateService`, as `descriptorLabel` does, so it can be tested
 * and called without one: callers pass `(key) => translate.instant(key)`.
 */
export function lifecycleLabel(
  kind: 'state' | 'transition',
  name: string,
  translate: (key: string) => string,
): string {
  const key = `lifecycle.${kind}.${name}`;
  const resolved = translate(key);
  return resolved && resolved !== key ? resolved : writtenOut(name);
}

/**
 * `backToProject` → "Back to project", `in_review` → "In review", `APPROVED` → "Approved": words
 * split at a lower-to-upper change, `_`, `-` and spaces, the first capitalised and the rest lower.
 * A name with no letters is returned as it is.
 */
function writtenOut(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
  if (words.length === 0) return name;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
