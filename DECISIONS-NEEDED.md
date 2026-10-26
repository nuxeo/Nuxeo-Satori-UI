# Decisions Needed — Stage 2 (Stop the Bleeding)

This file tracks integration-test issues that need team or product decisions
before implementation can continue.

## 1. Search ?q= Parameter: Product Change vs Test Workaround

> **The security half is RESOLVED; only the product question below is still open.**
>
> The injection guard no longer depends on `?q=` and is no longer blocked on this
> decision. `apps/nuxeo-ui-e2e/src/search.spec.ts` drives `/#/search` through the search
> drawer's full-text input and asserts every search request Enter sends — the results request
> and the drawer's baseline-count search are identical on the wire. Until NXSAT-308
> it drove `/#/search-adf-hx`, the one production call site of `escapeHxqlLiteral`; that
> route is deleted with adf-hx, so the specs moved first. `/#/search` sends the term to the
> `default_search` page provider as the `ecm_fulltext` named parameter and Nuxeo binds it
> server-side, so the specs assert that the term arrives as that bound value verbatim and in
> no other parameter, that Nuxeo answers 200, and that the query-shaped payload matches 0
> documents — as NXQL structure it matched all 1,940 on the shared instance. If the page is
> ever rewritten to build NXQL itself, the same specs check for an escaped literal instead.
> It is falsifiable: concatenating the term into NXQL, or pre-escaping the bound value, takes
> both specs red.
>
> What follows is therefore **only** the product question — should `/#/search?q=` be a
> shareable URL? Nothing in the test suite is waiting on the answer. Task 2.3 is
> unblocked and delivered; see `docs/integration-test-stage-2-status.md`.

**Original context (from audit §9.2, Task 2.3), kept for the record:**

- search.spec.ts:33-45 tested the HXQL injection guard by visiting `/#/search?q=O'Brien`
- The search component does NOT currently read the `q` URL parameter
- This made the injection guard spec non-functional: it navigated to a URL with a query term, but the component ignored it
- The spec passed (didn't error), but it didn't exercise the escaping path it was written to guard

**Options:**

### A. Product change (preferred)

Make the search component read `q` from URL query params and pre-fill the search input:

- Pro: Makes direct search links work (useful feature)
- Pro: Makes the guard spec functional as-is
- Pro: URL becomes a shareable artifact
- Con: Requires product change + migration of existing specs that expect empty search

### B. Test workaround

Drive the filters drawer via Playwright API instead:

- Pro: No product change
- Pro: Tests the escaping the long way
- Con: More brittle (depends on drawer structure)
- Con: Doesn't test the URL-based flow at all
- Con: Creates test-only code path divergence

**Recommendation:** Option A (product change). The URL parameter is a useful feature
and the specs were written assuming it would work. The workaround (B) makes the
test suite more complex while leaving a feature gap.

Note that the recommendation is now about the feature alone. The reason it was urgent —
"the specs were written assuming it would work" — no longer applies: the specs were
rewritten to drive the real vulnerable surface instead, so neither option is needed to
make the guard functional.

**Decision needed from:** Product/Feature lead

**Blocked tasks:** none. Task 2.3 (make the injection-guard specs exercise the real
path) is delivered, by neither option — the specs moved to `/#/search-adf-hx`, which
is where `escapeHxqlLiteral` is actually called, and then to `/#/search` through the
drawer input when NXSAT-308 scheduled that route for deletion.

---

## 2. WebKit E2E Failures: Product Fix vs Test Scoping

**Context (from audit §9.3, Task 2.6):**

- 4 specs fail on WebKit engine: cross-browser.spec.ts navigation, focus, and search tests
- Root cause: WebKit focuses disabled-but-interactive buttons differently from Chromium
- This is a product defect (a11y issue), not a test defect
- Tests correctly surface the problem

**Options:**

### A. Product fix (preferred)

Fix the button focus behavior to match Chromium:

- Pro: Fixes real accessibility issue
- Pro: Makes behavior consistent across engines
- Pro: Tests become green on both engines
- Con: Requires product change

### B. Scope tests to chromium only

Mark failing specs with `.only('chromium')` or similar:

- Pro: Makes gate green immediately
- Pro: No product change required
- Con: Hides accessibility issue
- Con: Reduces cross-browser coverage
- Con: "verified on Safari" claim becomes weaker

**Recommendation:** Option A (product fix). The tests are correctly surfacing a
real a11y issue. Scoping them away hides the defect without fixing it.

**Decision needed from:** Product/Accessibility lead

**Blocked tasks:**

- Task 2.6: Address WebKit E2E failures

---

## Notes

Both decisions should be made together since they affect the same gate (E2E).
The faster path is B+B (test workarounds), but it accumulates tech debt and
reduces coverage. The better path is A+A (product fixes), but requires product
investment.

If the decision is "fix later", we should:

1. Create tickets for both product changes
2. Document WHY we're using workarounds (not "tests are wrong", but "deferred product fix")
3. Set a timeline for revisiting

Last updated: 2026-09-21 (Stage 2 implementation)
