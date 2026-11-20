---
title: Cost & TCO
parent: Executive / Leadership
order: 3
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Cost & TCO — a framework, not a forecast

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
>
> **No invented numbers appear on this page.** Where a cost driver exists but has never been
> measured, it is named, its inputs are identified, and the way to measure it is given.
> Fabricating a figure here would be worse than leaving it blank, because it would be quoted.

---

## 1. What this repository does and does not cost

The most common costing error with this product is assuming it incurs LLM inference cost at
runtime. **It does not.**

| Layer                                     | Cost owner                                         | Present here?                                      |
| ----------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| The Angular application                   | Customer's Nuxeo server (static assets in the WAR) | **Yes**                                            |
| Nuxeo server, OpenSearch                  | Customer's existing Nuxeo estate                   | Out of scope — pre-existing                        |
| ARender document viewer                   | Licensed component, runs in containers             | Referenced; Docker compose here                    |
| **The 12 `AI.*` operations**              | **Whoever operates the AI backend package**        | **No — a separate package not in this repository** |
| Knowledge Discovery / Enrichment backends | Separate services                                  | Clients only                                       |
| The development AI harness                | Engineering, per developer seat                    | Yes — but it is a **build-time** cost              |

**Consequence:** "cost per agent execution" and "cost per LLM token" are **not costs of this
product**. They are costs of the AI backend, which is owned elsewhere. Any TCO model that puts
inference cost against Satori is double-counting or mis-attributing.

---

## 2. Identifiable cost drivers

### 2.1 Infrastructure and runtime

| Driver                | What influences it                                                         | Measurable how         | Known today                           |
| --------------------- | -------------------------------------------------------------------------- | ---------------------- | ------------------------------------- |
| Static asset delivery | Bundle size. Ceiling is **6 MiB** total shipped JS+CSS, currently ~4.90 MB | CI prints it every run | **Measured.** Headroom ~1.0 MB        |
| Initial page weight   | Eager initial bundle, held to a size budget                                | `angular.json` budget  | **Measured**, with the trade recorded |
| Nuxeo API load        | Requests per user action; no client-side caching layer exists              | Nuxeo access logs      | Not measured                          |
| OpenSearch load       | Search and aggregation volume                                              | OpenSearch metrics     | Not measured                          |
| ARender               | Licensing + container resource                                             | Vendor terms           | **Not verified in repository**        |
| Storage               | Nuxeo's, unchanged by this UI                                              | —                      | Out of scope                          |

> The bundle-size ceiling was raised from 5 to 6 MiB on 2026-08-24 with the reasoning recorded
> at the value.

### 2.2 Engineering — build

The RFC's estimates, by delivery mode, for the seven phases:

| Phase                  | Focused       | AI-assisted | Autonomous  |
| ---------------------- | ------------- | ----------- | ----------- |
| 0 — Unblock            | 2–4 d         | 1–2 d       | 1–2 d       |
| 1 — Layer 0            | 12–18 d       | 7–11 d      | 4–7 d       |
| 2 — Layer 1            | 15–22 d       | 9–14 d      | 6–10 d      |
| 3 — Component adoption | 30–45 d       | 20–29 d     | 12–20 d     |
| 4 — Layer 2            | 18–26 d       | 11–16 d     | 7–11 d      |
| 5 — Layer 3            | 8–12 d        | 4–7 d       | 2–4 d       |
| 6 — Quality & proof    | 20–30 d       | 12–18 d     | 7–12 d      |
| **Total**              | **105–157 d** | **64–97 d** | **39–66 d** |

**These are estimates from the RFC, not actuals.** No time tracking exists in this repository,
so the realised cost of Phases 0–5 is unknown. That is a measurable gap: the git history has
111 commits with dates and could be reconciled against calendar time if someone wanted the
actual figure.

Two corrections the RFC itself applies, and they matter more than the table:

- **Agent leverage is concentrated, not uniform.** Roughly 40% of remaining effort is
  agent-amenable (API ports, test backlog, i18n). The rest — discovery, decisions, CI
  wall-clock, review — does not compress.
- **Review is the binding constraint.** _"One engineer reviewing to a standard that catches the
  defect class found on the POC branch manages a few hundred lines a day."_ Phases 3 and 4 could
  emit 15,000–25,000 lines. Authoring days saved reappear as a review queue, which is why the
  RFC's realistic calendar figure is **3–4 months, not 2–3**.

### 2.3 Engineering — the harness itself

| Item                                | Size         | Cost character                                 |
| ----------------------------------- | ------------ | ---------------------------------------------- |
| `scripts/`                          | ~13.8k lines | Built once; maintained forever                 |
| `tools/`                            | ~6.1k lines  | Generators, shipped to customers               |
| `AGENTS/` + `.cursor/` + `.claude/` | ~5.4k lines  | Knowledge base; **decays without maintenance** |
| `documentation/`                    | this set     | Same                                           |

**This is real, recurring cost that a conventional project does not carry.** Seven gates were
found asserting less than they claimed — gates are software and rot like any other. Exactly one
knowledge-base file has an automated staleness check (`staleness-check.yml` on
`AGENTS/01-services.md`); the other twelve do not.

