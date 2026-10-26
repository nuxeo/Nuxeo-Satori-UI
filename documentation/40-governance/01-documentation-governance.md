---
title: Documentation Governance
parent: Governance
order: 1
last_reviewed: 2026-10-08
repo_commit: 2898046
audience: all
---

# Documentation Governance

> **Last reviewed:** 2026-10-08 · **Repository:** `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`)
> Only the repository links were re-verified at that commit: made relative rather than pinned to
> `feature/adf-hx-browse-poc`, every target present. The rest of the page as of 2026-08-24 · `77265f9`.

## The rule

> **No significant architectural, agent, skill, feature or integration change is complete until
> its documentation is updated.**

Not aspirational. This repository has already paid for the alternative:

- `CLAUDE.md` pointed at a **Programme status** section that did not exist, while its own summary
  claimed Phase 3 was next — three phases after Phase 3 shipped.
- Two facts in a section headed _"do not re-litigate these"_ were **false**.
- The leadership-facing delivery record was three phases stale and did not mention the published
  package once.
- `docs/agentic-development-system.md` describes 28 agents; **8 exist**.

Each was believed because it was written down.

---

## Why this set lives in the repository

Markdown in `documentation/`, published to Confluence by
[`scripts/publish-confluence.mjs`](../../scripts/publish-confluence.mjs).
Deliberate, for four reasons:

1. **It travels with the code.** A branch that changes behaviour can change its documentation in
   the same commit.
2. **It is reviewable.** Documentation changes appear in the pull request, next to the code they
   describe.
3. **It is diffable.** "What changed since the last review" is `git log`.
4. **It cannot be edited in two places.** Confluence is a rendering. Re-running the publisher
   refreshes it.

**Consequence: do not edit these pages in Confluence.** Edits there are overwritten on the next
publish. Change the Markdown.

---

## Ownership

| Area                                     | Owner                             | Reviews                        |
| ---------------------------------------- | --------------------------------- | ------------------------------ |
| Engineering pages                        | The engineer making the change    | Peer on the PR                 |
| `Architecture`, `Extensibility Contract` | Tech lead                         | Required for any change        |
| Product pages                            | Product manager                   | Tech lead for factual accuracy |
| Leadership pages                         | Product manager + tech lead       | —                              |
| `Cost & TCO`                             | Whoever owns the commercial model | Tech lead for the driver list  |
| This page                                | Tech lead                         | —                              |
| The publisher script                     | Tech lead                         | —                              |

**Every page carries `last_reviewed` and `repo_commit` in frontmatter.** A page whose
`repo_commit` is far behind `main` is a page to distrust.

---

## What triggers an update

| Change                                     | Update                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| A new or changed Nuxeo service             | `AGENTS/01-services.md` (**CI flags this**), [Repository Guide](../30-engineering/03-repository-guide.md)                      |
| A new library or app                       | [Repository Guide](../30-engineering/03-repository-guide.md), [Codebase Reference](../30-engineering/04-codebase-reference.md) |
| A new extension ID or slot                 | `docs/extension-reference.md` (**gated**), [Extensibility Contract](../30-engineering/07-extensibility-contract.md)            |
| A change to the published API              | `docs/api/platform.api.md` (**gated**), [Extensibility Contract](../30-engineering/07-extensibility-contract.md)               |
| A new gate                                 | [Dev Harness & Gates](../30-engineering/08-dev-harness-and-gates.md), and re-cite in `.ai/state/phases.json`                   |
| A new skill, agent or generator            | [Skills, Agents & Generators](../30-engineering/09-skills-agents-generators.md)                                                |
| A new user-facing feature                  | [Feature Catalog](../20-product/02-feature-catalog.md)                                                                         |
| A capability becoming available or blocked | [Feature Catalog](../20-product/02-feature-catalog.md), [Customer Benefits](../20-product/05-customer-benefits.md)             |
| A phase completing                         | `.ai/state/phases.json`, `docs/beta-delivery-record.md`, the plan's Programme status                                           |
| A new risk, or one resolved                | [Risks & Opportunities](../10-leadership/07-risks-and-opportunities.md)                                                        |
| An adf-hx workaround                       | A marker at the code **and** a row in `docs/adf-hx-workarounds.md` (**gated both ways**)                                       |
| A new cost driver                          | [Cost & TCO](../10-leadership/03-cost-and-tco.md)                                                                              |
| **A measurement finally taken**            | Wherever it currently says "not measured". These are the highest-value updates this set can receive                            |

---

## Review cadence

| Trigger                             | Scope                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **Every PR** that changes behaviour | The affected pages. Part of the definition of done                                          |
| **Every phase completion**          | Product + Leadership pages, and every `last_reviewed`                                       |
| **Monthly**                         | The index: is anything newly superseded or contradictory?                                   |
| **Before any external use**         | The whole Product section, by product **and** tech lead. It contains customer-facing claims |
| **After any adversarial review**    | Whatever the review contradicted                                                            |

