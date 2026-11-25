# Payers Claims (demo)

The Payers kit, version 1 ([development plan](../../../docs/business-apps/development-plan.md),
phase 1), with phase 2's claims review workflow and appeals, and the package pipeline's demo app
definition ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md)). All its data
is fictional. Phase 0's demo runs on it, phase 1's demo script runs on it (below), phase 2's first
four demo steps and its sixth are written for it, and the pipeline's controls
(`scripts/app-package.selftest.mjs`) break copies of it.

## The short version

- **Four record pages, as layout files:** Member, Claim, Case and Provider. The Member page is
  [layout-v2.md](../../../docs/business-apps/layout-v2.md)'s section 9, word for word.
- **Three queues, a home for two groups, a menu and labels:** claims adjusters see the unassigned
  claims and their own; member services, and supervisors, see the claims pending determination.
  The home's KPIs count from the queues' page providers, through their aggregates.
- **A stand-in model,** until the presales Payers model arrives: the types, schemas and page
  providers those files name, and since 0.4.0 a claim lifecycle. It is fictional, and replaced
  whole when theirs comes.
- **A seed script** writes a few members, with their claims and cases, and the four people who
  work them, in the groups the files' rules name. Run it twice and nothing is added the second
  time.
- **The demo script,** phase 1's five steps, as a steps file of the beta harness:
  [`scripts/beta-harness/steps/payers-claims-demo.mjs`](../../../scripts/beta-harness/steps/payers-claims-demo.mjs).
