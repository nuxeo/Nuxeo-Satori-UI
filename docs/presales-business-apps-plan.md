# From a file browser to business applications

What presales told us, what they want, what the app lacks for enterprise business use, and a plan.

Written on 21 November 2026 from three presales responses and two screenshots: the Payers demo's
Member record in Nuxeo Web UI and in Nuxeo Satori UI. Every "today" statement was checked against
the code at `ac4cb3305`. Everything else is a proposal, and anything not yet checked says so.

To see the plan rather than read it, open the
[clickable prototype](https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/) (section 12).

## The short version

- Presales is not asking for a better file browser. They sell business applications: a claims
  adjuster working claims, a case specialist working cases, a contract manager, a DAM/PAM team.
  Nuxeo is too expensive to sell for file browsing; SharePoint does that.
- Our app starts from folders and files. Every user lands on the same dashboard and works from a
  folder tree. A record with no file, like a Member, opens on an empty file viewer, and its fields
  are a list in a side panel.
- Nuxeo's strength is its data model: types, schemas, facets, vocabularies, references,
  lifecycles, workflows and page providers. The app uses little of it, and nothing generates
  screens from it.
- A business screen needs Angular code today, and that code cannot plug into the app we ship.
  Presales engineers are not web developers. They expected configuration or agents to fill the gap
  Studio Designer fills for Web UI.
- The plan: start from the business record and the work done on it. Let the data model drive the
  screens. Raise what configuration can do to cover record pages, work queues and business actions.
  Give presales an agent that writes the configuration from the model. The first acceptance test
  is rebuilding the Payers Member, Claim and Case screens without code.
- Part of the authoring side is already designed. The Studio designer prototype covers
  configuration without code, page providers as lists and tabs, server-operation buttons, group
  and state rules, and a configurable dashboard. It does not cover the record page, related records
  with the open record as a parameter, computed fields or work queues (section 11).
- The plan is written around Payers. Checked against twenty other accounts (section 13), the
  platform steps fit them all, but brand DAM, media, engineering document control and records
  management need work that no step covers. Section 14 covers every account in four waves,
  starting with a brand assets kit beside Payers.

## 1. Pain points

Numbered so they can be referred to. Each says what presales said and what is true in the product
today.

### P1. It is a file browser, and Nuxeo is not sold as one

- **Said:** no prospect is looking for a file browser. The demos and the biggest deals are
  business applications.
