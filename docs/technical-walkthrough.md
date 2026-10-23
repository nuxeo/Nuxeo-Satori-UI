# Technical Walkthrough — Nuxeo Agentic UI PoC

**Audience:** Thierry, Stan, Narasimha  
**Duration:** 1 hour  
**Goal:** Walk through the code structure, architecture decisions, and how the application was built

---

## Agenda

| #   | Topic                                      | Time   |
| --- | ------------------------------------------ | ------ |
| 1   | Repository & tooling overview              | 5 min  |
| 2   | Application architecture & layer model     | 10 min |
| 3   | Angular application — shell, routing, auth | 10 min |
| 4   | Feature modules — deep dive on one feature | 10 min |
| 5   | Shared libraries — Nuxeo API client        | 10 min |
| 6   | AI backend — Express service & AI features | 10 min |
| 7   | Deployment — Nuxeo Marketplace package     | 5 min  |

---

## 1. Repository & Tooling

### Monorepo with Nx 22

```
agentic-ui-poc/
├── apps/
│   ├── nuxeo-ui/          ← Angular 19 SPA (the main UI)
│                          (no ai-backend — AI ships as a separate marketplace package)
├── libs/
│   ├── features/          ← 8 lazy-loaded feature modules
│   │   ├── browse/
│   │   ├── search/
│   │   ├── document-detail/
│   │   ├── collections/
│   │   ├── tasks/
│   │   ├── administration/
│   │   ├── assets/
│   │   └── trash/
│   └── shared/            ← 4 shared libraries
│       ├── nuxeo-client/  ← All Nuxeo HTTP services + models
│       ├── ui/            ← Reusable UI components
│       ├── ai-client/     ← Angular AI gateway services
│       └── drawers/       ← Shared drawer components
├── nuxeo-agentic-core/        ← OSGi bundle (auth, startup page, notification URL codec)
├── nuxeo-agentic-ui-package/  ← Maven / Nuxeo Marketplace package assembly
├── docs/                  ← Architecture, AI features, API registry
├── .github/workflows/     ← CI (lint + build), Marketplace build
├── nx.json                ← Nx configuration
├── angular.json           ← Angular CLI workspace
├── tsconfig.base.json     ← Path aliases (@agentic-ui/*)
└── pom.xml                ← Maven parent (for Marketplace packaging)
```

**Why an Nx monorepo?**

- Nx enforces **module boundary rules** — features cannot import from each other, only through shared libs.
- `npx nx graph` renders the full dependency graph visually.
- Affected-only builds/lints: `nx affected --target=build` only rebuilds what changed.
- Path aliases (e.g. `@agentic-ui/feature-browse`) are defined once in `tsconfig.base.json`.

**Tech stack:**

| Layer               | Technology                                           | Version  |
| ------------------- | ---------------------------------------------------- | -------- |
| Frontend framework  | Angular                                              | 20.3     |
| UI design system    | Hyland Satori UI (`@hylandsoftware/satori-ui`)       | 0.2.1    |
| Material components | Angular Material                                     | 20.2     |
| State management    | Angular Signals (`signal`, `computed`, `effect`)     | built-in |
| HTTP                | Angular `HttpClient` with functional interceptors    | built-in |
| Monorepo tooling    | Nx                                                   | 22.6     |
| AI backend          | Express 5 + TypeScript                               | —        |
| AI model            | OpenAI GPT-4o / GPT-4o-mini                          | via SDK  |
| Packaging           | Maven + Nuxeo Marketplace                            | —        |
| CI                  | GitHub Actions (lint, build, CodeQL, Copilot review) | —        |

---

## 2. Application Architecture & Layer Model

The codebase follows a **strict 4-layer architecture** enforced by Nx boundary rules:

```
┌──────────────────────────────────────────────────────────┐
│  apps/nuxeo-ui  (App Shell)                              │
│  Routes, shell layout, login, dashboard, settings        │
│  Providers: HTTP, Router, Satori, Auth, Theme            │
└──────────────────────┬───────────────────────────────────┘
                       │ lazy-loads via router
┌──────────────────────▼───────────────────────────────────┐
│  libs/features/*  (Feature Modules)                      │
│  browse / search / document-detail / collections         │
│  tasks / administration / assets / trash                 │
│  Each is a standalone lazy route — no cross-imports      │
└──────────────────────┬───────────────────────────────────┘
                       │ imports from
┌──────────────────────▼───────────────────────────────────┐
│  libs/shared/*  (Shared Libraries)                       │
│  nuxeo-client  ← all Nuxeo API services & models         │
│  ui            ← document viewer, dialogs, widgets       │
│  ai-client     ← AI gateway services                     │
│  drawers       ← search/asset drawer re-exports          │
└──────────────────────────────────────────────────────────┘
```