- **The claims review workflow,** version 0.4.0's: a route model the bundle contributes, as Nuxeo's
  own models are, with a task form for each of its two steps and a claim lifecycle whose states are
  `claim:status`'s values. An adjuster determines a claim; one billed over $5,000 that they approve
  goes to a supervisor. Phase 2's first three demo steps are written for it, in
  [`scripts/beta-harness/steps/payers-claims-workflow.mjs`](../../../scripts/beta-harness/steps/payers-claims-workflow.mjs)
  ([below](#the-claims-review-workflow)). **Not run on a server yet:** the kit is not installed.
- **The appeals,** version 0.4.1's: an appeal is a Case of the category `appeal`, opened against a
  denied claim, which it links to. Its record page adds a checklist, layout version 2's
  `checklist` card, whose items the Case layout lists and whose state, done or not with who and
  when, the case's `case:checklist` holds, and its timeline. The seed writes two appeals, one under
  way and one decided. Phase 2's demo step 6 is written for them, in
  [`scripts/beta-harness/steps/payers-appeals.mjs`](../../../scripts/beta-harness/steps/payers-appeals.mjs)
  ([below](#the-appeals)). **Not run on a server yet** either.
- **Two operation buttons,** version 0.5.0's: Request medical records, for adjusters on a claim in
  review or held, with a small form, and Refer to special investigations, for supervisors. Each runs
  a fictional chain the bundle contributes, which writes to the claim's history. The kit never
  allows its own chains: the server's administrators do, with a deployment contribution
  ([below](#the-operation-buttons)), and the demo server's allows the first and leaves the second
  out on purpose. Phase 2's demo step 4 is written for them, in
  [`scripts/beta-harness/steps/payers-operations.mjs`](../../../scripts/beta-harness/steps/payers-operations.mjs).
  **Not run on a server yet.**
- **What a production install shows:** the record pages and the model, to everyone, and the home,
  the menu, the queues and the labels from the app registry, after sign-in, to the three demo
  groups `app.json` names. The development server serves the same files through
  `npm run config:dev`, and a file it serves wins there
  ([below](#what-a-server-shows-and-what-the-dev-server-does)).

## What is in it

| File                                                           | What it is                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                            | The app: its name, version, platform range and groups                                      |
| `bundle/agentic-ui-config/layouts/Member/view.layout.json`     | The Member record page: section 9's                                                        |
| `bundle/agentic-ui-config/layouts/Claim/view.layout.json`      | The Claim record page                                                                      |
| `bundle/agentic-ui-config/layouts/Case/view.layout.json`       | The Case record page, with an appeal's checklist and every case's timeline                 |
| `bundle/agentic-ui-config/layouts/Provider/view.layout.json`   | The Provider record page, with the claims it billed                                        |
| `bundle/agentic-ui-config/layouts/Member/metadata.layout.json` | Version 1: the Properties panel beside the Member page, without the social security number |
| `bundle/agentic-ui-config/queues/unassigned-claims.json`       | Adjusters: claims no one holds yet, with a Status facet                                    |
| `bundle/agentic-ui-config/queues/my-claims.json`               | Adjusters: the claims they hold, through `$currentUser`                                    |
| `bundle/agentic-ui-config/queues/pending-determination.json`   | Member services and supervisors: claims in review or pended                                |
| `bundle/agentic-ui-config/home.json`                           | The home: KPI cards for adjusters and for member services                                  |
| `bundle/agentic-ui-config/navigation.json`                     | The menu: the home, the three queues, and two platform pages                               |
| `bundle/agentic-ui-config/actions.json`                        | Mark as paid, a lifecycle transition, and the two operation buttons                        |
| `bundle/agentic-ui-config/tasks/*.layout.json`                 | The claims review workflow's two task forms, one per step with a task                      |
| `bundle/agentic-ui-config/labels/en.json`                      | Its labels, in English: every key the files above name                                     |
| `bundle/OSGI-INF/payers-claims-demo-config.xml`                | The component that contributes the five layouts, and the app with its files                |
| `bundle/OSGI-INF/payers-claims-demo-model.xml`                 | **The stand-in model:** document types, the claim lifecycle, page providers                |
| `bundle/OSGI-INF/payers-claims-demo-workflow.xml`              | The claims review workflow: its route model, variables, chains, vocabulary and filter      |
| `bundle/OSGI-INF/payers-claims-demo-operations.xml`            | The two operation buttons' chains, and REST bindings closing Nuxeo's endpoint to them      |
| `deployment/payers-claims-demo-operations-config.xml`          | The demo server's allow-list, for `nxserver/config/`. Not packaged: the deployment's own   |
| `deployment/build-allow-list.json`                             | The allow-list the pipeline builds the kit against, and CI with it. Not packaged           |
| `bundle/data/PayersClaimReview.zip`                            | The route model, as the importer reads it: written from `workflow/PayersClaimReview/`      |
| `bundle/data/vocabularies/PayersClaimDecision.csv`             | The decisions a determination picks from                                                   |
| `bundle/schemas/*.xsd`                                         | **The stand-in model's** schemas, and the workflow's variables (`var_*`)                   |
| `workflow/PayersClaimReview/`                                  | The route model's source: a document export, one `document.xml` per node. Not packaged     |
| `workflow/build-route-model.mjs`, `route-model.mjs`            | Writes the zip from its source, the same bytes every time; `--check` compares              |
| `workflow/route-model.selftest.mjs`                            | The route model's controls, with no server                                                 |
| `workflow/platform-check.mjs`, `PlatformCheck.java`            | The route model held to the local Nuxeo's own classes, with no deploy                      |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`     | The seed script, its fictional records and people, and its controls. Not packaged          |
| `demo/lifecycle.mjs`                                           | The claim lifecycle, read from the stand-in model, for the seed and its controls           |
| `demo/appeals.mjs`                                             | The Case page's checklist, read from its layout, and the seeded appeals held to it         |
| `package/package.xml`                                          | The Marketplace package: name, version, and what it depends on                             |
| `build.mjs`                                                    | Version 1's builder: the generator's, byte for byte                                        |
| `content-model.json`                                           | The stand-in model as the server answers it, for `--model`                                 |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **Operation buttons on decision 3's recommendation,** which is open: a per-deployment allow-list
  ([decisions.md](../../../docs/business-apps/decisions.md), notes). The workflow's steps are still
  task actions and lifecycle transitions; the two buttons run chains of their own.
- **One version in three places:** `package.xml`'s, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`, raised together. The pipeline's step 3 refuses any of them that
  differs, and, given the package as it was (`--previous`), a version that moved less than the
  changes need ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 8).
  0.3.0 was the minor raise over 0.2.0: the `members` group no longer had the app. **0.4.0** is a
  minor raise too: the pipeline counts 29 changes since 0.3.0, which need a minor, since the approve
  action and its three labels are removed, and it leaves the component, schema and data changes to
  a person. Those break something too: claims change lifecycle, and a claim created before 0.4.0
  is in the default lifecycle's `project` state, which the new lifecycle keeps only as a way into
  it, so until the seed moves it on it has none of a claim's transitions. Below 1.0.0 a breaking
  change raises the minor. **0.4.1** is a patch raise: the pipeline counts 9 changes since 0.4.0,
  seven labels added and the Case layout changed, which need a patch, and leaves `case.xsd` to a
  person. Its change adds a property, `case:checklist`, and removes none, so nothing that read a
  case before reads it differently, and a patch is enough. One thing does break, which the rule
  cannot see: a platform built before the checklist card refuses the new Case page ("Not done
  yet", below). **0.5.0** is a minor raise, more than the patch the pipeline asks for: it counts 13
  changes since 0.4.1, two actions and eight labels added and the my-claims queue changed, and
  leaves the manifest and the new operations component to a person. The buttons need a platform and
  a `nuxeo-agentic-core` that run them. An older platform offers none; an older core serves the
  file whole and has no `AgenticUi.RunAction`, so a newer platform offers both and the server runs
  neither, answering 404, which the dialog says. The minor says the kit does something new.

## The stand-in model

The presales Payers model has not arrived. Until it does, the package carries a fictional one, in
a component of its own so that it can be replaced whole: `payers-claims-demo-model.xml` and
`bundle/schemas/`.

| Type                | Schema (prefix)                       | What it holds                                                                                                                                               |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Member`            | `member`                              | `number`, `firstName`, `lastName`, `birthDate`, `address` (`street`, `city`, `zip`, `country`), `phone`, `email`, `plan`, `status`, `ssn`                   |
| `Claim`             | `claim`                               | `number`, `member`, `provider`, `serviceDate`, `serviceStart`, `serviceEnd`, `received`, `billedAmount`, `allowedAmount`, `status`, `adjuster`, `diagnosis` |
| `Case`              | `case`                                | `number`, `member`, `claim`, `category`, `state`, `received`, `due`, `assignee`, `summary`, and since 0.4.1 `checklist`                                     |
| `Provider`          | `provider`                            | `number`, `npi`, `specialty`, `network`, `phone`, `address`. Its name is its `dc:title`                                                                     |
| `ClaimDocument`     | `claimdoc`, on a File                 | `claim`, the claim's number, and `category`                                                                                                                 |
| `PayersClaimSearch` | `payers_claim_search` (`claimsearch`) | The claim queues' search document, never saved: `claim_status_agg` and `claim_adjuster_agg`, the facets a queue sends back. Hidden                          |

- **A reference is the document's id.** `claim:member`, `claim:provider`, `case:member` and
  `case:claim` hold the `ecm:uuid` of what they point to, through Nuxeo's document resolver. That
  is what the page providers are given.
- **Statuses are properties,** as section 9 shows them: `member:status`, `claim:status`,
  `case:state`. Each schema lists its values.
- **An appeal's checklist is a property,** since 0.4.1: `case:checklist`, a list of complex
  values, `item`, `done`, `doneBy` and `doneOn`, the four subfields layout version 2's checklist
  card reads (layout-v2.md, section 7). One entry per item done or under way; what an appeal
  requires is the Case layout's to say. A grievance's is empty. Who and when are what the entry
  holds: nothing on the server stamps them, so the seed writes them, as anyone changing an item
  through the REST API sends them.
- **A claim's lifecycle is its status,** since 0.4.0: `payersClaim`, whose states are
  `claim:status`'s values. A claim starts `submitted`; `review` puts it in review; `pend` and
  `resume` hold it and bring it back; `approve` and `deny` decide it, from review or held; `pay`
  settles an approved claim; `reopen` brings a decided one back to review. After every transition,
  whoever follows it, the handler of the platform's `lifecycle_transition_event`
  (`PayersClaim.KeepStatus`) writes the new state to `claim:status`, so the queues, which read the
  status, and the workflow, which follows the state, agree. `project` is in it only as the state a
  claim created before 0.4.0 is in: Nuxeo reads a document's lifecycle from its type, not from the
  document (`LifeCycleServiceImpl.getLifeCycleFor`), so such a claim follows this one from the
  upgrade, and its one way out is `submit`, which the seed follows. Every other type has the
  platform's default lifecycle.
- **None of the four record types holds a file or is a folder,** so each opens as a record page.
- **Created by the seed, not by hand:** no folder lists the types among its subtypes, so the
  Create menu does not offer them.
- **The names are plain:** `Member`, `Claim`, `member_claims` and the rest. On a server shared with
  another model that uses them, the two would collide. The presales model sets the real ones.

| Page provider              | Given                    | Returns                                                                                        |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `member_claims`            | A member's `ecm:uuid`    | The member's claims, latest service first                                                      |
| `member_cases`             | A member's `ecm:uuid`    | The member's cases, latest change first                                                        |
| `provider_claims`          | A provider's `ecm:uuid`  | The claims the provider billed                                                                 |
| `payers_claim_documents`   | A claim's `claim:number` | The claim's documents                                                                          |
| `payers_unassigned_claims` | Nothing                  | Claims with no adjuster, submitted or in review, oldest first. Aggregate: `claim_status_agg`   |
| `payers_my_claims`         | An adjuster's user name  | The claims they hold, latest service first. Aggregate: `claim_status_agg`                      |
| `payers_pending_claims`    | Nothing                  | Claims in review or pended, oldest first. Aggregates: `claim_status_agg`, `claim_adjuster_agg` |

Each binds what it is given as a quoted literal, and leaves out versions, proxies and trashed
records.

- **The three queue page providers read the search index,** not the repository: a queue's facets
  and a KPI's buckets are aggregates, which only the index answers. They are
  `SearchServicePageProvider`, the class Nuxeo 2025 gives `default_search`, each with the search
  document `PayersClaimSearch`. An aggregate's id, its field there and the parameter the app sends
  back, such as `claim_status_agg=["paid"]`, are one name. The index is written a moment after the
  repository, so they lag a change by about a second.
- **`payers_my_claims` is given `$currentUser`,** by the queue and by the home: the REST API puts
  the name of the person signed in in its place before the query runs (`QueryExecutor` in
  `nuxeo-search-rest-api`). So no one's name is in a file, and each adjuster is asked for their own
  claims. The seed checks it, as each adjuster. **The kit relies on that server behaviour:** whether
  version 2 of the app definition says a literal may name the person this way is still open
  ([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 13).

## The claims review workflow

Phase 2's first three demo steps are written for it
([development plan](../../../docs/business-apps/development-plan.md), phase 2), and not yet run: an
adjuster approves a claim over $5,000, and it goes to a supervisor; the supervisor approves it, and
the claim moves to Approved; a denial with no reason is stopped by the form's field rule, and by the
server.
It is built on decision 2's recommendation, which is open: reopen the Beta scope, so that phases 1
and 2 build workflow and business records ([decisions.md](../../../docs/business-apps/decisions.md)).

### How Nuxeo 2025 imports a route model without Studio

Established from the platform's own bundles in the local container, Nuxeo 2025.10.18, read-only:
`docker exec nuxeo ls` and `unzip -p` on the jars under `/opt/nuxeo/server`, and `javap` on this
machine on the classes `unzip -p` copied out. Nothing was deployed, installed or restarted.

- **A bundle names a zip at the routing service's `routeModelImporter` point.**
  `nuxeo-routing-default`'s `OSGI-INF/extensions.xml` contributes its two models so:
  `<template-resource id="SerialDocumentReview" path="data/SerialDocumentReview.zip"/>`, beside the
  variable schemas (`var_<node>`, `var_<workflow>`), their facets (`facet-var_…`), the chains its
  nodes run and an action filter for who may start it, all in one component. The point's descriptor,
  `RouteModelResourceType`, reads `path` as a resource of the contributing bundle.
- **It is imported at every start.** `DocumentRoutingServiceImpl.activate` installs
  `RouteModelsInitializator`, a repository initialization handler, whose
  `doInitializeRepository` calls `importAllRouteModels`, once across a cluster. That hands each zip
  to the file manager with `overwrite`, which gives it to `RouteModelsZipImporter`.
- **What the importer requires.** A `.nuxeo-archive` entry (`ExportedZipImporter.isArchiveFileValid`),
  and a root document of type `DocumentRoute`, which names the model by its folder. It reads the zip
  with `NuxeoArchiveReader` over a `ZipFile`, which sorts the entries and reads each folder entry's
  `document.xml`: so the zip must hold its folders as entries. A model of the same name is left
  alone when the zip's MD5 digest is the one recorded in the `workflowModels` key-value store, and
  otherwise removed, keeping its ACL, and imported again. So the model changes on a server only
  when the zip's bytes do.
- **The documents are a document export.** The platform's models are `DocumentRoute` and
  `RouteNode` documents, `validated`, in the `documentRouteElement` lifecycle, their fields those of
  `route_node.xsd` and `document_route_instance.xsd` in `nuxeo-routing-core`. A document's `id` is
  not kept: `AbstractDocumentModelWriter.createDocument` creates each one anew, by its folder's
  name, and sets its lifecycle state from the export's. So an id needs no UUID's form, as the
  platform's own show (`SerialDocumentReview`, `Task542`).
- **What a node's conditions and chains see.** A transition's condition is MVEL that must give a
  `Boolean` (`GraphNodeImpl.evaluateTransitions`), with `NodeVariables`, `WorkflowVariables` and
  `Document`, the first of the workflow's documents (`Scripting.initBindings`); with
  `executeOnlyFirstTransition` the first that holds is followed. A task's variables come back from
  `PUT /api/v1/task/{id}/{action}` as node variables; a workflow variable is set from a task only
  if a `var_global_<node>` schema lists it, so the chains set them instead
  (`Context.SetWorkflowVar`). Validation of a document on save is active
  (`DocumentValidationService-activation.xml`).

The kit follows that shape. `workflow/PayersClaimReview/` is the model as a document export, one
`document.xml` per node, and `workflow/build-route-model.mjs` writes `bundle/data/PayersClaimReview.zip`
from it: the marker, every folder as an entry and its `document.xml`, by code point, stored, every
timestamp 1980-01-01, so the same source always gives the same bytes. The zip is committed, since
the package's `build.mjs` packages what `bundle/` holds and is the generator's, byte for byte; run
the builder after changing the source.

### What it does

| Node                 | Task                                                   | Then                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`              | None                                                   | A submitted claim follows `review`, and goes to `determine`. Any other claim is refused: the workflow ends, the claim unchanged, with "Review refused" in its history. So a claim is determined once                                                                                                                                                                                                                                                                          |
| `determine`          | The claim's adjuster, or any adjuster when it has none | Its form sets `decision`, `allowedAmount` and `denialReason`. In order: a denial with no reason is refused; a denial denies; an approval with no allowed amount, or one below 0 or above the billed amount, is refused; an approval of a claim billed over $5,000 goes to `supervisorApproval`; any other approval approves; anything else is refused. A refusal leaves the claim as it is, records "Determination refused" in its history, and opens the determination again |
| `supervisorApproval` | Any member of `claims-supervisors`                     | Approve approves the claim; Send back returns it to `determine`; any other action opens the approval again                                                                                                                                                                                                                                                                                                                                                                    |
| `end`                | None                                                   | The claim is approved or denied, by the chain that led here                                                                                                                                                                                                                                                                                                                                                                                                                   |

- **Who may start it:** someone with `ReadWrite` on a submitted claim, by the action filter
  `filter@PayersClaimReview`, which the REST API's start checks (`WorkflowAdapter.doPost`,
  `canCreateInstance`). Starting it puts the claim in review, so a claim whose review runs is not
  offered a second, and the start node refuses one that is not submitted, for a start that skips
  the filter. A claim seeded in review or held is not determined by the workflow.
- **What it writes:** the allowed amount, to `claim:allowedAmount` (0 on a denial); the claim's
  lifecycle, and so its status; who determined a claim sent to a supervisor, as the workflow
  variable `determinedBy`; and each decision in the claim's history, under "Claim review".
- **The task forms:** `tasks/PayersClaimReview.determine.layout.json` shows the claim read-only and
  asks for the decision, from the vocabulary `PayersClaimDecision`, then the allowed amount, no more
  than the billed amount, for an approval, or the reason for a denial, each required by its rule.
  `tasks/PayersClaimReview.supervisorApproval.layout.json` shows the claim, with the allowed amount
  the adjuster approved, read-only; the step's buttons are its own. A step's variables are in
  `var_PayersClaimReview_<step>`, named after the workflow as well as the step, since a schema's name
  is shared by the whole server; the task form reads whatever `var_*` schema the task names.
- **A denial with no reason, sent past the form, is refused by the server too.** No constraint can
  make a field required for one decision only, so the route model does it: its first transition
  holds, the claim stays in review, and the determination opens again. The request itself
  completes the task, so it is expected to be answered with success, not an error: what is refused
  is the denial. The steps file records the status it gets. The same is done for an approval with
  no allowed amount, or one above the billed amount, which the form's check refuses.

### How it was verified, with no deploy

- **Against the server's own classes:** `node workflow/platform-check.mjs` copies 25 jars out of the
  local container, read-only, and runs `PlatformCheck.java` on this machine with them (Java 21).
  `NuxeoArchiveReader` reads the kit's zip as the model and its four nodes, after reading the
  platform's `SerialDocumentReview.zip` the same way as a control; XMap loads every extension of the
  model and workflow components but their facets, document types and page providers, with the
  descriptor class its point declares, and what those descriptors say is checked: the
  `template-resource` resolving to the zip, `Claim` mapped to `payersClaim`, the filter and the
  vocabulary contributed, the vocabulary's rows a file of the bundle, and `PayersClaim.KeepStatus`
  a contributed chain handling `lifecycle_transition_event` on a `Claim`; `XSDLoader` loads the two
  variable schemas; `LifeCycleImpl` answers `payersClaim`'s transitions from each state; and MVEL,
  the server's version, evaluates each node's conditions in order for 19 cases and its task
  assignees. Run on 24 November 2026: 95 checks passed. Seen failing: with the supervisor's
  threshold changed to `>= 5000`, on the claim billed exactly $5,000; and with the handler's event
  misspelled and `Claim` mapped to `default`, on the two checks that read them. What it does not
  check: the chains' operations and parameters beyond their number, which only a server runs.
- **Without a server, and in CI:** `node workflow/route-model.selftest.mjs`, which checks that the
  zip is its source's, byte for byte, then the documents, the graph and what they name across the
  kit (its header lists them), then breaks a copy of the kit in 23 ways, and the lifecycle's XML
  in 5, among them a `<!<!---->-->` that a pattern stripping comments would read past, each refused for its own
  reason. `ci.yml` runs it on every pull request, so a source changed without its zip, or a zip
  changed by hand, fails there.
- **The package pipeline**, below, and its selftest.
- **Not yet:** an install. Whether the server imports the model, starts it and runs its chains is
  for the demo's steps file, once the kit is installed.

## The operation buttons

Phase 2's demo step 4, "Request medical records" runs a server chain
([development plan](../../../docs/business-apps/development-plan.md), phase 2), built on decision
3's recommendation, which is open: configuration binds a button to a chain, through a
per-deployment allow-list ([decisions.md](../../../docs/business-apps/decisions.md), notes). How
the platform serves, draws and runs them is
[app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 5.

| Button                          | Shows                                                    | Its form                     | Runs                           | On the demo server's allow-list |
| ------------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------------ | ------------------------------- |
| Request medical records         | To adjusters, on a claim in review or held; on My claims | Urgent, and a note, required | `Payers.RequestMedicalRecords` | Yes, for `claims-adjusters`     |
| Refer to special investigations | To supervisors, on a claim                               | None                         | `Payers.ReferToInvestigations` | **No, on purpose**              |

- **The chains are the kit's,** in `bundle/OSGI-INF/payers-claims-demo-operations.xml`, and
  fictional: each writes the request, or the referral, to the claim's history with
  `Audit.LogEvent`, and nothing leaves the server. Request medical records is given the claim's
  provider, read from the stored claim, and what the form sends: whether it is urgent, and the
  note, which its comment writes as text.
- **The right to run them from a button is the deployment's,** never the kit's:
  `deployment/payers-claims-demo-operations-config.xml` is the demo server's allow-list, which the
  server's administrators put in `nxserver/config/`. It allows Request medical records for
  `claims-adjusters` holding `Write` on the claim, with its three parameters and their types, and
  leaves Refer to special investigations out, so that the demo shows the app registry leaving its
  button out and `AgenticUi.RunAction` refusing it. The pipeline refuses a package that contributes
  to the allow-list.
- **Nuxeo's own Automation endpoint is closed to both chains,** by the kit: a REST binding each,
  for administrators only, so that a person runs them through a button or not at all. Closing is
  not widening, so the kit may do it; the allow-list is what it may not touch.
- **`enabledWhen` is `app.rules.canWrite`:** a reader who may not change the claim sees the button
  and cannot choose it. The server checks `Write` itself, whatever the button let through.

### How it was verified, with no deploy

- **Against the server's own classes:** `node workflow/platform-check.mjs` loads the operations
  component's two chains with `OperationChainContribution` and its bindings with `RestBinding`, from
  the local container's jars, read-only; checks each binding is a chain's, for administrators only;
  and runs each chain's comment, a template, with the server's MVEL and the chain parameters
  `AgenticUi.RunAction` gives, a note holding a template among them, which comes back as text. Run
  on 25 November 2026: 107 checks passed, 12 of them these.
- **In `nuxeo-agentic-core`'s tests:** `AllowListXmlTest` reads the demo deployment's contribution
  with XMap, registers it, and serves the kit's own `actions.json` through the registry with it:
  Request medical records served, with its three parameters' sources, Refer to special
  investigations left out.
- **The package pipeline**, below, and its selftest, which refuses a copy of the kit that
  contributes to the allow-list, three ways.
- **Not yet:** an install. Whether the server registers the allow-list, serves the file filtered and
  runs the chain is for the steps file, once the kit and the contribution are installed.

## Building it

Since 0.5.0 its buttons run two chains, and the pipeline holds a package to the allow-list of the
deployment it is built for, refusing every operation without one: `deployment/build-allow-list.json`
names both, and CI gives it the pipeline (`app-packages.yml`). It is a build input, in no package
and on no server; the demo server's own allow-list is narrower ([below](#the-operation-buttons)).

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json
```

It writes `dist/payers-claims-demo-0.5.0.zip`.

After changing the route model's source, write its zip again first, and commit it:

```bash
node business-apps/packages/payers-claims-demo/workflow/build-route-model.mjs
```

Held to the package as it was, as a pull request's check holds it
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 8), it also writes
`dist/payers-claims-demo-0.5.0.changes.md`. Run on 25 November 2026 against the staging branch's
0.4.1: 13 changes, which need a patch version, and 0.5.0 raises the minor.

```bash
mkdir -p /tmp/base && git archive origin/staging/enterprise-grade-app business-apps/packages/payers-claims-demo | tar -x -C /tmp/base
```

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json --previous /tmp/base/business-apps/packages/payers-claims-demo
```

Held to its content model ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md),
section 4): `content-model.json` is the stand-in model as a local Nuxeo with this package installed
answers it. It was exported with `npm run app-package:model` and cut down to the kit's five types,
their facets and their schemas. Export it again when the stand-in model changes. **Since 0.4.1,
one property of it is written by hand:** `case:checklist`, in the shape the server answers a list
of complex values with, its four subfields each with its type's constraint, as `relatedtext` and the
contracts kit's boolean are answered. No server has 0.4.1 to export it from; export it again once
one does. Run on 25 November 2026, the four layouts are held to it with no finding.

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json \
  --model business-apps/packages/payers-claims-demo/content-model.json
```

## Installing it on a local Nuxeo

The local Nuxeo is the Docker container `nuxeo`, on port 8080. Run on 23 November 2026 against
Nuxeo 2025.10.18, as below.

**1. `nuxeo-agentic-ui` first.** This package depends on it (`package/package.xml`), and it serves
the layouts. A server registered with Nuxeo Connect installs it from the Marketplace. Otherwise
build it from this repository, writing a version into its `package.xml` first, as
`build-marketplace.yml` does: its source says `@VERSION@`, and nothing in the Maven build replaces
it.

```bash
sed -i.orig 's/version="@VERSION@"/version="2026.0.2-'"$(date +%Y%m%d%H%M%S)"'-BUILD-local"/' nuxeo-agentic-ui-package/src/main/resources/package.xml
```

```bash
mvn -pl nuxeo-agentic-core,nuxeo-agentic-ui-package package -DskipTests
```

```bash
mv nuxeo-agentic-ui-package/src/main/resources/package.xml.orig nuxeo-agentic-ui-package/src/main/resources/package.xml
```

**2. Both packages into the container,** then a one-off script that installs them when it next
starts. The commands name 0.3.0, the version they were run with; for 0.4.0, name its zip, and check
it as [over version 0.3.0](#over-version-030-version-040-with-the-claims-review-workflow) says. `nuxeoctl mp-install` refuses while the server runs, and the server is the container's
main process, so stopping it stops the container. The image runs every `.sh` file in
`/docker-entrypoint-initnuxeo.d/` before it starts the server; this one removes itself.

```bash
docker cp nuxeo-agentic-ui-package/target/nuxeo-agentic-ui-package-2026.0.2-SNAPSHOT.zip nuxeo:/tmp/nuxeo-agentic-ui.zip
```

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.3.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-ui.zip /tmp/payers-claims-demo-0.3.0.zip --accept=true > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.** `/var/log/nuxeo/payers-kit-install.log` in the container lists both packages
installed, and the server log's `Component Loading Status` has nothing pending or missing.
`/nuxeo/agentic-ui-config/layouts.json` lists the four `view` layouts and Member's `metadata` one.

**Over version 0.2.0,** install only this package: `mp-install` upgrades it, removing 0.2.0 first,
and the records stay. Version 0.3.0 adds a type and page providers, and removes none, so nothing
needs deleting first. Run on 23 November 2026, as above, with `nuxeo-agentic-ui` already installed.
A rebuild of a version already installed is skipped as unchanged: in the one-off script, run
`nuxeoctl mp-remove payers-claims-demo --accept=true` before `mp-install`, as was done here.

### Over version 0.3.0: version 0.4.0, with the claims review workflow

**Not run yet.** Written from the 0.3.0 install, which was, and from what the platform's bundles
were read to do (above). With `nuxeo-agentic-ui` already installed, from the repository's root:

**1. Build it, and its zip.**

```bash
node business-apps/packages/payers-claims-demo/workflow/build-route-model.mjs --check
```

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json
```

**2. Into the container, with a one-off script** that removes the package installed, then installs
this one, when the container next starts, then removes itself: `mp-install` refuses while the server
runs, and the remove first means a rebuild of the same version is not skipped as unchanged.

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.4.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' '{ nuxeoctl mp-remove payers-claims-demo --accept=true && nuxeoctl mp-install /tmp/payers-claims-demo-0.4.0.zip --accept=true; } > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- `/var/log/nuxeo/payers-kit-install.log` in the container lists 0.3.0 removed and 0.4.0
  installed: `docker exec nuxeo cat /var/log/nuxeo/payers-kit-install.log`;
- the server log's `Component Loading Status` has nothing pending or missing, and names no
  `nuxeo.config.payers-claims-demo` component:
  `docker exec nuxeo grep -A20 "Component Loading Status" /var/log/nuxeo/server.log | tail -25`;
- the server log has no error from the import:
  `docker exec nuxeo grep -n -i -E "RouteModelsZipImporter|PayersClaimReview" /var/log/nuxeo/server.log`;
- the model is imported, and named for the tasks' forms: as an administrator,
  `GET /nuxeo/api/v1/workflowModel/PayersClaimReview` answers 200;
- the vocabulary is there: `GET /nuxeo/api/v1/directory/PayersClaimDecision` lists `approve` and
  `deny`;
- the step's variables are: `GET /nuxeo/api/v1/config/schemas/var_PayersClaimReview_determine`
  lists `decision`, `allowedAmount` and `denialReason`.

**4. Seed it again** (below). Until then the claims seeded under 0.3.0 are in `project`, with no
transition but `submit`; the seed follows it, and the claim's way on to its status, and checks each
claim's state is its status. Nothing needs deleting first: 0.4.0 removes no type, schema or page
provider.

### Over version 0.4.0: version 0.4.1, with the appeals

**Not run yet.** The same as over 0.3.0, above, with this version's zip; over 0.3.0, install 0.4.1
directly, and check both lists below. With `nuxeo-agentic-ui` already installed, from the
repository's root:

**1. Build it.**

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json
```

**2. Into the container, with the one-off script** that removes the package installed and installs
this one when the container next starts, then removes itself:

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.4.1.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' '{ nuxeoctl mp-remove payers-claims-demo --accept=true && nuxeoctl mp-install /tmp/payers-claims-demo-0.4.1.zip --accept=true; } > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- the install log lists 0.4.0 removed and 0.4.1 installed, and the server log's
  `Component Loading Status` has nothing pending or missing, as above;
- the case schema has the checklist: `GET /nuxeo/api/v1/config/schemas/case` lists `checklist`,
  with `item`, `done`, `doneBy` and `doneOn`;
- `/nuxeo/agentic-ui-config/layouts/Case/view.layout.json` holds the `checklist` and `history`
  cards.

**4. Seed it again** (below). It writes the appeals' checklists, the second appeal and its denied
claim, and empties every other case's checklist. Nothing needs deleting first: 0.4.1 removes no
type, schema, property or page provider.

### Over version 0.4.1: version 0.5.0, with the operation buttons

**Not run yet.** Written from the 0.3.0 install, which was. Three things go on the server: a
`nuxeo-agentic-ui` with the allow-list and `AgenticUi.RunAction`, this branch's or later; the kit;
and the deployment's allow-list, which is not in either package. From the repository's root:

**1. Build both packages:** `nuxeo-agentic-ui` as in step 1 of the first install, above, then the
kit.

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --allow-list business-apps/packages/payers-claims-demo/deployment/build-allow-list.json
```

**2. The deployment's allow-list, into the server's configuration.** A file in `nxserver/config/`
whose name ends in `-config.xml` is a contribution the server reads at start, as
`nuxeo-agentic-connectors`' README installs its connector. It is the server's, not a package's: an
upgrade of either package leaves it, and removing it takes every button's chain off the allow-list.

```bash
docker cp business-apps/packages/payers-claims-demo/deployment/payers-claims-demo-operations-config.xml nuxeo:/opt/nuxeo/server/nxserver/config/payers-claims-demo-operations-config.xml
```

**3. Both packages into the container, with the one-off script,** which removes the kit and installs
both when the container next starts, then removes itself:

```bash
docker cp nuxeo-agentic-ui-package/target/nuxeo-agentic-ui-package-2026.0.2-SNAPSHOT.zip nuxeo:/tmp/nuxeo-agentic-ui.zip
```

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.5.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' '{ nuxeoctl mp-remove payers-claims-demo --accept=true && nuxeoctl mp-install /tmp/nuxeo-agentic-ui.zip /tmp/payers-claims-demo-0.5.0.zip --accept=true; } > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**4. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- the install log lists the kit removed and both installed, and the server log's
  `Component Loading Status` has nothing pending or missing;
- the server log names the allow-list's entry, from the configuration:
  `docker exec nuxeo grep -n "Agentic UI allow-list" /var/log/nuxeo/server.log` shows
  `Payers.RequestMedicalRecords allowed by payers-claims-demo.deployment.operations`, and the
  registry's leaving out the other:
  `docker exec nuxeo grep -n "Agentic UI app registry" /var/log/nuxeo/server.log` names
  `payers.claim.referToInvestigations`;
- as an adjuster, `GET /nuxeo/agentic-ui-apps/apps/payers-claims/actions.json` holds
  `payers.claim.requestRecords` and not `payers.claim.referToInvestigations`;
- the rest is the steps file's, below: the button run, the chain's entry in the claim's history,
  and each refusal, the REST binding's among them.

With no contribution in `nxserver/config/`, the registry serves neither button, and the server log
says so: an allow-list nobody installed allows nothing.

### Removing it

**First delete the seeded workspace,** `/default-domain/workspaces/payers-demo`, and empty it
from the trash: do the same before replacing the stand-in model. A document whose type is gone
cannot be read, and would break the folder and the searches that hold it.

**From 0.4.0, cancel the claims review workflows first,** and delete the route model: every running
`PayersClaimReview` instance (`DELETE /nuxeo/api/v1/workflow/<id>`, as an administrator, for each
`GET /nuxeo/api/v1/workflow?workflowModelName=PayersClaimReview` lists), then the model
`PayersClaimReview` under the route models' folder. Its instances, their tasks and its nodes carry
the `facet-var_PayersClaimReview…` facets, whose schemas leave with the package, as the claims'
types do. **Not run yet.**

Then remove the package the way it was installed. `nuxeoctl mp-remove`, like `mp-install`,
refuses while the server runs, and stopping the server stops the container, so a one-off script
removes it when the container next starts, then removes itself. **Not run yet:** this was written
from the install, which was.

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-remove payers-claims-demo --accept=true > /var/log/nuxeo/payers-kit-remove.log 2>&1 || echo "payers kit: removal failed, see /var/log/nuxeo/payers-kit-remove.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-remove.sh && chmod 755 /tmp/zz-payers-kit-remove.sh
```

```bash
docker cp /tmp/zz-payers-kit-remove.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

The demo's people are given a password of your choosing, for this server, which the seed puts back
on every run:

```bash
export PAYERS_DEMO_PASSWORD=<a password for the demo users>
```

```bash
node business-apps/packages/payers-claims-demo/demo/seed.mjs
```

- **What it writes:** four members, three providers, nine claims, four cases and four claim
  documents, under `/default-domain/workspaces/payers-demo`. Two of the cases are appeals, each
  against a denied claim and with its checklist: CASE-2041, under way, two of five items done, and
  CASE-2043, decided, every item done, against CLAIM-000145, which 0.4.1 adds. Morgan Chen holds
  that claim, so none of what phase 1's demo counts as Dana Lee or as member services changes.
- **And the people:** six fictional users, in the three groups the kit's rules name.

  | User           | Groups                                   | Works                                     |
  | -------------- | ---------------------------------------- | ----------------------------------------- |
  | `dana.lee`     | `claims-adjusters`                       | Most of the claims                        |
  | `morgan.chen`  | `claims-adjusters`, `claims-supervisors` | One pended claim                          |
  | `riley.brooks` | `member-services`                        | Two cases                                 |
  | `sam.patel`    | `member-services`                        | The two appeals, and the appeals demo     |
  | `alex.rivera`  | `claims-adjusters`                       | The workflow demo's claims, as adjuster   |
  | `jordan.kim`   | `claims-supervisors`                     | The workflow demo's claims, as supervisor |

  Every group may read the workspace; adjusters and supervisors may also change claims, which
  approving one needs. No demo group may change a member, so none of the demo's people is offered
  the Member edit form, which would list the social security number. The seed checks both as each
  user, wherever the permission comes from. The last two hold none of the seeded claims, so what
  the workflow demo does never changes the figures phase 1's demo counts.

- **The appeals are held to the Case page first.** Before it asks the server anything, the seed
  holds `data.mjs`'s cases to the Case layout's checklist card (`demo/appeals.mjs`): an appeal
  against a claim that is not denied, an entry for an item the card does not list or listed twice,
  a done item that does not say both who and when, someone not of the demo's people or a day that
  does not exist, or a checklist on a grievance, stops the run with exit 1, naming it. An entry
  not done may still say who and when, as CASE-2041's medical records do: the page shows neither.

- **Each claim's lifecycle is its status.** After it writes a claim, the seed follows the fewest
  transitions of the claim lifecycle from the state the claim is in to its status
  (`demo/lifecycle.mjs`, which reads the lifecycle from the stand-in model): from `submitted` for a
  new claim, from `project` for one created under 0.3.0. A claim no transition can bring to its
  status, such as one reviewed since that `data.mjs` has as submitted, stops the run with exit 1,
  naming it: delete it, empty it from the trash, and run the seed again.

- **Safe to run twice.** A record already there is put back to `data.mjs`'s values, a trashed one
  is restored, and a place that holds a document of another type stops the run untouched. A user
  is put back to its name, groups and the demo password, and the demo's groups to their
  permissions. A user or a group of the same name that the seed did not create, which it knows by
  its marker (a user's `company`, a group's `description`), is found before anything is written,
  and stops the run with exit 2.
- **It checks what it wrote:** last, it signs in as each user, and checks their groups and what
  they may change, once, reads each claim back, in the state its status names, and each case,
  holding the checklist it was given, entry for entry. Then it runs
  the seven page providers and compares what they return with
  what it seeded, each queue's aggregates included, asking `payers_my_claims` for each adjuster's
  claims as that adjuster. A queue may hold claims the seed did not write: the seed checks its
  own, and the demo refuses such a server. The search index lags the repository, so the page
  providers are asked again, once a second, for up to `NUXEO_INDEX_WAIT_MS` (60 seconds).
- **What it needs:** Node 24, nothing to install. `NUXEO_USER`, `NUXEO_PASS` and
  `PAYERS_DEMO_PASSWORD` have no default, and `NUXEO_USER` must be an administrator: only one may
  create users and groups. `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a
  precondition is not met: no credentials, no demo password, no server, credentials refused or not
  an administrator's, the package not installed or older than 0.4.1, no
  `/default-domain/workspaces`, or a user or a group of the demo's names that the seed did not
  create.

It prints a member's and a provider's record page, and each appeal's, on the app at `APP_URL`
(`http://localhost:4200` by default, `npx nx serve nuxeo-ui`).

### Seeing it under `nx serve`

Installed on a server, the app reads its layouts from `/nuxeo/agentic-ui-config/`, which the
package fills. Under `npx nx serve nuxeo-ui` it reads `/agentic-ui-config/` on its own port
instead (`app-config.tokens.ts`), served from the git-ignored
`apps/nuxeo-ui/public/agentic-ui-config/`, which `npm run config:dev` writes. This serves the
kit's layouts, home, menu, queues, labels and task forms there, from the repository's root:

```bash
C=business-apps/packages/payers-claims-demo/bundle/agentic-ui-config && npm run config:dev -- --layout Member/view=$C/layouts/Member/view.layout.json --layout Member/metadata=$C/layouts/Member/metadata.layout.json --layout Claim/view=$C/layouts/Claim/view.layout.json --layout Case/view=$C/layouts/Case/view.layout.json --layout Provider/view=$C/layouts/Provider/view.layout.json --home $C/home.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/unassigned-claims.json --queue $C/queues/my-claims.json --queue $C/queues/pending-determination.json --task PayersClaimReview.determine=$C/tasks/PayersClaimReview.determine.layout.json --task PayersClaimReview.supervisorApproval=$C/tasks/PayersClaimReview.supervisorApproval.layout.json
```

Then start the dev server, or restart it: it serves only the files that were there when it
started.

```bash
npx nx serve nuxeo-ui
```

Sign in as one of the demo's people, with the demo password: `dana.lee` for an adjuster's home,
`riley.brooks` for member services'. An administrator is in none of the kit's groups, so sees an
empty home and none of the queues.

**The social security number** shows only to members of the group `member-services`
(`app.rules.inGroup`), on the Member page. The Properties panel beside it lists the member's
properties from `layouts/Member/metadata.layout.json`, which leaves the number out for everyone:
version 1 has no rules, and without the file the panel lists the whole schema, the number
included, to everyone the page hides it from. Hiding it is a convenience, not a control: the API
still returns it to anyone who may read the member, and masking it there is decision I.

## Running the demo

Phase 1's demo script, as a steps file of the beta harness
([`scripts/beta-harness/README.md`](../../../scripts/beta-harness/README.md)), end to end:

1. an adjuster's home, with KPIs from the page providers' aggregates;
2. a queue opened, its rows in the server's order, and narrowed by a facet on the server;
3. a member, opened from the queue through its member column, a link named for the member, with
   age, combined address, and the claims and cases lists;
4. member services seeing the social security number, which the adjuster does not, anywhere on
   the Member page, the Properties panel included; nor may the adjuster change the member, whose
   Edit form would list it;
5. the layout file behind the page, beside it.

Step 4 differs from the plan's words, "the protected fields are masked on screen": it follows the
Member page this kit has, layout-v2.md's section 9, which shows the number to member services
alone and leaves it out, not masked, for everyone else. Masking the value itself is decision I.

Its figures, rows and values are read from `data.mjs` and the kit's files; the demo's own choices,
which cards each group's home shows, the member and the facet bucket, are written in the script.
**What it needs:** the package installed and seeded (above), the dev server serving the kit's files
(above), and Playwright (`scripts/beta-harness/README.md`, "Prerequisites"). It signs in as an
adjuster, the run's own user, then switches the browser to member services, which the identity guard
is told of.

```bash
NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-claims-demo
```

`APP_URL` names the dev server if it is not on `http://localhost:4200`. The evidence, screenshots,
a video and `INDEX.md`, goes to `~/Desktop/agentic-ui-evidence/beta/payers-claims-demo/`, outside
the repository. Exit 2 means a precondition is not met, and says which: the run's user is not an
adjuster in no other group, `PAYERS_DEMO_PASSWORD` is unset or refused, the package or the seed is
missing, a claim the seed did not write is in what the demo counts, or the dev server serves
something other than the kit's files.

Run on 24 November 2026, against Nuxeo 2025.10.18 with this package installed and seeded: 37 of 37
checks passed, on six distinct screenshots. With the kit broken on purpose in six runs, and in a
seventh the steps file pointed at a claim instead of the member, 21 of its 27 checks outside the
preconditions were each seen failing: every home figure and card set, both menus, the queue's order,
facet, request and narrowing, the member's name, age, address, claims and cases, the SSN hidden from
the adjuster (by its rule, and by the Properties panel) and shown to member services, the adjuster's
right to change the member, and the page drawn as its file says. Not seen failing: the queue's
address and title, the record page's three cards, the Properties panel drawn, the served layout
being the kit's, the bundle holding no code, and the console. Of the preconditions, these were seen
refusing a real environment: the dev server serving other files, a supervisor as the run's user,
and, with its test widened on purpose, a claim another session had left on the server, which the
demo's figures do not count; and, with the seeded statuses it expects changed, the one that proves
the properties it judges arrived.

**Changed since that run, and not run since:** step 3 opened the member by its address then. It
now clicks the member's link in a row of the narrowed queue, after a check that the link's text is
the member's name and that it links to the member, and a precondition that one of the rows step 2
leaves is the member's claim. The script runs as `dana.lee`, whose password was not to hand, so
the whole of it has not been run with that change. What was checked, on 24 November 2026 in a
headless browser against the same server, is what the new lines read, run as an administrator
over a copy of `my-claims.json` that names `dana.lee` in place of `$currentUser` and drops its
group rule, since an administrator is shown no queue: the queue narrowed to "paid", the row of
CLAIM-000130 with one member link, reading "John Smith" and routed to the member, and the click
opening the member's record page with its three cards. The other checks of step 3 are unchanged.

**Since 0.4.0, step 5's "the kit's bundle holds no code" reads the workflow's files as data, by
place** (`scripts/beta-harness/steps/payers-claims-demo/bundle-data.mjs`): JSON, XML, XSD and the
manifest, anywhere; CSV under `data/vocabularies/`; and the route model's zip at
`data/PayersClaimReview.zip` alone, when every entry it holds is a folder, the `.nuxeo-archive`
marker, or an XML, JSON, properties or CSV file. Anything else is code: a script, a class, a jar, a
zip anywhere else, a zip it cannot read, and an entry of any other kind inside the route model's.
`node scripts/beta-harness/steps/payers-claims-demo.selftest.mjs` breaks a copy of the bundle in 11
ways, among them a `.js` file in the bundle and one in the zip, each refused, and CI runs it. With
`.js` taken as data on purpose, those two controls failed. The demo itself has not been run on
0.4.0.

### The claims review workflow's demo

Phase 2's first three demo steps, as a steps file of the beta harness,
[`scripts/beta-harness/steps/payers-claims-workflow.mjs`](../../../scripts/beta-harness/steps/payers-claims-workflow.mjs):

1. an adjuster approves a claim billed over $5,000, in the task panel, through the determination's
   task form: the adjuster's task ends, a supervisor's opens, and the claim stays in review with its
   allowed amount;
2. the supervisor approves it in their task form, and the claim moves to Approved, its lifecycle
   state and `claim:status` both, with no task left, shown so on its record page;
3. a denial with no reason is stopped by the form's field rule: nothing is sent, the task stays open
   and the claim in review.

Then, through the REST API, past the form: the server refuses the same denial, leaving the claim in
review and its determination open again, and denies it with a reason; and a claim billed exactly
$5,000, the threshold read from the route model's own condition, is approved by the adjuster alone,
with none of the history of a claim sent to a supervisor.

Each run writes three claims of its own, numbered for it (`CLAIM-WF-<run>-1` to `-3`) and marked in
their description, in the seeded claims folder: no member, no provider, and the workflow's adjuster,
so none is in what phase 1's demo counts once the run has approved or denied it. The next run cancels
their workflows, if any is left, and trashes them, first. **What it needs:** the package 0.4.0
installed and seeded, the dev server serving the kit's files with its task forms (above), and
Playwright. It signs in as the workflow's adjuster, the run's own user, then switches the browser to
the supervisor, which the identity guard is told of, and back.

```bash
NUXEO_USER=alex.rivera NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-claims-workflow
```

Exit 2 means a precondition is not met, and says which: the run's user is not `alex.rivera`, in
`claims-adjusters` and not `claims-supervisors`; `jordan.kim` does not sign in with
`PAYERS_DEMO_PASSWORD`, in `claims-supervisors` and not `claims-adjusters`; the package is older
than 0.4.0; the claims folder is missing or the adjuster may not add to it; the dev server serves
other task forms, labels or Claim page; or an earlier run's claims could not be put away: their
workflows cancelled, and they trashed. **Not run yet.**

### The appeals

Phase 2's demo step 6, "Open an appeal case with its checklist and timeline", as a steps file of
the beta harness,
[`scripts/beta-harness/steps/payers-appeals.mjs`](../../../scripts/beta-harness/steps/payers-appeals.mjs).
It is built on decision 2's recommendation, as the workflow is, and decision 3 stays open: the
checklist ticks nothing, and the appeals have no operation buttons
([decisions.md](../../../docs/business-apps/decisions.md)).

- **An appeal is a Case,** of the category `appeal`, not a type of its own: the model's Case already
  holds a claim, a member, a state and an assignee, and the Member page's cases card lists appeals
  and grievances together. It is opened against a denied claim, and its `case:claim` links to it,
  shown on the Case page as a `document-link`: the claim's title, a link that opens it.
- **The Case page's two new cards** (`layouts/Case/view.layout.json`): `checklist`, shown while
  `case:category` is `appeal` (`app.rules.fieldIn`), lists five items, from "Appeal letter
  received" to "Decision letter sent"; `history` is the case's timeline, its default kinds of
  event, ten at a time. Both are configuration: the items and their words are the layout's and the
  labels', and what is done, by whom and when is the case's `case:checklist`.

The demo, run as the appeals' specialist, `sam.patel`, who reads and changes nothing:

1. the appeal under way, CASE-2041: the file's five items, in its order, which is not the order
   the seed writes them in, and in its words; the two done each with who and the day; the three not
   done with neither, though the medical records' entry still names who asked for them and when,
   and two have no entry at all; "2 of 5 done"; and its claim's link, which opens CLAIM-000144,
   denied;
2. its timeline: the server's audit of the case, of the card's kinds, newest first, entry for
   entry; and, when the case's audit holds an event of another kind, none of those drawn. A seeded
   case's may hold none, and the run then says so in a note;
3. the decided appeal, CASE-2043: the same items in the same order, every one done, by the people
   and on the days the seed wrote;
4. a grievance, CASE-2042: no checklist, by the card's rule, and its timeline still drawn;
5. the Case layout the dev server serves is the kit's file, and the bundle holds no code.

```bash
NUXEO_USER=sam.patel NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-appeals
```

**What it needs:** the package 0.4.1 installed and seeded, the dev server serving the kit's files
(above), and Playwright. Exit 2 means a precondition is not met, and says which: the run's user is
not `sam.patel`, in `member-services` and neither claims group; `data.mjs` disagrees with the Case
page's checklist; the package is older than 0.4.1; a case is missing or does not hold the checklist
the seed wrote; an appeal's claim is not denied on the server; or the dev server serves another
Case page or other labels. **Not run yet:** the kit 0.4.1 is installed nowhere. What was run, on
25 November 2026, is the record page engine's tests, which draw the checklist from a layout and a
record, and the seed's controls against their stand-in server, which write and check both appeals.

### The operation buttons' demo

Phase 2's demo step 4, as a steps file of the beta harness,
[`scripts/beta-harness/steps/payers-operations.mjs`](../../../scripts/beta-harness/steps/payers-operations.mjs),
run as an adjuster, `dana.lee`:

1. a claim of theirs in review, CLAIM-000131, offers Request medical records on its toolbar, and not
   Refer to special investigations;
2. its dialog asks the kit's question, with the form's two fields; run with the note empty, the
   form refuses it and nothing is sent;
3. with a note and Urgent ticked, it runs, the person is told the records are requested, and the
   claim's history holds the chain's "Medical records requested", urgently, with the note, and
   `AgenticUi.RunAction`'s "App action run", which holds no value;
4. a paid claim of theirs offers no button: its `visibleWhen` reads the record's state.

Then, past the app, as a hand-crafted request would go, the negative checks: the registry serves
the kit's `actions.json` without Refer to special investigations, and its diagnostics, which the
adjuster may read, say why; `AgenticUi.RunAction` answers 404 for that action, 400 for a value the
form does not send and for a note over the allow-list's 500 characters, and 403 to member
services, `riley.brooks`, whom the allow-list's group leaves out; and Nuxeo's own Automation
endpoint refuses the adjuster both chains, by the kit's REST bindings. None of the six writes to
the claim's history.

```bash
NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-operations
```

**What it needs:** `nuxeo-agentic-ui` from this branch or later, the package 0.5.0 installed and
seeded, the deployment's allow-list in `nxserver/config/` (above), `PAYERS_DEMO_PASSWORD` for
member services, and Playwright. Under `nx serve`, the buttons come from the app registry alone,
through the dev server's proxy, never from `config:dev`; the dev server serves the kit's labels,
or none of them. Exit 2 means a precondition is not met, and says which. Each run leaves two
entries in CLAIM-000131's history, the chain's marked with the run's id, which no other demo counts.
**Not run yet:** the kit 0.5.0 is installed nowhere.

## What a server shows, and what the dev server does

The configuration servlet in `nuxeo-agentic-core` answers a fixed set of addresses, to everyone:
the bootstrap, the manifest, `layouts.json` and the layouts it lists, and images. The app
registry, beside it, serves the rest of the app after sign-in, to the groups `app.json` names,
from the `<app>` the kit's component contributes
([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 10). It is
built on the decision log's proposed answers to B and E, which are open
([decisions.md](../../../docs/business-apps/decisions.md)). So, installed on a server, with a
`nuxeo-agentic-core` that has the registry:

| Part                         | Served by the package on a server                                                   | Under `config:dev`                           |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| The model and page providers | Yes                                                                                 | From the server                              |
| The five layouts             | Yes                                                                                 | Yes                                          |
| `home.json`                  | From the registry, to the demo groups                                               | Yes, and it wins over the registry's         |
| `navigation.json`            | From the registry, to the demo groups                                               | Yes, and it wins over the registry's         |
| The three queues             | From the registry, to the demo groups                                               | Yes, and they win over the registry's        |
| `labels/en.json`             | From the registry, to the demo groups                                               | Yes, and it wins over the registry's         |
| `actions.json`               | From the registry, with only what the server's allow-list lets run, read at startup | No: the app reads it from the registry alone |
| `app.json`                   | From the registry: it lists the app                                                 | No                                           |

**So a production install shows the record pages to everyone, and the home, the menu and the
queues to the demo groups once they sign in.** A person in none of them, an administrator
included, is shown no app. The demo itself still runs on a development server, as it does here.

## Not done yet

- **A record the reader may not read was not seen live.** A reference shows the record it names, by
  its title, as a link that opens it
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 11): a queue's member column,
  the Provider page's claims, the Case page's member and claim, the Claim page's member, and the
  Properties panel beside a Case or a Claim. The panel was checked live on 24 November 2026, as an
  administrator in a headless browser: beside CASE-2042, the member shows as "John Smith" and the
  claim as "CLAIM-000132", each a link to its record, the member's opening it when clicked, and
  neither id is on the panel. A reference to a record that no longer exists shows "Unavailable",
  and so does one the reader may not read, which was not seen: the checks ran as an administrator,
  who may read every record.
- **Mark as paid is not offered from `actions.json`,** on a row or the record: the app runs an
  operation button, and leaves a lifecycle button to the platform's own Change state, saying so in
  the console. It is the lifecycle's `pay`, for supervisors on an approved claim, which no step of
  the workflow follows. Before 0.4.0 it was an approve button, which on a claim whose review runs
  would have approved it outside the workflow, and left the workflow's next chain to fail.
- **The operation buttons have not run on a server:** the kit 0.5.0, the deployment's allow-list
  and a `nuxeo-agentic-ui` that runs them are installed nowhere, so demo step 4's steps file has not
  run. The chains are held to the server's own classes and MVEL, and the registry and the run to
  `nuxeo-agentic-core`'s tests, with fakes of the session and of Automation. An administrator may
  still run both chains through Nuxeo's own Automation endpoint, which the REST bindings allow them;
  the demo does not.
- **Refer to special investigations is a control, not a feature,** on the demo server: the demo's
  allow-list leaves it out on purpose. A deployment that wants it adds an entry for
  `Payers.ReferToInvestigations`, and supervisors are offered it.
- **The platform's lifecycle buttons offer a claim's transitions while its review runs.** The
  record page lists the transitions the claim's state allows; one followed there, approve or deny
  in review, makes the workflow's own next transition fail when its step completes, and the
  workflow is then abandoned from the task panel. The demo follows none.
- **The claims review workflow has not run on a server:** the kit 0.4.0 is not installed. Its route
  model has been held to the platform's own classes (`workflow/platform-check.mjs`) and its own
  controls, not imported, started or run; the steps file has not run.
- **Who follows a claim's lifecycle is not the workflow's alone.** Adjusters and supervisors hold
  `ReadWrite` on claims, which includes `WriteLifeCycle`, so anyone of them may follow `approve`
  through the API, outside the workflow, and a supervisor may approve a claim they determined
  themselves (`morgan.chen` is in both groups). Making the workflow the only way would take the
  lifecycle permission from the groups and have the chains follow it as the system; it is for the
  security review phase 2 needs. Hiding a button is not a control.
- **Not run by the demo:** a supervisor sending a determination back.
- **The appeals have not run on a server:** the kit 0.4.1 is not installed, so demo step 6's
  steps file has not run, and no server has answered `case:checklist` as `content-model.json`
  writes it by hand (above).
- **No one ticks a checklist item in the app.** The card is read-only, and decision 3 builds no
  operation buttons. A case's checklist changes through the REST API, as the seed writes it; the
  kit lays out no Edit form for a Case, and no demo group may change one. Who and when are what the
  writer sends, not stamped: nothing on the server writes `doneBy` and `doneOn` from the change. A
  chain that did would be server code in the kit, as `PayersClaim.KeepStatus` is.
- **An appeal is not a workflow yet.** Nothing moves `case:state` with the checklist: an appeal
  whose items are all done is not decided by that, and one decided with items not done is shown as
  it is. The prototype's appeal review workflow is not built.
- **No appeals queue.** An appeal is opened from its member's cases card, or by its address; the
  prototype's appeals queue and its deadlines are not built.
- **A platform built before the checklist card refuses the Case page,** and shows the document
  page, since `checklist` is a card's content it does not know, a structural error to it. The
  platform's version is still 0.2.0, as it was before the card, so the kit's range, `>=0.2.0`,
  does not say so.
- **The platform check is not in CI:** `workflow/platform-check.mjs` needs Docker, the local
  container and Java 21. The route model's own controls are (above).
- **Phase 1's demo can be pointed at the workflow's adjuster,** `alex.rivera`, who is an adjuster
  in no other group, as its precondition asks: it would then count the workflow demo's claims as
  theirs, and refuse the server. Run it as `dana.lee`, as above.
- **The menu's two platform entries are not added:** `app.navbar.tasks` and `app.navbar.search`
  are in the platform's menu already, and the console says so. They are there for when an app's
  entries may replace the platform's (app-definition-v2.md, section 13).
- **`content-model.json` does not list `PayersClaimSearch`:** no layout names it, and the
  pipeline holds only layouts to the model.
- **The seed's and the demo's controls are not in CI:**
  `node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs` checks the seed's logic
  against a stand-in for the REST API it calls, so it proves the script, not the server; the demo
  needs a server and a dev server, and runs by hand.
