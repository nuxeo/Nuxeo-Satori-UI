/**
 * The runtime of layout version 2's computed fields: it evaluates the computations a layout names,
 * against a record that is already loaded (docs/business-apps/layout-v2.md, section 4). The
 * validator in `@agentic-ui/shared/app-definition` checks the same computations when a package is
 * built. Plain TypeScript, with no Angular and no HTTP.
 */
export { compute } from './lib/compute';
export { isStoredCalendarDay } from './lib/dates';
export { PACKAGED_COMPUTATION_EVALUATORS } from './lib/evaluators';
export {
  MAX_DEPTH,
  MAX_TEMPLATE_LENGTH,
  type ComputationContext,
  type ComputationEvaluator,
  type ComputationResult,
  type ComputationValue,
} from './lib/types';
