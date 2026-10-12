# AGENTS.md — Nuxeo Agentic UI: Complete Codebase Context

**Read this file at the start of every AI session.**
Full knowledge base: `AGENTS/00-architecture.md` through `AGENTS/11-beta-program.md`

---

## 1. Architecture in 30 Seconds

Angular 20 + Nx monorepo with 4 layers:

```
apps/nuxeo-ui          ← App Shell (routing, auth, global search)
    ↓ lazy-loads
libs/features/*        ← 8 Feature Modules (browse, search, doc-detail, …)
    ↓ imports from     ← NEVER cross-feature imports
libs/shared/*          ← Services, UI components, models, AI client
    ↓ calls
Nuxeo Server           ← Via proxy in dev, same-origin in prod
```

**Critical rules:** Features never import each other · Services in `libs/shared/nuxeo-client/` · All components standalone · All templates external · `inject()` not constructor · `signal()` not BehaviorSubject · `takeUntilDestroyed()` on every subscription

The arrows above are enforced by `@nx/enforce-module-boundaries` `depConstraints` in
`eslint.config.mjs`, and only since 2026-08-24 — until then the constraint was Nx's
scaffolded `sourceTag: '*' → onlyDependOnLibsWithTags: ['*']`, which permits every edge
in the graph. The rule was `error` the whole time and had never rejected anything. Four
violations had accumulated, including a `libs/shared/` library that depended on two
feature libraries. Every project now carries `scope:` and `type:` tags; **an untagged
project cannot depend on anything**, so a new library needs tags before it can import.

→ Full detail: `AGENTS/00-architecture.md`

---

## 2. Feature Modules

| Route               | Module                                | Main component                 |
| ------------------- | ------------------------------------- | ------------------------------ |
| `/#/browse`         | `@agentic-ui/feature-browse`          | `BrowseComponent`              |
| `/#/search`         | `@agentic-ui/feature-search`          | `SearchComponent`              |
| `/#/doc/:uid`       | `@agentic-ui/feature-document-detail` | `DocumentDetailComponent`      |
| `/#/collections`    | `@agentic-ui/feature-collections`     | `CollectionDetailComponent`    |
| `/#/tasks`          | `@agentic-ui/feature-tasks`           | `TasksPageComponent`           |
| `/#/administration` | `@agentic-ui/feature-administration`  | `AdministrationShellComponent` |
| `/#/documents`      | `@agentic-ui/feature-assets`          | `AssetSearchResultsComponent`  |
| `/#/trash`          | `@agentic-ui/feature-trash`           | `TrashComponent`               |

---

## 3. Key Services (quick reference)

All in `libs/shared/nuxeo-client/src/lib/services/` · Import: `@nuxeo-satori/platform/nuxeo-client`

| Service                    | Primary use                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `DocumentDetailService`    | Single-doc ops: fetch, blob, PDF, audit, lock, versions, permissions, export |
| `BrowseService`            | Folder navigation, update doc, CSV export                                    |
| `SearchAggregationService` | Search state (signals), saved searches, suggestions                          |
| `CollectionService`        | Collection CRUD + members                                                    |
| `TaskService`              | Workflow tasks                                                               |
| `UserService`              | User/group search and management                                             |
| `TagService`               | Tag CRUD + suggestions                                                       |
| `WorkflowService`          | Workflow model + instance operations                                         |
| `DocumentService`          | Recently edited/viewed, expired docs                                         |
| `DocumentImportService`    | Upload batch, CSV import                                                     |
| `SelectionService`         | Multi-select state (signals)                                                 |
| `DirectoryService`         | Nuxeo vocabulary/directory lookups                                           |
| `NuxeoDriveService`        | Nuxeo Drive URL building + launch                                            |
| `ArenderService`           | ARender annotation viewer                                                    |

→ Full signatures: `AGENTS/01-services.md`

---

## 4. Most-Used API Endpoints

| Operation         | Method | Endpoint                                     |
| ----------------- | ------ | -------------------------------------------- |
| Fetch document    | GET    | `/nuxeo/api/v1/id/:uid`                      |
| NXQL search       | POST   | `/nuxeo/api/v1/search/lang/NXQL/execute`     |
| Create collection | POST   | `/nuxeo/api/v1/automation/Collection.Create` |
| Get children      | GET    | `/nuxeo/api/v1/id/:uid/@children`            |
| Get thumbnail     | GET    | `/nuxeo/api/v1/id/:uid/@rendition/thumbnail` |
| Get PDF           | GET    | `/nuxeo/api/v1/id/:uid/@rendition/pdf`       |
| Upload            | POST   | `/nuxeo/api/v1/upload`                       |
| Complete task     | PUT    | `/nuxeo/api/v1/task/:taskId`                 |

→ Full reference + enrichers + automation ops: `AGENTS/02-nuxeo-apis.md`

---

