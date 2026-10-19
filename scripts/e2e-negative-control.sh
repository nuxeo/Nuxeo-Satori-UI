#!/usr/bin/env bash
set -euo pipefail

# E2E Negative Control: Bogus Credentials Sensitivity
#
# Runs the E2E suite with wrong credentials and asserts that at least N specs fail at an
# `expect` of their own.
#
# ## What this control does and does not establish — read before quoting its output
#
# It measures **credential sensitivity**: that a spec's own assertion changes outcome when the
# session is invalid, so the spec is not asserting a server-independent constant. That is a
# real property and it is the §9.1 class of defect it catches.
#
# It does **not** establish that the assertion observed *repository data*. `NUXEO_PASS` gates
# the session, so an assertion about post-login chrome, routing or authentication state fails
# under a wrong password having read no document at all. This script claimed the stronger thing
# for three rounds — "so those assertions depend on repository data rather than on constants" —
# and that claim was false, which the run below demonstrates rather than supposes. Of the ten
# counted failures on 2026-09-25 against the local stack, chromium:
#
#   src/browse.spec.ts:50   browse > the shell renders its chrome on an authenticated route
#
# is an assertion about chrome on an authenticated route. It failed because authentication
# failed. Several others — "exposes the tab surfaces the Beta scope covers", "the adf-hx search
# surface has no text input to type into", "lib-search should render" — are surface-presence
# assertions in the same position. The measurement was sound; the sentence drawn from it was
# not, so the sentence is what changed.
#
# ## Why the counted population is not narrowed to repository-data assertions
#
# Review proposed counting only explicitly annotated repository-data checks, or keeping an
# allowlist of them. Declined deliberately, and this is the fourth round on this control, so
# the reason matters: an annotation is a claim by whoever wrote the spec that nothing verifies.
# A spec tagged `repository-data` while asserting `'Root'` would be counted, and the tag would
# read as a control while being an assertion about an assertion. That is the defect class this
# audit exists to remove, reintroduced one level up. Narrowing the *claim* costs nothing and
# cannot rot; narrowing the *population* by self-declared metadata can.
#
# Context from audit §9.1.1: cross-browser.spec.ts:49-52 records that running the suite
# under bad credentials caught two vacuous specs. That negative control existed only as
# a comment. This script makes it executable.
#
# ## Why it counts specs out of results.json rather than grepping the console
#
# The first version forced `--reporter=json` and then grepped stdout for `N failed` — a
# phrase only Playwright's `list` and `line` reporters emit. The JSON reporter never
# prints it, so the `|| echo "0"` fallback fired on every run, `ACTUAL_FAILURES` was
# always 0, and `[ 0 -ge 5 ]` was always false. The script could only ever print FAIL,
# whichever way the run went — a control that always reports failure is as useless as one
# that always reports success, and worse than none, because it gets silenced.
#
# So the reporter is left as the config declares it (`list` for a human, `json` to
# `dist/e2e/results.json`) and the count comes from the file. That does not depend on
# console phrasing, and an absent file is treated as an environment failure rather than
# as zero failures — the same mistake in a different place.
#
# ## Why a bare failure count is not the measurement
#
# `NUXEO_PASS` is read in three places, not one: this suite's `signedIn` fixture, the
# `httpCredentials` in `playwright.config.ts`, and `newNuxeoApiContext()` in `fixtures.ts`.
# So a wrong password does not only make repository-data assertions fail — it also makes
# `aRootChild()` throw `API query failed: 401` before the spec body runs at all.
#
# A spec that died there proves nothing about whether its assertions check anything: it
# would have failed identically if its body were empty. Counting those toward the threshold
# is the same defect as the reporter mismatch above, one level up — a control whose number
# does not measure what its message claims. On the run this script was last verified
# against, 4 of 13 failures were exactly that.
#
# ## Why the filename is not the measurement either
#
# The previous version classified by where the run said the error happened: a failure located
# in a `*.spec.ts` file counted, anything else did not. Review was right that this does not
# hold, and it was measured rather than argued — on Playwright 1.63, `expect(1 + 1).toBe(3)`
# and a promise rejecting with "Timeout 45000ms exceeded" produce error locations that are
# both `*.spec.ts` lines and are indistinguishable by filename. A `page.goto()` timeout is
# thrown from a line the spec wrote, so it counted toward the threshold with no `expect`
# having run at all. A run where the wrong password broke navigation everywhere could
# therefore satisfy a control whose entire purpose is to prove that specs' assertions are credential-sensitive.
#
# So the fact is emitted rather than inferred. `apps/nuxeo-ui-e2e/assertion-failure-reporter.ts`
# reads `TestStep.category === 'expect'` — which Playwright sets itself and its JSON reporter
# does not serialize — and writes, per failing spec, whether a failing assertion outside any
# hook was the cause. An `expect` that fails in `beforeEach` does not count: it is nested
# under the hook steps and the body never ran.
#
# That keeps the conservatism the filename test was reaching for while dropping its two
# errors. It no longer excludes a genuine repository-data assertion for living in
# `fixtures.ts` — `expectSurfaceWithData()` was in exactly that position — and it no longer
# admits a navigation timeout for being thrown from a spec file.
#
# Both corrections are visible on the runs this version was verified against, chromium,
# against the local stack:
#
#   wrong password    14 failed, 10 at an assertion, 4 never reached one
#   correct password   2 failed,  2 at an assertion, 21 passed
#
# The old classifier scored the same suite 8 and 6. The two runs also show the corrections
# separately: under correct credentials one of the two genuine failures is located in
# `fixtures.ts:69` and the filename test would have discarded it, and
# `scripts/beta-harness/assertion-reporter.selftest.mjs` shows the reverse — restore the
# filename rule and its count of deliberate failures goes from 1 to 3.
#
# NOTE the default threshold below is still 5 against a measured 10. Raising it is a
# judgement about how much drift should be tolerated, not part of this fix.
#
# Usage:
#   ./scripts/e2e-negative-control.sh [min-expected-failures]
#
# Default: expects at least 5 failures (conservative - should be higher once fixed)
#
# Exit codes:
#   0 - Control passed (enough specs failed at their own assertions, as expected)
#   1 - Control FAILED (too few failures = vacuous assertions present)
#   2 - Environment issue (no Nuxeo, preflight failed, no results file)

exec node "$(dirname "$0")/e2e-negative-control.mjs" "$@"
