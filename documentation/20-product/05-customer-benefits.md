---
title: Customer Benefits
parent: Product
order: 5
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: product
---

# Customer Benefits

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
>
> **The rule for this page:** a benefit is listed as _demonstrated_ only if something in the
> repository proves the mechanism works. Everything else is _plausible but unvalidated_, and
> said so. **No customer has used this product, so no benefit has been observed in the
> field** — and no percentage or time-saving figure appears here, because none has been
> measured.

---

## A. Demonstrated — the mechanism is proven in the repository

These are safe to state to a customer, with the caveat that they are proven _mechanically_,
not _commercially_.

| Benefit                                                                        | What is proven                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rebranding needs no code and no rebuild of the application**                 | Theme tokens, branding, languages load from `bootstrap` fragments before authentication and apply as CSS custom properties. A logo the configuration package contributes replaces the Satori word mark in the header and the lockup on the login page; the navigation-rail mark, the expanded rail's "Content Innovation Cloud" title and the favicon cannot be changed yet | `phase-1-config`, 39 checks; the logo by `bootstrap-config.spec.ts`, `app-config.service.spec.ts`, `app-shell-brand-logo.spec.ts` and `login-page.component.spec.ts` |
| **Reconfiguring the addressable surface needs no rebuild of the application**  | A manifest edit adds, hides, relabels and reorders nav entries and actions                                                                                                                                                                                                                                                                                                  | `phase-2-registry`, 46 checks                                                                                                                                        |
| **Configuration survives a product upgrade**                                   | Configuration, logo included, is the customer's own Marketplace package; ours installs no configuration file                                                                                                                                                                                                                                                                | Marketplace upgrade rehearsed with two customer packages installed (NXSAT-312)                                                                                       |
| **Customisation survives a version bump**                                      | 21 customer files byte-identical; the app still compiles; every manifest-named slot still exists                                                                                                                                                                                                                                                                            | `npm run beta:upgrade`, 8 assertions, with a negative control                                                                                                        |
| **Customer code stays in the customer's repository**                           | One publishable package, 4 entry points, 10 declared peers; the customer's library depends on it and nothing else of ours                                                                                                                                                                                                                                                   | `beta:fork`, `beta:publishable`                                                                                                                                      |
| **The customisation contract cannot drift silently**                           | 52 IDs documented and registered; the gate fails in **both** directions                                                                                                                                                                                                                                                                                                     | `npm run beta:reference`                                                                                                                                             |
| ~~**Configuration inherits Nuxeo's governance**~~ — **withdrawn by NXSAT-312** | The manifest is no longer a Nuxeo document. It is a fragment in the customer's package, versioned with that package and served anonymously, so it gets no repository versioning, audit trail or ACLs                                                                                                                                                                        | Design (NXSAT-312)                                                                                                                                                   |
| **Extension scaffolding is correct by default**                                | Generators produce registered, tested libraries — verified from the published tarball, not the source tree                                                                                                                                                                                                                                                                  | `phase-5-harness`, 27 checks                                                                                                                                         |
| **A customer's agent can verify its own conformance**                          | 5 checks, each corresponding to a real mistake, each probed                                                                                                                                                                                                                                                                                                                 | `beta:customer-guardrails`                                                                                                                                           |
| **Modern stack removes the Polymer dead end**                                  | Angular 21, standalone components, signals, Nx, real module boundaries                                                                                                                                                                                                                                                                                                      | The codebase                                                                                                                                                         |
| **UI visibility is not mistaken for security**                                 | 3 security-relevant rules fail **closed**; server-side ACLs remain the boundary                                                                                                                                                                                                                                                                                             | `extension-rules.ts`, and the fail-closed list                                                                                                                       |

---

## B. Plausible but unvalidated — do not state as fact

Each of these is the _intended_ benefit. None is measured, and the first is the one the
commercial case rests on.

| Claimed benefit                                            | Why it is unvalidated                                                                                                                          | How to validate it                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Most customer requests are satisfied by Layers 0 and 1** | The **central economic assumption**. Flagged as unvalidated in both the RFC and the plan. If false, every engagement becomes a Layer 2 project | Take 10 real requests from The Church and one other account; attempt each as Layer 0/1 only; count fall-through          |
| Reduced engineering dependency for customers               | Follows from the above. Untested                                                                                                               | Same exercise                                                                                                            |
| Faster customisation delivery                              | No before/after measurement exists for any customer                                                                                            | Instrument one PS engagement: hours by layer                                                                             |
| Lower total cost of ownership                              | No cost model with real inputs exists                                                                                                          | See [Cost & TCO](../10-leadership/03-cost-and-tco.md) — it provides the framework, deliberately without invented numbers |
| Reduced support burden                                     | Depends on the support boundary holding in practice, which needs a real customer on a real upgrade                                             | First customer upgrade                                                                                                   |
| Faster onboarding of customer developers                   | The knowledge base and generators exist and ship. No one outside this team has used them                                                       | Have a PS engineer build a customisation using only the published package                                                |
| "The 52 registered IDs are the right ones"                 | RFC risk **R8** explicitly: too few addressable IDs caps customisation and pushes work into Layer 2                                            | The 10-request exercise again                                                                                            |
| Improved consistency across customer implementations       | Plausible — generators enforce a shape. Unobserved                                                                                             | Two engagements, compared                                                                                                |