**Key rule:** Features never import from other features. They only import from `libs/shared/*`. This is enforced by `nx.json` `@nx/enforce-module-boundaries` lint rule — the CI fails if violated.

---

## 3. Angular Application — Shell, Routing, Auth

### Bootstrap (`apps/nuxeo-ui/src/main.ts`)

```typescript
bootstrapApplication(App, appConfig);
```

Single-file bootstrap — no `NgModule` anywhere in the codebase. All 247 source files are **standalone components**.

### Application config (`apps/nuxeo-ui/src/app/app.config.ts`)

Key providers registered at startup:

```typescript
provideHttpClient(withInterceptors([nuxeoAuthInterceptor]))  // Auth on every /nuxeo/ request
provideRouter(routes, withComponentInputBinding(), withHashLocation()) // Hash routing for Tomcat/SPA
provideSatori()                                              // Hyland design system
importProvidersFrom(TranslateModule.forRoot({ ... }))        // i18n
APP_INITIALIZER → AppThemeService                           // Theme applied before render
CURRENT_USERNAME token                                       // Dynamic username signal
NUXEO_SERVER_URL token                                       // Nuxeo Drive integration
```

**Hash routing** (`withHashLocation`) means all URLs look like `http://host/#/browse/...`. This ensures the Nuxeo/Tomcat server always receives the base path and Angular handles internal routing — no server-side catch-all needed.

### Routing (`apps/nuxeo-ui/src/app/app.routes.ts`)

```
/login                      → LoginPageComponent (no auth)
/                           → AppShellComponent (auth required)
  /dashboard                → DashboardPageComponent
  /browse                   → browseRoutes (lazy, feature-browse)
  /search                   → searchRoutes (lazy, feature-search)
  /doc/:id                  → documentDetailRoutes (lazy, feature-document-detail)
  /documents                → AssetSearchResultsComponent (lazy)
  /tasks                    → tasksRoutes (lazy, feature-tasks)
  /collections              → collectionsRoutes (lazy, feature-collections)
  /trash                    → trashRoutes (lazy, feature-trash)
  /administration           → administrationRoutes (lazy, adminGuard)
  /settings/profile         → ProfilePageComponent
  /settings/themes          → ThemesPageComponent
  /settings/nuxeo-drive     → NuxeoDrivePageComponent
  ... etc
```

Every feature is loaded **only when the user navigates to it** — initial bundle is small.

### Authentication

**Guard (`auth.guards.ts`):**

```typescript
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.parseUrl('/login');
};
```

**Interceptor (`nuxeo-auth.interceptor.ts`):**

```typescript
export const nuxeoAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (!req.url.includes('/nuxeo/')) return next(req);
  const basic = auth.basicCredentials();
  let headers = req.headers;
  if (basic) headers = headers.set('Authorization', `Basic ${basic}`);
  return next(req.clone({ headers, withCredentials: true }));
};
```

- For **password login**: attaches `Authorization: Basic ...` header.
- For **SSO/SAML**: sends cookies via `withCredentials: true` — no header needed.
- Both modes handled by the same single interceptor.

### Angular patterns used throughout

Every component in the codebase follows the same conventions:

```typescript
@Component({ standalone: true, imports: [...], template: '...' })
export class MyComponent {
  // Dependency injection — no constructor parameters
  private readonly service = inject(MyService);

  // State — signals instead of properties
  readonly docs = signal<NuxeoDocument[]>([]);
  readonly loading = signal(false);
  readonly hasResults = computed(() => this.docs().length > 0);

  // Inputs — new functional style
  readonly docId = input.required<string>();

  // Auto-cleanup — no manual unsubscribe
  ngOnInit() {
    this.service.getDocs().pipe(takeUntilDestroyed()).subscribe(docs => {
      this.docs.set(docs);
    });
  }
}
```

---

## 4. Feature Modules — Browse as an Example

**Library:** `libs/features/browse/`

```
browse/
├── src/
│   ├── index.ts                        ← Public API (browseRoutes, BrowseComponent)
│   └── lib/
│       ├── lib.routes.ts               ← Route definitions
│       ├── browse/
│       │   ├── browse.ts               ← Main smart container (~900 lines)
│       │   └── browse.html             ← External template
│       └── dialogs/
│           ├── create-import-dialog/   ← Create document / import file
│           ├── folder-picker-dialog/   ← Move/copy destination picker
│           ├── column-settings-dialog/ ← Configurable table columns
│           ├── edit-metadata-dialog/   ← Inline metadata editing
│           └── drive-dialog/           ← Nuxeo Drive integration
```

