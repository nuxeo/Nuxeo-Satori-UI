---
name: beta-phase
description: End-to-end SDLC orchestrator for one phase of the Nuxeo Satori Beta program in Nuxeo-Satori-UI — load the phase contract, plan, implement in verifiable steps, iterate against the quality gate until green, capture per-step image evidence with assertions, run a multi-model adversarial review, open a conventional-commit PR with the evidence report attached, then monitor CI to green. Use when asked to run or continue a Beta phase (phase-0-baseline through phase-6-quality), to "execute the Beta plan", to implement Layer 0/1/2/3 work, or to adopt adf-hx components.
---

# Run a Beta phase, end to end

Drive one phase autonomously, but **pause for a go-ahead after the plan** and
**never mark a step complete without gate output plus evidence**. Track phases
with a TODO list.

Read first, in this order:

1. `AGENTS.md` — repository conventions
2. `AGENTS/11-beta-program.md` — the phase contract, verified facts, agent roster, iteration protocol
3. `AGENTS/00-architecture.md` — layer boundaries
4. The phase's row in section 4 of the program doc

The four sub-skills this delegates to: [`verify-gate`](../verify-gate/SKILL.md),
[`capture-phase-evidence`](../capture-phase-evidence/SKILL.md),
[`implement-api-port`](../implement-api-port/SKILL.md),
[`adopt-adf-hx-component`](../adopt-adf-hx-component/SKILL.md),
[`add-extension-point`](../add-extension-point/SKILL.md).

## Phase 1 — Intake

- Identify which Beta phase is being run. If ambiguous, ask; do not guess.
- Re-read section 3 of `AGENTS/11-beta-program.md`. Those facts are settled — if
  your approach contradicts one, stop and prove it before proceeding.
- Confirm prerequisites: is a `read:packages` token needed for this phase, and is
  it present? Phases 1 and 2 do not need one; phase 3 does.
- Establish the baseline. If no evidence run exists for the previous phase, say
  so — you are working without a comparison point.

## Phase 2 — Plan (gate: human go-ahead)

Produce a plan that decomposes the phase into **verifiable steps**. A step is
well-formed only if you can state, before writing code, the assertion that will
prove it works. If you cannot, the step is too vague — split it.

For each step give: the change, the files, the assertion, and the layer (0-3) it
belongs to. Then show the plan and pause.

## Phase 3 — Branch

```bash
git checkout -b feature/beta-<phase-id>-<short-desc>
```

Never commit to `main`. If the phase carries the Angular 20 upgrade or other
monorepo-wide change, raise that as a separate PR first — see risk R6 in the RFC.

## Phase 4 — Implement, step by step

For each planned step:

1. Use `explore` subagents to map call sites before changing shared code.
2. Make the smallest change that could satisfy the step's assertion.
3. Apply the layer discipline: if a manifest could express it, do not hardcode it.
4. Add or update unit tests **including the error path**.
5. Run the fast inner loop and iterate per [`verify-gate`](../verify-gate/SKILL.md).

Delegate repetitive work to the specialised skills rather than improvising:
API ports to `implement-api-port`, component swaps to `adopt-adf-hx-component`,
manifest wiring to `add-extension-point`.

Update `AGENTS/01-services.md` and `docs/api-integrations.md` as you go, not at
the end.

## Phase 5 — Gate (gate: green)

```bash
npm run beta:gate -- --phase <phase-id>
```

All of guardrails, affected lint, affected test and affected build must pass.
Follow the iteration protocol; stop after three failed attempts on the same step
and report the blocker.

## Phase 6 — Evidence (gate: exit 0)

```bash
npx nx serve nuxeo-ui              # separate terminal
npm run beta:evidence -- <phase-id>
```

Write the phase's steps file first if it does not exist — see
[`capture-phase-evidence`](../capture-phase-evidence/SKILL.md). The run must exit
0, which requires every step to record at least one check and every check to
pass. A capture that asserts nothing fails deliberately.

