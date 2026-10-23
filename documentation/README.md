---
title: Nuxeo Satori — Documentation Home
parent: null
order: 0
last_reviewed: 2026-10-08
repo_commit: fb97d44
branch: feature/nxsat-308-dependency-tree-gate
audience: all
---

# Nuxeo Satori — Documentation Home

> **Last reviewed:** 2026-10-08 · **Repository:** `fb97d44` (`feature/nxsat-308-dependency-tree-gate`)
> Only the Dev Harness & Gates row was re-verified at that commit; the rest of the index was last
> reviewed on 2026-08-24 at `77265f9` on `feature/adf-hx-browse-poc`.

This is the authoritative documentation set for **Nuxeo Satori** — the Angular content
management UI being converted into a customer-shippable Beta on real `adf-hx` components,
with a four-layer customisation contract.

It exists because the product was built largely through AI-assisted development, and the
knowledge that accumulated sat in code comments, 29 scattered documents, and the heads of
two or three people. These pages consolidate that into something each audience below can
use on its own.

---

## Start here, by who you are

| You are                               | Read                                                                                                                                                                                 | Time                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| **Presales, customer or partner**     | [The short version](20-product/00-the-short-version.md) → [Feature Catalog](20-product/02-feature-catalog.md) → [Extension reference](../docs/extension-reference.md)                | ~5 minutes               |
| **A developer joining the team**      | [Developer Getting Started](30-engineering/01-getting-started.md) → [Architecture](30-engineering/02-architecture.md) → [Code KT](30-engineering/11-code-kt.md)                      | ~2 hours to first commit |
| **A product manager**                 | [Product Overview](20-product/01-product-overview.md) → [Feature Catalog](20-product/02-feature-catalog.md) → [Nuxeo Web UI Comparison](20-product/06-nuxeo-web-ui-comparison.md)    | ~45 minutes              |
| **An executive or sponsor**           | [Executive Overview](10-leadership/01-executive-overview.md) → [Cost & TCO](10-leadership/03-cost-and-tco.md) → [Risks & Opportunities](10-leadership/07-risks-and-opportunities.md) | ~20 minutes              |
| **Anyone asking "is this real yet?"** | Run `npm run beta:state`. It is red whenever a phase claims more than its evidence supports.                                                                                         | 10 seconds               |

---

## The one thing to understand first

**There are two entirely separate AI systems in this repository, and conflating them
produces wrong conclusions about cost, risk and customer value.**

|                             | Runtime AI — customer-facing                                                                                                                                       | Development harness — engineering-facing                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is                  | 12 `AI.*` Nuxeo Automation operations: NL→NXQL search, summarise, classify, suggest tags, chat, insights, sentiment, anomalies, and three audit/permission helpers | Skills, gates, generators, evidence runners and review agents that AI coding tools use while building the product                                             |
| Where it lives              | [`libs/shared/ai-client`](../libs/shared/ai-client) — a thin HTTP client                                                                                           | [`scripts/`](../scripts), [`.cursor/`](../.cursor), [`.claude/`](../.claude), [`AGENTS/`](../AGENTS), [`tools/satori-generators`](../tools/satori-generators) |
| Where the intelligence runs | A **separate marketplace package that is not in this repository**. Absent package ⇒ HTTP 500, which is expected                                                    | The developer's own AI tool (Claude Code, Cursor, Windsurf)                                                                                                   |
| Who pays for inference      | Whoever operates the AI backend — **this repository incurs no LLM cost at runtime**                                                                                | Engineering, per developer seat                                                                                                                               |
| Documented in               | [Runtime AI Features](30-engineering/10-runtime-ai-features.md) · [AI Harness Customer Value](20-product/07-ai-harness-customer-value.md)                          | [Dev Harness & Gates](30-engineering/08-dev-harness-and-gates.md) · [AI Harness Strategy](10-leadership/05-ai-harness-strategy.md)                            |