**Routes (`lib.routes.ts`):**

```typescript
export const browseRoutes: Routes = [
  { path: '', component: BrowseComponent },
  { path: ':path', component: BrowseComponent }, // any depth, e.g. /browse/workspaces/project-a
];
```

**`BrowseComponent` capabilities:**

- Folder navigation with breadcrumbs
- Configurable column table (sortable, resizeable)
- Multi-select with bulk operations (delete, move, copy, add to collection)
- Inline drag-and-drop import
- Document creation dialog (title, type, description)
- Thumbnail loading via authenticated `HttpClient` (not direct `<img src>`)
- Nuxeo Drive "Direct Transfer" integration

**What this shows:** Once the first feature module was built, every subsequent module followed exactly the same folder structure, route pattern, dialog pattern, and component conventions. The agent replicated this across all 8 features.

---

## 5. Shared Libraries — Nuxeo API Client

**Library:** `libs/shared/nuxeo-client/`

This is the backbone of the application. Everything that talks to Nuxeo goes through here.

### Services (23 total)

| Service                       | Responsibility                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `NuxeoApiBase`                | Base HTTP client — wraps `HttpClient`, appends `/nuxeo` base URL, typed GET/POST/PUT/DELETE |
| `DocumentService`             | List children, fetch page by path, create folder                                            |
| `DocumentDetailService`       | Fetch full doc, blob, thumbnail, PDF rendition, version history                             |
| `DocumentImportService`       | File upload with progress (multipart)                                                       |
| `SearchService`               | NXQL query execution, saved searches, aggregations                                          |
| `SearchAggregationService`    | Shared search state signal, saved-search version signal                                     |
| `AssetService`                | DAM-specific queries (pictures, videos, audio)                                              |
| `BrowseService`               | Folder navigation, breadcrumb resolution                                                    |
| `CollectionService`           | List, create (`Collection.Create` automation), manage members                               |
| `TaskService`                 | Fetch tasks, complete task, start workflow                                                  |
| `WorkflowService`             | Start/stop workflow processes                                                               |
| `TrashService`                | List trashed docs, restore, permanently delete                                              |
| `TrashFilterService`          | Trash-specific saved filters                                                                |
| `UserService`                 | Fetch users, groups, current user profile                                                   |
| `AdministrationService`       | NXQL console, audit, analytics, cloud services, vocabularies                                |
| `TagService`                  | Suggest tags, apply tags via Automation API                                                 |
| `DirectoryService`            | Nuxeo vocabulary lookups                                                                    |
| `NuxeoDriveService`           | Token management, `nxdrive://` URL generation                                               |
| `PrincipalPermissionsService` | ACL read/write per document                                                                 |
| `SelectionService`            | Cross-component selection state                                                             |
| `SettingsService`             | User preferences persistence                                                                |
| `ArenderService`              | ARender annotation viewer URL + availability check                                          |
| `AssetAggregationService`     | DAM facet aggregations                                                                      |

### Data models

13 TypeScript model files covering: `NuxeoDocument`, `NuxeoTask`, `NuxeoWorkflow`, `NuxeoUser`, `NuxeoGroup`, `NuxeoACL`, `NuxeoAuditEntry`, `PaginatedList<T>`, search aggregations, asset metadata, and more — all fully typed, no `any`.

### How a typical API call works

```typescript
// In BrowseComponent
private readonly browseService = inject(BrowseService);

loadFolder(path: string) {
  this.loading.set(true);
  this.browseService.getChildren(path).pipe(
    takeUntilDestroyed(this.destroyRef),
    finalize(() => this.loading.set(false))
  ).subscribe(result => {
    this.docs.set(result.entries);
    this.totalCount.set(result.resultsCount);
  });
}

// In BrowseService
getChildren(path: string): Observable<PaginatedList<NuxeoDocument>> {
  return this.api.get<PaginatedList<NuxeoDocument>>(
    `/nuxeo/api/v1/path/${path}/@children`,
    { headers: { 'enrichers-document': 'thumbnail,permissions,subtypes' } }
  );
}
```

The `HttpClient` interceptor transparently adds `Authorization` — services don't need to know about auth.

---

## 6. AI Features — Nuxeo Automation Operations

**Not in this repository.** AI features are served by `AI.*` Automation operations from a
separate Nuxeo marketplace package. This repo contains only the client,
`libs/shared/ai-client`. An earlier iteration ran an Express service at `apps/ai-backend/`
on port 3000; that has moved to its own repo.

### Architecture

