#!/usr/bin/env bash
set -euo pipefail

# E2E Vacuity Control: do the specs notice an empty repository?
#
# Runs the Chromium suite twice against the same code — once normally, once with the app in
# the page starved of data — and counts the specs that passed the first run and then failed
# at an `expect()` of their own in the second. Those specs' assertions demonstrably depend on
# what the repository returned. Specs that pass both runs are named as a standing list: they
# assert something an empty repository already satisfies.
#
# The verdict and the exit code come from `scripts/beta-harness/vacuity-verdict.mjs`, which
# has its own selftest (`npm run beta:e2e-vacuity-selftest`). This script's job is to produce
# the two runs; it does not classify anything itself.
#
# ## Why this no longer uses a wrong password
#
# It did, for four rounds, and the file's header carried the reasoning for each. NXSAT-643
# ended that approach rather than refining it, and the reason is worth keeping because it is
# the same class of defect the earlier rounds fixed:
#
# The identity guard NXSAT-643 added asks who the session belongs to in the `signedIn`
# fixture and in `test.beforeAll`, *before* a spec body runs. A wrong password therefore
# fails there — and `apps/nuxeo-ui-e2e/assertion-failure-reporter.ts` excludes hook and
# fixture failures by design, because a spec that dies in setup "would have failed
# identically if its body were empty". So from the moment the guard merged, every
# repository-data spec failed in excluded territory and the counted population was empty for
# every possible run. Measured at `integration/nxsat-308` @ 8badd9c8e on 2026-10-22:
#
#   wrong password    9 failed, 0 at an assertion, threshold 5   -> FAIL, unconditionally
#
# A control that can only print FAIL is as useless as one that can only print PASS, and
# worse than none, because it gets silenced. That sentence was already in this file, about
# the first version of it. This is the same shape in the other direction.
#
# Two alternatives were measured before this one, and both were rejected on the numbers
# rather than on taste:
#
#   - Count the identity/auth setup failures. Reverses the review decision that excluded
#     them, and readmits failures that say nothing about what a spec asserts.
#   - Run as a restricted user (`parity-user`). Measured 2 failed / 10 passed, and neither
#     failure was about an assertion reading data: one was a toolbar button absent for a
#     non-writer, the other a 403 on the spec creating its own fixture. The reason is
#     structural — every spec discovers its expected value from the same server and identity
#     it renders from, so changing the identity moves both sides together and the assertions
#     still agree. No server-side perturbation can reach a spec body; discovery breaks first,
#     and discovery lives in `beforeAll`.
#
# So the perturbation is client-side: `E2E_STARVE_APP=1` makes the app's own `/nuxeo/api`
# calls answer 200-but-empty via `page.route`, while the spec's discovery context — a
# separate `request.newContext()` that `page.route` cannot reach — keeps working. `/me` is
# passed through so the identity guard still functions; starving it would move the failure
# back into the fixture, which is the whole defect being fixed.
#
# ## Why two runs rather than one
#
# A single starved run cannot tell a data-sensitive spec from one that was already red.
# Measured the same day: `auth.spec.ts:211` fails at its own assertion on the unmodified
# harness with correct credentials, and a single-run count included it among the sensitive.
# It is not sensitive to anything. The baseline run removes that whole class, and it also
# turns the specs that pass both runs into a reportable finding instead of silence.
#
# ## Why --retries=0 on both runs
#
# The measurement is a difference between two runs, so a retry that rescues a spec in one of
# them and not the other is noise in the comparison rather than flake tolerance. The suite's
# own committed config keeps its retries for ordinary runs.
#
# Usage:
#   ./scripts/e2e-negative-control.sh [min-expected]
#
# Default: 5. Measured on 2026-10-22 at `integration/nxsat-308` @ 8badd9c8e, full Chromium
# project: 8 data-sensitive specs, 8 that pass with the repository empty, 8 never perturbed
# (`auth.spec.ts`, which does not use the `signedIn` fixture), 0 inconclusive and 0 already
# failing. 5 leaves margin for one or two specs legitimately changing shape without the gate
# going red for the wrong reason.
#
# The first measurement on that head was 7, before this change also fixed the four browse and
# cross-browser assertions that were matching the listing's empty-state copy. Three of those
# are data-sensitive now, and `auth.spec.ts`'s privilege test moved out of the already-failing
# column — which is why the number moved while the suite did not grow.
#
# Exit codes:
#   0 - Control passed (enough specs are data-sensitive)
#   1 - Control FAILED (too few = assertions may be vacuous)
#   2 - Environment issue (no Nuxeo, preflight failed, a run produced no report)

