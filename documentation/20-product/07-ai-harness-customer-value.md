---
title: AI Harness Customer Value
parent: Product
order: 7
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: product
---

# What the AI Harness Gives a Customer

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`

## Read this first: two different things are called "AI" here

Conflating them produces claims we cannot support.

|                           | **Runtime AI features**                                                                                                                       | **The AI harness**                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| What the customer sees    | 12 intelligent features inside the product: NL search, summarise, classify, suggest tags, chat, insights, sentiment, anomalies, audit helpers | Nothing, at runtime. It is **build-time tooling for whoever extends the product** |
| Who uses it               | End users                                                                                                                                     | The customer's developers and their AI coding tool                                |
| In this repository        | A thin HTTP client, `libs/shared/ai-client`                                                                                                   | Generators, a guardrail script, a knowledge base — shipped inside the npm package |
| Where the intelligence is | **A separate marketplace package, not in this repository**                                                                                    | The customer's own AI tool (Cursor, Claude Code, Copilot…)                        |
| Who pays for inference    | Whoever operates the AI backend                                                                                                               | The customer's existing AI tool subscription                                      |

**When a salesperson says "AI-powered", they usually mean the first. When this documentation
says "the harness", it means the second.** This page is about the second.

---

## What the customer actually receives

Four artifacts, all inside `@nuxeo/satori-platform`. Verified present in the 347 kB tarball
by unpacking it.

| Artifact                    | What it does                                                                                                                     | Status      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **4 Nx generators**         | `extension-library`, `-rule`, `-action`, `-component`. Produce registered, tested, conforming scaffolding                        | **Shipped** |
| **Guardrail script**        | 6 checks a customer runs in their own CI, so an agent can verify its own output before a human reviews it                        | **Shipped** |
| **Customer knowledge base** | `AGENTS.md` (~180 lines of procedure) + the 509-line extension reference, shipped as package assets so any AI tool can read them | **Shipped** |
| **A forkable template**     | Thin, and ships **no design system** so the customer adds theirs                                                                 | **Shipped** |

```bash
# What a customer's developer runs — from the installed package, no clone of ours
npx nx g @nuxeo/satori-platform:extension-library acme-extensions --owner=acme
npx nx g @nuxeo/satori-platform:extension-rule      is-legal-team --library=acme-extensions
node node_modules/@nuxeo/satori-platform/guardrails/check-extension-library.mjs libs/acme-extensions
```

---

## The intended experience

RFC §6.3, which is the design intent:

> The customer opens their fork in an AI-enabled editor. The shipped knowledge base tells the
> agent the architecture, the public API and the conventions; the generators give it correct
> scaffolding; the guardrail script lets it verify its own work. A request such as _"add a
> contract approval action visible only to users who can write the document, and a tab showing
> approval history"_ becomes a short agent session against a defined API rather than an
> open-ended edit of our source.

The last clause is the point. Without the contract, that request means an agent editing our
source — a fork that diverges, an upgrade that breaks, and a support boundary that has
disappeared.

---

## Honest scoping — four tiers

### Tier 1 · Shipped and verified

| Claim                                                                             | Evidence                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A customer can generate a conforming extension library from the installed package | Verified by unpacking the tarball into `node_modules` and running the generator: `project.json`, `src/index.ts`, `src/lib/extensions.ts` and a spec were produced |
| The generated library is **inert until the app opts in** — one provider line      | `provideAcmeExtensions()` in the template's app config                                                                                                            |
| The generated library registers **live**, not merely present                      | `phase-5-harness` evidence, 27 checks; guardrail check 3 requires a spec asserting registry state                                                                 |
| The guardrail catches six specific classes of mistake                             | Each corresponds to a mistake actually made in this repository. All six probed                                                                                    |
| A Layer 0/1/2 customisation **survives a version bump**                           | `npm run beta:upgrade`, 8 assertions incl. slot existence                                                                                                         |
| Config and manifest survive a **marketplace upgrade**                             | Both are fragments in the customer's own package; ours installs no configuration file. Rehearsed with two customer packages installed (NXSAT-312)                 |

### Tier 2 · Shipped but unproven with a customer

| Claim                                                            | Why it is unproven                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "A customisation is a short agent session rather than a project" | **No customer has done this.** Zero external users. The generators were only made reachable from the published package on 2026-08-24 |
| "Layers 0 and 1 absorb most requests"                            | The **central economic assumption**, flagged as unvalidated in both the RFC and the plan                                             |
| "The 52 registered IDs are the right ones"                       | RFC risk **R8** — too few addressable IDs pushes work into Layer 2 and undermines the maintenance economics                          |
| "An agent can verify its own work"                               | True of the 6 checks. It cannot verify that the feature is _correct_, only that it conforms                                          |

### Tier 3 · Potential, requiring investment

- **A skills/agent marketplace** — customers or partners sharing extension recipes. Nothing
  exists.
- **AI-assisted upgrade migration** — an agent reading a changelog and adapting a customer's
  Layer 2 code. Nothing exists.
- **Automated customer support triage** — nothing exists.
- **Customer self-service configuration UI** for Layer 0/1 — since NXSAT-312 the manifest is a
  fragment in the customer's own package, not a Nuxeo document, so a UI would need somewhere to
  keep it. Nothing exists.

### Tier 4 · Claims not to make

| Do not say                                        | Because                                                                                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Customers can build features with no developers" | Layer 2 is TypeScript in their repo with their build. An agent accelerates a developer; it does not replace one                                                       |
| "The AI harness reduces cost by X%"               | **No measurement exists.** The RFC's own leverage figures (2–3× mechanical, 1.5× ports, low for design) are estimates for _our_ work, not customer outcomes           |
| "AI writes the customisation and it just works"   | The POC that preceded this: 18,400 lines fast, **seven defects, eleven tests, never compiled by CI**. The harness is the answer to that, and it presumes human review |
| "The product is AI-powered out of the box"        | The 12 runtime operations need a **separate backend package**. Absent ⇒ HTTP 500                                                                                      |

---

## The counter-evidence, stated plainly

The strongest argument for the harness is also the clearest warning about agent output, and it
comes from this programme's own history:

> Roughly 18,400 lines quickly. Seven code-level defects. Eleven tests for 2,949 lines of
> bridge source. A branch that had never been compiled by CI. — RFC §7.1

And the RFC's conclusion, which is the honest framing for any customer conversation:

> **Agents move cost from authoring to verification rather than removing it.**

Everything in the harness — the 17 gates, the evidence assertions, the adversarial review, the
5 customer checks — is that verification cost, made systematic. A customer adopting the
agentic workflow inherits both halves: the speed **and** the obligation to verify.

Since Phase 5, an independent adversarial review of this repository found that **every phase
had self-reported green while containing at least one overstated claim**, and that **seven
gates asserted less than they claimed**. That is what happens with a strong harness and
disciplined review. A customer without either should expect worse.

---

## What would make the value provable

In rough order of cost:

| Action                                                                                              | Proves                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Take 10 real customer requests; attempt each as Layer 0/1 only; count fall-through to Layer 2       | The central economic assumption, or refutes it                |
| Have one PS engineer build a real customisation using only the published package and its generators | That the Layer 3 story works for someone who did not build it |
| Instrument that engagement: hours by layer, defects found, review time                              | The first real effort numbers. **None exist today**           |
| Publish the package and have a customer install it from a registry                                  | The distribution path end to end                              |
| ~~Fix the ratcheted accessibility rule classes~~ **done 2026-08-24** — 7 classes, 77 nodes          | Procurement blocker removed                                   |

Until at least the first two are done, the harness's customer value is **a well-engineered
hypothesis** — and it should be presented as one.