When a document says "the AI harness", it means the **second** one unless it says
otherwise. The customer-facing AI features are always called "runtime AI features".

---

## Contents

### Executive / Leadership

| Page                                                                               | Answers                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Executive Overview](10-leadership/01-executive-overview.md)                       | What did we build, why, and how mature is it?                  |
| [Architecture for Leadership](10-leadership/02-architecture-for-leadership.md)     | What are the moving parts, strategically?                      |
| [Cost & TCO](10-leadership/03-cost-and-tco.md)                                     | What drives cost, and how would we measure per-customer cost?  |
| [Customer Customisation Effort](10-leadership/04-customer-customisation-effort.md) | How much work is a customer-specific deployment?               |
| [AI Harness Strategy](10-leadership/05-ai-harness-strategy.md)                     | Why the harness is strategically valuable, and what it demands |
| [Scalability & Operations](10-leadership/06-scalability-and-operations.md)         | How does this scale and who supports it?                       |
| [Risks & Opportunities](10-leadership/07-risks-and-opportunities.md)               | Ranked risks, technical debt, and where the upside is          |
| [Roadmap Recommendations](10-leadership/08-roadmap-recommendations.md)             | What to do next, and what not to                               |

### Product

| Page                                                                    | Answers                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| [The short version](20-product/00-the-short-version.md)                 | What it does, what changes without code, how to start    |
| [Product Overview](20-product/01-product-overview.md)                   | What is it, for whom, and what is the value proposition? |
| [Feature Catalog](20-product/02-feature-catalog.md)                     | Everything it can do, with evidence                      |
| [Personas](20-product/03-personas.md)                                   | Who uses it and what they need                           |
| [Use Cases & Journeys](20-product/04-use-cases-and-journeys.md)         | How work actually flows through it                       |
| [Customer Benefits](20-product/05-customer-benefits.md)                 | Demonstrated benefits vs. benefits requiring validation  |
| [Nuxeo Web UI Comparison](20-product/06-nuxeo-web-ui-comparison.md)     | Why use this instead of, alongside, or on top of Web UI  |
| [AI Harness Customer Value](20-product/07-ai-harness-customer-value.md) | What customers get from the harness, honestly scoped     |

### Engineering

| Page                                                                                | Answers                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [Developer Getting Started](30-engineering/01-getting-started.md)                   | Zero to productive without asking anyone              |
| [Architecture](30-engineering/02-architecture.md)                                   | Logical, runtime, data flow, boundaries               |
| [Repository Guide](30-engineering/03-repository-guide.md)                           | What every top-level directory is for                 |
| [Codebase Reference](30-engineering/04-codebase-reference.md)                       | File- and folder-level responsibility map             |
| [Technology Stack](30-engineering/05-technology-stack.md)                           | Every technology, why it is here                      |
| [Tools & Commands](30-engineering/06-tools-and-commands.md)                         | Complete command reference                            |
| [Extensibility Contract](30-engineering/07-extensibility-contract.md)               | The four layers, and the 52 registered IDs            |
| [Dev Harness & Gates](30-engineering/08-dev-harness-and-gates.md)                   | The gates and the evidence system                     |
| [Skills, Agents & Generators](30-engineering/09-skills-agents-generators.md)        | What the AI tooling actually consists of              |
| [Runtime AI Features](30-engineering/10-runtime-ai-features.md)                     | The 12 `AI.*` operations and their backend            |
| [Code KT](30-engineering/11-code-kt.md)                                             | "Where do I make this change?"                        |
| [Testing & Evidence](30-engineering/12-testing-and-evidence.md)                     | Unit, E2E, evidence capture, coverage                 |
| [Deployment & Troubleshooting](30-engineering/13-deployment-and-troubleshooting.md) | Marketplace package, config survival, common failures |

### Governance

| Page                                                                     | Answers                              |
| ------------------------------------------------------------------------ | ------------------------------------ |
| [Documentation Governance](40-governance/01-documentation-governance.md) | Who owns this, and how it stays true |

