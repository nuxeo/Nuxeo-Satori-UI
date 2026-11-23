/**
 * The shapes a computed field is evaluated with: what it reads, what it gives back, and the two
 * bounds on its work. docs/business-apps/layout-v2.md, section 4.
 */

/** What a computation reads: the record already loaded, the user's rules, and today. */
export interface ComputationContext {
  /** The property's value on the loaded record (`<prefix>:<name>`), or undefined. */
  value(field: string): unknown;
  /** Its display value: a vocabulary's label, a user's name, a formatted date. */
  display(field: string): string;
  /**
   * Whether a registered rule passes for the record and the user (for `core.choose`).
   *
   * `depth` is the level of the computation asking. A rule that evaluates a computation in turn, as
   * `app.rules.fieldIn` will with a `{ "computed" }` parameter, passes it to `compute` as its
   * starting depth, so that the nesting cap counts through the rule. A rule that evaluates nothing
   * ignores it. `compute` always gives it; a caller of its own may leave it off.
   */
  rule(rule: unknown, depth?: number): boolean;
  /**
   * Today, injected so that tests are deterministic. Its calendar day is read in the reader's own
   * zone, as the day the person looking at the page is living: see `src/lib/dates.ts`. A computation
   * that needs it refuses a `Date` that is not valid.
   */
  readonly today: Date;
}

/** One value a computed field shows. `null` is nothing to show, such as the age of no date. */
export type ComputationValue = string | number | boolean | null;

/**
 * A value, or why there is none. The renderer leaves a refused field out and logs the reason
 * (layout-v2.md, section 8).
 */
export type ComputationResult =
  | { readonly ok: true; readonly value: ComputationValue }
  | { readonly ok: false; readonly reason: string };

/**
 * One registered computation. It is given its parameters as the layout writes them, the context,
 * and `evaluate`, which turns one of them into its value: a literal as written, a property through
 * `context.value`, a computation recursively. An evaluator checks how many parameters it was given.
 */
export type ComputationEvaluator = (
  parameters: readonly unknown[],
  context: ComputationContext,
  evaluate: (parameter: unknown) => ComputationResult,
) => ComputationResult;

/**
 * How deep computations may nest: a field's own computation is at depth 1, each `{ "computed" }`
 * parameter is one deeper, and a rule that evaluates a computation continues the count when it
 * passes on its depth (`compute`). Layout-v2.md's examples nest one deep; ten leaves room for a
 * `core.choose` chain.
 */
export const MAX_DEPTH = 10;

/** The longest text `core.template` takes, in UTF-16 code units, as `String.length` counts them. */
export const MAX_TEMPLATE_LENGTH = 1000;

export function accept(value: ComputationValue): ComputationResult {
  return { ok: true, value };
}

/**
 * Why a computation gives no value. Every reason in this library is written as this function's
 * argument, so that `reasons.spec.ts` can find each one and fail when it has no negative control.
 */
export function refuse(reason: string): ComputationResult {
  return { ok: false, reason };
}

/** How much of a value a reason quotes: enough to recognise it, not a whole list in the console. */
export const QUOTE_LENGTH = 60;

/** A text cut at `QUOTE_LENGTH` characters, with an ellipsis where it was cut. */
export function cut(text: string): string {
  return text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH)}…` : text;
}

/**
 * A value as a reason quotes it: as JSON, cut at `QUOTE_LENGTH` characters. Every value a reason
 * names goes through it, a computation's type, a key and a subfield included, so a reason stays
 * short whatever a file holds. It never throws, so that explaining a refusal cannot fail: a value
 * JSON cannot write is named by its kind.
 */
export function quote(value: unknown): string {
  let text: string;
  if (value === undefined) text = 'undefined';
  else if (typeof value === 'number' && !Number.isFinite(value)) text = String(value);
  // An invalid date's JSON is `null`, which would read as a missing value.
  else if (value instanceof Date && Number.isNaN(value.getTime())) text = 'an invalid Date';
  else {
    try {
      text = JSON.stringify(value) ?? `a ${typeof value}`;
    } catch {
      text = `a ${typeof value}`;
    }
  }
  return cut(text);
}
