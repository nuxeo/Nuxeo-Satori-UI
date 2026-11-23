/**
 * Decision 4's starting set of computations (docs/business-apps/layout-v2.md, section 4), by ID.
 * Each does bounded work on the record already loaded: it makes no request and runs no customer
 * code. A customer's own computation is a Layer 2 registration in code, passed to `compute` beside
 * these.
 *
 * Each evaluator states how many parameters it takes itself, rather than reading it from
 * `PACKAGED_COMPUTATIONS`, the signatures the validator holds layouts to. `registries.spec.ts`
 * holds the two to each other, so that a parameter one of them gains cannot be quietly ignored by
 * the other.
 */
import { XPATH, isFieldReference, isRecord } from '@agentic-ui/shared/app-definition';
import {
  UNITS,
  dayNumber,
  difference,
  localDayOf,
  parseDay,
  written,
  type CalendarDay,
  type Unit,
} from './dates';
import {
  MAX_TEMPLATE_LENGTH,
  accept,
  quote,
  refuse,
  type ComputationContext,
  type ComputationEvaluator,
  type ComputationResult,
} from './types';

type Evaluate = (parameter: unknown) => ComputationResult;

/** An evaluator that takes `least` to `most` parameters, refusing any other number by name. */
function define(
  type: string,
  least: number,
  most: number,
  body: ComputationEvaluator,
): ComputationEvaluator {
  return (parameters, context, evaluate) => {
    if (parameters.length >= least && parameters.length <= most)
      return body(parameters, context, evaluate);
    // Worded as the validator words it (app-definition's checker.ts), so the two read alike.
    const expected = least === most ? `${most}` : `${least} to ${most}`;
    const noun = expected === '1' ? 'parameter' : 'parameters';
    return refuse(
      `the computation ${quote(type)} takes ${expected} ${noun}, not ${parameters.length}`,
    );
  };
}

function isResult(value: CalendarDay | ComputationResult | null): value is ComputationResult {
  return value !== null && 'ok' in value;
}

/** Today's day in the reader's zone, or the refusal of a `today` that is not a valid `Date`. */
function todayOf(type: string, context: ComputationContext): CalendarDay | ComputationResult {
  const today: unknown = context.today;
  if (!(today instanceof Date) || Number.isNaN(today.getTime()))
    return refuse(
      `the computation ${quote(type)} reads today from its context, which gives ${quote(today)}, not a valid Date`,
    );
  return localDayOf(today);
}

/** A date parameter as a calendar day; `null` when it is missing. */
function dateParameter(
  type: string,
  parameter: unknown,
  evaluate: Evaluate,
): CalendarDay | ComputationResult | null {
  const given = evaluate(parameter);
  if (!given.ok) return given;
  if (given.value === null) return null;
  const day = typeof given.value === 'string' ? parseDay(given.value) : undefined;
  return (
    day ??
    refuse(`the computation ${quote(type)} takes an ISO 8601 date, not ${quote(given.value)}`)
  );
}

/**
 * A list parameter. A list is not one value, so a property is read through `context.value` here
 * rather than through `evaluate`. A literal or a computation is never a list, and is refused,
 * unless it gives nothing. A missing list gives `null`, nothing to show: a property the record was
 * loaded without is not a list with no items, and showing 0 for it would be a value nobody counted.
 */
function listParameter(
  type: string,
  parameter: unknown,
  context: ComputationContext,
  evaluate: Evaluate,
): unknown[] | ComputationResult {
  let value: unknown;
  if (isFieldReference(parameter)) value = context.value(parameter.field);
  else {
    const given = evaluate(parameter);
    if (!given.ok) return given;
    value = given.value;
  }
  if (value === undefined || value === null) return accept(null);
  if (!Array.isArray(value))
    return refuse(`the computation ${quote(type)} takes a list, not ${quote(value)}`);
  return value;
}

/** The whole years from a date to today, counted as birthdays are (src/lib/dates.ts). */
const age = define('core.age', 1, 1, ([date], context, evaluate) => {
  const born = dateParameter('core.age', date, evaluate);
  if (born === null || isResult(born)) return born ?? accept(null);
  const today = todayOf('core.age', context);
  if (isResult(today)) return today;
  // An age before birth is not an age. A negative number or a 0 would show a wrong value as if it
  // were right, so a date after today is refused, and the renderer leaves the field out.
  if (dayNumber(born) > dayNumber(today))
    return refuse(
      `the computation "core.age" takes a date that is not after today, not ${written(born)}`,
    );
  return accept(difference(born, today, 'years'));
});

/** `{<prefix>:<name>}`: a property, written as the validator's `XPATH` writes one. */
const PLACEHOLDER = new RegExp(`\\{(${XPATH.source.slice(1, -1)})\\}`, 'g');