---

## What already keeps documentation honest

Documentation gates that exist today — worth knowing, because they are unusual:

| Gate                                            | Asserts                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run beta:reference`                        | Every documented extension ID is registered **and** every registered ID is documented. Fails in **both** directions |
| `npm run beta:api`                              | The published API matches its 2,221-line snapshot                                                                   |
| `staleness-check.yml`                           | `AGENTS/01-services.md` still matches the code                                                                      |
| `review:guardrails` → `checkAdfHxWorkaroundIds` | A workaround marker has a register row, and vice versa                                                              |
| `review:guardrails` → `checkDocsNumbering`      | No duplicate section numbers in `docs/`                                                                             |
| `npm run beta:state`                            | No phase claims more than its evidence supports                                                                     |
| `npm run beta:audit`                            | No evidence assertion is incapable of failing                                                                       |

**The gap:** 12 of the 13 `AGENTS/` files have no staleness check, and none of these
`documentation/` pages has one. Extending the `staleness-check.yml` pattern is the obvious next
step — the cheapest version is a check that fails when a page's `repo_commit` is more than N
commits behind `main`.

---

## Known documentation debt, at this commit

| Item                                                                                     | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/agentic-development-system.md` describes 28 agents; 8 exist                        | Add a header pointing at [Skills, Agents & Generators](../30-engineering/09-skills-agents-generators.md) for the implemented/planned split                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ~~The RFC plans 5+ packages and 3 repos; reality is 1 and 1~~                            | **Closed 2026-08-24.** RFC revision 5 adds §15, which corrects §5.1, §5.2 and §10.3 and records that R8 remains open. §§1–14 left unchanged so the approved proposal stays readable                                                                                                                                                                                                                                                                                                                                                                                |
| The RFC is cited by `AGENTS/11-beta-program.md` and the plan, but the repo holds no copy | **Partly closed.** The page is `4256993484` in space `~71202090f2a61ef96d4f57a5104efe296c1f5b`; that ID is now recorded here and in the Product Overview. A copy in `docs/` is still worth having so the governing document survives a clone                                                                                                                                                                                                                                                                                                                       |
| `docs/architecture.md` is 54 lines and superseded                                        | Replace with a pointer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~"5 of 17 projects meet 90%" appears in the plan and delivery record~~                  | **Closed 2026-08-24.** The gate no longer scores 0/0 statements as 100%; an unmeasurable baseline entry now fails it. True figure at the time: **3 of 15 substantively** — itself superseded on 2026-09-22 by **10 of 11 in-scope**, after the Phase 6 coverage work and a baseline reconciliation that brought three never-measured projects in. Plan, delivery record and `.ai/state/phases.json` corrected on both occasions. One detail in the original note was itself wrong — `core` does have a spec; it is a 7-statement scaffold, not an untested library |
| `libs/core` is a generated scaffold with no inbound dependencies                         | Confirmed by `nx graph` on 2026-08-24 — nothing imports `@agentic-ui/core`. It is the only project clearing the coverage bar on a thin denominator. Delete it, or state why it is kept                                                                                                                                                                                                                                                                                                                                                                             |
| 29 docs with overlapping scope                                                           | The [index](../README.md) records what is superseded. Consider consolidating further                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## Adding a page to this set

1. Create the Markdown under the right section directory.
2. Add frontmatter — `title`, `parent`, `order`, `last_reviewed`, `repo_commit`, `audience`.
   **A page with no `title` is skipped by the publisher.**
3. Link it from [the index](../README.md). An unlinked page is an undiscoverable page.
4. Verify the conversion before publishing:
   ```bash
   node scripts/publish-confluence.mjs --dry-run
   ```
5. Publish:
   ```bash
   export CONFLUENCE_EMAIL=you@hyland.com
   export CONFLUENCE_TOKEN_FILE=/path/to/token
   node scripts/publish-confluence.mjs
   ```
6. Read the page back in Confluence. The publisher is idempotent by title, so re-running updates
   rather than duplicating.

**Credentials never go in a file in this repository.** Use the environment or a path outside the
repo. `checkHardcodedSecrets` will fail the build on a credential-shaped literal, and there is
already one real example in the wild of a token sitting in a settings file.

---

## The standard to hold

From `CLAUDE.md`, and it applies to documentation as much as to gates:

> **Do not present unfinished work as finished.** Registering descriptors nothing renders, or
> documenting rules that always return `false`, inflates the apparent surface.

Applied here, that means three habits:

- **Mark the unverified.** "Not verified in repository" is a complete and acceptable answer.
- **Never delete a claim that turned out wrong.** Move it, and say what was believed. The record
  of what was believed is part of the record.
- **Separate demonstrated from plausible.** Every Product and Leadership page in this set does
  this explicitly, and it is the reason those pages can be handed to a customer or an executive
  without a caveat conversation first.
