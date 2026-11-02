---
title: Customer Personas
parent: Product
order: 3
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: product
---

# Customer Personas

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
>
> **Provenance warning.** These personas are **inferred from the capabilities and guards in
> the repository**, not from customer research. No user interviews, analytics or validated
> segmentation exist in this repository. Treat them as a structured hypothesis to test, not
> as findings. Where a persona's need maps to a real guard or feature, that is cited.

---

## Why infer them at all?

Because the code makes assumptions about its users whether or not anyone wrote them down, and
those assumptions are worth surfacing. Three route guards, three fail-closed rules, a
power-user check and a `scope:customer` library all encode a view of who is on the other side.

---

## End users of the application

### 1. Knowledge Worker — "I need to find and work with content"

|                             |                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**                    | Browses, searches, opens documents, reads metadata, comments, uploads, organises into collections and favorites                                                                                             |
| **Needs**                   | Speed, findability, not to be taught a query language                                                                                                                                                       |
| **Evidence in code**        | The whole browse/search/document-detail slice. `recently-viewed`, `favorites`, `personal-space` routes exist specifically for this pattern                                                                  |
| **What would delight them** | `AI.NlToNxql` — natural-language search. **Backend absent**, so today they still need to think in filters                                                                                                   |
| **Blocked by**              | ~~WCAG 2.1 AA~~ — **met 2026-08-24** on the 15 cases scanned. `button-name` on the nav toggle, which affected screen-reader users on every screen, is fixed. Dialogs, upload and dark mode remain unscanned |

### 2. Content Contributor / Editor — "I need to get content in and keep it right"

|                      |                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**             | Creates and imports (single and bulk, with properties), edits metadata, manages versions and attachments, authors notes, publishes                                |
| **Needs**            | Bulk operations that do not fight them; confidence that a mistake is recoverable                                                                                  |
| **Evidence in code** | `document-import.service` is the single largest service at 1,054 lines. Trash with filters and restore. Bulk delete with confirmation                             |
| **Friction today**   | `search` at 22.8% and `document-detail` at 29.8% line coverage are the two surfaces this persona uses most — the least-tested code is in the highest-traffic path |

### 3. Repository Administrator — "I need to manage access and configuration"

|                                |                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**                       | Users and groups, vocabularies, audit browsing, cloud services, OAuth tokens, NXQL console, permissions                                               |
| **Needs**                      | To be sure the UI is not the security boundary                                                                                                        |
| **Evidence in code**           | `adminGuard`, `hasAdministrationAccess()`, and the three **fail-closed** rules. ~7.3k lines of administration surfaces                                |
| **Important for them to know** | **Hiding an action in a manifest is not a security control.** Nuxeo's server-side ACLs decide what is permitted; Layer 1 decides only what is offered |

---

## Customers of the platform

These are the personas the **product thesis** depends on, and the ones with zero validation.

### 4. Customer Developer — "I must deliver a branded, extended content UI"

|                                      |                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**                             | Forks the template, writes a Layer 2 extension library, registers IDs, references them from a manifest, builds their own marketplace package                                                                                                                                             |
| **Needs**                            | A stable public API; to not be on a fork of our source; upgrades that do not break their work                                                                                                                                                                                            |
| **Evidence in code**                 | `@nuxeo/satori-platform` with 4 entry points and 10 declared peers. `libs/extensions/acme-extensions` is the reference library they would copy. `apps/nuxeo-satori-template` is what they fork — deliberately shipping **no design system** so they add theirs rather than removing ours |
| **What is genuinely built for them** | 4 generators shipped inside the package; a 6-check guardrail for their own CI; `AGENTS.md` and the extension reference shipped as package assets; the upgrade rehearsal pattern                                                                                                          |
| **Unvalidated**                      | Whether the 52 registered IDs are the _right_ 52. RFC risk **R8**: "Too few addressable IDs in Layer 1 would cap customisation and push work into Layer 2, undermining the maintenance economics"                                                                                        |

### 5. Customer's AI Agent — "I am asked to add a feature to this fork"

Unusual as a persona, and deliberate. RFC §6.3 designs for it explicitly, and the repository
ships artifacts whose only consumer is an AI coding tool.

|                                         |                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Needs**                               | To know the architecture and public API without inferring them; correct scaffolding; a way to verify its own work before a human looks                                                                                                                                                                                                                          |
| **Evidence in code**                    | `libs/platform/AGENTS.md` (~180 lines of customer procedure, shipped in the tarball); the 4 generators; `check-extension-library.mjs`                                                                                                                                                                                                                           |
| **What the guardrail assumes about it** | That it will make specific mistakes: register under someone else's prefix, deep-import past an entry point, write a spec that asserts nothing, forget fail-closed on a gating rule, export a component from the barrel, or contribute a component that does not resolve. **Each of those six checks corresponds to a mistake actually made in this repository** |
| **The sharpest lesson**                 | Assert `false`, not `true`. An _unregistered_ rule ID also evaluates to `true`, so a test expecting `true` passes whether or not registration happened                                                                                                                                                                                                          |

### 6. Nuxeo Professional Services / Partner — "I implement this for accounts"

|                                                |                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does**                                       | Repeats implementations across customers; needs predictable effort                                                                                                                                    |
| **Needs**                                      | Configuration to cover most requests, so each engagement is not a development project                                                                                                                 |
| **Evidence in code**                           | The whole Layer 0/1 design. But — see [Customisation Effort](../10-leadership/04-customer-customisation-effort.md)                                                                                    |
| **Unvalidated, and it is the commercial crux** | That Layers 0 and 1 absorb _most_ requests. The RFC and the plan both flag this as needing validation. If it is wrong, every engagement becomes a Layer 2 project and the economics change materially |

---

## Internal personas

### 7. Satori Engineer

Needs: to not re-make a bug already made. Served by `AGENTS/08-bug-patterns.md` (413 lines),
the 17 gates and 13 skills. See [Getting Started](../30-engineering/01-getting-started.md).

### 8. Reviewer

The RFC identifies this as the **binding constraint** on delivery speed, not authoring:

> One engineer reviewing to a standard that catches the defect class found on the POC branch
> manages a few hundred lines a day, so authoring days saved reappear as a review queue.

Served by the two read-only review subagents and the adversarial-review requirement. But
those assist a human; they do not replace one.

---

## What to do about the gaps

| Gap                                            | Suggested action                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| No customer validation of any persona          | Interview The Church and one other account against the Layer 0/1 assumption specifically                  |
| The 52 IDs may be the wrong 52                 | Take 10 real customer requests and attempt each as Layer 0/1 only. Count how many fall through to Layer 2 |
| Accessibility blocks Knowledge Worker adoption | Phase 6 step 3 — fix the 4 ratcheted rule classes rather than continuing to ratchet them                  |
| Highest-traffic code is least tested           | Phase 6 step 6, worst-first: `search` 22.8%, `document-detail` 29.8%                                      |