---

## C. Benefits that are currently blocked

Honest, and each has an owner in Phase 6 or a decision.

| Blocked benefit                               | Blocker                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where it is tracked                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Any AI-powered end-user capability            | The 12 `AI.*` operations need a **separate backend package**                                                                                                                                                                                                                                                                                                                                                                              | [Runtime AI Features](../30-engineering/10-runtime-ai-features.md)            |
| Accessibility compliance                      | **BACK IN QUESTION 2026-09-23.** Met on the 15 cases scanned on 2026-08-24 (7 rule classes, 77 nodes — including `button-name` on the nav toggle on **every** screen), but five consecutive `phase-6-a11y` captures from 2026-09-15 to 2026-09-16 fail 3 `button-name` checks (browse, browse cards, column panel). Dialogs, upload, dark mode and pre-auth login were never covered                                                      | **Step 3 reopened** — undiagnosed                                             |
| Install from a registry                       | `private: true`; publishing deliberately deferred                                                                                                                                                                                                                                                                                                                                                                                         | `docs/publishing-to-nuxeo-registry.md`                                        |
| Manifest-driven toolbar / context-menu / tabs | Those 3 slots plus `routes` are **reserved — nothing reads them**                                                                                                                                                                                                                                                                                                                                                                         | [Extensibility Contract](../30-engineering/07-extensibility-contract.md)      |
| Permission-gated bulk actions                 | The `selection` rule context carries ids, not documents                                                                                                                                                                                                                                                                                                                                                                                   | `docs/extension-reference.md`                                                 |
| Confidence from test coverage                 | **10 of 11 in-scope projects ≥90%** as of 2026-09-22; `shared-ai-client` short at 15.98%. Supersedes "3 of 15" — `search` and `document-detail` are now 93.41% and 92.56%. Re-measured 2026-10-24 on Angular 21 (NXSAT-669), whose Vitest 4 counts statements by syntax rather than by line: 11 of 16 in-scope projects ≥90%, `document-detail` 88.03%, with no covered line lost ([record](../../docs/angular-21-migration.md#coverage)) | Phase 6 step 6 — reopened                                                     |
| Security assurance                            | **SAST exists and this row was wrong.** CodeQL default setup had been running since 2026-07-24 reporting 21 unread alerts, 6 high — all now fixed, and two gates consume the output                                                                                                                                                                                                                                                       | Phase 6 step 4 — done                                                         |
| Production diagnosability                     | No APM, structured logging, metrics or error reporting                                                                                                                                                                                                                                                                                                                                                                                    | [Scalability & Operations](../10-leadership/06-scalability-and-operations.md) |

---

## D. The benefit that is real but rarely articulated

**The verification apparatus is itself an asset**, and it is transferable.

The programme's own history is the evidence, from RFC §7.1: the POC produced ~18,400 lines
quickly, and with them **seven code-level defects, eleven tests for 2,949 lines of bridge
source, and a branch never compiled by CI**.

What exists now instead: 17 gates, 10 commit-time guardrails, a falsifiability audit over 257
evidence assertions, two read-only review agents, and a requirement for adversarial review
before any phase is signed off. That apparatus found, in already-signed-off work:

- a published package that **could not be published at all**;
- 27 wrongly non-nullable public types;
- four cross-boundary imports the module-boundary rule had never been able to reject;
- nine security defects across blob-URL lifecycles, subscription teardown and one `<img [src]>`
  bypassing the HTTP interceptor;
- **seven gates that asserted less than they claimed**.

For a customer adopting an agentic workflow on their own fork, that pattern — not the speed —
is the reusable part. The RFC's conclusion is the honest sentence to use:

> **Agents move cost from authoring to verification rather than removing it.**

---

## E. How to talk about benefits externally

| Do                                                                                                       | Don't                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| "Rebranding is a configuration change, and we test that it survives upgrades"                            | "Customisation is free"                                 |
| "Customer code lives in your repository against a versioned API"                                         | "No development needed"                                 |
| "We measured accessibility, we meet AA on every surface we scanned, and here is exactly what we scanned" | Claim blanket compliance and hope nobody asks for scope |
| "The AI features require the AI backend package"                                                         | "AI-powered out of the box"                             |
| "Layers 0 and 1 are designed to cover most requests — we want to validate that against your backlog"     | "Most requests need no code"                            |
| "No customer has used this yet; we are looking for a design partner"                                     | Imply production adoption                               |

The last row is the most important. **Zero customers** is the single biggest gap in every
benefit claim on this page, and framing the Beta as a design-partner search converts that
weakness into the actual ask.