/**
 * The text with each placeholder replaced by the property's display value. It is text, never
 * HTML: nothing is escaped or interpreted, so markup in a value reaches the renderer as the
 * characters it is, and the renderer binds the result as text. A replacement is inserted as it is,
 * so a `$&` in a value is not a replacement pattern. Text in braces that is not a placeholder, such
 * as `{note}` or `{ dc:title }`, stays as written; the validator refuses it when the package is
 * built, so here it only comes from a file that was not.
 */
const template = define('core.template', 1, 1, ([text], context) => {
  if (typeof text !== 'string')
    return refuse(
      `the computation "core.template" takes a text with {<prefix>:<name>} placeholders, not ${quote(text)}`,
    );
  if (text.length > MAX_TEMPLATE_LENGTH)
    return refuse(
      `the computation "core.template" takes a text of at most ${MAX_TEMPLATE_LENGTH} characters, not ${text.length}`,
    );
  return accept(
    text.replace(PLACEHOLDER, (_placeholder, field: string) => {
      const value = context.value(field);
      // Missing, as `undefined` or Nuxeo's `null`, is empty text, whatever the display would say.
      return value === undefined || value === null ? '' : context.display(field);
    }),
  );
});

/**
 * The sum of a list's numbers, or of one subfield's numbers in a list of complex values.
 *
 * - A blank, `null`, is skipped, as a spreadsheet's sum skips an empty cell: an amount not entered
 *   yet is not an amount.
 * - Anything else that is not a number is refused, a numeric text such as "12" included. Adding
 *   around it would show a total that leaves something out, as if it were whole.
 * - An item with no such subfield at all is refused. Nuxeo sends every subfield of a complex
 *   value, with `null` for an empty one, so a missing key is a misspelt subfield.
 */
const sum = define('core.sum', 1, 2, (parameters, context, evaluate) => {
  const subfield = parameters.length === 2 ? parameters[1] : undefined;
  if (parameters.length === 2 && (typeof subfield !== 'string' || subfield === ''))
    return refuse(
      `the computation "core.sum" takes the name of a subfield as its second parameter, not ${quote(subfield)}`,
    );
  const items = listParameter('core.sum', parameters[0], context, evaluate);
  if (!Array.isArray(items)) return items;
  let total = 0;
  for (const [index, item] of items.entries()) {
    let value: unknown = item;
    let where = `item ${index}`;
    if (typeof subfield === 'string') {
      if (!isRecord(item))
        return refuse(
          `the computation "core.sum" reads ${quote(subfield)} in each item, and item ${index} is ${quote(item)}, not a complex value`,
        );
      if (!Object.hasOwn(item, subfield))
        return refuse(
          `the computation "core.sum" reads ${quote(subfield)} in each item, and item ${index} has no ${quote(subfield)}`,
        );
      value = item[subfield];
      where = `${quote(subfield)} in item ${index}`;
    }
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value))
      return refuse(`the computation "core.sum" adds numbers, and ${where} is ${quote(value)}`);
    total += value;
  }
  if (!Number.isFinite(total))
    return refuse('the computation "core.sum" gives a total too large to be a number');
  return accept(total);
});

/** How many items a list holds. A missing list gives `null`, as `listParameter` says why. */
const count = define('core.count', 1, 1, ([list], context, evaluate) => {
  const items = listParameter('core.count', list, context, evaluate);
  return Array.isArray(items) ? accept(items.length) : items;
});

/**
 * The second date minus the first, in whole days, months or years. Positive when the second is
 * later, negative when it is earlier. Months and years are counted as `core.age` counts them. The
 * second may be the literal "today", as written; a property or a computation whose value is the text
 * "today" is not a date. Either date missing gives `null`.
 */
const dateDiff = define('core.dateDiff', 3, 3, ([first, second, unit], context, evaluate) => {
  if (!UNITS.includes(unit as Unit))
    return refuse(
      `the computation "core.dateDiff" counts in "days", "months" or "years", not ${quote(unit)}`,
    );
  const from = dateParameter('core.dateDiff', first, evaluate);
  if (isResult(from)) return from;
  const to =
    second === 'today'
      ? todayOf('core.dateDiff', context)
      : dateParameter('core.dateDiff', second, evaluate);
  if (isResult(to)) return to;
  if (from === null || to === null) return accept(null);
  return accept(difference(from, to, unit as Unit));
});

/** The first value while the rule passes, the second otherwise. Only the chosen one is evaluated. */
const choose = define('core.choose', 3, 3, ([rule, chosen, otherwise], context, evaluate) =>
  evaluate(context.rule(rule) ? chosen : otherwise),
);

export const PACKAGED_COMPUTATION_EVALUATORS: Readonly<Record<string, ComputationEvaluator>> =
  Object.freeze({
    'core.age': age,
    'core.template': template,
    'core.sum': sum,
    'core.count': count,
    'core.dateDiff': dateDiff,
    'core.choose': choose,
  });