### 2.4 AI tooling — build-time

| Driver                       | Influenced by                                                | Known                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI coding tool subscriptions | Seats; model tier                                            | **Not verified in repository.** The RFC recommends a model mix (Opus/GPT-5.6 for architecture, Sonnet for volume, cheap models for chores) but no spend is recorded |
| Token consumption            | Volume, context size, review passes                          | Not measured. **This is measurable and is not being measured**                                                                                                      |
| Adversarial review           | Multiple model families in parallel — the RFC recommends 2–3 | Multiplies review cost by design                                                                                                                                    |

### 2.5 CI/CD

| Driver                 | Known                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions minutes | 8 workflows. CI runs ~15–19 min per push, and `cancel-in-progress` cancels superseded runs — which reduces waste but means only the newest run verified anything |
| Cost per push          | Measurable from Actions billing. Not tracked here                                                                                                                |

### 2.6 Support and operations

| Driver                      | Status                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer incident diagnosis | **No APM, structured logging, metrics or error reporting.** Cost of a production incident is currently _unbounded_ because diagnosis has no tooling |
| Upgrade support             | The rehearsal reduces this by construction, unmeasured in practice                                                                                  |
| Support boundary            | Holds only if customers stay in Layer 2. If Layer 0/1 coverage is inadequate, boundary violations become support cost                               |

---

## 3. Costing frameworks

Each below is a **method**, with the inputs named. None can be completed from this repository.

### Cost per customer (implementation)

```text
  Layer 0 effort        (hours × rate)      — see Customisation Effort
+ Layer 1 effort        (hours × rate)
+ Layer 2 effort        (hours × rate, incl. THEIR build + CI setup)
+ Integration effort    (their systems)
+ Nuxeo-side config     (server fragments, install)
+ Training / enablement
= Implementation cost per customer
```

**Missing input:** the Layer 0/1 vs Layer 2 split. That is the ten-request exercise, and it is
the single measurement that unlocks this whole model.

### Cost per customer (ongoing)

```text
  Their share of platform maintenance   (total platform cost ÷ customers)
+ Upgrade effort per release            (template merges + their Layer 2 revalidation)
+ Support tickets × cost per ticket
+ Their infrastructure delta            (≈ 0 — same Nuxeo, static assets)
= Annual cost per customer
```

**Note the denominator.** With one customer, platform maintenance is the dominant term and TCO
per customer is very poor. The model only works at several customers, which makes customer
count a **cost** variable, not just a revenue one.

### Cost per workflow / per agent execution

**Not applicable to this repository as scoped.** Runtime agent execution belongs to the AI
backend package. If leadership wants this number, it must be modelled where that package lives,
with inputs: invocations per user per day, tokens per invocation, model rate, cache hit rate.

### Cost per transaction (a user action)

```text
  Nuxeo API calls per action × server cost per call
+ OpenSearch queries per action × cost per query
+ (if an AI feature) backend inference cost — OWNED ELSEWHERE
= Cost per action
```

**Measurable** by instrumenting the client (request counts per route) plus Nuxeo access logs.
Nothing instruments this today.

### Development cost per feature

```text
  Authoring (agent-assisted, ~1.5–3× leverage on mechanical work)
+ Review (few hundred lines/day/engineer — THE CONSTRAINT)
+ Gate iteration
+ Evidence capture
+ Adversarial review (2–3 model families)
+ Documentation update (now mandatory — see Governance)
= Cost per feature
```

Every term except the first is verification. That is the shape of agentic delivery.

---

## 4. What to measure first

Ranked by decision value per unit of effort.

| #   | Measure                                                         | Unlocks                                        | Effort                        |
| --- | --------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| 1   | **Layer 0/1 vs Layer 2 split** across 10 real customer requests | The entire per-customer model, and RFC risk R8 | Days                          |
| 2   | Actual elapsed engineering cost of Phases 0–5                   | Whether the RFC's AI-assisted estimates held   | Hours — reconcile git history |
| 3   | Review hours vs authoring hours                                 | Confirms or refutes the binding constraint     | Ongoing timesheet discipline  |
| 4   | AI tooling spend per engineer per month                         | The only direct AI cost we actually bear       | Hours — billing data          |
| 5   | CI minutes per merged PR                                        | Marginal cost per change                       | Hours — Actions billing       |
| 6   | Requests + search queries per user session                      | Cost per transaction, and capacity planning    | Days — client instrumentation |

---

## 5. The uncomfortable summary

- **We do not know what this cost.** No time tracking; the RFC figures are estimates.
- **We do not know what a customer implementation costs**, because the layer split is
  unmeasured — and that is the number the business case depends on.
- **We do know the shape:** verification dominates, review is the constraint, and the harness
  is a permanent maintenance line item.
- **We know one hard number:** the shipped bundle is 4.90 MB against a 6 MiB ceiling.
- **Runtime AI cost is not ours** — and any model that assumes it is will be wrong.

The cheapest way to make this page quantitative is measurement #1. Everything downstream of it
is currently guesswork, and we should not present guesswork as a TCO model.