---

## How to read the evidence markers

Every load-bearing technical claim in these pages carries one of:

- **A file reference** — `libs/shared/extensions/src/lib/extension-slots.ts:49`. Verified
  by reading that file at commit `77265f9`.
- **A command** — `npm run beta:state`. Verified by running it.
- **"Not verified in repository"** — stated explicitly. The claim may still be true; it is
  simply not something this repository demonstrates. Treat it as an open question, not a
  fact.
- **"Planned, not implemented"** — the repository contains a design for it and no
  implementation. Used heavily in [Skills, Agents & Generators](30-engineering/09-skills-agents-generators.md),
  because the pre-existing agent catalog describes 18 agents of which 8 exist.

Nothing in these pages is a projection dressed as a measurement. Where a number would be
useful and does not exist, the page says how to obtain it rather than estimating it.

---

## What this documentation supersedes

These pages are now authoritative. The following pre-existing documents remain in the
repository as history and are cited where their detail is still the best available, but
should not be read as current status:

| Document                                                                              | Status                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/agentic-development-system.md`](../docs/agentic-development-system.md)         | Design plan, 1,731 lines. Its 18-agent catalog is largely target-state — see [Skills, Agents & Generators](30-engineering/09-skills-agents-generators.md) for what exists |
| [`docs/agentic-system-guide.md`](../docs/agentic-system-guide.md)                     | File-by-file guide, still broadly accurate; superseded by [Skills, Agents & Generators](30-engineering/09-skills-agents-generators.md)                                    |
| [`docs/developer-guide.md`](../docs/developer-guide.md)                               | Still the best detail on component and service patterns; superseded for setup by [Getting Started](30-engineering/01-getting-started.md)                                  |
| [`docs/technical-walkthrough.md`](../docs/technical-walkthrough.md)                   | Presentation walkthrough; superseded by [Architecture](30-engineering/02-architecture.md)                                                                                 |
| [`docs/architecture.md`](../docs/architecture.md)                                     | 54 lines, thin; superseded by [Architecture](30-engineering/02-architecture.md)                                                                                           |
| [`docs/adf-hx-poc-action-plan.md`](../docs/adf-hx-poc-action-plan.md)                 | Explicitly superseded by `docs/adf-hx-beta-plan.md` in its own header                                                                                                     |
| [`docs/consolidated-agentic-ai-report.md`](../docs/consolidated-agentic-ai-report.md) | Retrospective with a cost-benefit section; cited by [Cost & TCO](10-leadership/03-cost-and-tco.md)                                                                        |

**Still authoritative and not superseded**, because they are maintained and gated:

- [`docs/adf-hx-beta-plan.md`](../docs/adf-hx-beta-plan.md) — the plan of record, with a
  dated Programme status section
- [`docs/extension-reference.md`](../docs/extension-reference.md) — the customer-facing
  registered-ID contract, gated by `npm run beta:reference`
- [`docs/api/platform.api.md`](../docs/api/platform.api.md) — the published API snapshot,
  gated by `npm run beta:api`
- [`AGENTS/`](../AGENTS) and [`CLAUDE.md`](../CLAUDE.md) — the agent contract. Read by AI
  tools on every task; these pages describe it but do not replace it
- [`docs/adf-hx-workarounds.md`](../docs/adf-hx-workarounds.md) and
  [`docs/adf-hx-upstream-findings.md`](../docs/adf-hx-upstream-findings.md) — both gated
  in `scripts/review-guardrails.mjs`

---

## Keeping this true

See [Documentation Governance](40-governance/01-documentation-governance.md). The short
version, and the rule worth adopting:

> **No significant architectural, agent, skill, feature or integration change is complete
> until its documentation is updated.**

This set is authored as Markdown inside the repository and published to Confluence from
there — deliberately, so the documentation travels with the code, is reviewable in a pull
request, and cannot drift silently from the thing it describes. The Confluence pages are a
rendering, not the source.
