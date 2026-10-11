---
name: verify-gate
description: Run the agentic-ui-poc quality gates and iterate to green without churning — cheapest-first gate ordering, fix only the first reported failure, three-attempt cap, and explicit stop conditions that require a human. Use when asked to verify a change, get the build green, run preflight or the Beta gate, fix lint/test/build failures, or confirm a step is actually complete.
---

# Verify and iterate to green

The purpose of this skill is to stop two specific failure modes: declaring
success without evidence, and thrashing on a failure that needs a human.

## The loop

### 1. Fast inner loop while coding

```bash
npm run beta:gate -- --gates guardrails,lint
```

Seconds, not minutes. Run it after every meaningful edit.

### 2. Full gate before claiming completion

```bash
npm run beta:gate -- --phase <phase-id>
```

Every gate in `ALL_GATES`, cheapest first: `node`, `lockfile`, `lockfile-selftest`,
`dependency-tree`, `dependency-tree-selftest`, `supply-chain`, `code-scanning`,
`guardrails`, `guardrails-selftest`, `crowdin-selftest`, `sanitizer-audit`,
`sanitizer-selftest`, `assertions`, then affected `lint`, `test`, `build`, `typecheck`,
then `spec-types`, `bundle`, `api-surface`, `publishability`, `peer-installability`, `fork-simulation`,
`upgrade-rehearsal`, `reference-drift`, `agent-mirror` and `customer-guardrails`. Stops at
the first failure and prints only its output tail. Reports land in
`$AGENTIC_UI_EVIDENCE_DIR/beta/gates/`. The count is the verdict line's, not this
paragraph's — an unknown `--gates` id prints the current list.

`dependency-tree` is **report-only** until the ADF removal commit (NXSAT-308): it passes
while listing every adf-hx, adf-core, adf-extensions, js-api and hxcs-js-client finding, so
a long list under a `pass` is the removal backlog, not a defect in your change. It does go
red in report-only mode if a location cannot be read, or if the tree is clean and
`BLOCKING` in `scripts/beta-harness/dependency-tree.mjs` was not flipped to `true`.

Only a run with **no** `--gates` filter can be cited for a phase. A filtered run
reports `verdict: pass-partial` and prints `PASS (PARTIAL) — n of <total>`, because two
reports in the evidence corpus read `"verdict": "pass"` having run one gate. The run
also prints `NOT REQUESTED` for every gate it skipped — read that line before quoting
a count.

For non-Beta work the equivalent is `npm run review:preflight` followed by
`npx nx affected -t build`.

### 3. Fix exactly one thing

Fix **the first reported failure only**. Do not batch speculative fixes: when
several land together you cannot attribute the improvement, and a wrong one hides
behind a right one. Re-run, then move to the next.

### 4. Cap the attempts

**Three attempts per step.** On the third failure, stop and report:

- what you changed each time
- the exact failing output
- your current hypothesis
- what you need in order to proceed

Continuing past three is how agents burn an hour producing a worse diff.

## Before you diagnose anything: check the runtime

```bash
node scripts/beta-harness/node-version.mjs
```

This is gate zero of `beta:gate`, but a **bare `nx` command does not run it and
does not get its workarounds.** On Node 25, `npx nx run nuxeo-client:test` fails
with `SecurityError: Cannot initialize local storage without a
--localstorage-file path` on entirely correct code, because Node 25's global
`localStorage` throws and shadows jsdom's. An agent has already misread that as a
product defect. If the preflight says `PASS WITH WARNING`, route every
verification through `npm run beta:gate` and treat any red from a bare `nx`
command as uninterpretable until you have reproduced it inside the gate.

## Reading failures

| Symptom                                                         | Usual cause                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SecurityError: Cannot initialize local storage`                | Wrong Node major, not a code defect. Run the preflight above. Never "fix" the spec.                                  |
| Nx reports a task **flaky**                                     | Often one task hash run under two Node majors, not genuine flakiness. Check the preflight first.                     |
| `Cannot find module '@hylandsoftware/...'` or `'@alfresco/...'` | Registry token missing. Check `SATORI_GH_READONLY_TOKEN` before touching code.                                       |
| `__decorate is not defined` in a spec                           | `tsconfig.spec.json` missing `importHelpers: false` — compare against `libs/shared/nuxeo-client/tsconfig.spec.json`. |
| Test passes alone, fails in the suite                           | Shared state. Check for un-reset signals or a missing `takeUntilDestroyed()`.                                        |
| Lint error about cross-feature import                           | Real architecture violation. Move the shared code to `libs/shared/`, do not suppress.                                |
| Guardrails failure on hardcoded colour                          | Use a theme token, not a literal.                                                                                    |
| Build passes locally, fails in CI                               | Stale local `node_modules`. Re-run `npm ci` and compare.                                                             |

## Never do these

- Add an eslint-disable to silence a rule instead of fixing the cause.
- Skip, `.only`, or weaken a test to get green.
- Widen a type to `any` to satisfy the compiler.
- Delete a failing assertion because the new behaviour "looks right".
- Report success while a gate is red, or while gates were skipped because an
  earlier one failed. The report lists `skipped` for exactly this reason — read it.
- Cite a `pass-partial` report as a phase gate, or quote its check count as if the
  filtered-out gates had run. Read `gates.notRequested` before quoting anything.
- Change application code to satisfy a failing test before you have classified the
  failure. Product defect, test defect, environment, configuration, dependency —
  decide which, in writing, first.

## Stop and ask a human when

- The same failure survives three distinct fix attempts.
- Passing would require any item from "Never do these".
- The fix widens the public API or exposes an adf-hx type through it.
- The fix touches `install.xml` or marketplace packaging.
- The fix contradicts a verified fact in `AGENTS/11-beta-program.md` section 3.

## Completion criteria

A step is complete when, and only when:

1. The full gate exits 0 with `verdict: "pass"` — not `pass-partial` — and nothing
   in `gates.skipped` or `gates.notRequested`, **and**
2. the phase evidence run exits 0 — see [`capture-phase-evidence`](../capture-phase-evidence/SKILL.md).

Reasoning about correctness is not a substitute for either. Quote the gate
verdict line and the evidence verdict line when you report completion.
