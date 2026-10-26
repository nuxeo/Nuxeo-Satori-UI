---
title: Roadmap Recommendations
parent: Executive / Leadership
order: 8
last_reviewed: 2026-10-08
repo_commit: 2898046
audience: leadership
---

# Roadmap Recommendations

> **Last reviewed:** 2026-10-08 · **Repository:** `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`)
> Only the repository links were re-verified at that commit: made relative rather than pinned to
> `feature/adf-hx-browse-poc`, every target present. The rest of the page as of 2026-08-24 · `77265f9`.
>
> **These are recommendations, not commitments, and not a plan of record.** The plan of record
> is [`docs/adf-hx-beta-plan.md`](../../docs/adf-hx-beta-plan.md).
> Sequencing here is derived from what the repository shows and what the RFC identifies as
> unresolved. No dates are given, because effort in this programme has never been measured and
> a date derived from an unmeasured baseline would be quoted as though it were real.

---

## The one-paragraph recommendation

**Stop adding platform surface and start validating demand.** The engineering is in good shape:
four customisation layers exist, are gated, and an upgrade rehearsal proves a customisation
survives a version bump. What does not exist is any evidence that the customisation surface we
built matches what customers ask for — and that single unknown determines whether the platform is
economically viable as designed. It is measurable in days. Everything else on this roadmap is
cheaper to decide once it is known.

---

## Now — before further platform investment

| #      | Recommendation                                                                                                                                                                                                                  | Why now                                                                                                                                               | Effort                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **N1** | **Validate the Layer 0/1 coverage assumption.** Ten real customisation requests from The Church + one other account. Attempt each using Layer 0/1 only. Record _why_ each failure fails — missing ID, reserved slot, needs code | The central economic assumption, RFC risk **R8**, unvalidated. The RFC's own mitigation was to do this _before Phase 2_; Phase 2 completed without it | Days                      |
| **N2** | **Secure a design partner**                                                                                                                                                                                                     | Zero customers is the root of nearly every unvalidated claim in the Product section                                                                   | Commercial                |
| **N3** | **Resource review separately from authoring**                                                                                                                                                                                   | Named by the RFC as the binding constraint, and confirmed here: every phase self-reported green while containing an overstated claim                  | Org change                |
| **N4** | **Resolve AI backend ownership, cost and roadmap**                                                                                                                                                                              | All 12 `AI.*` operations depend on a package we do not own here. Every AI product claim is gated on it                                                | Days, mostly conversation |
| **N5** | **Fix the coverage-reporting defect**                                                                                                                                                                                           | `tasks`, `assets`, `core` report 100% on zero tests. Leadership is reading an inflated number                                                         | Hours                     |

**N1 is the highest-value action available to this programme.** If it shows Layers 0/1 cover most
requests, the platform thesis is confirmed and the next investment is obvious. If it does not, we
should widen Layer 1 before Beta rather than discover the problem in an engagement.

---

## Next — finish the quality bar (Phase 6, steps 3–7)

Already planned; sequenced by what unblocks a customer conversation.

| #          | Recommendation                                                                                                                                | Unblocks                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~**X1**~~ | ~~**Meet WCAG 2.1 AA.**~~ **Done 2026-08-24** — 7 rule classes and 77 nodes fixed, `KNOWN_VIOLATIONS` empty, 15 cases scanned                 | Procurement blocker removed. The one remaining violation is `adf-core`'s (finding 1.2)                                                                               |
| ~~**X2**~~ | ~~**SAST + a real SCA gate.**~~ **Done** — but SAST already existed and was reporting 21 unread alerts, 6 high. Two gates now read the output | Two caveats kept: the suite is `default` not `security-and-quality` (a repo setting), and CodeQL would likely have found none of the nine defects human review found |
| **X3**     | **Coverage, worst-first** — `search` 22.8%, `document-detail` 29.8%                                                                           | The two highest-traffic surfaces are the least tested. Most of the phase's remaining effort                                                                          |
| **X4**     | **Safari/WebKit**                                                                                                                             | "Chrome and Safari verified" is in the Beta checklist                                                                                                                |
| ~~**X5**~~ | ~~**Remove the two unused production dependencies**~~ **Done 2026-08-24** — it was **four**: `openai`, `express`, `cors`, `dotenv`            | The last two were found by the new gate, not by the review that recorded the first two                                                                               |

---

## Before any customer goes live — the operational gap

**Not currently in any phase of the plan**, and the most under-recognised item on this page.