## 5. AI Operations

Served by **Nuxeo Automation operations** from a Java marketplace package deployed on the
Nuxeo server. The backend is **not in this repository** — it lives in its own repo. This
repo holds only the Angular client, which posts to
`/nuxeo/api/v1/automation/AI.<Operation>`. If the package is absent on the target server,
AI calls return 500; that is expected, not a client defect.
Feature flag: **on by default** — gated by `AiFeatureFlagService`, with an explicit user opt-out

| Automation operation | Purpose                 |
| -------------------- | ----------------------- |
| `AI.NlToNxql`        | Natural language → NXQL |
| `AI.Summarize`       | Document summary        |
| `AI.SuggestTags`     | Tag suggestions         |
| `AI.Classify`        | Document classification |
| `AI.Chat`            | RAG conversational chat |
| `AI.Insights`        | Dashboard insight cards |
| `AI.Anomalies`       | Audit anomaly detection |

→ Full detail: `AGENTS/10-ai-features.md`

---

## 6. Where Things Live

| I need to...            | Location                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Add a Nuxeo API call    | `libs/shared/nuxeo-client/src/lib/services/<domain>.service.ts`                                |
| Add a shared dialog     | `libs/shared/ui/src/lib/<dialog-name>/`                                                        |
| Add a feature page      | `libs/features/<feature>/src/lib/<feature>/<feature>.ts`                                       |
| Change routing          | `apps/nuxeo-ui/src/app/app.routes.ts`                                                          |
| Change navigation       | `apps/nuxeo-ui/src/app/platform-nav-items.ts`                                                  |
| Call a new AI operation | `libs/shared/ai-client/src/lib/ai-gateway.service.ts` (operation lives in the AI package repo) |
| Change auth behavior    | `apps/nuxeo-ui/src/app/auth/`                                                                  |
| Add a data model        | `libs/shared/nuxeo-client/src/lib/models/`                                                     |
| Add a shared component  | `libs/shared/ui/src/lib/`                                                                      |
| Add an `nxs-` component | `libs/shared/satori-components/src/lib/` — rules in `AGENTS/00-architecture.md`                |

---

## 7. Definition of Done for Every Task

- [ ] `npx nx affected -t lint` passes
- [ ] `npx nx affected -t build` passes
- [ ] `npx nx affected -t test` passes
- [ ] Unit tests written for any new service method
- [ ] `docs/api-integrations.md` updated if a new Nuxeo endpoint was called
- [ ] `docs/accessibility.md` consulted if an accessibility check was added, moved or suppressed
      — every concern has exactly one owning layer, and duplicating a _verdict_ is a defect.
      Observation may overlap: a cross-check that observes what another layer judges is useful,
      and some are kept deliberately
- [ ] `docs/ai-features.md` updated if AI backend changed
- [ ] `AGENTS/01-services.md` updated if a new service method was added
- [ ] `AGENTS/00-architecture.md` updated if architecture changed
- [ ] A new `nxs-` component has its section in `docs/satori-components/with-and-without-satori.md`,
      then `npm run docs:satori-comparison:capture` and `npm run docs:satori-comparison:publish`
      (`AGENTS/00-architecture.md`, "Adding a component", step 10)
- [ ] PR created on `feature/*` or `fix/*` branch (never commit to `main` directly)

---

## 8. Full Knowledge Base Index

| File                               | Contents                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `AGENTS/00-architecture.md`        | 4-layer model, Nx rules, directory map, routing, auth flow    |
| `AGENTS/01-services.md`            | All 23 services with full method signatures                   |
| `AGENTS/02-nuxeo-apis.md`          | All REST + Automation endpoints, NXQL patterns, enrichers     |
| `AGENTS/03-angular-conventions.md` | Signals, inject(), standalone, subscriptions, blob URLs       |
| `AGENTS/04-feature-scaffold.md`    | Step-by-step guide to add a new feature module or dialog      |
| `AGENTS/05-test-standards.md`      | Test templates, coverage requirements, Vitest patterns        |
| `AGENTS/06-git-workflow.md`        | Branch naming, Conventional Commits, PR process, JIRA linking |
| `AGENTS/07-security.md`            | Credentials, XSS, auth interceptor, blob lifecycle            |
| `AGENTS/08-bug-patterns.md`        | 10 known anti-patterns with BAD/GOOD examples                 |
| `AGENTS/09-pr-feedback.md`         | How to fetch and resolve GitHub PR review comments            |
| `AGENTS/10-ai-features.md`         | AI backend routes, HAIP config, feature flag system           |
| `AGENTS/11-beta-program.md`        | Beta program: extensibility layers, phase gates, agent roster |

---

_If you are using JetBrains AI or another tool that requires manual context loading:_
_type `@AGENTS.md` at the start of your session to load this file, then request the_
_specific `AGENTS/` file(s) relevant to your task._
