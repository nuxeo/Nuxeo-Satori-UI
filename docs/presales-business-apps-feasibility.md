# Is the business-app prototype buildable?

Feasibility of every capability in the [clickable prototype](https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/),
and what we need from whom. Companion to the [plan](presales-business-apps-plan.md).

Checked on 21 November 2026 against two local Nuxeo 2025 servers (`localhost:8080`, container
`nuxeo`, with the AI package installed; `localhost:8090`, container `nx-satfb-1`) and against this
repository at `ac4cb3305`. Every server call was a read (GET). Nothing was created, changed or
billed.

## The answer

- **No capability in the prototype is blocked by the platform.** Every screen maps to an API that
  answered on a real server, or to an add-on Nuxeo ships, or to work we own.
- **Most of it is client work.** The REST API already gives the content model, page provider
  definitions with aggregates, task forms, workflows, audit, comments, bulk actions and ranged
  downloads. Our UI uses little of it today.
- **Two things the plan assumed were open are settled.** The server describes each task's form
  (`taskInfo.schemas` → `var_<node>`), and page provider definitions are readable
  (`GET /api/v1/search/pp/{name}`). The plan said both needed checking or a new endpoint. It is
  corrected.
- **Five things need someone else:** the Payers model and demo data (presales), the Retention and
  Template Rendering add-ons (platform), a capture path for mail and scans (platform), real
  protection for fields like HICN (platform decision), and Claude in the AI package (AI package
  owners).
- **Not proven here:** anything on the Payers model itself, because neither local server has it.
  The screenshots presales sent come from another server.

## How each capability was checked

"Client work" means the platform already supports it and the gap is in our UI. "Studio content"
means presales or a backend developer defines it in Studio (types, lifecycles, workflows, page
providers, chains); the UI then reads it.