Show the user the `INDEX.md` path and inline the key screenshots in your summary.

## Phase 7 — Adversarial review

Launch reviewers **in parallel, in a single message**, on different model
families, per the roster in section 5 of the program doc:

- `bugbot` over the branch changes
- `security-review` if the phase touched auth, blob handling or config loading
- two `generalPurpose` reviewers on different families (Opus 5 and GPT-5.6) with
  the phase contract as context

Verify every claim first-hand before acting on it — reviewers report false
positives. Agreement across families is the signal; disagreement means a human
decides. Fix real findings, then re-run Phase 5.

## Phase 8 — PR

```bash
gh pr create --base main \
  --title "feat(beta): <phase-id> — <summary>" \
  --body "$(cat <<'EOF'
## Summary
...

## Layer
Which of Layers 0-3 this implements, and why.

## Evidence
Verdict from the phase manifest, with key screenshots.

## Gates
guardrails / lint / test / build — all green.

## Verified facts touched
Any change to AGENTS/11-beta-program.md section 3, or "none".
EOF
)"
```

Attach the evidence `INDEX.md` content. Reference NXENG-619.

## Phase 9 — CI to green

Monitor checks. Fix failures with the same iteration protocol. If CI fails on
dependency installation, check whether the `read:packages` secret is present
before debugging code.

## Phase 10 — Close the loop

- Mark the phase's gates in `AGENTS/11-beta-program.md` section 4.
- If a verified fact changed, update section 3 **and** the RFC's evidence
  appendix. Never leave the two disagreeing.
- Update `.ai/state/phases.json` and run `npm run beta:state`. It refuses a
  `complete` that has no passing manifest behind it.
- **Update `docs/beta-delivery-record.md`.** That file is what gets presented, and
  it is the only place the narrative lives — what changed, why, with the numbers
  and the evidence reference. A phase closed without a line there is a phase
  nobody outside this repo can account for. Add rows rather than rewriting
  sections; the history is the point.
  - A number moved? Update section 5.
  - A gap opened or closed? Section 6.
  - A claim turned out wrong? Section 7. Do not delete the original claim.
- **Update `docs/adf-hx-workarounds.md`** for anything the phase added that exists only
  because adf-hx or adf-core forces it. Put the marker at the site —
  `WORKAROUND(adf-hx): W<n>`, `MISSING(adf-hx): M<n>`, `REFUSES: R<n>` or
  `DEGRADED(adf-hx): D<n>` — **and** the row in the register. The two are gated against
  each other by `guardrails`, in both directions, so a marker without a row or a row
  without a marker fails the phase. Set the **Removable?** column honestly: structural
  is not the same as future cleanup, and leadership reads the count.
- **Update `docs/adf-hx-upstream-findings.md`** if the cause was upstream's. That file is
  written to be sent to the adf-hx team, so every finding needs a version, a file path and
  a reproduction. Keep our own environmental problems out of it — a Node global, a macOS
  lockfile, an Angular config array. Including them weakens the real findings.
- **Exhaustive is the standard, not brevity.** A phase's write-up is judged against the
  work, not against a word count:
  - **every** diversion, challenge and dead end gets **its own line** in section 10,
    including work that was reverted. Reverted work leaves no trace in the diff, which
    makes it the most expensive knowledge in the repo and the easiest to lose. Say what it
    bought — a dead end that eliminated an option is not wasted.
  - a claim that turned out wrong **moves to section 7**. Never delete it. The record of
    what was believed is part of the record.
  - a decision that is a human's to make goes to section 9 with its cost of delay, not
    into a note nobody reads.
- Add the phase's steps file to the table if it was new.
- Report: what shipped, what the evidence proves, what is still open.

## Hard stops

Escalate to a human rather than attempting a fourth time when a fix would:

- weaken or skip a test
- widen the public API, or expose an adf-hx type through it
- change `install.xml` or marketplace packaging
- contradict a verified fact in section 3
- require pinning an adf-hx dist-tag instead of an exact version
