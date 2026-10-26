---
title: Scalability & Operations
parent: Executive / Leadership
order: 6
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Scalability & Operational Model

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
>
> Much of this page reports **absence**. That is the accurate answer: this is a Beta with zero
> customers, and the operational apparatus a production deployment needs largely does not exist
> yet. Naming the gaps is more useful than describing a model we have not built.

---

## 1. The good news: there is almost nothing new to operate

The application is **static assets served by the customer's existing Nuxeo Tomcat**, installed as
a marketplace package. There is:

- no new server to run,
- no new database,
- no new network path,
- no new scaling dimension.

**The runtime infrastructure delta for a customer is close to zero.** That is a genuine and
underrated operational advantage, and it is why the cost model has no infrastructure line of its
own.

---

## 2. Scalability

| Dimension                | Position                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client scaling**       | Per-browser. Scales with users trivially — it is a static bundle                                                                                                                                         |
| **Nuxeo API load**       | The real dimension. Every user action is one or more Nuxeo calls, and **there is no client-side caching layer.** Load scales linearly with active users                                                  |
| **Search load**          | OpenSearch, sized by the customer's existing estate                                                                                                                                                      |
| **Initial page weight**  | 2.86 MB eager (up from 1.71 MB when adf-core became eager). Total shipped 4.90 MB against a 6 MiB ceiling. **Matters on constrained networks** and the real fix — lazy adf-core — is explicitly deferred |
| **Agent scaling**        | **Not applicable.** No agent runtime exists here                                                                                                                                                         |
| **LLM scaling**          | **Not applicable to this repository.** The 12 `AI.*` operations scale wherever that backend runs                                                                                                         |
| **Concurrent workloads** | No server-side component of ours, so no concurrency model of ours                                                                                                                                        |

**The honest scaling statement:** this UI does not introduce a scaling bottleneck of its own. It
increases load on the customer's existing Nuxeo and OpenSearch, and the absence of client-side
caching means that increase is not damped. Nobody has measured requests per user session — see
[Cost & TCO §4](03-cost-and-tco.md), measurement #6.

---

## 3. Multi-tenancy and customer isolation

| Concern                     | Position                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenancy               | **The UI has no notion of it.** Tenancy is Nuxeo's, and the UI inherits whatever the server enforces                                                                        |
| Data isolation              | Nuxeo ACLs. The UI is not a security boundary — it decides what is _offered_; Nuxeo decides what is _permitted_                                                             |
| Config isolation            | Per installation: the configuration packages installed on that server. Fragments are the same for every user, so there is **no per-tenant or per-user scoping** (NXSAT-312) |
| Customer code isolation     | Complete — their library is in their repository, built by them                                                                                                              |
| Cross-customer blast radius | A defect in our published package affects every customer on that version. Mitigated by semver, the API-surface gate and the upgrade rehearsal                               |

Since NXSAT-312 configuration is installation-wide: every user gets the same fragments, so
per-tenant configuration would need new machinery. The earlier manifest-as-Nuxeo-document design,
which inherited Nuxeo's scoping, is gone.

---

## 4. Failure domains

| Failure                        | Effect                                                 | Detection today                                                          |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Nuxeo unavailable              | App renders shells, no data                            | User-visible. `phase-0-no-backend` evidence asserts it degrades honestly |
| OpenSearch unavailable         | Search and aggregations fail                           | User-visible                                                             |
| **AI backend absent**          | HTTP 500 on any AI feature. **Expected**, not a defect | User-visible                                                             |
| ARender unavailable            | Rich preview unavailable; other previews work          | User-visible                                                             |
| SMTP unavailable               | Permission-notification emails fail                    | Surfaced as a mail-send failure message                                  |
| A bad Layer 0 config           | Falls back to defaults                                 | Validated on load                                                        |
| A bad Layer 1 manifest         | Unknown IDs **fail open** — entries stay visible       | Deliberate, so a typo cannot strip working actions                       |
| A bad customer Layer 2 library | Their blast radius, their support boundary             | Their CI, if they run the guardrail                                      |

**Pattern worth noting:** every failure is user-visible rather than silent, which is the right
default for a UI. The exception is the one that matters most — a **renamed slot** silently inerts
a customer's manifest entry, and only the upgrade rehearsal catches that class.

---

