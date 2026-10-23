/**
 * How `verify-gate.mjs` turns a list of gate results into a verdict and a summary line.
 *
 * Kept apart from the runner so `verify-gate.selftest.mjs` can drive it with made-up results:
 * running the real gates takes a quarter of an hour.
 *
 * A gate either passes, fails, or did not run. "Did not run" is its own state, never green: a
 * gate that checked nothing has proven nothing, so it is counted and named separately, and a run
 * containing one is not a `pass`.
 */

/**
 * The exit code a gate uses to say "I checked nothing". 78 is sysexits' EX_CONFIG: the check
 * could not run in this environment, which is what a skipped code-scanning run is.
 */
export const NOT_RUN_EXIT_CODE = 78;

/**
 * A gate's result from its exit code. Only a gate declared `mayNotRun` can report not-run, so a
 * stray 78 from any other gate is still a failure.
 *
 * @param {{ mayNotRun?: boolean }} gate
 * @param {number | null} exitCode `null` when the process was killed by a signal
 * @returns {'pass' | 'not-run' | 'fail'}
 */
export function classify(gate, exitCode) {
  if (exitCode === 0) return 'pass';
  if (exitCode === NOT_RUN_EXIT_CODE && gate.mayNotRun === true) return 'not-run';
  return 'fail';
}

/**
 * The verdict, the counts and the lines printed under them.
 *
 * `pass` only when every gate was requested and every one ran green. `pass-incomplete` when all
 * were requested and none failed but at least one did not run. `pass-partial` for a filtered
 * run. `fail` when any gate failed.
 *
 * @param {{ total: number, notRequested: string[], skipped: string[],
 *           results: { id: string, status?: 'pass' | 'not-run' | 'fail', passed: boolean,
 *                      command?: string, outputTail?: string }[],
 *           tail?: number }} run
 */
export function summarize({ total, notRequested, skipped, results, tail = 40 }) {
  // A result without `status` (from a caller that predates it) is read from `passed`.
  const statusOf = (r) => r.status ?? (r.passed ? 'pass' : 'fail');
  const green = results.filter((r) => statusOf(r) === 'pass');
  const notRun = results.filter((r) => statusOf(r) === 'not-run').map((r) => r.id);
  const failed = results.filter((r) => statusOf(r) === 'fail');
  const full = notRequested.length === 0;
  const verdict = failed.length
    ? 'fail'
    : !full
      ? 'pass-partial'
      : notRun.length
        ? 'pass-incomplete'
        : 'pass';
  const notRunNote = notRun.length ? `${notRun.length} NOT RUN (${notRun.join(', ')})` : '';

  const lines = [];
  if (verdict === 'pass') {
    lines.push(`verdict  PASS — all ${total} gates green`);
  } else if (verdict === 'pass-incomplete') {
    lines.push(`verdict  PASS (INCOMPLETE) — ${green.length} green, ${notRunNote}`);
    lines.push('         A gate that did not run proved nothing. Do not sign off on this.');
  } else if (verdict === 'pass-partial') {
    lines.push(
      `verdict  PASS (PARTIAL) — ${green.length} of ${total} gates green` +
        (notRunNote ? `, ${notRunNote}` : ''),
    );
    lines.push(`         NOT REQUESTED: ${notRequested.join(', ')}`);
    lines.push(
      '         A partial run is a fast inner loop, not a phase gate. Do not sign off on this.',
    );
  } else {
    const firstFailure = failed[0];
    lines.push(`verdict  FAIL — first failing gate: ${firstFailure.id}`);
    if (notRun.length) lines.push(`not run  ${notRun.join(', ')}`);
    if (skipped.length) {
      lines.push(`skipped  ${skipped.join(', ')} (not run because an earlier gate failed)`);
    }
    lines.push(`\ncommand  ${firstFailure.command}`);
    lines.push(`--- last ${tail} lines ---`);
    lines.push(firstFailure.outputTail);
    lines.push('--- end ---');
  }
  return {
    verdict,
    counts: { green: green.length, notRun: notRun.length, failed: failed.length, total },
    notRun,
    lines,
  };
}