- **Today:** our product page describes "the everyday work of a Nuxeo user" as browsing folders,
  searching and opening a document ([the short version](../documentation/20-product/00-the-short-version.md#what-it-does)).
  The personas were inferred from the code, not from customer research, and the page says so
  ([personas](../documentation/20-product/03-personas.md)). The Beta scope decision of record is
  "browse, folder tree, search, document detail, metadata, permissions, versions, upload/CRUD",
  with workflow out ([plan of record](adf-hx-beta-plan.md#decisions-locked)). The `satori-beta`
  demo package brands the app as "Acme Claims", but what it contains, as
  [our status page](phase-1-improvements.md) lists it, is branding, theme, languages, sign-in,
  presets and navigation. Nothing about claims.

### P2. Every user gets the same ECM home

- **Said** (internal summary): whatever the use case, the app opens on the dashboard and offers
  content browsing.
- **Today:** the dashboard has four fixed widgets: Recently edited, Tasks, Recently viewed and
  Favorites, plus AI insights, which are switched off
  ([dashboard](../apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html)). There is no
  dashboard slot, so configuration cannot change it
  ([slots](../libs/shared/extensions/src/lib/extension-slots.ts#L35)). The navigation rail lists
  ECM functions (browse, search, tasks, favorites, collections, trash and so on), not business
  objects.

### P3. The data model is not first-class

- **Said:** Satori lacks the Nuxeo basics of data modelling, the platform's biggest strength.
  Ideally we'd point a tool at the model and generate the UI from it.
- **Today:** a type's model appears as lists of fields (the Properties panel, and the edit and
  create forms) and in type and facet rules. Vocabulary values show their labels. No lifecycle
  transition is offered anywhere. Layouts have no handling for document references, so a reference is not a link to the record. The app
  queries three stock page providers (`default_search`, `assets_search`, `default_trash_search`)
  and never a customer's own. `ContentModelService` reads types, schemas and facets, but nothing
  in the app calls it
  ([content-model.service.ts](../libs/shared/nuxeo-client/src/lib/services/content-model.service.ts)),
  and no generator reads the model.

### P4. A business record is shown as if it were a file

- **Said:** Member is not folderish and has no file. The Web UI screen shows the age computed from
  the date of birth, and one address built from four fields. "A list of fields in a side panel
  doesn't get us to a demo we could show a prospect."
- **Today:**
  - Every type except Note opens on the file viewer, so a Member's main area is an empty preview
    ([document-type-traits.ts](../libs/features/document-detail/src/lib/document-detail/document-type-traits.ts#L63)).
  - Its fields are in the read-only Properties panel, below state, version, dates, contributors
    and tags, under a heading that is the schema's name.
  - The schema type picks the control. A layout file cannot name a widget, compute a value,
    combine fields, format an amount or link to another record
    ([extension reference, 9b](extension-reference.md#9b-per-type-layouts--which-properties-a-document-type-shows)).
  - Annotations and Publishing tabs show on every document unless a manifest hides them.
  - Nothing can show related records, like the Claims and Cases tables on the Web UI Member page.
  - Folderish business objects, such as a Case folder, are sent to Browse and never get a record
    page ([document-detail.ts](../libs/features/document-detail/src/lib/document-detail/document-detail.ts#L1327)).

### P5. Configuration stops after branding and arrangement; after that it is Angular

- **Said:** Web UI with Studio Designer builds business applications by configuration. We replaced
  that with a very technical stack. "I am not a Web developer."
- **Today:** configuration covers branding, wording, hiding, reordering and relabelling, type and
  facet rules, and which fields a type shows. A record view, a tab body, a new screen, a button
  that does something new, a dashboard, or a condition like "the user is in the claims team" all
  need code. The only packaged user rules are for administrators, powerusers and external users
  ([extension reference, user rules](extension-reference.md#user-rules)). That code does not plug
  into the shipped app: you build your own app from the template, and `@nuxeo/satori-platform` is
  not published yet ([the short version](../documentation/20-product/00-the-short-version.md#what-needs-code);
  [Phase 1 improvements](phase-1-improvements.md), items 6 to 8).

### P6. There is no task-driven UX

- **Said:** "what do I need to work on today?" is where Web UI fell short, and where Satori and
  agents could do better.
- **Today:** the Tasks page lists workflow tasks next to a preview of the target document's file.
  Completing a task sends only the variables of Nuxeo's stock review workflows (participants, end
  date, review type) and a comment
  ([task-detail.component.ts](../libs/shared/satori-components/src/lib/task-detail/task-detail.component.ts#L240)).
  A custom step, such as a claim determination with a reason code, has no form. There are no work
  queues (unassigned claims, my open cases, overdue items), no SLA view and no home per persona.

### P7. Agents were the promise, but the agent path ends in Angular

- **Said:** the foundation was meant to be "agent-enabled resources", and the expectation is to
  build business apps with agents.
- **Today:** Layer 3 is AGENTS.md, generators, guardrails and an external prompt library. The
  generators scaffold code: a rule, an action, a component, a library, or a config package. None
  reads the model or produces a business screen. The prompt library's branding prompts write to a
  path the server no longer reads ([Phase 1 improvements](phase-1-improvements.md), item 3).
  Runtime AI is off for every user, by a code constant
  ([ai-feature-flag.service.ts](../libs/shared/ai-client/src/lib/ai-feature-flag.service.ts#L35)).

### P8. The names are confusing, and so is the story next to Web UI

- **Said:** stop saying "the Satori demo" or "Satori lacks". There are at least three things: the
  example app, Hyland's Satori framework (which presales cannot access), and the `nxs-`
  components, which look tied to the example app's UX. Nuxeo Product says Web UI is not being
  replaced.
- **Today:** we use "Nuxeo Satori" (programme and Marketplace title), "Nuxeo Agentic UI",
  `nuxeo-agentic-ui` (the package), `Nuxeo-Satori-UI` (the repository), `@nuxeo/satori-platform`
  (the developer package), `nxs-` components, and Satori (`@hylandsoftware/satori-ui`, Hyland's
  design system). Seven names for four things. The rail also shows "Content Innovation Cloud",
  which comes from the design system.

### P9. It feels like the Alfresco way

- **Said:** this pushes the Alfresco/CIC way (a file share) onto Nuxeo, which is a big step back.
- **Today:** the extension model came from Alfresco's ACA (the `$references` merge is ACA's), and
  the app started on adf-hx. The extension architecture is not the problem. The default experience,
  folders and files first, and the CIC title are what give that impression.

### P10. Existing Studio work cannot be reused

- **Today:** still open ([Phase 1 improvements](phase-1-improvements.md), item 12). The data
  model carries over, because it lives on the server. Studio Designer layouts, forms, search forms
  and task layouts do not.

### P11. We have not seen what presales sells

- **Said:** they offered to walk us through demos or share recordings.

## 2. What they actually want

- Nuxeo sold as a platform for business applications, with a UI that helps people do their job on
  business records.
- Screens that start from the record (Member, Claim, Case, Contract, Product) and the work done on
  it, not from the folder and the file.
- A UI that follows the data model: generated from it, then refined.
- A way to build that without being a web developer: configuration, and agents that write the
  configuration.
- A home that answers "what do I need to do today?".
- Small purpose-built apps, one per use case and persona, rather than one general UI.
- Clear names, and a clear position next to Web UI.
- Reuse of existing Studio work where it is possible.

## 3. The Member page, side by side

| Part of the page | Web UI (Payers demo)                                                                                  | Satori UI today                                                 | Target                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Main area        | Member Info card: ID, date of birth with age, HICN, Medicare ID, contact block, address in one block  | Empty file viewer, with a viewer toolbar                        | Record layout: cards of fields, computed and combined  |
| Related records  | Claims table (amount, provider, NPI, service date; sortable; links) and Cases table, with empty state | None                                                            | A related-records widget per relation                  |
| Business fields  | In the main area, labelled for the job                                                                | Bottom of the side panel, under a heading that is a schema name | Main area; the side panel keeps the system information |
| Tabs             | View, Member View, Permissions, History                                                               | View, Annotations, Permissions, History, Publishing             | Business tabs per type; the ECM tabs optional          |
| Navigation       | Breadcrumb "Domain > Members"                                                                         | Folder tree, breadcrumb "default-domain > Members"              | Business navigation: Members, Claims, Cases, my queues |
| Info panel       | State, version, dates, tags, comments, activity                                                       | The same, plus "Indexing properties"                            | Keep it                                                |

## 4. The plan

Each step ends in something presales can demo. The acceptance test for the whole plan: **a
presales engineer rebuilds the Payers Member, Claim and Case screens with no Angular code, in two
days or less, and a prospect would accept the result.**

### Quick wins (days, not weeks, by our estimate)

- Book the presales demo walkthrough (P11).
- For a type with no file, show its layout in the View tab instead of the empty viewer.
  `DocumentLayoutComponent` is already imported by document detail; this would be a third
  packaged view next to the note editor and the viewer.
- Hide Annotations and Publishing by default on types that have no file.
- Ship a parameterised group rule, `isMemberOf(group)`, so configuration can target a team.
- Replace "the everyday work of a Nuxeo user: browse folders…" in the product docs with business
  journeys.

### Step 0. Align before building

- Record the Payers demo, plus one contracts and one DAM/PAM demo. Write each up as persona, job,
  screens, data model and actions.
- Agree a glossary and use it everywhere: docs, the Marketplace listing, the UI. A proposal:
  - **Satori**: Hyland's design system (`@hylandsoftware/satori-ui`), and nothing else.
  - **Nuxeo Satori platform**: the framework customers build on (`@nuxeo/satori-platform`:
    the `nxs-` components, the extension contract, the Nuxeo client).
  - **Nuxeo Satori UI**: the app we ship (`nuxeo-agentic-ui`), one example of what the platform
    builds.
  - **Starter kits**: the per-use-case packages in step 7.
- Settle the position next to Web UI with Nuxeo Product. A proposal: Web UI stays the general ECM
  client, and the Satori platform is for purpose-built business apps. Then reopen the Beta scope
  decision that put workflow out.
- Rework the Workspace prototype around business journeys.
- Rebalance the backlog. Of the last 20 merged pull requests, 9 are browse, search, viewer, CSV
  and component polish, most of the rest are build, dependency and packaging work, and one
  touches tasks. None is about business records or work queues.

### Step 1. Let the data model drive the screens, with no code

- A record page for every type with no file: no viewer, the fields in the main area as cards, and
  the system information in the side panel. Types with a file keep the viewer.
- Folderish business types get a record page with a Documents tab for their children, instead of
  being sent to Browse. Configurable per type: open as a folder or as a record.
- Follow document references (`documentResolver` properties) as links, and list the records that
  point at this one ("Claims for this member").
- Show users and groups by name, as vocabulary values already show by label.
- Read what REST already gives: types, schemas, facets, vocabularies, workflow models and page
  provider definitions (`GET /api/v1/search/pp/{name}` returns the predicates, sort and
  aggregates). Add a small enricher to `nuxeo-agentic-core` for the one thing it does not give:
  the lifecycle transitions a document allows. Checked on a local Nuxeo 2025 on 21 November 2026;
  see the [feasibility report](presales-business-apps-feasibility.md).

### Step 2. Layouts that can describe a business screen (layout file version 2)

- A `view` mode that renders in the main area, with cards, columns and tabs.
- Named widgets: currency, number and percent, date, relative date and age, phone, email,
  address, user or group, vocabulary, document link, chips, status badge, boolean, rich text,
  image and file list.
- Computed and combined fields from a small declarative set: age from a date, a text template,
  sum and count, date difference, and a condition. No JavaScript in configuration.
- Show or hide by a field's value, the lifecycle state or the user's group.
- A related-records widget: a page provider, or an NXQL template with the record as a parameter,
  plus columns, sort, paging, links and row actions. This alone gives the Claims and Cases cards.
- The same widgets in the edit and create forms, with document, user and vocabulary pickers,
  conditional fields, cross-field checks and fields that are read-only in some states.
- First test: the Member page from the Web UI screenshot, built without code.

### Step 3. A home and work queues built around the work

- A home per group: work queues, my tasks, KPI tiles (counts and sums from page provider
  aggregates), recently worked records and overdue alerts.
- A work queue is a page provider plus columns plus actions: take it, assign it, update in bulk.
  Examples: unassigned claims, my open cases by due date, claims over $5,000 waiting for review.
- Navigation built from business objects and queues. The ECM functions (browse, collections,
  trash) stay, but are optional in a business app.

### Step 4. Workflow and lifecycle as business actions

- Task forms from the workflow step's own variables, which can be replaced by a layout file per
  step, as Web UI's task layouts can. The claim determination form, with its reason code, then
  works. The server already describes each task's form: `taskInfo.schemas` names the step's
  variable schema (`var_<node>`, readable from `/api/v1/config/schemas`) and `taskInfo.layoutResource`
  names its layout. Our task model reads neither yet, so this is client work.
- Lifecycle transitions as buttons on the record, from what the document's lifecycle allows,
  labelled in configuration.
- Start a workflow from the record, with its start form.
- Due dates, escalations and SLA status in the queues and on the record.

### Step 5. Buttons that run business logic on the server

- Let configuration place a button that runs a named Automation chain or script on the record or a
  selection, with parameters taken from fields, a confirmation, a success message and a refresh.
  That is what Web UI's operation button does.
- The behaviour lives on the server, in Studio, under server permissions. This changes today's rule
  that configuration can only place an action that already exists in code
  ([Phase 1 improvements](phase-1-improvements.md), item 8), so it is a decision to take, not a
  default.

### Step 6. An agent that builds the app for presales

- Package an app-builder workflow for the coding agents presales already use (Claude Code,
  Cursor, Copilot), as a skill plus an MCP server:
  1. Connect to a development Nuxeo, with credentials from the environment, and read the model.
  2. Ask about personas, jobs, record screens, queues and KPIs.
  3. Write the config package: layouts, queues, home, navigation, actions, labels and branding.
  4. Check it with the existing `build.mjs` checks and the registered-ID contract.
  5. Show it live through dev mode, with no restart per change.
  6. Change it in plain words, such as "show the age next to the date of birth".
  7. Publish it to the pre-production Marketplace.
- The MCP server exposes the model, the registered IDs, the layout and manifest JSON schemas,
  validation, and the preview address.
- When something truly needs code, the agent writes a Layer 2 component in the customer's
  repository. That helps only once such code can load into the shipped app (decision 5).
- Fix the presales prompt library at the same time.

### Step 7. Starter kits: the out-of-the-box apps

- Payers and claims first (Member, Claim, Case, Provider), because presales already has the model
  and the demo. Then case management, contract management and DAM/PAM.
- Each kit is the data model (or presales' Studio project), a config package (record pages,
  queues, home, actions, labels), demo data and a demo script.
- Section 13 proposes which kits come next, by the number of accounts each one serves.

### Step 8. A bridge from Studio, later

- The data model already carries over. Try having an agent translate Studio Designer layouts,
  which are Polymer HTML, into version 2 layout files. Not checked: where those files can be read
  from without the Studio API.

## 5. Beyond the feedback: what enterprise business apps also need

- **Case management:** participants, a checklist of required documents, a timeline that merges
  documents, tasks, comments and audit, related cases, and reopening.
- **Documents on the record:** a Documents tab grouped by category (ID cards, explanations of
  benefits, correspondence). Dropping a file on the record sets its type and its link to the
  record.
- **Inbound capture:** email to case, scan or upload, then classify, extract fields, link to the
  right member or claim, and create a task. `AI.Classify` exists, but AI is off.
- **Outbound documents:** determination letters and other correspondence from templates, for
  example with Nuxeo Template Rendering.
- **Compliance:** retention schedules, legal holds, records declaration and audit export. For
  payers, a log of who viewed protected health information, and masking of fields like HICN or
  Medicare ID for some roles. The app has no screen for retention or legal hold today; only the
  permission names exist.
- **Business reporting:** KPI tiles and charts from search aggregates, with drill-down to the list
  behind them, and scheduled exports. Today there is the administrators' Analytics page.
- **Notifications:** an in-app notification centre, an email on assignment, @mentions in comments
  and digests. Today there is subscribe and unsubscribe.
- **Bulk work at scale:** run an action over a whole query result through Nuxeo's Bulk Action
  Framework, with progress. Today the framework is used for CSV export and ingest; other bulk
  actions act on the documents selected.
- **Integration:** links to the systems of record by URL template, events and webhooks, and record
  data kept in sync from external systems.
- **Several apps on one server:** chosen by address or group, each with its own navigation, home
  and branding. The presales presets show that switching works per browser; this would be per app,
  and supported in production.
- **AI on the record**, which is what the "agentic" name suggests: summarise a member's history,
  suggest the next action, extract fields from incoming documents, flag unusual claims, ask for
  records in plain language. Also an MCP endpoint, so a user's own agent can act on records with
  that user's permissions.
- **Knowing what is used:** usage telemetry for screens, and a configuration diagnostics page
  ("why didn't my layout apply?").
- **Field work:** a record page that works on a phone, and photo capture into a claim.
- **Accessibility:** WCAG 2.1 AA and Section 508 as a release bar for business screens. Healthcare
  and government buyers ask for it.

## 6. What the app lacks to be an enterprise business application

"Today" was checked in the code. "When" refers to the order of work in section 7.

| #   | Area                                | Today                                                                                             | Needed                                                                   | When  |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| 1   | Record page for a type with no file | Opens on the file viewer; fields in a read-only side panel                                        | Record layout in the main area; the viewer only for files                | Now   |
| 2   | How fields are shown                | The schema type picks the control; no widgets, computed or combined fields, formats or conditions | Widgets, a declarative expression set, formats, conditions               | Now   |
| 3   | Related records                     | None                                                                                              | Related-records widget from a page provider or NXQL                      | Now   |
| 4   | Folderish business objects          | Sent to Browse                                                                                    | Record page with a Documents tab                                         | Next  |
| 5   | Home                                | Four fixed widgets                                                                                | A home per group: queues, KPIs, alerts                                   | Next  |
| 6   | Navigation                          | ECM functions                                                                                     | Business objects and queues, per app                                     | Next  |
| 7   | Lists and search                    | Three stock page providers; a custom column shows as plain text                                   | Any page provider as a list, queue or search form, with typed columns    | Next  |
| 8   | Lifecycle                           | No transition actions                                                                             | Allowed transitions as buttons; rules on state                           | Next  |
| 9   | Workflow                            | Only the stock review variables are sent                                                          | Task forms from step variables; SLA; escalation                          | Next  |
| 10  | Business actions                    | Only actions already in code                                                                      | Buttons bound to Automation chains                                       | Next  |
| 11  | Personas and conditions             | Type, facet, write access, administrator, poweruser and external-user rules                       | Group, field value, state and user attribute rules                       | Next  |
| 12  | What configuration can do           | Beyond branding, arrangement and field lists, it is code; code does not load into the shipped app | Record pages, queues, home and actions in configuration; code loads in   | Next  |
| 13  | Generating from the model           | `ContentModelService` unused; no generator reads the model                                        | A working app generated from the model, refined by an agent              | Next  |
| 14  | Agent app builder                   | Code generators and prompts                                                                       | Skill and MCP server: model in, checked config package out, live preview | Then  |
| 15  | Business reporting                  | Administrators' Analytics page                                                                    | KPIs and charts with drill-down                                          | Later |
| 16  | Compliance                          | No retention, legal hold or records screens                                                       | Retention, holds, records, audit export, access logging, field masking   | Later |
| 17  | AI                                  | Off for every user                                                                                | AI on the record, with governance                                        | Later |
| 18  | Studio reuse                        | No path                                                                                           | The model carries over; layouts translated by an agent                   | Later |
| 19  | Previews                            | The whole file is downloaded before it shows                                                      | Streaming                                                                | Later |
| 20  | Several apps per server             | One app; per-browser presets on demo servers                                                      | Apps chosen by address or group                                          | Later |
| 21  | Notifications                       | Subscribe and unsubscribe                                                                         | Notification centre, email on assignment, @mentions                      | Later |
| 22  | Developer package                   | `@nuxeo/satori-platform` not published                                                            | Published, versioned                                                     | Next  |

## 7. Out of the box: what should ship in the box

- **Every type works on install.** On a Nuxeo with a Studio project, each type gets a record page,
  a list, a search and forms generated from its schemas, with vocabulary labels, references as
  links, the records that point at it, lifecycle buttons from its policy, and the viewer only when
  there is a file.
- **My work:** every task with its own form, and queues from the page providers the
  configuration names.
- **A home per role**, with sensible default widgets for each group.
- **Business navigation** generated from the types marked as business types. The ECM functions
  are optional.
- **Starter kits** as Marketplace packages: payers and claims, case management, contract
  management, DAM/PAM. Each has its model, configuration, demo data and demo script.
- **The agent app-builder kit:** the skill, the MCP server, prompts, checks and a live preview.
- **Standard ECM features** (browse, versions, permissions, collections, trash) for the document
  side, without being the default experience.
- **Governance screens** when the server has the add-ons: retention, legal hold, audit.
- **A "build a claims app in a day" tutorial**, tested by someone outside the team.

## 8. Order of work

- **Now:** the quick wins, steps 0, 1 and 2. Demo: the Member page matches the Web UI screenshot,
  with no code.
- **Next:** steps 3, 4 and 5, and publishing the developer package. Demo: a claims adjuster's day,
  from the home page to a queue, a claim, a determination task and a state change.
- **Then:** steps 6 and 7, starting with the payers kit. Demo: a presales engineer builds a
  contracts app with the agent, live.
- **Later:** step 8, compliance screens, AI on the record, several apps per server, and loading
  customer code into the shipped app.

## 9. Decisions needed

1. The position next to Web UI (Nuxeo Product).
2. Reopening the Beta scope decision that put workflow and business records out.
3. Letting configuration bind buttons to Automation chains on the server.
4. A declarative expression set in layouts: how small, and its security review.
5. Loading customer code into the shipped app at run time, or keeping "build your own app from the
   template".
6. Access to the Satori design system for presales and partners. Without it, the `nxs-` components
   fall back to Material.
7. Who owns the starter kits: presales, product, or both.
8. The glossary.

## 10. Risks

- Rebuilding all of Studio Designer is a large product. The prototype in section 11 limits it to
  UI configuration that writes the same JSON. Build the runtime contract first, then its screens.
- Generated screens look generic. Generated is the floor; the starter kits are what demos use.
- The expression set has to stay small to stay safe and supportable.
- If the backlog stays on browse and viewer polish, presales will not use the app, however good it
  is.

## 11. What the Studio designer prototype already covers

The [Studio designer prototype](prototype/studio-designer-satori/index.html), with its
[parity plan](nuxeo-studio-parity-plan.md) and [UX guide](studio-designer-ux-guide.md), is on the
`fix/nuxeo-studio-evaluation-ca2a58` branch and not merged yet; these links work once it is. It is
an in-app editor for customer administrators that matches Studio Designer for the UI: draft,
validate, publish, roll back, and the same JSON a developer would write.

It answers the "configuration instead of development" half of the feedback (P5). Its unit of
design is still the field form and the slot item in today's ECM shell (Browse, Tasks, Collections,
Trash, with Contract and AdmissionForm as examples), not the business record page or the work
queue. Checked against its source on 21 November 2026.

| Plan item                                             | In the prototype                                                                                                                                                               | Coverage                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Configuration instead of Angular (P5)                 | The whole designer, plus View JSON on every editor                                                                                                                             | Covered (authoring)                                                                                               |
| Named widgets (step 2)                                | A widget per field: text input, text area, currency, date, select                                                                                                              | Partly: five widgets                                                                                              |
| View mode (step 2)                                    | Layouts for all five modes, view and import included                                                                                                                           | Partly: sections of fields only                                                                                   |
| Generating from the model (P3, gap 13)                | Field catalogue from schemas; "Configure missing modes" generates a type's layouts                                                                                             | Partly: one type at a time                                                                                        |
| Required, read-only, default at creation              | All three; the default at creation goes beyond this plan                                                                                                                       | Covered                                                                                                           |
| Combined fields, such as the address                  | Layout blocks group fields for reuse                                                                                                                                           | No: a block is several fields, not one value under one label                                                      |
| Computed fields, formats, conditional fields          | —                                                                                                                                                                              | No                                                                                                                |
| Related records (step 2)                              | A Listing tab bound to a page provider ("Related contracts" on a Contract)                                                                                                     | Partly: a tab, not a card, and the query cannot take the open record as a parameter                               |
| References as links; records that point here (step 1) | —                                                                                                                                                                              | No                                                                                                                |
| Lists and search from any page provider (gap 7)       | Page providers screen: form and results layouts, results view, filters from aggregations, binding to a drawer search, a menu entry or a tab; custom columns in the main search | Covered (authoring)                                                                                               |
| Work queues (step 3)                                  | A page provider bound to a menu entry; a custom "Expiring contracts" dashboard card                                                                                            | Partly: no take, assign or bulk update from the queue                                                             |
| Home (step 3)                                         | Dashboard cards: hide, reorder, revert to default                                                                                                                              | Partly: no adding cards, no rules on cards, no KPI tiles                                                          |
| Business navigation (step 3)                          | Drawer entries that open a page, a search or a browse root; packaged entries can be hidden                                                                                     | Partly: the mechanism is there                                                                                    |
| Group, state and permission rules (quick win)         | "Show when": types, facet, lifecycle state, path, permissions and groups, written out as a sentence, with "Preview as"                                                         | Covered for menus, tabs and buttons; not for dashboard cards or fields; no rules on a field's value               |
| Server-side business actions (step 5)                 | "Run a server operation", with an operation allow-list; the server still checks permission                                                                                     | Covered, except operation parameters, confirmation, success message and refresh                                   |
| Lifecycle buttons (step 4)                            | "Approve contract" runs `Document.FollowLifecycleTransition` for the legal group                                                                                               | Partly: one hand-made button, with no parameter to name the transition                                            |
| Task forms (step 4)                                   | A form per workflow node; "Configure missing layouts" is a stub                                                                                                                | Partly: the server does send node variables (checked)                                                             |
| Starting a workflow, SLA, escalation (step 4)         | —                                                                                                                                                                              | No                                                                                                                |
| Record page for a type with no file (step 1)          | —                                                                                                                                                                              | No                                                                                                                |
| Folderish business objects as records (step 1)        | —                                                                                                                                                                              | No                                                                                                                |
| Agent app builder (step 6)                            | In-app assistant: describe one change, get a diff, add it to the draft; it never publishes; BYOK with a cap                                                                    | Partly: one change at a time, for an administrator; no app from the model, no MCP server for presales' own agents |
| Starter kits (step 7)                                 | A "Legal team starter" template to import                                                                                                                                      | Partly: UI configuration only; no model, demo data or script                                                      |
| Studio bridge (step 8)                                | —                                                                                                                                                                              | No: the parity plan reads Studio's source for its design but imports nothing                                      |
| Configuration diagnostics (section 5)                 | A health card, and validation before publish                                                                                                                                   | Covered                                                                                                           |
| Accessibility (section 5)                             | WCAG 2.2 AA rules in the UX guide                                                                                                                                              | Covered, for the designer                                                                                         |
| Step 0, and the rest of section 5                     | —                                                                                                                                                                              | No                                                                                                                |

### Where the two plans disagree

- **One configuration for everyone.** Parity decision 4 rules out configuration per group; this
  plan wants a home per group. Rules per item already give per-group menus, tabs and buttons.
  Extending the same rules to dashboard cards and layout fields covers most of the need without
  configuration per group. Several apps per server stays a later decision.
- **An assistant with no tools.** The prototype's assistant has no network access and no tools
  (parity plan 9.3). Step 6 is an agent that reads the model from a development server. They serve
  different people, administrators in production and presales on a demo server. Both should write
  the same JSON.
- **No free JavaScript.** Parity decision 2 agrees with step 2. Make computed fields registered
  computations, like registered rules, so the designer can offer them from a list.

### What this changes here

- Both plans need the same runtime contract extensions: widget names, a rendered view mode, a
  Listing tab, a run-operation action with parameters, a dashboard slot, and rules on more
  surfaces. Build them once, then the designer screens on top.
- The prototype should add a record-page layout (cards, related records with the open record as a
  parameter, computed and combined fields, conditional fields), queue actions, rules on dashboard
  cards and fields, operation parameters, and a Payers example (Member, Claim, Case) next to
  Contract.

## 12. Clickable prototype

The [clickable prototype](https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/) shows the whole plan as one page. It is published from `main`
beside the Storybook, by `.github/workflows/storybook-pages.yml`. Every page has its own address
and shows, at the top, the plan items it reflects. The data is fictional and nothing talks to a
Nuxeo server.

It has three parts:

- **App**: what the people in the Payers demo use. "Viewing as" switches between a claims
  adjuster, a claims supervisor, an appeals case specialist and member services, and each gets
  their own home, queues and menu. The pages are: My work, five queues, the Member, Claim, Case
  and Provider record pages, the task forms, Inbox capture, Search, Reports, Notifications, the app
  switcher and the optional ECM functions.
- **Brand assets (DAM)**: a second demo, for another fictional customer, Acme Outdoor, on the same
  platform with another starter kit. "Viewing as" also switches to a brand asset manager, a
  creative director, and a licensor's reviewer, who is an outside user and sees only what was sent
  to them. The pages are: the asset library, the asset page with renditions, rights and usage,
  products with the shots each colourway needs, review with pins and rounds, rights renewal, share
  links, and the view a link's recipient gets (section 14).
- **Build**: how a presales engineer makes that app without Angular: the app builder agent, the
  data model, the record layout designer, queues and home per group, actions with parameters,
  starter kits and the Studio bridge.
- **Guide**: the start page with the glossary, a 10-minute Payers demo path and a 5-minute brand
  assets demo path, the Member page before and after, the plan map, the 22 enterprise gaps with a
  link to each answer, every account by use case (section 14), and the decisions.

It uses the Satori theme and icons, built the same way as the Studio designer prototype. The built
`index.html` is not committed, because it carries Satori's compiled theme and icons; the Pages
workflow builds it with the Satori token. To change it, edit the files in `src/`, rebuild from the
repository root, and open `docs/prototype/business-apps/index.html` in a browser:

```bash
node docs/prototype/business-apps/src/build.cjs
```

The build needs `sass`, `@hylandsoftware/satori-ui` and `@hylandsoftware/satori-icons` in
`node_modules`. Set `NODE_MODULES_ROOT` to a checkout that has them if this one does not. It
refuses to write the file if a page names an icon Satori does not have.

## 13. Beyond Payers: twenty other accounts

The plan is written around the Payers demo. This section checks it against twenty other accounts.
Each account's use case is inferred from its industry, not from what it runs on Nuxeo today, so
presales should confirm each row before anyone plans from it. The accounts are counted by group,
not named, because this repository is public.

- **What fits every account:** platform steps 1 to 6. Record pages from the model, layouts, queues
  and a home per group, task forms, lifecycle and server actions, and the agent do not depend on
  the industry.
- **What is Payers only:** everything concrete. The acceptance test, the demos in section 8, the
  prototype, and the only starter kit with a design. Step 7 names case management, contracts and
  DAM/PAM, and says nothing more about them.
- **Where the gaps are:** brand DAM, media, engineering document control and records management
  need work that no step covers. Between them they are eight of the twenty accounts.

| Use case                        | Accounts | Covered | What the plan lacks for them                                                                                                                                                                                                            |
| ------------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health payers and public health | 3        | Yes     | The public agency: notices in several languages, and public records requests. The pharmacy: prior-authorisation faxes need inbound capture, which waits on a capture path from the platform team                                        |
| Property and casualty insurance | 4        | Partly  | A P&C claims kit: claimants, damage photos, subrogation. The claim usually lives in a core claims system such as Guidewire; section 5 links to it and syncs its data, but shows nothing live from it. Nordic languages for one insurer  |
| Banking                         | 2        | Partly  | Onboarding and KYC checklists, disputes, e-signature, and Spanish for one bank. Retention and legal hold are "Later" in section 6; a bank expects them from the start                                                                   |
| Brand and product DAM           | 4        | Weak    | The file is the business record, and the plan redesigns only records with no file. No asset grid, renditions, video review, proofing, usage rights, share links or brand portal. Licensed apparel: approval rounds with licensors       |
| Media and entertainment         | 1        | Weak    | Everything in the DAM row, plus rights by territory and release window, localised versions, delivery to distributors, and watermarks on pre-release content                                                                             |
| Engineering document control    | 2        | No      | Revision and numbering schemes, review and comment cycles, transmittals to contractors and suppliers, CAD and BIM viewing, export-control marking, and French                                                                           |
| Operations with outside parties | 2        | Partly  | Their records fit the record page: vehicles, deals and titles in automotive; moves, inventories and damage claims in moving. Missing: dealers, agents and drivers as outside users, and e-signature                                     |
| Records management              | 1        | Partly  | Retention, holds and records declaration are in section 5, but come "Later" in section 6. No physical records (boxes, locations, chain of custody), no disposition review, and no separation between client organisations on one system |
| Not known                       | 1        | —       | The industry alone does not say what the use case is                                                                                                                                                                                    |

### Proposed additions

These are proposals. Sections 4 and 8 stay as they are until they are agreed. Section 14 puts them
in order, as four waves.

- **A second acceptance test that is not Payers and starts from files.** For example, a brand
  team's asset page and approval queue, rebuilt in two days or less. DAM is the largest gap and
  covers four or five of these accounts.
- **A record page for files.** Gap 1 fixes types with no file and keeps today's viewer for files.
  An asset page shows the preview first, then renditions, rights, usage and the products the asset
  belongs to.
- **People outside the company:** licensors, distributors, suppliers, contractors, dealers and
  agents, with scoped access, invitations and expiry. Six of the twenty need it.
- **Systems of record beyond links.** Section 5 has links by URL template, events and synced data.
  Insurers and banks also need live data from the core system on the record page, and a Nuxeo
  panel inside Guidewire, Salesforce or a bank's own front end.
- **Controlled documents** as a starter kit, for the two engineering accounts.
- **Records management earlier**, with physical records and separation between client
  organisations, for the records management account. The banks and the public agency need
  retention too.
- **Languages and e-signature in every app:** French, Spanish and the Nordic languages for the UI
  and the record labels, letters in several languages, and signing as a workflow step.
- **Starter kits ordered by the accounts each serves:** P&C claims (4), brand DAM (4), payers (3),
  banking (2), document control (2), case management for the two operations accounts (2),
  media (1) and records management (1). Contract management serves all of them.

### To confirm with presales

For each account: the use case, the records people work on, who works on them, and the systems the
app has to work with. Presales offered to walk us through their demos (P11); the table above can be
the agenda.

## 14. A plan to cover every account

Section 13 found that the platform steps fit every account, but that each kind of account needs a
starter kit of its own and a few capabilities that no step has yet. This plan gives each group of
accounts a demo of its own, in four waves. It names groups, not accounts; section 13 maps one to
the other.

### How the waves work

- **One platform, one kit per use case.** No account gets code of its own. A kit is a data model,
  a configuration package, demo data and a demo script (Step 7). A capability that one kit needs is
  built into the platform, where the next kit finds it.
- **Each wave ends the way the Payers work does:** a demo presales can give, and an acceptance test
  in the form of section 4's. A presales engineer builds the kit's main screens with no Angular
  code, in two days or less, and a prospect would accept the result.
- **The waves follow shared capabilities, not deal size.** Presales knows which accounts matter
  most this year, so the first step is theirs, and it can reorder the waves.

### First: confirm the accounts

- With presales, confirm each account's use case, records, people, and the systems the app has to
  work with (section 13). Rank the groups by what is at stake this year.
- Ask for one model and one set of demo data per group, as the Payers project gave us for wave 1.
- The account whose use case is not known joins a wave once presales says what it is.

### The waves

| Wave                                    | Groups (accounts)                                                     | Kits                                                  | New capabilities                                                                                                                                                                                                            | Acceptance test                                                                              |
| --------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Prove both shapes                    | Health payers and public health (3); brand and product DAM (4)        | Payers and claims; brand assets                       | A record page for files: preview first, then renditions, rights and usage. An asset library. Review with pins and rounds. Rights checked on every download, share and publish. Share links with a watermark and an end date | The Payers screens, and a product page and an asset page, rebuilt in two days each           |
| 2. Records that live elsewhere          | Property and casualty insurance (4); banking (2)                      | Property and casualty claims; onboarding and disputes | Live data from the core system on the record page. A Nuxeo panel inside the core system or the CRM. E-signature as a workflow step. Spanish and the Nordic languages. Retention and legal hold, moved up from "Later"       | A property claim page that shows core-system data beside its documents                       |
| 3. Outside people, controlled documents | Engineering document control (2); operations with outside parties (2) | Controlled documents; case management                 | Outside users with scoped access, invitations and expiry. Revisions, numbering, and review cycles with comment resolution. Transmittals. CAD and BIM viewing through a partner viewer. French                               | A transmittal to an outside contractor, and its comment cycle                                |
| 4. Media rights, records at scale       | Media and entertainment (1); records management (1)                   | Media assets and rights; records management           | Rights by territory and release window, localised versions, delivery to distributors. Retention schedules, disposition review, physical records. Separation between client organisations on one system                      | A film delivered to a distributor within its window, and a disposition run with its approval |

### What wave 1 already has

The prototype's brand assets demo (section 12) is wave 1's second kit, clickable: an asset library,
an asset page with renditions, rights and usage, products with the shots each colourway still
needs, review with pins and rounds, rights renewal, share links, and a licensing portal. Its share
links and its licensor portal also preview wave 3's outside users.

### Who provides what

- **Presales:** the use cases and the ranking, a model and demo data per group, and a reviewer for
  each wave's acceptance test.
- **Platform and backend team:** retention and legal hold on demo servers (wave 2), how outside
  users sign in and what they may see (wave 3), and whether physical records and client separation
  exist in the platform or need an add-on (wave 4). Which of these the platform has today is not
  checked.
- **Us:** the record page for files, the asset library and the review widget (wave 1); the
  live-data widget and the embedded panel (wave 2); the outside-user screens and the
  document-control widgets (wave 3); the rights and records screens (wave 4).
- **To choose:** an e-signature service (wave 2), and a CAD and BIM viewer (wave 3).

### Decisions this adds to section 9

- Whether outside users are in the Beta scope, and how they sign in.
- Whether a record whose data lives in another system can have a record page here, and who owns
  the connector for each core system.
- Which e-signature service and which CAD viewer come first.

### How we track it

The guide's "Every account" page in the prototype shows each group, its kit and its wave, with a
link wherever a flow exists. It names no account, because the site is public.