```
Angular UI  ──POST /nuxeo/api/v1/automation/AI.Insights──►  Nuxeo Server  ──►  HAIP
                                                            (AI marketplace
                                                             package)
```

Calls are same-origin Nuxeo Automation requests, so they reuse the existing auth interceptor.
There is no `/ai/*` surface, no separate port, and no CORS configuration. If the package is
not installed on the target server, AI calls return HTTP 500 and the rest of the application
is unaffected.

### Routes & capabilities

All called as `POST /nuxeo/api/v1/automation/<Operation>`.

| Operation           | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `AI.NlToNxql`       | Natural language → NXQL query                               |
| `AI.Summarize`      | Summarize document content                                  |
| `AI.SuggestTags`    | Suggest tags from content                                   |
| `AI.Classify`       | Classify document type, nature, subjects                    |
| `AI.Similar`        | Find similar documents                                      |
| `AI.Anomalies`      | Detect anomalies in audit events                            |
| `AI.Sentiment`      | Sentiment analysis on comments and content                  |
| `AI.Insights`       | Dashboard insight cards — pending tasks and recent activity |
| `AI.Chat`           | RAG-based conversational assistant                          |
| `AI.NlPermissions`  | Natural language → ACL answers                              |
| `AI.AuditSummarize` | Summarize a set of audit events                             |
| `AI.AuditNlFilter`  | Natural language filter over the audit trail                |

### How the NL → NXQL feature works

1. User types "show me contracts modified last week" in the search bar
2. Angular posts to `/nuxeo/api/v1/automation/AI.NlToNxql` with the text
3. The server-side operation calls HAIP with a system prompt that knows NXQL syntax rules, valid field names, date literal format, etc.
4. GPT returns structured JSON: `{ "nxql": "SELECT * FROM Document WHERE ...", "explanation": "..." }`
5. Angular displays the explanation to the user and executes the NXQL against Nuxeo

### How the RAG Chat works

```
User message
    │
    ▼
Generate embedding (text-embedding-3-small)
    │
    ▼
Cosine-similarity search against indexed Nuxeo docs  ← RagService (in-memory)
    │
    ▼
Top-K relevant document chunks injected into GPT-4o context
    │
    ▼
Streaming response (Server-Sent Events) → Angular UI
```

### System prompt engineering

The backend has carefully crafted system prompts for each feature. Example (NL→NXQL):

```
"You are a Nuxeo NXQL query generator. Convert the user's natural language query into a valid NXQL query.
Always include: ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0
NXQL syntax rules:
- Date literals: DATE 'yyyy-MM-dd' — there is NO CURRENT_DATE or INTERVAL keyword
- Valid document types: Document, File, Note, Picture, Video, Audio, Folder, Workspace, Collection
  Do NOT use Task, User, or Group — those are not NXQL queryable
..."
```

This level of domain-specific instruction was key to getting reliable output — the prompts encode Nuxeo-specific constraints that GPT wouldn't know otherwise.

### AI feature flag

AI features are enabled by default (controlled in `libs/shared/ai-client/src/lib/ai-feature-flag.service.ts`). Users can explicitly disable them via the toggle in the app header, and that opt-out is persisted in local storage.

Default-on assumes the Nuxeo AI operations and HAIP key are configured in the target environment. To prevent AI calls in development, use the app header toggle to disable AI features for that browser profile, or remove the HAIP key from the local Nuxeo configuration.

---

## 7. Deployment — Nuxeo Marketplace Package

### How the Angular app ships as a Nuxeo add-on

```
mvn package -pl nuxeo-agentic-ui-package -am  (triggered by GitHub Actions on main)
    │
    ├── nx build nuxeo-ui --base-href=/nuxeo/agentic-ui/
    │       └── dist/nuxeo-ui/browser/  (Angular static files)
    │
    ├── nuxeo-agentic-core  (Maven JAR module)
    │       └── nuxeo-agentic-core.jar  (OSGi bundle)
    │
    └── nuxeo-agentic-ui-package assembly
            ├── install/bundles/nuxeo-agentic-core.jar
            └── web/nuxeo.war/agentic-ui/  (Angular files → served by Tomcat)
```

**Maven `nuxeo.version` (currently `11.5.154`):** imports the `nuxeo-parent` BOM so the `nuxeo-agentic-core` Java module can compile against Nuxeo platform APIs (for example `AbstractDocumentViewCodec`). This is a **build-time** dependency version. The **runtime** Nuxeo platform range is declared separately in `nuxeo-agentic-ui-package/src/main/resources/package.xml` (`[2025.0,2026.0)`).

**OSGi contributions in `nuxeo-agentic-core`:**

