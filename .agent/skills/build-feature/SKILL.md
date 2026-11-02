---
name: build-feature
description: >-
  End-to-end agentic playbook for building a feature, enhancement or new module in the
  Nuxeo-Satori-UI Nx/Angular monorepo. Extends the fix-bug skill: inherits its workspace,
  evidence story, gate, PR, CI, Jira and metrics machinery, and overrides the bug-shaped
  phases with design and layer placement, vertical-slice delivery, extension points, public
  API review and docs as deliverables. Use when asked to implement a feature or Jira story,
  build a new module or page, extend an existing feature, or make something customer
  configurable. Runs fully autonomously (YOLO mode, no confirmation gates).
---

# Build a feature — agentic, end-to-end

> **This skill extends [`fix-bug`](../fix-bug/SKILL.md). Read that first.**
> Everything there applies unless overridden below. This file is the diff, not a copy — a
> second full playbook would drift from the first within a month, and the half that is wrong
> is the half you would not notice.

Same YOLO contract: run end to end without pausing between phases. The hard stops are
`fix-bug`'s Guardrails plus the Stop conditions in Phase 3.5 below.

Record metrics with `--kind feature` so feature runs are never averaged with bug runs:

```bash
node scripts/agent-metrics.mjs start "$TICKET" --kind feature --model <the model you are>
```

## What is inherited unchanged

Do not re-derive these — follow `fix-bug` exactly:

| Phase                                      | Notes                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Setup check                                | Same prerequisites, including Playwright in the primary checkout                    |
| 1.5 Ticket workspace                       | Same script, same `--nuxeo shared` default                                          |
| 5 Local gate (`beta:gate`) + 5a coverage   | Same gates. Features add code, so coverage matters more                             |
| 5b `validate-fix`                          | A new surface is a new accessibility surface                                        |
| 6 Commit + PR                              | `feat(` not `fix(`, branch `feature/<desc>`                                         |
| 7 CI + review loop · 7.5 Jira · 10 Cleanup | Identical, including looping the review to a zero round and publishing the analysis |
| Time budget, metrics, Guardrails           | Identical, with the budgets below                                                   |

## What is removed

There is no bug, so these have no meaning and must not be faked:

- **Reproduce the bug.** Replaced by the baseline capture (Phase 2 below).
- **Root cause.** Replaced by the design decision (Phase 3.5 below).
- **A regression test that must fail first.** Replaced by tests for new behaviour (Phase 4b).

Do not write a "regression test" for a feature and claim it went red before the change. It went
red because the feature did not exist yet, which proves nothing about the test.

## Time budget

Features are not bugs and should not be measured against a bug's clock:

| Phase                        | Budget  | On overrun                                                    |
| ---------------------------- | ------- | ------------------------------------------------------------- |
| 1–1.6 story, prior art       | ~30 min | Acceptance criteria still ambiguous → stop, per Phase 1a      |
| 3.5 design + layer placement | ~45 min | Cannot place it in a layer → stop, it is an architecture call |
| 4 build, per vertical slice  | ~90 min | A slice that will not close → cut its scope, do not extend it |
| Whole run                    | ~1 day  | More than a day means it should have been several PRs         |

**If the whole thing will not fit in one reviewable PR, say so at Phase 3.5 and deliver slices.**
A 40-file PR does not get reviewed, it gets approved.

---

## Phase 1 — Understand the story _(overrides)_

Stories usually _do_ have Acceptance Criteria, which changes the job: the risk is not absence
but **ambiguity that reads like precision**.

- Fetch the issue and every comment as `fix-bug` Phase 1 describes.
- **Restate each acceptance criterion as something testable**, and flag any that is not. "The
  page should be intuitive" is not a criterion; "the filter panel remembers its state across a
  reload" is. Mark each `[from ticket]`, `[derived]` or `[needs decision]`.
- A `[needs decision]` criterion is a Phase 3.5 stop condition, not something to resolve by
  picking the reading that is easiest to build.
- Load `AGENTS/04-feature-scaffold.md` in addition to the usual context.

## Phase 1.6 — Prior art _(overrides)_

`fix-bug` establishes what correct _is_, because a bug is a deviation from it. A feature has no
prior correct behaviour to establish — but it does need to know what already exists, because the
most common failure here is building a second thing that does what an existing thing nearly
does. **Search before you scaffold.**

1. Does **this repo** already have most of it? Check `AGENTS/01-services.md` for an existing
   service method and `libs/shared/ui/` for an existing component before writing either.
2. Does **adf-hx** ship it? If a real component exists upstream, adopting it beats writing a
   lookalike — see [`adopt-adf-hx-component`](../adopt-adf-hx-component/SKILL.md).
3. Does the **Nuxeo server** already expose what you need? Check `AGENTS/02-nuxeo-apis.md` for
   the endpoint, enricher or automation operation, and probe the running instance to confirm the
   response shape before designing around an assumed one.

Record what you found and what you are reusing. "Nothing existed" is a claim, and it needs the
searches behind it.

## Phase 2 — Baseline capture _(overrides "reproduce")_

There is no bug to reproduce, but there is still a before. Capture the surface **as it is
today**, using the same story tooling and the same scenes file you will run again at the end:

```bash
APP_URL="$APP_URL" EVIDENCE_PHASE=before npm run evidence:collect -- "$TICKET" \
  scripts/collect-evidence/$TICKET.mjs
```

Act 2 scenes will fail on the before run, because the feature is not there yet — **that is
correct**. `expectVisible` records a failed check rather than throwing, so the before capture
comes out `fail`, which is exactly what `evidence:story` expects of a before half. A before
capture that passes everything means your scenes are not asserting the new behaviour.

