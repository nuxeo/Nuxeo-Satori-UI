/**
 * Whether one live identity-guard control run ended as its row in `identity-guard.controls.mjs`
 * says it must — the judgement, with no spawning and no server, so the selftest can prove it
 * rejects what it is supposed to reject (NXSAT-643).
 *
 * Split out for the reason `gate-summary.mjs` is split out of `verify-gate.mjs`: the script that
 * runs the controls asks Nuxeo a question at import time, so a selftest cannot import it, and a
 * validation block no selftest can reach is a validation block nobody has seen fail.
 */

/**
 * The first assertion in `fixtures/identity-guard/control.steps.mjs` that runs *after* the fault
 * is injected.
 *
 * Every other expectation here is met by a run that never reached the fault. If the credentials
 * or the proxy fail after the positive run, the phase runner's own startup check rejects the run
 * as Anonymous and exits 2 before step 2 applies anything: the manifest is `precondition-not-met`,
 * `identity.valid` is false, the rejection names Anonymous — and it carries no non-guard checks
 * at all, so `ownFailed` is empty and every remaining expectation holds. The control passes
 * having proved nothing about the guard.
 *
 * Requiring this assertion to have *passed* is what separates "the guard rejected the fault" from
 * "the run never got that far": it cannot be recorded before the fault exists.
 */
export const POST_FAULT_ASSERTION = 'app shell still rendered';

/**
 * @typedef {object} ControlExpectation
 * @property {string} mode the fault `IDENTITY_GUARD_CONTROL` selects
 * @property {number} exit the exit code the phase runner must end with
 * @property {boolean} valid what `manifest.identity.valid` must be
 */

/**
 * @param {ControlExpectation} control
 * @param {number | null} status the runner's exit code
 * @param {any} manifest the run's `manifest.json`, or null when it wrote none
 * @returns {string[]} every way this run fell short; empty means it ended as the row says
 */
export function judgeControlRun(control, status, manifest) {
  const problems = [];
  if (status !== control.exit) problems.push(`exited ${status}, expected ${control.exit}`);
  if (!manifest) {
    problems.push('wrote no manifest');
    return problems;
  }
  if (manifest.identity?.valid !== control.valid) {
    problems.push(`identity.valid is ${manifest.identity?.valid}, expected ${control.valid}`);
  }
  const ownChecks = (manifest.steps ?? [])
    .flatMap((/** @type {any} */ s) => s.checks ?? [])
    .filter((/** @type {any} */ c) => !c.name.includes('identity guard'));
  const ownFailed = ownChecks.filter((/** @type {any} */ c) => !c.passed);
  if (ownFailed.length) {
    problems.push(
      `the steps' own checks failed (${ownFailed.map((/** @type {any} */ c) => c.name).join(', ')}), so this says nothing about the guard`,
    );
  }
  if (!ownChecks.some((/** @type {any} */ c) => c.name === POST_FAULT_ASSERTION && c.passed)) {
    problems.push(
      `the steps' "${POST_FAULT_ASSERTION}" assertion is not recorded as passed, so this run ` +
        'ended before its fault was applied and says nothing about the guard',
    );
  }
  if (!control.valid) {
    const rejected = (manifest.identity?.checks ?? [])
      .flatMap((/** @type {any} */ c) => c.reports ?? [])
      .filter((/** @type {any} */ r) => !r.ok);
    if (!rejected.some((/** @type {any} */ r) => /Anonymous/.test(r.problem ?? ''))) {
      problems.push(
        `rejected, but not for running as Anonymous: ${JSON.stringify(rejected.map((/** @type {any} */ r) => r.problem))}`,
      );
    }
    if (manifest.verdict !== 'precondition-not-met') problems.push(`verdict ${manifest.verdict}`);
  }
  return problems;
}
