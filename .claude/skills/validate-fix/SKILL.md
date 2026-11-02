---
name: validate-fix
description: >-
  Independent validation pass over a delivered Nuxeo-Satori-UI bug fix, before it is pushed or
  before QA sign-off — runs the static and runtime accessibility gates, checks the fix across
  Chromium and WebKit, audits user-facing strings and theming, exercises corner cases and the
  blast radius, and produces a Pass/Fail/Blocked verdict with evidence. Use when asked to
  validate or QA a fix, verify accessibility, check cross-browser behaviour, run the wider
  validation before a PR, or decide whether a fix is genuinely done. Runs after the fix-bug
  skill's gate (Phase 5b) and before the PR is opened.
---

# Validate a delivered fix — accessibility, browsers, breadth

This is the validation half of [`fix-bug`](../fix-bug/SKILL.md). That skill proves _the reported
bug is fixed_; this one asks _what the fix broke, and whether it meets the quality bar_. Run it
before pushing, because `.github/workflows/a11y.yml` fires on every push to `fix/**` — an
accessibility regression you did not check locally arrives as a red PR.

Run it **autonomously**, like `fix-bug`. It produces a verdict, not a conversation.

> **Validate independently of the fix.** Do not re-read the fix author's reasoning and agree with
> it. Run the checks, read the output, and report what you observed. If you _are_ the agent that
> wrote the fix, that is not disqualifying here — but weight the failing signals over your own
> expectation of what should have happened.

It assumes a `fix-bug` workspace already exists. Source it and work from there:

```bash
. ~/Desktop/Projects/agentic-ui-worktrees/$TICKET/env.sh
cd "$NX_WT"
export VALID="$EVID/../validation" && mkdir -p "$VALID"
```

Evidence goes to `~/Desktop/agentic-ui-evidence/<TICKET-ID>/validation/`, a sibling of `fix/`, so
all of a ticket's artifacts collect in one deletable folder.

## What this repo actually supports — read before inventing checks

A generic QA checklist will ask for four things here and three of them do not apply. **Do not
report on a capability that does not exist**; say it is not applicable and why.

| Concern       | Reality in `Nuxeo-Satori-UI`                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Accessibility | **Fully applicable.** Static gate + runtime axe gate, both at WCAG 2.1 AA with an empty known-violations list     |
| Browsers      | **Partly.** `chromium` and `webkit` are the registered Playwright projects. **No Firefox.** WebKit ≠ Safari       |
| i18n          | **Barely.** `@ngx-translate/core` is wired up but `apps/nuxeo-ui/public/i18n/en.json` has **3 keys** — one locale |
| RTL           | **Not supported.** No `dir="rtl"` anywhere in the codebase. There is nothing to regress and nothing to verify     |

The honest i18n check here is therefore not "translate into every locale" — it is **"did this fix
add a user-facing string that bypasses the translation layer"**, which is a real and growing debt
worth recording. The honest RTL line is "not applicable — the app has no RTL support", stated once.

## Phase 1 — Establish what you are validating

- The ticket's acceptance criteria from `fix-bug` Phase 1a, each marked `[from ticket]` or
  `[derived]`. If they were never written down, **stop** — there is nothing to validate against.
- The diff: `git diff origin/main...HEAD --stat` and the full patch. Note every file, and for each
  one what surface a user reaches it through.
- The before/after evidence in `$EVID/before/` and `$EVID/after/`.

## Phase 2 — Accessibility (the load-bearing check)

Two gates, and they catch different things. Run both.

### 2a — Static template scan

```bash
npm run a11y            # verdict against tools/a11y/baseline.json
npm run a11y -- --all   # verdict on every violation, baseline ignored
```

ESLint over `apps/**/*.html` and `libs/**/*.html`. Exit `0` clean, `1` violations outside the
baseline, `2` the scan could not run.

- **A new violation in a file you touched fails this validation.** Fix it in the same PR — an
  inaccessible fix is not a finished fix.
- **Never run `--update-baseline` to get green.** The baseline records pre-existing debt that
  nobody has scheduled; adding your own violation to it hides the one thing this gate exists to
  catch. Reducing the baseline is the point.
- Run `--all` too and report the total, so the debt stays visible even when the gate is green.

### 2b — Runtime axe scan

The static scan cannot see anything rendered — computed contrast, focus order, ARIA relationships
between components, dynamically-injected dialogs. The runtime gate can:

```bash
npm run beta:evidence -- phase-6-a11y
```

`scripts/beta-harness/steps/phase-6-a11y.mjs` drives fifteen surfaces with axe at WCAG 2.1 AA. Its
`KNOWN_VIOLATIONS` list is **empty** and its verdict is unconditional, so any violation fails it.

- There is exactly one exclusion: `aria-required-children` on the adf-hx POC surface, which is
  upstream's defect in `@alfresco/adf-core` (finding 1.2 of `docs/adf-hx-upstream-findings.md`).
  It is scoped to a single step on purpose. **Do not widen it**, and do not add a second exclusion
  to get green — that is a stop-and-report, not a fix.
