/**
 * Test support, not part of the library: `tsconfig.lib.json` leaves it out, and nothing in
 * `src/index.ts` reaches it. A context over a plain record, which logs every property read and
 * every rule asked, so that a spec can see what a computation did not read.
 */
import type { ComputationContext } from './types';

/**
 * 01:30 on 23 November 2026 in the zone the suite runs in, so that its local day is the 23rd in
 * any zone `SATORI_TEST_TZ` asks for. In the default, Asia/Calcutta, it is still 22 November in
 * UTC (2026-11-22T20:00:00.000Z), so a computation that read today in UTC rather than in the
 * reader's zone would be a day out, and a spec would see it. `dates.spec.ts` asserts that it is.
 */
export const TODAY = new Date(2026, 10, 23, 1, 30);

export interface RecordOptions {
  /** Display values by property. Without one, a property's display is its value as text. */
  readonly display?: Readonly<Record<string, string>>;
  /** Whether a rule passes. Without it, every rule passes. */
  readonly rule?: (rule: unknown) => boolean;
  readonly today?: Date;
}

export interface LoggedContext extends ComputationContext {
  readonly reads: string[];
  readonly displayed: string[];
  readonly rules: unknown[];
}

export function recordOf(
  values: Readonly<Record<string, unknown>>,
  options: RecordOptions = {},
): LoggedContext {
  const reads: string[] = [];
  const displayed: string[] = [];
  const rules: unknown[] = [];
  return {
    reads,
    displayed,
    rules,
    value(field) {
      reads.push(field);
      return Object.hasOwn(values, field) ? values[field] : undefined;
    },
    display(field) {
      displayed.push(field);
      return options.display?.[field] ?? String(values[field] ?? '');
    },
    rule(rule) {
      rules.push(rule);
      return options.rule ? options.rule(rule) : true;
    },
    today: options.today ?? TODAY,
  };
}