If the feature has no visible surface at all (a service, a generator, a build gate), say so and
skip the capture — then the gate and its tests are your only evidence, and the summary must say
that plainly rather than implying a demo exists.

## Phase 3.5 — Design and layer placement _(overrides "choose the approach")_

The single most consequential decision in this repo, and the one with a written contract.

### Which layer does this belong in?

Ask before writing code. **Behaviour a manifest can express must not be hardcoded; behaviour
needing code must not be faked in configuration.**

| Layer | What it is                                                       | Ship vehicle         |
| ----- | ---------------------------------------------------------------- | -------------------- |
| 0     | Theme tokens, nav items, action visibility, presets, labels      | JSON + CSS, no build |
| 1     | Manifest references components, rules, actions, routes by **ID** | JSON, no build       |
| 2     | New components, actions, rules, guards in the customer's library | Their build          |
| 3     | Knowledge base, generators, guardrails that make Layer 2 cheap   | Ours                 |

**Anything a customer might plausibly want to change goes through Layer 0 or 1, not a hardcoded
value.** If you are adding a list of actions, a nav entry, a route or a theme value, it is
almost certainly Layer 0/1 work — use [`add-extension-point`](../add-extension-point/SKILL.md).

### Then the usual comparison

Enumerate at least two designs as `fix-bug` Phase 3.5 requires — where each lives, what it
costs, how it fails — and additionally, for each: **what public API surface it adds**, and
**what a customer would have to do to change it later**.

### Slice it

State the vertical slices and which PR each lands in. A slice is shippable on its own and
leaves `main` green: service method + its tests, then the component that consumes it, then the
manifest wiring. Not "all the services, then all the components" — that leaves dead code on
`main` for a week.

### Stop conditions — all of `fix-bug`'s, plus

- The feature cannot be placed in a layer, or spans Layer 2 and our own source.
- It needs a **new** public API on the platform package, or a new registered extension ID that
  is not obviously permanent — a registered ID is a published contract you cannot rename.
- It needs an adf-hx type in a public signature (stop: nothing imports adf-hx since its bridge was
  removed with the POC routes, NXSAT-635).
- It touches `install.xml`, marketplace packaging, or customer-facing config inside the packaged
  web directory — `install.xml` copies that with `overwrite="true"` and destroys it on upgrade.
- It would take more than a day and you cannot find slice boundaries.

## Phase 4 — Build, one slice at a time _(overrides "fix")_

> **Print the design decision and the slice list first**, so both are in the record before code.

- **Scaffold with the generators**, not by hand — `AGENTS/04-feature-scaffold.md` and
  `tools/satori-generators/`. A hand-rolled library is missing the `scope:`/`type:` tags, and
  **an untagged project cannot depend on anything**.
- Follow every convention `fix-bug` Phase 4 lists — `standalone: true`, `inject()`, `signal()`,
  `takeUntilDestroyed()`, `templateUrl`, blob-URL cleanup, no cross-feature imports.
- **Close each slice before opening the next**: its tests pass, `beta:gate --gates guardrails,lint`
  is green, nothing is left referencing something that does not exist yet.
- **No new hardcoded action lists, nav entries or theme values.** Route them through Layer 0/1.
- **adf-hx types must never appear in our public API** — nothing imports adf-hx since its bridge
  was removed with the POC routes (NXSAT-635); do not reintroduce it. If adf-hx is ever
  reintroduced, pin exact versions, never a range or a dist-tag.

### 4a — Demo capture _(overrides)_

Run the after half and the comparison exactly as `fix-bug` 4a does. The difference is what the
diptychs show: not a defect and its repair, but **absence and arrival**. Every acceptance
criterion from Phase 1 must be asserted by a scene.

### 4b — Tests _(overrides "regression test")_

- **Every new service method needs a unit test including its error path.** This is a Beta
  non-negotiable, not a preference.
- Component tests for the new behaviour, including empty, loading and error states — and check
  the loading signal resets on the error branch.
- Do not claim a test "failed before the change". It failed because the code did not exist.

## Phase 4.5 — Blast radius and API surface _(extends)_

Everything `fix-bug` 4.5 requires, plus two additions specific to adding rather than changing:

- **What did you add to the public API?** Run the `api-surface` gate and read its diff. Anything
  new there is a promise to customers.
- **What did you register?** New extension IDs go in `docs/extension-reference.md`. The
  `reference-drift` gate fails when the registry and the code disagree — do not discover that
  in CI.

## Phase 5c — Docs are deliverables, not a checklist _(adds)_

For a feature these are part of the work, in the same PR:

- `AGENTS/01-services.md` — every new service method with its signature.
- `docs/api-integrations.md` — every new Nuxeo endpoint.
- `docs/extension-reference.md` — every new registered ID.
- `AGENTS/00-architecture.md` — only if the architecture actually changed.
- `AGENTS.md` §2 — if you added a route or feature module.

A feature whose docs land in a follow-up PR is a feature nobody else can use yet.

## Phase 9 — Final summary _(overrides)_

`fix-bug`'s nine sections, with three swapped:

- **§3 Root cause** → **Design decision**: the layer, the alternatives rejected, and what a
  customer must do to change this later.
- **§4 Fix provided** → **What was built**: the slices, which PR each landed in, the new public
  API surface, and the new registered IDs.
- **§5 Steps to reproduce** → **How to try it**: the exact route, the permissions or data
  needed, and the manifest snippet if it is Layer 0/1 configurable.

Keep §7 (regression surface) exactly as it is. A feature's blast radius is usually larger than a
bug fix's, not smaller — new shared code reaches all eight feature modules.
