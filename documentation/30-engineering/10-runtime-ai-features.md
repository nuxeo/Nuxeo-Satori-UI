---
title: Runtime AI Features
parent: Engineering
order: 10
last_reviewed: 2026-10-08
repo_commit: 2898046
audience: engineering
---

# Runtime AI Features — the 12 `AI.*` operations

> **Last reviewed:** 2026-10-08 · **Repository:** `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`)
> Only the repository links were re-verified at that commit: made relative rather than pinned to
> `feature/adf-hx-browse-poc`, every target present. The rest of the page as of 2026-08-24 · `77265f9`.
> These are the **customer-facing** AI features. For the development harness see
> [Skills, Agents & Generators](09-skills-agents-generators.md). They are unrelated.

---

## 1. The essential fact

**The AI backend is not in this repository.**

`libs/shared/ai-client` is a **457-line HTTP client** with zero spec files. It POSTs to Nuxeo
Automation operations named `AI.*`. Those operations are implemented in a **separate marketplace
package**, which is not present here and not built here.

```
Component
  → AiGatewayService                       libs/shared/ai-client/src/lib/ai-gateway.service.ts
     → POST {AI_BACKEND_URL}/api/v1/automation/AI.<Operation>
        → Nuxeo Automation
           → the AI.* operation implementation   ← SEPARATE PACKAGE, NOT HERE
              → whatever model/service it uses   ← NOT HERE, NOT KNOWN
```

**Absent package ⇒ HTTP 500.** That is expected behaviour, documented in
[`CLAUDE.md`](../../CLAUDE.md),
and **not a client defect**. If you are debugging a 500 from an `AI.*` call, check whether the
package is installed before looking at this code.

### What follows from it

| Consequence                                  | Detail                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **No LLM cost here**                         | This repository incurs no inference cost. A TCO model that assigns it to Satori is mis-attributing                                |
| **No prompts here**                          | Prompt engineering, model choice, temperature, context assembly — all in the other package                                        |
| **No model dependency here**                 | `openai` is in `package.json` and **imported nowhere**. It is dead weight, and the most likely reason someone concludes otherwise |
| **We cannot test the intelligence**          | Only that the client calls the right operation with the right parameters                                                          |
| **Product claims are gated on someone else** | Every AI feature depends on a package with a different owner                                                                      |

---

## 2. The 12 operations

All via `POST /nuxeo/api/v1/automation/<OperationId>`, built by
`AiGatewayService.op(operationId)`.

| Operation           | Client method                     | Parameters             | Surfaces in     |
| ------------------- | --------------------------------- | ---------------------- | --------------- |
| `AI.NlToNxql`       | `nlToNxql`, `nlToNxqlSuggestions` | natural-language query | Search          |
| `AI.Summarize`      | `summarize`                       | `docId`                | Document detail |
| `AI.SuggestTags`    | `suggestTags`                     | `docId`                | Document detail |
| `AI.Classify`       | `classify`                        | `docId`                | Document detail |
| `AI.Similar`        | `similar`                         | `docId`, `limit`       | Document detail |
| `AI.Chat`           | `chat`                            | conversation           | AI chat surface |
| `AI.Insights`       | —                                 | `docId`                | Document detail |
| `AI.Sentiment`      | —                                 | `docId`                | Document detail |
| `AI.Anomalies`      | —                                 |                        | Analytics       |
| `AI.AuditSummarize` | —                                 |                        | History tab     |
| `AI.AuditNlFilter`  | —                                 | natural language       | History tab     |
| `AI.NlPermissions`  | —                                 | natural language       | Permissions     |

`AI.NlToNxql` is the most product-significant: it turns "documents I edited last week" into NXQL,
removing the need for a user to think in filters.

## 3. Configuration and gating

