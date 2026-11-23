/**
 * Evaluates a computation as a layout writes it, `{ "type", "parameters" }`, against the record
 * already loaded (docs/business-apps/layout-v2.md, section 4). Decision 4 sets the rule: registered
 * computations only, no expression language, no requests, no customer code. So a computation is
 * looked up by its ID among registered evaluators, and nothing in a layout is ever run as code.
 *
 * It never throws. Whatever is wrong, the result says why, and the renderer leaves the field out
 * (section 8): an evaluator that throws, or a context whose `value`, `display` or `rule` does, is
 * caught and refused too.
 */
import { isFieldReference, isRecord } from '@agentic-ui/shared/app-definition';
import { PACKAGED_COMPUTATION_EVALUATORS } from './evaluators';
import {
  MAX_DEPTH,
  accept,
  quote,
  refuse,
  type ComputationContext,
  type ComputationEvaluator,
  type ComputationResult,
} from './types';

const COMPUTATION_KEYS = ['type', 'parameters'];

/** Evaluates `{ "type", "parameters" }` as a layout writes it. */
export function compute(
  computation: unknown,
  context: ComputationContext,
  evaluators: Readonly<Record<string, ComputationEvaluator>> = PACKAGED_COMPUTATION_EVALUATORS,
): ComputationResult {
  return run(computation, context, evaluators, 1);
}

function run(
  computation: unknown,
  context: ComputationContext,
  evaluators: Readonly<Record<string, ComputationEvaluator>>,
  depth: number,
): ComputationResult {
  if (!isRecord(computation) || typeof computation['type'] !== 'string')
    return refuse('a computation is { "type": <ID>, "parameters": [...] }');
  const type = computation['type'];
  if (depth > MAX_DEPTH)
    return refuse(`the computation "${type}" is nested more than ${MAX_DEPTH} deep`);
  const extra = Object.keys(computation).find((key) => !COMPUTATION_KEYS.includes(key));
  if (extra !== undefined)
    return refuse(`the computation "${type}" has a key a computation does not have: "${extra}"`);
  // Own keys only, so that "constructor" or "__proto__" never finds a function of Object's.
  if (!Object.hasOwn(evaluators, type))
    return refuse(`the computation "${type}" is not registered`);
  // Absent is an empty list; `null` is malformed, not absent (section 8).
  const parameters = 'parameters' in computation ? computation['parameters'] : [];
  if (!Array.isArray(parameters))
    return refuse(`the computation "${type}" has parameters that are not a list`);
  const evaluate = (parameter: unknown): ComputationResult =>
    resolve(parameter, context, evaluators, depth);
  try {
    return evaluators[type](parameters, context, evaluate);
  } catch (error) {
    return refuse(`the computation "${type}" failed: ${messageOf(error)}`);
  }
}

/**
 * One parameter's value: a literal as written, a property through `context.value`, or a
 * computation one level deeper. A rule is not a value: `core.choose` hands its own to the context.
 */
function resolve(
  parameter: unknown,
  context: ComputationContext,
  evaluators: Readonly<Record<string, ComputationEvaluator>>,
  depth: number,
): ComputationResult {
  if (
    typeof parameter === 'string' ||
    typeof parameter === 'boolean' ||
    (typeof parameter === 'number' && Number.isFinite(parameter))
  )
    return accept(parameter);
  if (isFieldReference(parameter)) return property(parameter.field, context);
  if (isRecord(parameter) && Object.keys(parameter).length === 1 && 'computed' in parameter)
    return run(parameter['computed'], context, evaluators, depth + 1);
  return refuse(
    `a parameter is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} }, not ${quote(parameter)}`,
  );
}

/**
 * A property as one value. Missing, as `undefined` or Nuxeo's `null`, is `null`. A `Date`, which a
 * form's date picker may hold, is its ISO 8601 text. A list or an object is not one value, and
 * `core.sum` and `core.count` read theirs through `context.value` themselves.
 */
function property(field: string, context: ComputationContext): ComputationResult {
  const value = context.value(field);
  if (value === undefined || value === null) return accept(null);
  if (typeof value === 'string' || typeof value === 'boolean') return accept(value);
  if (typeof value === 'number' && Number.isFinite(value)) return accept(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return accept(value.toISOString());
  return refuse(`the property "${field}" holds ${quote(value)}, not a text, a number or a boolean`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : quote(error);
}
