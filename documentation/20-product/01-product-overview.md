---
title: Product Overview
parent: Product
order: 1
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: product
---

# Product Overview

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> The rest of the page as of 2026-08-24 · `77265f9`.
> Grounded in the repository and in
> [RFC: Nuxeo Satori Beta](https://hyland.atlassian.net/wiki/spaces/~71202090f2a61ef96d4f57a5104efe296c1f5b/pages/4256993484)
> (revision 6, 20 Aug 2026), tickets **NXENG-619** under epic **NXENG-615**.
> An earlier [Nuxeo Satori Beta — Product Overview](https://hyland.atlassian.net/wiki/spaces/~71202090f2a61ef96d4f57a5104efe296c1f5b/pages/4231594134)
> page exists; this supersedes it and should be read in preference.

---

## In one sentence

**Nuxeo Satori is a modern Angular content-management UI for Nuxeo that customers can brand,
reconfigure and extend through a documented, versioned contract — instead of forking and
maintaining our source.**

## In one paragraph

Enterprise Nuxeo customers have no modern, first-party way to build a custom, on-brand
content UI. They either fight the ageing Polymer stack of the existing Nuxeo Web UI, which
the RFC calls "a customisation dead end", or go fully headless and rebuild everything from
scratch. Satori is a deep core ECM slice — browse, folder tree, search, document detail,
metadata, permissions, versions, upload and CRUD — built on real `adf-hx` components and
delivered as a Nuxeo marketplace package. Its distinguishing feature is not the screens: it
is a **four-layer customisation contract** in which the first two layers need no code and no
rebuild, the third is the customer's own npm library against our published API, and the
fourth ships AI generators and guardrails so that writing the third is cheap.

## Executive summary

|                     |                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**      | A customer-brandable, extensible Angular content UI for Nuxeo, shipped as a marketplace package                                                                                                   |
| **Who it is for**   | Enterprise Nuxeo customers needing a custom content UI; Nuxeo Professional Services; partners                                                                                                     |
| **The problem**     | The existing Web UI cannot be customised economically. This "costs deals and blocks expansion in strategic accounts" (RFC §2)                                                                     |
| **The central bet** | _The extension contract is the product; AI agents are the accelerator._ Customisation is governed by a versioned API, not by pointing an agent at our source                                      |
| **Maturity**        | Phases 0–5 complete with evidence; Phase 6 (quality bar) in progress at **5 of 7** as of 2026-09-23 — steps 3 (WCAG) and 6 (coverage) open. **Not yet published, not yet in front of a customer** |
| **Distribution**    | One npm package (`@nuxeo/satori-platform`, 4 entry points) + a forkable app template + the marketplace package                                                                                    |
| **Runtime AI**      | 12 `AI.*` Nuxeo Automation operations. The backend implementing them is **a separate package, not in this repository**                                                                            |

---

## The problem, precisely

From RFC §2, and worth quoting because it is the commercial case:

> Enterprise Nuxeo customers have no modern, first-party way to build a custom, on-brand
> content UI. They either fight the aging Polymer stack of the existing Web UI, which is a
> customisation dead end, or go fully headless and rebuild everything. That costs deals and
> blocks expansion in strategic accounts.

And the honest statement of where the POC stood:

> The agentic UI POC demonstrates that a modern Angular Nuxeo UI is achievable. It is not,
> however, a product: it is a single-bundle application with no extension surface. This RFC
> addresses the gap between the two.

**That gap is what the Beta programme has been closing.** Everything distinctive about this
product follows from it.

---

## What a customer actually receives

| Artifact                                  | What they do with it                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The marketplace package**               | Install into Nuxeo. Gets the application and our configuration defaults; their own configuration is a package of theirs that depends on ours, which **no upgrade of ours touches** |
| **`@nuxeo/satori-platform`** (npm)        | Depend on it from their own extension library. 4 entry points, 10 declared peers, 347 kB                                                                                           |
| **The app template**                      | Fork it. Deliberately thin, and ships **no design system**, so they add their own rather than removing ours                                                                        |
| **The generators**                        | `npx nx g @nuxeo/satori-platform:extension-library …` — shipped inside the package                                                                                                 |
| **The guardrail script**                  | Run in their own CI, so an AI agent can verify its own output before a human reviews it                                                                                            |
| **`AGENTS.md` + the extension reference** | A knowledge base any AI coding tool can read, versioned as a product artifact                                                                                                      |

---

## The four layers — the core of the value proposition

| Layer                      | Customer writes                 | App rebuild? | Example                                                                                                              |
| -------------------------- | ------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| **0 — Configuration**      | JSON + CSS variables            | **No**       | Rebrand: colours, product name, header and sign-in logo, default language — not the rail mark, rail title or favicon |
| **1 — Declarative wiring** | JSON referencing registered IDs | **No**       | Hide the Reports nav entry; relabel Home to "Dashboard"; add a Contracts entry at position 35                        |
| **2 — Customer code**      | TypeScript in **their** repo    | Yes, theirs  | A contract-approval action visible only to users who can write the document                                          |
| **3 — Agent harness**      | Prompts                         | Yes, theirs  | The same request as a short agent session against a defined API                                                      |

For Layers 0 and 1 the only build is the customer's configuration package, zipped by a
dependency-free script (`npx nx build <package>`) and installed; the application is not rebuilt.

RFC §6.3 describes the intended Layer 3 experience:

> A request such as "add a contract approval action visible only to users who can write the
> document, and a tab showing approval history" becomes a short agent session against a
> defined API rather than an open-ended edit of our source.

### Why not just let an agent edit our source?

RFC §4.2 asks this directly, and the answer is the product thesis. If customisation means
an agent editing our code, then:

- every customer is on a fork, and every fork diverges;
- we cannot ship an upgrade without breaking someone;
- the support boundary disappears — their bug and our bug become the same ticket;
- certification claims become unmakeable.

A versioned contract keeps the boundary. **This is the whole reason the extension registry,
the API-surface gate and the upgrade rehearsal exist.**

---

## Current maturity — what is demonstrated, and what is not

### Demonstrated with evidence

| Capability                                                                          | Evidence                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A deep ECM slice works against real Nuxeo                                           | 9 feature libraries, ~53.6k lines; 12 E2E specs on browse, search, document detail and auth                                                                                                                |
| Configuration alone changes the app, with no rebuild of the application             | `phase-1-config` evidence, 39 checks: a swapped configuration response changes the app while the bundle stays byte-identical. Installing it as a package: NXSAT-312 rehearsal (`docs/demo-deck-claims.md`) |
| A manifest edit changes the addressable surface, with no rebuild of the application | `phase-2-registry` evidence, 46 checks, by the same swapped-response method                                                                                                                                |
| Real adf-hx components render against Nuxeo                                         | `phase-3-adf-hx` evidence, 55 checks; 12 API ports bound                                                                                                                                                   |
| The platform is an installable, publishable package                                 | `phase-4-platform`, 25 checks; `npm publish --dry-run` passes                                                                                                                                              |
| Generators produce **live** registrations                                           | `phase-5-harness`, 27 checks                                                                                                                                                                               |
| A Layer 0/1/2 customisation **survives an upgrade**                                 | `npm run beta:upgrade`, 8 assertions                                                                                                                                                                       |
| 52 addressable IDs, documented and drift-gated                                      | `npm run beta:reference`                                                                                                                                                                                   |

### Not demonstrated

| Gap                                    | Status                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A real customer has used it**        | Zero. No customer has installed, configured or extended it                                                 |
| **The Layers 0/1 coverage assumption** | RFC and plan both flag it as needing validation against real customer requests. **Not verified**           |
| **Published to a registry**            | `private: true`. Scope decided (`@nuxeo/satori-platform` on Nuxeo Nexus); publishing deliberately deferred |
| **WCAG 2.1 AA**                        | **Met** on 15 scanned cases (2026-08-24). Not covered: dialogs, upload, dark mode, pre-auth login          |
| **Coverage bar (>90%)**                | 10 of 11 in-scope projects meet it as of 2026-09-22; `shared-ai-client` short at 15.98% (was "3 of 15")    |
| **4 of 8 extension slots**             | Reserved — `routes`, `toolbar`, `contextMenu`, `tabs` are read by nothing                                  |
| **`selection` rule context**           | Still empty, so `canWriteSelection` / `canRemoveSelection` answer `false`                                  |
| **SAST**                               | None. SCA is `npm audit` only                                                                              |
| **Production observability**           | None wired in                                                                                              |

---

## Key differentiators

1. **Configuration and wiring survive upgrades — rehearsed, not assumed.** Both are fragments in
   the customer's own Marketplace package, which depends on ours, and our package installs no
   configuration file. Upgrading ours with two customer packages installed served byte-identical
   configuration (`nuxeoctl mp-install`, NXSAT-312). The earlier designs, an installed
   `bootstrap.json` (which broke the upgrade, NXSAT-317) and a manifest held in a Nuxeo document,
   are gone.
2. **The customisation surface is addressable by ID, not by class name.** A manifest never
   names a component, so we can rename one without breaking a customer.
3. **The extension contract is gated, not just documented.** Four separate gates guard the
   published package, and a fifth crosses a version boundary to prove a customisation
   survives.
4. **The AI harness ships to the customer.** Generators and a runnable guardrail are inside
   the package, so a customer's own agent can produce and verify conforming extensions.
5. **Built on real `adf-hx`**, so component-level investment is shared with Alfresco rather
   than duplicated.

---

## Two places where plan and reality diverge

Worth knowing if you are reading the RFC alongside the code.

| RFC planned                                                                                                                   | What shipped                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Five or more npm packages** — `@nuxeo-satori/nuxeo-client`, `/adf-hx-bridge`, `/extensions`, `/ui`, `/feature-*` (RFC §5.2) | **One** package, `@nuxeo/satori-platform`, with 4 secondary entry points. Simpler to version and to support; the bridge was deliberately never published, keeping adf-hx types out of the public API, and was removed on 2026-10-14 (NXSAT-635) |
| **Three repositories** — the monorepo, `nuxeo-satori-app-template`, `nuxeo-satori-extension-starter` (RFC §5.1)               | **One** monorepo. The template is `apps/nuxeo-satori-template`; the starter is `libs/extensions/acme-extensions`                                                                                                                                |

Neither is a defect — both are simplifications — but the RFC has not been revised, so the
two documents disagree. Flagged in
[Documentation Governance](../40-governance/01-documentation-governance.md).

---

## Where to go next

| Question                                  | Page                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| What exactly can it do?                   | [Feature Catalog](02-feature-catalog.md)                     |
| Who uses it?                              | [Personas](03-personas.md)                                   |
| How does work flow through it?            | [Use Cases & Journeys](04-use-cases-and-journeys.md)         |
| What do customers get out of it?          | [Customer Benefits](05-customer-benefits.md)                 |
| Why not just use the Web UI?              | [Nuxeo Web UI Comparison](06-nuxeo-web-ui-comparison.md)     |
| What does the AI harness give a customer? | [AI Harness Customer Value](07-ai-harness-customer-value.md) |
