# Decisions

Every decision the business apps work depends on, in one place: who decides, by which phase of
the [development plan](development-plan.md), and what is already settled. Owners are proposals
until phase 0 confirms them.

Updated 27 November 2026.

## Until the app is finished: every open decision on its recommendation

Decided by the plan's author on 26 November 2026. Every decision below that is still open is
acted on as its recommendation says, until the app is finished; then each is taken with its owner,
and the notes below say what each piece of work assumes and what changes if the decision goes
another way. Acting on a recommendation takes no decision: each stays open, and its owner may
still decide it another way. The security reviews wait until then too
([security-reviews.md](security-reviews.md)).

Five recommendations need someone outside the work before anything can follow them, so they wait
for their owners rather than being acted on:

- **4,** the security review of the registered computations and rules, which waits with the
  others;
- **6,** access to the Satori design system for presales, which its owners grant;
- **G,** tenancy, which is designed with the platform team;
- **H,** the e-signature service and the CAD and BIM viewer, chosen with procurement and presales;
- **T,** telemetry, whose recommendation is to build nothing until its privacy and security reviews
  are done, so nothing that sends anything is built meanwhile ([telemetry.md](telemetry.md)).

**I,** protecting fields such as an insurance number, is a platform decision from the feasibility
report. Until it is taken, a field that must not be shown to a group is left out of that group's
layout, not masked, as the Payers kit leaves out the social security number for adjusters.

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
  Since 0.6.0 it ticks through a document update, the next note.

