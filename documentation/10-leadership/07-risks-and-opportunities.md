---
title: Risks & Opportunities
parent: Executive / Leadership
order: 7
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Risks, Technical Debt & Opportunities

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
> Combines the RFC's risk register (R1–R10, rev. 6) with what the repository shows at this
> commit. Where the RFC's position has since changed, the current status is given.

---

## 1. Critical

### C1 · The central economic assumption is unvalidated

**Layers 0 and 1 are assumed to absorb most customer requests.** If they do not, every
engagement becomes a Layer 2 software project and the maintenance economics of the platform
change materially.

- RFC risk **R8**: _"Too few addressable IDs in Layer 1 would cap customisation and push work
  into Layer 2, undermining the maintenance economics."_
- The RFC's own mitigation was to _"fix the addressable surface explicitly before Phase 2
  begins, informed by real customer requests."_ **Phase 2 was signed off without that input.**
- Reinforcing evidence: **4 of 8 slots are reserved** (`routes`, `toolbar`, `contextMenu`,
  `tabs`) — read by nothing. The addressable surface is narrower than the slot list implies.

**Mitigation:** ten real requests, two accounts, attempt each as Layer 0/1 only, count
fall-through. Days of work. **Do it before further platform investment.**

### C2 · Zero customers

Nothing published, nothing installed externally, no customer has configured or extended it. Every
benefit claim in the product documentation is mechanical rather than observed.

**Mitigation:** a design partner, framed as the Beta ask.

### C3 · Accessibility — NOT MET as of 2026-11-23

**It was closed on 2026-08-24, reopened on 2026-09-23, and is not met as of 2026-11-23.**
`phase-6-a11y/2026-11-23T08-09-11`, captured on `main`, failed 15 of 35 checks. Fourteen were one
WCAG 2.5.3 (Label in Name, Level A) defect that failed on every screen. With the navigation rail
collapsed, the user-profile control showed only the signed-in user's avatar initials, while its
accessible name was the full display name, which did not contain them. A speech-input user who
said what they saw did not reach the control. The fifteenth was a 404 from the local environment,
not an accessibility finding. The September `button-name` failures do not reproduce.

**The defect was fixed the same day, and the risk stays open.** The control's accessible name now
starts with the initials it shows. The re-run, `phase-6-a11y/2026-11-23T18-53-44`, passes all 14
axe checks. Its one failure is the Health check, on 404s that are not accessibility findings. That clears the capture, not the risk: `docs/accessibility.md` records failures in states
the capture does not reach.

**Where it comes from:** the control's content is ours. The shell projects the avatar into the
upstream navigation component's profile button, which takes its accessible name from a label
that is hidden while the rail is collapsed. The initials arrived on 2026-10-26 (NXSAT-673). The
35/35 capture of 2026-10-22 predates them, and it ran on an axe-core release that does not run
this rule under the WCAG tags. The capture's install pinned no version, and the newer release it
resolved runs the rule. The capture is now pinned to that newer release, so the next verdict is
measured the same way.

What was true of the August capture: **WCAG 2.1 AA was met on the fifteen cases scanned.** Seven
rule classes and 77 nodes fixed, and `KNOWN_VIOLATIONS` empty, so that verdict was unconditional
rather than ratcheted.

The finding worth carrying forward is how the worst one arose. `button-name` (critical) fired on the
nav toggle on **every** screen because our own catalogue set the translation key to the
empty string — deliberately, to suppress a tooltip — and the component binds that one string to both the
tooltip and the accessible name. An empty accessible name is invisible unless you use a screen
reader, so it outlived every other kind of review.

**Residual risk, and it is real:** the 2026-11-23 capture makes 14 axe scans over 9 routes,
including view-mode and panel states. The August pass counted fifteen cases over eight routes.
**Dialogs, the upload flow, dark mode and the pre-auth login surface are not covered**. "AA met" is a claim about what was scanned, and an
accessibility-obligated customer will ask for exactly that scope.

**Mitigation:** Phase 6 step 3. Self-contained and demoable.

---

## 2. High

### H1 · Review capacity is the binding constraint

RFC **R10**: _"Autonomous delivery outpaces review capacity, so defects accumulate faster than
they are caught — the failure mode the POC branch already demonstrated at smaller scale."_

Empirically confirmed in this programme: after Phase 5, an independent review found **every
phase had self-reported green while containing at least one overstated claim**.

**Mitigation:** resource review separately from authoring; keep human gates on decisions that
are expensive to reverse — public API, action descriptor shape, anything touching
authentication, credentials or blob lifecycle.

### H2 · SAST and SCA — closed, and the finding is not the one we expected

**The premise was wrong.** Every document here said "No SAST". CodeQL **default setup** had been
configured since 2026-07-24, analysing every push with 87 JavaScript/TypeScript rules — and it was
reporting **21 open alerts, 6 of them high**.