| Concern          | Mechanism                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Backend location | `AI_BACKEND_URL` injection token, `libs/shared/ai-client/src/lib/ai.config.ts`                                                      |
| Feature flag     | `AiFeatureFlagService` — `sessionStorage` key `ai-features-enabled`, with a one-time migration key `ai-features-default-enabled-v1` |
| Per-user toggle  | `toggle()`                                                                                                                          |

**The flag is client-side and per-session.** There is no server-side entitlement check in this
repository, and no telemetry on usage — so we cannot currently answer "how many users have AI
features on?".

## 4. Files

| File                         | Lines | Responsibility                                              |
| ---------------------------- | ----: | ----------------------------------------------------------- |
| `ai-gateway.service.ts`      |       | The 12 operation calls. The only place operation IDs appear |
| `ai-chat.service.ts`         |       | Conversation state for the chat surface                     |
| `ai-feature-flag.service.ts` |       | The toggle                                                  |
| `ai.config.ts`               |       | `AI_BACKEND_URL`                                            |
| `ai.models.ts`               |       | Response types — `NlToNxqlResponse`, `SummarizeResponse`, … |

**Zero spec files**, and the library has **no `test` target**, so it is absent from the coverage
ratchet entirely. For a surface that shapes user-visible behaviour and constructs query strings,
that is a gap worth closing — the client is thin, so the tests would be cheap.

## 5. Security considerations

| Concern             | Position                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                | Same `nuxeoAuthInterceptor` as every other request. No separate credential                                                                                      |
| Where the data goes | `AI_BACKEND_URL` → Nuxeo Automation → **unknown from here.** Whether document content leaves the customer's infrastructure is a property of the _other_ package |
| Injection           | `AI.NlToNxql` returns NXQL that is then executed. **The trust boundary deserves scrutiny** — see below                                                          |
| Permissions         | Operations run through Nuxeo Automation, so server-side ACLs apply                                                                                              |

### The one thing to look at properly

`AI.NlToNxql` produces a **query** which is then executed. An HXQL/NXQL injection was already
found and fixed in the _hand-built_ search path
(`hxql-literal.ts`, since removed with the adf-hx search route) —
it returned 155 documents against 0 for the plain term by escaping out of a literal and lifting
its own clause to a top-level `OR`, defeating the `isVersion` and `isTrashed` hygiene filters.

Model-generated NXQL is a **different** trust boundary from user-typed text, and nothing in this
repository validates it. Nuxeo's ACL filter bounds the damage — a user cannot read documents they
lack permission on — but the same class of exposure (versions, trashed documents, arbitrary query
cost) applies.

**Not verified in repository:** whether the AI backend constrains its own output, or whether
anything validates the returned NXQL before execution. Worth confirming with whoever owns that
package.

## 6. Testing against absent AI

The evidence harness treats AI failures as **environmental, not defects**. Console-error
allowlists in every steps file include `/automation\/AI\./`:

```js
// scripts/beta-harness/steps/*.mjs — ENVIRONMENTAL_ERRORS
/automation\/AI\./,          // the AI backend is a separate package
'/nuxeo/logout',
'/agentic-ui-config/bootstrap.json',
'/agentic-ui-config/manifest.json',
```

Those suppressions are **listed in the `beta:audit` output** on every run, because a suppression
nobody has to look at is how a real regression stays invisible.

## 7. What to do if you own this area

| Action                                                          | Why                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Add specs to `ai-client` and give it a `test` target            | 457 lines, zero tests, invisible to the coverage ratchet       |
| Confirm who owns the AI backend, and its cost model             | Every AI feature depends on it                                 |
| Establish whether returned NXQL is validated anywhere           | A real, unexamined trust boundary                              |
| Remove `openai` from `dependencies`                             | It is unused and actively misleading                           |
| Add server-side entitlement, if AI is to be licensed separately | The flag is currently client-side and per-session              |
| Add usage telemetry                                             | We cannot answer basic adoption questions                      |
| Document the backend's data-residency behaviour                 | Customers will ask whether content leaves their infrastructure |