- If your fix added a new surface or dialog, the existing steps will not visit it. Add a step, or
  state plainly in the report that the new surface is unscanned. An unscanned surface reported as
  "a11y clean" is exactly the under-sampling failure this harness was rewritten to remove.
- Neither axe nor Playwright is a tracked dependency. If the harness reports them missing,
  bootstrap with `--no-save` as `fix-bug` Phase 2 does.

### 2c — The things the tools cannot check

Run these by hand on the changed surface and report each explicitly:

- **Keyboard only.** Tab to every new control, activate it with Enter/Space, and Escape out of any
  dialog. Nothing reachable by mouse may be unreachable by keyboard.
- **Visible focus.** Every focused control has a visible indicator — not removed by a new style.
- **Focus management.** A new dialog takes focus on open and returns it to the trigger on close.
- **Screen-reader naming.** Every new icon-only button has an accessible name.

Screenshot the keyboard-focus states into `$VALID/a11y/`.

## Phase 3 — Cross-browser

```bash
npx nx e2e nuxeo-ui-e2e                              # both projects
npx nx e2e nuxeo-ui-e2e -- --project=webkit          # one
```

- **Chromium and WebKit only.** Report it that way. WebKit is the engine Safari ships, so it is
  the closest verifiable proxy — it is **not Safari**, and does not carry Safari's UI, its
  extensions, or iOS's stricter storage rules. Do not write "Safari verified".
- **Firefox is not registered.** If the fix touches anything engine-sensitive — CSS layout, date
  parsing, `Intl`, blob handling, clipboard, file download — say Firefox is unverified rather than
  implying full coverage.
- If the fix is visual, capture the changed surface in both engines and put them side by side in
  `$VALID/browsers/`. Blob URLs and download behaviour are the usual place the two diverge.

## Phase 4 — Strings, theming and conventions

- **User-facing strings.** Any string the fix added that a user reads should go through the
  translate layer, not be hardcoded in a template. With 16 translated entries against a UI of
  this size the existing bar is low — so record what the fix did either way, and flag new
  hardcoded strings as debt rather than silently matching the surrounding code.
- **Theming.** New colours must be `--mat-sys-*` / `--kd-*` tokens. `npm run review:guardrails`
  enforces this; confirm it is green and eyeball the surface in the app.
- **Empty, loading and error states.** Every one the fix touches: does the loading signal reset on
  the error path? That is a catalogued bug pattern (`AGENTS/08-bug-patterns.md`).
- **Lifecycle.** Every new subscription uses `takeUntilDestroyed()`; every new
  `URL.createObjectURL()` is revoked in `ngOnDestroy`. Read the diff for these rather than
  trusting the guardrail alone — it is a text scan.

## Phase 5 — Corner cases and blast radius

`fix-bug` Phase 4.5 listed the consumers. This phase **exercises** them rather than listing them.

1. **Run each consumer's tests**, including any `nx affected` missed.
2. **Drive the adjacent behaviours** on the changed surface — pagination, sorting, filtering,
   selection, counts, permissions and read-only variants.
3. **Try the edges** — empty result set, exactly one item, a large set that pages, special
   characters and long strings in titles, a document the user cannot read.
4. **Re-run the fix's own before/after capture** to confirm it still passes after any change made
   during this validation.
5. Record what you exercised and what you did not. **A corner case you did not try is reported as
   untested, never as passing.**

## Phase 6 — Verdict

Write `$VALID/REPORT.md` and print it. It must open with one of three verdicts:

- **PASS** — every acceptance criterion verified, both a11y gates green, both browsers green, no
  new debt introduced. Anything untested is listed and argued as out of scope.
- **FAIL** — a criterion unmet, a new a11y violation, a broken consumer, or a regression.
- **BLOCKED** — the validation could not run: no acceptance criteria, no reproduction, an
  environment or tooling failure. Say what is needed to unblock.

Then, in this order: acceptance criteria with how each was verified; accessibility (static
verdict, runtime verdict, the manual keyboard checks, and the baseline total); browsers (which
engines, and explicitly which were not); strings/theming/conventions; corner cases and blast
radius, split into exercised and untested; **new debt introduced**, if any; and the evidence paths.

Be specific about coverage limits. "Firefox unverified — not a registered Playwright project" and
"the new export dialog is outside the phase-6 a11y scan" are more useful than a green tick, and
they are the difference between a report QA can act on and one they have to redo.

## Guardrails

- Never `--update-baseline` on the a11y scan to get green, and never widen the single
  `aria-required-children` exclusion.
- Never skip, `.only` or weaken an e2e test to get a green run.
- Never report a check as passing when you did not run it, or a browser as verified when its
  project is not registered.
- Never claim "Safari verified" from a WebKit run.
- Never disturb the shared `nuxeo` containers or another ticket's workspace.
- A validation that finds nothing is a suspicious validation. If everything passed first time,
  say what you tried that _could_ have failed.