- `deployment-fragment.xml` — tells Nuxeo to pass all requests under `/agentic-ui/*` through `NuxeoAuthenticationFilter`, enabling SSO/SAML to work seamlessly
- `auth-config-agentic.xml` — authentication configuration for the agentic UI path
- `login-startup-page-agentic-contrib.xml` — registers the UI as a valid start URL
- `agentic-notification-doc-url-contrib.xml` + `AgenticNotificationDocumentIdCodec` — permission notification emails link to `agentic-ui/#/doc/{uid}`

**Result:** After installing the Marketplace package on a Nuxeo server, the UI is accessible at `https://your-nuxeo-server/nuxeo/agentic-ui/` with full SSO support. No separate server needed for the frontend.

**Live demo URL:** `https://satori-ui.beta.nuxeocloud.com/` (credentials available on request)

---

## 8. Key Design Decisions — Q&A Prep

**Q: Why Angular 19 and not React or Vue?**

> Hyland's Satori design system (`@hylandsoftware/satori-ui`) publishes Angular components. Using Angular meant native integration with the design system, consistent with how Nuxeo Web UI is built.

**Q: Why standalone components everywhere?**

> Angular 19 strongly recommends standalone — no `NgModule` boilerplate, cleaner imports, tree-shaking at component level. Every one of the 157 TypeScript component files uses `standalone: true`.

**Q: Why signals instead of RxJS for state?**

> Signals (`signal()`, `computed()`) provide fine-grained reactivity with no subscription management. RxJS is still used for HTTP streams and complex async flows but state is held in signals.

**Q: Why hash routing?**

> When deployed on Tomcat (Nuxeo's server), the server doesn't know about Angular routes. Hash routing (`/#/browse/...`) means the server always sees the base URL and Angular handles the path internally — no server-side configuration needed.

**Q: How does auth work when it's embedded in Nuxeo?**

> The OSGi `deployment-fragment.xml` tells Nuxeo to apply `NuxeoAuthenticationFilter` to the `/agentic-ui/*` path. When a user visits the UI, Nuxeo handles SSO/SAML transparently before Angular loads. The Angular interceptor then sends `withCredentials: true` so Nuxeo session cookies are included on every API call.

**Q: How was the AI backend secured?**

> By removing it as a separate attack surface. AI features are now Nuxeo Automation
> operations from a marketplace package, so calls are same-origin and authenticated by
> Nuxeo itself through the existing interceptor. There is no public AI endpoint, no CORS
> policy to maintain, and no model credentials anywhere in this repository — HAIP settings
> live in Nuxeo server configuration.

**Q: What was the hardest technical challenge?**

> ARender (annotation viewer) integration. The generic ARender Docker image doesn't include the Nuxeo connector — we had to decompile the Java classes in the NEV image to understand how it authenticates. Took ~6 debugging iterations.

---

## 9. Repository Navigation — Where to Look

| You want to see...          | Look here                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| App bootstrap & providers   | `apps/nuxeo-ui/src/app/app.config.ts`                                      |
| All routes                  | `apps/nuxeo-ui/src/app/app.routes.ts`                                      |
| Auth interceptor            | `apps/nuxeo-ui/src/app/auth/nuxeo-auth.interceptor.ts`                     |
| Dashboard widgets           | `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.ts`              |
| Browse feature (full)       | `libs/features/browse/src/lib/browse/browse.ts`                            |
| Document detail (tabs)      | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| Search with aggregations    | `libs/features/search/src/lib/search/search.ts`                            |
| Nuxeo API base client       | `libs/shared/nuxeo-client/src/lib/services/nuxeo-api-base.ts`              |
| Document service            | `libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`     |
| Document viewer (PDF/video) | `libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts`      |
| AI client gateway           | `libs/shared/ai-client/src/lib/ai-gateway.service.ts`                      |
| AI chat state               | `libs/shared/ai-client/src/lib/ai-chat.service.ts`                         |
| AI operations and prompts   | separate AI marketplace package repository                                 |
| Marketplace config          | `nuxeo-agentic-ui-package/src/main/resources/package.xml`                  |
| OSGi bundle module          | `nuxeo-agentic-core/`                                                      |
| Nuxeo OSGi auth config      | `nuxeo-agentic-core/src/main/resources/OSGI-INF/deployment-fragment.xml`   |
| Notification doc URL codec  | `nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/url/codec/`            |
| CI pipeline                 | `.github/workflows/ci.yml`                                                 |
| Marketplace CI              | `.github/workflows/build-marketplace.yml`                                  |
| Dependency graph            | `npx nx graph` (run locally)                                               |

---

_Prepared for technical review with Thierry, Stan, and Narasimha — April 2026_
