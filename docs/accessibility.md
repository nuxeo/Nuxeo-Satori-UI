# Accessibility — the standard

**This page is the source of truth for how accessibility is measured in this repository.**
What belongs here is the contract: which tool's answer counts for what, and what "accessibility
is green" means. Two companion pages carry the detail — `a11y/docs/a11y-scout.md` for what
a11y-scout is and how to install it, and `a11y/docs/authoring.md` for how to point Playwright
at this app and write a check that finds something new.

It exists because three scanners had accumulated with overlapping remits, two incompatible
suppression mechanisms, and no single definition of green. Two of them ran axe against the
same surfaces and disagreed about the result — see
[The disagreement](#the-disagreement--resolved-2026-09-11-against-phase-6) — and there was no
rule saying whose answer won.

---

## The rule

> **Every accessibility concern has exactly one owning layer. No layer's verdict overlaps
> another's.**

Everything below follows from that one sentence. Tools may _observe_ anything they like —
overlap in observation is a useful cross-check. What may not overlap is the **verdict**: the
thing that turns a run red and the number anyone quotes.

## The four layers

| Layer                | Command                                                                                                                                                                                 | Owns the verdict for                                                | Cost                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| **Static templates** | `npm run a11y`                                                                                                                                                                          | `@angular-eslint/template` rules over 89 `.html` files              | seconds                                     |
| **axe at runtime**   | `npm run beta:evidence -- phase-6-a11y`                                                                                                                                                 | **WCAG 2.1 AA conformance** — the number we publish                 | minutes (not measured)                      |
| **a11y-scout**       | `npm run a11y:scan -- surfaces` (routes), `npm run a11y:scan -- states` (interaction states), `npm run a11y:scan -- modes` (display modes), `npm run a11y:scan -- journey` (per-screen) | Keyboard traps, focus order, focus visibility, reflow, AI semantics | 26.8, 25.3, 19.5 and 70.3 min, all measured |
| **Manual**           | —                                                                                                                                                                                       | Everything automation cannot decide                                 | per release                                 |

### Why axe is owned by `phase-6-a11y.mjs` and not by a11y-scout

Both run axe, so one of them had to give it up. phase-6 keeps it for three reasons:

1. **It was driven to zero, and is one fix from zero again.** Seven rule classes and 77
   violating nodes were cleared to empty `KNOWN_VIOLATIONS` and make the verdict
   unconditional. That zero has since gone stale — two `color-contrast` nodes on `/#/tasks`
   still fail under phase-6's own tags as of 2026-09-30; see
   [The disagreement](#the-disagreement--resolved-2026-09-11-against-phase-6). The remedy is
   to fix those and re-measure phase-6, not to move the verdict to a scanner with 22
   untriaged axe findings.
2. **It depends on a public package.** `@axe-core/playwright` is on the public registry.
   a11y-scout is distributed as hand-passed tarballs that no registry can serve. A
   customer-shippable product should not have its conformance claim depend on a file
   somebody downloaded from SharePoint.
3. **It is fast enough to gate a phase.** axe is injected into the page and runs one pass per
   surface; a11y-scout drives up to 150 real key presses per direction per surface from
   outside the browser, each one a round trip against a page running Angular change
   detection. That is a structural difference, not a tuning one — the a11y-scout run is a
   measured 26.8 minutes and will not come down materially.

a11y-scout keeps everything axe is structurally incapable of measuring, which is the majority
of what it finds.

## The ownership boundary is mechanical, not a convention

a11y-scout stamps every finding with a `source` field. In the first full baseline:

| `source`   | Findings | Rules                                                                      |
| ---------- | -------- | -------------------------------------------------------------------------- |
| `keyboard` | 59       | `focus-offscreen` 45, `focus-obscured-min` 13, `focus-indicator-missing` 1 |
| `axe`      | 22       | `color-contrast` 8, `label-content-name-mismatch` 4, and six others        |

So the boundary is expressed as a filter rather than a naming discipline someone has to
remember. **This is the contract, not yet the implementation:**

> **Intended:** a11y-scout's verdict considers findings where `source !== 'axe'`. Its axe
> findings are recorded as an informational cross-check and never fail a run.
>
> **Today:** no such filter exists. a11y-scout reports all findings equally, and the split is
> maintained by reading the `source` field when interpreting a report. Tracked as gap 2 below.

That distinction matters because the whole point of this page is that a documented boundary is
not an enforced one. Nothing currently fails a run either way — `failOnBlockers` is `false`
everywhere — so the gap costs nothing yet; it will the moment anything here gates.

A cross-check that disagrees with the owner is a **bug to investigate, not a number to
publish**. Triage it against phase-6; if phase-6 is wrong, fix phase-6 — do not move the
verdict.

## Which layer owns which criteria

| Concern                                                                | Owner           | Why not the others                                                                                                 |
| ---------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Markup rules visible in template source                                | Static          | Free and pre-browser; catches it before a build exists                                                             |
| Colour contrast (1.4.3)                                                | axe runtime     | Needs rendered layout; static rules cannot see it by construction                                                  |
| Accessible names, roles, landmarks, table semantics                    | axe runtime     | Needs the composed DOM                                                                                             |
| Keyboard traps (2.1.2)                                                 | a11y-scout      | Requires a real `Tab`/`Shift+Tab`/`Escape` walk. phase-6 presses `Tab` **once** — reachability, not trap detection |
| Focus order and visibility (2.4.3 / 2.4.7 / 2.4.11 / 2.4.12)           | a11y-scout      | Out-of-browser geometry comparison; no in-page engine can do it                                                    |
| Reflow (1.4.10)                                                        | a11y-scout      | Narrow-viewport geometry                                                                                           |
| Content quality — meaningless `alt`, vague headings, generic link text | a11y-scout (AI) | Needs a real LLM; skipped in mock mode, so empty means _not measured_                                              |
| Screen-reader output, cognitive load, focus _appropriateness_          | Manual          | No tool decides these                                                                                              |

### Component specs are a declared cross-check, not a fifth layer

Vitest specs across the repository assert accessibility properties directly — nine in
`libs/shared/ui/src/lib/document-viewer/` alone, covering label-in-name, focus rings, label
contrast and frame titles. They are **not** in the table above and must not be read into it.
The split is:

- **The four layers own the verdict.** The WCAG 2.1 AA number this product publishes comes from
  the axe runtime layer and nowhere else. A component spec never contributes to it.
- **A component spec owns a code invariant** — that a named key is bound at a named site and
  resolves to real words. It runs without a browser, so it cannot judge conformance and does not
  claim to.

That is an overlap in _observation_, which this standard permits and which is kept here
deliberately, for a reason the `frame-title` case demonstrates: **the runtime layer cannot reach
the state the defect lives in.** The viewer's ARender frame renders only when
`integrations.arender` is in the served configuration. No CI run configures it, so axe has never
had the node to judge, and the frame went untitled through every green accessibility gate —
`frame-title` was enabled in both tag sets the whole time. "Extend the owner instead" was not
available: a check added to the phase-6 harness for that frame would never execute.

The rule this implies, and the one to apply to the next such spec: a component spec is
justified when the owning layer **structurally cannot** reach the state, and it must assert the
invariant rather than restate the conformance verdict. If the owning layer can reach it, extend
the owner.

## Baselines and suppression

Three mechanisms exist today. The standard is **one shape**, and it is the one
`tools/a11y/baseline.json` already uses:

```jsonc
{ "<scope>::<rule>": <count> }
```

Three properties make it the right shape, each of them learned the hard way and documented in
`scripts/a11y-scan.mjs`:

- **Keyed on scope, not line number.** Line numbers drift when a template is edited above the
  violation, failing the gate for an unrelated change.
- **Carries a count.** A bare identity key masks a _second_ violation of the same rule in the
  same file.
- **Stale entries are reported, never fatal.** Requiring the baseline to be updated in the
  same commit punishes the fix.

Two further rules apply to every layer:

- **An exclusion is scoped to one surface and cites an owner.** `phase-6-a11y.mjs` is the
  model: `ADF_HX_UPSTREAM` is applied to the adf-hx POC step alone and cites
  `docs/adf-hx-upstream-findings.md` §1.2. A global rule-id list silences that rule
  everywhere, including on surfaces we own — the file says so itself, and it is the reason
  `KNOWN_VIOLATIONS` must stay empty.
- **A new gate is not trusted until it has been seen to fail on purpose.** The static scan was
  negative-controlled before adoption: a second `click-events-have-key-events` in an
  already-baselined file and an `alt-text` violation in a clean one both turned it red while
  the six known violations stayed green.

## Cadence

| When                                                                                  | Run                                                            | Gating?                          |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- |
| Every PR and push to `main`/`feature/**`/`fix/**`                                     | Static templates, in CI                                        | **Yes**                          |
| Before a phase is signed off                                                          | axe runtime, locally                                           | **Yes** — conformance verdict    |
| After any change to navigation, focus management, dialogs or layout; before a release | a11y-scout routes (`a11y:scan -- surfaces`), locally           | Not yet — see below              |
| After any change to a dialog, overlay, tab group or view mode                         | a11y-scout interaction states (`a11y:scan -- states`), locally | Not yet — nothing triaged        |
| After any change to theming, motion or high-contrast handling                         | a11y-scout display modes (`a11y:scan -- modes`), locally       | Not yet — nothing triaged        |
| When one screen's accessibility needs handing to whoever owns it                      | a11y-scout journey (`a11y:scan -- journey`), locally           | No — reporting shape, not a gate |
| Per release                                                                           | Manual                                                         | Judgement                        |

**Nothing runtime runs in CI, and that is a stated limitation rather than an oversight.** Both
runtime layers need a live Nuxeo through the dev proxy; `backend-preflight.mjs` fails outright
if `/nuxeo/api/v1/me` does not answer 200, because an empty screen scans clean and proves
nothing. This repository has no compose file and no `packages.nuxeo.com` credentials, so a
runner cannot create that stack. `.github/workflows/a11y.yml` records the two things that
would change it: a self-hosted runner holding the `nuxeo` container, or registry credentials
plus a compose file.

This is also why a faster scanner does not unlock CI. **The blocker is the backend
requirement, not scan time.**

## What nothing covers

Stated explicitly, because "WCAG 2.1 AA met" is a claim whose scope is what makes it true.

- ~~**The login surface.**~~ **Closed 2026-09-16** by `journey.a11y.spec.ts`. The diagnosis
  recorded here was right — `httpCredentials` does make the app authenticate itself before the
  login page can render — but the conclusion that it therefore could not be scanned was wrong.
  Dropping `httpCredentials` on that one project and setting the app's `agentic_ui_signed_out`
  marker reaches the real form against a live backend. 12 findings, 2 blockers. This is not the
  same page `phase-0-no-backend` captured: that one is the form in its backend-unreachable
  error state.
- **The thirteen `MatDialog`s and the upload flow.** Narrowed on 2026-09-12 but not
  closed: `a11y/specs/interaction-states.a11y.spec.ts` now covers seven interaction
  states on `/#/browse` — the column-picker dialog, the `mat-select` and date-range CDK overlays,
  card view, and the Permissions, History and Trash tabs. What remains uncovered is every state
  opened through `MatDialog` (browse alone has thirteen `dialog.open` sites) and the upload
  flow. Dark mode used to be listed here too; it is covered by the display-modes suite below,
  which scans every route in the application's dark theme.
- **24 components with inline `template:` strings**, in violation of CLAUDE.md's "templateUrl
  always". Static rules reach `.html` files only.
- **`attr.`-prefixed literal attributes.** `attr.aria-label="…"` without binding brackets
  renders a DOM attribute literally named `attr.aria-label`, leaving the control unnamed. None
  of the eleven template rules catches it; verified against the one instance in this repo.
- **Screen-reader output.** No layer tests it.
- **The viewer's ARender annotation frame.** It renders only when `integrations.arender` is in
  the served configuration, which no CI run sets, so no runtime layer has ever scanned it. This
  is how it went untitled past `frame-title` in both tag sets; a component spec now asserts the
  title, but the frame itself remains unscanned by axe. The viewer's `pdf`, `pdfRendition` and
  `srcdoc` note frames are reachable in principle, but neither phase-6 visit targets them: one
  opens a Picture, the other any File with a main blob, so whether a `pdf` frame is ever scanned
  depends on what the test repository happens to hold rather than on anything the journey asserts.
- **Seven routes no runtime layer visits:** `/#/contracts`, `/#/search-adf-hx` and the five
  `/#/settings/*` pages (Nuxeo Drive, profile, authorized applications, cloud services, themes).
  Contracts was dropped from the journey on purpose — see "Fifteen screens" below.
- **Populated tasks and expired-queue screens.** The journey scans their empty states on a server
  with neither, and says so in its output; a task form or an expired card has never been scanned.
- **Horizontal scrolling inside a region at 320px.** Reflow checks the document's `scrollWidth`
  only, and overflow inside a scroll container never reaches it — search and trash results and
  the browse table wrapper all scroll inside their own box. See "Reflow measured the nav drawer"
  below.
- **The narrow layout as a user first sees it.** At 320px every route `reflow-probe.mjs`
  measured — six, on 2026-10-02 — opens behind the nav drawer with the screen 0px wide. The probe
  measures the screen only after closing the drawer; a11y-scout's reflow check does not close
  it. Card view, and the journey's screens other than those six, have never been measured at
  320px with the drawer closed.

## The disagreement — resolved 2026-09-11, against phase-6

The first a11y-scout baseline reported **8 `color-contrast`** and **2 `button-name`** findings
while `phase-6-a11y.mjs` recorded both rules as driven to zero. Two scripts settled it:
`a11y/diagnostics/axe-differential.mjs` and `a11y/diagnostics/route-render-check.mjs`.

**a11y-scout was right. phase-6's zero is stale.** Under phase-6's _own_ four-tag set, at its
own 1440×900 viewport, measured on 2026-09-11 and again on 2026-09-30:

| Surface            | Rule                     | Impact   | 11 Sep                                | 30 Sep                               |
| ------------------ | ------------------------ | -------- | ------------------------------------- | ------------------------------------ |
| `/#/browse`        | `button-name`            | critical | 2 — the document-tree expand toggles  | **0** — fixed by `NXSAT-227`         |
| `/#/tasks`         | `color-contrast`         | serious  | 2                                     | **2** — still open                   |
| `/#/browse-adf-hx` | `aria-required-children` | critical | 2 — the documented upstream exclusion | 2 — unchanged, legitimately excluded |

On 11 September that was **four blocking nodes** phase-6 claimed did not exist. Its table is
dated 2026-08-24; the claim was true when written and was never re-measured. `KNOWN_VIOLATIONS`
being empty is not evidence that there is nothing to know.

**Today it is two**, both `color-contrast` on `/#/tasks`. The 30 September column is a
measurement, not an inference from the browse journey figures: `axe-differential.mjs` with
`--surface browse --surface tasks` against that day's surfaces report found browse at zero under
both tag sets, and the two tasks nodes reproducing under both. Re-run it rather than trusting
either column.

### What the two hypotheses turned out to be worth

Both of the original guesses were wrong, and both were eliminated without launching a browser:

- **Different axe versions — no.** `npm ls axe-core --all` resolves a single deduped
  `axe-core@4.13.0` for `@axe-core/playwright` and `a11y-scout` alike. Identical engine.
- **Reflow resizing the viewport — no.** In `a11y-scout/src/agents/scan-page.ts` axe runs at
  line 121, reflow at 271 and the keyboard walk at 279, so axe runs before anything moves; and
  `reflow.ts` is explicitly "a pure geometric probe" that never calls `.analyze()`.

The real causes are **staleness**, above, and **tag width**. a11y-scout at AA adds `wcag22a`,
`wcag22aa` and `best-practice` to phase-6's four tags. Every `landmark-*` and
`empty-table-header` difference comes from those three tags alone and is not a disagreement at
all — it is a11y-scout casting a wider net, correctly, on rules phase-6 never asked for.

### Still open

**Six of a11y-scout's eight `color-contrast` findings did not reproduce** — five on `/#/browse`
(`#mat-input-0`, `#mat-input-1`, `.mat-start-date`, `.mat-end-date`, `.mat-mdc-select-min-line`)
and one on `/#/knowledge-discovery` (`mat-label`). Those are date-range and select controls, so
the likeliest explanation is that a11y-scout reached a state — a filter panel open, a control
focused — that a plain navigate-and-wait does not. It is not the engine and not the viewport;
both are ruled out above. Reproduce the state before treating these as either real or spurious.
The five on `/#/browse` still did not reproduce on 2026-09-30; `/#/knowledge-discovery` was not
re-checked, because that route currently renders its load-error state.

### Gap 5, confirmed the same day

`a11y/diagnostics/route-render-check.mjs` visits every route phase-6 scans and asserts its feature
host is visible. Eight of nine pass. **`/#/collections` renders no host and 111 characters of
main content**, against 153–3,760 for every other route — `collectionsRoutes` declares exactly
one path, `:uid`, so the bare path matches nothing. phase-6 has been scanning it with no
selector assertion and counting the empty result as a pass. Fix the route or drop it from the
scan; do not leave it reading as green.

That probe went red on the first run it ever made, which is the bar this repository sets before
a gate is trusted.

It checked presence and text only until 2026-10-01, when it passed `/#/knowledge-discovery` as
rendered — 670 characters — while the page showed nothing but "Failed to load Knowledge
Discovery agents" because `HylandKnowledgeDiscovery.getAllAgents` returned 500 on the local
server. A host showing its error panel now fails the route too, through the same
`ERROR_STATE_SELECTOR` the specs refuse to scan through, so while that 500 lasts the probe
reports seven of nine, not eight. The suites already refused it: that day the surfaces and
display-modes runs refused the route in every mode and then failed their every-route coverage
assertion, so neither counts as a complete measurement, and `reflow` marked it unmeasured and
exited 2. Interaction states and journey do not visit it.

### Reflow measured the nav drawer, not the screen — found 2026-10-02

The nav drawer is a `mode="side"` sidenav, 280px wide, that a deep link opens and nothing closes
at a narrow width. At 320×256 it fills the container and the feature host is laid out **0px
wide** — measured on all six routes `reflow-probe.mjs` reaches. A user lands on the drawer and
sees the screen only after clicking the active rail item to close it; the header's ☰ toggles
the rail, not the drawer.

So every `fits` the probe printed before that date measured the drawer, and its summary note
attributed the clipping to a "closed" drawer that was open. a11y-scout's reflow scanner
(`reflow.ts`) calls `setViewportSize` on the page the suite left it on, and the suites leave the
drawer open on these routes, so its reflow zeros there are very likely measurements of the same
state. That is inferred from the sequence, not observed inside an a11y-scout run.

The probe now records the collapse per route, closes the drawer the way a user would — asserting
it closed, the URL did not change and the host gained a width — and only then measures. With the
content visible all six routes still fit: `scrollWidth` 320, and the elements wider than that sit
inside the content's own containers — tab label strips and tab bodies (`overflow: hidden`), and
scroll containers (`overflow: auto`) such as `div.result-list` on search and trash and
`div.browse-table-wrapper` on browse. Overflow inside a scroll container never reaches the
document's `scrollWidth`, so neither this probe nor the scanner measures horizontal scrolling
inside a region; that is listed under "What nothing covers".

Whether a drawer that has to be closed before the screen is visible fails 1.4.10 is a judgement
this document does not make — the content does reflow once it is closed. It is an application
change, outside `a11y/`, and is recorded here rather than fixed.

One trap cost a run while closing it: the probe disables transitions before measuring, and
Material removes the content's 280px margin only when the drawer's close transition ends. With
transitions already off the drawer closed and the host stayed 0px wide, so the probe closes the
drawer first and freezes motion after.

## Interaction states — first scan 2026-09-12

`a11y/specs/interaction-states.a11y.spec.ts` (`npm run a11y:scan -- states`) drives seven
states on `/#/browse` and scans each. It found **71 findings in 25.3 minutes**, and six rule
classes that no previous scan of any layer had ever produced:

| Rule                    | Severity | Where                                        | Ours or upstream                        |
| ----------------------- | -------- | -------------------------------------------- | --------------------------------------- |
| `keyboard-trap`         | blocker  | `mat-datepicker-content`                     | Needs confirming against Material       |
| `modal-focus-leak`      | severe   | the column-picker panel                      | **Ours — confirmed in source**          |
| `heading-order`         | severe   | `.perm-section-title` on the Permissions tab | **Ours**                                |
| `aria-hidden-focus` ×2  | blocker  | `.cdk-focus-trap-anchor`                     | CDK's own anchors; likely upstream      |
| `aria-valid-attr-value` | blocker  | `#mat-select-0` `aria-controls`              | Panel is in an overlay; likely upstream |
| `region`                | severe   | `.cdk-overlay-container`                     | Upstream, structural                    |

`modal-focus-leak` is confirmed by reading the code rather than by trusting the scanner. The
column picker declares `role="dialog"` and `aria-modal="true"`, focuses itself on open and closes
on Escape, but implements **no focus trap** — there is no `cdkTrapFocus` in `browse.html` and no
`FocusTrapFactory` in `browse.ts`. `aria-modal="true"` tells assistive technology that everything
behind the dialog is inert while Tab walks straight out of it, so the attribute is actively
misleading rather than merely incomplete. `closeColumnPanel()` also does not restore focus to the
trigger, which is a second 2.4.3 defect in the same component.

Three of the six are plausibly upstream Angular Material or CDK. They are recorded, not
suppressed: a suppression needs a named owner and an upstream link, and nobody has established
those yet.

The counts for existing rules also rise sharply in these states — `color-contrast` 8 → 15 and
`focus-obscured-min` 13 → 27 — which is the general lesson rather than a detail. Roughly as many
findings again are reachable behind a single click as the entire route-level scan produced.

## Display modes — first scan 2026-09-12

`a11y/specs/display-modes.a11y.spec.ts` (`npm run a11y:scan -- modes`) renders the seven
routes in two modes no layer had ever set — the application's dark theme (seeded through
`data-app-theme`, not Playwright's `colorScheme`; see below) and `forcedColors` — and measures
one route change under `reducedMotion`. Neither `forcedColors` nor `reducedMotion` appeared in
any config or spec before this. **17 checks, 19.5 minutes, 81 findings.**

> Take the suite runtime from the runner's own wall clock, not from any `report.json`. Every
> `summary.durationMs` a11y-scout writes covers a **single scan**, never the suite — including
> the consolidated `nuxeo-satori-*` reports under `a11y/reports/` (`REPORT_DIR` in
> `a11y/fixtures.ts`) and the rolling `latest/` pointer beside them. On 2026-10-05 a
> re-measurement read 0.9 minutes from one while the suite took 12.4, and that gap is how this
> line once read "1.5 minutes".

| Mode                                  | Findings | Blockers | Notes                                              |
| ------------------------------------- | -------- | -------- | -------------------------------------------------- |
| Dark theme                            | 46       | 32       | Mostly `color-contrast`; `browse` alone has 14     |
| Forced colors (Windows High Contrast) | 35       | 21       | Nothing in the repo handles `forced-colors` at all |
| Reduced motion                        | —        | —        | Inconclusive by design; see below                  |

Two traps this file had to avoid, both of which would have produced a confident wrong answer.

**Dark mode here is not `prefers-color-scheme`.** `AppThemeService` sets a `data-app-theme`
attribute on `<html>` from the `agentic_ui_color_theme` localStorage key, and `styles.scss` keys
its palettes off that attribute. Playwright's `colorScheme: 'dark'` changes browser form-control
rendering and nothing else, so a scan using it would have covered the light theme under a dark
label. The spec seeds the storage key and then asserts both the attribute and a measured
background luminance below 0.2 before scanning.

**The motion result was wrong on its first run and the fix was identification, not more
sampling.** It initially reported "reduced motion is NOT honoured — longest 6665ms". Recording
each animation's target showed every one was `mdc-circular-progress__*`, Material's indeterminate
spinner: a looping CSS animation unrelated to any route change. **No finite animation was
observed in either run**, so there was no route transition to measure and the reduced-motion
verdict is **inconclusive**, not passing.

The reason there is nothing to measure is that this branch has **no route or drawer animations at
all** — no Angular animation trigger is bound in any template, so route changes are instant. The
probe is therefore reporting the truth about the code as it stands.

That makes this check a **tripwire rather than a result**. The moment anyone binds an animation
trigger, `measureRouteChangeMotion` will observe a finite animation and the run will say whether
`prefers-reduced-motion` is honoured. It reports an animation as unchanged — the preference
ignored — only when its effective duration, iterations, easing, direction and keyframes all match
the control's; a shorter one is reported as reduced, and one that differs in any other way as
inconclusive. Two things to get right when that happens, because an
earlier draft of the work got both wrong: durations must read `--app-motion-duration-*` or
`matchMedia` rather than being hardcoded, and a `prefers-reduced-motion` block in a stylesheet
cannot reach Angular animations at all, because they run through the Web Animations API.

One live motion observation remains: the spinners keep looping under `prefers-reduced-motion:
reduce`.

## Per-screen journey — first scan 2026-09-16

`a11y/specs/journey.a11y.spec.ts` (`npm run a11y:scan -- journey`) walks its screens in
the order a user meets them — four when this section was written, fifteen since 2026-10-01
(below) — and emits **one self-contained report per screen** rather than a
consolidated one. The other suites answer "which rules does the app fail"; this answers "how bad
is the screen I am about to hand to its owner". **15.1 minutes, 50 findings, 32 blockers** as
first measured on 2026-09-16. Document detail has since been re-measured at 17 and 15 after an
upstream fix (below); the other three rows are still the 16 September figures, so the totals
here are a snapshot rather than a current count.

| Screen          | Route          | Findings    | Blockers    | Rule classes                                                                                                             |
| --------------- | -------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Login           | `/#/login`     | 12          | 2           | `bypass`, `color-contrast`, `focus-indicator-missing`, `landmark-one-main`, `page-has-heading-one`, `region`             |
| Dashboard       | `/#/dashboard` | 3           | 1           | `color-contrast`, `focus-indicator-missing`, `heading-order`                                                             |
| Browse          | `/#/browse`    | 11          | 7           | `button-name`, `color-contrast`, `empty-table-header`, `focus-indicator-missing`, `focus-offscreen`, `th-has-data-cells` |
| Document detail | `/#/doc/:uid`  | 24 → **17** | 22 → **15** | `color-contrast`, `focus-indicator-missing`, `heading-order` — `button-name` fixed, see below                            |

Three of the four had never been scanned by anything. **Document detail is the worst screen in
the application measured so far** — 15 blockers at the 21 September re-measurement, all
`color-contrast`, and 14 in the fifteen-screen run below. Dashboard
matters for a different reason: `app.routes.ts` redirects `path: ''` to it, so it is the first
screen every signed-in user sees, and it was absent from `SURFACES`.

### Fifteen screens — extended and measured 2026-10-01 (current)

Eleven screens were added: the core flows a user moves through and the screens they work in.
`captureDataRequest()` waits for the screen's own data request and fails if it was never made or
did not return 2xx. Asserting an element alone would not do: the search page has an `error()`
signal no template renders, and the favorites and collections drawer panels have no error state
at all, so on those screens a failed load looks like an empty one. Where the drawer makes the
same request — identically on tasks and personal space, with a different page size or sort on
search, documents and trash — `captureEveryDataRequest()` requires every one of them to succeed.
Taking the first match there would let the drawer's success stand in for the page's failure, and
the drawers on search, documents and trash render their own failure as empty or fallback counts.
How much more each test then requires differs, and the spec's header lists it per screen:

- **The first entry the response returned is on screen** — search, documents, collection,
  favorites, recently viewed, trash, and the expired queue when it has entries.
- **The screen that follows from the response is shown** — tasks (the first task's form at its
  own URL, or the empty inbox), personal space (the redirect to the returned path) and
  administration, where only the request's success is evidence: the landing tab shows no
  repository data, and its path field starts at the value a stock server returns.
- **A named document is on screen, from a separate repository query** — document detail, and
  clipboard, whose one entry is seeded in the browser.
- **The screen rendered without an error state** — login, dashboard and browse.

| Screen          | Route scanned                        | Findings | Blockers | Rule classes                                                                                                                                                                                                                               |
| --------------- | ------------------------------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login           | `/#/login`                           | 3        | 2        | `color-contrast`, `focus-indicator-missing`                                                                                                                                                                                                |
| Dashboard       | `/#/dashboard`                       | 4        | 2        | `color-contrast`, `focus-indicator-missing`, `heading-order`                                                                                                                                                                               |
| Browse          | `/#/browse`                          | 8        | 5        | `color-contrast`, `focus-indicator-missing`, `focus-offscreen`, `th-has-data-cells`                                                                                                                                                        |
| Document detail | `/#/doc/:uid`                        | 16       | 14       | `color-contrast`, `focus-indicator-missing`, `heading-order`                                                                                                                                                                               |
| Search results  | `/#/search?quickFilters=noFolder&…`  | 57       | 10       | `focus-indicator-missing`, `focus-obscured-min`, `focus-offscreen`, `label-content-name-mismatch`                                                                                                                                          |
| Documents       | `/#/documents`                       | 37       | 6        | `button-name`, `color-contrast`, `content-quality-2.4.2`, `focus-indicator-missing`, `focus-obscured-min`, `focus-offscreen`, `label-content-name-mismatch`, `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique` |
| Collection      | `/#/collections/:uid`                | 2        | 1        | `color-contrast`, `focus-indicator-missing`                                                                                                                                                                                                |
| Favorites       | `/#/favorites` (drawer panel)        | 1        | 0        | `focus-indicator-missing`                                                                                                                                                                                                                  |
| Recently viewed | `/#/recently-viewed` (drawer panel)  | 14       | 13       | `color-contrast`, `focus-indicator-missing`                                                                                                                                                                                                |
| Personal space  | `/#/browse/<user workspace path>`    | 9        | 5        | `color-contrast`, `focus-indicator-missing`, `focus-offscreen`, `th-has-data-cells`                                                                                                                                                        |
| Clipboard       | `/#/clipboard` (drawer panel)        | 1        | 0        | `focus-indicator-missing`                                                                                                                                                                                                                  |
| Tasks           | `/#/tasks` — **empty state**         | 6        | 2        | `color-contrast`, `focus-indicator-missing`, `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique`                                                                                                                 |
| Expired queue   | `/#/expired-queue` — **empty state** | 1        | 0        | `focus-indicator-missing`                                                                                                                                                                                                                  |
| Trash           | `/#/trash`                           | 14       | 0        | `focus-indicator-missing`, `focus-offscreen`                                                                                                                                                                                               |
| Administration  | `/#/administration/analytics`        | 2        | 1        | `color-contrast`, `focus-indicator-missing`                                                                                                                                                                                                |
| **total**       |                                      | **175**  | **61**   |                                                                                                                                                                                                                                            |

**70.3 minutes**, one worker, every screen passing. The four original screens reproduced their
22 September figures exactly — 3/2, 4/2, 8/5 and 16/14 — which makes them the only counts in
this document observed twice against the same target nine days apart. Document detail is still
the worst screen by blockers; recently viewed, all 13 of its blockers `color-contrast`, is second and
had never been scanned. 56 of search's 57 findings are keyboard findings — 45 `focus-offscreen`
and all 10 blockers `focus-obscured-min`. Time does not track finding count: search took under a
minute, while recently viewed (10.9 min), browse (10.8), personal space and collection (8.1 each)
were the slowest, and collection reported two findings. Documents and tasks both report
`landmark-no-duplicate-main`: each feature template
declares its own `<main>` (`asset-search-results.component.html:85`,
`tasks-page.component.html:3`) on a page that already has one.

**Re-measured 2026-10-03, after the review fixes: 176 findings, 61 blockers, 69.2 minutes, all
fifteen passing.** Every screen reproduced its blockers and its non-AI findings exactly. The two
differences are both AI-judged `content-quality` findings, which vary between runs: search gained
one (`content-quality-2.4.2`, 58 in all), and documents' one AI finding was judged against 1.1.1
instead of 2.4.2. The table keeps the 1 October figures. A count that includes AI findings is not
reproducible to the finding, so compare runs on blockers and on the non-AI rules.

**What some rows actually measure:**

- **Tasks and expired queue are empty-state scans.** The local server has no open tasks and no
  expired documents, and the suite never writes server data to manufacture some. Each test reads
  its screen's own response. With entries it requires the populated screen (a task form, an
  expired card); with none it requires the real empty-state element and prints
  `state : EMPTY STATE scanned`, so the report cannot be read as covering the populated screen.
- **Favorites, recently viewed, clipboard and expired queue are drawer panels.** Their routes
  render a "Coming soon" placeholder in the main outlet; what a user works in is the drawer panel
  the deep link opens. The scan covers the whole page, placeholder included. Clipboard is seeded
  by writing one entry to the app's own `nuxeo_clipboard` key in `localStorage` — client state,
  not a server write.
- **Personal space** redirects to `/browse` plus the user's workspace path, resolved through
  `User.GetUserWorkspace`; the test waits for that exact URL.
- **Administration** is the analytics page, which `fullAdministratorGuard` protects. A member of
  `powerusers` is redirected to users-and-groups, so the test asserts the analytics URL and fails
  rather than scanning a different page under the administration label.
- **The AI-judged criteria were measured on two screens only.** Content-quality returned 403 on
  thirteen. Search and documents logged no failure, and documents produced the first AI-judged
  finding in this document, `content-quality-2.4.2`. Search's zero, with calls completed and no
  failure line, is the one case `a11y/README.md` says may mean clean. Why the same key is refused
  on some pages and not others has not been investigated.

**Seen failing on purpose before being trusted**, on the trash screen because its helpers are
shared by every screen added here: the data request answered with a 500 failed in 3.9s naming the
status; a matcher the screen never satisfies failed after 30s with "the screen never made the
data request"; and requiring a title the response did not contain failed on the missing row. The
settle check was separately driven to fail by a visible loader in a drawer panel, a spinner
inside the host, an icon-to-image swap at a constant element count, a required tree that never
renders and an absent host — and to pass with the same loader hidden.

**Left out, and why.** Knowledge discovery was excluded from this extension by decision; the
surfaces and display-modes suites already scan `/#/knowledge-discovery`. `/#/contracts` was
dropped: it is a component showcase built on mock data (`Contract ABC-123.pdf`), reachable only by
URL or through a customer manifest's navbar entry, and its findings would belong to the shared
`@nuxeo-satori/platform/ui` dialogs it demonstrates rather than to a screen anyone owns. See
"What nothing covers".

### The whole journey re-measured 2026-09-22, and most of it is fixed

Re-run against `main` after the `NXSAT-227` accessible-name and login work landed. The
16 September column is the first measurement; the 22 September column is current:

| Screen          | Findings    | Blockers    |
| --------------- | ----------- | ----------- |
| Login           | 12 → **3**  | 2 → 2       |
| Dashboard       | 3 → **4**   | 1 → **2**   |
| Browse          | 11 → **8**  | 7 → **5**   |
| Document detail | 24 → **16** | 22 → **14** |
| **total**       | **50 → 31** | **32 → 23** |

Login lost four whole rule classes — `bypass`, `landmark-one-main`, `page-has-heading-one` and
`region` — so the sign-in page gained the document structure it had none of. Dashboard moved
the other way by one, which is the reminder that these numbers are a measurement and not a
ratchet: nothing gates them, so they can go up.

**These figures were produced with a live HAIP key and are still axe-plus-keyboard only.** Every
content-quality call returned 403 and all four screens reported `aiGenerated: 0`, so the eleven
AI-judged criteria remain unmeasured rather than clean. See `a11y/README.md`.

### Seven of those blockers were fixed first — re-measured 2026-09-21

The `button-name` findings on this screen were the nav drawer's folder-tree toggles: seven
buttons whose only content is a `mat-icon`, which Angular Material marks `aria-hidden`, leaving
them with no accessible name. `NXSAT-227` gave them names upstream, and a re-scan against the
same document confirms it — nothing else moved:

| Rule                      | 16 Sep | 21 Sep |
| ------------------------- | ------ | ------ |
| `button-name`             | 7      | **0**  |
| `color-contrast`          | 15     | 15     |
| `focus-indicator-missing` | 1      | 1      |
| `heading-order`           | 1      | 1      |
| **total**                 | **24** | **17** |

Worth recording as a closed loop rather than a footnote: this suite found a defect no static
rule or axe run had reported, the defect was fixed, and the same suite confirmed the fix. That
is the argument for the layer, made once with evidence.

**Browse's two `button-name` findings were the same two tree toggles.** Browse _was_
re-measured — the 22 September table above covers the whole journey and shows it at 11 → 8
findings and 7 → 5 blockers, and a two-blocker drop is what fixing those toggles would
produce. This paragraph previously said Browse had not been re-measured and that its row
still held the 16 September figures; that was written after the 21 September document-detail
re-scan and was left behind by the 22 September run. Flagged in review on PR #225.

The attribution is still weaker than document detail's. That screen has a rule-by-rule
before-and-after above; Browse has only the totals, so "those two toggles" is inference from
the size of the drop rather than a measured per-rule comparison.

### The run-to-run difference was a loading spinner masking a real defect

Two runs against the same uid, minutes apart, on unchanged code, disagreed:

| Rule                      | 08:32 | 08:39 |
| ------------------------- | ----- | ----- |
| `color-contrast`          | 15    | 15    |
| `button-name`             | 6     | **7** |
| `nested-interactive`      | **1** | —     |
| `target-size`             | **1** | —     |
| `focus-indicator-missing` | 1     | 1     |
| `heading-order`           | 1     | 1     |

All three differing findings were on one element — `.tree-node:nth-child(7) > .tree-toggle`, the
last folder to arrive in the nav drawer. `nav-drawer.component.html` explains it: while
`node.loading` is true the toggle contains `<mat-spinner aria-label="Loading">`; afterwards it
contains a `<mat-icon>`, which Angular Material marks `aria-hidden` by default.

**The loading spinner lends the button an accessible name it does not really have.** A scan that
catches the tree mid-load does not merely add two spurious findings — it _suppresses_ a genuine
`button-name` failure and reports six unnamed toggles where there are seven. The settled state is
the truthful one, and it is the worse one.

(Those seven have since been given real names upstream — see the re-measurement above. The
reasoning is kept because the _mechanism_ is general: any element whose loading state carries an
`aria-label` that its settled state drops will be under-reported by a scan arriving too early.)

`screenUnsettledReason()` in `a11y/surface.mjs` therefore waits for the screen to hold still for
1.5 seconds with no loader visible. On every poll it reads, across the nav drawer and the feature
host together, every visible spinner (Material's or the hand-written `hxp-spinner`), progress
indicator and text or skeleton loader listed in its `LOADING_SELECTOR`, plus the tree
node count, the `<img>` count and the element count; the window restarts whenever a loader is
visible or any count changes. (It first accepted a single repeated count, which proves only that
nothing arrived during one 300ms gap; then it checked the loaders once before polling the count,
so a child load starting afterwards — which changes no count — could run out the window mid-load.
It then watched the folder tree alone, and missed the drawer panels' own `.tree-loading` outside
`.folder-tree` and the thumbnails that replace icons after a list renders, a swap that changes
no element count, which is why `<img>` is counted separately.) It is a correctness fix, not a
flake suppression: waiting to make a number stable is worth nothing if the stable number is the
wrong one, and here the unstable number was the optimistic one.

The drawer is part of the shell, not of one route, so every suite waits on it through
`waitForScreenSettled()` in `a11y/fixtures.ts`, and `axe-differential`, `route-render-check`
and `reflow-probe` call the same function directly. Surfaces, display modes and journey call it
immediately before each scan, and display modes also before the route change each motion sample
measures. Interaction states calls it when it opens
`/#/browse` and again after card view and each of the three tabs open, because the tabs fetch
behind a spinner and the cards swap icons for thumbnails; its three overlays fetch nothing and
wait only for the state they open.
It began in
`journey` alone, and the diagnostics kept a fixed 1.2-second pause for longer still — which on
hash routes was the only wait they had, because a `goto` to another `/#/…` is a same-document
navigation and `networkidle` resolves at once. What it cannot see is a loading state carrying
none of those markers — on `/#/browse-adf-hx`, whatever upstream `hxp-document-tree` shows while
it loads, if it is not one of them — and that is only missed if it outlasts the quiet window
without the DOM changing.

**Verified reproducible afterwards:** two further runs against the same uid produced 24 findings
each, identical on rule _and_ selector, with all seven tree toggles reported. Two runs is not a
proof of determinism — it is the evidence available.

**Browse was checked for the same defect and does not have it.** Its run is byte-identical before
and after the fix, because the drawer shows only two expandable nodes at the browse root and they
settle before the document list this suite already waits for. Document detail expands the tree to
reveal the open document's location, which is why seven nodes were still arriving there. The
difference is in the data the screen requests, not in the two specs.

The wider caution stands: no other suite here has been run twice against the same target, so
whether their numbers are reproducible is unknown rather than established. Every count in this
document is a single observation unless it says otherwise. Anything that scans a browse-family
route while the drawer tree is loading is undercounting `button-name` by the same mechanism.

### Why one Playwright project per screen

The a11y-scout accumulator is worker-scoped and `finalizeAndEmit` does **not** clear `pageScans`
when it emits — it only flips `reportEmitted`. Four `generateReport()` calls in one worker would
emit login, then login+dashboard, then login+dashboard+browse: each labelled with one screen and
containing several. A project gets its own worker, so `a11y/playwright.config.ts` declares one
per screen. `emitScreenReport()` asserts `pagesScanned.length === 1`, and that assertion has been
**seen to fail on purpose** — scanning a second page in the login test produced
`Expected: 1, Received: 2`.

### The login screen is not reachable by simply omitting the session

The first run of this file failed with `Received string: "http://localhost:4200/#/dashboard"`,
and the reason generalises to any future unauthenticated test. With no stored session,
`runHydration()` falls through to `tryEstablishCookieSessionOnly()`, which GETs
`/nuxeo/api/v1/me`; the base config's `httpCredentials` answers that request's Basic auth
challenge automatically, so the app builds a session from the reply and `authGuard` allows the
dashboard. **"No session injected" is not "signed out" — the browser signs itself in.**

`journey-01-login` is therefore the only project that sets `httpCredentials: undefined`, and the
test also sets the app's own `agentic_ui_signed_out` marker so hydration short-circuits before it
probes the server. Both are setup; the `toHaveURL(/#\/login/)` assertion is what proves the form
is on screen, and it is the assertion that caught the problem.

Had that assertion not been there, the run would have emitted a report titled `journey-01-login`
containing dashboard findings — the same vacuous pass `phase-6-a11y.mjs` shipped when its "Login
surface" step actually scanned the dashboard.

## Decisions recorded

Recorded so they are not re-litigated. Overturning one requires evidence, not preference.

### IBM `equal-access` — evaluated 2026-09-10, **not adopted**

`accessibility-checker@4.0.34` is Apache-2.0, on the public registry, installs cleanly, runs on
Node 20 despite a `puppeteer@25.10.0` EBADENGINE warning, and scans a page in ~3.3 seconds. It
was rejected anyway:

- It is a **third axe-class engine**, and axe is already owned. Adding it would recreate the
  exact overlap this standard removes.
- **It has no keyboard-trap or reflow support**, so it does not fill the gap a11y-scout fills.
  It would be additive to the duplicated half and useless for the unique half.
- Its speed advantage **does not unlock CI**, for the reason given under [Cadence](#cadence).
- Costs: 69 MB of `node_modules` plus a **1.2 GB** Puppeteer browser cache, a `chromedriver
"*"` range that resolved to v148, a bundled `@ibm/telemetry-js`, a `js-yaml ^5.4.1`
  requirement against this repo's `5.2.3` override, and an engine fetched from a CDN at scan
  time.

Revisit if a11y-scout distribution stops being viable, or if a public-registry engine becomes a
hard requirement for the keyboard and focus checks.

## Conformance to this standard today

The standard is written; the code does not fully implement it yet. Gaps, in the order they
should be closed:

| #   | Gap                                                                                                  | Status                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | The axe disagreement                                                                                 | **Resolved** 2026-09-11 — a11y-scout was right, phase-6 was stale                                                             |
| 1a  | Blocking nodes phase-6 claims do not exist: `button-name` ×2 on browse, `color-contrast` ×2 on tasks | **Open, halved** — browse fixed by `NXSAT-227` (0 on 2026-09-30); tasks ×2 still real, so the published number is still wrong |
| 1b  | Six `color-contrast` findings that reproduce under neither harness; state-dependent                  | **Open** — reproduce the state before judging them                                                                            |
| 2   | a11y-scout's verdict does not filter `source !== 'axe'`; it reports every finding equally            | **Open**                                                                                                                      |
| 3   | Findings are untriaged (81 in the first baseline), so `failOnBlockers` is `false` everywhere         | **Open** — a gate red on its first run for untriaged reasons is one people learn to ignore                                    |
| 4   | a11y-scout has no baseline file; phase-6 uses a rule-id array rather than the keyed-count shape      | **Open**                                                                                                                      |
| 5   | phase-6 scans `/#/collections`, which renders nothing, without a selector assertion                  | **Confirmed** — probe written and red; the fix to phase-6 is still open                                                       |
| 6   | Ownership is documented but not enforced by anything executable                                      | **Partly closed** — `a11y/diagnostics/route-render-check.mjs` enforces the "a scan must have something to scan" half          |

Do not describe accessibility as standardised until rows 1a, 2 and 5 are closed. Rows 3 and 4
depend on triage and are expected to take longer.

## The verification scripts

Both are diagnostics rather than gates, both run in well under a minute, and both exist because
a claim about accessibility should be reproducible on demand rather than remembered from a run
three weeks ago.

| Script                                         | Answers                                                                                                                                                                                                                                                                                                                                 | Exit                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `node a11y/diagnostics/axe-differential.mjs`   | Runs the one shared axe engine under both harnesses' tag sets, back to back in the same page visit, so the tag list is the only variable. Compares against the newest `a11y/reports/nuxeo-satori-surfaces-*/report.json`, and exits 2 rather than comparing against an empty baseline or one that did not scan every requested surface. | 0 measured, 2 could not measure                                                     |
| `node a11y/diagnostics/route-render-check.mjs` | Does every route a scan visits actually render its feature host?                                                                                                                                                                                                                                                                        | 0 all rendered, 1 one rendered nothing or only its error state, 2 could not measure |

The differential resolves the newest **surfaces** report rather than `a11y/reports/latest/`,
which is a rolling pointer that every a11y-scout run overwrites — including `a11y:scan -- states`, whose
findings come from overlays on a single route. Pointing a per-route comparison at one of those
makes it report every interaction-state finding as "did not reproduce" and every route finding as
missing — a diff that looks alarming and means nothing. Override with `A11Y_SCOUT_REPORT` if you
need a specific run.

Neither is a build gate: a diagnostic that turns the build red is one people stop running. Their
exit codes still differ, and the table above is the reference. The axe differential treats its
findings as non-fatal and exits non-zero only when it could not measure. The route render check
exits **1** when a route renders nothing or only its error state, because that is its finding.
Both reserve **2** for
an incomplete measurement, because a scan that silently did not happen must never read as clean.

`a11y/README.md` covers the other two diagnostics in that folder — the reflow probe with its
negative control, and the error-class drift check that runs before every scan.

Both need `npm install --no-save @playwright/test@1.63.0 @axe-core/playwright@4.13.0` — **in one
command**, as `--no-save` prunes anything previously installed the same way — plus a live backend
and dev server. The versions are pinned because the findings recorded on this page are the output
of that specific axe engine; they live in one runtime source, `a11y/versions.mjs`, and
`a11y/run.mjs preflight` refuses to scan when what is installed does not match.

## Adding a check

1. **Identify the owning layer** from the table above. If two layers could host it, it belongs
   to the cheaper one.
2. **If it duplicates an existing check, do not add it.** Extend the owner instead.
3. **Negative-control it.** Introduce the defect deliberately, watch the check go red, then
   remove the defect. A check never observed to fail is not evidence.
4. **Scope any exclusion to one surface and cite its owner.** Never add a global rule id.
5. **Put the file where it belongs** — `a11y/docs/authoring.md` §0 has the layout and
   the three rules governing it. Not repeated here: this page owns the _ownership_ question,
   that page owns the _authoring_ question, and duplicating either is the same defect this
   standard exists to prevent.
6. **Update this page** if the ownership table changes.