MIN_FAILURES="${1:-5}"

# Each run gets its own directory, for the reports *and* for Playwright's artifacts. Both
# runs used the config's single `outputDir` at first, so the starved run overwrote the
# baseline's screenshots, videos and traces — the half a reader needs to see what the app
# looked like when the assertion still passed.
OUT_DIR="dist/e2e"
BASELINE_DIR="$OUT_DIR/vacuity-baseline"
STARVED_DIR="$OUT_DIR/vacuity-starved"
RESULTS_FILE="$OUT_DIR/results.json"
ASSERTIONS_FILE="$OUT_DIR/assertion-failures.json"
CONFIG="apps/nuxeo-ui-e2e/playwright.config.ts"

echo "=== E2E Vacuity Control: do the specs notice an empty repository? ==="
echo "Two runs of the Chromium suite: baseline, then with the app starved of data."
echo "Expected: at least ${MIN_FAILURES} specs pass the baseline and fail at their own expect when starved."
echo ""

# Validated before either run — a threshold that cannot fail would otherwise be discovered
# after ten minutes of Playwright.
node scripts/beta-harness/vacuity-verdict.mjs --check-threshold "$MIN_FAILURES"

rm -rf "$BASELINE_DIR" "$STARVED_DIR"
rm -f "$RESULTS_FILE" "$ASSERTIONS_FILE"
mkdir -p "$BASELINE_DIR" "$STARVED_DIR"

if ! npx tsx scripts/beta-harness/e2e-preflight.mjs; then
  echo "ERROR: Preflight failed with correct credentials."
  echo "Fix the environment before running the vacuity control."
  exit 2
fi

# `collect <dir> <label>` moves the two reports a run wrote into their own directory. An
# absent report is an environment failure, never an empty result: treating a missing file as
# zero findings is the mistake that made the first version of this control incapable of
# reporting anything but FAIL.
collect() {
  local dir="$1" label="$2"
  for f in "$RESULTS_FILE" "$ASSERTIONS_FILE"; do
    if [ ! -f "$f" ]; then
      echo ""
      echo "ERROR: ${f} was not written by the ${label} run, so no verdict can be read."
      echo "Check that the json reporter and assertion-failure-reporter.ts are both still"
      echo "registered in ${CONFIG}."
      exit 2
    fi
  done
  mv "$RESULTS_FILE" "$dir/results.json"
  mv "$ASSERTIONS_FILE" "$dir/assertion-failures.json"
}

echo ""
echo "--- run 1 of 2: baseline (correct credentials, app served normally) ---"
# `E2E_STARVE_APP=0` explicitly, not merely "unset here". A caller who exported it while
# investigating the control would otherwise starve BOTH runs, and two starved runs agree with
# each other: no spec changes outcome between them, the count is 0, and the control reports a
# confident FAIL about the suite rather than an error about its own invocation.
set +e
E2E_STARVE_APP=0 npx playwright test -c "$CONFIG" --project=chromium --retries=0 \
  --output "$OUT_DIR/vacuity-baseline/artifacts" 2>&1 | tee /tmp/e2e-vacuity-baseline.log
BASELINE_EXIT=${PIPESTATUS[0]}
set -e
collect "$BASELINE_DIR" "baseline"
echo "baseline Playwright exit: ${BASELINE_EXIT}"

echo ""
echo "--- run 2 of 2: starved (same specs, the app served an empty repository) ---"
set +e
E2E_STARVE_APP=1 npx playwright test -c "$CONFIG" --project=chromium --retries=0 \
  --output "$OUT_DIR/vacuity-starved/artifacts" 2>&1 \
  | tee /tmp/e2e-vacuity-starved.log
STARVED_EXIT=${PIPESTATUS[0]}
set -e
collect "$STARVED_DIR" "starved"
echo "starved Playwright exit: ${STARVED_EXIT}   (non-zero is the expected outcome here)"

echo ""
node scripts/beta-harness/vacuity-verdict.mjs \
  "$BASELINE_DIR/results.json" \
  "$STARVED_DIR/results.json" \
  "$STARVED_DIR/assertion-failures.json" \
  "$MIN_FAILURES"
