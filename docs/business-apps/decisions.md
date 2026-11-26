# Decisions

Every decision the business apps work depends on, in one place: who decides, by which phase of
the [development plan](development-plan.md), and what is already settled. Owners are proposals
until phase 0 confirms them.

Updated 26 November 2026.

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

- **2, the Payers kit's appeals (25 November 2026).** Built against the same recommendation: the
  kit's version 0.4.1 adds an appeal's checklist to its stand-in model, `case:checklist`, and to
  its Case page a checklist and a timeline, with a second appeal and its denied claim in the seed,
  and phase 2's demo step 6 is a steps file
  ([the kit's README](../../business-apps/packages/payers-claims-demo/README.md#the-appeals)). An
  appeal is a business record, a Case, and nothing in it is a workflow: no route model, no task,
  and no lifecycle of its own. The checklist card is the platform's, layout version 2's
  ([layout-v2.md](layout-v2.md), section 7), and stays whichever way decision 2 goes. If it goes
  the other way, the kit drops the Case page's two cards, their labels, `case:checklist` and the
  seed's second appeal, a minor version below 1.0.0, since a property and labels are removed.
  Decision 3 stays open: the checklist is read-only, and ticks no item through a button or a chain.

- **3, operation buttons (25 November 2026).** Built against the recommendation, "Yes, through a
  per-deployment allow-list (parity decision 3)": configuration may bind a button to an Automation
  chain or operation, and only one the server's own allow-list holds
  ([app-definition-v2.md](app-definition-v2.md), section 5). The allow-list is a contribution to
  `org.nuxeo.agentic.ui.operations` in `nuxeo-agentic-core`, on B's recommendation that the runtime
  essentials live there, which the server's administrators install in `nxserver/config/`, never a
  package: the server reads it from nowhere else, and the pipeline refuses a package that
  contributes to it. It names each chain, the permission, and the apps, groups, record types and
  states that run it, and each parameter an app may give it, with its type and its source. The app
  registry serves an app's `actions.json` with only what it allows, and `AgenticUi.RunAction`
  checks it again, with the person's permissions, before it runs a chain as them; the request never
  names the chain. A chain meant only for buttons begins with `AgenticUi.RequireRunAction`, which
  refuses any other run, Nuxeo's own Automation endpoint and `RunOperation` among them. The
  Payers kit's "Request medical records" runs on it, phase 2's demo step 4, from a steps file not
  run yet. The security review of operation buttons, which phase 2's "Done when" asks for, is not
  done. What changes if 3 goes another way:
  - **No: configuration binds no chain.** The kit's two operation buttons and its operations
    component go, a minor version below 1.0.0; `actions.json` keeps lifecycle buttons only, and the
    validator refuses `operation`. The allow-list, the run endpoint and the client's buttons can be
    removed with them, or left, unused, since nothing reaches them without a contribution.
  - **Yes, with an allow-list per app or per tenant:** the contribution gains an `app` (or a tenant)
    attribute, and the registry and the run match it as well as the operation. The client does not
    change.
  - **Yes, through Nuxeo's own Automation endpoint, gated by REST bindings alone:** the client posts
    to the chain itself, and the registry stops filtering; the person's permissions and the
    bindings are then the only control, and a binding cannot check parameters.
  - **P3, the parity plan's decision,** is followed as it stands: a per-deployment allow-list.

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
- **B and E, the designer's deployment layer (25 November 2026).** Built against the
  recommendations: an app's deployment layer, a customer's own versions of its layouts and queues
  made in the designer and approved by a second administrator, is in `nuxeo-agentic-core`, beside
  the registry it overlays, because the customer's overlay is the configuration and app registry's,
  a foundation module, so a runtime essential (B); and the registry serves it after sign-in, to the
  app's groups (E) ([app-definition-v2.md](app-definition-v2.md), section 10). It is behind a
  switch, off by default (decision J), loads no code (decision 5), and cannot hold `actions.json`,
  so decision 3 is not touched. What changes if either goes another way:
  - **B, the registry in an add-on of its own or a separate service:** the layer's classes
    (`LayerService`, `LayerEndpoint`, `LayerStore`, `RepositoryLayerStore`,
    `NashornDeploymentValidator`, `ServerContentModel`) and its script `agentic-ui-validator/` move
    with the registry. A separate service needs the server's content model and a repository of its
    own to keep the layer in, and the validator then runs where Node does, as the same script.
  - **B, one large add-on:** the classes move into it as they are.
  - **E, app definitions served before sign-in, to everyone:** a live layer would be served by the
    configuration servlet, to everyone, one per server rather than one per app, and the record
    page would read it there. Drafts would still never be served, and the write addresses would
    keep their authentication.
  - **Parity decision P4,** one global configuration, still conflicts with E as recommended: the
    layer is one per app.
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

- **B, the records module's server add-on (26 November 2026).** Built against the recommendation,
  "one add-on per domain module": the disposition review is
  [`nuxeo-agentic-records`](../../nuxeo-agentic-records/README.md), a Maven module beside
  `nuxeo-agentic-core` with a Marketplace package of its own, which the records kit,
  [`records-demo`](../../business-apps/packages/records-demo/README.md), depends on; nothing of it
  went into `nuxeo-agentic-core`. It builds on the platform's retention module, `nuxeo-retention`,
  which its package depends on: Nuxeo publishes the module for LTS 2025, and the add-on reads its
  records, rules and holds rather than keeping its own. Decision 3 is not touched: the add-on
  registers no operation and no endpoint, and a person reaches it by filing a document, which a
  listener checks. Decision G, tenancy, is not built. What changes if B goes another way:
  - **One large add-on:** the bundle moves into that add-on's package as it is, with its dependency
    on `nuxeo-retention`, and the kit's `package.xml` depends on that package in place of
    `nuxeo-agentic-records`. The type, schema and permission names do not change.
  - **Into `nuxeo-agentic-core`:** every customer would then get the records components, which
    stay unresolved on a server without the retention module; so the records types would stop
    requiring the module's, and the review would be switched on by a setting instead, off by
    default.

- **D, the connectors add-on's first slice (24 November 2026).** Built against the
  recommendation: inside Nuxeo, as an add-on of its own, not a separate service.
  [`nuxeo-agentic-connectors`](../../nuxeo-agentic-connectors/README.md) is a Maven module beside
  `nuxeo-agentic-core`, and its Automation operation `Connector.Read` reads one record of another
  system by a key the document holds, after the reader's permission on the document, and returns
  the fields its connector allows. A kit contributes the connector; each server sets its address and
  credential. Layout version 2's `external` card shows the answer (layout-v2.md, section 7). What
  changes if D goes another way:
  - **A separate integration service, reached through Nuxeo:** `Connector.Read` calls the service
    instead of the system, and keeps the permission check. The card, the layout and the validator
    do not change.
  - **A separate service the client calls itself:** `ConnectorRecordService` in
    `libs/shared/document-layouts` gets the service's address, and the service must check the
    reader's permission on the record by asking Nuxeo as the reader, which needs decision F's
    tokens. The connectors' contributions, their credentials and their allow-lists move to the
    service's own configuration; the validator's `--registered` connectors stay as they are.
  - **F is not touched.** The connector calls the other system with its own credential, from the
    server's configuration, and does not pass the reader's sign-in on. So the other system's own
    access rules are not applied reader by reader: whoever may read the record sees its connector's
    fields. Token exchange, decision F, is what would change that.

- **5, the spike its recommendation asks for (25 November 2026).** Built as the recommendation
  says, "spike in phase 6": a prototype loader in `tools/plugin-spike`, which ships nothing, and
  [its report](spikes/plugins-decision-5.md), which compares the template build with signed,
  pinned plugins loaded at run time and ends with a recommendation and questions for the owners.
  It loads no customer code into the shipped app, and the decision stays open. Once it is taken,
  the prototype can go, with its two guards: `checkPluginSpikeIsolated` and the `type:spike` probes
  in `scripts/beta-harness/module-boundaries.mjs`.

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