Nobody saw them for two compounding reasons: default setup analyses the **pull-request** ref, so the
alerts sat under `refs/pull/145/head` while the obvious query — alerts for the repository — reports
on the default branch and returned zero; and nothing in the gate pipeline, the phase evidence or CI
ever asked. **The gap was never the tool. A tool ran, found real defects, and no process consumed
the output.**

That is the more uncomfortable finding, and it generalises: this programme's failure mode is not
missing instrumentation, it is instrumentation whose output nobody is obliged to read.

All 21 are fixed. All were in scripts and tooling, not the shipped application, and **fourteen came
from one function** — an HTML escaper that handled `&`, `<` and `>` but not the double quote, whose
output goes into double-quoted XML attributes. Two were in **gates**, where a regex that matches the
wrong thing is worse than one that fails.

What now exists:

| Layer           | Gate                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| Dependencies    | `supply-chain` — production `high`/`critical` fails; acceptances are dated and **expire** |
| Our code        | `code-scanning` — reads the CodeQL alerts, and fails if the ref was **never analysed**    |
| Repo invariants | `sanitizer-audit` check 5 — every `bypassSecurityTrustHtml` needs a sanitiser beside it   |

Current production audit: **1 low** (`quill` XSS via HTML export), accepted until 2026-11-30 because
every note-rendering path sanitises through DOMPurify — and, since 2026-09-11, on two enforcements
rather than one claim: `sanitizer-audit` check 5 for the render paths, and a test in
`note-editor.spec.ts` for the path that saves. The second was added because review found the
acceptance had cited check 5 for both, and check 5 structurally cannot see a function that sanitises
and returns a string rather than bypassing. Dev-inclusive is **9 high, 13 moderate**, all build-time only:
reported deliberately, not gated, because gating on a total no customer is exposed to would be
permanently red and therefore bypassed.

**Residual risk, three parts:**

- **`code-scanning` is not in CI.** Alerts are keyed to a ref and CodeQL runs in parallel with CI,
  so on a fresh push it would fail on the previous commit's alerts — including ones that push fixes.
  It runs in the phase gate instead. Wiring it in properly means waiting on the CodeQL check, and
  that is a deliberate CI change, not a side effect.
- **The query suite is `default`, not `security-and-quality`.** Raising it is a repository setting;
  an advanced workflow cannot coexist with default setup, so this is a decision for whoever owns
  that setting.
- **CodeQL would likely have found none of the nine defects adversarial review found.** Blob-URL
  lifecycles, unguarded subscriptions, an `<img [src]>` bypassing the HTTP interceptor — those are
  architectural and lifecycle defects, not taint flow. SAST closes a class of gap; it does not
  replace the review that has actually been finding things here.

### H3 · No production observability

No APM, structured logging, metrics export or error reporting. **We could not diagnose a
customer incident.** The cost of a production problem is currently unbounded because diagnosis
has no tooling.

---

## 3. Medium

