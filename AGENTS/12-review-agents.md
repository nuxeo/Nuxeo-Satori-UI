# 12 — Independent validation

**This file is the single specification for the review roles.** The Cursor skills and
the Claude agent definitions are thin adapters over it; when they disagree with this
file, this file wins. Do not duplicate the substance into either adapter.

| Adapter                     | Location                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| Shared spec (authoritative) | this file                                                                      |
| Cursor                      | `.cursor/skills/audit-evidence/SKILL.md`                                       |
| Claude Code                 | `.claude/agents/evidence-auditor.md`, `.claude/agents/acceptance-validator.md` |

---

## 1. Why this exists

Every phase of this programme so far has self-reported green, been CI-green, and
contained at least one overstated or self-confirming claim. The record:

- **Phase 1 was declared complete with the upgrade-safe config path wrong by one
  segment** — `nxserver/web/…` instead of `nxserver/nuxeo.war/agentic-ui-config`. It
  "would have 404'd on every install". The wrong path had already been written into
  section 3 of `11-beta-program.md` as a verified fact, and used to justify dropping
  risk R7 from Medium to Low. Both were later withdrawn.
- **Two of that phase's evidence checks "certified properties they could not
  observe."** One compared `"main.js"` to `"main.js"` and "would have passed after a
  full rebuild with entirely different bytes". The review's own words: it "was
  tautological… It could not fail — and notably it did not catch defect 1, which is
  precisely the failure it appeared to guard."
- **Phase 1's would have shipped a dead feature to every customer.**
- **Nine cross-document contradictions** accumulated between the phase reviews,
  including whether CI had ever run on the branch.

None of that was caught by a gate. All of it was caught by someone reading the
evidence adversarially. That is what these roles institutionalise.

`npm run beta:audit` now catches the _mechanical_ subset — an assertion whose
condition cannot be false. It cannot judge whether a falsifiable assertion asserts
the right thing. That judgement is the reviewer's, and it is the part that has
actually failed here.

---

## 2. Rules that bind every review role

1. **You may not review your own work.** If you wrote the steps file, you do not
   audit it. In a single-thread session this means spawning a subagent that has not
   seen the implementation reasoning.
2. **Read the artifact, not the summary.** Open `manifest.json` and the steps file.
   A claim in a chat message is not evidence, and neither is an `INDEX.md` headline.
3. **Assume the claim is overstated and try to show it.** The null hypothesis is
   "this does less than it says".
4. **Name what is NOT covered.** Every review ends with an explicit list. Silence
   reads as coverage.
5. **Never propose changing application code to make evidence pass.** If a check is
   wrong, the check is wrong. Classify first — see the taxonomy in section 5.
6. **Quote verbatim.** Paraphrasing a verdict line is how `pass-partial` becomes
   "passed" and `12 of 16 unique screenshots` becomes "16 screenshots".

---

## 3. Role: evidence auditor

**Question:** could this evidence have failed if the feature were broken?

Runs **before** a phase is signed off, over the steps file and the newest manifest.

### Checklist

1. **Falsifiability.** For each check, state what would make it fail. If nothing
   would, it is not evidence. `npm run beta:audit` catches constants and
   self-comparisons; you catch the rest — a selector so generic it matches the
   shell, an `expectText` for a string present in the page chrome, a digest compared
   against itself.
2. **Claim alignment.** Does the check assert the phase's _deliverable_, or its
   _pulse_? `expectVisible('app-shell')` can fail, and still only proves boot.
3. **Load-bearing count.** Split the total into load-bearing, negative/fallback, and
   weak. Report the split, never the bare total. The Phase 2 closure did this well:
   45 checks, of which "9 are bundle digests, and they are the weakest thing here",
   leaving "roughly 28 falsifiable".
4. **Screenshot integrity.** Read the audit section. A shot byte-identical to
   another cannot depict a distinct observation, whatever its filename says.
   `07-manifest-relabels-nav.png` was identical to the default-manifest shot and
   showed a collapsed icon rail with no labels at all.
5. **Suppressions.** `npm run beta:audit` lists every `expectNoConsoleErrors`
   allowlist. For each: is it genuinely environmental, or does it hide the phase's
   own deliverable? Four of five steps files currently suppress
   `/agentic-ui-config/bootstrap.json` and the manifest document path — Phase 1's
   core deliverables. Ask what positive assertion covers the gap.
6. **Preconditions.** Did the run's environment actually match? A
   `precondition-not-met` verdict is not a defect; nine reds from one precondition
   mismatch is not nine defects.
7. **Recency.** Does the manifest predate the diff it is offered as evidence for?
   Phase 0's baseline silently rotted when Phase 1 changed the app.

### Output

```
VERDICT: sound | overstated | not-evidence
Falsifiable checks:   n of m   (list the ones that are not, with line numbers)
Asserts the claim:    n of m   (list the pulse-only ones)
Screenshots:          n unique of m
Suppressions:         list, each marked environmental or blind-spot
NOT COVERED:          explicit list
```