- **2, the Payers kit's open appeals, and its checklist ticked (26 November 2026).** Built against
  the same recommendation: the kit's version 0.6.0 adds an open-appeals queue, with its page
  provider, `payers_open_appeals`, its two facets, a KPI card on member services' and supervisors'
  home and an entry in their menu, a third appeal and its denied claim in the seed, and
  `"tickable": true` on the Case page's checklist, with member services given `ReadWrite` on the
  seeded cases so that the appeals' specialist ticks an item; demo step 6's steps file covers both
  ([the kit's README](../../business-apps/packages/payers-claims-demo/README.md#the-appeals)). An
  appeal is still a Case, and nothing in it is a workflow: the prototype's appeal review workflow
  is not built. Ticking is the platform's, layout version 2's `tickable`
  ([layout-v2.md](layout-v2.md), section 7), a document update through the path the Edit form uses,
  and stays whichever way decision 2 goes. If it goes the other way, the kit drops the queue, its
  page provider, its two search fields, its labels, its home card and menu entry, the third appeal
  and member services' write on cases, a minor version below 1.0.0. Decision 3 is not touched: a
  tick runs no chain and no button.

- **2, the Payers kit's appeal review workflow (26 November 2026).** Built against the same
  recommendation: the kit's version 0.7.0 adds a second route model, `PayersAppealReview`, with
  its task form, variables, chains, filter and vocabulary, an appeal's decision, `case:decision`,
  and to the claims review a start that reopens a denied claim, for the system an overturned
  appeal's chain runs as and an administrator only. A member services specialist upholds or
  overturns an appeal's denial; overturning reopens the claim for a new determination, and either
  decision writes the checklist's decision letter item. A steps file covers it, and the claims
  review's steps file now covers Send back
  ([the kit's README](../../business-apps/packages/payers-claims-demo/README.md#the-appeal-review-workflow)).
  If decision 2 goes the other way, the kit drops the appeal review with the claims review, and
  `case:decision`, a minor version below 1.0.0. Decision 3 is not touched: the decision is a task
  of the route model, and runs no button.

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

- **4, a rule over two dates, a linked record's property, and a facet's records (26 November
  2026).** Built on decision 4's settled shape, for the moves kit's build
  ([its README](../../business-apps/packages/moves-demo/README.md), "Phase 8 feedback", items 2 to
  4). One rule joins the registered set, `app.rules.dateAfter`, a rule on two of the record's
  values and a number of days, in code and reviewed with this pull request
  ([layout-v2.md](layout-v2.md), section 5). A rule reading a computation was asked for "if it
  fits decision 4's shape" and is not built: it would let rules and computations nest in each
  other, which is the expression language the decision refused, and section 5 says why. `show` on
  `document-link` (section 12) and a facet's `"widget": "document-link"`
  ([app-definition-v2.md](app-definition-v2.md), section 4) are widgets' parameters, not rules or
  computations: they read the linked records through the REST API as the reader. The open security
  review of decision 4's set, item 4 above, covers the new rule ([security-reviews.md](security-reviews.md)); it waits until the app is
  finished, as every security review does. What changes if the review goes another way: the rule
  is unregistered, and the moves kit's late-filing banner goes, a minor version below 1.0.0.

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
  platform's download permission. Share links, decision C, came in its version 0.2.0 (C, below). What changes if B goes
  another way:
  - **One large add-on:** the module's bundle moves into that add-on's package as it is, and a kit's
    `package.xml` depends on that package in place of `nuxeo-agentic-assets`. The component names a
    kit's policy requires, `org.nuxeo.agentic.assets.rights`, do not change.
  - **Into `nuxeo-agentic-core`:** the same classes and components in that bundle, the dependency
    dropped from the kit, and every customer then gets the download permission, which refuses
    nothing until a policy is contributed.

- **B, media rights in the assets add-on (26 November 2026).** Built against the recommendation,
  "one add-on per domain module": territories, release windows, a localised version reading its
  film's windows, and delivery packages are
  [`nuxeo-agentic-assets`](../../nuxeo-agentic-assets/README.md#media-rights-territories-windows-and-deliveries)
  0.4.0, since they are an asset's rights, decided at the same endpoints as its rights end; the
  media kit, [`media-demo`](../../business-apps/packages/media-demo/README.md), depends on it.
  A delivery is a document filed, a `MediaDelivery`, which a synchronous listener decides, so
  decision 3 is not touched: no operation and no button. Decision C is not touched either: a
  delivery makes no share link and signs no one in. Decision G, tenancy, is not built. Its security
  review is deferred until the app is finished, as every security review is; it is installed
  nowhere. What changes if B goes another way:
  - **One large add-on:** the bundle moves into that add-on's package as it is, and the media kit's
    `package.xml` depends on that package. The `MediaDelivery` type, the `mdlv` schema and the
    policy's elements do not change, so no kit's files do.
  - **A media add-on of its own:** the delivery types and listener move into it, requiring
    `org.nuxeo.agentic.assets.rights`, whose service decides a delivery; the territories and
    windows stay in the assets add-on, since every download of an asset is decided there.

- **B, watermarks and the review held on the server, in the assets add-on (27 November 2026).**
  Built against the recommendation, "one add-on per domain module": a policy's watermark and an
  asset's review decided on the server are
  [`nuxeo-agentic-assets`](../../nuxeo-agentic-assets/README.md#watermarks) 0.5.0, since a mark is a
  condition of an asset's rights, decided at the same endpoints, and the review is the asset page's.
  The review's decisions are Nuxeo's own annotations written, which a synchronous listener holds to
  the add-on's `ReviewAsset` permission and a review policy's groups, so decision 3 is not touched.
  A marked file is served by `Asset.GetWatermarked`, an operation the platform's own page calls, as
  it calls the share links', which no configuration binds to a button. Its security review is
  deferred until the app is finished. What changes if B goes another way: as for media rights
  above, the bundle moves whole, and a kit's components, `org.nuxeo.agentic.assets.rights` and
  `org.nuxeo.agentic.assets.review`, keep their names.

- **B, the document control module's server add-on (26 November 2026).** Built against the
  recommendation: numbering, revisions and supersession are
  [`nuxeo-agentic-documents`](../../nuxeo-agentic-documents/README.md), a Maven module beside
  `nuxeo-agentic-core` with a Marketplace package of its own, which the
  [controlled documents kit](../../business-apps/packages/controlled-documents-demo/README.md)
  depends on; nothing of it went into `nuxeo-agentic-core`. A type is controlled by the add-on's
  `ControlledDocument` facet; a kit registers its number series at `org.nuxeo.agentic.documents`;
  a synchronous listener numbers a document on creation from the platform's sequencer, and a new
  revision that names the one it supersedes takes its number and marks it superseded in the same
  transaction, with no Automation operation, so decision 3 is not touched. **Since its version
  0.2.0, transmittals and review cycles,** in the same add-on, with the kit's 0.2.0: a transmittal
  is issued when it is created, to named users inside the server, with a receipt per recipient
  that only its recipient answers; a review cycle's threads are Nuxeo's own comments, given the
  add-on's `ReviewComment` facet, and the cycle closes only with none open, the server's check, and
  is then recorded on the revision. Two more synchronous listeners, not a route model, and still no
  operation, so decision 3 is not touched ([the add-on's README](../../nuxeo-agentic-documents/README.md#transmittals-and-review-cycles-listeners-not-a-route-model)
  says why). **Since its version 0.3.0, export-control marks,** in the same add-on, with the kit's
  0.3.0: a revision's classification and the groups that may receive it, in a third schema of the
  `ControlledDocument` facet; its files and renditions refused to anyone outside those groups
  through the platform's download permission, as the assets add-on refuses on rights, and a
  transmittal of it refused by the transmittal listener; the mark carried to the revision that
  supersedes it; a change of it held to the add-on's own permission, `ChangeExportMark`, and written
  to the platform's audit. Still no operation, so decision 3 is not touched. Outside users are not
  built (decision C): a transmittal to an outside contractor waits on the portal, and a mark's groups
  are the server's. What changes if B goes another way:
  - **One large add-on:** the module's bundle moves into that add-on's package as it is, and the
    kit's `package.xml` depends on that package in place of `nuxeo-agentic-documents`. The
    component a kit's series require, `org.nuxeo.agentic.documents`, the facets, the schemas
    (`docctl`, `docrev`, `docmark`, `trm`, `trr`, `rvw`, `rvwc`) and the permission,
    `ChangeExportMark`, do not change, so no kit's files do.
  - **Into `nuxeo-agentic-core`:** the same classes and components in that bundle, the dependency
    dropped from the kit, and every server then gets the facets, the schemas and the listeners,
    which number, issue and review nothing until a type carries a facet and a package registers a
    series. Every comment written on such a server then costs the review listener a look at its
    ancestors, and every download the marks' permission a look at its document's facets.
  - **Not affected either way:** layout version 2's banner `link`, which the kit's record page
    uses, is the platform's ([layout-v2.md](layout-v2.md), section 2), and links any record a
    property names; and its comments card, where a cycle's reviewers write, is the platform's too.

- **B, the records module's server add-on (26 November 2026).** Built against the recommendation,
  "one add-on per domain module": the disposition review is
  [`nuxeo-agentic-records`](../../nuxeo-agentic-records/README.md), a Maven module beside
  `nuxeo-agentic-core` with a Marketplace package of its own, which the records kit,
  [`records-demo`](../../business-apps/packages/records-demo/README.md), depends on; nothing of it
  went into `nuxeo-agentic-core`. It builds on the platform's retention module, `nuxeo-retention`,
  which its package depends on: Nuxeo publishes the module for LTS 2025, and the add-on reads its
  records, rules and holds rather than keeping its own. Decision 3 is not touched: the add-on
  registers no operation and no endpoint, and a person reaches it by filing a document, which a
  listener checks. Decision G, tenancy, is not built. Its security review is deferred until the app
  is finished, as every security review is; it is installed nowhere. Its 0.2.0 adds the audit export
  and access logging in the same add-on, still with no operation and no endpoint: an export is a
  document filed in the same folder, and a view is logged by the REST API's own JSON writer for a
  document, which the add-on extends. Its 0.3.0 adds physical records, with locations, barcodes the
  server issues from the platform's sequencer, and a chain of custody, in the same add-on and with
  the kit's 0.2.0, still with no operation and no endpoint: a move, a check-out or a return is a
  document filed in a custody desk at the repository's root, which a second listener checks, and a
  run records a physical record's destruction or transfer rather than deleting it. The kit's barcode
  lookup is a queue with a search, the platform's, configuration and no code of the kit's. What
  changes if B goes another way:
  - **One large add-on:** the bundle moves into that add-on's package as it is, with its dependency
    on `nuxeo-retention`, and the kit's `package.xml` depends on that package in place of
    `nuxeo-agentic-records`. The type, schema and permission names do not change.
  - **Into `nuxeo-agentic-core`:** every customer would then get the records components, which
    stay unresolved on a server without the retention module; so the records types would stop
    requiring the module's, and the review would be switched on by a setting instead, off by
    default.

- **B, the e-signature step's server add-on (26 November 2026).** Built against the
  recommendation, "one add-on per domain module": the e-signature step is
  [`nuxeo-agentic-signature`](../../nuxeo-agentic-signature/README.md), a Maven module beside
  `nuxeo-agentic-core` with a Marketplace package of its own, which the
  [onboarding kit](../../business-apps/packages/onboarding-demo/README.md),
  `onboarding-demo`, depends on; nothing of it went into `nuxeo-agentic-core`. A kit's record type
  carries the add-on's `Signable` facet, its signature request type the `SignatureRequest` facet;
  a request created by someone who may write its record sends the record's file to the provider
  the server configures, and the provider's callback, authenticated, fresh and taken once, ends it
  signed, the signed file filed on the record as a new version with the provider's evidence, or
  declined. **Decision H is not taken, and waits for its owners:** the add-on is provider-neutral,
  and its one provider is a stand-in that signs nothing, talking to a stand-in service, so a vendor
  chosen with procurement and presales is a class registered at the add-on's `providers` point
  and its server settings, and nothing else changes. Decision 3 is not touched: the add-on
  registers no Automation operation, a person sends a file by creating a request, as every client
  creates a document, and a workflow's chain may create one the same way. Its security review is
  deferred until the app is finished, as every security review is; it is installed nowhere. What
  changes if B goes another way:
  - **One large add-on:** the bundle moves into that add-on's package as it is, with its deployment
    fragment, and the kit's `package.xml` depends on that package in place of
    `nuxeo-agentic-signature`. The component, facet, schema and setting names do not change, so no
    kit's files do.
  - **Into `nuxeo-agentic-core`:** every server would then answer the callback path,
    `/nuxeo/agentic-signature/`, with no sign-in, and run the listener on every document change;
    so the servlet would be switched on by a setting instead, off by default, and the facets would
    stay, inert until a type carries one.

- **B, capture and classification's server add-on (27 November 2026).** Built against the
  recommendation, "one add-on per domain module": capture is
  [`nuxeo-agentic-capture`](../../nuxeo-agentic-capture/README.md), a Maven module beside
  `nuxeo-agentic-core` with a Marketplace package of its own, which the
  [P&C claims kit](../../business-apps/packages/pc-claims-demo/README.md) 0.2.0 depends on; nothing
  of it went into `nuxeo-agentic-core`. A kit's item type carries the add-on's `CaptureItem` facet,
  and a kit's profile names its inbox, the record type and the keys it is matched by: an item
  uploaded into the inbox is read in the background, and filed on the one record its keys match
  when its class and keys are at least the profile's threshold, or waits for a person who confirms,
  corrects or rejects it. Through a provider interface, with a deterministic stand-in and a
  provider that calls the AI package's `AI.*` operations, off until a server turns it on, which is
  to be done only once the AI data terms are approved, the plan's phase 7 condition. The AI package's
  two capture operations, and its Claude provider, are not built: they are the AI package's, and the
  plan's "Needs". Decision 3 is not touched: the add-on registers no Automation operation, and a
  person decides through the item's Edit form. Its security review is deferred until the app is
  finished, as every security review is; it is installed nowhere. What changes if B goes another
  way:
  - **One large add-on:** the bundle moves into that add-on's package as it is, and the kit's
    `package.xml` depends on that package in place of `nuxeo-agentic-capture`. The component, facet,
    schema and setting names do not change, so no kit's files do.
  - **Into `nuxeo-agentic-core`:** every server would then run the listeners on every document
    created and changed; they stay inert until a type carries the facet, and the provider stays
    unset, so nothing is read until a server names one.

- **C, share links (25 November 2026).** Built against the recommendation, "Share links in phase
  5, invited outside users in phase 8": links, and no outside user. `nuxeo-agentic-assets` 0.2.0
  serves some of an asset's picture views, and its original where its rights allow, watermarked on
  the server, to whoever holds a link's token, with no sign-in, at `/nuxeo/agentic-share/`, while
  the link is neither revoked nor past its last day and the asset's rights allow each one; the
  brand assets kit 0.2.2 turns the asset page's links on
  ([the add-on's README](../../nuxeo-agentic-assets/README.md#share-links)). Nobody is invited,
  given an account or signed in: Nuxeo's own access for an outside person, `Document.AddPermission`
  with an email, signs a transient principal in for the whole API, and is left for phase 8. **Its
  security review,** the plan's condition for phase 5, is deferred until the app is finished, as
  every security review is; it is installed nowhere. Decision F is not touched: no sign-in
  changes. What changes if C goes another way:
  - **No outside access in the Beta:** the kit drops `"shareLinks"` from its asset layout, a patch;
    the add-on drops its share links component, operations, directories and servlet, a minor
    version, and its rights stay as they are.
  - **Invited outside users instead of links:** the same removal, and the portal signs them in
    through Nuxeo's transient users or decision F's tokens; the watermark and the download log
    could serve the portal's downloads.
  - **Both in phase 5:** the links stay as they are, and invitations are built beside them.

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

- **D, the connectors add-on's caching and change events (26 November 2026).** Built against the
  same recommendation: the add-on's version 0.1.0 keeps `Connector.Read`'s answers for a time each
  server sets per connector, and takes the system of record's signed change events at
  `/nuxeo/agentic-connectors/events/<connector>`, which drop the answers kept for a record and do
  nothing else ([the connectors README](../../nuxeo-agentic-connectors/README.md#the-cache)). The
  reader is not in the cache's key: every check runs before the lookup, and the answer does not
  depend on who reads, since F is not touched. Outbound webhooks are not built. What changes if D
  goes another way:
  - **A separate integration service, reached through Nuxeo:** the service may keep answers and
    take events itself; `Connector.Read` keeps its checks before any kept answer, and the card,
    which reads `age`, does not change.
  - **A separate service the client calls itself:** the cache and the events move to the service,
    and the card reads the same `age` from it.
  - **If F passes the reader's identity on,** the reader joins the cache's key.

- **F, token exchange for embedded panels (26 November 2026).** Built against the recommendation,
  "exchange in phase 7": a record page's panel inside another system's page,
  [embedded-panels.md](embedded-panels.md), and its server's half,
  [`nuxeo-agentic-embedded`](../../nuxeo-agentic-embedded/README.md). A host the server's
  administrators register in `nxserver/config/`, never a package's bundle, exchanges its signed
  assertion of a user for a short-lived token, for the Nuxeo user its configuration maps, never an
  administrator unless it allows one; an OAuth 2.0 token exchange (RFC 8693), with the host's client
  secret and key in the server's settings. The token is a JWT signed with a key of the add-on's own,
  not the platform's `nuxeo.jwt.secret`, whose tokens the platform also takes at its JWT
  authenticator and its OAuth 2.0 provider's JWT bearer grant; the add-on's own authenticator signs
  the user in with it, in the REST API's two chains alone, which the add-on contributes again with it, and
  the add-on's filter and that authenticator hold it to its host's origins and to reads; each exchange
  is audited. The panel, `<nuxeo-record-panel>`, is
  the layout engine's record page in a shadow root, given its token by `postMessage`. An add-on of
  its own rather than `nuxeo-agentic-core`, so that a server that embeds no panel gets no endpoint;
  on B's recommendation either way, since it is no runtime essential of every server. Its security
  review is deferred until the app is finished, as every security review is; it is installed
  nowhere, and its demo runs against a stand-in. The shell's token-based sign-in, the decision's
  other half, is not touched: the shell signs in as before. What changes if F goes another way:
  - **No token exchange:** the add-on and `apps/nuxeo-embedded-panels` go, with the package's
    `embedded/v1/` files and the frontend module's build of them; nothing else uses either.
  - **Exchange through Nuxeo's OAuth 2.0 provider,** should the platform gain a token exchange whose
    tokens carry a scope it enforces: the add-on's servlet, `TokenExchange`, its codec and its
    authenticator go, the host's contribution becomes the provider's client, and the REST API's chains
    go back to the platform's. The panel does not change.
  - **The platform's own JWT, with an audience the platform holds to a path:** not built, since the
    provider's JWT bearer grant takes any token of the platform's JWT service and answers an access
    token with no scope; it would be possible only once that grant checks a token's audience.
  - **Connectors, decision D:** the panel's card from another system still reads through
    `Connector.Read` with the service credential; passing the user's own identity on to the other
    system is not built.

- **5, the spike its recommendation asks for (25 November 2026).** Built as the recommendation
  says, "spike in phase 6": a prototype loader in `tools/plugin-spike`, which ships nothing, and
  [its report](spikes/plugins-decision-5.md), which compares the template build with signed,
  pinned plugins loaded at run time and ends with a recommendation and questions for the owners.
  It loads no customer code into the shipped app, and the decision stays open. Once it is taken,
  the prototype can go, with its two guards: `checkPluginSpikeIsolated` and the `type:spike` probes
  in `scripts/beta-harness/module-boundaries.mjs`.

## Open: from phase 10

Raised by the [development plan](development-plan.md)'s phase 10, "telemetry and the diagnostics
page".

| #   | Decision                                                 | Recommendation                                                                                                                                                                                                                                                           | Owner                    | Needed by |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | --------- |
| T   | Telemetry: whether the app sends any, what, and where to | Opt-in and off by default: sent by the server, never the browser, to the customer's own OpenTelemetry collector, only the closed list of fields in [telemetry.md](telemetry.md), never to Hyland's without a contract; built only after its privacy and security reviews | Product, security, legal | Phase 10  |

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

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | How it was settled                                                                                                        | When             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| The server sends each workflow step's variable schema, so task forms are client work                                                                                                                                                                                                                                                                                                                                                                                                                                    | Checked on Nuxeo 2025 ([feasibility](feasibility.md))                                                                     | 21 November 2026 |
| Page provider definitions are readable over REST, with their aggregates                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Checked on Nuxeo 2025                                                                                                     | 21 November 2026 |
| Nothing lists a document's allowed lifecycle transitions: a small enricher of ours                                                                                                                                                                                                                                                                                                                                                                                                                                      | Checked on Nuxeo 2025                                                                                                     | 21 November 2026 |
| Picture, video and audio types, picture views, renditions and conversions already exist                                                                                                                                                                                                                                                                                                                                                                                                                                 | Checked on both local servers ([architecture](architecture.md), section 2)                                                | 21 November 2026 |
| Nuxeo can grant time-limited access to an outside person by email                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `Document.AddPermission` takes `begin`, `end`, `email`; how they sign in is not checked                                   | 21 November 2026 |
| Retention, legal hold and template operations need add-ons                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Absent on both servers                                                                                                    | 21 November 2026 |
| A Studio package's data model needs no conversion; only its Web UI files do                                                                                                                                                                                                                                                                                                                                                                                                                                             | Read from a sample package ([migration](studio-migration.md))                                                             | 21 November 2026 |
| The migration reads the Web UI files, not Studio's `.metadata` layouts                                                                                                                                                                                                                                                                                                                                                                                                                                                  | They differ in the sample                                                                                                 | 21 November 2026 |
| Account names stay out of this public repository; documents count accounts by group                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decided by the plan's author                                                                                              | 21 November 2026 |
| The prototype is built in CI and never committed, because it carries Satori's theme and icons                                                                                                                                                                                                                                                                                                                                                                                                                           | Decided with the Satori owners, recorded in the Pages workflow                                                            | 21 November 2026 |
| Where the work is built (decision J): in this repository, not a fork, on the integration branch `integration/enterprise-grade-app`, following [AGENTS/06-git-workflow.md](../../AGENTS/06-git-workflow.md). Every pull request for the work targets it, `main` is merged in at least daily, and it reaches `main` in one final pull request. New code goes in new projects behind switches. Customer material (Studio packages, configuration packages, account names, real data) goes in a separate private repository | Decided by the plan's author; the branch was created from `main`                                                          | 21 November 2026 |
| The integration branch is protected like `main`: it is a target of the `main_branch` ruleset, so every pull request into it needs an approving review                                                                                                                                                                                                                                                                                                                                                                   | Decided by the plan's author                                                                                              | 22 November 2026 |
| Until the plan is implemented, SonarCloud, the accessibility checks and the security scans run but are not chased; phase 10 brings them back to green. CodeQL still blocks a merge with a high-severity finding, through the ruleset                                                                                                                                                                                                                                                                                    | Decided by the plan's author                                                                                              | 22 November 2026 |
| Decision 4, the expression set for layouts: registered computations and rules only, with no expression language and no JavaScript. The starting set: `core.age`, `core.template` (rendered as text, never HTML), `core.sum`, `core.count`, `core.dateDiff` and `core.choose`; rules on a field's value, the lifecycle state and the user's group, combined with `core.every`, `core.some` and `core.not`. Anything else is a Layer 2 registration in code, reviewed and built in                                        | Decided by the plan's author for engineering; its security review is open above                                           | 22 November 2026 |
| Decision A, packaging of the client tiers: one package, `@nuxeo/satori-platform`, with each domain module as its own entry point (`@nuxeo/satori-platform/modules/<name>`). A module moves into a package of its own only when it needs its own release cadence or licence. Most customers get every module in the prebuilt app either way, and each published package would need the five publication gates                                                                                                            | Decided by the plan's author, replacing the architecture's first recommendation                                           | 22 November 2026 |
| Until the app is finished, every open decision is acted on as its recommendation says, and taken with its owner then; four wait for their owners (above)                                                                                                                                                                                                                                                                                                                                                                | Decided by the plan's author                                                                                              | 26 November 2026 |
| The security reviews wait until the app is finished; what each covers is in [security-reviews.md](security-reviews.md)                                                                                                                                                                                                                                                                                                                                                                                                  | Decided by the plan's author                                                                                              | 26 November 2026 |
| `app-model --attachments`, the generators' one change made while an agent built the moves kit: a stand-in type may carry Nuxeo's `files` schema                                                                                                                                                                                                                                                                                                                                                                         | Approved by the plan's author, for the generators' owner ([moves kit](../../business-apps/packages/moves-demo/README.md)) | 26 November 2026 |
| Business-app kits stay in this repository, under `business-apps/packages/`, beside the app definition pipeline that checks them; version 1's configuration packages stay in nuxeo/Nuxeo-Satori-Config, whose builder checks no version 2 file ([package-pipeline.md](package-pipeline.md))                                                                                                                                                                                                                              | Decided by the plan's author                                                                                              | 26 November 2026 |
| The migration work still to do is held until the plan's other remaining items are done, then done with care, as the migration's most important part; what is built stays. It covers phase 4's three real packages, lab server, server halves of checks 5, 6 and 7, accepting proposals and reviewers; migration M3, the code track (a Studio package's custom elements to Angular plugins, with harness check 9, resting on decision 5); and phase 10's upload                                                          | Decided by the plan's author                                                                                              | 26 November 2026 |