| ID  | Risk                                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Coverage in the highest-traffic code** — largely closed | **10 of 11 in-scope projects ≥90%** as of 2026-09-22 (`shared-ai-client` short at 15.98%). Supersedes "3 of 15": `search` is now 93.41% and `document-detail` 92.56%, which were the two surfaces users touch most. What remains is `shared-ai-client`, and 6,137 in-scope lines imported by no test at all. Re-measured 2026-10-24 on Angular 21 (NXSAT-669), whose Vitest 4 counts statements by syntax rather than by line: 11 of 16 in-scope projects ≥90%, `document-detail` 88.03%, with no covered line lost ([record](../../docs/angular-21-migration.md#coverage)) |
| M2  | **Coverage numbers overstate**                            | `tasks`, `assets`, `core` report **100% with zero spec files** (0/0 statements). Any "N of 17 meet the bar" figure is inflated until fixed                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| M3  | **Knowledge-base decay**                                  | 13 `AGENTS/` files, ~3.1k lines. Exactly **one** has an automated staleness check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M4  | **Gates rot**                                             | Seven were found asserting less than they claimed. Gates are software                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M5  | **RFC and reality diverge**                               | RFC plans 5+ npm packages and 3 repositories; reality is 1 package and 1 monorepo. Both simplifications, but the RFC has not been revised                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M6  | **Two unused production dependencies**                    | `openai` and `express` are in `package.json` and imported nowhere. Dead weight in the shipped lockfile and an SCA surface                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M7  | **Anonymous auth behaviour**                              | With anonymous auth enabled server-side, the app signs unauthenticated visitors in as `Anonymous`. Correct behaviour, invisible from the UI, and it makes a class of auth test unobservable                                                                                                                                                                                                                                                                                                                                                                                 |
| M8  | **E2E does not run in PR CI**                             | Needs Docker Nuxeo plus a served app. A check that only runs when someone remembers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M9  | **Reserved slots read as capability**                     | 4 of 8. Easy to over-promise from the slot list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M10 | **`selection` rule context empty**                        | Permission-gated bulk actions are not manifest-gateable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 4. Low

| ID  | Risk                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | Node 20 pin — Node 22+ shadows jsdom's `localStorage` and breaks specs on correct code. Worked around in the gate                                                              |
| L2  | Evidence lives outside the repository (`~/Desktop/agentic-ui-evidence/`) — does not travel with a clone                                                                        |
| L3  | Knowledge concentration — the harness and its rationale sit with very few people. **This documentation set is the mitigation**                                                 |
| L4  | 29 pre-existing docs, several superseded and contradictory. Partly addressed by this set                                                                                       |
| L5  | `@nuxeo-satori` scope ownership (RFC **R9**) — **resolved**: `@nuxeo/satori-platform` on Nuxeo Nexus                                                                           |
| L6  | Angular 20 monorepo upgrade (RFC **R6**) — **resolved**, landed                                                                                                                |
| L7  | Package entitlement (RFC **R1**) — **resolved** by authenticated download                                                                                                      |
| L8  | Packaging (RFC **R7**) — the non-overwriting installer was rehearsed 2026-10-07 and **failed** (NXSAT-317); replaced by a sample-file installer, rehearsed via `nuxeoctl` only |

---

## 5. Technical debt register

| Debt                                         | Cost of carrying                                                   | Cost of fixing                                        |
| -------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Coverage gap in `search` / `document-detail` | Regressions in the highest-traffic paths                           | Large — the two biggest files in the repo, ~60pp each |
| 4 reserved extension slots                   | Over-promising; narrower surface than advertised                   | Medium — each needs a host that resolves it           |
| `selection` rule context                     | Two documented rules permanently `false`                           | Small–medium — needs a fetch per selected row         |
| Zero-statement 100% coverage artefact        | Inflated reporting                                                 | Small — treat a zero-statement report as unmeasured   |
| 12 unwatched `AGENTS/` files                 | Silent drift                                                       | Small per file — extend the staleness pattern         |
| ~~No SAST~~ **premise was wrong**            | CodeQL ran since 2026-07-24; 21 alerts unread, now fixed and gated | Done                                                  |
| Unused `openai` / `express`                  | Lockfile weight, audit surface                                     | Trivial — remove                                      |
| E2E absent from CI                           | Regressions reach `main`                                           | Medium — needs Nuxeo in CI                            |

---

## 6. Opportunities — recommendations, not capabilities

Explicitly labelled: **none of these exists today.**

### O1 · Validate then widen the addressable surface _(highest value)_

Turn C1 from a risk into a designed decision. Widening Layer 1 to cover the top request classes
directly increases the proportion of engagements that are configuration rather than code — which
is the entire economic thesis.

### O2 · Customer self-service configuration UI

The Layer 1 manifest is already a **Nuxeo document**. A UI over it would let a business user
reconfigure navigation and actions with versioning, audit and ACLs for free. The hard part —
storage, governance, merge semantics — is done.

> **Premise superseded by NXSAT-312.** The manifest is no longer a Nuxeo document: it is a fragment
> in the customer's Marketplace package. Merge semantics carry over, but storage and governance no
> longer come free, so this opportunity needs re-assessing.

### O3 · Productise the verification apparatus

The 17 gates, evidence assertions and adversarial review pattern are **product-independent** and
address the industry's live question: how do you ship AI-written code safely? Potentially more
broadly valuable than Satori itself, either internally across product lines or externally.

### O4 · Extension marketplace

Generators plus a stable contract plus a guardrail is the substrate for customers and partners
sharing extensions. Requires: publishing, versioning policy, and a curation model.

### O5 · AI-assisted upgrade migration

An agent that reads a release's changelog and adapts a customer's Layer 2 code. The upgrade
rehearsal already proves _whether_ a customisation survives; this would help when it does not.

### O6 · Ship the harness as a customer-facing accelerator

Already partly true — generators and the guardrail ship in the package. Making it an explicit,
supported product artifact with its own versioning is a differentiator no comparable product has.

### O7 · Automated support triage

Per-ticket evidence runners already exist (~20, `NXSAT-*`). Extending that into customer-facing
reproduction capture would cut support cost.

---

## 7. If you read one thing

Three actions dominate everything else on this page:

1. **Validate the Layer 0/1 assumption.** Ten requests, two accounts. Days of work. It
   determines whether the platform is economically viable as designed.
2. **Resource review separately from authoring.** Named as the binding constraint by the RFC and
   confirmed empirically here.
3. **Find a design partner.** Zero customers is the root of most of the unvalidated claims.

Everything else — accessibility, coverage, SAST, observability — is known, named, and has an
owner in Phase 6.
