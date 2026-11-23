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
 * short whatever a file holds. Only what the cut keeps is written, so quoting a list of a million
 * items reads about thirty of them (`jsonPrefix`). It never throws, so that explaining a refusal
 * cannot fail: a value JSON cannot write, or that throws when it is read, is named by its kind.
 */
export function quote(value: unknown): string {
  try {
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    // An invalid date's JSON is `null`, which would read as a missing value.
    if (value instanceof Date && Number.isNaN(value.getTime())) return 'an invalid Date';
    return cut(jsonPrefix(value, QUOTE_LENGTH + 1) ?? kindOf(value));
  } catch {
    // A getter or a proxy that throws, a cycle, or a bigint, which JSON has no text for.
    return kindOf(value);
  }
}

/** Whether `value` is a boxed primitive of `unbox`'s kind: `unbox` throws for any other. */
function boxed(value: object, unbox: (this: unknown) => unknown): boolean {
  try {
    unbox.call(value);
    return true;
  } catch {
    return false;
  }
}

/** "a function", "an object": `typeof`, which never throws, whatever the value. */
function kindOf(value: unknown): string {
  const kind = typeof value;
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}

/**
 * What `JSON.stringify(value)` begins with, written up to `limit` characters and no further: no
 * item of a list and no value in an object is read once that many are written, and a text or a key
 * is cut before it is escaped. An object it opens still has its keys listed, by `Object.keys`, as
 * JSON.stringify lists them. Its first `limit` characters are JSON.stringify's, toJSON and boxed
 * values included, and it is shorter than `limit` only when it is all of it. Undefined where
 * JSON.stringify gives nothing. It throws where JSON.stringify would, on a cycle or a bigint, if it
 * gets that far before the cut.
 */
function jsonPrefix(value: unknown, limit: number): string | undefined {
  let text = '';
  const open: unknown[] = [];
  // False when JSON has no text for the value, which a list then writes as null and an object
  // leaves out with its key.
  const write = (value: unknown, key: string): boolean => {
    if (
      (typeof value === 'object' && value !== null) ||
      typeof value === 'function' ||
      typeof value === 'bigint'
    ) {
      const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') value = toJSON.call(value, key);
    }
    // A boxed value is its primitive, told by its `valueOf`, which takes only its own kind:
    // `instanceof` would take an object that only inherits from `Number.prototype`.
    if (typeof value === 'object' && value !== null) {
      if (boxed(value, Number.prototype.valueOf)) value = Number(value);
      else if (boxed(value, String.prototype.valueOf)) value = String(value);
      else if (boxed(value, Boolean.prototype.valueOf))
        value = Boolean.prototype.valueOf.call(value);
      else if (boxed(value, BigInt.prototype.valueOf)) value = BigInt.prototype.valueOf.call(value);
    }
    if (value === null) text += 'null';
    else if (typeof value === 'boolean') text += String(value);
    // A cut text's own first `limit` characters write at least the first `limit` of its JSON.
    else if (typeof value === 'string') text += JSON.stringify(value.slice(0, limit));
    else if (typeof value === 'number') text += Number.isFinite(value) ? String(value) : 'null';
    else if (typeof value === 'bigint') throw new TypeError('JSON has no text for a bigint');
    else if (typeof value !== 'object') return false;
    else if (open.includes(value)) throw new TypeError('JSON has no text for a cycle');
    else {
      open.push(value);
      if (Array.isArray(value)) {
        text += '[';
        for (let index = 0; index < value.length && text.length < limit; index += 1) {
          if (index > 0) text += ',';
          if (!write(value[index], String(index))) text += 'null';
        }
        text += ']';
      } else {
        const object = value as Record<string, unknown>;
        let first = true;
        text += '{';
        for (const name of Object.keys(object)) {
          if (text.length >= limit) break;
          const before = text.length;
          text += `${first ? '' : ','}${JSON.stringify(name.slice(0, limit))}:`;
          if (write(object[name], name)) first = false;
          else text = text.slice(0, before);
        }
        text += '}';
      }
      open.pop();
    }
    return true;
  };
  return write(value, '') ? text : undefined;
}
