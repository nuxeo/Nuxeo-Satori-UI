---
title: Nuxeo Web UI Comparison
parent: Product
order: 6
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: product
---

# Nuxeo Satori vs. Nuxeo Web UI

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`

## A caveat that governs this whole page

**This repository contains Satori, not the Web UI.** Every claim about Satori below is
traceable to code at `77265f9`, except a claim that names a later ticket (such as NXSAT-312 or
NXSAT-317), which was checked against the code that ticket merged. Claims about the Web UI come from
[RFC §2](https://hyland.atlassian.net/wiki/spaces/~71202090f2a61ef96d4f57a5104efe296c1f5b/pages/4256993484)
and from the team's own six weeks of Web UI maintenance recorded in Confluence — they are
**second-hand here** and are marked where they are load-bearing.

Anything I could not ground is marked **Not verified**. Please correct rather than repeat.

---

## The short answer

> **Satori exists because the Web UI cannot be customised economically.**

RFC §2, verbatim:

> They either fight the aging Polymer stack of the existing Web UI, which is a customisation
> dead end, or go fully headless and rebuild everything. That costs deals and blocks
> expansion in strategic accounts.

Satori is not primarily a better-looking Web UI. It is a **customisation contract** with a
content UI attached. If a customer never customises, the case for switching is much weaker —
and that is worth saying to a prospect rather than hiding.

---

## Comparison matrix

| Dimension                               | Nuxeo Web UI                                         | Nuxeo Satori                                                                                                                                                                                                                                                                                    | Confidence                                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                             | The general-purpose Nuxeo UI, broad feature coverage | A deep **core slice**, built to be customised                                                                                                                                                                                                                                                   | Satori: verified                                                                                                                                                                                  |
| **Technology**                          | Polymer / Web Components                             | Angular 21, standalone components, signals                                                                                                                                                                                                                                                      | Satori: verified. Web UI: RFC §2                                                                                                                                                                  |
| **Target user**                         | Any Nuxeo user                                       | Enterprise customers needing a branded, extended UI                                                                                                                                                                                                                                             | RFC §2                                                                                                                                                                                            |
| **Feature breadth**                     | Broader — the mature product                         | Narrower by design: browse, tree, search, document detail, metadata, permissions, versions, upload, CRUD. **Workflow out of Beta scope**                                                                                                                                                        | Verified                                                                                                                                                                                          |
| **Customisation model**                 | Studio-driven + source modification                  | **Four layers**: config → manifest → customer library → agent harness                                                                                                                                                                                                                           | Verified                                                                                                                                                                                          |
| **Customisation without a rebuild**     | Limited                                              | **Layers 0 and 1 need no rebuild of the application**: the configuration package is zipped by a dependency-free script, installed, and applied when Nuxeo restarts (NXSAT-312)                                                                                                                  | Verified: `phase-1-config` 39 checks and `phase-2-registry` 46 checks (a swapped configuration response changes the app with a byte-identical bundle); package install by the NXSAT-312 rehearsal |
| **Does customisation survive upgrade?** | A known pain point                                   | **Yes, rehearsed** — customisation ships in the customer's own Marketplace package, and upgrading ours reinstalls it with byte-identical configuration (NXSAT-312); nothing is edited on the server. `beta:upgrade` separately rehearses the npm package upgrade, not the marketplace installer | Satori: verified. Web UI: **Not verified**                                                                                                                                                        |
| **Support boundary**                    | Blurs once source is modified                        | Customer code lives in **their** repo against a versioned API                                                                                                                                                                                                                                   | Verified in design; **no customer has exercised it**                                                                                                                                              |
| **Extensibility surface**               | —                                                    | **52 registered IDs**, drift-gated in both directions                                                                                                                                                                                                                                           | Verified                                                                                                                                                                                          |
| **Developer experience**                | Polymer, an ageing toolchain                         | Nx monorepo, TypeScript, 24 automated gates, generators                                                                                                                                                                                                                                         | Verified                                                                                                                                                                                          |
| **AI/agentic capability**               | None known                                           | 12 `AI.*` operations (**backend elsewhere**) + a dev harness + generators shipped to customers                                                                                                                                                                                                  | Verified, with the backend caveat                                                                                                                                                                 |
| **Accessibility**                       | **Not verified**                                     | Measured, **AA not met** — 4 rule classes ratcheted                                                                                                                                                                                                                                             | Satori: verified                                                                                                                                                                                  |
| **Maturity**                            | Production, years of customers                       | **Beta in progress. Zero customers.** Phases 0–5 done; Phase 6 at **5 of 7**, with steps 3 (WCAG) and 6 (coverage) open as of 2026-09-23                                                                                                                                                        | Verified                                                                                                                                                                                          |
| **Operational model**                   | Marketplace package                                  | Marketplace package — same install path                                                                                                                                                                                                                                                         | Verified                                                                                                                                                                                          |
| **Test coverage**                       | **Not verified**                                     | **10 of 11 in-scope projects ≥90%** as of 2026-09-22 (`shared-ai-client` short at 15.98%). Supersedes "3 of 15": `search` is now 93.41% and `document-detail` 92.56%; 12 E2E specs                                                                                                              | Verified                                                                                                                                                                                          |

---

## "Why would a customer use this instead of, alongside, or on top of the Web UI?"

The honest answer differs by case.

### Instead of — the strong case

A customer who wants a **branded, customised content experience** and is currently either
fighting Polymer or considering a headless rebuild. For them:

- Rebranding is a JSON + CSS-variable change in their configuration package, with no rebuild of
  the application (Layer 0).
- Adding, hiding, relabelling or reordering navigation and actions is a manifest edit in the same
  package (Layer 1).
- A genuinely new component is their own library against a versioned API — **their repo,
  their build, their support boundary** — instead of a fork of ours.
- Their customisation survives our upgrades, and that promise is tested by a gate rather
  than asserted in a document.

### Alongside — the realistic near-term case

Satori is a **deep core slice**, not the whole Web UI. Workflow is out of Beta scope; admin
and publishing are implemented but outside the quality bar. A customer with mature Web UI
workflows will most plausibly run Satori for the branded end-user content experience and keep
the Web UI for what Satori does not yet cover.

**This is the most likely Beta shape and should be planned for**, not treated as a failure
mode. Both install as marketplace packages against the same Nuxeo.

### On top of — not a supported pattern

There is no embedding, no shared shell and no cross-navigation between the two.
**Not verified in repository**, and nothing suggests it is intended.

---

## Where Satori is genuinely better

Each verifiable in this repository:

1. **Configuration survives upgrade — rehearsed on a real server.** It ships in the customer's
   own Marketplace package, which depends on ours, and our package installs no configuration
   file, with the reasoning recorded in `install.xml` (NXSAT-312). Two earlier designs, which kept
   a customer-edited file on the server, were wrong: `nxserver/web` is not a Tomcat docBase, so a
   file there is never served, and installing the file with `overwrite="false"` left **no version
   installed** when a customer had edited it (NXSAT-317).
2. **The customisation surface is a contract, and drift is detectable.**
   `npm run beta:reference` fails if a documented ID is unregistered **or** a registered ID
   is undocumented.
3. **The upgrade promise is tested.** `npm run beta:upgrade` installs, customises across
   Layers 0–2, bumps the version, reinstalls, and asserts the customisation survived —
   including that every slot the JSON manifest names still exists.
4. **Modern stack, modern tooling.** Angular 21 signals, Nx, 17 gates, real module
   boundaries.
5. **A customer's AI agent is a first-class user.** Generators and a runnable guardrail ship
   inside the package.

---

## Where the Web UI is better today

Stated plainly, because a comparison that finds no weaknesses is not credible.

1. **Breadth.** The Web UI is the mature product. Satori is a slice, and workflow is out of
   scope.
2. **Maturity and proof.** Years of production customers versus **zero**.
3. **Accessibility.** Satori has _measured_ itself and **meets WCAG 2.1 AA on the fifteen cases
   scanned** (2026-08-24). The Web UI's position is **Not verified**. This is now a strength
   rather than a weakness — but the honest form of the claim names its scope: dialogs, the upload
   flow, dark mode and the pre-auth login surface are not covered, and one remaining violation
   belongs to `@alfresco/adf-core`.
4. **Studio integration.** Nuxeo Studio's relationship to Satori is **Not verified in
   repository** — no Studio integration exists here. For a customer whose configuration lives
   in Studio, this is a material open question.
5. **Test coverage.** 10 of 11 in-scope Satori projects meet the 90% bar as of 2026-09-22; `shared-ai-client` is short at 15.98%. This read "3 of 15" before the Phase 6 coverage work.
6. **No AI backend in the box.** The 12 `AI.*` operations need a separate package.

---

## Questions to answer before positioning this externally

Each would change the pitch, and none can be settled from this repository.

| Question                                                           | Why it matters                                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do Layers 0 and 1 actually cover most real customer requests?      | The **central economic assumption**. The RFC and the plan both flag it as unvalidated. Test it against real requests from The Church and one other account |
| What is the Studio story?                                          | Studio is how many customers configure Nuxeo today                                                                                                         |
| Is running both UIs supported, and what does it cost the customer? | The most likely Beta shape                                                                                                                                 |
| What is the accessibility commitment and by when?                  | Some customers cannot buy without it                                                                                                                       |
| Who operates the AI backend, and what does it cost?                | Every AI feature depends on it                                                                                                                             |
| What is the migration path from a customised Web UI?               | **Not verified** — nothing in this repository addresses it                                                                                                 |

---

## One number worth carrying into any comparison conversation

The RFC's own retrospective on the POC that preceded this work:

> It was AI-built and produced roughly 18,400 lines quickly. It also produced seven
> code-level defects, eleven tests for 2,949 lines of bridge source, and a branch that had
> never been compiled by CI.

That is the _before_ picture. The 17 gates, the evidence harness and the adversarial review
process all exist because of it. When comparing developer experience, the relevant claim is
not "AI wrote it fast" — it is **"the verification apparatus is now strong enough that fast
authoring is safe"**, and that apparatus is the transferable asset.
