---
title: Architecture for Leadership
parent: Executive / Leadership
order: 2
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Architecture for Leadership

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
> Strategic view. Engineering detail: [Architecture](../30-engineering/02-architecture.md).

---

## The picture

```text
        ┌─────────────────────────────────────────────────────┐
        │  CUSTOMER OWNS                                      │
        │  ├─ Layer 0 config  (JSON — survives our upgrades)  │
        │  ├─ Layer 1 manifest (JSON — in their own package)  │
        │  └─ Layer 2 library  (their repo, their build)      │
        └────────────────────────┬────────────────────────────┘
                                 │ depends on, by version
        ┌────────────────────────┴────────────────────────────┐
        │  WE OWN AND VERSION                                 │
        │  ├─ @nuxeo/satori-platform  (npm, 4 entry points)   │
        │  ├─ The application  (marketplace package)          │
        │  └─ Layer 3 harness  (generators + guardrails,      │
        │                       shipped INSIDE the package)   │
        └────────────────────────┬────────────────────────────┘
                                 │ HTTP
        ┌────────────────────────┴────────────────────────────┐
        │  CUSTOMER'S EXISTING ESTATE                         │
        │  Nuxeo Server · OpenSearch · ARender · SMTP         │
        └────────────────────────┬────────────────────────────┘
                                 │
        ┌────────────────────────┴────────────────────────────┐
        │  SOMEWHERE ELSE                                     │
        │  12 AI.* operations — a SEPARATE marketplace        │
        │  package, NOT in this repository                    │
        └─────────────────────────────────────────────────────┘
```

## The four things that matter strategically

### 1. The boundary is real, and it is enforced by machinery

The line between "we own it" and "the customer owns it" is not a convention — it is enforced:

| Guarantee                                   | Mechanism                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Their config survives our upgrade           | It is their own package; ours installs no configuration file; rehearsed (NXSAT-312) |
| Their wiring survives our upgrade           | The manifest is a fragment in **their** package, not a bundled file                 |
| Their code depends only on published API    | 4 entry points; a guardrail rejects deep imports                                    |
| Our public API cannot change by accident    | A 2,221-line snapshot gate                                                          |
| Their customisation survives a version bump | An upgrade rehearsal, run on every build                                            |

**Why leadership should care:** this is what makes a support boundary defensible, an upgrade
shippable, and a certification claim makeable. Without it, every customer is a fork.

### 2. Nothing about the AI features runs here

The 12 `AI.*` operations are HTTP calls to Nuxeo Automation. The intelligence is in a **separate
marketplace package**. Consequences:

- **This product incurs no LLM inference cost.** Any TCO model that assigns inference cost to
  Satori is mis-attributing.
- **"AI-powered" is not true out of the box.** Absent backend ⇒ HTTP 500.
- Ownership, cost and roadmap of that backend are **a separate decision** that gates every AI
  feature in the product.

### 3. The AI harness is build-time, and it ships to customers

Two distinct things share the name:

|                 | Runtime AI          | The harness                                       |
| --------------- | ------------------- | ------------------------------------------------- |
| Audience        | End users           | Developers — ours **and the customer's**          |
| Cost            | AI backend operator | Existing AI-tool subscriptions                    |
| In the package? | Client only         | **Yes — generators + guardrail + knowledge base** |

The harness shipping _inside_ the package is the unusual move: a customer's own AI agent is
treated as a first-class user of the product.

### 4. One package, one monorepo — simpler than planned

The RFC proposed 5+ npm packages and 3 repositories. Reality: **one** package with 4 entry
points, in **one** monorepo. Fewer things to version, fewer to support, and the adf-hx bridge is
deliberately _not_ published — which is what keeps third-party types out of our public API.

---

## What is architecturally strong

| Strength                                           | Why it matters commercially                                     |
| -------------------------------------------------- | --------------------------------------------------------------- |
| Configuration survives upgrade **by construction** | Removes the single largest historical customisation complaint   |
| Customisation addressed **by ID, not class name**  | We can refactor internals without breaking customers            |
| Layer boundaries **machine-enforced**              | Prevents the architecture eroding under delivery pressure       |
| adf-hx components shared with Alfresco             | Component investment is shared, not duplicated                  |
| Verification apparatus                             | The credible answer to "how do you ship AI-written code safely" |

## What is architecturally thin

| Weakness                                     | Consequence                                                   |
| -------------------------------------------- | ------------------------------------------------------------- |
| **No production observability**              | We could not diagnose a customer incident                     |
| **4 of 8 extension slots reserved**          | Narrower addressable surface than advertised                  |
| **Eager adf-core** — +1.15 MB initial bundle | Slower first load for every user; the real fix is deferred    |
| **No client-side caching layer**             | Every action hits Nuxeo                                       |
| **No multi-tenancy in the UI**               | Tenancy is Nuxeo's; the UI has no notion of it                |
| **AI backend is an external dependency**     | Every AI feature is gated on something we do not control here |

---

## Deployment, in one paragraph

The Angular application is built, assembled into a Maven marketplace package alongside a small
Java/OSGi bundle, and installed into Nuxeo. Static assets are served by Nuxeo's Tomcat. There is
**no separate server to run and no new infrastructure** — which is a genuine operational
advantage, and the reason the runtime cost delta for a customer is close to zero.

Configuration is not a file on the server. A customer ships it in their own Marketplace package,
which depends on ours; our Java bundle serves every package's fragments, and our package installs
no configuration file (NXSAT-312). Upgrading ours with two customer packages installed was
rehearsed and served the same configuration. Two earlier designs, both of which kept a
customer-edited file on the server, each caused a defect. One installed to a path that is not a
docBase and **would have 404'd on every install** — it was recorded complete before that was
caught, which is why the phase-state gate now exists. The next installed the file itself with
`overwrite="false"`, documented as upgrade-safe; the first real rehearsal showed an upgrade after a
customer edit left **no version installed** (NXSAT-317).

---

## The strategic risk, stated once

We have built a platform for a customisation pattern **we have not yet confirmed customers want
in the shape we built it**. The architecture is sound; the open question is whether the
addressable surface matches real demand. That is RFC risk R8, it is measurable in days, and it
should be measured before further platform investment.

See [Risks & Opportunities](07-risks-and-opportunities.md).