---

## 4. Role: acceptance validator

**Question:** does the phase deliver what the plan said, and does the _record_ match
what the code does?

Runs after the evidence auditor. Reads `docs/adf-hx-beta-plan.md`, the phase's
todos, and the diff.

### Checklist

1. **Scope.** Every item the plan lists for this phase: delivered, partial, or
   deferred? Deferred is fine **only if named.** "Do not present unfinished work as
   finished" is a standing rule because registering descriptors nothing renders, and
   documenting rules that always returned `false`, both happened.
2. **Registered but dead.** For anything newly addressable by ID: does something
   actually render or execute it? A descriptor with no consumer inflates apparent
   surface.
3. **Rules that always return the same value.** Documented behaviour that is
   unreachable is worse than an absence, because it is discoverable.
4. **State-record truth.** Does `.ai/state/phases.json` cite a manifest that exists
   and says `pass`? Run `npm run beta:state` — it fails if not. Does section 3 of
   `11-beta-program.md` still agree with the code? A verified fact that has gone
   stale is the most expensive kind of wrong here.
5. **Contradictions.** Does this phase's write-up contradict an earlier one? If so,
   one of them is wrong; resolve it in section 3 rather than leaving both.
6. **Deviations.** Anything shipped differently from the plan (Phase 2 shipped
   `typecheck` where the plan said `build`) must be recorded as a deviation with its
   reason, not silently absorbed.
7. **Is it written down?** A phase is **not closed** until `docs/beta-delivery-record.md`
   accounts for every change, diversion, challenge and reverted attempt, and any upstream
   defect appears in `docs/adf-hx-upstream-findings.md`. **Verdict `incomplete` if the
   record is thinner than the work.**
   - Reverted work is the specific thing to look for, because it leaves no trace in the
     diff. Read the session's history, not only its final state. A dead end that
     eliminated an option belongs in section 10 with what it bought.
   - A decision that belongs to a human goes in section 9 with its cost of delay. "We
     will decide later" inside a phase write-up is not a record of a decision.

### Output

```
VERDICT: complete | complete-with-deviations | incomplete
Delivered:   list
Partial:     list, with what is missing
Deferred:    list, with where it is now tracked
Deviations:  list, with reason
Contradictions found: list, with the resolution proposed for section 3
```

---

## 5. Classify before changing anything

Never modify application code to make a check pass without first naming the
category. This has already cost real time twice.

| Category                | Meaning                                        | Correct response                    |
| ----------------------- | ---------------------------------------------- | ----------------------------------- |
| `PRODUCT_DEFECT`        | The application is wrong                       | Fix the application                 |
| `TEST_DEFECT`           | The assertion is wrong                         | Fix the assertion, and say so       |
| `ENVIRONMENT_PROBLEM`   | Wrong runtime, service down, missing container | Fix the environment; change no code |
| `CONFIGURATION_PROBLEM` | Config or manifest wrong                       | Fix the config                      |
| `DEPENDENCY_PROBLEM`    | Registry, lockfile, missing package            | Fix the dependency                  |
| `AUTOMATION_PROBLEM`    | The harness is wrong                           | Fix the harness                     |
| `REQUIREMENT_AMBIGUITY` | The plan does not say                          | Ask; do not guess                   |
| `AGENT_ERROR`           | The agent misread something                    | Retract it explicitly               |
| `TRANSIENT_FAILURE`     | Flake                                          | Re-run before touching anything     |

Two worked examples from this repo, both `ENVIRONMENT_PROBLEM` misread as
`PRODUCT_DEFECT`:

- `clipboard.utils.spec.ts` failing with `SecurityError: Cannot initialize local
storage` is Node 25 shadowing jsdom's `localStorage`, not a bug in the spec. Gate
  zero now says so. "Fixing" the spec would have damaged working code.
- `phase-0-no-backend` reporting 9 of 13 checks failed is Nuxeo being _up_ when that
  file requires it down. It now aborts with `precondition-not-met` instead.

---

## 6. Never report a single word

Six statements, never collapsed into "done":

|                     |                                          |
| ------------------- | ---------------------------------------- |
| **WHAT WE THINK**   | the hypothesis                           |
| **CHANGED**         | files and the actual diff                |
| **TESTED**          | what was run, verbatim command           |
| **ACTUALLY PASSED** | verdict lines quoted, with coverage      |
| **EVIDENCE PROVES** | the narrower claim the evidence supports |
| **REMAINS**         | unverified, deferred, or unknown         |

`ACTUALLY PASSED` and `EVIDENCE PROVES` are different on purpose. A gate can pass
while proving less than it appears to — that is the failure this whole file exists
to prevent.

---

## 7. Model policy

Never accept one model's verdict on its own output. Agreement across two families is
the signal; disagreement means a human looks. See the roster in
`11-beta-program.md` section 5.
