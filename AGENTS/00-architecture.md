# Architecture — Nuxeo Agentic UI

## Stack

| Layer                | Technology                                                      |
| -------------------- | --------------------------------------------------------------- |
| Frontend framework   | Angular 20 (standalone components, signals)                     |
| Monorepo tool        | Nx 22                                                           |
| UI component library | Satori (Hyland design system) + Angular Material                |
| State management     | Angular Signals — no NgRx, no BehaviorSubject for UI state      |
| HTTP                 | Angular HttpClient via `NuxeoApiBase` wrapper                   |
| Auth                 | SAML SSO in production; Basic Auth interceptor in development   |
| Backend (AI)         | Nuxeo Automation operations from a separate marketplace package |
| AI provider          | Hyland HAIP Model Gateway (OpenAI-compatible API)               |
| Document platform    | Nuxeo Content Services Platform                                 |

---

## 4-Layer Model

```
apps/nuxeo-ui                    ← App Shell (routing, auth, global search, header)
    ↓ lazy-loads
libs/features/*                  ← Feature Modules (browse, search, document-detail, …)
    ↓ imports from               ← NEVER import from sibling features
libs/shared/*                    ← Shared Libraries (services, UI components, models)
    ↓ HTTP calls via
Nuxeo Server                     ← via Angular dev proxy (:8080) in dev; same-origin in prod
```

### Critical Boundary Rules (enforced by Nx lint)

1. **Features NEVER import from other features.** `libs/features/browse` cannot import from `libs/features/search`. Shared state goes in `libs/shared/`.
2. **Services ALWAYS live in `libs/shared/nuxeo-client/src/lib/services/`**. Feature components never own services.
3. **Components NEVER inject `NuxeoApiBase` directly.** They inject domain services (e.g. `DocumentDetailService`).
4. **Every component is `standalone: true`.** No NgModules exist anywhere.
5. **Every template is external.** Use `templateUrl`, never inline `template`.

---

## Directory Map

```
apps/
  nuxeo-ui/                      ← Main Angular SPA
    src/app/
      auth/                      ← Guards, interceptors, SAML providers
      dashboard/                 ← DashboardPageComponent
      login/                     ← LoginPageComponent
      shell/                     ← AppShellComponent (header, global search)
      settings/                  ← Profile, Nuxeo Drive, Cloud Services pages
      app.config.ts              ← Providers, router config
      app.routes.ts              ← Top-level lazy routes
  (no ai-backend — AI operations ship as a separate Nuxeo marketplace package)

libs/
  features/
    browse/                      ← /browse — folder tree + document list
    search/                      ← /search — full-text + faceted search
    document-detail/             ← /doc/:uid — document viewer + tabs
    collections/                 ← /collections — collection management
    tasks/                       ← /tasks — workflow tasks
    administration/              ← /administration — admin console
    assets/                      ← /documents — DAM asset search
    trash/                       ← /trash — trash management
  shared/
    nuxeo-client/                ← All Nuxeo API services + models + config
      src/lib/
        services/                ← 23 services (see AGENTS/01-services.md)
        models/                  ← TypeScript interfaces for Nuxeo objects
    ui/                          ← Reusable UI components (widgets, dialogs, viewer)
    ai-client/                   ← AI feature flag service + AI backend HTTP client
    kd-client/                   ← Knowledge Discovery client via Nuxeo CIC automation
    ke-client/                   ← Knowledge Enrichment client via AgenticKnowledgeEnrichment.Enrich (CIC Java SDK)
    document-layouts/            ← Per-type layouts: package layout files or schema-generated (NXSAT-311); internal, not in the platform package
    adf-hx-bridge/               ← HxPR bridge + hxp-* UI for adf-hx browse POC (see ARCHITECTURE.md)
```

---

## adf-hx Browse POC

Parallel browse at `/#/browse-adf-hx?path=…` using `@agentic-ui/shared/adf-hx-bridge`. Does **not** replace production `/#/browse`. Feature page: `libs/features/browse/src/lib/browse-adf-hx-poc/`.

→ Full detail: `libs/shared/adf-hx-bridge/ARCHITECTURE.md` · Agent rule: `.cursor/rules/adf-hx-browse-poc.mdc`

---

## Routing

All routes use `HashLocationStrategy` (`/#/path`). This ensures Nuxeo/Tomcat serves `index.html` for all deep links without 404s.

| Path                | Component                    | Auth       |
| ------------------- | ---------------------------- | ---------- |
| `/#/login`          | LoginPageComponent           | Public     |
| `/#/dashboard`      | DashboardPageComponent       | Required   |
| `/#/browse`         | BrowseComponent              | Required   |
| `/#/browse-adf-hx`  | BrowseAdfHxPocComponent      | Required   |
| `/#/search`         | SearchComponent              | Required   |
| `/#/doc/:uid`       | DocumentDetailComponent      | Required   |
| `/#/documents`      | AssetSearchResultsComponent  | Required   |
| `/#/tasks`          | TasksPageComponent           | Required   |
| `/#/collections`    | CollectionDetailComponent    | Required   |
| `/#/trash`          | TrashComponent               | Required   |
| `/#/administration` | AdministrationShellComponent | Admin only |

---

## Authentication Flow

**Development (`:4200`):**

- `NuxeoAuthInterceptor` adds `Authorization: Basic <base64>` to all `/nuxeo/*` requests
- Credentials from `environment.ts`

**Production (same-origin with Nuxeo):**

- SAML SSO via `NuxeoSSOProviders`
- Session cookie handles authentication

**Auth Guards:**

- `authGuard` — redirects to `/login` if not authenticated
- `loginGuard` — redirects to `/dashboard` if already authenticated
- `adminGuard` — 403 if user is not in `administrators` group

---

## Configuration delivery (server side)

Configuration is contributed by Marketplace packages, never edited on the server (NXSAT-312).
`nuxeo-agentic-core` declares the component `org.nuxeo.agentic.ui.config` with the extension point
`configuration` (`<fragment layer="bootstrap|manifest">`, `<layout type mode>`, `<asset>`) and
contributes our defaults to it. `AgenticUiConfigServlet` serves the ordered fragments, with
provenance, at `/nuxeo/agentic-ui-config/` — **anonymously**, so nothing sensitive may be
contributed. A customer ships their own package that depends on `nuxeo-agentic-ui` and
`<require>`s `org.nuxeo.agentic.ui.config.defaults`. Detail:
`documentation/30-engineering/13-deployment-and-troubleshooting.md` §2.

---

## Key Conventions

- Dependency injection: `inject()` function, never constructor parameters
- State: `signal()` for all mutable state, `computed()` for derived values, `effect()` for side effects
- Subscriptions: always use `takeUntilDestroyed()` — never manual `unsubscribe()`
- Blob URLs: always `URL.revokeObjectURL()` in `ngOnDestroy` for every `createObjectURL`
- Authenticated content: always use `HttpClient` (via services) — never `<img [src]="nuxeoUrl">`
- Imports: `@nuxeo-satori/platform/nuxeo-client`, `@nuxeo-satori/platform/ui`, `@agentic-ui/shared/ai-client`, `@agentic-ui/shared/kd-client`, `@agentic-ui/shared/ke-client`