| #      | Recommendation                                      | Why                                                                                                                                                 |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O1** | **Error reporting + basic real-user monitoring**    | Today we would learn about an incident from the customer and could not diagnose it. There is no APM, structured logging, metrics or error reporting |
| **O2** | **Structured client logging with a correlation id** | Ties a user report to Nuxeo server logs                                                                                                             |
| **O3** | **A support runbook**                               | What config to collect; how to reproduce; how to tell our bug from theirs                                                                           |
| **O4** | **Rollback rehearsal**                              | The upgrade path is tested on every build; rollback is not tested at all                                                                            |
| **O5** | **Publish the package**                             | Scope and registry are decided; the runbook exists. Currently `private: true`                                                                       |

Items O1–O3 are the difference between "a Beta we can support" and "a Beta we hope nobody has
trouble with".

---

## Then — widen the platform, informed by N1

Deliberately after validation, not before.

| #      | Recommendation                                                                                                 | Depends on                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **W1** | **Make the 4 reserved slots real** — `toolbar`, `contextMenu`, `tabs`, `routes` need a host that resolves them | N1 should say which matter                                                                                               |
| **W2** | **Populate the `selection` rule context with documents**                                                       | Unblocks permission-gated bulk actions; two documented rules currently always answer `false`                             |
| **W3** | **Lazy adf-core**                                                                                              | Recovers ~1.15 MB of eager bundle. The ceiling note explicitly says do not raise the limit again without attempting this |
| **W4** | **Client-side caching for repeated reads**                                                                     | Damps Nuxeo load, improves perceived performance                                                                         |
| **W5** | **A Studio position**                                                                                          | Studio's relationship to Satori is **not verified in repository**, and it is how many customers configure Nuxeo today    |
| **W6** | **A Web UI migration story**                                                                                   | Nothing addresses it. Customers with a customised Web UI will ask first                                                  |

---

## Strategic options — worth a decision, not yet a plan

| #      | Option                                                  | Argument                                                                                                                                                                                                       | Counter-argument                                                                                    |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **S1** | **Productise the verification apparatus** beyond Satori | It answers the industry's live question — how to ship AI-written code safely — and is product-independent. Arguably more broadly valuable than Satori                                                          | It is currently a by-product, not a product. Packaging it is real work and a different go-to-market |
| **S2** | **Customer self-service Layer 0/1 UI**                  | ~~The manifest is already a Nuxeo document, so storage, versioning, audit and ACLs are solved.~~ Superseded by NXSAT-312: the manifest is now a fragment in the customer's package, so this needs re-assessing | Only worth it if N1 shows Layer 0/1 is where the demand is                                          |
| **S3** | **Extension marketplace**                               | Generators + a stable contract + a guardrail is the substrate                                                                                                                                                  | Needs publishing, a versioning policy and curation. Premature at zero customers                     |
| **S4** | **AI-assisted upgrade migration**                       | The rehearsal proves _whether_ a customisation survives; this would help when it does not                                                                                                                      | Speculative until customers have Layer 2 code to migrate                                            |
| **S5** | **Measure the AI leverage** we are claiming             | We assert AI-assisted benefits with no instrumentation. 111 commits of history could be reconciled against calendar time                                                                                       | Retrospective and imperfect — but it is the only baseline we will ever get for this phase           |

---

## What I would not do next

Stated because roadmaps are also about refusal.

| Do not                                          | Because                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Add more feature breadth to chase Web UI parity | The differentiator is the contract, not coverage. Breadth without validated extensibility is a worse Web UI |
| Publish the package before Phase 6              | Once customers depend on the API, it is permanent. `private: true` is doing real work                       |
| Widen Layer 1 before N1                         | We would be guessing at which IDs matter, which is how the surface got 4 reserved slots                     |
| Increase autonomy without increasing review     | The POC is the control experiment: 18,400 lines fast, seven defects, eleven tests, never compiled by CI     |
| Present AI features externally as available     | They need a backend package that is not in this repository                                                  |

---

## Investment summary

| Investment                  | Cost                                    | Return                                       | Confidence                        |
| --------------------------- | --------------------------------------- | -------------------------------------------- | --------------------------------- |
| N1 — validate Layer 0/1     | **Days**                                | Determines platform viability                | **High** — it is a measurement    |
| N2 — design partner         | Commercial effort                       | Converts every "unvalidated" into evidence   | High                              |
| N3 — review capacity        | Ongoing headcount                       | Prevents the POC failure mode at scale       | High — already demonstrated       |
| X1–X5 — quality bar         | ~Phase 6 remainder, coverage dominating | Removes named blockers                       | High                              |
| O1–O3 — observability       | Small–medium                            | Makes the Beta supportable                   | **High, and currently unplanned** |
| W1–W6 — platform widening   | Medium each                             | More configuration, less code per engagement | **Conditional on N1**             |
| S1 — productise the harness | Medium–large                            | Potential new line, independent of Satori    | Speculative                       |

**If only three things happen: N1, N3, O1.** Validate the thesis, resource the constraint, and be
able to support the first customer.
