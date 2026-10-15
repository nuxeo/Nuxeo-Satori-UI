/**
 * How `verify-gate.mjs` turns a list of gate results into a verdict and a summary line.
 *
 * Kept apart from the runner so `verify-gate.selftest.mjs` can drive it with made-up results:
 * running the real gates takes a quarter of an hour.
 */

/**
 * The verdict and the lines printed under it.
 *
 * @param {{ total: number, notRequested: string[], skipped: string[],
 *           results: { id: string, passed: boolean, command?: string, outputTail?: string }[],
 *           tail?: number }} run
 * @returns {{ verdict: 'pass' | 'pass-partial' | 'fail', lines: string[] }}
 */
export function summarize({ total, notRequested, skipped, results, tail = 40 }) {
  const allPassed = results.every((r) => r.passed);
  const full = notRequested.length === 0;
  const verdict = !allPassed ? 'fail' : full ? 'pass' : 'pass-partial';
  const lines = [];
  if (allPassed && full) {
    lines.push(`verdict  PASS — all ${total} gates green`);
  } else if (allPassed) {
    lines.push(`verdict  PASS (PARTIAL) — ${results.length} of ${total} gates green`);
    lines.push(`         NOT RUN: ${notRequested.join(', ')}`);
    lines.push('         A partial run is a fast inner loop, not a phase gate. Do not sign off on this.');
  } else {
    const firstFailure = results.find((r) => !r.passed);
    lines.push(`verdict  FAIL — first failing gate: ${firstFailure.id}`);
    if (skipped.length) {
      lines.push(`skipped  ${skipped.join(', ')} (not run because an earlier gate failed)`);
    }
    lines.push(`\ncommand  ${firstFailure.command}`);
    lines.push(`--- last ${tail} lines ---`);
    lines.push(firstFailure.outputTail);
    lines.push('--- end ---');
  }
  return { verdict, lines };
}
