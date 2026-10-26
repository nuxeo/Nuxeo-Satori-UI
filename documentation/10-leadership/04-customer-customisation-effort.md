---
title: Customer Customisation Effort
parent: Executive / Leadership
order: 4
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: leadership
---

# Customer Customisation Effort

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
>
> **No effort figures on this page are measured.** No customer has customised this product, and
> no engagement has been instrumented. Effort bands below are **structural inferences** — derived
> from what a change mechanically requires (a file edit? a build? a deployment? a test suite?) —
> and are labelled as such. Treat them as a model to calibrate, not as estimates to quote.

---

## 1. The complexity model

| Customisation type                                            | Effort band | Technical skill                             | Build?         | Risk                                                                                        | Maintenance burden                                                  |
| ------------------------------------------------------------- | ----------- | ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Layer 0** — branding, theme tokens, languages               | Hours       | Edit JSON + know CSS variables              | **No**         | Low — a bad token is visible immediately                                                    | **None.** Survives upgrade by construction                          |
| **Layer 0** — feature toggles                                 | Hours       | JSON                                        | **No**         | Low                                                                                         | None                                                                |
| **Layer 1** — hide / relabel / reorder an existing entry      | Hours       | JSON + know the ID                          | **No**         | Low–medium — a wrong ID **fails open**, so the entry stays visible rather than disappearing | Low. **But: a renamed slot in a future release silently inerts it** |
| **Layer 1** — add an entry pointing at a registered component | Hours–days  | JSON + understand the registry              | **No**         | Medium — needs the component and the route to exist                                         | Low                                                                 |
| **Layer 2** — a rule                                          | Days        | TypeScript, Angular DI                      | Yes, theirs    | Medium                                                                                      | Their code, their tests, revalidate per upgrade                     |
| **Layer 2** — an action handler                               | Days        | TypeScript                                  | Yes, theirs    | Medium                                                                                      | As above                                                            |
| **Layer 2** — a component                                     | Days–weeks  | Angular: signals, standalone, DI, templates | Yes, theirs    | Medium–high — needs the host to resolve it by ID, and **a route**                           | As above                                                            |
| **Layer 2** — a whole feature area                            | Weeks       | Angular + Nuxeo API knowledge               | Yes, theirs    | High                                                                                        | Significant                                                         |
| **Nuxeo server-side** — config fragments, ACLs, doctypes      | Days        | Nuxeo administration                        | Server restart | Medium–high                                                                                 | Existing Nuxeo skillset                                             |
| **Integration** with the customer's own systems               | Weeks       | Full-stack                                  | Yes            | High                                                                                        | Theirs entirely                                                     |
| **Deployment** — their own marketplace package + CI           | Days        | Maven, CI                                   | Yes            | Medium                                                                                      | Per release                                                         |
| **Migrating a customised Web UI**                             | **Unknown** | —                                           | —              | **Unknown**                                                                                 | **Not verified in repository** — nothing addresses this             |

---

## 2. What the bands are actually based on

Because "hours vs days" needs a basis, here is the mechanical difference:

| Band      | What the customer must do                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hours** | Edit one JSON fragment (Layer 0 or Layer 1) in their configuration package and install it. No application build, no test suite, no CI. Takes effect the next time the application is opened    |
| **Days**  | Generate scaffolding, implement a handler or rule, run 5 guardrail checks, write a spec asserting registry state, build their library, add a provider line, wire a route, deploy their package |
| **Weeks** | The above, several times, plus their own design system, their own tests at whatever bar they hold, and integration with their systems                                                          |

The **step change is between Layer 1 and Layer 2**, and it is a step change in _kind_: from
editing configuration to owning a build pipeline, a test suite and a release process.

---

## 3. What genuinely reduces Layer 2 effort

Verified present, and shipped inside the package:

| Accelerator                                          | Removes                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 4 Nx generators                                      | Boilerplate, registration wiring, spec scaffolding, tsconfig/vite setup — the generated library registers **live**, not merely present |
| Guardrail script — 5 checks                          | The 5 mistake classes actually made in this repository. An agent can verify itself before human review                                 |
| `AGENTS.md` + extension reference, shipped as assets | The agent inferring the architecture and getting it wrong                                                                              |
| The forkable template                                | Ships **no design system**, so the customer adds theirs instead of removing ours                                                       |
| Upgrade rehearsal pattern                            | Uncertainty about whether their work survives — reproducible in their own CI                                                           |

