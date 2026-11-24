# Decisions

Every decision the business apps work depends on, in one place: who decides, by which phase of
the [development plan](development-plan.md), and what is already settled. Owners are proposals
until phase 0 confirms them.

Updated 24 November 2026.

## Open: from the plan

The numbering of the [plan's section 9](plan.md).

| #   | Decision                                                                                 | Recommendation                                                                    | Owner                 | Needed by |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------- | --------- |
| 1   | The position next to Web UI                                                              | Alongside Web UI first, with migration (phase 4), then instead of it              | Nuxeo product         | Phase 0   |
| 2   | Reopening the Beta scope decision that put workflow and business records out             | Reopen: phases 1 and 2 build both                                                 | Product               | Phase 0   |
| 3   | Configuration binding buttons to Automation chains on the server                         | Yes, through a per-deployment allow-list (parity decision 3)                      | Product, security     | Phase 2   |
| 4   | The security review of the registered computations and rules that decision 4 settled     | Review the starting set before phase 1 ends; name the reviewer in phase 0         | Security, engineering | Phase 1   |
| 5   | Loading customer code into the shipped app at run time, or building it from the template | Spike in phase 6; keep the template build until signed, pinned plugins are proven | Product, engineering  | Phase 6   |
| 6   | Access to the Satori design system for presales and partners                             | Grant it to presales for the Builder kit                                          | Satori owners         | Phase 3   |
| 7   | Who owns the starter kits                                                                | Product owns the platform and kits; presales owns each kit's demo script and data | Product, presales     | Phase 1   |
| 8   | The glossary                                                                             | Adopt the prototype's glossary                                                    | Product               | Phase 0   |

## Open: from the architecture

The letters of the [architecture's section 15](architecture.md).

| #   | Decision                                                              | Recommendation                                                                | Owner                       | Needed by      |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- | -------------- |
| B   | Packaging of the server tier                                          | `nuxeo-agentic-core` for the runtime essentials; one add-on per domain module | Engineering, platform       | Phase 0        |
| C   | Outside users: in the Beta scope, and how they sign in                | Share links in phase 5, invited outside users in phase 8                      | Product, security, platform | Phases 5 and 8 |
| D   | Connectors to systems of record                                       | Inside Nuxeo as an add-on; a separate service only when one needs it          | Engineering, platform       | Phase 7        |
| E   | App definitions served after sign-in, by group and tenant             | Yes, which reopens parity decision 4                                          | Product, engineering        | Phase 0        |
| F   | Token-based sign-in for the shell, token exchange for embedded panels | Yes for the shell before general availability; exchange in phase 7            | Security, engineering       | Phases 0 and 7 |
| G   | Tenancy for providers serving many client organisations               | Designed with the platform team                                               | Platform, engineering       | Phase 9        |
| H   | The e-signature service, and the CAD and BIM viewer                   | Chosen with procurement and presales                                          | Procurement, presales       | Phases 7 and 8 |
| I   | Protecting fields such as an insurance number                         | A platform decision, from the feasibility report                              | Platform                    | Phase 7        |

### Notes: work built against an open decision's recommendation

Each note records work that assumes a recommendation above before the decision is taken. A note
changes no decision's status: the decision stays open, and its owner may still take it another
way.

- **2, the Payers kit's claims review workflow (24 November 2026).** Built against the
  recommendation, reopen the Beta scope so that phases 1 and 2 build workflow and business records:
  the kit's version 0.4.0 contributes a route model, `PayersClaimReview`, with its two task forms
  and a claim lifecycle, and phase 2's first three demo steps are a steps file
  ([the kit's README](../../business-apps/packages/payers-claims-demo/README.md)). It is a
  configuration package's content, with no code in the client. If decision 2 goes the other way,
  the kit drops its workflow component, its zip, variable schemas, vocabulary and task forms, and
  claims go back to the default lifecycle, a minor version below 1.0.0; the task form engine, which
  is the platform's, stays. Decision 3 stays open: the workflow has no operation buttons.

- **B and E, the app registry's first version (24 November 2026).** Built against the
  recommendations: `nuxeo-agentic-core` carries the registry, as a runtime essential (B), and it
  serves app definitions after sign-in, to the groups each app's `app.json` names (E). Tenants are
  phase 9's, so groups only. Seeing an app is not a security control: Nuxeo's permissions still
  decide which records anyone reads. What changes if either goes another way:
  - **B, the registry in an add-on of its own or a separate service:** the `<app>` element,
    `AppRegistryEndpoint` and `AgenticUiAppsServlet` move together, out of
    `nuxeo-agentic-core`. Every package's `<app>` then targets the new component and `<require>`s
    it, and the pipeline's step 2, which holds `<app>` to `org.nuxeo.agentic.ui.config`'s
    `configuration` point, holds it to the new one. A separate service needs
    `/nuxeo/agentic-ui-apps/` routed to it, or the client's `APP_REGISTRY_PATH` changed. The
    client's reads, `APP_DEFINITION_FILES`, stay as they are.
  - **E, app definitions served before sign-in, to everyone:** the registry's path loses its
    authentication filter and chain, and the group filter goes, so `groups` only decides what
    "Switch app" offers, in the browser. The client could then read the registry with the
    configuration, before sign-in, and the page would no longer reload when a sign-in changes the
    app open. If tenants come with their own overlays (decision G), the registry's `Viewer` gains
    the tenant and the listing filters by it too; the contribution and the client do not change.
  - **Parity decision P4,** one global configuration, still conflicts with E as recommended:
    the registry serves a configuration per app and group.
- **B, the assets module's server add-on (24 November 2026).** Built against the recommendation:
  rights on assets are `nuxeo-agentic-assets`, a Maven module beside `nuxeo-agentic-core` with a
  Marketplace package of its own, which the brand assets kit depends on; nothing of it went into
  `nuxeo-agentic-core`. It enforces the rights half of the plan's rights and sharing add-on at the
  platform's download permission. Share links, decision C, are not built. What changes if B goes
  another way:
  - **One large add-on:** the module's bundle moves into that add-on's package as it is, and a kit's
    `package.xml` depends on that package in place of `nuxeo-agentic-assets`. The component names a
    kit's policy requires, `org.nuxeo.agentic.assets.rights`, do not change.
  - **Into `nuxeo-agentic-core`:** the same classes and components in that bundle, the dependency
    dropped from the kit, and every customer then gets the download permission, which refuses
    nothing until a policy is contributed.

## From the Studio parity plan

Taken on 19 November 2026 in the Studio parity plan, `docs/nuxeo-studio-parity-plan.md` on the
`fix/nuxeo-studio-evaluation-ca2a58` branch, which this branch does not have.

| #   | Decision                                 | Outcome                                           | Here                                                                                                              |
| --- | ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P1  | Draft and published storage              | Files in a package                                | Kept: app definitions are packages                                                                                |
| P2  | Free JavaScript or HTML in configuration | No                                                | Kept: the migration turns free code into plugins or reports it                                                    |
| P3  | Operations a button may call             | A per-deployment allow-list                       | Kept: plan decision 3 follows it                                                                                  |
| P4  | Users and scope                          | Customer administrators, one global configuration | **Conflicts with decision E.** Business apps need a configuration per app, group and tenant. To reopen in phase 0 |
| P5  | Custom CSS upload                        | No: tokens and images only                        | Kept: a migrated theme is a token map and a logo                                                                  |
| P6  | Per-node variables from the server       | Open there                                        | Settled: the server sends each step's variable schema (below)                                                     |

## Settled

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | How it was settled                                                                      | When             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| The server sends each workflow step's variable schema, so task forms are client work                                                                                                                                                                                                                                                                                                                                                                                                                                    | Checked on Nuxeo 2025 ([feasibility](feasibility.md))                                   | 21 November 2026 |
| Page provider definitions are readable over REST, with their aggregates                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Checked on Nuxeo 2025                                                                   | 21 November 2026 |
| Nothing lists a document's allowed lifecycle transitions: a small enricher of ours                                                                                                                                                                                                                                                                                                                                                                                                                                      | Checked on Nuxeo 2025                                                                   | 21 November 2026 |
| Picture, video and audio types, picture views, renditions and conversions already exist                                                                                                                                                                                                                                                                                                                                                                                                                                 | Checked on both local servers ([architecture](architecture.md), section 2)              | 21 November 2026 |
| Nuxeo can grant time-limited access to an outside person by email                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `Document.AddPermission` takes `begin`, `end`, `email`; how they sign in is not checked | 21 November 2026 |
| Retention, legal hold and template operations need add-ons                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Absent on both servers                                                                  | 21 November 2026 |
| A Studio package's data model needs no conversion; only its Web UI files do                                                                                                                                                                                                                                                                                                                                                                                                                                             | Read from a sample package ([migration](studio-migration.md))                           | 21 November 2026 |
| The migration reads the Web UI files, not Studio's `.metadata` layouts                                                                                                                                                                                                                                                                                                                                                                                                                                                  | They differ in the sample                                                               | 21 November 2026 |
| Account names stay out of this public repository; documents count accounts by group                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decided by the plan's author                                                            | 21 November 2026 |
| The prototype is built in CI and never committed, because it carries Satori's theme and icons                                                                                                                                                                                                                                                                                                                                                                                                                           | Decided with the Satori owners, recorded in the Pages workflow                          | 21 November 2026 |
| Where the work is built (decision J): in this repository, not a fork, on the integration branch `integration/enterprise-grade-app`, following [AGENTS/06-git-workflow.md](../../AGENTS/06-git-workflow.md). Every pull request for the work targets it, `main` is merged in at least daily, and it reaches `main` in one final pull request. New code goes in new projects behind switches. Customer material (Studio packages, configuration packages, account names, real data) goes in a separate private repository | Decided by the plan's author; the branch was created from `main`                        | 21 November 2026 |
| The integration branch is protected like `main`: it is a target of the `main_branch` ruleset, so every pull request into it needs an approving review                                                                                                                                                                                                                                                                                                                                                                   | Decided by the plan's author                                                            | 22 November 2026 |
| Until the plan is implemented, SonarCloud, the accessibility checks and the security scans run but are not chased; phase 10 brings them back to green. CodeQL still blocks a merge with a high-severity finding, through the ruleset                                                                                                                                                                                                                                                                                    | Decided by the plan's author                                                            | 22 November 2026 |
| Decision 4, the expression set for layouts: registered computations and rules only, with no expression language and no JavaScript. The starting set: `core.age`, `core.template` (rendered as text, never HTML), `core.sum`, `core.count`, `core.dateDiff` and `core.choose`; rules on a field's value, the lifecycle state and the user's group, combined with `core.every`, `core.some` and `core.not`. Anything else is a Layer 2 registration in code, reviewed and built in                                        | Decided by the plan's author for engineering; its security review is open above         | 22 November 2026 |
| Decision A, packaging of the client tiers: one package, `@nuxeo/satori-platform`, with each domain module as its own entry point (`@nuxeo/satori-platform/modules/<name>`). A module moves into a package of its own only when it needs its own release cadence or licence. Most customers get every module in the prebuilt app either way, and each published package would need the five publication gates                                                                                                            | Decided by the plan's author, replacing the architecture's first recommendation         | 22 November 2026 |
