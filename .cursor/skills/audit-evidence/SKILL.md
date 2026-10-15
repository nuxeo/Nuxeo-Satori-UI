---
name: audit-evidence
description: Independently audit a Beta phase before sign-off — verify every evidence assertion is capable of failing, that it asserts the deliverable rather than the app's pulse, that screenshots and console-error suppressions are not hiding gaps, and that the recorded phase state has artifacts behind it. Use before marking any phase complete, when asked whether evidence is sound, when a capture reports a suspiciously high pass count, or when two documents disagree about what shipped.
---

# Audit evidence independently

**`AGENTS/12-review-agents.md` is the specification.** This skill is the Cursor
adapter; `.claude/agents/evidence-auditor.md` and `.claude/agents/acceptance-validator.md`
are the Claude one. Read the spec — do not work from this file alone, and do not
duplicate its substance back into here.

Two roles, run in order:

| Role                 | Question                                                                      | Spec |
| -------------------- | ----------------------------------------------------------------------------- | ---- |
| Evidence auditor     | Could this evidence have failed if the feature were broken?                   | §3   |
| Acceptance validator | Did the phase deliver what the plan said, and does the record match the code? | §4   |

## Why bother

Every phase so far self-reported green, was CI-green, and contained at least one
overstated claim. Phase 1's would have shipped a dead feature to every customer: the
config path was wrong by one segment and "would have 404'd on every install", and it
had already been written into section 3 of `11-beta-program.md` as a _verified fact_
and used to downgrade risk R7.

No gate caught any of it. A reviewer reading adversarially caught all of it.

## Run the mechanical part first

```bash
npm run beta:audit     # assertions that cannot fail, plus every suppression in force
npm run beta:state     # does every "complete" cite a manifest that exists and passed?
```

`beta:audit` catches constants, self-comparisons and missing conditions — including
the two real defects from this repo, `'main.js' === 'main.js'` and
`check('… NOT covered', true)`. **It cannot tell you whether a falsifiable assertion
asserts the right thing.** That judgement is yours, and it is the part that has
actually failed here.

## Then use a subagent that did not write the thing

You may not audit your own work. In Cursor, spawn `generalPurpose` with a prompt that
carries the phase id and the spec path, and **do not** include your implementation
reasoning — the point is a reader who has to derive the claim from the artifacts.

Per the model policy in `11-beta-program.md` §5: never accept one model's verdict on
its own output. Two families agreeing is the signal; disagreement means a human looks.
This gate has **never been run** for Phase 1 or Phase 2.

## Report the six statements, never one word

`WHAT WE THINK` / `CHANGED` / `TESTED` / `ACTUALLY PASSED` / `EVIDENCE PROVES` /
`REMAINS`. `ACTUALLY PASSED` and `EVIDENCE PROVES` differ on purpose — a gate can pass
while proving less than it appears to. See §6 of the spec for the exact shape, and §3
and §4 for the two report formats.

## Never

- Change application code to make evidence pass. Classify first — §5 has the taxonomy.
- Paraphrase a verdict. `pass-partial` and `pass-incomplete` are not `pass`; `16 screenshots` is not
  `16 observations` when 7 are byte-identical.
- Report an empty "not covered". Silence reads as coverage.