**Two frictions a customer will hit**, both verified:

- **The generated nav entry needs a route.** Registering a path does not create one; until the app
  maps it, the entry falls through the wildcard to the wrong page. This shipped in the reference
  app for two commits. Now printed by the generator and in the generated README.
- **Assert `false`, not `true`.** An _unregistered_ rule ID also evaluates to `true`, so a test
  expecting `true` passes whether or not registration happened.

---

## 4. The distribution of effort is the whole business case

```text
If Layers 0/1 cover MOST requests:
    engagement = days of configuration
    → repeatable, PS-deliverable, low marginal cost, boundary intact

If Layers 0/1 cover FEW requests:
    engagement = a software project
    → per-customer code, per-customer upgrade risk, boundary under pressure
```

**This distribution has never been measured**, and it is RFC risk **R8**. The RFC's own
mitigation was to fix the addressable surface _before Phase 2_, informed by real customer
requests. Phase 2 completed without that input.

Reinforcing evidence that the surface may be too narrow: **4 of the 8 slots are reserved** —
`routes`, `toolbar`, `contextMenu`, `tabs` are read by nothing. A customer wanting a document
toolbar action cannot do it in Layer 1 today, so it becomes Layer 2 work.

### The measurement

| Step    | Detail                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------- |
| Input   | 10 real customisation requests from The Church + one other account                                      |
| Method  | Attempt each using Layer 0/1 only. Where it fails, record _why_ — missing ID, reserved slot, needs code |
| Output  | A ratio, and a prioritised list of surface gaps                                                         |
| Effort  | Days                                                                                                    |
| Unlocks | Cost per customer, PS pricing, and whether to widen Layer 1 before Beta                                 |

**This is the highest-value unmeasured number in the programme.**

---

## 5. Risk profile by layer

| Layer | Failure mode                   | Blast radius                                                                                | Recovery                                                       |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0     | Malformed JSON, bad token      | Cosmetic or a failed load                                                                   | Edit the file. Config is validated and falls back to defaults  |
| 1     | Unknown ID                     | **Fails open** — the entry stays visible. Deliberate: a typo must not strip working actions | Edit the manifest fragment. It is versioned with their package |
| 1     | Slot renamed upstream          | **Silent** — entry disappears, app still boots and compiles                                 | Only `beta:upgrade`'s slot check catches this class            |
| 2     | Defective component            | Their code, their support boundary                                                          | Their release process                                          |
| 2     | Deep import into our internals | Breaks on our next release **without that being a breaking change**                         | Guardrail check 2 rejects it — if they run it                  |
| Nuxeo | Bad server config              | Server-wide                                                                                 | Nuxeo administration                                           |

**Note on Layer 1 fail-open:** it is the right default, because Layer 1 visibility is **not an
authorisation boundary** — server-side Nuxeo permissions still decide what succeeds. The
exception is three security-relevant rules that fail **closed**, because the dangerous window is
exactly the one before registration happens.

---

## 6. What we should tell a customer today

| Question                                    | Honest answer                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Can we rebrand it?"                        | Yes — configuration, no build, and it survives our upgrades. Mechanically proven                                   |
| "Can we change the navigation and actions?" | Yes for the live slots, via a manifest, no build. **Not** for toolbar, context menu or tabs yet                    |
| "Can we add our own features?"              | Yes — your own library against our published API, in your repo. Days to weeks depending on scope                   |
| "Will our work survive your upgrades?"      | We test exactly that on every build. The mechanism is proven; **no customer has yet lived through a real upgrade** |
| "How long will our customisation take?"     | **We do not know yet.** We would like your backlog to find out — that is the design-partner ask                    |
| "Can your AI do it for us?"                 | It accelerates _your_ developer. It does not replace one, and it presumes human review                             |
| "Can we migrate our customised Web UI?"     | **Nothing in the product addresses this.** Open question                                                           |

The fifth row is the one to lead with. Converting "we do not know" into a **joint discovery
exercise** is both honest and the most useful thing a first customer can give us.
