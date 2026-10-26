/**
 * A heading's level in the page outline, `<h1>` to `<h6>`.
 *
 * Named so the published declarations print it by name: TypeScript writes an anonymous literal
 * union in whatever order it first created the members, which moves with unrelated code and made
 * `docs/api/platform.api.md` report the same type as changed.
 */
export type NxsHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
