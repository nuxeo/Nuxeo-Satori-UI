---
title: Executive Overview
parent: Executive / Leadership
order: 1
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Executive Overview

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9` (111 commits ahead of `main`, draft PR #145)
> Sources: this repository, and
> [RFC: Nuxeo Satori Beta](https://hyland.atlassian.net/wiki/spaces/~71202090f2a61ef96d4f57a5104efe296c1f5b/pages/4256993484)
> rev. 6. Tickets **NXENG-619** under epic **NXENG-615**.

---

## What we built

A modern Angular content-management UI for Nuxeo — **and, more importantly, a versioned
contract that lets customers brand and extend it without touching our source.**

The screens are the visible part. The product is the contract.

## Why we built it

Enterprise Nuxeo customers have no modern, first-party way to build a custom, on-brand content
UI. They either fight the ageing Polymer stack of the existing Web UI — which the RFC calls a
customisation dead end — or go headless and rebuild everything.

> "That costs deals and blocks expansion in strategic accounts." — RFC §2

## The strategic bet, in one line

> **The extension contract is the product; AI agents are the accelerator.**

Customer customisation is governed by a documented, versioned API rather than by pointing an
AI agent at our source code. Agents then make _using_ that API dramatically cheaper — for us
and for customers. The alternative, letting agents edit our source per customer, destroys the
support boundary, the upgrade path and any certification claim.

---

## Where we are

|                           |                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Phases 0–5**            | Complete, each with evidence and a green 15-gate run                                                                             |
| **Phase 6** (quality bar) | In progress — **5 of 7 steps** as of 2026-09-23; steps 3 (WCAG) and 6 (coverage) open                                            |
| **Customers**             | **Zero.** Nothing has been published; nothing installed by anyone outside the team                                               |
| **Published**             | No. `private: true`. Scope decided (`@nuxeo/satori-platform`, Nuxeo Nexus); publishing deliberately deferred to final deployment |

### What is genuinely done

- A deep ECM slice on real `adf-hx` components — browse, tree, search, document detail,
  metadata, permissions, versions, upload, CRUD. ~104k lines.
- **All four customisation layers exist and are gated.** 52 addressable IDs, drift-checked in
  both directions.
- One publishable npm package, 4 entry points, verified installable and publishable.
- Generators and a runnable guardrail **shipped inside the package** for a customer's own AI
  agent.
- An upgrade rehearsal that proves a customer's Layer 0/1/2 customisation survives a version
  bump — the test the whole model depends on.

### What is not done, and matters

| Gap                                                                                                                                                                                                                                                                | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WCAG 2.1 AA — BACK IN QUESTION 2026-09-23.** Met on 15 scanned cases on 2026-08-24 (7 rule classes, 77 nodes fixed), but five consecutive `phase-6-a11y` captures from 2026-09-15 to 2026-09-16 fail 3 `button-name` checks (browse, browse cards, column panel) | **Do not quote as a closed procurement blocker until re-verified.** Undiagnosed; unverified rather than known false. The standing caveat also applies: one violation remains and it is `adf-core`'s, not ours                                                                                                                                                                                                                                                               |
| **10 of 11 in-scope projects meet the 90% coverage bar** as of 2026-09-22; `shared-ai-client` is short at 15.98%                                                                                                                                                   | Superseded "3 of 15": the Phase 6 coverage work took `search` 22.8% → 93.41% and `document-detail` 29.8% → 92.56%. Percentages of the measured subset — 6,137 in-scope lines are imported by no test at all. Re-measured 2026-10-24 on Angular 21 (NXSAT-669), whose Vitest 4 counts statements by syntax rather than by line: 11 of 16 in-scope projects ≥90%, `document-detail` 88.03%, with no covered line lost ([record](../../docs/angular-21-migration.md#coverage)) |
| **SAST was already running and nobody read it** — 21 alerts, 6 high, all now fixed                                                                                                                                                                                 | The tool was never the gap. Two new gates read the output; 4 unused production dependencies removed                                                                                                                                                                                                                                                                                                                                                                         |
| **No production observability** — no APM, structured logging or metrics                                                                                                                                                                                            | We could not diagnose a customer incident                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **4 of 8 extension slots are reserved** — nothing reads them                                                                                                                                                                                                       | Less addressable surface than the slot list implies (RFC risk R8)                                                                                                                                                                                                                                                                                                                                                                                                           |
| **The AI features need a separate backend package** not in this repository                                                                                                                                                                                         | "AI-powered" is not true out of the box                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **The central economic assumption is unvalidated**                                                                                                                                                                                                                 | See below. This is the most important item on the page                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## The one thing to be sceptical about

The business case assumes **Layers 0 and 1 absorb most customer requests** — i.e. most
customisation is configuration, not code. If that holds, each engagement is days of
configuration. If it does not, each engagement is a software project and the maintenance
economics change materially.

**This has never been tested.** Both the RFC and the plan of record flag it as needing
validation against real customer requests, and the RFC carries it as risk **R8**.

The test is cheap: take ten real requests from The Church and one other account, attempt each
using Layer 0/1 only, and count how many fall through to Layer 2. **It should be done before
further platform investment**, because it determines whether the addressable surface needs
widening before Beta.

---

## What it cost, and what the AI harness changed

The RFC's own estimate for the seven phases, by delivery mode:

| Mode                   | Estimate         |
| ---------------------- | ---------------- |
| Focused (conventional) | **105–157 days** |
| AI-assisted            | **64–97 days**   |
| Autonomous             | **39–66 days**   |

The RFC is unusually candid that the compression is **concentrated, not uniform**, and that
roughly 40% of remaining effort is where agents help: API ports (repetitive against a verified
contract), the test backlog (loopable against a coverage threshold), and i18n extraction
(mechanical).

Four things do not compress: CI and registry wall-clock; genuine discovery; **decisions**,
which are calendar time not engineering time; and **review capacity**, which becomes the
binding constraint.

> "One engineer reviewing to a standard that catches the defect class found on the POC branch
> manages a few hundred lines a day, so authoring days saved reappear as a review queue. This
> is why the realistic calendar figure is 3 to 4 months rather than 2 to 3."

**The governing conclusion:** _agents move cost from authoring to verification rather than
removing it._ Everything expensive in this repository — 17 gates, ~20k lines of harness
scripts, adversarial review before every sign-off — is that verification cost made systematic.

---

## Evidence that the discipline is load-bearing

An independent adversarial review after Phase 5 found that **every phase had self-reported
green and CI-green while containing at least one overstated or self-confirming claim.** It
found, in already-signed-off work:

- a published package that **could not be published at all**, for the whole of the phase whose
  central claim was "an upgrade is an npm version bump";
- 27 wrongly non-nullable public types;
- a module-boundary rule set to `error` that **had never been able to reject anything**, behind
  which four real violations had accumulated;
- nine security defects — blob-URL leaks, unguarded subscriptions, and one `<img [src]>`
  bypassing the HTTP interceptor entirely;
- **seven gates that asserted less than they claimed.**

All remediated, with each fix watched failing on purpose before being trusted. The relevant
executive read is not that quality was poor — it is that **AI-assisted delivery without this
apparatus would have shipped all of it**, and the POC that preceded this programme is the
control experiment: 18,400 lines fast, seven defects, eleven tests, never compiled by CI.

---

## What is required going forward

| Ask                                                                  | Why                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Validate the Layer 0/1 assumption** — 10 real requests, 2 accounts | Determines whether the platform is economically viable as designed. Cheapest, highest-value action available               |
| **Resource review separately from authoring**                        | The RFC identifies review as the binding constraint. Without it, autonomy reproduces the POC failure mode at higher volume |
| **Finish Phase 6** — accessibility, coverage, SAST, Safari           | Removes named procurement and assurance blockers                                                                           |
| **Decide the AI backend ownership and cost model**                   | Every AI feature depends on a package we do not own here                                                                   |
| **Find a design partner**                                            | Zero customers is the biggest single gap in every claim we make                                                            |
| **Add production observability**                                     | We currently could not diagnose a customer incident                                                                        |

---

## Strategic read

The differentiated asset is **not** that an AI built a UI quickly. It is that we now have a
**customisation contract with machine-checked guarantees** — configuration that survives
upgrades, a surface that cannot drift from its documentation, and an upgrade promise that is
tested rather than asserted. That is defensible, and it is what a customer buys.

The second asset is the **verification apparatus**, which is reusable across products and is
the credible answer to "how do you ship AI-written code safely".

The main risk is not technical. It is that we have built a platform for a customisation
pattern **we have not yet confirmed customers want in the shape we have built it.**

Continue to [Risks & Opportunities](07-risks-and-opportunities.md) ·
[Cost & TCO](03-cost-and-tco.md) · [Customisation Effort](04-customer-customisation-effort.md)