| Capability (prototype page)                                   | Verdict                                                  | Evidence                                                                                                                                                                                                                                                 | Who                                |
| ------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Read the data model (Data model)                              | Works today                                              | `/api/v1/config/types`, `/config/schemas?fetch-schema=fields`, `/config/facets` answered; `ContentModelService` already wraps them.                                                                                                                      | Us (use it)                        |
| Record page for a type with no file (Member)                  | Client work                                              | Layouts and `DocumentLayoutComponent` exist; the View tab picks the viewer from one table (`document-type-traits.ts`)                                                                                                                                    | Us                                 |
| Widgets, computed and combined fields (Member)                | Client work                                              | Pure presentation over properties the REST API returns                                                                                                                                                                                                   | Us                                 |
| Related records, records that point here                      | Client work + Studio content                             | NXQL search answered; a reference is a `documentResolver` constraint, reported in schema constraints the same way `directoryResolver` already is (`resolve-layout.ts:80`). No type on either server uses one, so not exercised                           | Us + presales model                |
| Vocabulary labels                                             | Works today                                              | `field-view.ts` shows labels; `/api/v1/directory` listed 11 and 13 vocabularies                                                                                                                                                                          | —                                  |
| Group rules for home, menus, queues                           | Client work                                              | `/api/v1/me` returns the user's groups (`administrators`, `members`)                                                                                                                                                                                     | Us                                 |
| Work queues and business search (Queue, Search)               | Client work + Studio content                             | `GET /api/v1/search/pp/default_search` returned the definition (predicates, sort, aggregates, quick filters); `…/execute` returned 6 aggregates                                                                                                          | Us + page providers in Studio      |
| KPI tiles, reports with drill-down (Home, Reports)            | Client work + Studio content                             | The same aggregates; counts from `resultsCount`                                                                                                                                                                                                          | Us + page providers in Studio      |
| Take it, Assign (Queue)                                       | Client work + Studio content                             | A property update (needs an assignee field in the model) or the existing task reassignment (`TaskService.reassignTask`)                                                                                                                                  | Us + model                         |
| Update all results (Queue)                                    | Client work                                              | `Bulk.RunAction` exists, taking `action`, `query` or `providerName`, and `namedParameters`; the app already uses it for CSV export                                                                                                                       | Us                                 |
| Task forms from the workflow step (Task)                      | Client work                                              | A live task returned `taskInfo.schemas` = `var_Task2556` (fields `comment`, `assignees`) and `taskInfo.layoutResource` = `Task2556@taskLayout`; we send only the stock review variables (`task-detail.component.ts:240`)                                 | Us                                 |
| Start a workflow, task banner (Claim, Case)                   | Client work + Studio content                             | `Context.StartWorkflow(id, start, variables)` exists; `runnableWorkflows` and `pendingTasks` enrichers returned data                                                                                                                                     | Us + workflows in Studio           |
| Lifecycle buttons from allowed transitions (Claim)            | Our server work + Studio content                         | `Document.FollowLifecycleTransition(value)` exists. Nothing lists the allowed transitions: no operation, and the `lifecycle` and `allowedStateTransitions` enrichers returned nothing. Needs a small enricher in `nuxeo-agentic-core`                    | Us + lifecycle policy in Studio    |
| Buttons that run server logic (Claim, Actions)                | Client work + Studio content + decision                  | `/api/v1/automation` lists 342 operations and chains, and `/automation/{id}` returns each one's parameters, so a designer can offer them. The chains themselves (for example `Claim.RequestMedicalRecords`) do not exist yet                             | Us + chains in Studio + decision 3 |
| Timeline, comments (Case, Member)                             | Client work                                              | `@audit` and `@comment` adapters answered 200                                                                                                                                                                                                            | Us                                 |
| Case as a record with its documents (Case)                    | Client work + Studio content                             | `@children` is already used by Browse                                                                                                                                                                                                                    | Us + case type in Studio           |
| Streaming previews (gap 19)                                   | Client work                                              | A ranged download returned `206`, `Accept-Ranges: bytes`, `Content-Range: bytes 0-1023/290025`                                                                                                                                                           | Us                                 |
| Email notifications, subscriptions                            | Works today                                              | `Document.Subscribe`, `Document.Unsubscribe`, `Document.Mail` exist; mail needs SMTP on the server                                                                                                                                                       | Platform (SMTP config)             |
| In-app notification centre (Notifications)                    | Client work, or our server work                          | No notification API in the platform. Can be built from tasks and audit on the client, or as a small service                                                                                                                                              | Us                                 |
| @mentions in comments                                         | Not proven                                               | Not tested                                                                                                                                                                                                                                               | Platform to confirm                |
| Legal hold and retention (Case)                               | Platform: add-on                                         | Neither server has retention or hold operations. Needs Nuxeo Retention Management installed                                                                                                                                                              | Platform                           |
| Generate a letter (Member, Case)                              | Platform: add-on, or a basic version today               | No Template Rendering operations installed. `Render.Document` and the `blobToPDF` chain exist for a basic HTML-to-PDF letter                                                                                                                             | Platform                           |
| Inbound mail and scans (Inbox)                                | Platform: capture path                                   | Nothing ingests mail, scans or faxes on these servers. Classifying a document once it is in Nuxeo exists (`AI.Classify`)                                                                                                                                 | Platform + AI package              |
| Masking HICN and Medicare ID (Member, as Riley)               | Client work for the screen; decision for real protection | Masking on screen is easy and is not a control: the REST API still returns the field. As far as we know Nuxeo has no read permission per field (to confirm); real protection means a separate document with its own permissions, or a server-side filter | Platform decision                  |
| Several apps on one server (Apps)                             | Our server work + decision                               | The configuration servlet serves one configuration today                                                                                                                                                                                                 | Us                                 |
| Satori dev-mode live preview (Agent)                          | Works in the package; not proven here                    | Documented and in code; neither local server has the Satori package (`/nuxeo/agentic-ui/` and `/agentic-ui-config/` return 404)                                                                                                                          | You (a server with it)             |
| App builder agent (Agent)                                     | Our work                                                 | Every read it needs answered: model, page providers, workflows, vocabularies, operations with signatures. The package checks exist (`build.mjs`); the skill and MCP server do not                                                                        | Us                                 |
| AI summaries, NL search, classification (Home, Search, Inbox) | AI package work + client switch                          | `AI.Summarize(docId)`, `AI.Classify(docId)`, `AI.NlToNxql(query)` and 9 more are installed on `:8080`. They call HAIP, Hyland's OpenAI-compatible gateway. The UI has them off by a code constant (`ai-feature-flag.service.ts:35`)                      | AI package owners + us             |
| Unusual-amount flag (Claim)                                   | Our work; AI optional                                    | `AI.Anomalies` reads audit events, not claim amounts. A rule over a page provider aggregate (billed against the provider's average for the code) needs no AI                                                                                             | Us                                 |
| Starter kit for Payers (Kits)                                 | Needs the Payers model                                   | Neither server has Member, Claim or Case (`:8080` has API-explorer types; `:8090` has `RentalContract` and CIC agent types)                                                                                                                              | Presales                           |
| Studio bridge                                                 | Not proven                                               | Where Studio Designer layouts can be read without the Studio API is unknown                                                                                                                                                                              | Platform / Studio team             |

## AI with a Claude token

Yes, it works, with one rule: the key lives on the server and never reaches the browser.
Configuration fragments are public, so a key there would be public too.

- **Where Claude is called.** In the AI package's operations, which already run on the Nuxeo
  server and are what the UI calls. Add a Claude provider there with Anthropic's official Java
  SDK (`com.anthropic`), the key read from the server environment. Pointing the
  OpenAI-compatible HAIP client at Claude is not the supported route.
- **Model.** `claude-opus-5-5` for every operation. Using a cheaper model for high-volume
  classification (`claude-sonnet-5-5` or `claude-haiku-5-5`) is your call, after measuring quality.
- **How each feature calls it:**
  - Summaries of a record and its related claims and cases: one request per summary, with the
    record, its related records and recent audit as input.
  - Classification and field extraction from mail and scans: send the PDF or image itself as a
    document or image block. Get the answer back as structured output (`output_config.format`)
    with a schema per document type, so the fields arrive as valid JSON.
  - Natural language to NXQL: put the customer's content model and vocabularies in the system
    prompt and cache it. Check that `usage.cache_read_input_tokens` is above zero on repeat
    calls.
  - Back-filling classification over an existing repository: the Message Batches API runs it
    asynchronously at half the cost.
  - The app builder agent: for presales, Claude Code with a skill and our MCP server, on their
    own Claude seat, with no API code. Built into the product, it becomes Claude API tool use
    (the SDK's tool runner), with a human approving every publish.
- **Settings that matter on Claude Opus 5.5.** Thinking is always on, so set
  `output_config.effort` per operation: `low` for classification and extraction, higher for
  summaries and the agent. Forced `tool_choice` is rejected, so use structured outputs or
  `strict: true` tools. Handle `stop_reason: "refusal"`, and turn on server-side fallbacks.
  Stream long outputs.
- **Cost, as an estimate.** $4 per million input tokens and $20 per million output tokens. 1,000
  record summaries of about 3,000 tokens in and 300 out cost about $18, plus thinking tokens.
- **Data.** Payers data is health data. Before real member data is sent, the Claude organization
  behind the token needs to be approved under Hyland's AI use requirements, with data terms that
  cover protected health information. The demo data is fictional, so demos are not affected.

## What we need from you

1. **The Payers demo model and data.** The Studio project or a server export with Member, Claim,
   Case and Provider, their lifecycles, workflows, page providers and demo data. Without it the
   kit and the acceptance test cannot run on real definitions.
2. **A demo server with the Satori package installed and dev mode on.** Neither local server has
   the package, so the agent's live-preview loop is untested end to end.
3. **The Claude token, set up properly.** Which Claude organization it belongs to, confirmation
   that it is approved under Hyland's AI use requirements and covers health data, a monthly
   spending cap, and who owns the key on the server.
4. **The product decisions in the plan's section 9.** The three that gate build work are:
   reopening the Beta scope (2), operation buttons (3) and loading customer code (5).
5. **Presales time.** The demo walkthrough, and one presales engineer for the two-day acceptance
   test.

## What we need from the Nuxeo platform and backend team

1. **Nuxeo Retention Management on demo servers**, for legal hold and retention schedules.
   Neither server has it.
2. **Nuxeo Template Rendering**, for letters from Word or HTML templates. Alternatively,
   confirm that `Render.Document` plus PDF conversion is enough for demos.
3. **A decision on protecting fields like HICN.** Confirm whether Nuxeo can restrict reading one
   field. If not, choose a design: a separate document with its own permissions, or a server
   filter.
4. **A capture path for mail, scans and faxes** into an inbox folder: a mail connector or Hyland
   capture. After that, classification is the AI package's job.
5. **SMTP on demo servers**, so task assignment and subscription emails go out.
6. **Two confirmations:** whether comment @mentions notify users on LTS 2025, and where Studio
   Designer layouts can be read from without the Studio API.

## What we need from the AI package owners

1. A Claude provider in the AI package, using the official Anthropic Java SDK, the key from the
   server environment, and `claude-opus-5-5`.
2. Three operations it does not have:
   - field extraction into a target schema, from a PDF or an image;
   - a record summary that includes related records;
   - classification that returns a matching member or claim, not only a type.
3. The customer's content model in `AI.NlToNxql`'s context, so it can query Claim and Member
   fields, not only the stock ones.

## What is ours

Most of the list, all in this repository:

- the quick wins;
- layout file version 2 with widgets, computations and related records;
- task forms from the step's variables;
- the lifecycle-transitions enricher in `nuxeo-agentic-core`;
- operation buttons, once decision 3 is taken;
- home, queues and lists driven by page providers;
- streaming previews;
- several apps per server;
- the agent's skill and MCP server;
- publishing `@nuxeo/satori-platform`;
- turning the AI features back on once the backend is approved.

## Publishing the prototype

Published on GitHub Pages at https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/, beside the Storybook, by
`.github/workflows/storybook-pages.yml` on every push to `main`. The workflow builds the page with
the Satori token it already uses for the Satori-themed Storybook. The built file is not committed,
because it carries Satori's compiled theme and icons. Publishing those is covered by the Satori
owners' approval recorded in that workflow, confirmed for the prototype on 21 November 2026.

It was not published as a claude.ai artifact: this Code session has no artifact tool, and its
Claude Docs connector holds only static SVG drawings, which cannot run the prototype's scripts.

## Not proven, and why

- Anything on the Payers model: not on either server.
- The live-preview loop: no Satori package on either server.
- Reference resolution on real data: no model on either server uses `documentResolver`.
- @mentions, Studio Designer file access, and per-field read protection: not tested; listed for
  the platform team.
- Every AI behaviour: the operations exist, but none was called. A call sends data to a model and
  costs money.
