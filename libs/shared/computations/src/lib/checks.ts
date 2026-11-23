/**
 * Checks across fields in a form (docs/business-apps/layout-v2.md, section 6): a field's value
 * compared with another value before saving, such as an end date that may not be before the start.
 *
 * A check is referred to by ID, as a computation is, and compares two values: the field's own, and
 * its one parameter's, a literal, a property or a computation, evaluated as a computation's
 * parameter is (`evaluateValue`). So a date reads as `src/lib/dates.ts` reads one, and a form's
 * picked day, a `Date`, as the day it names.
 *
 * A check is a help to the person typing, not a guarantee: the server's constraints still apply.
 * So a check passes when either value is missing, which is `required`'s to refuse, and a check
 * that cannot compare its values is refused with the reason, for the form to leave unanswered
 * rather than block a save the server would take.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { evaluateValue, messageOf } from './compute';
import { dayNumber, parseDay } from './dates';
import {
  accept,
  quote,
  refuse,
  type ComputationContext,
  type ComputationResult,
  type ComputationValue,
} from './types';

/**
 * One registered check: given the field's value and its parameter's, both already evaluated and
 * neither missing, whether the field passes, as `{ ok: true, value: true }` or `false`, or why the
 * two cannot be compared.
 */
export type CheckEvaluator = (
  value: ComputationValue,
  other: ComputationValue,
) => ComputationResult;

/** A value as a day number, or `undefined` for one that is not a date as `src/lib/dates.ts` reads one. */
function dayOf(value: ComputationValue): number | undefined {
  const day = typeof value === 'string' ? parseDay(value) : undefined;
  return day && dayNumber(day);
}

/** A value as a number: a number, or a text that is one, as a stored `5000` may be written `"5000"`. */
function numberOf(value: ComputationValue): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : undefined;
}

const notBefore: CheckEvaluator = (value, other) => {
  const day = dayOf(value);
  if (day === undefined) return refuse(`core.notBefore compares dates, not ${quote(value)}`);
  const bound = dayOf(other);
  if (bound === undefined) return refuse(`core.notBefore compares dates, not ${quote(other)}`);
  // Days, not instants: the date picker edits a day, and an end on the start's day is not before it.
  return accept(day >= bound);
};

const atMost: CheckEvaluator = (value, other) => {
  const number = numberOf(value);
  if (number === undefined) return refuse(`core.atMost compares numbers, not ${quote(value)}`);
  const bound = numberOf(other);
  if (bound === undefined) return refuse(`core.atMost compares numbers, not ${quote(other)}`);
  return accept(number <= bound);
};

/**
 * The checks layout-v2.md, section 6, registers, by ID. `checks.spec.ts` holds them to
 * `PACKAGED_CHECKS`, the signatures the validator holds a file to.
 */
export const PACKAGED_CHECK_EVALUATORS: Readonly<Record<string, CheckEvaluator>> = Object.freeze({
  'core.notBefore': notBefore,
  'core.atMost': atMost,
});

/**
 * Runs one check, `{ "type", "parameters" }` as a layout writes it, on the property `field`.
 * Answers `{ ok: true, value: true }` when it passes, `false` when it fails, and a reason when it
 * cannot say. It never throws.
 */
export function runCheck(
  check: unknown,
  field: string,
  context: ComputationContext,
  evaluators: Readonly<Record<string, CheckEvaluator>> = PACKAGED_CHECK_EVALUATORS,
): ComputationResult {
  if (!isRecord(check) || typeof check['type'] !== 'string')
    return refuse('a check is { "type": <ID>, "parameters": [...] }');
  const type = check['type'];
  // Own keys only, so that "constructor" never finds a function of Object's.
  if (!Object.hasOwn(evaluators, type)) return refuse(`the check ${quote(type)} is not registered`);
  const parameters: unknown = 'parameters' in check ? check['parameters'] : [];
  if (!Array.isArray(parameters) || parameters.length !== 1)
    return refuse(`the check ${quote(type)} takes one parameter, not ${quote(parameters)}`);
  const own = evaluateValue({ field }, context);
  if (!own.ok) return own;
  const other = evaluateValue(parameters[0], context);
  if (!other.ok) return other;
  // Nothing to compare: an empty field is `required`'s to refuse, and an empty bound bounds nothing.
  if ([own.value, other.value].some((value) => value === null || value === '')) return accept(true);
  try {
    return evaluators[type](own.value, other.value);
  } catch (error) {
    return refuse(`the check ${quote(type)} failed: ${messageOf(error)}`);
  }
}