## 5. Observability — the biggest operational gap

| Signal                         | Status                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| APM / tracing                  | **None**                                                                 |
| Structured logging             | **None**                                                                 |
| Metrics export                 | **None**                                                                 |
| Error reporting (Sentry-class) | **None**                                                                 |
| Real-user monitoring           | **None**                                                                 |
| Feature-flag telemetry         | **None** — AI features are flagged in `sessionStorage` with no reporting |

What exists is **development-time** observability: console-error assertions during evidence
capture, a CI bundle-size ceiling, bundle-content checks, a coverage ratchet, axe scans, and the
phase-state gate.

**Consequence, stated plainly: we could not diagnose a customer incident.** There is no
telemetry, no error aggregation and no way to know a customer is experiencing a problem unless
they tell us. The cost of a production incident is therefore unbounded, because diagnosis has no
tooling.

**This is the highest-priority operational investment before a customer goes live**, and it is
not currently in any phase of the plan.

---

## 6. Supportability

| Capability                         | Status                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproducing a customer issue       | **Partly** — ~20 per-ticket evidence runners (`NXSAT-*`) exist as a pattern for capturing before/after against a live Nuxeo                  |
| Knowing the customer's version     | Their installed package version; no phone-home                                                                                               |
| Knowing their configuration        | Their configuration package — readable **if** they share it                                                                                  |
| Distinguishing our bug from theirs | The support boundary is architecturally clear (their library, their repo) — **untested in practice**                                         |
| Escalation path for adf-hx defects | Established — `docs/adf-hx-upstream-findings.md`, written to be sent to the adf-hx team, requiring a version, a file path and a reproduction |
| Workaround register                | `docs/adf-hx-workarounds.md`, gated **in both directions**: a marker without a row, or a row without a marker, fails the build               |

That last row is a genuinely good practice: every workaround forced by an upstream defect is
tracked at the code _and_ in a register, and leadership can read the count.

---

## 7. Deployment and upgrade

| Aspect                          | Position                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Deployment unit                 | Maven marketplace package: the Angular app + a small Java/OSGi bundle                                                           |
| Install                         | Nuxeo marketplace install; assets served by Nuxeo's Tomcat                                                                      |
| Config seeding                  | Ships no configuration file; our defaults are a contribution in our bundle, and a customer's configuration is their own package |
| Upgrade of our app              | Overwrites the app directory; customer configuration packages are untouched — rehearsed (NXSAT-312)                             |
| Upgrade of the platform library | Customer's `npm version` bump, then their build                                                                                 |
| Rollback                        | Nuxeo marketplace package rollback. **Not verified in repository**                                                              |
| Zero-downtime                   | **Not verified.** Depends on the customer's Nuxeo deployment topology                                                           |
| Release automation              | `release.yml` (manual dispatch), `build-marketplace.yml`, `changelog.yml`                                                       |

Not owning the customer's file is the operationally important detail, and its reasoning is
recorded in `install.xml`. Two earlier designs were wrong. One placed the file in `nxserver/web`,
which is **not a Tomcat docBase**, so it was never served. The other installed it with
`overwrite="false"`, documented as preserving edits. A rehearsal showed the upgrade then failing on
the edited file and leaving **no version installed** — the app 404 until fixed by hand (NXSAT-317).
`checkInstallerOwnsNoCustomerFile` now fails the build if either comes back.

---

## 8. What to build before a customer goes live

Ranked.

| #   | Investment                                          | Why                                                                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Error reporting + basic RUM**                     | Without it we learn about incidents from the customer, and cannot diagnose them                                                      |
| 2   | **Structured client logging with a correlation id** | Ties a user report to Nuxeo server logs                                                                                              |
| 3   | **A support runbook**                               | Which config to collect, how to reproduce, how to tell our bug from theirs                                                           |
| 4   | **Rollback rehearsal**                              | The upgrade path is tested; the _rollback_ path is not                                                                               |
| 5   | **Client-side caching for repeated reads**          | Damps Nuxeo load; also improves perceived performance                                                                                |
| 6   | **Lazy adf-core**                                   | Recovers ~1.15 MB of eager bundle. Explicitly deferred, and the ceiling note says do not raise the limit again without attempting it |

Items 1–3 are the difference between "a Beta we can support" and "a Beta we hope nobody has
trouble with".
